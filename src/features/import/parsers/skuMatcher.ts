/**
 * Canonical Product / SKU Matching Engine for SAP PDF Picklist & Bills Import.
 *
 * MATCHING HIERARCHY:
 * Level 1 — OFFICIAL PRODUCT MASTER:
 *   When Picklist SKU exists in Product Master -> MATCHED (or MISMATCH if price/quantity conflict).
 * Level 2 — HISTORICAL SALES:
 *   When Picklist SKU is NOT in Product Master, but exists in historical sales (sale.xlsx) -> HISTORICAL_MATCH.
 * Level 3 — HISTORICAL PURCHASE / GR DATA:
 *   When Picklist SKU exists in previous purchase inward records -> HISTORICAL_MATCH.
 * Level 4 — UNMAPPED:
 *   When Picklist SKU cannot be found anywhere -> UNMAPPED. No guessing!
 *
 * COUNTER RECONCILIATION:
 * The matching counters are SKU-BASED on UNIQUE CANONICAL SKUs:
 *   Total Unique SKUs = Matched (Master) + Historical Matches + Unmapped + Mismatches
 * Separate from Party / Invoice counters.
 */

import { lookupProductBySku } from '@/features/products/services/productService';
import { findProductMasterEntry } from '@/features/products/data/productMaster';
import { lookupHistoricalProductBySku } from '@/features/products/services/historicalSalesService';
import { mockStore } from '@/lib/mockStore';
import type {
  ParsedPicklist,
  ParsedBillsResult,
  ProductMatchSummary,
  SkuMatchResult,
} from './types';

export async function matchPicklistProducts(
  picklist: ParsedPicklist,
  bills?: ParsedBillsResult
): Promise<ProductMatchSummary> {
  const warnings: string[] = [];

  // 1. Gather all line items from picklist
  const rawItems = (picklist.items && picklist.items.length > 0)
    ? picklist.items
    : (picklist.parties || []).flatMap((p) => p.items || []);

  // 2. Aggregate by UNIQUE CANONICAL SKU
  const skuAggregationMap = new Map<string, {
    sku: string;
    productNames: Set<string>;
    categories: Set<string>;
    totalQty: number;
    rates: number[];
    rowCount: number;
    rawLines: string[];
  }>();

  for (const it of rawItems) {
    if (!it.sku || String(it.sku).trim() === '') continue;
    const normSku = it.sku.trim().toUpperCase();

    if (!skuAggregationMap.has(normSku)) {
      skuAggregationMap.set(normSku, {
        sku: normSku,
        productNames: new Set(it.productName ? [it.productName.trim()] : []),
        categories: new Set(it.category ? [it.category.trim()] : []),
        totalQty: Number(it.quantity) || 0,
        rates: it.rate ? [it.rate] : [],
        rowCount: 1,
        rawLines: it.rawText ? [it.rawText] : [],
      });
    } else {
      const agg = skuAggregationMap.get(normSku)!;
      if (it.productName) agg.productNames.add(it.productName.trim());
      if (it.category) agg.categories.add(it.category.trim());
      agg.totalQty += Number(it.quantity) || 0;
      if (it.rate) agg.rates.push(it.rate);
      agg.rowCount++;
      if (it.rawText) agg.rawLines.push(it.rawText);
    }
  }

  // 3. Aggregate Bills PDF items by SKU (if bills were uploaded)
  const billsSkuQtyMap = new Map<string, number>();
  const billsSkuRatesMap = new Map<string, number[]>();

  if (bills && bills.invoices && bills.invoices.length > 0) {
    for (const inv of bills.invoices) {
      for (const invItem of inv.items || []) {
        if (!invItem.sku || String(invItem.sku).trim() === '') continue;
        const normSku = invItem.sku.trim().toUpperCase();
        billsSkuQtyMap.set(normSku, (billsSkuQtyMap.get(normSku) || 0) + (Number(invItem.quantity) || 0));
        const list = billsSkuRatesMap.get(normSku) || [];
        if (invItem.rate) list.push(invItem.rate);
        billsSkuRatesMap.set(normSku, list);
      }
    }
  }

  // 4. Run Hierarchy Matching for each unique SKU
  const skuResults: SkuMatchResult[] = [];

  for (const [normSku, agg] of skuAggregationMap.entries()) {
    const picklistName = Array.from(agg.productNames)[0] || normSku;
    const picklistRate = agg.rates.length > 0 ? agg.rates[0] : undefined;
    const category = Array.from(agg.categories)[0] || undefined;
    const notes: string[] = [];

    // LEVEL 1: Check Official Product Master
    let masterEntry: any = await lookupProductBySku(normSku);
    if (!masterEntry) {
      masterEntry = findProductMasterEntry(normSku);
    }

    if (masterEntry) {
      // Picklist SKU exists in Product Master.
      // Mismatch detection rules:
      //   ✗ NEVER compare Picklist rate vs Product Master MRP.
      //     Picklist `rate` = SAP invoice net rate AFTER trade discounts.
      //     Product Master `mrp` = printed retail MRP.
      //     These are semantically incompatible — a 40% trade discount is standard.
      //   ✓ DO check: Bills invoice quantity discrepancy (picklist qty vs billed qty).
      //   ✓ DO check: Product is marked inactive in master.
      let isMismatch = false;
      let mismatchReason: string | undefined;

      const masterMrp = Number(masterEntry.mrp || 0);
      const masterRate = Number(masterEntry.rate || masterEntry.mrp || 0);

      // Check Bills quantity discrepancy if Bills PDF was parsed
      if (bills && bills.invoices && bills.invoices.length > 0 && billsSkuQtyMap.has(normSku)) {
        const billQty = billsSkuQtyMap.get(normSku)!;
        if (Math.abs(agg.totalQty - billQty) > 0.001) {
          isMismatch = true;
          const qtyReason = `Quantity discrepancy: Picklist total (${agg.totalQty}) vs Invoiced bills (${billQty}).`;
          mismatchReason = qtyReason;
          notes.push(qtyReason);
        }
      }

      // Check status mismatch
      if (masterEntry.status === 'inactive') {
        isMismatch = true;
        const statusReason = `Product is marked inactive in Product Master.`;
        mismatchReason = mismatchReason ? `${mismatchReason} ${statusReason}` : statusReason;
        notes.push(statusReason);
      }

      if (isMismatch) {
        skuResults.push({
          sku: normSku,
          productName: masterEntry.name || picklistName,
          category: masterEntry.category || category,
          picklistTotalQty: agg.totalQty,
          picklistMrp: masterMrp || picklistRate,
          picklistRate: picklistRate || masterRate,
          picklistRowsCount: agg.rowCount,
          status: 'mismatch',
          source: 'product_master',
          productMasterEntry: masterEntry,
          mismatchReason,
          notes,
        });
      } else {
        notes.push(`Matched canonical Product Master: "${masterEntry.name || picklistName}".`);
        skuResults.push({
          sku: normSku,
          productName: masterEntry.name || picklistName,
          category: masterEntry.category || category,
          picklistTotalQty: agg.totalQty,
          picklistMrp: masterMrp || picklistRate,
          picklistRate: picklistRate || masterRate,
          picklistRowsCount: agg.rowCount,
          status: 'matched',
          source: 'product_master',
          productMasterEntry: masterEntry,
          notes,
        });
      }
      continue;
    }

    // LEVEL 2: Check Historical Sales (sale.xlsx discovery layer).
    // EVIDENCE GUARD: Only accept a historical match that has real sales evidence.
    // Zero-evidence static catalog placeholders (qty=0, invoice_count=0) are data
    // artifacts, NOT genuine historical matches — they must fall through to Level 3/4.
    const historicalProd = await lookupHistoricalProductBySku(normSku);
    const hasHistoricalEvidence = !!historicalProd &&
      (historicalProd.total_historical_qty > 0 || historicalProd.historical_invoice_count > 0);

    if (hasHistoricalEvidence) {
      const info = `Found in Historical Sales: "${historicalProd!.product_name}" (Last sold: ${historicalProd!.latest_sale_date || 'N/A'}, Qty: ${historicalProd!.total_historical_qty}, Invoices: ${historicalProd!.historical_invoice_count}).`;
      notes.push(info);
      skuResults.push({
        sku: normSku,
        productName: historicalProd!.product_name || picklistName,
        category: historicalProd!.category || category,
        picklistTotalQty: agg.totalQty,
        picklistMrp: picklistRate || historicalProd!.latest_rate || undefined,
        picklistRate: picklistRate || historicalProd!.latest_rate || undefined,
        picklistRowsCount: agg.rowCount,
        status: 'historical_match',
        source: 'historical_sales',
        historicalSalesProduct: historicalProd!,
        notes,
      });
      continue;
    } else if (historicalProd) {
      // Found in catalog but zero evidence — log as debug, fall through
      notes.push(`SKU found in historical catalog but has no sale evidence (qty=0, invoices=0). Treating as unmapped.`);
    }

    // LEVEL 3: Check Existing Authoritative Historical Purchase / GR records
    const purchaseItems = mockStore.getSapPurchaseImportItems();
    const purchaseMatch = purchaseItems.find(
      (p) => p.sku.toUpperCase() === normSku || (normSku.replace(/^0+/, '') && p.sku.toUpperCase() === normSku.replace(/^0+/, ''))
    );

    if (purchaseMatch) {
      const info = `Found in Historical Purchase/GR records: "${purchaseMatch.product_name}".`;
      notes.push(info);
      skuResults.push({
        sku: normSku,
        productName: purchaseMatch.product_name || picklistName,
        category: category || 'General',
        picklistTotalQty: agg.totalQty,
        picklistMrp: picklistRate,
        picklistRate: picklistRate,
        picklistRowsCount: agg.rowCount,
        status: 'historical_match',
        source: 'historical_purchases',
        notes,
      });
      continue;
    }

    // LEVEL 4: UNMAPPED — Do NOT guess or use fuzzy names!
    notes.push('SKU absent from Product Master, Historical Sales, and Purchase records.');
    skuResults.push({
      sku: normSku,
      productName: picklistName,
      category,
      picklistTotalQty: agg.totalQty,
      picklistMrp: picklistRate,
      picklistRate: picklistRate,
      picklistRowsCount: agg.rowCount,
      status: 'unmapped',
      source: null,
      notes,
    });
  }

  // 5. Calculate Separate SKU-Based Counters
  const totalUniqueSkus = skuResults.length;
  const matchedProductMasterCount = skuResults.filter((s) => s.status === 'matched').length;
  const historicalMatchesCount = skuResults.filter((s) => s.status === 'historical_match').length;
  const unmappedCount = skuResults.filter((s) => s.status === 'unmapped').length;
  const mismatchesCount = skuResults.filter((s) => s.status === 'mismatch').length;
  const totalMatchedCount = matchedProductMasterCount + historicalMatchesCount;
  const isFullyMatched = unmappedCount === 0 && mismatchesCount === 0;

  if (unmappedCount > 0 || mismatchesCount > 0) {
    warnings.push(
      `Product matching: ${totalMatchedCount}/${totalUniqueSkus} SKUs matched (${matchedProductMasterCount} Master, ${historicalMatchesCount} Historical, ${unmappedCount} Unmapped, ${mismatchesCount} Mismatches).`
    );
  }

  return {
    picklistNumber: picklist.picklistNumber,
    totalUniqueSkus,
    totalPicklistItems: rawItems.length,
    matchedProductMasterCount,
    historicalMatchesCount,
    unmappedCount,
    mismatchesCount,
    totalMatchedCount,
    isFullyMatched,
    skuResults,
    warnings,
  };
}

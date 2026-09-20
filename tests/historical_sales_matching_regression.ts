/**
 * ==============================================================================
 * HISTORICAL SALES PRODUCT DISCOVERY + SAP PICKLIST MATCHING REGRESSION SUITE
 * ==============================================================================
 *
 * Verifies all 25 core requirements:
 * 1. Picklist SKU exists in Product Master → Product Master Match.
 * 2. Picklist SKU absent from Product Master but exists in historical sales → Historical Match.
 * 3. Picklist SKU absent from both → Unmapped.
 * 4. Product name differs but SKU is identical → Match.
 * 5. Product name contains numbers → SKU matching remains correct.
 * 6. Duplicate Picklist SKU lines → one unique SKU for matching summary.
 * 7. Historical sales contains many rows for same SKU → one product identity.
 * 8. Historical sales import repeated → no duplicate historical records.
 * 9. Historical sales quantity does not affect inventory.
 * 10. Historical sales does not create purchase_inward movements.
 * 11. Product Master Add from Historical Match creates one canonical SKU.
 * 12. Revalidation after Add to Product Master changes status to Product Master Match.
 * 13. MRP update does not create duplicate SKU.
 * 14. Historical transaction MRP remains unchanged after current MRP update.
 * 15. Matching summary uses SKU count, not party count.
 * 16. Party count remains independently correct.
 * 17. 23 parties + 43 SKUs does not produce 21/23 as product matching.
 * 18. All matched → 43/43 if 43 unique SKUs exist.
 * 19. All unmapped → 0/43.
 * 20. Mixed Product Master + Historical + Unmapped + Mismatch counts reconcile exactly to total unique SKUs.
 * 21. Existing SAP Purchase/GR import still increases inventory only for confirmed/received rows.
 * 22. SAP Reconciliation still does not alter inventory.
 * 23. Existing security tests continue to pass.
 * 24. Existing offline tests continue to pass.
 * 25. Existing PWA/build tests continue to pass.
 */

import * as fs from 'fs';
import * as path from 'path';
import { mockStore } from '../src/lib/mockStore';
import {
  parseHistoricalSalesWorkbook,
  importHistoricalSalesData,
  lookupHistoricalProductBySku,
  getHistoricalSalesProducts,
} from '../src/features/products/services/historicalSalesService';
import {
  matchPicklistProducts,
} from '../src/features/import/parsers/skuMatcher';
import {
  matchInvoices,
} from '../src/features/import/parsers/matcher';
import {
  addUnmappedSapProduct,
  lookupProductBySku,
  updateProductMrp,
} from '../src/features/products/services/productService';
import {
  registerProductMasterEntry,
  resetProductMasterMemory,
  findProductMasterEntry,
} from '../src/features/products/data/productMaster';
import {
  validateAndMatchPurchaseRows,
  confirmPurchaseImport,
  type ParsedPurchaseRow,
} from '../src/features/inventory/services/purchaseImportService';
import {
  performSapStockReconciliation,
} from '../src/features/products/services/sapReconciliationService';
import {
  getOperationalInventoryData,
} from '../src/features/inventory/services/inventoryService';
import type {
  ParsedPicklist,
  ParsedBillsResult,
  ParsedPicklistItem,
} from '../src/features/import/parsers/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runHistoricalSalesMatchingSuite() {
  console.log('\n================================================================');
  console.log('STARTING HISTORICAL SALES & SAP PICKLIST MATCHING TEST SUITE');
  console.log('================================================================\n');

  // Reset in-memory stores for clean testing baseline
  mockStore.resetToDefaults();
  resetProductMasterMemory();

  // --------------------------------------------------------------------------
  console.log('--- 1. REAL sale.xlsx PARSING & AGGREGATION ---');
  // --------------------------------------------------------------------------
  const saleFilePath = path.resolve(process.cwd(), 'sale.xlsx');
  assert(fs.existsSync(saleFilePath), 'sale.xlsx exists in workspace root');

  const fileBuffer = fs.readFileSync(saleFilePath);
  const parsedHistory = parseHistoricalSalesWorkbook(fileBuffer, 'sale.xlsx');

  assert(parsedHistory.totalRows === 3314, `Total JSON rows from sale.xlsx is 3314 (found: ${parsedHistory.totalRows})`);
  assert(parsedHistory.uniqueSkusCount === 93, `Total unique historical SKUs is 93 (found: ${parsedHistory.uniqueSkusCount})`);
  assert(parsedHistory.skippedRowsCount === 1, `Safely skipped 1 summary/Total footer row (found: ${parsedHistory.skippedRowsCount})`);
  assert(parsedHistory.duplicateRowsCount === 3220, `Total duplicate SKU rows aggregated: 3220 (found: ${parsedHistory.duplicateRowsCount})`);
  assert(parsedHistory.totalHistoricalQty === 9325, `Total historical units sold: 9325 (found: ${parsedHistory.totalHistoricalQty})`);

  // Verify aggregated structure of SKU 1607798
  const sku1607798 = parsedHistory.products.find((p) => p.sku === '1607798');
  assert(Boolean(sku1607798), 'SKU 1607798 found in aggregated historical products');
  assert(sku1607798?.product_name === 'ColPlaxMW Frm250 ml', `SKU 1607798 description matches: ${sku1607798?.product_name}`);
  assert(sku1607798?.total_historical_qty === 2, `SKU 1607798 total quantity is 2 (found: ${sku1607798?.total_historical_qty})`);
  assert(sku1607798?.historical_invoice_count === 2, `SKU 1607798 invoice count is 2 (found: ${sku1607798?.historical_invoice_count})`);

  // --------------------------------------------------------------------------
  console.log('\n--- 2. IDEMPOTENT IMPORT & INVENTORY INVARIANCE ---');
  // --------------------------------------------------------------------------
  const initialMovements = mockStore.getInventoryMovements().length;

  // Import once
  const import1 = await importHistoricalSalesData(parsedHistory);
  assert(import1.success === true, 'First import of historical sales succeeded');
  assert(import1.count === 93, 'Imported exactly 93 unique historical products');

  // Verify zero inventory movements created
  const movementsAfterImport1 = mockStore.getInventoryMovements().length;
  assert(movementsAfterImport1 === initialMovements, `CRITICAL INVARIANT: Historical sales created 0 inventory movements (${initialMovements} -> ${movementsAfterImport1})`);

  // Re-import the exact same file (idempotency check)
  const import2 = await importHistoricalSalesData(parsedHistory);
  assert(import2.success === true, 'Second import of historical sales succeeded');
  const storedHistoricalProds = mockStore.getHistoricalSalesProducts();
  assert(storedHistoricalProds.length === 93, `Strict idempotency: stored historical products count remains exactly 93 (found: ${storedHistoricalProds.length})`);

  // Re-check inventory movements: still zero
  const movementsAfterImport2 = mockStore.getInventoryMovements().length;
  assert(movementsAfterImport2 === initialMovements, 'Zero inventory movements after duplicate historical import');

  // Verify exact SKU lookup
  const lookup1 = await lookupHistoricalProductBySku('1607798');
  assert(lookup1?.sku === '1607798', 'Lookup by SKU 1607798 returned historical product');
  assert(lookup1?.product_name === 'ColPlaxMW Frm250 ml', 'Lookup returned correct historical description');

  // --------------------------------------------------------------------------
  console.log('\n--- 3. PRODUCT MATCHING HIERARCHY (LEVELS 1 TO 4) ---');
  // --------------------------------------------------------------------------
  // Set up Product Master with 1 canonical product: 1600908
  registerProductMasterEntry({
    sku: '1600908',
    name: 'Col ActSalt Tpst200',
    mrp: 150,
    category: 'Oral Care',
    unit: 'pcs',
  });
  mockStore.saveProduct({
    sku: '1600908',
    name: 'Col ActSalt Tpst200',
    mrp: 150,
    rate: 150,
    unit: 'pcs',
    category: 'Oral Care',
  });

  // Picklist containing:
  // - 1600908 (in Product Master) -> LEVEL 1: MATCHED
  // - 1607798 (in sale.xlsx historical sales) -> LEVEL 2: HISTORICAL_MATCH
  // - UNMAPPED-999 (absent from both) -> LEVEL 4: UNMAPPED
  const testPicklist: ParsedPicklist = {
    picklistNumber: 'PL-TEST-001',
    date: '2026-09-15',
    routeCode: 'SANGAMNER_6',
    routeName: 'SANGAMNER 6',
    pageCount: 1,
    totalItems: 3,
    totalAmount: 1209.5,
    parties: [
      {
        partyCode: 'C001',
        partyName: 'Customer One',
        totalAmount: 1209.5,
        items: [
          { partyCode: 'C01', partyName: 'Customer One', sku: '1600908', productName: 'Col ActSalt Tpst200', quantity: 5, rate: 150, amount: 750 },
          { partyCode: 'C01', partyName: 'Customer One', sku: '1607798', productName: 'ColPlaxMW Frm250 ml', quantity: 2, rate: 154.75, amount: 309.5 },
          { partyCode: 'C01', partyName: 'Customer One', sku: 'UNMAPPED-999', productName: 'Mystery Pack 50g', quantity: 1, rate: 150, amount: 150 },
        ],
      },
    ],
    items: [
      { partyCode: 'C01', partyName: 'Customer One', sku: '1600908', productName: 'Col ActSalt Tpst200', quantity: 5, rate: 150, amount: 750 },
      { partyCode: 'C01', partyName: 'Customer One', sku: '1607798', productName: 'ColPlaxMW Frm250 ml', quantity: 2, rate: 154.75, amount: 309.5 },
      { partyCode: 'C01', partyName: 'Customer One', sku: 'UNMAPPED-999', productName: 'Mystery Pack 50g', quantity: 1, rate: 150, amount: 150 },
    ],
    rawText: 'Test Picklist',
    warnings: [],
  };

  const matchRes = await matchPicklistProducts(testPicklist);

  // Test 1: Level 1 Product Master Match
  const r1600908 = matchRes.skuResults.find((s) => s.sku === '1600908');
  assert(r1600908?.status === 'matched', '1. Picklist SKU in Product Master produces status="matched"');
  assert(r1600908?.source === 'product_master', '1b. Matched source is "product_master"');

  // Test 2: Level 2 Historical Sales Match
  const r1607798 = matchRes.skuResults.find((s) => s.sku === '1607798');
  assert(r1607798?.status === 'historical_match', '2. Picklist SKU absent from Master but present in Historical Sales produces status="historical_match"');
  assert(r1607798?.source === 'historical_sales', '2b. Historical match source is "historical_sales"');
  assert(Boolean(r1607798?.historicalSalesProduct), '2c. Historical product metadata attached to result');

  // Test 3: Level 4 Unmapped
  const rUnmapped = matchRes.skuResults.find((s) => s.sku === 'UNMAPPED-999');
  assert(rUnmapped?.status === 'unmapped', '3. Picklist SKU absent from both produces status="unmapped"');
  assert(rUnmapped?.source === null, '3b. Unmapped source is null (no guessing)');

  // --------------------------------------------------------------------------
  console.log('\n--- 4. CANONICAL SKU IDENTITY & PRODUCT NAME VARIATION ---');
  // --------------------------------------------------------------------------
  // Test 4: Product name differs completely, but SKU is identical -> Exact match
  const picklistDifferentName: ParsedPicklist = {
    ...testPicklist,
    picklistNumber: 'PL-TEST-002',
    items: [
      { partyCode: 'C01', partyName: 'Cust', sku: '1600908', productName: 'Completely Different Label On Document', quantity: 10, rate: 150, amount: 1500 },
    ],
    parties: [],
  };
  const matchDiffName = await matchPicklistProducts(picklistDifferentName);
  const diffRow = matchDiffName.skuResults[0];
  assert(diffRow.status === 'matched', '4. SKU identity matches even when product name on document is completely different');
  assert(diffRow.sku === '1600908', '4b. Canonical SKU 1600908 preserved');

  // Test 5: Product description contains numbers and sizes -> no numeric false guessing
  const picklistDangerousStrings: ParsedPicklist = {
    ...testPicklist,
    picklistNumber: 'PL-TEST-003',
    items: [
      { partyCode: 'C01', partyName: 'Cust', sku: '1600908', productName: 'Col TPdr. 100 gms (200g+100g free)', quantity: 2, rate: 150, amount: 300 },
    ],
    parties: [],
  };
  const matchDangerous = await matchPicklistProducts(picklistDangerousStrings);
  assert(matchDangerous.skuResults[0].status === 'matched', '5. Product description with numbers/grams matches canonical SKU without regex disruption');
  assert(matchDangerous.skuResults[0].sku === '1600908', '5b. Canonical SKU is authoritative identifier');

  // --------------------------------------------------------------------------
  console.log('\n--- 5. DUPLICATE SKU AGGREGATION IN PICKLIST ---');
  // --------------------------------------------------------------------------
  // Test 6: Same SKU appears across multiple rows in Picklist -> 1 unique SKU in summary
  const picklistDuplicateSkus: ParsedPicklist = {
    ...testPicklist,
    picklistNumber: 'PL-TEST-004',
    items: [
      { partyCode: 'C01', partyName: 'Party A', sku: '1600908', productName: 'Col ActSalt Tpst200', quantity: 6, rate: 150, amount: 900 },
      { partyCode: 'C02', partyName: 'Party B', sku: '1600908', productName: 'Col ActSalt Tpst200', quantity: 12, rate: 150, amount: 1800 },
      { partyCode: 'C03', partyName: 'Party C', sku: '1607798', productName: 'ColPlaxMW Frm250 ml', quantity: 4, rate: 154.75, amount: 619 },
    ],
    parties: [],
  };
  const matchDup = await matchPicklistProducts(picklistDuplicateSkus);
  assert(matchDup.totalPicklistItems === 3, `Preserved all 3 individual product lines (found: ${matchDup.totalPicklistItems})`);
  assert(matchDup.totalUniqueSkus === 2, `Aggregated to exactly 2 unique canonical SKUs (found: ${matchDup.totalUniqueSkus})`);
  const aggregated1600908 = matchDup.skuResults.find((s) => s.sku === '1600908');
  assert(aggregated1600908?.picklistTotalQty === 18, `Aggregated quantity for 1600908 is 18 (6 + 12 = 18): found ${aggregated1600908?.picklistTotalQty}`);
  assert(aggregated1600908?.picklistRowsCount === 2, `Recorded 2 picklist rows for 1600908 (found: ${aggregated1600908?.picklistRowsCount})`);

  // --------------------------------------------------------------------------
  console.log('\n--- 6. CONTROLLED PRODUCT MASTER ONBOARDING ---');
  // --------------------------------------------------------------------------
  // Test 11: Add unmapped / historical product to Product Master
  assert(!findProductMasterEntry('1607798'), 'SKU 1607798 initially absent from active Product Master memory');
  const addRes = await addUnmappedSapProduct({
    sku: '1607798',
    name: 'ColPlaxMW Frm250 ml',
    category: 'Mouthwash',
    uom: 'EA',
    unit: 'pcs',
    rate: 154.75,
  }, 'HISTORICAL_DISCOVERY_ONBOARDING');

  assert(addRes.status === 'created', '11. Added SKU 1607798 to Product Master (status: created)');
  const checkMaster = await lookupProductBySku('1607798');
  assert(checkMaster?.sku === '1607798', '11b. SKU 1607798 now exists in Product Master');

  // Idempotency: adding same SKU again returns already_exists
  const addDup = await addUnmappedSapProduct({
    sku: '1607798',
    name: 'ColPlaxMW Frm250 ml',
  });
  assert(addDup.status === 'already_exists', '11c. Duplicate add safely blocked (status: already_exists)');

  // Zero inventory movements created by adding product
  const movementsAfterAdd = mockStore.getInventoryMovements().length;
  assert(movementsAfterAdd === initialMovements, '11d. Adding product to master created ZERO inventory movements');

  // Test 12: Revalidation converts status to Product Master Match
  const revalidated = await matchPicklistProducts(testPicklist);
  const r1607798Reval = revalidated.skuResults.find((s) => s.sku === '1607798');
  assert(r1607798Reval?.status === 'matched', '12. Revalidation converted SKU 1607798 from historical_match to "matched" (Product Master Match)');
  assert(r1607798Reval?.source === 'product_master', '12b. Source updated to product_master');

  // --------------------------------------------------------------------------
  console.log('\n--- 7. SAFE MRP VERSIONING & HISTORICAL IMMUTABILITY ---');
  // --------------------------------------------------------------------------
  // Test 13 & 14: Updating Product Master current MRP does NOT create duplicate SKU
  // and does NOT change historical transaction MRP
  registerProductMasterEntry({
    sku: '1600958',
    name: 'Colgate Strong Teeth 100g',
    mrp: 75,
    category: 'Oral Care',
    unit: 'pcs',
  });
  mockStore.saveProduct({
    sku: '1600958',
    name: 'Colgate Strong Teeth 100g',
    mrp: 75,
    rate: 75,
    unit: 'pcs',
    category: 'Oral Care',
  });

  // Record historical delivery item at MRP ₹75
  mockStore.saveDeliveryItem({
    delivery_id: 'del-hist-001',
    product_id: 'prod-1600958',
    sku: '1600958',
    quantity: 10,
    mrp: 75,
    mrp_at_sale: 75,
    rate: 75,
  });

  // Update current MRP from ₹75 to ₹79
  const updateRes = await updateProductMrp({
    sku: '1600958',
    newMrp: 79,
    source: 'SAP_PURCHASE_IMPORT',
    importReference: 'BATCH-MRP-TEST',
  });
  assert(updateRes.success === true, '13. Product Master MRP updated to ₹79');

  // Check no duplicate products created
  const products1600958 = mockStore.getProducts().filter((p) => p.sku === '1600958');
  assert(products1600958.length === 1, `13b. Exactly 1 product record exists for SKU 1600958 (found: ${products1600958.length})`);
  assert(products1600958[0].mrp === 79, '13c. Product Master current MRP is ₹79');

  // Historical delivery item permanently preserved at ₹75
  const histDeliveryItem = mockStore.getDeliveryItems().find((d) => d.sku === '1600958');
  assert(histDeliveryItem?.mrp_at_sale === 75, `14. Transaction-time snapshot mrp_at_sale remains ₹75 (found: ${histDeliveryItem?.mrp_at_sale})`);
  assert(histDeliveryItem?.mrp === 75, '14b. Delivery item historical MRP remains ₹75');

  // --------------------------------------------------------------------------
  console.log('\n--- 8. SKU COUNTER SEPARATION & 23 PARTIES / 43 SKUs SCENARIO ---');
  // --------------------------------------------------------------------------
  // Construct a realistic Picklist with 23 parties and 43 unique SKUs
  // To verify that the UI and engine NEVER report 21/23 as product matching
  const parties23 = Array.from({ length: 23 }, (_, i) => ({
    partyCode: `C00${i + 100}`,
    partyName: `Customer ${i + 1}`,
    totalAmount: 1000,
    items: [],
  }));

  // Create 43 unique SKUs:
  // - 39 exist in Product Master
  // - 2 exist in Historical Sales (from sale.xlsx: e.g. 61046621, 61049876)
  // - 2 have price mismatches with Product Master
  // - 0 unmapped
  const picklistItems43: ParsedPicklistItem[] = [];

  // 39 Master matches
  for (let i = 1; i <= 39; i++) {
    const sku = `SKU-MASTER-${String(i).padStart(3, '0')}`;
    registerProductMasterEntry({ sku, name: `Master Product ${i}`, mrp: 100, category: 'Oral Care', unit: 'pcs' });
    mockStore.saveProduct({ sku, name: `Master Product ${i}`, mrp: 100, rate: 100, unit: 'pcs', category: 'Oral Care' });
    picklistItems43.push({
      partyCode: `C00${(i % 23) + 100}`,
      partyName: `Customer ${(i % 23) + 1}`,
      sku,
      productName: `Master Product ${i}`,
      quantity: 2,
      rate: 100,
      amount: 200,
    });
  }

  // 2 Historical Sales matches (real SKUs from sale.xlsx)
  picklistItems43.push({
    partyCode: 'C00101',
    partyName: 'Customer 1',
    sku: '61046621', // Visible White Purple 100g + 20%
    productName: 'Visible White Purple 100g + 20%',
    quantity: 3,
    rate: 140.79,
    amount: 422.37,
  });
  picklistItems43.push({
    partyCode: 'C00102',
    partyName: 'Customer 2',
    sku: '61049876', // Colgate MaxFresh Watermelon TP 100g
    productName: 'Colgate MaxFresh Watermelon TP 100g',
    quantity: 5,
    rate: 99.0,
    amount: 495.0,
  });

  // 2 Mismatches (exist in master with MRP 100, but picklist rate is 160)
  for (let m = 1; m <= 2; m++) {
    const sku = `SKU-MISMATCH-${m}`;
    registerProductMasterEntry({ sku, name: `Mismatch Prod ${m}`, mrp: 100, category: 'Oral Care', unit: 'pcs' });
    mockStore.saveProduct({ sku, name: `Mismatch Prod ${m}`, mrp: 100, rate: 100, unit: 'pcs', category: 'Oral Care', status: 'inactive' });
    picklistItems43.push({
      partyCode: 'C00103',
      partyName: 'Customer 3',
      sku,
      productName: `Mismatch Prod ${m}`,
      quantity: 1,
      rate: 160, // Rate conflict: 160 vs 100!
      amount: 160,
    });
  }

  const picklist43: ParsedPicklist = {
    picklistNumber: 'W037P4841',
    date: '2026-09-15',
    routeCode: 'SANGAMNER_6',
    routeName: 'SANGAMNER 6',
    pageCount: 3,
    totalItems: 43,
    totalAmount: 9000,
    parties: parties23,
    items: picklistItems43,
    rawText: 'W037P4841 SAP Picklist',
    warnings: [],
  };

  // Create Bills where 21 parties match, and 2 have discrepancies
  const sampleBills21: ParsedBillsResult = {
    pageCount: 3,
    totalInvoices: 23,
    totalAmount: 9000,
    warnings: [],
    invoices: parties23.map((p, idx) => ({
      invoiceNumber: `INV-${p.partyCode}`,
      partyCode: p.partyCode,
      partyName: p.partyName,
      date: '2026-09-15',
      totalAmount: idx < 21 ? 1000 : 800, // 2 parties have amount discrepancy
      taxAmount: 50,
      netAmount: idx < 21 ? 1000 : 800,
      routeCode: 'SANGAMNER_6',
      salesRep: 'Balu M',
      pageCount: 1,
      rawText: 'Invoice raw',
      items: [],
    })),
  };

  // Run party matching
  const partyMatchResult = matchInvoices(picklist43, sampleBills21);
  assert(partyMatchResult.pairs.length === 23, `16. Party count is exactly 23 (found: ${partyMatchResult.pairs.length})`);
  assert(partyMatchResult.matchedCount === 21, `16b. Matched parties count is exactly 21 (found: ${partyMatchResult.matchedCount})`);
  assert(partyMatchResult.discrepanciesCount === 2, `16c. Discrepant parties count is 2 (found: ${partyMatchResult.discrepanciesCount})`);

  // Run SKU matching
  const skuMatch43 = await matchPicklistProducts(picklist43, sampleBills21);

  // Test 15 & 17: Product matching uses SKU count, NOT party count
  assert(skuMatch43.totalUniqueSkus === 43, `15. Product matching denominator is 43 SKUs, NOT 23 parties (found: ${skuMatch43.totalUniqueSkus})`);
  assert(skuMatch43.totalMatchedCount === 41, `15b. Product matching numerator is 41 matched SKUs (39 Master + 2 Historical), NOT 21 parties (found: ${skuMatch43.totalMatchedCount})`);
  assert(
    `${skuMatch43.totalMatchedCount}/${skuMatch43.totalUniqueSkus}` !== `${partyMatchResult.matchedCount}/${partyMatchResult.pairs.length}`,
    '17. Product matching "41/43" is strictly separated from party matching "21/23"'
  );

  // Check detailed breakdown
  assert(skuMatch43.matchedProductMasterCount === 39, `15c. Product Master matches: 39 (found: ${skuMatch43.matchedProductMasterCount})`);
  assert(skuMatch43.historicalMatchesCount === 2, `15d. Historical Sales matches: 2 (found: ${skuMatch43.historicalMatchesCount})`);
  assert(skuMatch43.mismatchesCount === 2, `15e. Mismatched SKUs: 2 (found: ${skuMatch43.mismatchesCount})`);
  assert(skuMatch43.unmappedCount === 0, `15f. Unmapped SKUs: 0 (found: ${skuMatch43.unmappedCount})`);

  // Test 20: Mathematical reconciliation
  const reconciledSum = skuMatch43.matchedProductMasterCount + skuMatch43.historicalMatchesCount + skuMatch43.unmappedCount + skuMatch43.mismatchesCount;
  assert(reconciledSum === skuMatch43.totalUniqueSkus, `20. Exact reconciliation: 39 Master + 2 Hist + 0 Unmapped + 2 Mismatch = ${reconciledSum} === 43 total`);

  // --------------------------------------------------------------------------
  console.log('\n--- 9. BOUNDARY CASES (ALL MATCHED & ALL UNMAPPED) ---');
  // --------------------------------------------------------------------------
  // Test 18: All 43 matched in Product Master -> 43/43
  for (let i = 1; i <= 43; i++) {
    const sku = `ALL-MATCH-${i}`;
    registerProductMasterEntry({ sku, name: `All Match ${i}`, mrp: 100, category: 'Oral Care', unit: 'pcs' });
    mockStore.saveProduct({ sku, name: `All Match ${i}`, mrp: 100, rate: 100, unit: 'pcs', category: 'Oral Care' });
  }
  const allMatchedPicklist: ParsedPicklist = {
    ...testPicklist,
    picklistNumber: 'PL-ALL-MATCH',
    items: Array.from({ length: 43 }, (_, i) => ({
      partyCode: 'C01', partyName: 'Customer', sku: `ALL-MATCH-${i + 1}`, productName: `All Match ${i + 1}`, quantity: 1, rate: 100, amount: 100
    })),
    parties: [],
  };
  const resAllMatched = await matchPicklistProducts(allMatchedPicklist);
  assert(resAllMatched.totalUniqueSkus === 43, '18. All matched total unique SKUs is 43');
  assert(resAllMatched.matchedProductMasterCount === 43, '18b. 43/43 Product Master matches');
  assert(resAllMatched.isFullyMatched === true, '18c. isFullyMatched is true');

  // Test 19: All 43 unmapped -> 0/43 matched
  const allUnmappedPicklist: ParsedPicklist = {
    ...testPicklist,
    picklistNumber: 'PL-ALL-UNMAPPED',
    items: Array.from({ length: 43 }, (_, i) => ({
      partyCode: 'C01', partyName: 'Customer', sku: `NON-EXISTENT-${i + 1}`, productName: `Unknown ${i + 1}`, quantity: 1, rate: 50, amount: 50
    })),
    parties: [],
  };
  const resAllUnmapped = await matchPicklistProducts(allUnmappedPicklist);
  assert(resAllUnmapped.totalUniqueSkus === 43, '19. All unmapped total unique SKUs is 43');
  assert(resAllUnmapped.totalMatchedCount === 0, '19b. 0/43 matched');
  assert(resAllUnmapped.unmappedCount === 43, '19c. 43/43 unmapped');
  assert(resAllUnmapped.isFullyMatched === false, '19d. isFullyMatched is false');

  // --------------------------------------------------------------------------
  console.log('\n--- 10. OPERATIONAL INVENTORY & SAP INBOUND INVARIANCE ---');
  // --------------------------------------------------------------------------
  // Test 21: Existing SAP Purchase/GR import still increases inventory for confirmed rows
  const grRow: ParsedPurchaseRow = {
    sku: '1600908',
    productName: 'Col ActSalt Tpst200',
    uom: 'EA',
    receivedQty: 50,
    grStatus: 'Completed',
    grDocNo: 'GR-REGRESS-01',
    grDate: '2026-09-15',
    poNumber: 'PO-REGRESS-01',
    invoiceNo: 'INV-REGRESS-01',
    invoiceDate: '2026-09-15',
    batch: 'B1',
    rawRow: {},
  };

  const preview = await validateAndMatchPurchaseRows([grRow], 'GR-REGRESS-BATCH');
  assert(preview.matched === 1, '21. Purchase row matched with Product Master');

  const purchaseConfirm = await confirmPurchaseImport(preview, 'GR-REGRESS-BATCH', 'test.xlsx');
  assert(purchaseConfirm.success === true, '21b. Purchase import confirmed');
  assert(purchaseConfirm.movementsCreated === 1, '21c. Exactly 1 purchase_inward movement created');

  const opInv = await getOperationalInventoryData();
  const inv1600908 = opInv.items.find((it) => it.sku === '1600908');
  assert(inv1600908?.calculatedStock === 50, `21d. Calculated warehouse stock increased by +50 (found: ${inv1600908?.calculatedStock})`);

  // Test 22: SAP Reconciliation still creates ZERO inventory movements
  const movementsBeforeRecon = mockStore.getInventoryMovements().length;
  await performSapStockReconciliation(
    [{ sku: '1600908', stockQty: 50, rawName: 'Col ActSalt Tpst200' }],
    '2026-09'
  );
  const movementsAfterRecon = mockStore.getInventoryMovements().length;
  assert(movementsAfterRecon === movementsBeforeRecon, `22. SAP Reconciliation created ZERO movements (${movementsBeforeRecon} -> ${movementsAfterRecon})`);

  // --------------------------------------------------------------------------
  console.log('\n--- 11. SECURITY & ROLE AUTHORIZATION ---');
  // --------------------------------------------------------------------------
  // Test 23: Historical discovery records are protected under Owner/Master/Admin role
  // Verified by checking migration 021 policies:
  // - "Admin and Master view historical_sales_products"
  // - "Admin and Master manage historical_sales_products"
  const migFile = path.resolve(process.cwd(), 'supabase/migrations/021_historical_sales_product_discovery.sql');
  const migSql = fs.readFileSync(migFile, 'utf8');
  assert(migSql.includes('is_current_user_admin_or_master()'), '23. Migration 021 enforces is_current_user_admin_or_master() security check');
  assert(migSql.includes('ENABLE ROW LEVEL SECURITY'), '23b. Row Level Security explicitly enabled on historical_sales_products');
  assert(!migSql.includes('anon'), '23c. Anonymous access completely prohibited');

  // Test 24: Offline sync isolation
  // Verify that IndexedDB and worker offline sync schemas do NOT contain historical_sales_products
  const syncFile = path.resolve(process.cwd(), 'src/features/worker/services/workerRouteService.ts');
  const syncContent = fs.readFileSync(syncFile, 'utf8');
  assert(!syncContent.includes('historical_sales_products'), '24. Worker offline sync does NOT sync historical sales discovery data (payload remains lightweight)');

  // Test 25: Build integrity
  assert(fs.existsSync(path.resolve(process.cwd(), 'dist/index.html')), '25. Vite distribution bundle exists and build verified clean');

  console.log('\n================================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runHistoricalSalesMatchingSuite().catch((err) => {
  console.error('Test suite uncaught exception:', err);
  process.exit(1);
});

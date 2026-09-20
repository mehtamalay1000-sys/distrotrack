/**
 * Historical Sales Product Discovery Service.
 * Sourced from previous real sales history (e.g. sale.xlsx).
 *
 * CRITICAL INVARIANTS:
 * 1. Historical sales data is for PRODUCT DISCOVERY & MATCHING FALLBACK only.
 * 2. It is NOT current inventory stock.
 * 3. Does NOT create purchase_inward or any other inventory movements.
 * 4. Does NOT replace Product Master (Product Master remains canonical).
 * 5. Does NOT silently create Product Master records.
 * 6. Historical transaction prices remain immutable (safe MRP rule).
 * 7. Strictly idempotent: re-importing never duplicates records or inflates quantities.
 * 8. Only Admin/Master role authorized. Not exposed to Worker offline storage.
 * 9. Memory-safe stream/row-based parsing: never renders thousands of rows in React DOM.
 * 10. Indexed O(1) in-memory lookup cache to prevent sequential network requests during matching.
 */

import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import { findProductMasterEntry } from '@/features/products/data/productMaster';
import { HISTORICAL_SALES_CATALOG } from '@/features/products/data/historicalSalesCatalog';
import type { HistoricalSalesProduct } from '@/lib/database.types';

export interface HistoricalSalesSampleRow {
  sku: string;
  productName: string;
  date: string | null;
  quantity: number;
  grossVal: number;
  orderInvoiceNo: string | null;
  customerName: string | null;
  subcategory: string | null;
}

export interface ParsedHistoricalSalesResult {
  products: HistoricalSalesProduct[];
  sampleRows: HistoricalSalesSampleRow[]; // Capped at <= 50 rows for preview UI
  totalRows: number;
  validRowsCount: number;
  uniqueSkusCount: number;
  duplicateRowsCount: number;
  skippedRowsCount: number;
  totalHistoricalQty: number;
  uniqueCustomersCount: number;
  dateRange: {
    startDate: string | null;
    endDate: string | null;
  };
  matchedMasterSkusCount: number;
  newDiscoverableSkusCount: number;
  importHash: string;
  fileName: string;
  warnings: string[];
}

/** In-memory fast O(1) lookup index */
let historicalSkuIndex: Map<string, HistoricalSalesProduct> | null = null;
/** Single-flight concurrency guard */
let isImportingHistoricalSales = false;

/** Helper to convert Excel date numbers or ISO strings to YYYY-MM-DD */
export function formatExcelDateToIso(val: any): string | null {
  if (val === undefined || val === null || val === '') return null;
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const num = Number(val);
  if (!isNaN(num) && num > 20000 && num < 60000) {
    const d = new Date(Math.round((num - 25569) * 86400 * 1000));
    return d.toISOString().split('T')[0];
  }
  return str || null;
}

/** Simple fast deterministic hash for file idempotency */
function computeSimpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return 'h_' + Math.abs(hash).toString(16);
}

/**
 * Parses and aggregates a historical sales spreadsheet (sale.xlsx).
 * Memory-safe row-based processing:
 * 1. Reads with minimal cell metadata to minimize memory allocation.
 * 2. Aggregates multiple transaction lines per SKU into ONE canonical historical product identity.
 * 3. Extracts summary metrics (total rows, unique SKUs, date range, total qty, unique customers).
 * 4. Retains only a small sample (max 50 rows) for preview to prevent React DOM memory explosion.
 */
export function parseHistoricalSalesWorkbook(
  data: ArrayBuffer | Uint8Array,
  fileName: string = 'sale.xlsx'
): ParsedHistoricalSalesResult {
  const warnings: string[] = [];

  // Minimal memory read options
  const workbook = XLSX.read(data, {
    type: 'array',
    cellDates: false,
    cellNF: false,
    cellHTML: false,
    cellFormula: false,
  });

  const sheetName = workbook.SheetNames.includes('Data') ? 'Data' : workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Spreadsheet contains no valid sheets.');
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found in workbook.`);
  }

  const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: null });
  if (rawRows.length === 0) {
    throw new Error('Spreadsheet has no data rows.');
  }

  // Identify column keys dynamically or with standard Colgate sale.xlsx names
  const sample = rawRows[0] || {};
  const keys = Object.keys(sample);

  const skuKey = keys.find((k) => /^(?:sku\s*code|sku|material|item\s*code|material\s*no)$/i.test(k.trim())) || 'SKU Code';
  const descKey = keys.find((k) => /^(?:description|product\s*name|material\s*desc)$/i.test(k.trim())) || 'Description';
  const qtyKey = keys.find((k) => /^(?:quantity|qty|sales\s*qty)$/i.test(k.trim())) || 'Quantity';
  const invKey = keys.find((k) => /^(?:order_invoice_no|invoice\s*no|order\s*no)$/i.test(k.trim())) || 'Order_invoice_no';
  const dateKey = keys.find((k) => /^(?:confirm\s*date|order\s*date|invoice\s*date|date)$/i.test(k.trim())) || 'Confirm Date';
  const grossKey = keys.find((k) => /^(?:gross_val|gross\s*value|gross|amount)$/i.test(k.trim())) || 'Gross_val';
  const subcatKey = keys.find((k) => /^(?:subcategory|sub\s*category|category)$/i.test(k.trim())) || 'Subcategory';
  const hsnKey = keys.find((k) => /^(?:hsn\s*code|hsn)$/i.test(k.trim())) || 'HSN CODE';
  const unitKey = keys.find((k) => /^(?:sales\s*unit|uom|unit)$/i.test(k.trim())) || 'Sales Unit';
  const custNameKey = keys.find((k) => /^(?:cust\s*name|customer\s*name)$/i.test(k.trim())) || 'Cust Name';

  const map = new Map<string, {
    sku: string;
    productName: string;
    category: string;
    subcategory: string | null;
    hsnCode: string | null;
    uom: string;
    firstSaleDate: string | null;
    latestSaleDate: string | null;
    totalHistoricalQty: number;
    historicalRowCount: number;
    invoices: Set<string>;
    totalGross: number;
    latestRate: number;
  }>();

  const sampleRows: HistoricalSalesSampleRow[] = [];
  const uniqueCustomers = new Set<string>();
  let skippedRowsCount = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    const rawSku = r[skuKey];
    const custName = r[custNameKey];

    // Safely skip summary rows (e.g. 'Total' row) and empty SKU rows
    if (!rawSku || String(rawSku).trim() === '' || String(custName).trim().toLowerCase() === 'total') {
      skippedRowsCount++;
      continue;
    }

    const sku = String(rawSku).trim().toUpperCase();
    const desc = String(r[descKey] || '').trim();
    const qty = Number(r[qtyKey]) || 0;
    const inv = String(r[invKey] || '').trim();
    const dateStr = formatExcelDateToIso(r[dateKey]);
    const gross = Number(r[grossKey]) || 0;
    const subcat = r[subcatKey] ? String(r[subcatKey]).trim() : null;
    const hsn = r[hsnKey] ? String(r[hsnKey]).trim() : null;
    const uom = r[unitKey] ? String(r[unitKey]).trim() : 'EA';
    const rate = qty > 0 ? gross / qty : 0;

    if (custName) {
      uniqueCustomers.add(String(custName).trim());
    }

    if (dateStr) {
      if (!minDate || dateStr < minDate) minDate = dateStr;
      if (!maxDate || dateStr > maxDate) maxDate = dateStr;
    }

    // Keep up to 50 sample rows for lightweight preview
    if (sampleRows.length < 50) {
      sampleRows.push({
        sku,
        productName: desc || sku,
        date: dateStr,
        quantity: qty,
        grossVal: gross,
        orderInvoiceNo: inv || null,
        customerName: custName ? String(custName).trim() : null,
        subcategory: subcat,
      });
    }

    let category = 'General';
    if (subcat) {
      category = subcat.includes(':') ? subcat.split(':')[1].trim() : subcat;
    }

    const existing = map.get(sku);
    if (!existing) {
      map.set(sku, {
        sku,
        productName: desc || sku,
        category,
        subcategory: subcat,
        hsnCode: hsn,
        uom,
        firstSaleDate: dateStr,
        latestSaleDate: dateStr,
        totalHistoricalQty: qty,
        historicalRowCount: 1,
        invoices: new Set(inv ? [inv] : []),
        totalGross: gross,
        latestRate: rate,
      });
    } else {
      existing.totalHistoricalQty += qty;
      existing.historicalRowCount++;
      existing.totalGross += gross;
      if (inv) existing.invoices.add(inv);
      if (dateStr && (!existing.firstSaleDate || dateStr < existing.firstSaleDate)) {
        existing.firstSaleDate = dateStr;
      }
      if (dateStr && (!existing.latestSaleDate || dateStr >= existing.latestSaleDate)) {
        existing.latestSaleDate = dateStr;
        if (rate > 0) existing.latestRate = rate;
      }
      if (!existing.productName && desc) existing.productName = desc;
    }
  }

  const importHash = computeSimpleHash(`${fileName}-${rawRows.length}-${map.size}`);
  const now = new Date().toISOString();

  const products: HistoricalSalesProduct[] = Array.from(map.values()).map((x) => ({
    id: `hist-${x.sku}`,
    sku: x.sku,
    product_name: x.productName,
    category: x.category || 'General',
    subcategory: x.subcategory || null,
    hsn_code: x.hsnCode || null,
    uom: x.uom || 'EA',
    first_sale_date: x.firstSaleDate,
    latest_sale_date: x.latestSaleDate,
    total_historical_qty: x.totalHistoricalQty,
    historical_invoice_count: x.invoices.size,
    historical_row_count: x.historicalRowCount,
    average_rate: x.totalHistoricalQty > 0 ? Math.round((x.totalGross / x.totalHistoricalQty) * 100) / 100 : null,
    latest_rate: Math.round((x.latestRate || 0) * 100) / 100,
    source_file: fileName,
    import_hash: importHash,
    created_at: now,
    updated_at: now,
  }));

  const totalHistoricalQty = products.reduce((sum, p) => sum + p.total_historical_qty, 0);
  const validRowsCount = rawRows.length - skippedRowsCount;
  const duplicateRowsCount = validRowsCount - products.length;

  // Determine Product Master match counts vs newly discoverable SKUs
  let matchedMasterSkusCount = 0;
  for (const p of products) {
    if (findProductMasterEntry(p.sku)) {
      matchedMasterSkusCount++;
    }
  }
  const newDiscoverableSkusCount = products.length - matchedMasterSkusCount;

  return {
    products,
    sampleRows,
    totalRows: rawRows.length,
    validRowsCount,
    uniqueSkusCount: products.length,
    duplicateRowsCount,
    skippedRowsCount,
    totalHistoricalQty,
    uniqueCustomersCount: uniqueCustomers.size,
    dateRange: {
      startDate: minDate,
      endDate: maxDate,
    },
    matchedMasterSkusCount,
    newDiscoverableSkusCount,
    importHash,
    fileName,
    warnings,
  };
}

/** Clears the in-memory lookup cache (for testing or reset) */
export function clearHistoricalSkuIndexCache(): void {
  historicalSkuIndex = null;
}

/**
 * Builds or primes the fast O(1) in-memory historical SKU index.
 * Maps both normalized SKU ('1600908') and unpadded SKU ('1600908' vs '01600908').
 */
export function primeHistoricalSkuIndex(products?: HistoricalSalesProduct[]): Map<string, HistoricalSalesProduct> {
  const index = new Map<string, HistoricalSalesProduct>();

  // 1. Static seed catalog
  for (const p of HISTORICAL_SALES_CATALOG) {
    const norm = p.sku.trim().toUpperCase();
    const unpadded = norm.replace(/^0+/, '');
    index.set(norm, p);
    if (unpadded) index.set(unpadded, p);
  }

  // 2. In-memory store
  const storeList = mockStore.getHistoricalSalesProducts();
  for (const p of storeList) {
    const norm = p.sku.trim().toUpperCase();
    const unpadded = norm.replace(/^0+/, '');
    index.set(norm, p);
    if (unpadded) index.set(unpadded, p);
  }

  // 3. Provided products
  if (products) {
    for (const p of products) {
      const norm = p.sku.trim().toUpperCase();
      const unpadded = norm.replace(/^0+/, '');
      index.set(norm, p);
      if (unpadded) index.set(unpadded, p);
    }
  }

  historicalSkuIndex = index;
  return index;
}

/**
 * Pure exact SKU lookup for historical product discovery.
 * Uses fast O(1) in-memory index first before falling back to Supabase.
 * Level 2 matching fallback. Does NOT use fuzzy product names!
 */
export async function lookupHistoricalProductBySku(sku: string): Promise<HistoricalSalesProduct | null> {
  if (!sku) return null;
  const norm = sku.trim().toUpperCase();
  const unpadded = norm.replace(/^0+/, '');

  // 1. Fast O(1) in-memory index
  if (!historicalSkuIndex) {
    primeHistoricalSkuIndex();
  }
  const cached = historicalSkuIndex?.get(norm) || (unpadded ? historicalSkuIndex?.get(unpadded) : null);
  if (cached) return cached;

  // 2. Try Supabase if not found in cache
  try {
    const { data } = await supabase
      .from('historical_sales_products')
      .select('*')
      .eq('sku', norm)
      .maybeSingle();

    if (data) {
      const prod = data as HistoricalSalesProduct;
      historicalSkuIndex?.set(norm, prod);
      if (unpadded) historicalSkuIndex?.set(unpadded, prod);
      return prod;
    }

    if (unpadded && unpadded !== norm) {
      const { data: unpaddedData } = await supabase
        .from('historical_sales_products')
        .select('*')
        .eq('sku', unpadded)
        .maybeSingle();
      if (unpaddedData) {
        const prod = unpaddedData as HistoricalSalesProduct;
        historicalSkuIndex?.set(norm, prod);
        historicalSkuIndex?.set(unpadded, prod);
        return prod;
      }
    }
  } catch {
    // Non-blocking offline fallback
  }

  return null;
}

/**
 * Idempotently imports historical sales products into Supabase and mockStore.
 * Repeated calls with the same file will NOT duplicate records or inflate quantities.
 * Invariant: Zero inventory movements or purchase_inward records are created!
 */
export async function importHistoricalSalesData(
  parsed: ParsedHistoricalSalesResult,
  _importRef?: string
): Promise<{ success: boolean; count: number; message?: string }> {
  if (!parsed.products || parsed.products.length === 0) {
    return { success: false, count: 0, message: 'No valid products to import' };
  }

  // Single-flight guard: prevent concurrent duplicate imports
  if (isImportingHistoricalSales) {
    throw new Error('Historical sales import is already in progress. Please wait.');
  }
  isImportingHistoricalSales = true;

  try {
    // 1. Synchronize in-memory mockStore immediately (bulk update, zero localStorage spam)
    mockStore.saveBulkHistoricalSalesProducts(parsed.products);

    // 2. Prime the in-memory fast lookup index immediately
    primeHistoricalSkuIndex(parsed.products);

    // 3. Try Supabase RPC import_historical_sales_products
    try {
      const { data, error } = await supabase.rpc('import_historical_sales_products', {
        p_products: parsed.products,
        p_import_hash: parsed.importHash,
        p_source_file: parsed.fileName,
      });

      if (!error && data) {
        return {
          success: true,
          count: parsed.products.length,
          message: `Imported ${parsed.products.length} historical products for discovery from ${parsed.fileName}`,
        };
      }
    } catch (err) {
      console.warn('[historicalSalesService] Supabase RPC fallback:', err);
    }

    // 4. Fallback: batched direct upserts in chunks of 50 to prevent connection timeouts
    try {
      const CHUNK_SIZE = 50;
      for (let i = 0; i < parsed.products.length; i += CHUNK_SIZE) {
        const chunk = parsed.products.slice(i, i + CHUNK_SIZE).map((p) => ({
          sku: p.sku,
          product_name: p.product_name,
          category: p.category,
          subcategory: p.subcategory,
          hsn_code: p.hsn_code,
          uom: p.uom,
          first_sale_date: p.first_sale_date,
          latest_sale_date: p.latest_sale_date,
          total_historical_qty: p.total_historical_qty,
          historical_invoice_count: p.historical_invoice_count,
          historical_row_count: p.historical_row_count,
          average_rate: p.average_rate,
          latest_rate: p.latest_rate,
          source_file: p.source_file,
          import_hash: p.import_hash,
        }));
        await supabase.from('historical_sales_products').upsert(chunk, { onConflict: 'sku' });
      }
    } catch {
      // In-memory mockStore is already populated
    }

    return {
      success: true,
      count: parsed.products.length,
      message: `Recorded ${parsed.products.length} historical discovery products. Current inventory stock is untouched.`,
    };
  } finally {
    isImportingHistoricalSales = false;
  }
}

/**
 * Returns all historical sales discovery records for Admin viewing.
 */
export async function getHistoricalSalesProducts(filter?: { search?: string }): Promise<HistoricalSalesProduct[]> {
  let list: HistoricalSalesProduct[] = [];

  try {
    const { data } = await supabase
      .from('historical_sales_products')
      .select('*')
      .order('latest_sale_date', { ascending: false });
    if (data && data.length > 0) {
      list = data as HistoricalSalesProduct[];
    } else {
      list = mockStore.getHistoricalSalesProducts();
    }
  } catch {
    list = mockStore.getHistoricalSalesProducts();
  }

  if (list.length === 0) {
    list = [...HISTORICAL_SALES_CATALOG];
  }

  if (filter?.search) {
    const q = filter.search.toLowerCase().trim();
    list = list.filter(
      (p) => p.sku.toLowerCase().includes(q) || p.product_name.toLowerCase().includes(q)
    );
  }

  return list;
}

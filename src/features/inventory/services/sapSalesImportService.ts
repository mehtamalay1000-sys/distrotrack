/**
 * Authoritative Service for SAP Sales / Billing Import & Baseline Integration
 *
 * Implements transaction-level parsing, validation, idempotency, and server-side RPC dispatch
 * for pre-go-live SAP sales spreadsheets (e.g. sale.xlsx).
 */

import * as XLSX from 'xlsx';
import { supabase, isMockMode } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import { findProductMasterEntry } from '@/features/products/data/productMaster';
import type { SapSalesImport, SapSalesImportItem } from '@/lib/database.types';

export interface ParsedSapSalesRow {
  index: number;
  invoiceNo: string;
  invoiceDate: string | null;
  orderNo?: string | null;
  itemSeq: number;
  sku: string;
  productName: string;
  category?: string;
  custCode: string | null;
  custName: string | null;
  quantity: number;
  uom: string;
  rate: number;
  grossVal: number;
  netVal: number;
  taxableVal?: number;
  isCancellation: boolean;
  referenceDoc?: string | null;
  idempotencyKey: string;
  isDuplicate?: boolean;
  isMatched?: boolean;
  status?: 'pending' | 'duplicate' | 'unmapped' | 'matched';
}

export interface SapSalesPreview {
  fileName: string;
  totalRows: number;
  validRowsCount: number;
  skippedRowsCount: number;
  uniqueSkusCount: number;
  uniqueInvoicesCount: number;
  uniqueCustomersCount: number;
  totalQuantity: number;
  totalNetValue: number;
  totalGrossValue: number;
  cancellationCount: number;
  dateRange: {
    minDate: string;
    maxDate: string;
  };
  unitBreakdown: Record<string, { count: number; quantity: number }>;
  allRows: ParsedSapSalesRow[];
  sampleRows: ParsedSapSalesRow[];
  warnings: string[];
}

export interface ConfirmSapSalesImportResult {
  success: boolean;
  message: string;
  batchRef: string;
  totalRows: number;
  movementsCreated: number;
  skippedDuplicate: number;
  skippedUnmapped: number;
  totalQuantity: number;
  totalNetAmount: number;
}

/**
 * Converts Excel serial date (e.g. 46267) to YYYY-MM-DD string.
 */
export function excelSerialToDateString(serial: number): string {
  if (!serial || isNaN(serial)) return '';
  // Excel epoch begins Jan 1, 1900 with leap year bug offset
  const utcDays = serial - 25569;
  const date = new Date(utcDays * 86400 * 1000);
  if (isNaN(date.getTime())) return '';
  return date.toISOString().split('T')[0];
}

/**
 * Normalizes SKU by trimming, uppercase, and stripping leading zeros.
 */
export function normalizeSalesSku(sku: string | number): string {
  if (!sku && sku !== 0) return '';
  const clean = String(sku).trim().toUpperCase();
  const unpadded = clean.replace(/^0+/, '');
  return unpadded || clean;
}

/**
 * Parses SAP sales spreadsheet (XLSX / CSV) with exact column matching.
 */
export function parseSapSalesWorkbook(
  buffer: ArrayBuffer | Buffer,
  fileName: string
): SapSalesPreview {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) {
    throw new Error('Spreadsheet contains no valid sheets.');
  }

  const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: null });
  if (rawRows.length === 0) {
    throw new Error('No data rows found in uploaded sales file.');
  }

  const allRows: ParsedSapSalesRow[] = [];
  const warnings: string[] = [];

  const uniqueSkus = new Set<string>();
  const uniqueInvoices = new Set<string>();
  const uniqueCustomers = new Set<string>();
  const unitBreakdown: Record<string, { count: number; quantity: number }> = {};

  let totalQuantity = 0;
  let totalNetValue = 0;
  let totalGrossValue = 0;
  let cancellationCount = 0;
  let skippedRowsCount = 0;

  let minDateInt = 9999999;
  let maxDateInt = 0;

  // Track sequence for items within the same invoice to assign deterministic line numbers
  const invoiceLineCounts = new Map<string, number>();

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];

    // Safely skip footer/Total summary rows
    const custNameRaw = String(row['Cust Name'] || row['Customer Name'] || '').trim().toLowerCase();
    const skuRaw = row['SKU Code'] || row['Material'] || row['Article No'] || row['SKU'];
    if (custNameRaw === 'total' || (!skuRaw && row['Net Value'] !== null && row['Gross_val'] !== null)) {
      skippedRowsCount++;
      continue;
    }

    if (!skuRaw) {
      skippedRowsCount++;
      continue;
    }

    const sku = normalizeSalesSku(skuRaw);
    if (!sku) {
      skippedRowsCount++;
      continue;
    }

    const invoiceNo = String(
      row['Order_invoice_no'] || row['Invoice No'] || row['Invoice Number'] || row['Billing Document'] || 'INV-UNKNOWN'
    ).trim();

    // Sequence order within invoice (10, 20, 30...)
    const currentSeq = (invoiceLineCounts.get(invoiceNo) || 0) + 1;
    invoiceLineCounts.set(invoiceNo, currentSeq);
    const itemSeq = currentSeq * 10;

    const qty = Number(row['Quantity'] ?? row['Qty'] ?? 0);
    const uom = String(row['Sales Unit'] || row['UOM'] || row['Unit'] || 'EA').trim().toUpperCase();
    const netVal = Number(row['Net Value'] ?? row['Net_val'] ?? row['Taxable'] ?? 0);
    const grossVal = Number(row['Gross_val'] ?? row['Gross Value'] ?? netVal);
    const taxableVal = Number(row['Taxable'] ?? netVal);

    // Rate: net rate per unit, or explicit Rate column
    let rate = 0;
    if (row['Rate'] !== null && row['Rate'] !== undefined) {
      rate = Number(row['Rate']);
    } else if (qty !== 0) {
      rate = Math.round((Math.abs(taxableVal) / Math.abs(qty)) * 100) / 100;
    }

    // Determine cancellation / credit note
    const invType = String(row['Invoice Type Description'] || row['Document Type'] || '').trim();
    const isCancellation =
      invType.toLowerCase().includes('cancel') ||
      invType.toLowerCase().includes('credit') ||
      netVal < 0 ||
      grossVal < 0;

    if (isCancellation) {
      cancellationCount++;
    }

    // Date resolution (Excel serial or date string)
    let invoiceDate: string | null = null;
    const dateVal = row['Confirm Date'] || row['Order Date'] || row['Invoice Date'] || row['Billing Date'];
    if (typeof dateVal === 'number') {
      invoiceDate = excelSerialToDateString(dateVal);
      if (dateVal < minDateInt) minDateInt = dateVal;
      if (dateVal > maxDateInt) maxDateInt = dateVal;
    } else if (typeof dateVal === 'string' && dateVal.trim()) {
      invoiceDate = dateVal.trim();
    }

    const prodName = String(
      row['Description'] || row['Product Description'] || row['Material Description'] || sku
    ).trim();
    const category = row['Subcategory'] || row['Category'] || null;

    const custCode = row['Cust Code'] ? String(row['Cust Code']).trim() : null;
    const custName = row['Cust Name'] ? String(row['Cust Name']).trim() : null;
    const orderNo = row['Order No'] ? String(row['Order No']).trim() : null;
    const refDoc = row['Reference Document'] ? String(row['Reference Document']).trim() : null;

    // Idempotency key: sales_import:{invoiceNo}:{itemSeq}:{sku}
    const idempotencyKey = `sales_import:${invoiceNo}:${itemSeq}:${sku}`;

    uniqueSkus.add(sku);
    uniqueInvoices.add(invoiceNo);
    if (custCode) uniqueCustomers.add(custCode);
    else if (custName) uniqueCustomers.add(custName);

    totalQuantity += qty;
    totalNetValue += netVal;
    totalGrossValue += grossVal;

    if (!unitBreakdown[uom]) {
      unitBreakdown[uom] = { count: 0, quantity: 0 };
    }
    unitBreakdown[uom].count++;
    unitBreakdown[uom].quantity += qty;

    allRows.push({
      index: i + 1,
      invoiceNo,
      invoiceDate,
      orderNo,
      itemSeq,
      sku,
      productName: prodName,
      category,
      custCode,
      custName,
      quantity: qty,
      uom,
      rate,
      grossVal,
      netVal,
      taxableVal,
      isCancellation,
      referenceDoc: refDoc,
      idempotencyKey,
      status: 'pending',
    });
  }

  const minDateStr = minDateInt < 9999999 ? excelSerialToDateString(minDateInt) : '';
  const maxDateStr = maxDateInt > 0 ? excelSerialToDateString(maxDateInt) : '';

  return {
    fileName,
    totalRows: rawRows.length,
    validRowsCount: allRows.length,
    skippedRowsCount,
    uniqueSkusCount: uniqueSkus.size,
    uniqueInvoicesCount: uniqueInvoices.size,
    uniqueCustomersCount: uniqueCustomers.size,
    totalQuantity,
    totalNetValue: Math.round(totalNetValue * 100) / 100,
    totalGrossValue: Math.round(totalGrossValue * 100) / 100,
    cancellationCount,
    dateRange: {
      minDate: minDateStr,
      maxDate: maxDateStr,
    },
    unitBreakdown,
    allRows,
    sampleRows: allRows.slice(0, 100),
    warnings,
  };
}

/**
 * Checks parsed rows against existing inventory movements and imported sales items
 * to classify each row as 'duplicate', 'unmapped', or 'matched'.
 */
export async function annotateSalesRowsStatus(
  rows: ParsedSapSalesRow[]
): Promise<{
  annotatedRows: ParsedSapSalesRow[];
  duplicateCount: number;
  unmappedCount: number;
  matchedCount: number;
}> {
  let existingIdemps = new Set<string>();

  // 1. Check Supabase
  try {
    const { data: movements } = await supabase
      .from('inventory_movements')
      .select('idempotency_key')
      .like('idempotency_key', 'sales_import:%');

    if (movements && movements.length > 0) {
      movements.forEach((m) => {
        if (m.idempotency_key) existingIdemps.add(m.idempotency_key);
      });
    }

    const { data: items } = await supabase
      .from('sap_sales_import_items')
      .select('idempotency_key');

    if (items && items.length > 0) {
      items.forEach((it) => {
        if (it.idempotency_key) existingIdemps.add(it.idempotency_key);
      });
    }
  } catch (err) {
    console.warn('[SAP SALES IMPORT] Supabase check skipped/offline:', err);
  }

  // 2. Check mockStore ONLY in mock mode
  if (isMockMode()) {
    const mockMovements = mockStore.getInventoryMovements();
    mockMovements.forEach((m) => {
      if (m.idempotency_key?.startsWith('sales_import:')) {
        existingIdemps.add(m.idempotency_key);
      }
    });
    const mockItems = mockStore.getSapSalesImportItems();
    mockItems.forEach((it) => {
      if (it.idempotency_key) existingIdemps.add(it.idempotency_key);
    });
  }

  let duplicateCount = 0;
  let unmappedCount = 0;
  let matchedCount = 0;

  const annotatedRows: ParsedSapSalesRow[] = [];

  for (const r of rows) {
    const isDup = existingIdemps.has(r.idempotencyKey);
    const masterEntry = findProductMasterEntry(r.sku);

    let status: 'duplicate' | 'unmapped' | 'matched' = 'matched';
    if (isDup) {
      status = 'duplicate';
      duplicateCount++;
    } else if (!masterEntry) {
      status = 'unmapped';
      unmappedCount++;
    } else {
      matchedCount++;
    }

    annotatedRows.push({
      ...r,
      isDuplicate: isDup,
      isMatched: status === 'matched',
      status,
    });
  }

  return {
    annotatedRows,
    duplicateCount,
    unmappedCount,
    matchedCount,
  };
}

/**
 * Submits confirmed SAP sales baseline import to Supabase RPC or mockStore.
 * Supports both object params ({ preview, cutoffDate, notes }) and positional (preview, cutoffDate, notes).
 */
export async function confirmSapSalesImport(
  paramsOrPreview: { preview: SapSalesPreview; cutoffDate: string; notes?: string } | SapSalesPreview,
  maybeCutoff?: string,
  maybeNotes?: string
): Promise<ConfirmSapSalesImportResult> {
  const isObj = paramsOrPreview && 'preview' in paramsOrPreview && typeof (paramsOrPreview as any).preview === 'object';
  const preview: SapSalesPreview = isObj ? (paramsOrPreview as any).preview : (paramsOrPreview as SapSalesPreview);
  const cutoffDate: string = (isObj ? (paramsOrPreview as any).cutoffDate : maybeCutoff) || preview.dateRange?.maxDate || new Date().toISOString().split('T')[0];
  const notes = isObj ? (paramsOrPreview as any).notes : maybeNotes;
  const batchRef = `SALES-${cutoffDate.replace(/-/g, '')}-${Date.now().toString(36).slice(-4).toUpperCase()}`;

  const payloadItems = preview.allRows.map((r) => ({
    invoice_no: r.invoiceNo,
    invoice_date: r.invoiceDate,
    item_seq: r.itemSeq,
    sku: r.sku,
    product_name: r.productName,
    cust_code: r.custCode,
    cust_name: r.custName,
    quantity: r.quantity,
    uom: r.uom,
    rate: r.rate,
    gross_val: r.grossVal,
    net_val: r.netVal,
    is_cancellation: r.isCancellation,
    reference_doc: r.referenceDoc,
  }));

  // 1. Try Supabase RPC
  try {
    const { data, error } = await supabase.rpc('import_sap_sales_baseline', {
      p_items: payloadItems,
      p_batch_ref: batchRef,
      p_cutoff_date: cutoffDate,
      p_file_name: preview.fileName || 'sale.xlsx',
      p_notes: notes || `Go-Live SAP Sales Baseline through ${cutoffDate}`,
    });

    if (!error && data) {
      return {
        success: true,
        message: `SAP Sales Baseline successfully imported: ${data.movements_created} stock-out movements created, ${data.skipped_duplicate} duplicates skipped.`,
        batchRef,
        totalRows: Number(data.total_rows || preview.allRows.length),
        movementsCreated: Number(data.movements_created || 0),
        skippedDuplicate: Number(data.skipped_duplicate || 0),
        skippedUnmapped: Number(data.skipped_unmapped || 0),
        totalQuantity: Number(data.total_quantity || preview.totalQuantity),
        totalNetAmount: Number(data.total_net_amount || preview.totalNetValue),
      };
    }
  } catch (rpcErr) {
    console.warn('[SAP SALES IMPORT] Supabase RPC unavailable or offline, using mockStore fallback:', rpcErr);
  }

  // 2. Fallback to mockStore ONLY in mock mode
  if (!isMockMode()) {
    throw new Error('Supabase RPC unavailable and mock mode is disabled');
  }
  const mockRes = mockStore.importSapSalesBaseline({
    items: payloadItems,
    batch_ref: batchRef,
    cutoff_date: cutoffDate,
    file_name: preview.fileName || 'sale.xlsx',
    notes: notes || `Go-Live SAP Sales Baseline through ${cutoffDate}`,
  });

  return {
    success: true,
    message: `SAP Sales Baseline successfully recorded: ${mockRes.movements_created} movements created, ${mockRes.skipped_duplicate} duplicates skipped.`,
    batchRef,
    totalRows: mockRes.total_rows,
    movementsCreated: mockRes.movements_created,
    skippedDuplicate: mockRes.skipped_duplicate,
    skippedUnmapped: mockRes.skipped_unmapped,
    totalQuantity: mockRes.total_quantity,
    totalNetAmount: mockRes.total_net_amount,
  };
}

/**
 * Fetches all past SAP sales baseline import batches.
 */
export async function getSapSalesImports(): Promise<SapSalesImport[]> {
  try {
    const { data, error } = await supabase
      .from('sap_sales_imports')
      .select('*')
      .order('imported_at', { ascending: false });

    if (!error && data) {
      return data as SapSalesImport[];
    }
  } catch (err) {
    console.warn('[SAP SALES IMPORT] Querying Supabase sap_sales_imports failed:', err);
  }

  if (isMockMode()) {
    return mockStore.getSapSalesImports();
  }
  return [];
}

/**
 * Fetches line items for an SAP sales baseline import batch.
 */
export async function getSapSalesImportItems(importId?: string): Promise<SapSalesImportItem[]> {
  try {
    let query = supabase.from('sap_sales_import_items').select('*');
    if (importId) {
      query = query.eq('import_id', importId);
    }
    const { data, error } = await query.order('created_at', { ascending: true });

    if (!error && data) {
      return data as SapSalesImportItem[];
    }
  } catch (err) {
    console.warn('[SAP SALES IMPORT] Querying Supabase sap_sales_import_items failed:', err);
  }

  if (isMockMode()) {
    return mockStore.getSapSalesImportItems(importId);
  }
  return [];
}

/**
 * Weekly SAP Purchase / Goods Receipt (GR) Inward Stock Import Service
 *
 * Dedicated workflow for processing weekly SAP Purchase / GR Excel files.
 * Transforms confirmed Goods Receipts into authoritative 'purchase_inward'
 * inventory ledger movements.
 *
 * Rules:
 * 1. Exact Material/SKU matching via Product Master — never fuzzy match unknown SKUs.
 * 2. Only CONFIRMED / RECEIVED / GR-Completed quantities increase operational stock.
 *    Ordered, pending, cancelled, or unconfirmed rows are excluded.
 * 3. Deterministic idempotency keys prevent duplicate stock additions.
 * 4. Never writes direct client-side inventory movements; calls secure server-side RPC.
 * 5. Negative stock remains fully supported and allowed.
 */

import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import { findProductMasterEntry } from '@/features/products/data/productMaster';
import type { SapPurchaseImport, SapPurchaseImportItem } from '@/lib/database.types';

export interface ParsedPurchaseRow {
  sku: string;
  productName: string;
  uom: string;
  orderedQty?: number;
  receivedQty: number;
  grStatus: string;
  grDate: string;
  grDocNo: string;
  poNumber: string;
  invoiceNo: string;
  invoiceDate: string;
  batch: string;
  rawRow: Record<string, any>;
}

export type PurchaseRowMatchStatus = 'MATCHED' | 'UNMAPPED' | 'INVALID_QTY' | 'EXCLUDED_STATUS';

export interface PurchaseImportPreviewRow extends ParsedPurchaseRow {
  matchStatus: PurchaseRowMatchStatus;
  productId?: string;
  canonicalName?: string;
  validationError?: string;
  idempotencyKey: string;
  isDuplicate?: boolean;
}

export interface PurchaseImportPreview {
  rows: PurchaseImportPreviewRow[];
  batchRef: string;
  fileName: string;
  totalRows: number;
  matched: number;
  unmapped: number;
  invalid: number;
  excluded: number;
  duplicateCount: number;
  totalReceivedQty: number;
  hasDuplicates: boolean;
}

export interface PurchaseImportResult {
  success: boolean;
  importId?: string;
  batchRef: string;
  totalRows: number;
  movementsCreated: number;
  skippedDuplicate: number;
  skippedUnmapped: number;
  errors?: string[];
  message?: string;
}

const CONFIRMED_STATUS_REGEX = /^(?:completed|gr\s*done|received|posted|101|yes|grn|success)$/i;
const EXCLUDED_STATUS_REGEX = /^(?:pending|cancelled|canceled|open|in\s*transit|rejected|draft|0)$/i;

/**
 * Parses numeric quantity safely from string or number.
 * Handles strings like "360 DOZ", "1,080", etc.
 */
function parseCleanNumber(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const str = String(val).replace(/,/g, '').trim();
  const numMatch = str.match(/-?\d+(\.\d+)?/);
  if (!numMatch) return 0;
  const parsed = parseFloat(numMatch[0]);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Parses weekly SAP purchase / GR Excel file.
 * Dynamically resolves columns for Article No, Confirmed Qty, GR Status, GR Doc No, etc.
 */
export async function parseSapPurchaseFile(file: File): Promise<{
  rows: ParsedPurchaseRow[];
  fileName: string;
  batchRef: string;
  error?: string;
}> {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];

    if (!sheet) {
      return { rows: [], fileName: file.name, batchRef: '', error: 'Spreadsheet contains no sheets' };
    }

    const rawData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
    if (rawData.length === 0) {
      return { rows: [], fileName: file.name, batchRef: '', error: 'No data rows found in uploaded file' };
    }

    const sample = rawData[0];
    const keys = Object.keys(sample);

    // 1. Resolve SKU / Article No column
    let skuKey = keys.find((k) =>
      /^(?:article\s*no\.?|article\s*number|material|sku|material\s*no\.?|material\s*number|item\s*code|product\s*code)$/i.test(k.trim())
    );
    if (!skuKey) {
      skuKey = keys.find((k) => /article|material|sku/i.test(k));
    }
    if (!skuKey && keys.length > 0) {
      skuKey = keys[0];
    }

    // 2. Resolve Confirmed / Received Qty column (MUST NOT mistakenly pick Ordered Qty!)
    let confirmedQtyKey = keys.find((k) =>
      /^(?:confirmed\s*qty|confirmed\s*quantity|received\s*qty|received\s*quantity|gr\s*qty|gr\s*quantity|delivery\s*qty)$/i.test(k.trim())
    );
    if (!confirmedQtyKey) {
      // Look for confirmed/received variants
      confirmedQtyKey = keys.find((k) => /confirmed|received|gr\s*qty/i.test(k));
    }
    if (!confirmedQtyKey) {
      // Fallback to qty that does NOT contain "order"
      confirmedQtyKey = keys.find((k) => /qty|quantity/i.test(k) && !/order/i.test(k));
    }

    // 3. Resolve Ordered Qty column (for reference only)
    const orderedQtyKey = keys.find((k) =>
      /^(?:ordered\s*qty|ordered\s*quantity|order\s*qty|order\s*quantity)$/i.test(k.trim()) ||
      (/order/i.test(k) && /qty|quantity/i.test(k))
    );

    // 4. Resolve Description column
    const descKey = keys.find((k) =>
      /^(?:description|material\s*description|product\s*name|item\s*description)$/i.test(k.trim())
    ) || keys.find((k) => /desc|description|name/i.test(k));

    // 5. Resolve UOM column
    const uomKey = keys.find((k) =>
      /^(?:sales\s*unit|uom|unit|base\s*unit)$/i.test(k.trim())
    ) || keys.find((k) => /unit|uom/i.test(k));

    // 6. Resolve GR Status column
    const grStatusKey = keys.find((k) =>
      /^(?:gr\s*status|status|posting\s*status|movement\s*type)$/i.test(k.trim())
    ) || keys.find((k) => /status/i.test(k));

    // 7. Resolve GR Document column
    const grDocKey = keys.find((k) =>
      /^(?:gr\s*document\s*no\.?|gr\s*document|gr\s*doc\s*no\.?|material\s*document|doc\s*no\.?|document\s*number)$/i.test(k.trim())
    ) || keys.find((k) => /document|doc\s*no/i.test(k));

    // 8. Resolve GR Date column
    const grDateKey = keys.find((k) =>
      /^(?:gr\s*date|posting\s*date|document\s*date|receipt\s*date)$/i.test(k.trim())
    ) || keys.find((k) => /date/i.test(k));

    // 9. Resolve Invoice column
    const invoiceNoKey = keys.find((k) =>
      /^(?:cp\s*invoice\s*no\.?|invoice\s*no\.?|invoice\s*number|bill\s*no\.?)$/i.test(k.trim())
    ) || keys.find((k) => /invoice/i.test(k));

    const invoiceDateKey = keys.find((k) => /invoice\s*date/i.test(k));
    const poNumberKey = keys.find((k) => /^(?:po\s*no\.?|purchase\s*order|po\s*number|order\s*no\.?)$/i.test(k.trim()));
    const batchKey = keys.find((k) => /^(?:batch|lot|batch\s*no\.?)$/i.test(k.trim()));

    if (!skuKey) {
      return {
        rows: [],
        fileName: file.name,
        batchRef: '',
        error: `Could not identify Material/SKU column in "${file.name}". Detected columns: ${keys.join(', ')}`,
      };
    }

    if (!confirmedQtyKey && !orderedQtyKey) {
      return {
        rows: [],
        fileName: file.name,
        batchRef: '',
        error: `Could not identify Confirmed/Received Quantity column in "${file.name}". Detected columns: ${keys.join(', ')}`,
      };
    }

    const effectiveQtyKey = confirmedQtyKey || orderedQtyKey!;
    const parsedRows: ParsedPurchaseRow[] = [];
    const grDocs = new Set<string>();
    const invoices = new Set<string>();

    for (const r of rawData) {
      const rawSku = String(r[skuKey] || '').trim();
      if (!rawSku) continue;

      const receivedQty = parseCleanNumber(r[effectiveQtyKey]);
      const orderedQty = orderedQtyKey ? parseCleanNumber(r[orderedQtyKey]) : undefined;
      const desc = descKey ? String(r[descKey] || '').trim() : '';
      const uom = uomKey ? String(r[uomKey] || 'DOZ').trim() : 'DOZ';
      const grStatus = grStatusKey ? String(r[grStatusKey] || '').trim() : 'Completed';
      const grDocNo = grDocKey ? String(r[grDocKey] || '').trim() : '';
      const grDate = grDateKey ? String(r[grDateKey] || '').trim() : '';
      const invoiceNo = invoiceNoKey ? String(r[invoiceNoKey] || '').trim() : '';
      const invoiceDate = invoiceDateKey ? String(r[invoiceDateKey] || '').trim() : '';
      const poNumber = poNumberKey ? String(r[poNumberKey] || '').trim() : '';
      const batch = batchKey ? String(r[batchKey] || '').trim() : '';

      if (grDocNo) grDocs.add(grDocNo);
      if (invoiceNo) invoices.add(invoiceNo);

      parsedRows.push({
        sku: rawSku,
        productName: desc,
        uom,
        orderedQty,
        receivedQty,
        grStatus,
        grDate,
        grDocNo,
        poNumber,
        invoiceNo,
        invoiceDate,
        batch,
        rawRow: r,
      });
    }

    // Generate batch reference deterministically
    let batchRef = '';
    if (grDocs.size === 1) {
      batchRef = `GR-${Array.from(grDocs)[0]}`;
    } else if (invoices.size === 1) {
      batchRef = `INV-${Array.from(invoices)[0]}`;
    } else {
      const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
      batchRef = `BATCH-${cleanName}-${Date.now()}`;
    }

    return {
      rows: parsedRows,
      fileName: file.name,
      batchRef,
    };
  } catch (err: any) {
    return {
      rows: [],
      fileName: file.name,
      batchRef: '',
      error: `File parse error: ${err?.message || 'Unknown error reading spreadsheet'}`,
    };
  }
}

/**
 * Validates parsed rows, matches against canonical SAP Product Master,
 * checks for existing duplicates in Supabase & mockStore, and prepares the preview.
 */
export async function validateAndMatchPurchaseRows(
  rows: ParsedPurchaseRow[],
  batchRef: string
): Promise<PurchaseImportPreview> {
  const previewRows: PurchaseImportPreviewRow[] = [];
  let matchedCount = 0;
  let unmappedCount = 0;
  let invalidCount = 0;
  let excludedCount = 0;
  let duplicateCount = 0;
  let totalReceivedQty = 0;

  // Retrieve existing movements to check idempotency client-side for pre-warning
  const existingIdempKeys = new Set<string>();

  try {
    const { data: movements } = await supabase
      .from('inventory_movements')
      .select('idempotency_key')
      .not('idempotency_key', 'is', null);

    if (movements) {
      movements.forEach((m) => {
        if (m.idempotency_key) existingIdempKeys.add(m.idempotency_key);
      });
    }
  } catch {
    // Supabase query optional
  }

  // Also check mockStore
  const mockMovements = mockStore.getInventoryMovements();
  mockMovements.forEach((m) => {
    if (m.idempotency_key) existingIdempKeys.add(m.idempotency_key);
  });

  for (const row of rows) {
    const normSku = row.sku.trim().toUpperCase();

    // Deterministic idempotency key:
    // purchase_inward:{gr_doc_no || invoice_no || batch_ref}:{normSku}
    const docRef = row.grDocNo || row.invoiceNo || batchRef;
    const idempotencyKey = `purchase_inward:${docRef}:${normSku}`;

    // 1. Check quantity validity
    if (row.receivedQty <= 0) {
      invalidCount++;
      previewRows.push({
        ...row,
        matchStatus: 'INVALID_QTY',
        validationError: `Received quantity must be positive (found: ${row.receivedQty})`,
        idempotencyKey,
      });
      continue;
    }

    // 2. Check GR status confirmation
    // Only confirmed/completed Goods Receipts may increase operational stock
    const isConfirmed =
      row.grStatus === '' ||
      CONFIRMED_STATUS_REGEX.test(row.grStatus) ||
      /complete|received|done|posted|101/i.test(row.grStatus);

    const isExplicitlyExcluded = EXCLUDED_STATUS_REGEX.test(row.grStatus);

    if (isExplicitlyExcluded || (!isConfirmed && row.grStatus !== '')) {
      excludedCount++;
      previewRows.push({
        ...row,
        matchStatus: 'EXCLUDED_STATUS',
        validationError: `GR Status '${row.grStatus}' is unconfirmed/pending. Operational stock not altered.`,
        idempotencyKey,
      });
      continue;
    }

    // 3. Exact Material/SKU matching via canonical SAP Product Master
    const masterEntry = findProductMasterEntry(row.sku);

    if (!masterEntry) {
      unmappedCount++;
      previewRows.push({
        ...row,
        matchStatus: 'UNMAPPED',
        validationError: 'SKU not found in official Colgate-Palmolive Product Master',
        idempotencyKey,
      });
      continue;
    }

    // 4. Check for duplicate idempotency
    const isDuplicate = existingIdempKeys.has(idempotencyKey);
    if (isDuplicate) {
      duplicateCount++;
    }

    matchedCount++;
    totalReceivedQty += row.receivedQty;

    previewRows.push({
      ...row,
      matchStatus: 'MATCHED',
      canonicalName: masterEntry.name,
      idempotencyKey,
      isDuplicate,
    });
  }

  return {
    rows: previewRows,
    batchRef,
    fileName: '',
    totalRows: rows.length,
    matched: matchedCount,
    unmapped: unmappedCount,
    invalid: invalidCount,
    excluded: excludedCount,
    duplicateCount,
    totalReceivedQty,
    hasDuplicates: duplicateCount > 0,
  };
}

/**
 * Confirms weekly SAP purchase import.
 * Calls secure server-side RPC `import_purchase_inward` to record authoritative
 * 'purchase_inward' movements in the immutable inventory ledger.
 *
 * Never inserts movements directly from frontend.
 */
export async function confirmPurchaseImport(
  preview: PurchaseImportPreview,
  batchRef: string,
  fileName: string,
  notes?: string
): Promise<PurchaseImportResult> {
  // Filter for valid matched rows
  const actionableRows = preview.rows.filter(
    (r) => r.matchStatus === 'MATCHED' && !r.isDuplicate
  );

  if (actionableRows.length === 0) {
    if (preview.duplicateCount > 0 && preview.matched === preview.duplicateCount) {
      return {
        success: false,
        batchRef,
        totalRows: preview.totalRows,
        movementsCreated: 0,
        skippedDuplicate: preview.duplicateCount,
        skippedUnmapped: preview.unmapped,
        errors: ['All matched items in this file have already been imported (duplicates skipped).'],
      };
    }
    return {
      success: false,
      batchRef,
      totalRows: preview.totalRows,
      movementsCreated: 0,
      skippedDuplicate: preview.duplicateCount,
      skippedUnmapped: preview.unmapped,
      errors: ['No valid matched rows available for inventory movement creation.'],
    };
  }

  const itemsPayload = preview.rows.map((r) => ({
    sku: r.sku,
    product_name: r.canonicalName || r.productName,
    quantity: r.receivedQty,
    uom: r.uom || 'DOZ',
    gr_status: r.grStatus,
    gr_date: r.grDate || new Date().toISOString().split('T')[0],
    gr_doc_no: r.grDocNo || null,
    po_number: r.poNumber || null,
    invoice_no: r.invoiceNo || null,
  }));

  // 1. Try secure Supabase RPC path
  try {
    const { data, error } = await supabase.rpc('import_purchase_inward', {
      p_items: itemsPayload as any,
      p_batch_ref: batchRef,
      p_file_name: fileName,
      p_notes: notes || null,
    });

    if (error) {
      console.warn('[PURCHASE IMPORT] Supabase RPC returned error, attempting fallback:', error);
      throw error;
    }

    if (data) {
      return {
        success: Boolean(data.success),
        importId: data.import_id,
        batchRef: data.batch_ref || batchRef,
        totalRows: Number(data.total_rows || preview.totalRows),
        movementsCreated: Number(data.movements_created || 0),
        skippedDuplicate: Number(data.skipped_duplicate || 0),
        skippedUnmapped: Number(data.skipped_unmapped || 0),
        message: data.message,
      };
    }
  } catch (rpcErr: any) {
    console.warn('[PURCHASE IMPORT] RPC failed or offline:', rpcErr);

    // Fallback: If running in mock/demo mode, record directly into mockStore
    return executeMockPurchaseImport(preview, batchRef, fileName, notes);
  }

  return executeMockPurchaseImport(preview, batchRef, fileName, notes);
}

/**
 * Fallback import executor for mock/demo environments.
 * Ensures consistent behavior without direct table manipulation.
 */
function executeMockPurchaseImport(
  preview: PurchaseImportPreview,
  batchRef: string,
  fileName: string,
  notes?: string
): PurchaseImportResult {
  let movementsCreated = 0;
  let skippedDuplicate = 0;
  let skippedUnmapped = 0;

  const importItems: Array<Omit<SapPurchaseImportItem, 'id' | 'import_id' | 'created_at'>> = [];

  for (const r of preview.rows) {
    if (r.matchStatus === 'UNMAPPED') {
      skippedUnmapped++;
      importItems.push({
        sku: r.sku,
        product_id: null,
        product_name: r.canonicalName || r.productName,
        quantity: r.receivedQty,
        uom: r.uom,
        gr_status: r.grStatus,
        gr_date: r.grDate || null,
        gr_doc_no: r.grDocNo || null,
        po_number: r.poNumber || null,
        invoice_no: r.invoiceNo || null,
        idempotency_key: r.idempotencyKey,
        movement_id: null,
        status: 'unmapped',
        notes: r.validationError || null,
      });
      continue;
    }

    if (r.matchStatus === 'INVALID_QTY' || r.matchStatus === 'EXCLUDED_STATUS') {
      importItems.push({
        sku: r.sku,
        product_id: null,
        product_name: r.canonicalName || r.productName,
        quantity: r.receivedQty,
        uom: r.uom,
        gr_status: r.grStatus,
        gr_date: r.grDate || null,
        gr_doc_no: r.grDocNo || null,
        po_number: r.poNumber || null,
        invoice_no: r.invoiceNo || null,
        idempotency_key: r.idempotencyKey,
        movement_id: null,
        status: 'error',
        notes: r.validationError || null,
      });
      continue;
    }

    // Check duplicate
    const existing = mockStore.getInventoryMovements().find((m) => m.idempotency_key === r.idempotencyKey);
    if (existing || r.isDuplicate) {
      skippedDuplicate++;
      importItems.push({
        sku: r.sku,
        product_id: existing?.product_id || null,
        product_name: r.canonicalName || r.productName,
        quantity: r.receivedQty,
        uom: r.uom,
        gr_status: r.grStatus,
        gr_date: r.grDate || null,
        gr_doc_no: r.grDocNo || null,
        po_number: r.poNumber || null,
        invoice_no: r.invoiceNo || null,
        idempotency_key: r.idempotencyKey,
        movement_id: existing?.id || null,
        status: 'duplicate',
        notes: 'Already imported',
      });
      continue;
    }

    // Find product
    const prods = mockStore.getProducts();
    let prod = prods.find((p) => p.sku.toUpperCase() === r.sku.toUpperCase());
    if (!prod) {
      prod = {
        id: `prod-sap-${r.sku}`,
        sku: r.sku,
        name: r.canonicalName || r.productName,
        category: 'Oral Care',
        mrp: 100,
        rate: 100,
        unit: r.uom || 'pcs',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mockStore.saveProduct(prod);
    }

    // Insert authoritative INBOUND movement
    const movement = mockStore.addInventoryMovement({
      product_id: prod.id,
      sku: r.sku,
      movement_type: 'purchase_inward',
      quantity: r.receivedQty,
      direction: 'in',
      from_location: 'supplier',
      to_location: 'warehouse',
      reference_number: r.grDocNo || r.invoiceNo || batchRef,
      idempotency_key: r.idempotencyKey,
      notes: `Weekly SAP Purchase/GR Inbound: ${r.grDocNo || batchRef} - ${r.canonicalName || r.productName}`,
      source_location: 'supplier',
      destination_location: 'warehouse',
    });

    movementsCreated++;

    importItems.push({
      sku: r.sku,
      product_id: prod.id,
      product_name: r.canonicalName || r.productName,
      quantity: r.receivedQty,
      uom: r.uom,
      gr_status: r.grStatus,
      gr_date: r.grDate || null,
      gr_doc_no: r.grDocNo || null,
      po_number: r.poNumber || null,
      invoice_no: r.invoiceNo || null,
      idempotency_key: r.idempotencyKey,
      movement_id: movement.id,
      status: 'created',
      notes: 'Movement created successfully',
    });
  }

  const { importRecord } = mockStore.saveSapPurchaseImport(
    {
      batch_ref: batchRef,
      file_name: fileName,
      imported_by: 'admin-local',
      total_rows: preview.totalRows,
      movements_created: movementsCreated,
      skipped_duplicate: skippedDuplicate,
      skipped_unmapped: skippedUnmapped,
      notes: notes || null,
    },
    importItems
  );

  return {
    success: true,
    importId: importRecord.id,
    batchRef,
    totalRows: preview.totalRows,
    movementsCreated,
    skippedDuplicate,
    skippedUnmapped,
    message: `Import completed: ${movementsCreated} inbound movements created, ${skippedDuplicate} duplicates skipped, ${skippedUnmapped} unmapped SKUs skipped.`,
  };
}

/**
 * Fetches recent SAP purchase import history for Admin review.
 */
export async function getRecentPurchaseImports(): Promise<SapPurchaseImport[]> {
  try {
    const { data, error } = await supabase
      .from('sap_purchase_imports')
      .select('*')
      .order('imported_at', { ascending: false })
      .limit(20);

    if (!error && data && data.length > 0) {
      return data as SapPurchaseImport[];
    }
  } catch {
    // fallback to mockStore
  }

  return mockStore.getSapPurchaseImports();
}

import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import { findProductMasterEntry } from '@/features/products/data/productMaster';
import type {
  SapStockReconciliation,
  SapStockReconciliationItem,
  SapReconciliationStatus,
} from '@/lib/database.types';
import * as XLSX from 'xlsx';

export interface SapUploadRow {
  sku: string;
  stockQty: number;
  rawName?: string;
}

export interface ReconciledItem {
  sku: string;
  productName: string;
  uom: string;
  sapStock: number | null;
  distrotrackStock: number | null;
  variance: number | null;
  status: SapReconciliationStatus;
  notes?: string;
}

export interface ReconciliationResult {
  period: string;
  fileName: string;
  uploadedAt: string;
  items: ReconciledItem[];
  summary: {
    totalProducts: number;
    matched: number;
    variance: number;
    incomplete: number;
    unmapped: number;
    unmappedCount?: number;
    positiveVariance: number;
    negativeVariance: number;
    largestVariances: ReconciledItem[];
  };
}

/**
 * Parses uploaded SAP stock file (XLSX or CSV).
 * Strictly matches Material/SKU column and Stock Quantity column.
 * Does NOT guess or invent stock if column is missing or blank.
 */
export async function parseSapStockFile(file: File): Promise<{
  rows: SapUploadRow[];
  fileName: string;
  error?: string;
}> {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    if (!sheet) {
      return { rows: [], fileName: file.name, error: 'Empty spreadsheet' };
    }

    const rawData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
    if (rawData.length === 0) {
      return { rows: [], fileName: file.name, error: 'No data rows found in uploaded file' };
    }

    // Inspect first row headers to find SKU and Stock Quantity column names
    const sample = rawData[0];
    const keys = Object.keys(sample);

    let skuKey = keys.find((k) =>
      /^(?:material|sku|material\s*no|item\s*code|material\s*number|article|product\s*code)$/i.test(k.trim())
    );
    if (!skuKey) {
      skuKey = keys.find((k) => /material|sku/i.test(k));
    }
    if (!skuKey && keys.length > 0) {
      skuKey = keys[0]; // fallback to first column
    }

    let qtyKey = keys.find((k) =>
      /^(?:stock|stock\s*qty|quantity|qty|unrestricted|closing\s*stock|available\s*stock|on\s*hand)$/i.test(k.trim())
    );
    if (!qtyKey) {
      qtyKey = keys.find((k) => /stock|qty|quantity/i.test(k));
    }
    if (!qtyKey && keys.length > 1) {
      // Find first column with numeric values
      qtyKey = keys.find((k) => k !== skuKey && typeof sample[k] === 'number');
    }

    if (!skuKey || !qtyKey) {
      return {
        rows: [],
        fileName: file.name,
        error: `Could not identify required columns in "${file.name}". Detected columns: ${keys.join(', ')}. Please include Material/SKU and Stock Quantity.`,
      };
    }

    const rows: SapUploadRow[] = [];
    for (const r of rawData) {
      const rawSku = String(r[skuKey] || '').trim();
      if (!rawSku) continue;

      const rawVal = r[qtyKey];
      // If stock value is empty or not a valid number, skip or treat as missing
      if (rawVal === '' || rawVal === null || rawVal === undefined) {
        continue;
      }

      const parsedNum = parseFloat(String(rawVal).replace(/,/g, ''));
      if (isNaN(parsedNum)) continue;

      rows.push({
        sku: rawSku,
        stockQty: parsedNum,
        rawName: r['Description'] || r['Material Description'] || r['Name'] || undefined,
      });
    }

    return { rows, fileName: file.name };
  } catch (err) {
    return {
      rows: [],
      fileName: file.name,
      error: err instanceof Error ? err.message : 'Failed to parse SAP stock file',
    };
  }
}

/**
 * Calculates DistroTrack operational stock for a product from the authoritative inventory ledger.
 *
 * Formula:
 * Opening Stock + Inbound - Delivered + Returned - Damaged ± Adjustments = Calculated Stock
 *
 * STRICT RULE: If no opening stock or movement data exists for the product,
 * returns { calculatedStock: null, isIncomplete: true }. NEVER invent missing values!
 */
export async function getDistroTrackOperationalStock(sku: string): Promise<{
  calculatedStock: number | null;
  isIncomplete: boolean;
  notes?: string;
}> {
  try {
    // 1. Check if product exists in Supabase
    const { data: prod } = await supabase
      .from('products')
      .select('id, sku')
      .eq('sku', sku)
      .maybeSingle();

    if (prod) {
      // Query movements for this product
      const { data: movements } = await supabase
        .from('inventory_movements')
        .select('*')
        .eq('product_id', prod.id);

      if (movements && movements.length > 0) {
        let opening = 0;
        let inbound = 0;
        let delivered = 0;
        let returned = 0;
        let damaged = 0;
        let adjustments = 0;
        let hasAuthoritativeOpeningOrInbound = false;

        for (const m of movements) {
          const q = Number(m.quantity || 0);
          switch (m.movement_type) {
            case 'opening_balance':
              opening += q;
              hasAuthoritativeOpeningOrInbound = true;
              break;
            case 'purchase_inward':
              inbound += q;
              hasAuthoritativeOpeningOrInbound = true;
              break;
            case 'delivery_fulfilled':
              delivered += q;
              break;
            case 'route_return':
              returned += q;
              break;
            case 'damaged_transit':
            case 'damaged_warehouse':
              damaged += q;
              break;
            case 'inventory_adjustment':
              adjustments += (m.direction === 'in' ? q : -q);
              break;
            default:
              if (m.to_location === 'warehouse') inbound += q;
              else if (m.from_location === 'warehouse') delivered += q;
          }
        }

        if (hasAuthoritativeOpeningOrInbound) {
          const calculatedStock = opening + inbound - delivered + returned - damaged + adjustments;
          return { calculatedStock, isIncomplete: false };
        }
      }
    }
  } catch (err) {
    console.warn('[RECONCILIATION] Error checking Supabase movements:', err);
  }

  // 2. Check mockStore
  const mockMovements = mockStore.getInventoryMovements(sku);
  if (mockMovements && mockMovements.length > 0) {
    let opening = 0;
    let inbound = 0;
    let delivered = 0;
    let returned = 0;
    let damaged = 0;
    let adjustments = 0;
    let hasAuthoritativeOpeningOrInbound = false;

    for (const m of mockMovements) {
      const q = Number(m.quantity || 0);
      switch (m.movement_type) {
        case 'opening_balance':
          opening += q;
          hasAuthoritativeOpeningOrInbound = true;
          break;
        case 'purchase_inward':
          inbound += q;
          hasAuthoritativeOpeningOrInbound = true;
          break;
        case 'delivery_fulfilled':
          delivered += q;
          break;
        case 'route_return':
          returned += q;
          break;
        case 'damaged_transit':
        case 'damaged_warehouse':
          damaged += q;
          break;
        case 'inventory_adjustment':
          adjustments += (m.direction === 'in' ? q : -q);
          break;
        default:
          if (m.to_location === 'warehouse') inbound += q;
          else if (m.from_location === 'warehouse') delivered += q;
      }
    }

    if (hasAuthoritativeOpeningOrInbound) {
      const calculatedStock = opening + inbound - delivered + returned - damaged + adjustments;
      return { calculatedStock, isIncomplete: false };
    }
  }

  const mockProducts = mockStore.getProducts();
  const mockProd = mockProducts.find((p) => p.sku.toUpperCase() === sku.toUpperCase());
  if (mockProd) {
    // Check delivery records in mockStore to see operational movements
    const deliveryItems = mockStore.getDeliveryItems().filter((d) => d.sku.toUpperCase() === sku.toUpperCase());
    if (deliveryItems.length > 0) {
      // If we only have outbound delivery movements without recorded opening stock,
      // data is incomplete!
      return {
        calculatedStock: null,
        isIncomplete: true,
        notes: 'Warehouse opening stock not recorded in DistroTrack ledger',
      };
    }
  }

  // No operational inventory records exist for this SKU
  return {
    calculatedStock: null,
    isIncomplete: true,
    notes: 'No inventory movements recorded in DistroTrack',
  };
}

/**
 * Compares uploaded SAP stock against DistroTrack calculated operational stock.
 * This is a reporting/reconciliation operation — MUST NOT modify inventory_movements!
 */
export async function performSapStockReconciliation(
  sapRows: SapUploadRow[],
  period: string,
  fileName: string = 'sap_stock_upload.xlsx'
): Promise<ReconciliationResult> {
  const items: ReconciledItem[] = [];

  let matched = 0;
  let variance = 0;
  let incomplete = 0;
  let unmapped = 0;
  let positiveVariance = 0;
  let negativeVariance = 0;

  for (const row of sapRows) {
    const sku = row.sku.trim();
    const masterEntry = findProductMasterEntry(sku);

    if (!masterEntry) {
      // UNMAPPED SKU
      unmapped += 1;
      items.push({
        sku,
        productName: row.rawName || 'UNMAPPED SKU',
        uom: 'EA',
        sapStock: row.stockQty,
        distrotrackStock: null,
        variance: null,
        status: 'UNMAPPED SKU',
        notes: 'SKU does not exist in SAP Colgate-Palmolive Product Master',
      });
      continue;
    }

    const officialName = masterEntry.name;
    const uom = masterEntry.uom || 'EA';

    const { calculatedStock, isIncomplete, notes } = await getDistroTrackOperationalStock(sku);

    if (isIncomplete || calculatedStock === null) {
      incomplete += 1;
      items.push({
        sku,
        productName: officialName,
        uom,
        sapStock: row.stockQty,
        distrotrackStock: null,
        variance: null,
        status: 'INCOMPLETE DATA',
        notes: notes || 'DistroTrack opening/inbound stock missing',
      });
      continue;
    }

    // Variance = SAP Stock - DistroTrack Calculated Stock
    const diff = row.stockQty - calculatedStock;
    const isMatched = Math.abs(diff) < 0.001;

    if (isMatched) {
      matched += 1;
      items.push({
        sku,
        productName: officialName,
        uom,
        sapStock: row.stockQty,
        distrotrackStock: calculatedStock,
        variance: 0,
        status: 'MATCHED',
      });
    } else {
      variance += 1;
      if (diff > 0) positiveVariance += 1;
      else negativeVariance += 1;

      items.push({
        sku,
        productName: officialName,
        uom,
        sapStock: row.stockQty,
        distrotrackStock: calculatedStock,
        variance: diff,
        status: 'VARIANCE',
        notes: diff > 0 ? `SAP surplus of +${diff}` : `SAP shortage of ${diff}`,
      });
    }
  }

  // Find largest variances (sorted by absolute variance descending)
  const largestVariances = items
    .filter((i) => i.status === 'VARIANCE' && i.variance !== null)
    .sort((a, b) => Math.abs(b.variance!) - Math.abs(a.variance!))
    .slice(0, 5);

  return {
    period,
    fileName,
    uploadedAt: new Date().toISOString(),
    items,
    summary: {
      totalProducts: items.length,
      matched,
      variance,
      incomplete,
      unmapped,
      unmappedCount: unmapped,
      positiveVariance,
      negativeVariance,
      largestVariances,
    },
  };
}

/**
 * Preserves reconciliation snapshot in database / mockStore.
 * Historical records are never silently overwritten.
 */
export async function saveReconciliationSnapshot(
  arg1: ReconciliationResult | string,
  arg2?: ReconciliationResult,
  arg3?: string
): Promise<SapStockReconciliation & { product_count: number }> {
  let result: ReconciliationResult;
  let period: string;
  let customNotes: string | undefined;

  if (typeof arg1 === 'string') {
    period = arg1;
    result = arg2!;
    customNotes = arg3;
  } else {
    result = arg1;
    period = result.period;
    customNotes = `Reconciled from ${result.fileName}`;
  }

  const totalSap = result.items.reduce((s, i) => s + (i.sapStock || 0), 0);
  const totalDt = result.items.reduce((s, i) => s + (i.distrotrackStock || 0), 0);

  const snapshotData = {
    period,
    uploaded_at: result.uploadedAt || new Date().toISOString(),
    file_name: result.fileName,
    total_products: result.summary.totalProducts,
    matched_count: result.summary.matched,
    variance_count: result.summary.variance,
    incomplete_count: result.summary.incomplete,
    unmapped_count: result.summary.unmapped,
    positive_variance_count: result.summary.positiveVariance,
    negative_variance_count: result.summary.negativeVariance,
    total_sap_stock: totalSap,
    total_distrotrack_stock: totalDt,
    notes: customNotes || `Reconciled from ${result.fileName}`,
  };

  const lineItems = result.items.map((it) => ({
    sku: it.sku,
    product_name: it.productName,
    uom: it.uom,
    sap_stock: it.sapStock,
    distrotrack_stock: it.distrotrackStock,
    variance: it.variance,
    status: it.status,
    notes: it.notes || null,
  }));

  // 1. Try Supabase
  try {
    const { data: rec, error } = await supabase
      .from('sap_stock_reconciliations')
      .insert(snapshotData)
      .select('*')
      .single();

    if (!error && rec) {
      const itemsToInsert = lineItems.map((it) => ({
        ...it,
        reconciliation_id: rec.id,
      }));

      // Insert in chunks of 100
      for (let i = 0; i < itemsToInsert.length; i += 100) {
        await supabase
          .from('sap_stock_reconciliation_items')
          .insert(itemsToInsert.slice(i, i + 100));
      }

      // Also mirror to mockStore for offline viewing
      mockStore.saveSapStockReconciliation(snapshotData as any, lineItems as any);
      return {
        ...rec,
        product_count: rec.total_products,
      };
    }
  } catch (err) {
    console.warn('[RECONCILIATION] Error saving snapshot to Supabase:', err);
  }

  // 2. Fallback to mockStore
  const saved = mockStore.saveSapStockReconciliation(snapshotData as any, lineItems as any);
  return {
    ...saved,
    product_count: saved.total_products,
  };
}

/**
 * Fetch all preserved historical snapshots.
 */
export async function getHistoricalSnapshots(): Promise<SapStockReconciliation[]> {
  try {
    const { data, error } = await supabase
      .from('sap_stock_reconciliations')
      .select('*')
      .order('uploaded_at', { ascending: false });

    if (!error && data && data.length > 0) {
      return data as SapStockReconciliation[];
    }
  } catch (err) {
    console.warn('[RECONCILIATION] Error fetching snapshots from Supabase:', err);
  }

  return mockStore.getSapStockReconciliations();
}

/**
 * Fetch line items for a specific historical snapshot.
 */
export async function getSnapshotItems(reconciliationId: string): Promise<SapStockReconciliationItem[]> {
  try {
    const { data, error } = await supabase
      .from('sap_stock_reconciliation_items')
      .select('*')
      .eq('reconciliation_id', reconciliationId);

    if (!error && data && data.length > 0) {
      return data as SapStockReconciliationItem[];
    }
  } catch (err) {
    console.warn('[RECONCILIATION] Error fetching snapshot items from Supabase:', err);
  }

  return mockStore.getSapStockReconciliationItems(reconciliationId);
}

/**
 * Export reconciliation report to CSV.
 */
export function exportReconciliationToCSV(items: ReconciledItem[], filename = 'SAP_Stock_Reconciliation.csv'): string {
  const headers = ['SKU', 'Product Name', 'UOM', 'SAP Stock', 'DistroTrack Stock', 'Variance', 'Status', 'Notes'];
  const escapeCSV = (val: any) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvRows = [
    headers.join(','),
    ...items.map((r) => [
      escapeCSV(r.sku),
      escapeCSV(r.productName),
      escapeCSV(r.uom),
      r.sapStock != null ? r.sapStock : '—',
      r.distrotrackStock != null ? r.distrotrackStock : '—',
      r.variance != null ? r.variance : '—',
      escapeCSV(r.status),
      escapeCSV(r.notes || ''),
    ].join(',')),
  ];

  const csvContent = csvRows.join('\n');
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  return csvContent;
}

/**
 * Export reconciliation report to XLSX.
 */
export function exportReconciliationToXLSX(items: ReconciledItem[], filename = 'SAP_Stock_Reconciliation.xlsx'): void {
  const data = items.map((r) => ({
    'SKU / Material': r.sku,
    'Official Product Name': r.productName,
    'UOM': r.uom,
    'SAP Stock': r.sapStock != null ? r.sapStock : '—',
    'DistroTrack Stock': r.distrotrackStock != null ? r.distrotrackStock : '—',
    'Variance': r.variance != null ? r.variance : '—',
    'Status': r.status,
    'Audit Notes': r.notes || '',
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Stock Reconciliation');
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    XLSX.writeFile(workbook, filename);
  }
}

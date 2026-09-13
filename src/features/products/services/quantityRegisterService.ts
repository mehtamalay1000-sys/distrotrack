import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import { findProductMasterEntry, getOfficialProductName } from '@/features/products/data/productMaster';
import type { ProductQuantityRegisterRow, Product } from '@/lib/database.types';
import * as XLSX from 'xlsx';

export type AggregationMode = 'detailed' | 'product' | 'sku' | 'date' | 'route' | 'picklist' | 'brand' | 'category';

export interface QuantityRegisterFilter {
  startDate?: string;
  endDate?: string;
  routeCode?: string;
  searchQuery?: string;
  aggregation?: AggregationMode;
}

export interface QuantityRegisterSummary {
  totalPicklistQty: number;
  totalDeliveredQty: number;
  totalReturnedQty: number;
  totalNetSoldQty: number;
  totalSalesAmount: number;
  rowCount: number;
}

export interface AggregatedRegisterRow {
  key: string;
  label: string;
  subLabel?: string;
  uom: string;
  picklistQty: number;
  deliveredQty: number;
  returnedQty: number;
  netSoldQty: number;
  avgRate: number;
  avgMrp: number;
  totalSalesAmount: number;
  recordsCount: number;
}

/**
 * Derives Product Quantity Register rows from authoritative operational data.
 * Checks Supabase first, falls back to mockStore if offline or in demo mode.
 */
export async function getProductQuantityRegister(filter?: QuantityRegisterFilter): Promise<{
  rows: ProductQuantityRegisterRow[];
  summary: QuantityRegisterSummary;
}> {
  let picklists: any[] = [];
  let deliveries: any[] = [];
  let deliveryItems: any[] = [];
  let routes: any[] = [];
  let products: Product[] = [];

  try {
    const [plRes, delRes, itemsRes, rRes, prodRes] = await Promise.all([
      supabase.from('picklists').select('*'),
      supabase.from('deliveries').select('*'),
      supabase.from('delivery_items').select('*'),
      supabase.from('routes').select('*'),
      supabase.from('products').select('*'),
    ]);

    if (plRes.data && plRes.data.length > 0) {
      picklists = plRes.data;
      deliveries = delRes.data || [];
      deliveryItems = itemsRes.data || [];
      routes = rRes.data || [];
      products = (prodRes.data as Product[]) || [];
    }
  } catch (err) {
    console.warn('[QUANTITY REGISTER] Supabase query error, using mockStore:', err);
  }

  // Fallback to mockStore
  if (picklists.length === 0) {
    picklists = mockStore.getPicklists();
    deliveries = mockStore.getDeliveries();
    deliveryItems = mockStore.getDeliveryItems();
    routes = mockStore.getRoutes();
    products = mockStore.getProducts();
  }

  const routeMap = new Map<string, any>(routes.map((r) => [r.id, r]));
  const picklistMap = new Map<string, any>(picklists.map((p) => [p.id, p]));
  const deliveryMap = new Map<string, any>(deliveries.map((d) => [d.id, d]));
  const productMap = new Map<string, Product>();
  for (const p of products) {
    productMap.set(p.sku.toUpperCase(), p);
  }

  const rawRows: ProductQuantityRegisterRow[] = [];

  // 1. Process from delivery_items (most granular authoritative delivery records)
  for (const di of deliveryItems) {
    const del = deliveryMap.get(di.delivery_id);
    const pl = del?.picklist_id ? picklistMap.get(del.picklist_id) : null;
    const rt = del?.route_id ? routeMap.get(del.route_id) : pl?.route_id ? routeMap.get(pl.route_id) : null;

    const date = del?.delivery_date || (del?.delivered_at ? del.delivered_at.split('T')[0] : null) || pl?.date || new Date().toISOString().split('T')[0];
    const picklistNumber = pl?.picklist_number || (del?.picklist_id ? `PL-${del.picklist_id.slice(-6)}` : 'PL-DIRECT');
    const picklistId = pl?.id || del?.picklist_id || '';
    const routeCode = rt?.code || del?.route_code || 'R-GEN';
    const routeName = rt?.name || 'Standard Route';

    const sku = String(di.sku || '').trim();
    if (!sku) continue;

    // Resolve canonical SAP product master attributes
    const master = findProductMasterEntry(sku);
    const officialName = master?.name || getOfficialProductName(sku) || di.product_name || `SKU ${sku}`;
    const brand = master?.brand || 'Colgate';
    const category = master?.category || 'Oral Care';
    const uom = master?.uom || 'EA';

    const ordered = Number(di.ordered_qty || 0);
    const delivered = di.delivered_qty !== undefined && di.delivered_qty !== null
      ? Number(di.delivered_qty)
      : del?.status === 'delivered' || del?.status === 'partial'
      ? Number(di.delivered_qty || ordered)
      : del?.status === 'failed' || del?.status === 'refused' || del?.status === 'cancelled'
      ? 0
      : Number(di.ordered_qty || 0);

    const damagedOrReturned = Number((di as any).damaged_qty || (di as any).returned_qty || 0);
    const returned = damagedOrReturned > 0 ? damagedOrReturned : Math.max(0, ordered - delivered);
    const netSold = Math.max(0, delivered - returned);

    const rate = Number(di.rate || di.mrp_at_sale || di.mrp || master?.mrp || 50);
    // Historical transaction pricing integrity: Prioritize transaction snapshot (mrp_at_sale / mrp) over dynamic Product Master
    const mrp = Number(di.mrp_at_sale ?? di.mrp ?? master?.mrp ?? rate);
    const salesAmount = netSold * rate;

    rawRows.push({
      date,
      picklistNumber,
      picklistId,
      routeCode,
      routeName,
      sku,
      productName: officialName,
      brand,
      category,
      uom,
      picklistQty: ordered,
      deliveredQty: delivered,
      returnedQty: returned,
      netSoldQty: netSold,
      rate,
      mrp,
      salesAmount,
    });
  }

  // 2. If no delivery items were generated yet (e.g. newly imported picklists), extract from picklist_items
  if (rawRows.length === 0) {
    const plItems = mockStore.getPicklistItems();
    for (const pi of plItems) {
      const pl = picklistMap.get(pi.picklist_id);
      const rt = pl?.route_id ? routeMap.get(pl.route_id) : null;
      const sku = String(pi.sku || '').trim();
      if (!sku) continue;

      const master = findProductMasterEntry(sku);
      const officialName = master?.name || pi.product_name || `SKU ${sku}`;
      const brand = master?.brand || 'Colgate';
      const category = master?.category || 'Oral Care';
      const uom = master?.uom || 'EA';

      const qty = Number(pi.quantity || 0);
      const rate = Number(pi.rate || pi.mrp_at_sale || pi.mrp || master?.mrp || 50);
      const amount = Number(pi.amount || qty * rate);
      // Historical transaction pricing integrity: Prioritize transaction snapshot (mrp_at_sale / mrp) over dynamic Product Master
      const mrp = Number(pi.mrp_at_sale ?? pi.mrp ?? master?.mrp ?? rate);

      rawRows.push({
        date: pl?.date || new Date().toISOString().split('T')[0],
        picklistNumber: pl?.picklist_number || 'PL-SAMPLE',
        picklistId: pi.picklist_id,
        routeCode: rt?.code || 'R-GEN',
        routeName: rt?.name || 'General Route',
        sku,
        productName: officialName,
        brand,
        category,
        uom,
        picklistQty: qty,
        deliveredQty: pl?.status === 'completed' ? qty : 0,
        returnedQty: 0,
        netSoldQty: pl?.status === 'completed' ? qty : 0,
        rate,
        mrp,
        salesAmount: pl?.status === 'completed' ? amount : 0,
      });
    }
  }

  // 3. Filter rows
  let filtered = rawRows;

  if (filter?.startDate) {
    filtered = filtered.filter((r) => r.date >= filter.startDate!);
  }
  if (filter?.endDate) {
    filtered = filtered.filter((r) => r.date <= filter.endDate!);
  }
  if (filter?.routeCode && filter.routeCode !== 'all') {
    const rMatch = filter.routeCode.toLowerCase();
    filtered = filtered.filter((r) => r.routeCode.toLowerCase().includes(rMatch) || r.routeName.toLowerCase().includes(rMatch));
  }
  if (filter?.searchQuery) {
    const q = filter.searchQuery.toLowerCase().trim();
    filtered = filtered.filter(
      (r) =>
        r.sku.toLowerCase().includes(q) ||
        r.productName.toLowerCase().includes(q) ||
        (r.brand || '').toLowerCase().includes(q) ||
        (r.category || '').toLowerCase().includes(q) ||
        r.picklistNumber.toLowerCase().includes(q)
    );
  }

  // 4. Calculate grand summary totals
  let totalPicklistQty = 0;
  let totalDeliveredQty = 0;
  let totalReturnedQty = 0;
  let totalNetSoldQty = 0;
  let totalSalesAmount = 0;

  for (const r of filtered) {
    totalPicklistQty += r.picklistQty;
    totalDeliveredQty += r.deliveredQty;
    totalReturnedQty += r.returnedQty;
    totalNetSoldQty += r.netSoldQty;
    totalSalesAmount += r.salesAmount;
  }

  const summary: QuantityRegisterSummary = {
    totalPicklistQty,
    totalDeliveredQty,
    totalReturnedQty,
    totalNetSoldQty,
    totalSalesAmount,
    rowCount: filtered.length,
  };

  return { rows: filtered, summary };
}

/**
 * Aggregates Product Quantity Register rows by selected dimension.
 */
export function aggregateQuantityRegister(
  rows: ProductQuantityRegisterRow[],
  dimension: AggregationMode
): AggregatedRegisterRow[] {
  if (dimension === 'detailed') return [];

  const map = new Map<string, AggregatedRegisterRow>();

  for (const r of rows) {
    let key = '';
    let label = '';
    let subLabel: string | undefined = undefined;

    switch (dimension) {
      case 'product':
        key = r.productName;
        label = r.productName;
        subLabel = `SKU: ${r.sku} • ${r.brand || 'Colgate'}`;
        break;
      case 'sku':
        key = r.sku;
        label = r.sku;
        subLabel = r.productName;
        break;
      case 'date':
        key = r.date;
        label = r.date;
        break;
      case 'route':
        key = r.routeCode;
        label = r.routeName;
        subLabel = `Route: ${r.routeCode}`;
        break;
      case 'picklist':
        key = r.picklistNumber;
        label = r.picklistNumber;
        subLabel = `Date: ${r.date} • ${r.routeName}`;
        break;
      case 'brand':
        key = r.brand || 'Other';
        label = r.brand || 'Other';
        break;
      case 'category':
        key = r.category || 'Other';
        label = r.category || 'Other';
        break;
    }

    if (!map.has(key)) {
      map.set(key, {
        key,
        label,
        subLabel,
        uom: r.uom || 'EA',
        picklistQty: 0,
        deliveredQty: 0,
        returnedQty: 0,
        netSoldQty: 0,
        avgRate: r.rate,
        avgMrp: r.mrp,
        totalSalesAmount: 0,
        recordsCount: 0,
      });
    }

    const agg = map.get(key)!;
    agg.picklistQty += r.picklistQty;
    agg.deliveredQty += r.deliveredQty;
    agg.returnedQty += r.returnedQty;
    agg.netSoldQty += r.netSoldQty;
    agg.totalSalesAmount += r.salesAmount;
    agg.recordsCount += 1;
  }

  const result = Array.from(map.values());
  // Sort descending by Net Sold Qty then Sales Amount
  result.sort((a, b) => b.netSoldQty - a.netSoldQty || b.totalSalesAmount - a.totalSalesAmount);
  return result;
}

/**
 * Export Product Quantity Register to CSV.
 */
export function exportQuantityRegisterToCSV(rows: ProductQuantityRegisterRow[], filename = 'Product_Quantity_Register.csv'): string {
  const headers = [
    'Date', 'Picklist', 'Route Code', 'Route Name', 'SKU', 'Product Name',
    'Brand', 'Category', 'UOM', 'Picklist Qty', 'Delivered Qty', 'Returned Qty',
    'Net Sold Qty', 'Rate (INR)', 'MRP (INR)', 'Sales Amount (INR)'
  ];

  const escapeCSV = (val: any) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvRows = [
    headers.join(','),
    ...rows.map((r) => [
      escapeCSV(r.date),
      escapeCSV(r.picklistNumber),
      escapeCSV(r.routeCode),
      escapeCSV(r.routeName),
      escapeCSV(r.sku),
      escapeCSV(r.productName),
      escapeCSV(r.brand || ''),
      escapeCSV(r.category || ''),
      escapeCSV(r.uom),
      r.picklistQty,
      r.deliveredQty,
      r.returnedQty,
      r.netSoldQty,
      r.rate.toFixed(2),
      r.mrp.toFixed(2),
      r.salesAmount.toFixed(2),
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
 * Export Product Quantity Register to XLSX (Excel).
 */
export function exportQuantityRegisterToXLSX(rows: ProductQuantityRegisterRow[], filename = 'Product_Quantity_Register.xlsx'): void {
  const data = rows.map((r) => ({
    'Date': r.date,
    'Picklist': r.picklistNumber,
    'Route Code': r.routeCode,
    'Route Name': r.routeName,
    'SKU': r.sku,
    'Product Name': r.productName,
    'Brand': r.brand || 'Colgate',
    'Category': r.category || 'Oral Care',
    'UOM': r.uom,
    'Picklist Qty': r.picklistQty,
    'Delivered Qty': r.deliveredQty,
    'Returned Qty': r.returnedQty,
    'Net Sold Qty': r.netSoldQty,
    'Rate (INR)': r.rate,
    'MRP (INR)': r.mrp,
    'Sales Amount (INR)': r.salesAmount,
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Quantity Register');
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    XLSX.writeFile(workbook, filename);
  }
}

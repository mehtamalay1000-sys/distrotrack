import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import { SAP_PRODUCT_MASTER, findProductMasterEntry, findProductMasterByDescription } from '@/features/products/data/productMaster';
import type { Product } from '@/lib/database.types';

export async function getProducts(): Promise<Product[]> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('name');
    if (error || !data) {
      return mockStore.getProducts();
    }
    // Filter out any corrupt legacy entries
    const filtered = (data as Product[]).filter(p => p && p.name && !p.name.includes('ZTIN:') && !p.name.includes('TAX Invoice'));
    return filtered.length > 0 ? filtered : mockStore.getProducts();
  } catch {
    return mockStore.getProducts();
  }
}

export async function createProduct(input: {
  sku: string; name: string; category?: string; mrp?: number; rate?: number; unit?: string;
}): Promise<Product> {
  try {
    const { data, error } = await supabase
      .from('products')
      .insert({
        sku: input.sku, name: input.name,
        category: input.category ?? null, mrp: input.mrp ?? 0,
        rate: input.rate ?? 0, unit: input.unit ?? 'pcs', status: 'active',
      })
      .select()
      .single();
    if (error || !data) {
      return mockStore.saveProduct(input);
    }
    mockStore.saveProduct(data as Product);
    return data as Product;
  } catch {
    return mockStore.saveProduct(input);
  }
}

export async function updateProduct(id: string, input: Partial<Product>): Promise<Product> {
  try {
    const { data, error } = await supabase.from('products').update(input).eq('id', id).select().single();
    if (error || !data) {
      return mockStore.saveProduct({ id, ...input });
    }
    mockStore.saveProduct(data as Product);
    return data as Product;
  } catch {
    return mockStore.saveProduct({ id, ...input });
  }
}

export async function deleteProduct(id: string): Promise<void> {
  try {
    await supabase.from('products').delete().eq('id', id);
  } catch {
    // fallback
  }
  mockStore.deleteProduct(id);
}

// ── Product Master Operations ─────────────────────────────────────────

/**
 * Pure lookup by SKU — returns existing product or null.
 * Does NOT create or mutate a product. Checks Supabase first, then mockStore.
 * Normalizes SAP leading zeroes so variations of the same SKU match reliably.
 */
export async function lookupProductBySku(sku: string): Promise<Product | null> {
  const normalizedSku = sku.trim();
  if (!normalizedSku) return null;

  const unpaddedSku = normalizedSku.replace(/^0+/, '');

  // 1. Try Supabase
  try {
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('sku', normalizedSku)
      .maybeSingle();
    if (data) return data as Product;

    if (unpaddedSku && unpaddedSku !== normalizedSku) {
      const { data: unpaddedData } = await supabase
        .from('products')
        .select('*')
        .eq('sku', unpaddedSku)
        .maybeSingle();
      if (unpaddedData) return unpaddedData as Product;
    }
  } catch {
    // fallback to mockStore
  }

  // 2. Try mockStore
  const mockProducts = mockStore.getProducts();
  const found = mockProducts.find(
    p => p.sku === normalizedSku || (unpaddedSku && p.sku === unpaddedSku)
  );
  return found || null;
}

/**
 * Lookup-first product resolution for SAP import.
 */
export async function upsertProductBySku(
  sku: string,
  name: string,
  mrp: number = 0,
  rate: number = 0
): Promise<Product> {
  const normalizedSku = sku.trim();

  // 1. Try to find existing product by exact SKU
  const existing = await lookupProductBySku(normalizedSku);
  if (existing) {
    return existing;
  }

  // 2. Check Product Master for canonical values (by SKU or by Product Description)
  let masterEntry = findProductMasterEntry(normalizedSku);
  if (!masterEntry && name) {
    masterEntry = findProductMasterByDescription(name);
  }
  if (!masterEntry && sku) {
    masterEntry = findProductMasterByDescription(sku);
  }

  const finalSku = masterEntry?.sku || normalizedSku;
  const productName = masterEntry?.name || name;
  const productMrp = masterEntry?.mrp || (mrp > 0 ? mrp : 50);
  const productRate = rate > 0 ? rate : (masterEntry?.mrp || 50);
  const productCategory = masterEntry?.category || 'General';
  const productUnit = masterEntry?.unit || 'pcs';

  // Double check if product exists under resolved master SKU
  const existingMaster = await lookupProductBySku(finalSku);
  if (existingMaster) {
    return existingMaster;
  }

  if (!masterEntry) {
    console.warn(
      `[PRODUCT MASTER] New product discovered via import: SKU="${normalizedSku}", ` +
      `Name="${name}", MRP=${mrp}. Creating new product entry.`
    );
  }

  // 3. Create the product
  try {
    const { data, error } = await supabase
      .from('products')
      .insert({
        sku: normalizedSku,
        name: productName,
        category: productCategory,
        mrp: productMrp,
        rate: productRate,
        unit: productUnit,
        status: 'active',
      })
      .select()
      .single();

    if (error || !data) {
      return mockStore.saveProduct({
        sku: normalizedSku,
        name: productName,
        category: productCategory ?? undefined,
        mrp: productMrp,
        rate: productRate,
        unit: productUnit,
      });
    }
    mockStore.saveProduct(data as Product);
    return data as Product;
  } catch {
    return mockStore.saveProduct({
      sku: normalizedSku,
      name: productName,
      category: productCategory ?? undefined,
      mrp: productMrp,
      rate: productRate,
      unit: productUnit,
    });
  }
}

/**
 * Seeds the Product Master into both Supabase and mockStore.
 */
export async function seedProductMaster(): Promise<{
  created: number;
  skipped: number;
  errors: string[];
}> {
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const entry of SAP_PRODUCT_MASTER) {
    try {
      const existing = await lookupProductBySku(entry.sku);
      if (existing) {
        skipped++;
        continue;
      }

      await upsertProductBySku(entry.sku, entry.name, entry.mrp, entry.mrp);
      created++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${entry.sku}: ${msg}`);
    }
  }

  console.log(
    `[PRODUCT MASTER] Seed complete: ${created} created, ${skipped} skipped, ${errors.length} errors`
  );

  return { created, skipped, errors };
}

// ── Monthly Sales & Route Analytics ───────────────────────────────────

export interface ProductMonthlyStat {
  sku: string;
  name: string;
  category: string;
  mrp: number;
  rate: number;
  totalUnitsSold: number;
  totalFreeUnits: number;
  totalRevenue: number;
  percentageShare: number;
}

export interface RouteSalesItem {
  id: string;
  date: string;
  routeCode: string;
  routeName: string;
  partyCode: string;
  partyName: string;
  sku: string;
  productName: string;
  orderedQty: number;
  deliveredQty: number;
  freeQuantity: number;
  rate: number;
  amount: number;
}

/**
 * Aggregates monthly sales stats for all products for a given YYYY-MM month string.
 * Also identifies the Highest Selling Product of the month.
 */
export async function getProductMonthlyAnalytics(yearMonthStr: string): Promise<{
  productStats: ProductMonthlyStat[];
  highestSellingProduct: ProductMonthlyStat | null;
  totalUnitsSold: number;
  totalFreeUnits: number;
  totalRevenue: number;
}> {
  const products = await getProducts();

  let picklistsData: Array<{ id: string; date: string }> = [];
  let picklistItemsData: Array<{
    id: string;
    picklist_id: string;
    party_id: string;
    product_id: string | null;
    sku: string;
    product_name: string;
    quantity: number;
    free_quantity?: number;
    rate: number;
    amount: number;
  }> = [];

  // 1. Fetch real picklists and items from Supabase
  try {
    const { data: dbPicklists } = await supabase.from('picklists').select('id, date');
    if (dbPicklists && dbPicklists.length > 0) {
      picklistsData = dbPicklists;
      const { data: dbItems } = await supabase.from('picklist_items').select('*');
      if (dbItems && dbItems.length > 0) {
        picklistItemsData = dbItems as any;
      }
    }
  } catch (err) {
    console.error('Error fetching analytics from Supabase:', err);
  }

  // 2. Fallback to mockStore if Supabase has no picklist_items (with strict deduplication)
  if (picklistItemsData.length === 0) {
    const mockPicklists = mockStore.getPicklists();
    picklistsData = mockPicklists.map((pl) => ({ id: pl.id, date: pl.date }));

    const rawMockItems = mockStore.getPicklistItems();
    const seenKeys = new Set<string>();
    const deduped: typeof rawMockItems = [];

    for (const item of rawMockItems) {
      const key = item.id
        ? item.id
        : `${item.picklist_id}_${item.party_id}_${item.sku}_${item.quantity}_${item.amount}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        deduped.push(item);
      }
    }
    picklistItemsData = deduped as any;
  }

  const picklistDateMap = new Map<string, string>();
  picklistsData.forEach((pl) => {
    if (pl.date) picklistDateMap.set(pl.id, pl.date);
  });

  const statMap = new Map<string, { paid: number; free: number; rev: number; name: string }>();

  picklistItemsData.forEach((item) => {
    const plDate = picklistDateMap.get(item.picklist_id);
    if (plDate && plDate.startsWith(yearMonthStr)) {
      const sku = (item.sku || '').trim().toUpperCase();
      if (!sku) return;

      if (!statMap.has(sku)) {
        statMap.set(sku, { paid: 0, free: 0, rev: 0, name: item.product_name || '' });
      }
      const st = statMap.get(sku)!;
      st.paid += Number(item.quantity || 0);
      st.free += Number(item.free_quantity || 0);
      st.rev += Number(item.amount || 0);
    }
  });

  let grandTotalUnits = 0;
  let grandTotalFree = 0;
  let grandTotalRevenue = 0;

  statMap.forEach((val) => {
    grandTotalUnits += val.paid;
    grandTotalFree += val.free;
    grandTotalRevenue += val.rev;
  });

  const existingSkus = new Set(products.map((p) => p.sku.toUpperCase()));
  const allProducts = [...products];

  // Include any items sold in picklists that aren't yet in product master
  statMap.forEach((val, sku) => {
    if (!existingSkus.has(sku)) {
      allProducts.push({
        id: `auto-${sku}`,
        sku: sku,
        name: val.name || `Product ${sku}`,
        category: 'General',
        mrp: 0,
        rate: val.paid > 0 ? val.rev / val.paid : 0,
        unit: 'pcs',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  });

  const productStats: ProductMonthlyStat[] = allProducts.map((prod) => {
    const st = statMap.get(prod.sku.toUpperCase()) || { paid: 0, free: 0, rev: 0, name: prod.name };
    const share = grandTotalRevenue > 0 ? (st.rev / grandTotalRevenue) * 100 : 0;
    return {
      sku: prod.sku,
      name: prod.name,
      category: prod.category || 'General',
      mrp: prod.mrp,
      rate: prod.rate,
      totalUnitsSold: st.paid,
      totalFreeUnits: st.free,
      totalRevenue: st.rev,
      percentageShare: Math.round(share * 10) / 10,
    };
  });

  productStats.sort((a, b) => b.totalUnitsSold - a.totalUnitsSold || b.totalRevenue - a.totalRevenue);

  const highestSellingProduct =
    productStats.length > 0 && productStats[0].totalUnitsSold > 0 ? productStats[0] : null;

  return {
    productStats,
    highestSellingProduct,
    totalUnitsSold: grandTotalUnits,
    totalFreeUnits: grandTotalFree,
    totalRevenue: grandTotalRevenue,
  };
}

export async function getRouteSalesHistory(routeCode: string, dateStr: string): Promise<{
  items: RouteSalesItem[];
  totalDeliveredUnits: number;
  totalFreeUnits: number;
  totalSalesValue: number;
}> {
  let picklistsData: any[] = [];
  let picklistItemsData: any[] = [];
  let partiesData: any[] = [];
  let routesData: any[] = [];

  try {
    const { data: dbPicklists } = await supabase.from('picklists').select('*, route:routes(*)');
    const { data: dbItems } = await supabase.from('picklist_items').select('*');
    const { data: dbParties } = await supabase.from('parties').select('*');
    const { data: dbRoutes } = await supabase.from('routes').select('*');

    if (dbPicklists && dbPicklists.length > 0) {
      picklistsData = dbPicklists;
      picklistItemsData = dbItems || [];
      partiesData = dbParties || [];
      routesData = dbRoutes || [];
    }
  } catch (err) {
    console.error('Error fetching route sales history from Supabase:', err);
  }

  if (picklistsData.length === 0) {
    picklistsData = mockStore.getPicklists();
    const rawItems = mockStore.getPicklistItems();
    const seen = new Set<string>();
    picklistItemsData = rawItems.filter((item) => {
      const key = item.id
        ? item.id
        : `${item.picklist_id}_${item.party_id}_${item.sku}_${item.quantity}_${item.amount}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    partiesData = mockStore.getParties();
    routesData = mockStore.getRoutes();
  }

  const normRouteFilter = routeCode ? routeCode.trim().toLowerCase().replace(/\s+/g, '_') : '';
  const normDateFilter = dateStr ? dateStr.trim() : '';

  const matchingPicklists = picklistsData.filter((pl) => {
    const dateMatch = !normDateFilter || pl.date === normDateFilter;
    const rCode = pl.route?.code || '';
    const rName = pl.route?.name || '';
    const routeMatch =
      !normRouteFilter ||
      normRouteFilter === 'all' ||
      rCode.toLowerCase().replace(/\s+/g, '_').includes(normRouteFilter) ||
      rName.toLowerCase().replace(/\s+/g, '_').includes(normRouteFilter);
    return dateMatch && routeMatch;
  });

  const matchingPicklistIds = new Set(matchingPicklists.map((pl) => pl.id));
  const partyMap = new Map(partiesData.map((p) => [p.id, p]));
  const routeMap = new Map(routesData.map((r) => [r.id, r]));

  const resultItems: RouteSalesItem[] = [];
  let totalDeliveredUnits = 0;
  let totalFreeUnits = 0;
  let totalSalesValue = 0;

  picklistItemsData.forEach((item) => {
    if (matchingPicklistIds.has(item.picklist_id)) {
      const pl = picklistsData.find((p) => p.id === item.picklist_id);
      const party = partyMap.get(item.party_id);
      const route = pl?.route_id ? routeMap.get(pl.route_id) : null;

      const paidQty = Number(item.quantity || 0);
      const freeQty = Number(item.free_quantity || 0);
      const amt = Number(item.amount || 0);

      totalDeliveredUnits += paidQty;
      totalFreeUnits += freeQty;
      totalSalesValue += amt;

      resultItems.push({
        id: item.id,
        date: pl?.date || dateStr,
        routeCode: route?.code || pl?.route?.code || 'R-SAP',
        routeName: route?.name || pl?.route?.name || 'SAP Route',
        partyCode: party?.code || item.party_id || 'C000',
        partyName: party?.name || 'Customer Retailer',
        sku: item.sku,
        productName: item.product_name,
        orderedQty: paidQty,
        deliveredQty: paidQty,
        freeQuantity: freeQty,
        rate: Number(item.rate || 0),
        amount: amt,
      });
    }
  });

  return {
    items: resultItems,
    totalDeliveredUnits,
    totalFreeUnits,
    totalSalesValue,
  };
}

/**
 * Clears all imported sales data, picklists, and delivery line items.
 */
export async function clearAllSalesAnalyticsData(): Promise<void> {
  try {
    await supabase.from('picklist_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('delivery_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('deliveries').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('picklists').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('parties').update({ outstanding_amount: 0 }).neq('id', '00000000-0000-0000-0000-000000000000');
  } catch {
    // fallback
  }
  mockStore.clearAllImportedSalesData();
}

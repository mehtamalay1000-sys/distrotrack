import { supabase, isMockMode } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import { SAP_PRODUCT_MASTER, findProductMasterEntry, findProductMasterByDescription, registerProductMasterEntry, updateProductMasterMrp, resetProductMasterMemory } from '@/features/products/data/productMaster';
import type { Product, ProductMrpHistory } from '@/lib/database.types';

export interface ProductFilterOptions {
  search?: string;
  brand?: string;
  category?: string;
  status?: string;
}

export async function getProducts(filter?: ProductFilterOptions): Promise<Product[]> {
  let allProds: Product[] = [];
  if (isMockMode()) {
    allProds = mockStore.getProducts();
  } else {
    try {
      let query = supabase.from('products').select('*').order('name');
      if (filter?.brand && filter.brand !== 'All') {
        query = query.eq('brand', filter.brand);
      }
      if (filter?.category && filter.category !== 'All') {
        query = query.eq('category', filter.category);
      }
      if (filter?.status && filter.status !== 'All') {
        query = query.eq('status', filter.status);
      }

      const { data, error } = await query;
      if (error || !data) {
        allProds = [];
      } else {
        const filtered = (data as Product[]).filter(p => p && p.name && !p.name.includes('ZTIN:') && !p.name.includes('TAX Invoice'));
        allProds = filtered;
      }
    } catch {
      allProds = [];
    }
  }

  // Client-side filtering
  if (filter?.search) {
    const q = filter.search.toLowerCase().trim();
    allProds = allProds.filter(p =>
      p.sku.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      (p.brand || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q)
    );
  }
  if (filter?.brand && filter.brand !== 'All') {
    const targetBrand = filter.brand.toLowerCase().trim();
    allProds = allProds.filter(p => (p.brand || 'Colgate').toLowerCase().includes(targetBrand));
  }
  if (filter?.category && filter.category !== 'All') {
    const targetCat = filter.category.toLowerCase().trim();
    allProds = allProds.filter(p =>
      (p.category || 'General').toLowerCase() === targetCat ||
      (p.category || '').toLowerCase().includes(targetCat) ||
      (p.sub_category || '').toLowerCase().includes(targetCat)
    );
  }

  return allProds;
}

export async function createProduct(input: {
  sku: string; name: string; category?: string; mrp?: number; rate?: number; unit?: string;
  brand?: string; uom?: string;
}): Promise<Product> {
  try {
    const { data, error } = await supabase
      .from('products')
      .insert({
        sku: input.sku, name: input.name,
        category: input.category ?? null, mrp: input.mrp ?? 0,
        rate: input.rate ?? 0, unit: input.unit ?? 'pcs', status: 'active',
        brand: input.brand ?? 'Colgate', uom: input.uom ?? 'EA',
      })
      .select()
      .single();
    if (error || !data) {
      if (isMockMode()) {
        return mockStore.saveProduct(input);
      }
      throw new Error(`Failed to create product: ${error?.message || 'Unknown database error'}`);
    }
    if (isMockMode()) {
      mockStore.saveProduct(data as Product);
    }
    return data as Product;
  } catch (err: any) {
    if (isMockMode()) {
      return mockStore.saveProduct(input);
    }
    throw err;
  }
}

export async function updateProduct(id: string, input: Partial<Product>): Promise<Product> {
  try {
    const { data, error } = await supabase.from('products').update(input).eq('id', id).select().single();
    if (error || !data) {
      if (isMockMode()) {
        return mockStore.saveProduct({ id, ...input });
      }
      throw new Error(`Failed to update product: ${error?.message || 'Unknown database error'}`);
    }
    if (isMockMode()) {
      mockStore.saveProduct(data as Product);
    }
    return data as Product;
  } catch (err: any) {
    if (isMockMode()) {
      return mockStore.saveProduct({ id, ...input });
    }
    throw err;
  }
}

export async function deleteProduct(id: string): Promise<void> {
  try {
    await supabase.from('products').delete().eq('id', id);
  } catch {
    // fallback
  }
  if (isMockMode()) {
    mockStore.deleteProduct(id);
  }
}

// ── Product Master Operations ─────────────────────────────────────────

/**
 * Pure lookup by SKU — returns existing product or null.
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

  // 2. Try mockStore ONLY in mock mode
  if (isMockMode()) {
    const mockProducts = mockStore.getProducts();
    const found = mockProducts.find(
      p => p.sku.toUpperCase() === normalizedSku.toUpperCase() || (unpaddedSku && p.sku.toUpperCase() === unpaddedSku.toUpperCase())
    );
    if (found) return found;
  }

  return null;
}

/**
 * Cleans all current product records from the database and local memory stores.
 * Strictly requires explicit manualConfirmation flag to prevent any automatic deletion.
 */
export async function clearAllOperationalProducts(manualConfirmation?: boolean): Promise<{ count: number }> {
  if (!manualConfirmation) {
    console.warn('[GUARD] clearAllOperationalProducts blocked: explicit manualConfirmation required to delete inventory/products');
    return { count: 0 };
  }

  try {
    const { error } = await supabase.rpc('clean_all_operational_products');
    if (error) {
      await supabase.from('inventory_movements').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('delivery_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('deliveries').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('picklist_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('picklists').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('products').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    }
  } catch {
    // Supabase query optional
  }
  const prevCount = mockStore.getProducts().length;
  mockStore.resetToDefaults();
  resetProductMasterMemory();
  return { count: prevCount };
}

/**
 * Lookup-first product resolution for SAP import.
 * Strict rule: If SKU is not in Product Master, mark as UNMAPPED SKU and record exception.
 * Never silently create a fake product!
 */
export async function upsertProductBySku(
  sku: string,
  name: string,
  mrp: number = 0,
  rate: number = 0
): Promise<Product> {
  const normalizedSku = sku.trim();

  // 1. Try exact lookup by SKU
  const existing = await lookupProductBySku(normalizedSku);
  if (existing) {
    return existing;
  }

  // 2. Check Product Master for canonical values (by SKU or description)
  let masterEntry = findProductMasterEntry(normalizedSku);
  if (!masterEntry && name) {
    masterEntry = findProductMasterByDescription(name);
  }

  if (masterEntry) {
    // Found in SAP Master -> create verified product record
    const finalSku = masterEntry.sku;
    const existingMaster = await lookupProductBySku(finalSku);
    if (existingMaster) return existingMaster;

    try {
      const { data, error } = await supabase
        .from('products')
        .insert({
          sku: finalSku,
          name: masterEntry.name,
          category: masterEntry.category,
          mrp: masterEntry.mrp || mrp,
          rate: rate > 0 ? rate : masterEntry.mrp,
          unit: masterEntry.unit || 'pcs',
          status: 'active',
          brand: masterEntry.brand,
          uom: masterEntry.uom,
          sub_category: masterEntry.subCategory,
          sub_brand: masterEntry.subBrand,
          variant: masterEntry.variant,
          ppg: masterEntry.ppg,
          ppg_description: masterEntry.ppgDescription,
          material_group: masterEntry.materialGroup,
          prod_hierarchy: masterEntry.prodHierarchy,
          is_sap_master: true,
        })
        .select()
        .single();

      if (!error && data) {
        mockStore.saveProduct(data as Product);
        return data as Product;
      }
    } catch {
      // Fallback
    }

    return mockStore.saveProduct({
      sku: finalSku,
      name: masterEntry.name,
      category: masterEntry.category,
      mrp: masterEntry.mrp || mrp,
      rate: rate > 0 ? rate : masterEntry.mrp,
      unit: masterEntry.unit || 'pcs',
      brand: masterEntry.brand,
      uom: masterEntry.uom,
      is_sap_master: true,
    });
  }

  // 3. UNMAPPED SKU EXCEPTION: Do NOT guess or invent fake products!
  console.warn(`[PRODUCT MASTER] Unmapped SKU detected in import: ${normalizedSku} ("${name}"). Exposing as exception.`);

  // Record exception in mockStore and Supabase
  mockStore.saveUnmappedSkuException({
    sku: normalizedSku,
    imported_product_name: name || null,
    source_type: 'picklist',
  });

  try {
    await supabase.from('unmapped_sku_exceptions').upsert({
      sku: normalizedSku,
      imported_product_name: name || null,
      source_type: 'picklist',
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'sku' });
  } catch {
    // Non-blocking
  }

  // Create explicit UNMAPPED placeholder so operational records can link, clearly flagged
  const unmappedProduct: Product = {
    id: `unmapped-${normalizedSku}`,
    sku: normalizedSku,
    name: 'UNMAPPED SKU',
    category: 'Unmapped',
    mrp: mrp,
    rate: rate,
    unit: 'pcs',
    status: 'inactive',
    is_sap_master: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  mockStore.saveProduct(unmappedProduct);
  return unmappedProduct;
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
  sapUnits?: number;
  distrotrackUnits?: number;
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

export interface ProductMonthlyAnalyticsResult {
  productStats: ProductMonthlyStat[];
  highestSellingProduct: ProductMonthlyStat | null;
  totalUnitsSold: number;
  totalFreeUnits: number;
  totalRevenue: number;
  sapBaselineRevenue: number;
  sapBaselineUnits: number;
  distrotrackRevenue: number;
  distrotrackUnits: number;
  totalTransactions: number;
  uniqueCustomers: number;
  uniqueSkus: number;
}

/**
 * Aggregates monthly sales stats for all products for a given YYYY-MM month string.
 * Combines SAP baseline sales and DistroTrack operational sales without double-counting.
 * Also identifies the Highest Selling Product of the month.
 */
export async function getProductMonthlyAnalytics(yearMonthStr: string): Promise<ProductMonthlyAnalyticsResult> {
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

  let sapSalesItemsData: any[] = [];
  let sapImportsData: any[] = [];

  let isAnalyticsSupabaseSuccess = false;

  // 1. Fetch real picklists, items, and SAP baseline sales from Supabase
  try {
    const [dbPicklistsRes, dbItemsRes, dbSapRes, dbImpRes] = await Promise.all([
      supabase.from('picklists').select('id, date'),
      supabase.from('picklist_items').select('*'),
      supabase.from('sap_sales_import_items').select('*'),
      supabase.from('sap_sales_imports').select('*'),
    ]);

    if (!dbPicklistsRes.error && !dbItemsRes.error && !dbSapRes.error && !dbImpRes.error) {
      isAnalyticsSupabaseSuccess = true;
      picklistsData = dbPicklistsRes.data || [];
      picklistItemsData = (dbItemsRes.data as any) || [];
      sapSalesItemsData = dbSapRes.data || [];
      sapImportsData = dbImpRes.data || [];
    }
  } catch (err) {
    console.error('Error fetching analytics from Supabase:', err);
  }

  // 2. Fallback to mockStore if Supabase has no picklist_items (with strict deduplication)
  if (!isAnalyticsSupabaseSuccess || picklistItemsData.length === 0) {
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

  // Fallback to mockStore for SAP baseline sales ONLY if Supabase query failed
  if (!isAnalyticsSupabaseSuccess) {
    sapSalesItemsData = mockStore.getSapSalesImportItems();
    sapImportsData = mockStore.getSapSalesImports();
  }

  // Determine latest cutoff date for this month if available
  let latestCutoffDate: string | null = null;
  for (const imp of sapImportsData) {
    if (imp.cutoff_date && imp.cutoff_date.startsWith(yearMonthStr)) {
      if (!latestCutoffDate || imp.cutoff_date > latestCutoffDate) {
        latestCutoffDate = imp.cutoff_date;
      }
    }
  }

  const picklistDateMap = new Map<string, string>();
  picklistsData.forEach((pl) => {
    if (pl.date) picklistDateMap.set(pl.id, pl.date);
  });

  const statMap = new Map<string, {
    paid: number;
    free: number;
    rev: number;
    name: string;
    sapUnits: number;
    distrotrackUnits: number;
  }>();

  let sapBaselineRevenue = 0;
  let sapBaselineUnits = 0;
  let distrotrackRevenue = 0;
  let distrotrackUnits = 0;
  let sapTransactions = 0;
  let distroTransactions = 0;

  const uniqueCustomers = new Set<string>();
  const uniqueSkus = new Set<string>();

  // A. Process SAP baseline sales for the selected month
  for (const sItem of sapSalesItemsData) {
    const invDate = sItem.invoice_date || (sItem.created_at ? sItem.created_at.split('T')[0] : '');
    if (!invDate.startsWith(yearMonthStr)) continue;

    const sku = (sItem.sku || '').trim().toUpperCase();
    if (!sku) continue;

    const qty = Number(sItem.quantity || 0);
    const isCancel = Boolean(sItem.is_cancellation);
    const netUnits = isCancel ? -qty : qty;
    const netVal = Number(
      sItem.net_val !== null && sItem.net_val !== undefined
        ? sItem.net_val
        : (isCancel ? -qty : qty) * Number(sItem.rate || 0)
    );

    sapBaselineUnits += netUnits;
    sapBaselineRevenue += netVal;
    sapTransactions += 1;

    if (sItem.cust_code || sItem.cust_name) {
      uniqueCustomers.add(sItem.cust_code || sItem.cust_name);
    }
    uniqueSkus.add(sku);

    if (!statMap.has(sku)) {
      const master = findProductMasterEntry(sku);
      statMap.set(sku, {
        paid: 0,
        free: 0,
        rev: 0,
        name: master?.name || sItem.product_name || `Product ${sku}`,
        sapUnits: 0,
        distrotrackUnits: 0,
      });
    }

    const st = statMap.get(sku)!;
    st.paid += netUnits;
    st.rev += netVal;
    st.sapUnits += netUnits;
  }

  // B. Process DistroTrack operational picklist items for the selected month
  // Non-overlapping guarantee: picklists dated after latest cutoff date (or all if no cutoff)
  for (const item of picklistItemsData) {
    const plDate = picklistDateMap.get(item.picklist_id);
    if (plDate && plDate.startsWith(yearMonthStr)) {
      // If cutoff date exists for this month, operational transactions must be after cutoff
      if (latestCutoffDate && plDate <= latestCutoffDate) {
        // Prevent double counting of pre-go-live transactions
        continue;
      }

      const sku = (item.sku || '').trim().toUpperCase();
      if (!sku) continue;

      const qty = Number(item.quantity || 0);
      const freeQty = Number(item.free_quantity || 0);
      const rev = Number(item.amount || 0);

      distrotrackUnits += qty;
      distrotrackRevenue += rev;
      distroTransactions += 1;

      if (item.party_id) {
        uniqueCustomers.add(item.party_id);
      }
      uniqueSkus.add(sku);

      if (!statMap.has(sku)) {
        const master = findProductMasterEntry(sku);
        statMap.set(sku, {
          paid: 0,
          free: 0,
          rev: 0,
          name: master?.name || item.product_name || `Product ${sku}`,
          sapUnits: 0,
          distrotrackUnits: 0,
        });
      }

      const st = statMap.get(sku)!;
      st.paid += qty;
      st.free += freeQty;
      st.rev += rev;
      st.distrotrackUnits += qty;
    }
  }

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

  // Include any items sold that aren't yet in product master
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
    const st = statMap.get(prod.sku.toUpperCase()) || {
      paid: 0,
      free: 0,
      rev: 0,
      name: prod.name,
      sapUnits: 0,
      distrotrackUnits: 0,
    };
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
      sapUnits: st.sapUnits,
      distrotrackUnits: st.distrotrackUnits,
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
    sapBaselineRevenue,
    sapBaselineUnits,
    distrotrackRevenue,
    distrotrackUnits,
    totalTransactions: sapTransactions + distroTransactions,
    uniqueCustomers: uniqueCustomers.size,
    uniqueSkus: uniqueSkus.size,
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

// ── Unmapped SAP Product Master Creation ─────────────────────────────────

export interface AddUnmappedProductResult {
  status: 'created' | 'already_exists' | 'error';
  product?: Product;
  message?: string;
  error?: string;
}

export interface BulkAddUnmappedResult {
  total: number;
  createdCount: number;
  alreadyExistsCount: number;
  invalidCount: number;
  details: Array<{
    sku: string;
    name?: string;
    status: 'created' | 'already_exists' | 'invalid' | 'error';
    error?: string;
  }>;
}

/**
 * Adds an unmapped SAP product to the Product Master.
 * Calls secure server-side RPC `add_unmapped_sap_product` to enforce Owner/Admin authorization,
 * idempotent uniqueness by SKU, and audit logging.
 *
 * Synchronizes in-memory maps dynamically so immediate re-matching succeeds without page reloads.
 */
export async function addUnmappedSapProduct(
  input: {
    sku: string;
    name: string;
    uom?: string | null;
    category?: string | null;
    subCategory?: string | null;
    brand?: string | null;
    subBrand?: string | null;
    variant?: string | null;
    ppg?: string | null;
    ppgDescription?: string | null;
    materialGroup?: string | null;
    prodHierarchy?: string | null;
    mrp?: number | null;
    rate?: number | null;
    unit?: string | null;
  },
  importRef?: string
): Promise<AddUnmappedProductResult> {
  const cleanSku = (input.sku || '').trim().toUpperCase();
  const cleanName = (input.name || '').trim();

  if (!cleanSku) {
    return { status: 'error', error: 'SKU/Material code is required' };
  }
  if (!cleanName) {
    return { status: 'error', error: 'Product name/description is required' };
  }

  // 1. Try server-side RPC (enforces Owner/Admin role, idempotent constraint, audit log)
  try {
    const { data, error } = await supabase.rpc('add_unmapped_sap_product', {
      p_product: {
        sku: cleanSku,
        name: cleanName,
        uom: input.uom || null,
        category: input.category || null,
        sub_category: input.subCategory || null,
        brand: input.brand || null,
        sub_brand: input.subBrand || null,
        variant: input.variant || null,
        ppg: input.ppg || null,
        ppg_description: input.ppgDescription || null,
        material_group: input.materialGroup || null,
        prod_hierarchy: input.prodHierarchy || null,
        mrp: input.mrp ?? null,
        rate: input.rate ?? null,
        unit: input.unit || (input.uom?.toLowerCase() === 'doz' ? 'doz' : 'pcs'),
      },
      p_import_ref: importRef || 'SAP_PURCHASE_IMPORT',
    });

    if (!error && data) {
      const res = data as any;
      const returnedProd: Product = res.product || {
        id: `prod-sap-${cleanSku}`,
        sku: cleanSku,
        name: cleanName,
        category: input.category || null,
        mrp: input.mrp || 0,
        rate: input.rate || 0,
        unit: input.unit || (input.uom?.toLowerCase() === 'doz' ? 'doz' : 'pcs'),
        status: 'active',
        brand: input.brand || null,
        uom: input.uom || null,
        source: 'SAP_PURCHASE_IMPORT',
        is_sap_master: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Synchronize in-memory stores immediately
      mockStore.saveProduct(returnedProd);
      registerProductMasterEntry({
        sku: cleanSku,
        name: cleanName,
        mrp: Number(returnedProd.mrp || 0),
        category: returnedProd.category || 'General',
        unit: returnedProd.unit,
        brand: returnedProd.brand || undefined,
        uom: returnedProd.uom || undefined,
        active: returnedProd.active || undefined,
        subCategory: returnedProd.sub_category || undefined,
        subBrand: returnedProd.sub_brand || undefined,
        variant: returnedProd.variant || undefined,
        ppg: returnedProd.ppg || undefined,
        ppgDescription: returnedProd.ppg_description || undefined,
        materialGroup: returnedProd.material_group || undefined,
        prodHierarchy: returnedProd.prod_hierarchy || undefined,
      });

      return {
        status: res.status === 'already_exists' ? 'already_exists' : 'created',
        product: returnedProd,
        message: res.message,
      };
    }
  } catch (err: any) {
    console.warn('[productService] add_unmapped_sap_product RPC failed or offline:', err?.message);
  }

  // 2. Safe Fallback / Offline / Mock Mode
  const existing = mockStore.getProducts().find(
    (p) => p.sku.toUpperCase() === cleanSku || p.sku.toUpperCase() === cleanSku.replace(/^0+/, '')
  );
  if (existing) {
    return {
      status: 'already_exists',
      product: existing,
      message: `Product with SKU ${cleanSku} already exists in Product Master`,
    };
  }

  const newProd: Product = {
    id: `prod-sap-${cleanSku}`,
    sku: cleanSku,
    name: cleanName,
    category: input.category || null,
    mrp: input.mrp ?? 0,
    rate: input.rate ?? 0,
    unit: input.unit || (input.uom?.toLowerCase() === 'doz' ? 'doz' : 'pcs'),
    status: 'active',
    brand: input.brand || null,
    uom: input.uom || null,
    active: 'Y',
    sub_category: input.subCategory || null,
    sub_brand: input.subBrand || null,
    variant: input.variant || null,
    ppg: input.ppg || null,
    ppg_description: input.ppgDescription || null,
    material_group: input.materialGroup || null,
    prod_hierarchy: input.prodHierarchy || null,
    is_sap_master: true,
    source: 'SAP_PURCHASE_IMPORT',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  mockStore.saveProduct(newProd);
  registerProductMasterEntry({
    sku: cleanSku,
    name: cleanName,
    mrp: newProd.mrp,
    category: newProd.category || 'General',
    unit: newProd.unit,
    brand: newProd.brand || undefined,
    uom: newProd.uom || undefined,
    active: newProd.active || undefined,
    subCategory: newProd.sub_category || undefined,
    subBrand: newProd.sub_brand || undefined,
    variant: newProd.variant || undefined,
    ppg: newProd.ppg || undefined,
    ppgDescription: newProd.ppg_description || undefined,
    materialGroup: newProd.material_group || undefined,
    prodHierarchy: newProd.prod_hierarchy || undefined,
  });

  return {
    status: 'created',
    product: newProd,
    message: `Product ${cleanName} (${cleanSku}) added to Product Master`,
  };
}

/**
 * Bulk adds multiple unmapped SAP products into Product Master.
 */
export async function addBulkUnmappedSapProducts(
  products: Array<{
    sku: string;
    name: string;
    uom?: string | null;
    category?: string | null;
    subCategory?: string | null;
    brand?: string | null;
    subBrand?: string | null;
    variant?: string | null;
    ppg?: string | null;
    ppgDescription?: string | null;
    materialGroup?: string | null;
    prodHierarchy?: string | null;
    mrp?: number | null;
    rate?: number | null;
    unit?: string | null;
  }>,
  importRef?: string
): Promise<BulkAddUnmappedResult> {
  // 1. Try server RPC
  try {
    const formatted = products.map((p) => ({
      sku: (p.sku || '').trim().toUpperCase(),
      name: (p.name || '').trim(),
      uom: p.uom || null,
      category: p.category || null,
      sub_category: p.subCategory || null,
      brand: p.brand || null,
      sub_brand: p.subBrand || null,
      variant: p.variant || null,
      ppg: p.ppg || null,
      ppg_description: p.ppgDescription || null,
      material_group: p.materialGroup || null,
      prod_hierarchy: p.prodHierarchy || null,
      mrp: p.mrp ?? null,
      rate: p.rate ?? null,
      unit: p.unit || (p.uom?.toLowerCase() === 'doz' ? 'doz' : 'pcs'),
    }));

    const { data, error } = await supabase.rpc('add_bulk_unmapped_sap_products', {
      p_products: formatted,
      p_import_ref: importRef || 'SAP_PURCHASE_IMPORT',
    });

    if (!error && data) {
      const res = data as any;
      // Synchronize in-memory stores immediately
      for (const p of products) {
        if (p.sku && p.name) {
          const skuNorm = p.sku.trim().toUpperCase();
          const prod: Product = {
            id: `prod-sap-${skuNorm}`,
            sku: skuNorm,
            name: p.name.trim(),
            category: p.category || null,
            mrp: p.mrp || 0,
            rate: p.rate || 0,
            unit: p.unit || (p.uom?.toLowerCase() === 'doz' ? 'doz' : 'pcs'),
            status: 'active',
            brand: p.brand || null,
            uom: p.uom || null,
            source: 'SAP_PURCHASE_IMPORT',
            is_sap_master: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          mockStore.saveProduct(prod);
          registerProductMasterEntry({
            sku: skuNorm,
            name: p.name.trim(),
            mrp: prod.mrp,
            category: prod.category || 'General',
            unit: prod.unit,
            brand: prod.brand || undefined,
            uom: prod.uom || undefined,
          });
        }
      }
      return {
        total: res.total || products.length,
        createdCount: res.created_count || 0,
        alreadyExistsCount: res.already_exists_count || 0,
        invalidCount: res.invalid_count || 0,
        details: res.details || [],
      };
    }
  } catch (err: any) {
    console.warn('[productService] add_bulk_unmapped_sap_products RPC failed or offline:', err?.message);
  }

  // Fallback sequential addition
  let createdCount = 0;
  let alreadyExistsCount = 0;
  let invalidCount = 0;
  const details: BulkAddUnmappedResult['details'] = [];

  for (const p of products) {
    if (!p.sku || !p.sku.trim()) {
      invalidCount++;
      details.push({ sku: p.sku || '', status: 'invalid', error: 'Missing SKU' });
      continue;
    }
    if (!p.name || !p.name.trim()) {
      invalidCount++;
      details.push({ sku: p.sku, status: 'invalid', error: 'Missing product description' });
      continue;
    }

    const res = await addUnmappedSapProduct(p, importRef);
    if (res.status === 'created') {
      createdCount++;
      details.push({ sku: p.sku, name: p.name, status: 'created' });
    } else if (res.status === 'already_exists') {
      alreadyExistsCount++;
      details.push({ sku: p.sku, name: p.name, status: 'already_exists' });
    } else {
      invalidCount++;
      details.push({ sku: p.sku, name: p.name, status: 'error', error: res.error });
    }
  }

  return {
    total: products.length,
    createdCount,
    alreadyExistsCount,
    invalidCount,
    details,
  };
}

// ── Safe MRP Versioning Operations ──────────────────────────────────

export interface UpdateProductMrpInput {
  sku: string;
  newMrp: number;
  source?: string;
  importReference?: string;
  effectiveAt?: string;
}

export interface UpdateProductMrpResult {
  success: boolean;
  status: 'updated' | 'unchanged' | 'not_found' | 'error';
  sku: string;
  oldMrp?: number;
  newMrp: number;
  message: string;
  historyId?: string;
  error?: string;
}

export interface BulkUpdateMrpResult {
  total: number;
  updatedCount: number;
  unchangedCount: number;
  errorCount: number;
  details: Array<{
    sku: string;
    old_mrp?: number;
    new_mrp: number;
    status: 'updated' | 'unchanged' | 'not_found' | 'error';
    error?: string;
  }>;
}

/**
 * Updates a product's current MRP safely via server-side RPC (Stage 8 Security).
 * Automatically logs to product_mrp_history and master_audit_log.
 * NEVER alters historical transaction records.
 */
export async function updateProductMrp(input: UpdateProductMrpInput): Promise<UpdateProductMrpResult> {
  const normSku = (input.sku || '').trim().toUpperCase();
  const newMrp = Number(input.newMrp);

  if (!normSku || isNaN(newMrp) || newMrp <= 0) {
    return {
      success: false,
      status: 'error',
      sku: normSku,
      newMrp,
      message: 'Invalid SKU or MRP value',
      error: 'Invalid SKU or MRP value',
    };
  }

  try {
    const { data, error } = await supabase.rpc('update_product_mrp', {
      p_sku: normSku,
      p_new_mrp: newMrp,
      p_source: input.source || 'SAP_PURCHASE_IMPORT',
      p_import_reference: input.importReference || null,
      p_effective_at: input.effectiveAt || null,
    });

    if (error) {
      throw error;
    }

    if (data) {
      const res = data as any;
      // Sync in-memory master and mockStore
      updateProductMasterMrp(normSku, newMrp);
      mockStore.updateProductMrp(normSku, newMrp, input.source, input.importReference, undefined, input.effectiveAt);

      return {
        success: res.status === 'updated' || res.status === 'unchanged',
        status: res.status,
        sku: normSku,
        oldMrp: res.old_mrp !== undefined ? Number(res.old_mrp) : undefined,
        newMrp: res.new_mrp !== undefined ? Number(res.new_mrp) : newMrp,
        message: res.message || `MRP updated to ₹${newMrp}`,
        historyId: res.history_id,
      };
    }
  } catch (rpcErr: any) {
    console.warn('[productService] update_product_mrp RPC failed or offline:', rpcErr?.message);
  }

  // Fallback to mockStore & in-memory master
  const res = mockStore.updateProductMrp(
    normSku,
    newMrp,
    input.source || 'SAP_PURCHASE_IMPORT',
    input.importReference,
    undefined,
    input.effectiveAt
  );
  updateProductMasterMrp(normSku, newMrp);

  return {
    success: res.status === 'updated' || res.status === 'unchanged',
    status: res.status,
    sku: normSku,
    oldMrp: res.oldMrp,
    newMrp: res.newMrp,
    message: res.message,
  };
}

/**
 * Bulk updates multiple products' current MRP safely.
 * Only executes for SKUs confirmed by the Admin.
 */
export async function updateBulkProductMrp(
  updates: Array<{ sku: string; newMrp: number; effectiveAt?: string }>,
  importRef?: string,
  source: string = 'SAP_PURCHASE_IMPORT'
): Promise<BulkUpdateMrpResult> {
  if (!updates || updates.length === 0) {
    return { total: 0, updatedCount: 0, unchangedCount: 0, errorCount: 0, details: [] };
  }

  try {
    const rpcPayload = updates.map((u) => ({
      sku: u.sku.trim().toUpperCase(),
      new_mrp: Number(u.newMrp),
      effective_at: u.effectiveAt || null,
    }));

    const { data, error } = await supabase.rpc('update_bulk_product_mrp', {
      p_updates: rpcPayload,
      p_source: source,
      p_import_reference: importRef || null,
    });

    if (error) {
      throw error;
    }

    if (data) {
      const res = data as any;
      // Sync mockStore and in-memory master for each updated
      for (const u of updates) {
        updateProductMasterMrp(u.sku, u.newMrp);
        mockStore.updateProductMrp(u.sku, u.newMrp, source, importRef, undefined, u.effectiveAt);
      }
      return {
        total: res.total || updates.length,
        updatedCount: res.updated_count || 0,
        unchangedCount: res.unchanged_count || 0,
        errorCount: res.error_count || 0,
        details: res.details || [],
      };
    }
  } catch (rpcErr: any) {
    console.warn('[productService] update_bulk_product_mrp RPC failed or offline:', rpcErr?.message);
  }

  // Fallback sequential updates
  let updatedCount = 0;
  let unchangedCount = 0;
  let errorCount = 0;
  const details: BulkUpdateMrpResult['details'] = [];

  for (const u of updates) {
    const res = await updateProductMrp({
      sku: u.sku,
      newMrp: u.newMrp,
      source,
      importReference: importRef,
      effectiveAt: u.effectiveAt,
    });

    if (res.status === 'updated') {
      updatedCount++;
      details.push({ sku: u.sku, old_mrp: res.oldMrp, new_mrp: res.newMrp, status: 'updated' });
    } else if (res.status === 'unchanged') {
      unchangedCount++;
      details.push({ sku: u.sku, old_mrp: res.oldMrp, new_mrp: res.newMrp, status: 'unchanged' });
    } else {
      errorCount++;
      details.push({ sku: u.sku, new_mrp: u.newMrp, status: 'error', error: res.message });
    }
  }

  return {
    total: updates.length,
    updatedCount,
    unchangedCount,
    errorCount,
    details,
  };
}

/**
 * Fetch historical MRP audit trail for a SKU.
 */
export async function getProductMrpHistory(sku: string): Promise<ProductMrpHistory[]> {
  const normSku = (sku || '').trim().toUpperCase();
  if (!normSku) return [];

  try {
    const { data, error } = await supabase
      .from('product_mrp_history')
      .select('*')
      .eq('sku', normSku)
      .order('created_at', { ascending: false });

    if (!error && data && data.length > 0) {
      return data as ProductMrpHistory[];
    }
  } catch {
    // Fallback
  }

  return mockStore.getProductMrpHistory(normSku);
}



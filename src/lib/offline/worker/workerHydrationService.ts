// ================================================================
// DistroTrack v2 — Stage 9C: Worker Route Hydration Service
// File: src/lib/offline/worker/workerHydrationService.ts
// ================================================================

import { supabase as defaultSupabase } from '../../supabase.ts';
import {
  OFFLINE_STORES,
} from '../stores.ts';
import type {
  OfflineRoute,
  OfflinePicklist,
  OfflineParty,
  OfflineProduct,
  OfflineDelivery,
  OfflinePayment,
} from '../types.ts';
import {
  putRecord,
  getAllRecords,
} from '../db.ts';

export interface HydrationResult {
  routeId: string;
  picklistId: string;
  partiesCount: number;
  deliveriesCount: number;
  productsCount: number;
  paymentsCount: number;
  cachedAt: string;
}

export interface OfflineCachedRouteBundle {
  route: OfflineRoute | null;
  picklist: OfflinePicklist | null;
  deliveries: OfflineDelivery[];
  parties: OfflineParty[];
  products: OfflineProduct[];
  payments: OfflinePayment[];
  cachedAt: string | null;
  isStale?: boolean;
}

/**
 * Hydrates an authenticated worker's active assigned route into local IndexedDB storage.
 * Only the assigned route and its operational dependencies are cached (zero company-wide leakage).
 */
export async function hydrateWorkerRoute(
  workerId: string,
  workerName?: string,
  customSupabaseClient?: any
): Promise<HydrationResult | null> {
  if (!workerId || typeof workerId !== 'string') {
    throw new Error('Worker ID is required to hydrate offline route.');
  }

  const client = customSupabaseClient || defaultSupabase;

  // 1. Locate assigned picklist
  const workerIds = new Set<string>([workerId]);
  if (workerName) {
    const { data: matchedWorkers } = await client
      .from('workers')
      .select('id')
      .ilike('name', `%${workerName}%`);
    if (matchedWorkers) {
      matchedWorkers.forEach((w: any) => workerIds.add(w.id));
    }
  }

  const idList = Array.from(workerIds);

  // Fetch active assigned picklist
  const { data: picklistData, error: plError } = await client
    .from('picklists')
    .select('*, route:routes(*)')
    .in('worker_id', idList)
    .in('status', ['assigned', 'in_progress', 'confirmed', 'draft'])
    .order('created_at', { ascending: false })
    .limit(1);

  if (plError || !picklistData || picklistData.length === 0) {
    // Check routes table for direct assignment
    const { data: routeData } = await client
      .from('routes')
      .select('id')
      .in('assigned_worker_id', idList);

    if (!routeData || routeData.length === 0) {
      return null;
    }

    const routeIds = routeData.map((r: any) => r.id);
    const { data: plRouteData } = await client
      .from('picklists')
      .select('*, route:routes(*)')
      .in('route_id', routeIds)
      .in('status', ['assigned', 'in_progress', 'confirmed', 'draft'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (!plRouteData || plRouteData.length === 0) {
      return null;
    }

    return persistHydratedEntities(plRouteData[0], workerId, client);
  }

  return persistHydratedEntities(picklistData[0], workerId, client);
}

/**
 * Persists queried route entities atomically into IndexedDB stores.
 */
async function persistHydratedEntities(
  rawPicklist: any,
  workerId: string,
  client: any
): Promise<HydrationResult> {
  const cachedAt = new Date().toISOString();
  const rawRoute = rawPicklist.route || {};

  // 1. Transform Route
  const offlineRoute: OfflineRoute = {
    id: rawRoute.id || rawPicklist.route_id || `route-${rawPicklist.id}`,
    picklistId: rawPicklist.id,
    workerId: workerId,
    routeDate: rawRoute.route_date || rawPicklist.picklist_date || new Date().toISOString().split('T')[0],
    status: rawRoute.status || 'in_progress',
    name: rawRoute.name || 'Assigned Route',
    code: rawRoute.code,
    startedAt: rawRoute.started_at || rawPicklist.started_at || null,
    cachedAt,
    updatedAt: cachedAt,
  };
  await putRecord(OFFLINE_STORES.ROUTES, offlineRoute);

  // 2. Transform Picklist
  const offlinePicklist: OfflinePicklist = {
    id: rawPicklist.id,
    routeId: offlineRoute.id,
    workerId: workerId,
    status: rawPicklist.status || 'assigned',
    picklistDate: rawPicklist.picklist_date || new Date().toISOString().split('T')[0],
    picklistNumber: rawPicklist.picklist_number || `PL-${rawPicklist.id.slice(0, 8)}`,
    totalAmount: Number(rawPicklist.total_amount || 0),
    totalParties: Number(rawPicklist.total_parties || 0),
    totalItems: Number(rawPicklist.total_items || 0),
    cachedAt,
    updatedAt: cachedAt,
  };
  await putRecord(OFFLINE_STORES.PICKLISTS, offlinePicklist);

  // 3. Fetch Deliveries with Items
  const { data: rawDeliveries = [] } = await client
    .from('deliveries')
    .select('*, party:parties(*), items:delivery_items(*)')
    .eq('picklist_id', rawPicklist.id)
    .order('sequence_order', { ascending: true });

  const offlineDeliveries: OfflineDelivery[] = [];
  const partyMap = new Map<string, OfflineParty>();
  const productSet = new Set<string>();

  for (const rd of rawDeliveries || []) {
    const rawItems = rd.items || [];
    const items = rawItems.map((it: any) => {
      if (it.product_id) productSet.add(it.product_id);
      return {
        deliveryItemId: it.id,
        productId: it.product_id,
        sku: it.sku || 'SKU',
        productName: it.product_name || it.sku || 'Product',
        orderedQty: Number(it.ordered_qty || 0),
        deliveredQty: Number(it.delivered_qty || 0),
        freeQuantity: Number(it.free_quantity || 0),
        deliveredFreeQty: Number(it.delivered_free_qty || 0),
        returnedQty: Number(it.returned_qty || 0),
        returnedFreeQty: Number(it.returned_free_qty || 0),
        damagedQty: Number(it.damaged_qty || 0),
        damagedFreeQty: Number(it.damaged_free_qty || 0),
        rate: Number(it.rate || 0),
        amount: Number(it.amount || 0),
      };
    });

    const offDeliv: OfflineDelivery = {
      id: rd.id,
      deliveryId: rd.id,
      routeId: offlineRoute.id,
      picklistId: rawPicklist.id,
      partyId: rd.party_id,
      workerId: workerId,
      invoiceId: rd.invoice_id || null,
      status: rd.status || 'pending',
      items,
      paymentMode: rd.payment_mode,
      collectedAmount: Number(rd.collected_amount || 0),
      deliveredAmount: Number(rd.delivered_amount || 0),
      notes: rd.notes || null,
      createdAt: rd.created_at || cachedAt,
      updatedAt: cachedAt,
      syncState: 'synced',
    };
    offlineDeliveries.push(offDeliv);
    await putRecord(OFFLINE_STORES.DELIVERIES, offDeliv);

    // Collect Parties
    if (rd.party && !partyMap.has(rd.party.id)) {
      partyMap.set(rd.party.id, {
        id: rd.party.id,
        customerCode: rd.party.customer_code || `CUST-${rd.party.id.slice(0, 6)}`,
        customerName: rd.party.customer_name || rd.party.name || 'Customer',
        address: rd.party.address || null,
        phone: rd.party.phone || null,
        routeId: offlineRoute.id,
        picklistId: rawPicklist.id,
        outstandingAmount: Number(rd.party.outstanding_amount || 0),
        cachedAt,
        updatedAt: cachedAt,
      });
    }
  }

  // Persist Parties
  for (const party of partyMap.values()) {
    await putRecord(OFFLINE_STORES.PARTIES, party);
  }

  // 4. Fetch Products for Delivery SKUs
  let productsCount = 0;
  if (productSet.size > 0) {
    const { data: rawProducts = [] } = await client
      .from('products')
      .select('*')
      .in('id', Array.from(productSet));

    for (const rp of rawProducts || []) {
      const offProd: OfflineProduct = {
        id: rp.id,
        sku: rp.sku,
        name: rp.name,
        unit: rp.unit || 'PCS',
        mrp: Number(rp.mrp || 0),
        rate: Number(rp.rate || 0),
        availableQty: Number(rp.available_qty || 0),
        cachedAt,
        updatedAt: cachedAt,
      };
      await putRecord(OFFLINE_STORES.PRODUCTS, offProd);
      productsCount++;
    }
  }

  // 5. Fetch Route Payments
  const { data: rawPayments = [] } = await client
    .from('payments')
    .select('*')
    .eq('picklist_id', rawPicklist.id)
    .not('status', 'in', '("reversed","bounced")');

  let paymentsCount = 0;
  for (const rpay of rawPayments || []) {
    const offPay: OfflinePayment = {
      id: rpay.id,
      routeId: offlineRoute.id,
      picklistId: rawPicklist.id,
      partyId: rpay.party_id,
      workerId: workerId,
      deliveryId: rpay.delivery_id || null,
      invoiceId: rpay.invoice_id || null,
      paymentMethod: rpay.payment_mode || 'cash',
      amount: Number(rpay.amount || 0),
      reference: rpay.reference_number || null,
      chequeNumber: rpay.cheque_number || null,
      chequeDate: rpay.cheque_date || null,
      chequeBank: rpay.cheque_bank || null,
      notes: rpay.notes || null,
      createdAt: rpay.created_at || cachedAt,
      syncState: 'synced',
      idempotencyKey: rpay.idempotency_key || `synced:${rpay.id}`,
    };
    await putRecord(OFFLINE_STORES.PAYMENTS, offPay);
    paymentsCount++;
  }

  return {
    routeId: offlineRoute.id,
    picklistId: offlinePicklist.id,
    partiesCount: partyMap.size,
    deliveriesCount: offlineDeliveries.length,
    productsCount,
    paymentsCount,
    cachedAt,
  };
}

/**
 * Retrieves the previously hydrated assigned route and operational state from IndexedDB.
 * Used when running offline or when network connectivity fails.
 */
export async function getCachedWorkerRoute(workerId: string): Promise<OfflineCachedRouteBundle | null> {
  if (!workerId) return null;

  const routes = await getAllRecords<OfflineRoute>(OFFLINE_STORES.ROUTES);
  const myRoute = routes.find((r) => r.workerId === workerId) || null;

  if (!myRoute) {
    return null;
  }

  const picklists = await getAllRecords<OfflinePicklist>(OFFLINE_STORES.PICKLISTS);
  const myPicklist = picklists.find((p) => p.routeId === myRoute.id || p.workerId === workerId) || null;

  const allDeliveries = await getAllRecords<OfflineDelivery>(OFFLINE_STORES.DELIVERIES);
  const deliveries = myPicklist
    ? allDeliveries.filter((d) => d.picklistId === myPicklist.id || d.workerId === workerId)
    : allDeliveries.filter((d) => d.workerId === workerId);

  const parties = await getAllRecords<OfflineParty>(OFFLINE_STORES.PARTIES);
  const products = await getAllRecords<OfflineProduct>(OFFLINE_STORES.PRODUCTS);
  const payments = await getAllRecords<OfflinePayment>(OFFLINE_STORES.PAYMENTS);

  return {
    route: myRoute,
    picklist: myPicklist,
    deliveries,
    parties,
    products,
    payments,
    cachedAt: myRoute.cachedAt || null,
  };
}

/**
 * Check if the worker has a complete, valid route hydrated locally and ready for offline use.
 */
export async function isRouteOfflineReady(
  workerId: string
): Promise<{ ready: boolean; cachedAt: string | null; routeName?: string; deliveriesCount?: number }> {
  const cached = await getCachedWorkerRoute(workerId);
  if (!cached || !cached.route || !cached.picklist) {
    return { ready: false, cachedAt: null };
  }

  return {
    ready: true,
    cachedAt: cached.cachedAt,
    routeName: cached.route.name,
    deliveriesCount: cached.deliveries.length,
  };
}

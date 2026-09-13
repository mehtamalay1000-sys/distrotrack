import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type { Picklist, Delivery, PaymentMode, PicklistItem, RouteStockCheck, RouteReturnItemInput } from '@/lib/database.types';
import { addNotification } from '@/features/notifications/services/notificationService';
import { getLocalDateString } from '@/shared/utils/format';

// ── Query Functions ──────────────────────────────────────────────

/** Get today's assigned/in-progress picklist for a worker */
export async function getWorkerTodayRoute(workerId: string, workerName?: string): Promise<Picklist | null> {
  try {
    const workerIds = new Set<string>([workerId]);

    // Gather all matching worker IDs (by name if available)
    if (workerName) {
      const { data: matchedWorkers } = await supabase
        .from('workers')
        .select('id')
        .ilike('name', `%${workerName}%`);
      if (matchedWorkers) {
        matchedWorkers.forEach(w => workerIds.add(w.id));
      }
    } else {
      const { data: wRecord } = await supabase
        .from('workers')
        .select('id, name')
        .eq('id', workerId)
        .maybeSingle();
      if (wRecord && wRecord.name) {
        const { data: sameNameWorkers } = await supabase
          .from('workers')
          .select('id')
          .ilike('name', `%${wRecord.name}%`);
        if (sameNameWorkers) {
          sameNameWorkers.forEach(w => workerIds.add(w.id));
        }
      }
    }

    const idList = Array.from(workerIds);

    // 1. Direct picklists assigned to worker (by any matching worker ID)
    const { data: directData } = await supabase
      .from('picklists')
      .select('*, route:routes(*), worker:workers!picklists_worker_id_fkey(*)')
      .in('worker_id', idList)
      .in('status', ['assigned', 'in_progress', 'confirmed', 'draft'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (directData && directData.length > 0) {
      return directData[0] as Picklist;
    }

    // 2. Check picklists where the route is assigned to worker
    const { data: routeData } = await supabase
      .from('routes')
      .select('id')
      .in('assigned_worker_id', idList);

    if (routeData && routeData.length > 0) {
      const routeIds = routeData.map(r => r.id);
      const { data: picklistData } = await supabase
        .from('picklists')
        .select('*, route:routes(*), worker:workers!picklists_worker_id_fkey(*)')
        .in('route_id', routeIds)
        .in('status', ['assigned', 'in_progress', 'confirmed', 'draft'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (picklistData && picklistData.length > 0) {
        return picklistData[0] as Picklist;
      }
    }

    // 3. Fallback to mockStore picklists if Supabase returned nothing
    const mockPicklists = mockStore.getPicklists();
    const activeMock = mockPicklists.find(
      (p) =>
        idList.includes(p.worker_id || '') &&
        ['assigned', 'in_progress', 'confirmed', 'draft'].includes(p.status)
    );
    if (activeMock) return activeMock;

    return null;
  } catch {
    const mockPicklists = mockStore.getPicklists();
    const activeMock = mockPicklists.find(
      (p) =>
        (p.worker_id === workerId || (workerName && p.notes?.includes(workerName))) &&
        ['assigned', 'in_progress', 'confirmed', 'draft'].includes(p.status)
    );
    return activeMock || null;
  }
}

/** Get all deliveries for a picklist, ordered by sequence */
export async function getRouteDeliveries(picklistId: string): Promise<Delivery[]> {
  try {
    const { data, error } = await supabase
      .from('deliveries')
      .select('*, party:parties(*), invoice:invoices(*), items:delivery_items(*)')
      .eq('picklist_id', picklistId)
      .order('sequence_order', { ascending: true });
    if (!error && data && data.length > 0) {
      return data as Delivery[];
    }
  } catch {
    // fallback
  }

  const deliveries = mockStore.getDeliveries().filter((d) => d.picklist_id === picklistId);
  return deliveries as Delivery[];
}

/** Get a single delivery with all details */
export async function getDeliveryDetail(deliveryId: string): Promise<Delivery | null> {
  let delivery: Delivery | null = null;

  // 1. Try fetching from Supabase
  try {
    const { data, error } = await supabase
      .from('deliveries')
      .select('*, party:parties(*), invoice:invoices(*), items:delivery_items(*), payments(*)')
      .eq('id', deliveryId)
      .single();

    if (!error && data) {
      delivery = data as Delivery;
    }
  } catch {
    // ignore
  }

  // 2. Fallback to mockStore if not found in Supabase
  if (!delivery) {
    const deliveries = mockStore.getDeliveries();
    const found = deliveries.find((d: Delivery) => d.id === deliveryId);
    if (found) {
      delivery = { ...found };
    }
  }

  if (!delivery) return null;

  // Resolve real party name if party.name was stored as a code (e.g. 'C000727222' or '22228')
  if (delivery.party && (!delivery.party.name || /^[CS]?0*\d+$/i.test(delivery.party.name.trim()))) {
    const codeDigits = (delivery.party.code || delivery.party.name || '').replace(/[^0-9]/g, '');
    const allParties = mockStore.getParties();
    const realParty = allParties.find(
      (p) => p.code.replace(/[^0-9]/g, '') === codeDigits && p.name && !/^[CS]?0*\d+$/i.test(p.name)
    );
    if (realParty) {
      delivery.party.name = realParty.name;
    }
  }
  let items = delivery.items || [];

  // Stage A: Try loading from Supabase delivery_items by delivery_id
  if (items.length === 0) {
    try {
      const { data: delItems } = await supabase
        .from('delivery_items')
        .select('*')
        .eq('delivery_id', delivery.id);
      if (delItems && delItems.length > 0) {
        items = delItems as any;
      }
    } catch {
      // ignore
    }
  }

  // Stage B: Try loading from Supabase invoice_items if invoice_id is present
  if (items.length === 0 && delivery.invoice_id) {
    try {
      const { data: invItems } = await supabase
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', delivery.invoice_id);

      if (invItems && invItems.length > 0) {
        items = invItems.map((ii) => ({
          id: ii.id,
          delivery_id: delivery!.id,
          product_id: ii.product_id,
          sku: ii.sku,
          product_name: ii.product_name,
          ordered_qty: ii.quantity,
          delivered_qty: ii.quantity,
          free_quantity: ii.free_quantity || 0,
          delivered_free_qty: 0,
          returned_qty: 0,
          returned_free_qty: 0,
          damaged_qty: 0,
          damaged_free_qty: 0,
          rate: ii.rate,
          amount: ii.amount,
          notes: null,
        }));
      }
    } catch {
      // ignore
    }
  }

  // Stage C: Try loading from Supabase picklist_items if picklist_id is present
  if (items.length === 0 && delivery.picklist_id) {
    try {
      const { data: pliData } = await supabase
        .from('picklist_items')
        .select('*')
        .eq('picklist_id', delivery.picklist_id)
        .or(`party_id.eq.${delivery.party_id},party_id.eq.${delivery.party?.id || ''}`);

      if (pliData && pliData.length > 0) {
        items = pliData.map((pli) => ({
          id: pli.id,
          delivery_id: delivery!.id,
          product_id: pli.product_id,
          sku: pli.sku,
          product_name: pli.product_name,
          ordered_qty: pli.quantity,
          delivered_qty: pli.quantity,
          free_quantity: pli.free_quantity || 0,
          delivered_free_qty: 0,
          returned_qty: 0,
          returned_free_qty: 0,
          damaged_qty: 0,
          damaged_free_qty: 0,
          rate: pli.rate,
          amount: pli.amount,
          notes: null,
        }));
      }
    } catch {
      // ignore
    }
  }

  // Stage D: Search mockStore deliveryItems or picklistItems
  if (items.length === 0) {
    const allDeliveryItems = mockStore.getDeliveryItems();
    const mockDelItems = allDeliveryItems.filter((i: { delivery_id: string }) => i.delivery_id === deliveryId);

    if (mockDelItems.length > 0) {
      items = mockDelItems as any;
    } else {
      const allPickItems = mockStore.getPicklistItems();
      const partyId = delivery.party_id || delivery.party?.id || '';
      const partyCode = (delivery.party?.code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      // Numeric digits only (for matching e.g. 'C000727390' -> '727390')
      const partyDigits = partyCode.replace(/[^0-9]/g, '');

      const matchedPickItems = allPickItems.filter((pli: PicklistItem) => {
        // Match by picklist_id + party_id
        if (delivery.picklist_id && pli.picklist_id === delivery.picklist_id) {
          if (!pli.party_id) return true; // no party filter on this item, include all from this picklist
          const pliCode = (pli.party_id || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          const pliDigits = pliCode.replace(/[^0-9]/g, '');
          if (pli.party_id === partyId) return true;
          if (partyCode && pliCode === partyCode) return true;
          if (partyDigits && pliDigits === partyDigits) return true;
        }
        // Match by party_id directly
        if (pli.party_id === partyId) return true;
        const pliCode = (pli.party_id || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        const pliDigits = pliCode.replace(/[^0-9]/g, '');
        if (partyCode && pliCode && (pliCode === partyCode || pliCode.includes(partyCode) || partyCode.includes(pliCode))) return true;
        if (partyDigits && pliDigits && pliDigits === partyDigits) return true;
        return false;
      });

      if (matchedPickItems.length > 0) {
        items = matchedPickItems.map((pli: PicklistItem) => ({
          id: pli.id,
          delivery_id: delivery!.id,
          product_id: pli.product_id,
          sku: pli.sku,
          product_name: pli.product_name,
          ordered_qty: pli.quantity,
          delivered_qty: pli.quantity,
          free_quantity: pli.free_quantity || 0,
          delivered_free_qty: 0,
          returned_qty: 0,
          returned_free_qty: 0,
          damaged_qty: 0,
          damaged_free_qty: 0,
          rate: pli.rate,
          amount: pli.amount,
          notes: null,
        }));
      }

      // Stage D2: If still empty and delivery has a picklist_id, pull ALL items from that picklist and narrow by party
      if (items.length === 0 && delivery.picklist_id) {
        const allPlItems = allPickItems.filter((pli: PicklistItem) => pli.picklist_id === delivery.picklist_id);
        if (allPlItems.length > 0) {
          // Group by party and try to find the right party's items
          const partyItems = allPlItems.filter((pli: PicklistItem) => {
            if (!pli.party_id) return false;
            const pliDigits = (pli.party_id || '').replace(/[^0-9]/g, '');
            return pliDigits === partyDigits || pli.party_id === partyId;
          });
          const targetItems = partyItems.length > 0 ? partyItems : allPlItems;
          items = targetItems.map((pli: PicklistItem) => ({
            id: pli.id,
            delivery_id: delivery!.id,
            product_id: pli.product_id,
            sku: pli.sku,
            product_name: pli.product_name,
            ordered_qty: pli.quantity,
            delivered_qty: pli.quantity,
            free_quantity: pli.free_quantity || 0,
            delivered_free_qty: 0,
            returned_qty: 0,
            returned_free_qty: 0,
            damaged_qty: 0,
            damaged_free_qty: 0,
            rate: pli.rate,
            amount: pli.amount,
            notes: null,
          }));
        }
      }
    }
  }

  // Stage E: If items are still empty or invoice is missing, search invoices by party or amount
  if (items.length === 0 || !delivery.invoice) {
    try {
      const partyId = delivery.party_id || delivery.party?.id;
      if (partyId) {
        const { data: invList } = await supabase
          .from('invoices')
          .select('*, items:invoice_items(*)')
          .eq('party_id', partyId);

        let foundInv = invList && invList.length > 0 ? invList[0] : null;

        if (!foundInv && delivery.total_amount > 0) {
          const { data: amtInvs } = await supabase
            .from('invoices')
            .select('*, items:invoice_items(*)')
            .gte('net_amount', delivery.total_amount - 5)
            .lte('net_amount', delivery.total_amount + 5);
          if (amtInvs && amtInvs.length > 0) {
            foundInv = amtInvs[0];
          }
        }

        if (foundInv) {
          delivery.invoice = foundInv;
          delivery.invoice_id = foundInv.id;
          if (items.length === 0 && foundInv.items && foundInv.items.length > 0) {
            items = foundInv.items.map((ii: any) => ({
              id: ii.id,
              delivery_id: delivery!.id,
              product_id: ii.product_id,
              sku: ii.sku,
              product_name: ii.product_name,
              ordered_qty: ii.quantity,
              delivered_qty: ii.quantity,
              free_quantity: ii.free_quantity || 0,
              rate: ii.rate,
              amount: ii.amount,
              notes: null,
            }));
          }
        }
      }
    } catch {
      // ignore
    }
  }

  delivery.items = items;
  return delivery;
}

// ── Route Lifecycle ──────────────────────────────────────────────

/** Start a route — atomically moves physical stock from warehouse to vehicle via start_route_with_load */
export async function startRoute(picklistId: string, workerId?: string, _workerName?: string): Promise<void> {
  let stockShortageExceptionCaught = false;

  try {
    const { error } = await supabase.rpc('start_route_with_load', {
      p_picklist_id: picklistId,
      p_worker_id: workerId || null,
    });

    if (error) {
      const errMsg = (error.message || '').toLowerCase();
      if (errMsg.includes('insufficient warehouse stock')) {
        console.warn(`[ROUTE START] Warehouse stock shortage reported by RPC (${error.message}). Non-blocking exception policy applied.`);
        stockShortageExceptionCaught = true;

        // Try to log exception to route_stock_exceptions table directly
        try {
          const skuMatch = error.message.match(/SKU\s+([A-Z0-9_-]+)/i);
          const shortageSku = skuMatch ? skuMatch[1] : 'UNKNOWN';
          const pl = mockStore.getPicklists().find((p) => p.id === picklistId);
          await supabase.from('route_stock_exceptions').insert({
            route_id: pl?.route_id || null,
            picklist_id: picklistId,
            worker_id: workerId || pl?.worker_id || null,
            sku: shortageSku,
            notes: `Route started despite server stock shortage: ${error.message}`,
            status: 'open',
          });
        } catch {
          // ignore
        }
      } else if (
        errMsg.includes('fetch failed') ||
        errMsg.includes('failed to fetch') ||
        errMsg.includes('network') ||
        errMsg.includes('could not connect') ||
        errMsg.includes('schema cache')
      ) {
        console.warn('[ROUTE START] Supabase unreachable or offline, falling back to local route start workflow:', error.message);
      } else {
        // Legitimate authorization/validation error (wrong worker, not assigned, invalid state)
        throw new Error(`Failed to start route: ${error.message}`);
      }
    }
  } catch (err: any) {
    if (err.message && err.message.toLowerCase().includes('failed to start route')) {
      throw err;
    }
    console.warn('[ROUTE START] Network or RPC issue calling start_route_with_load, continuing locally:', err);
  }

  // Sync mockStore and evaluate local stock shortages
  const pl = mockStore.getPicklists().find((p) => p.id === picklistId);
  if (pl) {
    const assignedWorker = workerId || pl.worker_id;

    // Check mock picklist items for warehouse stock discrepancies
    const items = mockStore.getPicklistItems(picklistId);
    for (const it of items) {
      // Check if exception already exists or if shortage occurred
      if (stockShortageExceptionCaught) {
        mockStore.saveRouteStockException({
          route_id: pl.route_id || 'unknown',
          picklist_id: picklistId,
          worker_id: assignedWorker || 'unknown',
          product_id: it.product_id,
          sku: it.sku,
          required_quantity: it.quantity,
          recorded_warehouse_stock: 0,
          shortage_quantity: it.quantity,
          notes: `Route started despite warehouse stock shortage for SKU ${it.sku}`,
        });
      }
    }

    mockStore.savePicklist({
      ...pl,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      worker_id: assignedWorker || pl.worker_id,
    });
  }

  // Update mock deliveries status to out_for_delivery
  mockStore.getDeliveries()
    .filter((d) => d.picklist_id === picklistId && d.status === 'pending')
    .forEach((d) => {
      mockStore.saveDelivery({
        id: d.id,
        status: 'out_for_delivery',
      });
    });
}

/** End a route — finalize picklist, compute totals */
export async function endRoute(picklistId: string): Promise<void> {
  const now = new Date().toISOString();

  // 1. Get all deliveries from Supabase
  let dbDeliveries: any[] = [];
  try {
    const { data } = await supabase
      .from('deliveries')
      .select('*, payments(*)')
      .eq('picklist_id', picklistId);
    if (data) dbDeliveries = data;
  } catch {
    // fallback
  }

  // 2. Also check mockStore deliveries
  const mockDeliveries = mockStore.getDeliveries().filter((d) => d.picklist_id === picklistId);
  const combinedDeliveries = dbDeliveries.length > 0 ? dbDeliveries : mockDeliveries;

  let totalCollected = 0;
  let totalCash = 0;
  let totalUpi = 0;
  let totalCheque = 0;
  let totalCredit = 0;
  let completedParties = 0;

  for (const d of combinedDeliveries) {
    if (d.status === 'delivered' || d.status === 'partial') {
      completedParties++;
    }

    const dCollected = Number(d.collected_amount || 0);
    const dDelivered = Number(d.delivered_amount || d.total_amount || 0);

    // If payments array exists and has entries, use it
    if (d.payments && Array.isArray(d.payments) && d.payments.length > 0) {
      for (const p of d.payments) {
        const amt = Number(p.amount || 0);
        if (p.payment_mode === 'cash') totalCash += amt;
        else if (p.payment_mode === 'upi') totalUpi += amt;
        else if (p.payment_mode === 'cheque') totalCheque += amt;
        else if (p.payment_mode === 'credit') totalCredit += amt;
      }
    } else {
      // Direct delivery fallback
      if (d.payment_mode === 'cash') {
        const amt = dCollected > 0 ? dCollected : dDelivered;
        totalCash += amt;
      } else if (d.payment_mode === 'upi') {
        const amt = dCollected > 0 ? dCollected : dDelivered;
        totalUpi += amt;
      } else if (d.payment_mode === 'cheque') {
        const amt = dCollected > 0 ? dCollected : dDelivered;
        totalCheque += amt;
      } else if (d.payment_mode === 'credit') {
        totalCredit += dDelivered;
      }
    }
  }

  totalCollected = totalCash + totalUpi + totalCheque;

  // Update Supabase
  try {
    await supabase
      .from('picklists')
      .update({
        status: 'completed',
        completed_at: now,
        completed_parties: completedParties,
        total_collected: totalCollected,
        total_cash: totalCash,
        total_upi: totalUpi,
        total_cheque: totalCheque,
        total_credit: totalCredit,
      })
      .eq('id', picklistId);
  } catch (err) {
    console.warn('Could not update picklist in Supabase:', err);
  }

  // Update mockStore
  const pl = mockStore.getPicklists().find((p) => p.id === picklistId);
  if (pl) {
    mockStore.savePicklist({
      ...pl,
      status: 'completed',
      completed_at: now,
      completed_parties: completedParties,
      total_collected: totalCollected,
      total_cash: totalCash,
      total_upi: totalUpi,
      total_cheque: totalCheque,
      total_credit: totalCredit,
    });
  }

  // Audit log: route completed with financial summary
  try {
    await supabase.rpc('log_system_event', {
      p_user_id: '',
      p_user_name: 'Worker',
      p_role: 'worker',
      p_module: 'route',
      p_action: 'route_completed',
      p_status: 'success',
      p_detail: `Route ${picklistId} completed: ${completedParties} deliveries, ₹${totalCollected} collected (Cash ₹${totalCash}, UPI ₹${totalUpi}, Cheque ₹${totalCheque}, Credit ₹${totalCredit})`,
      p_entity_type: 'picklist',
      p_entity_id: picklistId,
    });
  } catch (auditErr) {
    console.warn('[AUDIT] Failed to log route_completed event:', auditErr);
  }
}

// ── Delivery Workflow ────────────────────────────────────────────

export interface CompleteDeliveryItemInput {
  delivery_item_id: string;
  delivered_qty: number;
  delivered_free_qty: number;
  returned_qty: number;
  returned_free_qty: number;
  damaged_qty: number;
  damaged_free_qty: number;
}

export interface CompleteDeliveryInput {
  deliveryId: string;
  picklistId: string;
  partyId: string;
  invoiceId: string | null;
  workerId: string;
  deliveredItems: CompleteDeliveryItemInput[];
  payment: {
    mode: PaymentMode;
    amount: number;
    reference_number?: string;
    cheque_number?: string;
    cheque_date?: string;
    cheque_bank?: string;
    notes?: string;
  };
  payments?: Array<{
    mode: PaymentMode;
    amount: number;
    reference_number?: string;
    cheque_number?: string;
    cheque_date?: string;
    cheque_bank?: string;
    notes?: string;
  }>;
}

/** Complete a party delivery atomically using RPC complete_delivery_with_ledger */
export async function completePartyDelivery(input: CompleteDeliveryInput): Promise<any> {
  const { data, error } = await supabase.rpc('complete_delivery_with_ledger', {
    p_delivery_id: input.deliveryId,
    p_worker_id: input.workerId,
    p_items: input.deliveredItems,
    p_payment_mode: input.payment.mode,
    p_payment_amount: input.payment.amount,
    p_reference_number: input.payment.reference_number || null,
    p_cheque_number: input.payment.cheque_number || null,
    p_cheque_date: input.payment.cheque_date || null,
    p_cheque_bank: input.payment.cheque_bank || null,
    p_notes: input.payment.notes || null,
    p_payments: input.payments && input.payments.length > 0 ? input.payments : null,
  });

  if (error) {
    throw new Error(`Delivery completion failed: ${error.message}`);
  }

  // Sync mockStore as fallback
  for (const item of input.deliveredItems) {
    mockStore.updateDeliveryItem(item.delivery_item_id, {
      delivered_qty: item.delivered_qty,
      delivered_free_qty: item.delivered_free_qty,
      returned_qty: item.returned_qty,
      returned_free_qty: item.returned_free_qty,
      damaged_qty: item.damaged_qty,
      damaged_free_qty: item.damaged_free_qty,
    });
  }

  const resultStatus = data?.status || 'delivered';
  const finalDeliveredAmount = data?.delivered_amount || input.payment.amount;

  mockStore.saveDelivery({
    id: input.deliveryId,
    status: resultStatus,
    delivered_at: new Date().toISOString(),
    delivered_amount: finalDeliveredAmount,
    collected_amount: input.payment.mode === 'credit' ? 0 : input.payment.amount,
    payment_mode: input.payment.mode,
  });

  mockStore.savePayment({
    delivery_id: input.deliveryId,
    party_id: input.partyId,
    invoice_id: input.invoiceId,
    worker_id: input.workerId,
    amount: input.payment.amount,
    payment_mode: input.payment.mode,
    payment_date: getLocalDateString(),
    cheque_number: input.payment.cheque_number,
    cheque_date: input.payment.cheque_date,
    cheque_bank: input.payment.cheque_bank,
    notes: input.payment.notes,
    status: input.payment.mode === 'credit' ? 'pending' : 'collected',
  });

    // 8. Trigger Realtime Notification
    try {
      const mockParties = mockStore.getParties();
      const partyObj = mockParties.find((p) => p.id === input.partyId);
      const partyName = partyObj?.name || 'Customer';

      const mockWorkers = mockStore.getWorkers();
      const workerObj = mockWorkers.find((w) => w.id === input.workerId);
      const workerName = workerObj?.name || 'Worker';

      const paymentDesc = input.payment.amount > 0
        ? ` (Collected ₹${input.payment.amount.toLocaleString('en-IN')} via ${input.payment.mode.toUpperCase()})`
        : ' (Payment pending)';

      // Notify Admin
      addNotification({
        recipient_role: 'admin',
        type: 'delivery',
        title: `Delivery Completed: ${partyName}`,
        message: `${workerName} completed delivery to ${partyName}${paymentDesc}.`,
        link: '/admin/deliveries',
      });

      // Notify Worker
      if (input.workerId) {
        addNotification({
          recipient_role: 'worker',
          recipient_worker_id: input.workerId,
          type: 'delivery',
          title: `Delivery Confirmed: ${partyName}`,
          message: `Your delivery to ${partyName} was recorded successfully${paymentDesc}.`,
          link: '/w/route',
        });
      }

      // 9. Audit log: delivery completed
      try {
        await supabase.rpc('log_system_event', {
          p_user_id: input.workerId,
          p_user_name: workerName,
          p_role: 'worker',
          p_module: 'delivery',
          p_action: 'delivery_completed',
          p_status: 'success',
          p_detail: `Delivery to ${partyName} — ₹${input.payment.amount} via ${input.payment.mode}`,
          p_entity_type: 'delivery',
          p_entity_id: input.deliveryId,
        });
      } catch (auditErr) {
        console.warn('[AUDIT] Failed to log delivery_completed event:', auditErr);
      }
    } catch (notifyErr) {
      console.error('Failed to dispatch delivery notification:', notifyErr);
    }
  }

// ── Stage 4B Route Stock Check & Reconciliation ───────────────────

/** Query authoritative vehicle stock balance for picklist run from inventory ledger */
export async function getRouteStockCheck(picklistId: string): Promise<RouteStockCheck> {
  const { data, error } = await supabase.rpc('check_route_stock', {
    p_picklist_id: picklistId,
  });

  if (error) {
    throw new Error(`Failed to check route stock: ${error.message}`);
  }

  return data as RouteStockCheck;
}

/** Atomically close route with physical return and reconciliation */
export async function closeRouteReconciliation(
  picklistId: string,
  workerId: string,
  returnItems: RouteReturnItemInput[]
): Promise<any> {
  const { data, error } = await supabase.rpc('close_route_with_reconciliation', {
    p_picklist_id: picklistId,
    p_worker_id: workerId,
    p_return_items: returnItems,
  });

  if (error) {
    throw new Error(`Route reconciliation failed: ${error.message}`);
  }

  // Sync mockStore
  const pl = mockStore.getPicklists().find((p) => p.id === picklistId);
  if (pl) {
    mockStore.savePicklist({
      ...pl,
      status: 'completed',
      completed_at: new Date().toISOString(),
    });
  }

  return data;
}

export interface RouteFinancialReconciliationInput {
  picklistId: string;
  workerId: string;
  actualCash: number;
  expenses?: Array<{
    category: string;
    amount: number;
    description?: string;
    payment_method?: string;
  }>;
  discrepancyAuthorized?: boolean;
  discrepancyReason?: string;
  actorId?: string;
}

/** Atomically reconcile route finances (cash, upi, cheque, credit, expenses, discrepancy) */
export async function reconcileRouteFinances(
  input: RouteFinancialReconciliationInput
): Promise<any> {
  const { data, error } = await supabase.rpc('reconcile_and_close_route_finances', {
    p_picklist_id: input.picklistId,
    p_worker_id: input.workerId,
    p_actual_cash: input.actualCash,
    p_expenses: input.expenses && input.expenses.length > 0 ? input.expenses : [],
    p_discrepancy_authorized: input.discrepancyAuthorized ?? false,
    p_discrepancy_reason: input.discrepancyReason || null,
    p_actor_id: input.actorId || input.workerId,
  });

  if (error) {
    throw new Error(`Financial reconciliation failed: ${error.message}`);
  }

  if (input.discrepancyAuthorized) {
    try {
      await supabase.rpc('log_system_event', {
        p_user_id: input.actorId || input.workerId,
        p_user_name: 'Admin',
        p_role: 'admin',
        p_module: 'reconciliation',
        p_action: 'cash_discrepancy_authorized',
        p_status: 'warning',
        p_detail: `Cash discrepancy authorized via PIN for picklist ${input.picklistId}. Reason: ${input.discrepancyReason || 'Authorized'}`,
        p_entity_type: 'picklist',
        p_entity_id: input.picklistId,
      });
    } catch {}
  }

  return data;
}

// ── Salesman Performance & Metrics ────────────────────────────────

export interface WorkerPerformanceMetrics {
  totalSales: number;
  totalRoutes: number;
  monthlyTarget: number;
  achievedSales: number;
  remainingTarget: number;
  progressPercent: number;
  topProduct: {
    name: string;
    unitsSold: number;
    revenue: number;
  } | null;
  allProductsList: {
    name: string;
    sku: string;
    unitsSold: number;
    revenue: number;
  }[];
  routesList: {
    id: string;
    name: string;
    date: string;
    partiesCount: number;
    amount: number;
    status: string;
  }[];
}

export async function getWorkerPerformanceMetrics(workerId: string, workerName?: string): Promise<WorkerPerformanceMetrics> {
  const workerIds = [workerId];

  // ── 1. Fetch worker's real monthly target from Supabase ──────────
  let monthlyTarget = 0;
  try {
    if (workerName) {
      const { data: matched } = await supabase
        .from('workers')
        .select('id, monthly_target')
        .ilike('name', `%${workerName}%`);
      if (matched && matched.length > 0) {
        monthlyTarget = Number(matched[0].monthly_target ?? 0);
        matched.forEach(w => { if (!workerIds.includes(w.id)) workerIds.push(w.id); });
      }
    }
    if (monthlyTarget === 0) {
      const { data: workerRow } = await supabase
        .from('workers')
        .select('monthly_target')
        .eq('id', workerId)
        .maybeSingle();
      if (workerRow && workerRow.monthly_target) {
        monthlyTarget = Number(workerRow.monthly_target);
      }
    }
  } catch {
    monthlyTarget = 0;
  }

  // Fallback to local store if Supabase worker table did not yield target
  if (monthlyTarget === 0) {
    const mockW = mockStore.getWorkers().find(w => w.id === workerId || (workerName && w.name.toLowerCase().includes(workerName.toLowerCase())));
    if (mockW && mockW.monthly_target) {
      monthlyTarget = Number(mockW.monthly_target);
    }
  }

  // ── 2. Fetch this worker's real picklists ────────────────────────
  let routesList: WorkerPerformanceMetrics['routesList'] = [];
  let totalRoutes = 0;
  let totalSales = 0;

  try {
    const { data: picklists } = await supabase
      .from('picklists')
      .select('id, picklist_number, date, total_parties, total_amount, total_collected, status, route:routes(name)')
      .in('worker_id', workerIds)
      .order('created_at', { ascending: false });

    if (picklists && picklists.length > 0) {
      const completed = picklists.filter(p => p.status === 'completed' || p.status === 'confirmed');
      totalRoutes = completed.length;
      totalSales = completed.reduce((sum, p) => sum + Number(p.total_collected ?? p.total_amount ?? 0), 0);

      routesList = picklists.map(p => ({
        id: p.id,
        name: (p.route as any)?.name || `Route ${p.picklist_number}`,
        date: p.date || '',
        partiesCount: p.total_parties || 0,
        amount: Number(p.total_collected ?? p.total_amount ?? 0),
        status: p.status,
      }));
    }
  } catch {
    // Supabase error — stay at zero
  }

  // ── 3. Fetch product performance from delivery_items ────────────
  const productMap: Record<string, { name: string; sku: string; units: number; revenue: number }> = {};

  try {
    const { data: picklists } = await supabase
      .from('picklists')
      .select('id')
      .eq('worker_id', workerId);

    if (picklists && picklists.length > 0) {
      const picklistIds = picklists.map(p => p.id);

      const { data: deliveries } = await supabase
        .from('deliveries')
        .select('id')
        .in('picklist_id', picklistIds)
        .in('status', ['delivered', 'partial']);

      if (deliveries && deliveries.length > 0) {
        const deliveryIds = deliveries.map(d => d.id);

        const { data: items } = await supabase
          .from('delivery_items')
          .select('product_name, sku, delivered_qty, rate, amount')
          .in('delivery_id', deliveryIds);

        if (items) {
          items.forEach(item => {
            const name = item.product_name || 'Unknown Product';
            const sku = item.sku || '';
            const qty = Number(item.delivered_qty ?? 0);
            const revenue = Number(item.amount ?? (qty * Number(item.rate ?? 0)));
            if (!productMap[name]) productMap[name] = { name, sku, units: 0, revenue: 0 };
            productMap[name].units += qty;
            productMap[name].revenue += revenue;
          });
        }
      }
    }
  } catch {
    // Stay empty
  }

  const allProductsList = Object.values(productMap)
    .sort((a, b) => b.revenue - a.revenue)
    .map(p => ({ name: p.name, sku: p.sku, unitsSold: p.units, revenue: p.revenue }));

  const topProduct = allProductsList.length > 0
    ? { name: allProductsList[0].name, unitsSold: allProductsList[0].unitsSold, revenue: allProductsList[0].revenue }
    : null;

  const achievedSales = totalSales;
  const remainingTarget = Math.max(0, monthlyTarget - achievedSales);
  const progressPercent = monthlyTarget > 0
    ? Math.min(100, Math.round((achievedSales / monthlyTarget) * 100))
    : 0;

  return {
    totalSales,
    totalRoutes,
    monthlyTarget,
    achievedSales,
    remainingTarget,
    progressPercent,
    topProduct,
    allProductsList,
    routesList,
  };
}

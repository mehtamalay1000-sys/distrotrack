import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type { Picklist, Delivery, PaymentMode, PicklistItem } from '@/lib/database.types';
import { addNotification } from '@/features/notifications/services/notificationService';

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
      .select('*, route:routes(*), worker:workers(*)')
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
        .select('*, route:routes(*), worker:workers(*)')
        .in('route_id', routeIds)
        .in('status', ['assigned', 'in_progress', 'confirmed', 'draft'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (picklistData && picklistData.length > 0) {
        return picklistData[0] as Picklist;
      }
    }

    // No active route found for this worker
    return null;
  } catch {
    return null;
  }
}

/** Get all deliveries for a picklist, ordered by sequence */
export async function getRouteDeliveries(picklistId: string): Promise<Delivery[]> {
  const { data, error } = await supabase
    .from('deliveries')
    .select('*, party:parties(*), invoice:invoices(*), items:delivery_items(*)')
    .eq('picklist_id', picklistId)
    .order('sequence_order', { ascending: true });
  if (error || !data) return [];
  return data as Delivery[];
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

  // 3. Ensure items array is populated with real items ONLY
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
      const partyCode = (delivery.party?.code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const partyId = delivery.party_id || delivery.party?.id || '';

      const matchedPickItems = allPickItems.filter((pli: PicklistItem) => {
        const pliPartyId = (pli.party_id || '').toUpperCase();
        return (
          pli.party_id === partyId ||
          (partyCode && pliPartyId && (pliPartyId === partyCode || pliPartyId.includes(partyCode) || partyCode.includes(pliPartyId)))
        );
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
          rate: pli.rate,
          amount: pli.amount,
          notes: null,
        }));
      }
    }
  }

  delivery.items = items;
  return delivery;
}

// ── Route Lifecycle ──────────────────────────────────────────────

/** Start a route — sets picklist to in_progress, records start time */
export async function startRoute(picklistId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('picklists')
    .update({
      status: 'in_progress',
      started_at: now,
    })
    .eq('id', picklistId);
  if (error) throw new Error(`Failed to start route: ${error.message}`);

  // Set all pending deliveries to out_for_delivery
  await supabase
    .from('deliveries')
    .update({ status: 'out_for_delivery' })
    .eq('picklist_id', picklistId)
    .eq('status', 'pending');
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
        else if (p.payment_mode === 'cheque' || p.payment_mode === 'upi') totalCheque += amt;
        else if (p.payment_mode === 'credit') totalCredit += amt;
      }
    } else {
      // Direct delivery fallback
      if (d.payment_mode === 'cash') {
        const amt = dCollected > 0 ? dCollected : dDelivered;
        totalCash += amt;
      } else if (d.payment_mode === 'cheque' || d.payment_mode === 'upi') {
        const amt = dCollected > 0 ? dCollected : dDelivered;
        totalCheque += amt;
      } else if (d.payment_mode === 'credit') {
        totalCredit += dDelivered;
      }
    }
  }

  totalCollected = totalCash + totalCheque;

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
      total_cheque: totalCheque,
      total_credit: totalCredit,
    });
  }
}

// ── Delivery Workflow ────────────────────────────────────────────

export interface CompleteDeliveryInput {
  deliveryId: string;
  picklistId: string;
  partyId: string;
  invoiceId: string | null;
  workerId: string;
  deliveredItems: {
    id: string;
    delivered_qty: number;
  }[];
  payment: {
    mode: PaymentMode;
    amount: number;
    cheque_number?: string;
    cheque_date?: string;
    cheque_bank?: string;
    notes?: string;
  };
}

/** Complete a party delivery — update items, create payment, update delivery status */
export async function completePartyDelivery(input: CompleteDeliveryInput): Promise<void> {
  const now = new Date().toISOString();
  const todayStr = new Date().toISOString().split('T')[0];

  // 1. Update delivery items with delivered quantities
  for (const item of input.deliveredItems) {
    await supabase
      .from('delivery_items')
      .update({ delivered_qty: item.delivered_qty })
      .eq('id', item.id);
  }

  // 2. Calculate delivered amount
  const { data: updatedItems } = await supabase
    .from('delivery_items')
    .select('*')
    .eq('delivery_id', input.deliveryId);

  let deliveredAmount = 0;
  let allDelivered = true;
  if (updatedItems) {
    for (const item of updatedItems) {
      deliveredAmount += Number(item.delivered_qty) * Number(item.rate);
      if (Number(item.delivered_qty) < Number(item.ordered_qty)) {
        allDelivered = false;
      }
    }
  }

  // 2.5 Get existing delivery to preserve its scheduled delivery_date
  let targetDeliveryDate = todayStr;
  try {
    const { data: exDel } = await supabase
      .from('deliveries')
      .select('delivery_date, total_amount')
      .eq('id', input.deliveryId)
      .maybeSingle();
    if (exDel?.delivery_date) {
      targetDeliveryDate = exDel.delivery_date;
    }
  } catch {
    // fallback
  }

  const mockDel = mockStore.getDeliveries().find((d) => d.id === input.deliveryId);
  if (mockDel?.delivery_date) {
    targetDeliveryDate = mockDel.delivery_date;
  }

  const finalDeliveredAmount = deliveredAmount > 0 ? deliveredAmount : (mockDel?.total_amount || 0);

  // 3. Update delivery record
  const deliveryStatus = allDelivered ? 'delivered' : 'partial';
  await supabase
    .from('deliveries')
    .update({
      status: deliveryStatus,
      delivered_at: now,
      delivery_date: targetDeliveryDate,
      delivered_amount: finalDeliveredAmount,
      collected_amount: input.payment.mode === 'credit' ? 0 : input.payment.amount,
      payment_mode: input.payment.mode,
    })
    .eq('id', input.deliveryId);

  // 4. Create payment record in Supabase and sync with mockStore
  try {
    await supabase
      .from('payments')
      .insert({
        delivery_id: input.deliveryId,
        party_id: input.partyId,
        invoice_id: input.invoiceId,
        worker_id: input.workerId,
        amount: input.payment.amount,
        payment_mode: input.payment.mode,
        payment_date: targetDeliveryDate,
        cheque_number: input.payment.cheque_number || null,
        cheque_date: input.payment.cheque_date || null,
        cheque_bank: input.payment.cheque_bank || null,
        notes: input.payment.notes || null,
        status: input.payment.mode === 'credit' ? 'pending' : 'collected',
      });
  } catch {
    // ignore
  }

  mockStore.savePayment({
    delivery_id: input.deliveryId,
    party_id: input.partyId,
    invoice_id: input.invoiceId,
    worker_id: input.workerId,
    amount: input.payment.amount,
    payment_mode: input.payment.mode,
    payment_date: targetDeliveryDate,
    cheque_number: input.payment.cheque_number,
    cheque_date: input.payment.cheque_date,
    cheque_bank: input.payment.cheque_bank,
    notes: input.payment.notes,
    status: input.payment.mode === 'credit' ? 'pending' : 'collected',
  });

  mockStore.saveDelivery({
    id: input.deliveryId,
    status: deliveryStatus,
    delivered_at: now,
    delivery_date: targetDeliveryDate,
    delivered_amount: finalDeliveredAmount,
    collected_amount: input.payment.mode === 'credit' ? 0 : input.payment.amount,
    payment_mode: input.payment.mode,
  });

  // 5. Update party outstanding if credit
  if (input.payment.mode === 'credit' && input.payment.amount > 0) {
    const { data: party } = await supabase
      .from('parties')
      .select('outstanding_amount')
      .eq('id', input.partyId)
      .single();

    if (party) {
      await supabase
        .from('parties')
        .update({
          outstanding_amount: Number(party.outstanding_amount || 0) + input.payment.amount,
        })
        .eq('id', input.partyId);
    }
  }

  // 6. Update picklist completed_parties count
  const { count } = await supabase
    .from('deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('picklist_id', input.picklistId)
    .in('status', ['delivered', 'partial']);

  if (count !== null) {
    // Also update running totals
    const { data: allPayments } = await supabase
      .from('payments')
      .select('amount, payment_mode')
      .in('delivery_id', 
        (await supabase.from('deliveries').select('id').eq('picklist_id', input.picklistId)).data?.map(d => d.id) || []
      );

    let totalCollected = 0, totalCash = 0, totalCheque = 0, totalCredit = 0;
    if (allPayments) {
      for (const p of allPayments) {
        const amt = Number(p.amount || 0);
        totalCollected += amt;
        if (p.payment_mode === 'cash') totalCash += amt;
        else if (p.payment_mode === 'cheque') totalCheque += amt;
        else if (p.payment_mode === 'credit') totalCredit += amt;
      }
    }

    await supabase
      .from('picklists')
      .update({
        completed_parties: count,
        total_collected: totalCollected,
        total_cash: totalCash,
        total_cheque: totalCheque,
        total_credit: totalCredit,
      })
      .eq('id', input.picklistId);
  }

    if (input.invoiceId) {
      await supabase
        .from('invoices')
        .update({ status: deliveryStatus === 'delivered' ? 'delivered' : 'partial' })
        .eq('id', input.invoiceId);
    }

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
    } catch (err) {
      console.error('Failed to dispatch delivery notification:', err);
    }
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
  // ── 1. Fetch worker's real monthly target from Supabase ──────────
  let monthlyTarget = 0;
  try {
    const workerIds = [workerId];
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
      .eq('worker_id', workerId)
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

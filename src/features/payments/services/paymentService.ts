import { supabase } from '@/lib/supabase';
import { mockStore, isPaymentLinkedToActiveRoute } from '@/lib/mockStore';
import { parseEffectiveDateString } from '@/shared/utils/format';
import type { Payment, PaymentMode } from '@/lib/database.types';

export async function getPayments(): Promise<Payment[]> {
  let dbPayments: Payment[] = [];

  try {
    const { data, error } = await supabase
      .from('payments')
      .select(`
        *,
        party:parties(*, route:routes(*)),
        worker:workers(*),
        delivery:deliveries(*, picklist:picklists(*, route:routes(*))),
        invoice:invoices(*)
      `)
      .order('created_at', { ascending: false });

    if (!error && data) {
      dbPayments = data as Payment[];
    }
  } catch {
    // ignore
  }

  const mockPayments = mockStore.getPayments();
  const seenKeys = new Set<string>();
  const merged: Payment[] = [];

  // Add DB payments first
  for (const p of dbPayments) {
    const k = p.id || `${p.delivery_id}_${p.party_id}_${p.amount}_${p.payment_mode}`;
    if (!seenKeys.has(k)) {
      seenKeys.add(k);
      merged.push(p);
    }
  }

  // Add mockStore payments
  for (const mp of mockPayments) {
    const key = mp.id || `${mp.delivery_id}_${mp.party_id}_${mp.amount}_${mp.payment_mode}`;
    const keyNoId = `${mp.delivery_id}_${mp.party_id}_${mp.amount}_${mp.payment_mode}`;
    if (!seenKeys.has(key) && !seenKeys.has(keyNoId)) {
      seenKeys.add(key);
      seenKeys.add(keyNoId);
      merged.push(mp);
    }
  }

  // Fallback: Check completed deliveries that might not have direct payment rows yet
  try {
    const mockDeliveries = mockStore.getDeliveries();
    for (const d of mockDeliveries) {
      if (d.status === 'delivered' || d.status === 'partial') {
        const isCredit = d.payment_mode === 'credit';
        const amt = Number(d.collected_amount || (isCredit ? d.delivered_amount || d.total_amount : 0) || d.total_amount || 0);
        if (amt > 0) {
          const mode = (d.payment_mode || (d.collected_amount > 0 ? 'cash' : 'credit')) as PaymentMode;
          const existing = merged.find((p) => p.delivery_id === d.id);
          const k = `del_pay_${d.id}`;
          if (!existing && !seenKeys.has(k)) {
            seenKeys.add(k);
            const partyObj = mockStore.getParties().find((p) => p.id === d.party_id) || d.party;
            const workerObj = mockStore.getWorkers().find((w) => w.id === d.worker_id) || d.worker;
            merged.push({
              id: k,
              delivery_id: d.id,
              party_id: d.party_id,
              worker_id: d.worker_id || (workerObj ? workerObj.id : null),
              received_by_worker_id: d.worker_id || (workerObj ? workerObj.id : null),
              amount: amt,
              payment_mode: mode,
              payment_date: parseEffectiveDateString(d.delivery_date || d.delivered_at || d.created_at),
              status: isCredit ? 'pending' : 'collected',
              party: partyObj
                ? { ...partyObj, route: mockStore.getRoutes().find((r) => r.id === partyObj.route_id) || null }
                : null,
              worker: workerObj || null,
              delivery: d as any,
              notes: d.notes || null,
              created_at: d.delivered_at || d.created_at || new Date().toISOString(),
              updated_at: d.updated_at || new Date().toISOString(),
            } as Payment);
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // Ensure every merged payment has party, worker, delivery, and route populated
  const allParties = mockStore.getParties();
  const allRoutes = mockStore.getRoutes();
  const allWorkers = mockStore.getWorkers();
  const allDeliveries = mockStore.getDeliveries();
  const allPicklists = mockStore.getPicklists();

  // If there are no active deliveries and no picklists, no route collections should exist
  if (allDeliveries.length === 0 && allPicklists.length === 0) {
    return [];
  }

  const validMerged = merged.filter((p) =>
    isPaymentLinkedToActiveRoute(p, allParties, allDeliveries, allPicklists, allRoutes)
  );

  for (let i = 0; i < validMerged.length; i++) {
    const p = validMerged[i];
    let pt = p.party;
    if (!pt || !pt.name || pt.name === 'Unknown') {
      pt = allParties.find((x) => x.id === p.party_id || x.code === p.party_id) || pt;
    }
    let del = p.delivery;
    if (!del && p.delivery_id) {
      del = allDeliveries.find((d) => d.id === p.delivery_id) as any;
    }
    let w = p.worker;
    if (!w && (p.worker_id || (p as any).received_by_worker_id)) {
      w = allWorkers.find((x) => x.id === (p.worker_id || (p as any).received_by_worker_id)) || w;
    }
    if (pt) {
      let r = (pt as any).route;
      if (!r && (pt as any).route_id) {
        r = allRoutes.find((x) => x.id === (pt as any).route_id) || r;
      }
      if (!r && (del as any)?.picklist?.route_id) {
        r = allRoutes.find((x) => x.id === (del as any).picklist.route_id) || r;
      }
      pt = { ...pt, route: r || null } as any;
    }
    if (del) {
      let pl = (del as any).picklist;
      if (!pl && (del as any).picklist_id) {
        pl = allPicklists.find((x) => x.id === (del as any).picklist_id);
      }
      if (pl && !pl.route && pl.route_id) {
        pl = { ...pl, route: allRoutes.find((r) => r.id === pl.route_id) || null };
      }
      del = { ...del, picklist: pl || null } as any;
    }

    validMerged[i] = {
      ...p,
      party: pt || null,
      worker: w || null,
      delivery: del || null,
    };
  }

  return validMerged;
}

export async function getWorkerPayments(workerId: string, workerName?: string): Promise<Payment[]> {
  let dbPayments: Payment[] = [];

  try {
    const workerIds = new Set<string>([workerId]);
    if (workerName) {
      const { data: matched } = await supabase
        .from('workers')
        .select('id')
        .ilike('name', `%${workerName}%`);
      if (matched) {
        matched.forEach((w) => workerIds.add(w.id));
      }
    }
    const idList = Array.from(workerIds);

    const { data, error } = await supabase
      .from('payments')
      .select(`
        *,
        party:parties(*, route:routes(*)),
        worker:workers(*),
        delivery:deliveries(*, picklist:picklists(*, route:routes(*))),
        invoice:invoices(*)
      `)
      .in('worker_id', idList)
      .order('created_at', { ascending: false });

    if (!error && data) {
      dbPayments = data as Payment[];
    }
  } catch {
    // ignore
  }

  const mockPayments = mockStore.getPayments().filter(
    (p) => p.worker_id === workerId || p.received_by_worker_id === workerId || (p.worker && p.worker.id === workerId)
  );

  const seenKeys = new Set<string>();
  const merged: Payment[] = [];

  for (const p of dbPayments) {
    const k = p.id || `${p.delivery_id}_${p.party_id}_${p.amount}_${p.payment_mode}`;
    if (!seenKeys.has(k)) {
      seenKeys.add(k);
      merged.push(p);
    }
  }

  for (const mp of mockPayments) {
    const key = mp.id || `${mp.delivery_id}_${mp.party_id}_${mp.amount}_${mp.payment_mode}`;
    const keyNoId = `${mp.delivery_id}_${mp.party_id}_${mp.amount}_${mp.payment_mode}`;
    if (!seenKeys.has(key) && !seenKeys.has(keyNoId)) {
      seenKeys.add(key);
      seenKeys.add(keyNoId);
      merged.push(mp);
    }
  }

  return merged;
}

export async function createPayment(input: {
  delivery_id?: string;
  party_id: string;
  invoice_id?: string;
  worker_id?: string;
  amount: number;
  payment_mode: PaymentMode;
  cheque_number?: string;
  cheque_date?: string;
  cheque_bank?: string;
  notes?: string;
  payment_date?: string;
}): Promise<Payment> {
  try {
    const { data, error } = await supabase
      .from('payments')
      .insert({
        delivery_id: input.delivery_id || null,
        party_id: input.party_id,
        invoice_id: input.invoice_id || null,
        worker_id: input.worker_id || null,
        amount: input.amount,
        payment_mode: input.payment_mode,
        cheque_number: input.cheque_number || null,
        notes: input.notes || null,
        payment_date: input.payment_date || new Date().toISOString().split('T')[0],
      })
      .select()
      .single();

    if (error || !data) {
      return mockStore.savePayment({
        party_id: input.party_id,
        delivery_id: input.delivery_id,
        invoice_id: input.invoice_id,
        worker_id: input.worker_id,
        amount: input.amount,
        payment_mode: input.payment_mode,
        cheque_number: input.cheque_number,
        notes: input.notes,
        payment_date: input.payment_date,
      });
    }
    mockStore.savePayment(data as Payment);
    return data as Payment;
  } catch {
    return mockStore.savePayment({
      party_id: input.party_id,
      delivery_id: input.delivery_id,
      invoice_id: input.invoice_id,
      worker_id: input.worker_id,
      amount: input.amount,
      payment_mode: input.payment_mode,
      cheque_number: input.cheque_number,
      notes: input.notes,
      payment_date: input.payment_date,
    });
  }
}

export async function deletePayment(id: string): Promise<void> {
  // Handle synthetic del_pay_ IDs derived from delivery records
  if (id.startsWith('del_pay_')) {
    const deliveryId = id.replace('del_pay_', '');
    // Delete the delivery's payment from Supabase by delivery_id
    try {
      await supabase.from('payments').delete().eq('delivery_id', deliveryId);
    } catch {
      // ignore
    }
    // Also clear the delivery's collected_amount and payment_mode in local store
    mockStore.saveDelivery({ id: deliveryId, collected_amount: 0, payment_mode: null as any, status: 'pending', delivered_amount: 0 });
    // Delete any real payment with this delivery_id from mockStore
    mockStore.deletePaymentByDelivery(deliveryId);
    return;
  }

  try {
    await supabase.from('payments').delete().eq('id', id);
  } catch {
    // fallback — still remove locally
  }
  mockStore.deletePayment(id);
}

import { supabase } from '@/lib/supabase';
import { mockStore, isPaymentLinkedToActiveRoute } from '@/lib/mockStore';
import { parseEffectiveDateString } from '@/shared/utils/format';
import type { Payment, PaymentMode } from '@/lib/database.types';

export async function getPayments(): Promise<Payment[]> {
  let dbPayments: Payment[] = [];
  let isDbOnline = false;

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
      isDbOnline = true;
    }

    // Also fetch completed deliveries directly from Supabase that may not have direct payment rows yet
    const { data: dbDeliveries } = await supabase
      .from('deliveries')
      .select(`
        *,
        party:parties(*, route:routes(*)),
        worker:workers(*),
        picklist:picklists(*, route:routes(*)),
        invoice:invoices(*)
      `)
      .in('status', ['delivered', 'partial'])
      .order('created_at', { ascending: false });

    if (dbDeliveries && dbDeliveries.length > 0) {
      isDbOnline = true;
      const existingDelIds = new Set(dbPayments.map((p) => p.delivery_id).filter(Boolean));
      for (const d of dbDeliveries) {
        if (existingDelIds.has(d.id)) continue;
        const isCredit = d.payment_mode === 'credit';
        const amt = Number(d.collected_amount || (isCredit ? d.delivered_amount || d.total_amount : 0) || d.total_amount || 0);
        if (amt > 0) {
          existingDelIds.add(d.id);
          dbPayments.push({
            id: `del_pay_${d.id}`,
            delivery_id: d.id,
            party_id: d.party_id,
            worker_id: d.worker_id,
            received_by_worker_id: d.worker_id,
            amount: amt,
            payment_mode: (d.payment_mode || 'cash') as any,
            payment_date: parseEffectiveDateString(d.delivery_date || d.delivered_at || d.created_at),
            status: isCredit ? 'pending' : 'collected',
            party: d.party || null,
            worker: d.worker || null,
            delivery: d as any,
            invoice: d.invoice || null,
            notes: d.notes || null,
            created_at: d.delivered_at || d.created_at || new Date().toISOString(),
            updated_at: d.updated_at || new Date().toISOString(),
          } as Payment);
        }
      }
    }
  } catch {
    // ignore
  }

  // If Supabase is online and accessible, use its data as the authoritative source
  if (isDbOnline) {
    return dbPayments;
  }

  // Offline fallback only:
  const mockPayments = mockStore.getPayments();
  const seenKeys = new Set<string>();
  const merged: Payment[] = [];

  for (const mp of mockPayments) {
    const key = mp.id || `${mp.delivery_id}_${mp.party_id}_${mp.amount}_${mp.payment_mode}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      merged.push(mp);
    }
  }

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

  const allParties = mockStore.getParties();
  const allRoutes = mockStore.getRoutes();
  const allDeliveries = mockStore.getDeliveries();
  const allPicklists = mockStore.getPicklists();

  if (allDeliveries.length === 0 && allPicklists.length === 0) {
    return [];
  }

  return merged.filter((p) =>
    isPaymentLinkedToActiveRoute(p, allParties, allDeliveries, allPicklists, allRoutes)
  );
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

    // 1. Fetch explicit payment rows from Supabase
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

    // 2. Also fetch completed deliveries from Supabase that may not have a payments row yet
    const { data: deliveriesData } = await supabase
      .from('deliveries')
      .select(`
        *,
        party:parties(*, route:routes(*)),
        worker:workers(*),
        picklist:picklists(*, route:routes(*))
      `)
      .in('worker_id', idList)
      .in('status', ['delivered', 'partial'])
      .order('created_at', { ascending: false });

    if (deliveriesData && deliveriesData.length > 0) {
      const existingDeliveryIds = new Set(dbPayments.map((p) => p.delivery_id).filter(Boolean));
      for (const d of deliveriesData) {
        if (existingDeliveryIds.has(d.id)) continue; // already has a payment row
        const amt = Number(d.collected_amount || d.delivered_amount || d.total_amount || 0);
        if (amt > 0) {
          dbPayments.push({
            id: `del_pay_${d.id}`,
            delivery_id: d.id,
            party_id: d.party_id,
            worker_id: d.worker_id,
            received_by_worker_id: d.worker_id,
            amount: amt,
            payment_mode: (d.payment_mode || 'cash') as any,
            payment_date: d.delivery_date || d.delivered_at?.split('T')[0] || d.created_at?.split('T')[0],
            status: d.payment_mode === 'credit' ? 'pending' : 'collected',
            party: d.party || null,
            worker: d.worker || null,
            delivery: d as any,
            notes: d.notes || null,
            created_at: d.delivered_at || d.created_at || new Date().toISOString(),
            updated_at: d.updated_at || new Date().toISOString(),
          } as Payment);
        }
      }
    }
  } catch {
    // ignore Supabase errors, fallback to mockStore below
  }

  // Only include mockStore payments as last resort (when Supabase returned nothing)
  if (dbPayments.length === 0) {
    const mockPayments = mockStore.getPayments().filter(
      (p) => p.worker_id === workerId || (p as any).received_by_worker_id === workerId ||
             (p.worker && p.worker.id === workerId)
    );
    return mockPayments;
  }

  return dbPayments;
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

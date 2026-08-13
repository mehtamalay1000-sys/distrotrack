import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
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

  return merged;
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
  try {
    await supabase.from('payments').delete().eq('id', id);
  } catch {
    // fallback
  }
}

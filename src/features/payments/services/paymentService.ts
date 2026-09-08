import { supabase } from '@/lib/supabase';
import { mockStore, isPaymentLinkedToActiveRoute } from '@/lib/mockStore';
import type { Payment, PaymentMode, FinancialSummary } from '@/lib/database.types';

export interface RecordPaymentInput {
  party_id: string;
  amount: number;
  payment_mode: PaymentMode;
  worker_id?: string;
  invoice_id?: string;
  delivery_id?: string;
  picklist_id?: string;
  route_id?: string;
  reference_number?: string;
  cheque_number?: string;
  cheque_date?: string;
  cheque_bank?: string;
  notes?: string;
  payment_date?: string;
  idempotency_key?: string;
}

export async function getPayments(): Promise<Payment[]> {
  try {
    const { data, error } = await supabase
      .from('payments')
      .select(`
        *,
        party:parties(*, route:routes(*)),
        worker:workers(*),
        delivery:deliveries(*, picklist:picklists(*, route:routes(*))),
        invoice:invoices(*),
        picklist:picklists(*),
        route:routes(*)
      `)
      .order('created_at', { ascending: false });

    if (!error && data) {
      return data as Payment[];
    }
  } catch (err) {
    console.warn('[paymentService] Failed to load payments from Supabase, falling back to mockStore:', err);
  }

  // Offline fallback only:
  const mockPayments = mockStore.getPayments();
  const allParties = mockStore.getParties();
  const allRoutes = mockStore.getRoutes();
  const allDeliveries = mockStore.getDeliveries();
  const allPicklists = mockStore.getPicklists();

  if (allDeliveries.length === 0 && allPicklists.length === 0) {
    return mockPayments;
  }

  return mockPayments.filter((p) =>
    isPaymentLinkedToActiveRoute(p, allParties, allDeliveries, allPicklists, allRoutes)
  );
}

export async function getWorkerPayments(workerId: string, workerName?: string): Promise<Payment[]> {
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
        invoice:invoices(*),
        picklist:picklists(*),
        route:routes(*)
      `)
      .in('worker_id', idList)
      .order('created_at', { ascending: false });

    if (!error && data) {
      return data as Payment[];
    }
  } catch (err) {
    console.warn('[paymentService] Failed to load worker payments from Supabase:', err);
  }

  return mockStore.getPayments().filter(
    (p) => p.worker_id === workerId || (p as any).received_by_worker_id === workerId ||
           (p.worker && p.worker.id === workerId)
  );
}

/**
 * Record a payment collection atomically via PostgreSQL RPC.
 * Maintains party_financial_ledger and prevents overpayment.
 */
export async function recordPartyPayment(input: RecordPaymentInput): Promise<any> {
  const { data, error } = await supabase.rpc('record_party_payment_with_ledger', {
    p_party_id: input.party_id,
    p_amount: input.amount,
    p_payment_mode: input.payment_mode,
    p_worker_id: input.worker_id || null,
    p_invoice_id: input.invoice_id || null,
    p_delivery_id: input.delivery_id || null,
    p_picklist_id: input.picklist_id || null,
    p_route_id: input.route_id || null,
    p_reference_number: input.reference_number || null,
    p_cheque_number: input.cheque_number || null,
    p_cheque_date: input.cheque_date || null,
    p_cheque_bank: input.cheque_bank || null,
    p_notes: input.notes || null,
    p_payment_date: input.payment_date || new Date().toISOString().split('T')[0],
    p_idempotency_key: input.idempotency_key || `client_pay:${Date.now()}:${input.party_id}`,
  });

  if (error) {
    throw new Error(`Payment recording failed: ${error.message}`);
  }

  // Sync to mockStore for offline fallback
  mockStore.savePayment({
    id: data?.payment_id || `pay_${Date.now()}`,
    party_id: input.party_id,
    delivery_id: input.delivery_id || null,
    invoice_id: input.invoice_id || null,
    worker_id: input.worker_id || null,
    received_by_worker_id: input.worker_id || null,
    amount: input.amount,
    payment_mode: input.payment_mode,
    reference_number: input.reference_number || null,
    cheque_number: input.cheque_number || null,
    cheque_date: input.cheque_date || null,
    cheque_bank: input.cheque_bank || null,
    notes: input.notes || null,
    payment_date: input.payment_date || new Date().toISOString().split('T')[0],
    status: data?.status || (input.payment_mode === 'cheque' ? 'pending' : 'collected'),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return data;
}

/** Legacy wrapper for createPayment */
export async function createPayment(input: RecordPaymentInput): Promise<any> {
  return recordPartyPayment(input);
}

/**
 * Reverse an existing payment transactionally.
 * Restores customer receivable in party_financial_ledger.
 */
export async function reversePayment(paymentId: string, reason: string, actorId: string = 'Admin'): Promise<any> {
  const { data, error } = await supabase.rpc('reverse_payment_with_ledger', {
    p_payment_id: paymentId,
    p_actor_id: actorId,
    p_reason: reason,
  });

  if (error) {
    throw new Error(`Payment reversal failed: ${error.message}`);
  }

  // Update mockStore status
  const existing = mockStore.getPayments().find((p) => p.id === paymentId);
  if (existing) {
    mockStore.savePayment({
      ...existing,
      status: 'reversed',
      reversal_reason: reason,
      reversed_at: new Date().toISOString(),
      reversed_by: actorId,
    });
  }

  // Log audit event
  try {
    await supabase.rpc('log_system_event', {
      p_user_id: actorId,
      p_user_name: actorId,
      p_role: 'admin',
      p_module: 'payment',
      p_action: 'payment_reversed',
      p_status: 'warning',
      p_detail: `Payment ${paymentId} reversed: ${reason}`,
      p_entity_type: 'payment',
      p_entity_id: paymentId,
    });
  } catch {
    // Non-blocking audit
  }

  return data;
}

/**
 * Update cheque status (pending -> cleared or bounced).
 */
export async function updateChequeStatus(paymentId: string, status: 'cleared' | 'bounced', reason?: string, actorId: string = 'Admin'): Promise<any> {
  const { data, error } = await supabase.rpc('update_cheque_status', {
    p_payment_id: paymentId,
    p_status: status,
    p_actor_id: actorId,
    p_reason: reason || null,
  });

  if (error) {
    throw new Error(`Cheque status update failed: ${error.message}`);
  }

  const existing = mockStore.getPayments().find((p) => p.id === paymentId);
  if (existing) {
    mockStore.savePayment({
      ...existing,
      status,
      notes: reason ? `${existing.notes || ''} | ${status}: ${reason}` : existing.notes,
    });
  }

  // Log audit event
  try {
    await supabase.rpc('log_system_event', {
      p_user_id: actorId,
      p_user_name: actorId,
      p_role: 'admin',
      p_module: 'payment',
      p_action: status === 'bounced' ? 'cheque_bounced' : 'cheque_cleared',
      p_status: status === 'bounced' ? 'failure' : 'success',
      p_detail: `Cheque ${paymentId} marked as ${status}${reason ? `. Reason: ${reason}` : ''}`,
      p_entity_type: 'payment',
      p_entity_id: paymentId,
    });
  } catch {
    // Non-blocking audit
  }

  return data;
}

/**
 * Direct deletion is prohibited in Stage 5. Use reversePayment instead.
 */
export async function deletePayment(_id: string): Promise<void> {
  throw new Error('Direct deletion of payments is prohibited in production. Use authorized payment reversal instead.');
}

/**
 * Fetch unified authoritative financial summary across the system.
 */
export async function getFinancialSummary(filters?: {
  startDate?: string;
  endDate?: string;
  picklistId?: string;
  routeId?: string;
  workerId?: string;
}): Promise<FinancialSummary> {
  try {
    const { data, error } = await supabase.rpc('get_financial_summary', {
      p_start_date: filters?.startDate || null,
      p_end_date: filters?.endDate || null,
      p_picklist_id: filters?.picklistId || null,
      p_route_id: filters?.routeId || null,
      p_worker_id: filters?.workerId || null,
    });

    if (!error && data) {
      return data as FinancialSummary;
    }
  } catch (err) {
    console.warn('[paymentService] Failed to load financial summary from RPC:', err);
  }

  // Fallback defaults
  return {
    sales: 0,
    total_collected: 0,
    cash: 0,
    upi: 0,
    cheque_cleared: 0,
    cheque_pending: 0,
    credit_extended: 0,
    expenses: 0,
    net_cash: 0,
    total_outstanding: 0,
  };
}

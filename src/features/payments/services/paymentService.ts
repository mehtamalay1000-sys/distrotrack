import { supabase, isMockMode } from '@/lib/supabase';
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

export interface PendingCreditFilter {
  routeId?: string;
  workerId?: string;
}

/**
 * Fetch pending credit receivables (deliveries where delivered_amount > collected_amount).
 * Formats them as virtual Payment items with payment_mode: 'credit' and status: 'pending'
 * so they appear seamlessly in Payments lists, summaries, and worker collection reminders.
 */
export async function fetchPendingCreditPayments(filter?: PendingCreditFilter): Promise<Payment[]> {
  try {
    const { data: pendingRpc, error } = await supabase.rpc('get_pending_credit_deliveries', {
      p_route_id: filter?.routeId || null,
      p_worker_id: filter?.workerId || null,
    });

    if (!error && Array.isArray(pendingRpc)) {
      return pendingRpc.map((item: any) => ({
        id: `credit-${item.delivery_id}`,
        delivery_id: item.delivery_id,
        party_id: item.party_id,
        invoice_id: item.invoice_id || null,
        picklist_id: item.picklist_id || null,
        route_id: item.route_id || null,
        worker_id: item.worker_id || null,
        received_by_worker_id: item.worker_id || null,
        amount: Number(item.pending_amount || 0),
        payment_mode: 'credit' as PaymentMode,
        status: 'pending' as const,
        payment_date: item.delivery_date || new Date().toISOString().split('T')[0],
        created_at: item.delivery_date || new Date().toISOString(),
        updated_at: item.delivery_date || new Date().toISOString(),
        notes: item.invoice_number ? `Invoice #${item.invoice_number}` : 'Pending credit collection',
        idempotency_key: `credit:${item.delivery_id}`,
        party: {
          id: item.party_id,
          name: item.party_name,
          code: item.party_code,
          phone: item.party_phone,
          address: item.party_address,
          route: item.route_id ? {
            id: item.route_id,
            name: item.route_name,
            code: item.route_code,
          } : undefined,
        },
        delivery: {
          id: item.delivery_id,
          delivered_amount: Number(item.sale_amount || 0),
          collected_amount: Number(item.collected_amount || 0),
          status: item.delivery_status,
          picklist: item.picklist_id ? {
            id: item.picklist_id,
            picklist_number: item.picklist_number,
            route: item.route_id ? {
              id: item.route_id,
              name: item.route_name,
              code: item.route_code,
            } : undefined,
          } : undefined,
        },
        worker: item.worker_id ? {
          id: item.worker_id,
          name: item.worker_name,
        } : undefined,
        route: item.route_id ? {
          id: item.route_id,
          name: item.route_name,
          code: item.route_code,
        } : undefined,
        invoice: item.invoice_number ? {
          id: item.invoice_id || '',
          invoice_number: item.invoice_number,
          net_amount: Number(item.invoice_amount || 0),
        } : undefined,
        is_pending_credit: true,
        days_outstanding: Number(item.days_outstanding ?? 1),
      })) as Payment[];
    }
  } catch (err) {
    console.warn('[paymentService] get_pending_credit_deliveries RPC failed:', err);
  }

  // Fallback to mockStore ONLY in explicit mock mode
  if (!isMockMode()) {
    return [];
  }

  const mockDeliveries = mockStore.getDeliveries();
  const mockParties = mockStore.getParties();
  const mockRoutes = mockStore.getRoutes();
  const mockPicklists = mockStore.getPicklists();
  const mockWorkers = mockStore.getWorkers();

  const partyMap = new Map(mockParties.map((p) => [p.id, p]));
  const routeMap = new Map(mockRoutes.map((r) => [r.id, r]));
  const plMap = new Map(mockPicklists.map((pl) => [pl.id, pl]));
  const workerMap = new Map(mockWorkers.map((w) => [w.id, w]));

  const pendingMockDels = mockDeliveries.filter((d) => {
    const sale = Number(d.delivered_amount || d.total_amount || 0);
    const coll = Number(d.collected_amount || 0);
    const pending = sale - coll;
    if (pending <= 0.01) return false;
    if (d.status !== 'delivered' && d.status !== 'partial') return false;

    if (filter?.workerId && d.worker_id !== filter.workerId) return false;
    if (filter?.routeId) {
      const pl = d.picklist_id ? plMap.get(d.picklist_id) : null;
      if (pl?.route_id !== filter.routeId) return false;
    }
    return true;
  });

  return pendingMockDels.map((d) => {
    const pt = partyMap.get(d.party_id);
    const pl = d.picklist_id ? plMap.get(d.picklist_id) : null;
    const rt = pl?.route_id ? routeMap.get(pl.route_id) : null;
    const wk = d.worker_id ? workerMap.get(d.worker_id) : null;
    const sale = Number(d.delivered_amount || d.total_amount || 0);
    const coll = Number(d.collected_amount || 0);
    const pending = Math.max(0, sale - coll);

    return {
      id: `credit-${d.id}`,
      delivery_id: d.id,
      party_id: d.party_id,
      invoice_id: d.invoice_id || null,
      picklist_id: d.picklist_id || null,
      route_id: rt?.id || null,
      worker_id: d.worker_id || null,
      received_by_worker_id: d.worker_id || null,
      amount: pending,
      payment_mode: 'credit' as PaymentMode,
      status: 'pending' as const,
      payment_date: d.delivery_date || (d.delivered_at ? d.delivered_at.split('T')[0] : new Date().toISOString().split('T')[0]),
      created_at: d.delivered_at || new Date().toISOString(),
      updated_at: d.delivered_at || new Date().toISOString(),
      notes: 'Pending credit collection',
      idempotency_key: `credit:${d.id}`,
      party: pt ? {
        ...pt,
        route: rt,
      } : undefined,
      delivery: {
        ...d,
        picklist: pl ? {
          ...pl,
          route: rt,
        } : undefined,
      },
      worker: wk,
      route: rt,
      is_pending_credit: true,
      days_outstanding: 1,
    } as Payment;
  });
}

export async function getPayments(): Promise<Payment[]> {
  let recordedPayments: Payment[] = [];
  let fetchSucceeded = false;
  try {
    const { data, error } = await supabase
      .from('payments')
      .select(`
        *,
        party:parties(*, route:routes(*)),
        worker:workers!payments_worker_id_fkey(*),
        delivery:deliveries(*, picklist:picklists(*, route:routes(*))),
        invoice:invoices(*),
        picklist:picklists(*),
        route:routes(*)
      `)
      .order('created_at', { ascending: false });

    if (!error && data) {
      recordedPayments = data as Payment[];
      fetchSucceeded = true;
    }
  } catch (err) {
    console.warn('[paymentService] Failed to load payments from Supabase:', err);
  }

  // Fallback to mockStore ONLY if Supabase fetch genuinely failed AND we are in mock mode.
  // An authoritative 200 OK with [] rows returns [] directly.
  if (!fetchSucceeded && isMockMode()) {
    const mockPayments = mockStore.getPayments();
    const allParties = mockStore.getParties();
    const allRoutes = mockStore.getRoutes();
    const allDeliveries = mockStore.getDeliveries();
    const allPicklists = mockStore.getPicklists();

    if (allDeliveries.length === 0 && allPicklists.length === 0) {
      recordedPayments = mockPayments;
    } else {
      recordedPayments = mockPayments.filter((p) =>
        isPaymentLinkedToActiveRoute(p, allParties, allDeliveries, allPicklists, allRoutes)
      );
    }
  }

  // Fetch pending credit payments
  const pendingCreditPayments = await fetchPendingCreditPayments();

  // Combine active pending credit payments with recorded payments
  return [...pendingCreditPayments, ...recordedPayments];
}

export async function getWorkerPayments(workerId: string, workerName?: string): Promise<Payment[]> {
  let recordedPayments: Payment[] = [];
  let fetchSucceeded = false;
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
        worker:workers!payments_worker_id_fkey(*),
        delivery:deliveries(*, picklist:picklists(*, route:routes(*))),
        invoice:invoices(*),
        picklist:picklists(*),
        route:routes(*)
      `)
      .in('worker_id', idList)
      .order('created_at', { ascending: false });

    if (!error && data) {
      recordedPayments = data as Payment[];
      fetchSucceeded = true;
    }
  } catch (err) {
    console.warn('[paymentService] Failed to load worker payments from Supabase:', err);
  }

  // Fallback ONLY if server query genuinely failed AND mock mode is active
  if (!fetchSucceeded && isMockMode()) {
    recordedPayments = mockStore.getPayments().filter(
      (p) => p.worker_id === workerId || (p as any).received_by_worker_id === workerId ||
             (p.worker && p.worker.id === workerId)
    );
  }

  // Fetch worker's pending credit payments
  const pendingCreditPayments = await fetchPendingCreditPayments({ workerId });

  return [...pendingCreditPayments, ...recordedPayments];
}

/**
 * Record a payment collection atomically via PostgreSQL RPC.
 * Maintains party_financial_ledger and prevents overpayment.
 */
export async function recordPartyPayment(input: RecordPaymentInput): Promise<any> {
  if (!input.party_id) {
    throw new Error('Party ID is required to record a payment');
  }

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

  // Sync to mockStore only in mock mode
  if (isMockMode()) {
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
  }

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
 * Authoritatively delete a payment (Admin/Master only).
 * Recalibrates party_financial_ledger, delivery collected_amount, and customer outstanding balance.
 */
export async function deletePayment(paymentId: string, reason: string = 'Deleted by admin'): Promise<any> {
  const { data, error } = await supabase.rpc('admin_delete_payment', {
    p_payment_id: paymentId,
    p_reason: reason,
  });

  if (error) {
    throw new Error(`Payment deletion failed: ${error.message}`);
  }

  // Remove from mockStore for offline fallback
  mockStore.deletePayment(paymentId);

  return data;
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

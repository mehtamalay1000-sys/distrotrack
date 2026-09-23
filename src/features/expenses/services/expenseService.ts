import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type {
  Expense,
  ExpenseStatus,
  ExpensePaymentMethod,
  ExpenseType,
  RouteProfitabilityResponse,
} from '@/lib/database.types';
import { addNotification } from '@/features/notifications/services/notificationService';

export interface ExpenseFilters {
  status?: ExpenseStatus;
  route_id?: string;
  picklist_id?: string;
  worker_id?: string;
  category?: string;
  payment_method?: ExpensePaymentMethod;
  startDate?: string;
  endDate?: string;
}

export async function getExpenses(filters?: ExpenseFilters): Promise<Expense[]> {
  try {
    let query = supabase
      .from('expenses')
      .select('*, worker:workers(id, name), route:routes(id, name, code), picklist:picklists(id, picklist_number)')
      .order('date', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.route_id) {
      query = query.eq('route_id', filters.route_id);
    }
    if (filters?.picklist_id) {
      query = query.eq('picklist_id', filters.picklist_id);
    }
    if (filters?.worker_id) {
      query = query.eq('worker_id', filters.worker_id);
    }
    if (filters?.category) {
      query = query.eq('category', filters.category);
    }
    if (filters?.payment_method) {
      query = query.eq('payment_method', filters.payment_method);
    }
    if (filters?.startDate) {
      query = query.gte('date', filters.startDate);
    }
    if (filters?.endDate) {
      query = query.lte('date', filters.endDate);
    }

    const { data, error } = await query;
    if (!error && data) {
      return data as Expense[];
    }
  } catch {
    // fallback
  }

  let list = mockStore.getExpenses();
  if (filters?.status) list = list.filter((e) => e.status === filters.status);
  if (filters?.route_id) list = list.filter((e) => e.route_id === filters.route_id);
  if (filters?.worker_id) list = list.filter((e) => e.worker_id === filters.worker_id);
  if (filters?.category) list = list.filter((e) => e.category === filters.category);
  if (filters?.payment_method) list = list.filter((e) => e.payment_method === filters.payment_method);
  return list;
}

export async function getWorkerExpenses(workerId: string, workerName?: string): Promise<Expense[]> {
  const allExpenses = await getExpenses();
  return allExpenses.filter((e) => {
    const isOwnExpense =
      e.worker_id === workerId ||
      (workerName && e.worker_name?.toLowerCase().includes(workerName.toLowerCase())) ||
      (e.worker && e.worker.id === workerId);
    const isAdminVisible = e.visible_to_worker === true;
    return isOwnExpense || isAdminVisible;
  });
}

export interface CreateExpenseInput {
  category: string;
  amount: number;
  date?: string;
  payment_method?: ExpensePaymentMethod;
  description?: string;
  worker_id?: string;
  worker_name?: string;
  route_id?: string;
  picklist_id?: string;
  expense_type?: ExpenseType;
  status?: ExpenseStatus;
  receipt_url?: string;
  visible_to_worker?: boolean;
  idempotency_key?: string;
  actor_id?: string;
}

export async function createExpense(input: CreateExpenseInput): Promise<Expense> {
  const idempKey = input.idempotency_key || `exp_client:${input.worker_id || 'admin'}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;

  try {
    const { data: rpcRes, error } = await supabase.rpc('create_expense_with_idempotency', {
      p_category: input.category,
      p_amount: Number(input.amount),
      p_date: input.date || new Date().toISOString().split('T')[0],
      p_payment_method: input.payment_method || 'cash',
      p_description: input.description ?? null,
      p_worker_id: input.worker_id || null,
      p_route_id: input.route_id || null,
      p_picklist_id: input.picklist_id || null,
      p_expense_type: input.expense_type || 'route_operating',
      p_status: input.status || (input.worker_id ? 'pending' : 'approved'),
      p_receipt_url: input.receipt_url ?? null,
      p_visible_to_worker: input.visible_to_worker ?? true,
      p_idempotency_key: idempKey,
      p_actor_id: input.actor_id || input.worker_id || null,
    });

    if (!error && rpcRes && rpcRes.expense_id) {
      const { data: savedRow } = await supabase
        .from('expenses')
        .select('*, worker:workers(id, name), route:routes(id, name, code)')
        .eq('id', rpcRes.expense_id)
        .single();

      if (savedRow) {
        mockStore.saveExpense(savedRow as Expense);
        try {
          await supabase.rpc('log_system_event', {
            p_user_id: input.actor_id || input.worker_id || 'system',
            p_user_name: input.worker_name || input.actor_id || 'System',
            p_role: input.worker_id ? 'worker' : 'admin',
            p_module: 'expense',
            p_action: 'expense_created',
            p_status: 'success',
            p_detail: `Expense ${rpcRes.expense_id} created for ₹${Number(input.amount).toFixed(2)} (${input.category})`,
            p_entity_type: 'expense',
            p_entity_id: rpcRes.expense_id,
          });
        } catch {}
        dispatchNotifications(input);
        return savedRow as Expense;
      }
    } else if (error) {
      console.warn('[ExpenseService] RPC create_expense error, falling back:', error.message);
    }
  } catch (err) {
    console.warn('[ExpenseService] createExpense RPC failed:', err);
  }

  // Fallback to mockStore
  const fallback = mockStore.saveExpense({
    ...input,
    payment_method: input.payment_method || 'cash',
    status: input.status || (input.worker_id ? 'pending' : 'approved'),
    expense_type: input.expense_type || 'route_operating',
    idempotency_key: idempKey,
  });

  dispatchNotifications(input);
  return fallback;
}

export async function approveExpense(expenseId: string, actorId?: string): Promise<{ success: boolean; status: string }> {
  try {
    const { data, error } = await supabase.rpc('approve_expense', {
      p_expense_id: expenseId,
      p_actor_id: actorId || 'Admin',
    });

    if (!error && data) {
      const exp = mockStore.getExpenses().find((e) => e.id === expenseId);
      if (exp) {
        mockStore.saveExpense({
          ...exp,
          status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by: actorId || 'Admin',
        });
      }
      try {
        await supabase.rpc('log_system_event', {
          p_user_id: actorId || 'Admin',
          p_user_name: actorId || 'Admin',
          p_role: 'admin',
          p_module: 'expense',
          p_action: 'expense_approved',
          p_status: 'success',
          p_detail: `Expense ${expenseId} approved by ${actorId || 'Admin'}`,
          p_entity_type: 'expense',
          p_entity_id: expenseId,
        });
      } catch {}
      return { success: true, status: 'approved' };
    }
    if (error) throw new Error(error.message);
  } catch (err: any) {
    console.warn('[ExpenseService] approve_expense RPC error:', err);
    throw err;
  }
  return { success: false, status: 'error' };
}

export async function rejectExpense(expenseId: string, reason?: string, actorId?: string): Promise<{ success: boolean; status: string }> {
  try {
    const { data, error } = await supabase.rpc('reject_expense', {
      p_expense_id: expenseId,
      p_actor_id: actorId || 'Admin',
      p_reason: reason || 'Rejected by Admin',
    });

    if (!error && data) {
      const exp = mockStore.getExpenses().find((e) => e.id === expenseId);
      if (exp) {
        mockStore.saveExpense({
          ...exp,
          status: 'rejected',
          rejected_at: new Date().toISOString(),
          rejected_by: actorId || 'Admin',
          rejection_reason: reason,
        });
      }
      try {
        await supabase.rpc('log_system_event', {
          p_user_id: actorId || 'Admin',
          p_user_name: actorId || 'Admin',
          p_role: 'admin',
          p_module: 'expense',
          p_action: 'expense_rejected',
          p_status: 'warning',
          p_detail: `Expense ${expenseId} rejected: ${reason || 'Rejected by Admin'}`,
          p_entity_type: 'expense',
          p_entity_id: expenseId,
        });
      } catch {}
      return { success: true, status: 'rejected' };
    }
    if (error) throw new Error(error.message);
  } catch (err: any) {
    console.warn('[ExpenseService] reject_expense RPC error:', err);
    throw err;
  }
  return { success: false, status: 'error' };
}

export async function reverseExpense(expenseId: string, reason: string, actorId?: string): Promise<{ success: boolean; status: string }> {
  try {
    const { data, error } = await supabase.rpc('reverse_expense', {
      p_expense_id: expenseId,
      p_actor_id: actorId || 'Admin',
      p_reason: reason,
    });

    if (!error && data) {
      const exp = mockStore.getExpenses().find((e) => e.id === expenseId);
      if (exp) {
        mockStore.saveExpense({
          ...exp,
          status: 'reversed',
          reversed_at: new Date().toISOString(),
          reversed_by: actorId || 'Admin',
          reversal_reason: reason,
        });
      }
      try {
        await supabase.rpc('log_system_event', {
          p_user_id: actorId || 'Admin',
          p_user_name: actorId || 'Admin',
          p_role: 'admin',
          p_module: 'expense',
          p_action: 'expense_reversed',
          p_status: 'warning',
          p_detail: `Expense ${expenseId} reversed: ${reason}`,
          p_entity_type: 'expense',
          p_entity_id: expenseId,
        });
      } catch {}
      return { success: true, status: 'reversed' };
    }
    if (error) throw new Error(error.message);
  } catch (err: any) {
    console.warn('[ExpenseService] reverse_expense RPC error:', err);
    throw err;
  }
  return { success: false, status: 'error' };
}

/**
 * Authoritative Route Profitability and Contribution RPC
 */
export async function getRouteProfitability(params?: {
  route_id?: string;
  picklist_id?: string;
  start_date?: string;
  end_date?: string;
  worker_id?: string;
}): Promise<RouteProfitabilityResponse> {
  try {
    const { data, error } = await supabase.rpc('get_route_profitability', {
      p_route_id: params?.route_id || null,
      p_picklist_id: params?.picklist_id || null,
      p_start_date: params?.start_date || null,
      p_end_date: params?.end_date || null,
      p_worker_id: params?.worker_id || null,
    });

    if (!error && data && data.success) {
      return data as RouteProfitabilityResponse;
    }
    if (error) {
      console.warn('[ExpenseService] get_route_profitability RPC error:', error.message);
    }
  } catch (err) {
    console.warn('[ExpenseService] Failed to load route profitability:', err);
  }

  // Safe empty fallback structure
  return {
    success: true,
    routes: [],
    totals: {
      sales: 0,
      cogs: 0,
      gross_profit: 0,
      approved_expenses: 0,
      net_profit: 0,
      gross_margin_pct: 0,
      net_margin_pct: 0,
      cash_collected: 0,
      upi_collected: 0,
      cheque_cleared: 0,
      cheque_pending: 0,
      credit_sales: 0,
      total_collected: 0,
      cash_expenses: 0,
      non_cash_expenses: 0,
      expected_cash: 0,
      actual_cash_returned: 0,
      cash_discrepancy: 0,
      contribution_before_cogs: 0,
    },
  };
}

function dispatchNotifications(input: CreateExpenseInput) {
  try {
    addNotification({
      recipient_role: 'admin',
      type: 'expense',
      title: `Expense Logged: ₹${input.amount}`,
      message: `${input.worker_name || 'Worker'} logged ₹${Number(input.amount).toLocaleString('en-IN')} (${input.payment_method || 'cash'}) for ${input.category} (${input.description || 'No description'}).`,
      link: '/admin/expenses',
    });

    if (input.worker_id) {
      addNotification({
        recipient_role: 'worker',
        recipient_worker_id: input.worker_id,
        type: 'expense',
        title: `Expense Recorded: ₹${input.amount}`,
        message: `Your expense of ₹${Number(input.amount).toLocaleString('en-IN')} for ${input.category} was recorded (${input.status === 'approved' ? 'Approved' : 'Pending Approval'}).`,
        link: '/w/expenses',
      });
    }
  } catch (err) {
    console.error('Failed to dispatch expense notification:', err);
  }
}

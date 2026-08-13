import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type { Expense } from '@/lib/database.types';

export async function getExpenses(): Promise<Expense[]> {
  try {
    const { data, error } = await supabase
      .from('expenses')
      .select('*, worker:workers(id, name), route:routes(id, name)')
      .order('date', { ascending: false });
    if (error || !data) {
      return mockStore.getExpenses();
    }
    return data as Expense[];
  } catch {
    return mockStore.getExpenses();
  }
}

export async function getWorkerExpenses(workerId: string, workerName?: string): Promise<Expense[]> {
  const allExpenses = await getExpenses();
  return allExpenses.filter((e) => {
    const isOwnExpense = e.worker_id === workerId || (workerName && e.worker_name?.toLowerCase().includes(workerName.toLowerCase())) || (e.worker && e.worker.id === workerId);
    const isAdminVisible = e.visible_to_worker === true;
    return isOwnExpense || isAdminVisible;
  });
}

export async function createExpense(input: {
  category: string;
  amount: number;
  date: string;
  description?: string;
  worker_id?: string;
  worker_name?: string;
  route_id?: string;
  visible_to_worker?: boolean;
}): Promise<Expense> {
  try {
    const { data, error } = await supabase
      .from('expenses')
      .insert({
        category: input.category,
        amount: input.amount,
        date: input.date,
        description: input.description ?? null,
        worker_id: input.worker_id || null,
        worker_name: input.worker_name || null,
        route_id: input.route_id || null,
        visible_to_worker: input.visible_to_worker ?? false,
      })
      .select()
      .single();
    if (error || !data) {
      return mockStore.saveExpense(input);
    }
    mockStore.saveExpense(data as Expense);
    return data as Expense;
  } catch {
    return mockStore.saveExpense(input);
  }
}

export async function deleteExpense(id: string): Promise<void> {
  try {
    await supabase.from('expenses').delete().eq('id', id);
  } catch {
    // fallback
  }
  mockStore.deleteExpense(id);
}

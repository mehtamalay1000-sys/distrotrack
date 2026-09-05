import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type { Expense } from '@/lib/database.types';
import { addNotification } from '@/features/notifications/services/notificationService';

export async function getExpenses(): Promise<Expense[]> {
  try {
    const { data, error } = await supabase
      .from('expenses')
      .select('*, worker:workers(id, name)')
      .order('date', { ascending: false });
    if (!error && data) {
      return data as Expense[];
    }
  } catch {
    // fallback
  }

  return mockStore.getExpenses();
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
  let savedExpense: Expense | null = null;

  try {
    const corePayload = {
      category: input.category,
      amount: input.amount,
      date: input.date,
      description: input.description ?? null,
      worker_id: input.worker_id || null,
      // These columns were added in migration 002 — now safe to include in DB payload
      route_id: input.route_id || null,
      visible_to_worker: input.visible_to_worker ?? false,
    };

    const { data, error } = await supabase
      .from('expenses')
      .insert(corePayload)
      .select()
      .single();

    if (!error && data) {
      savedExpense = {
        ...(data as Expense),
        worker_name: input.worker_name || null,
      };
      mockStore.saveExpense(savedExpense);
    }
  } catch {
    // fallback
  }


  if (!savedExpense) {
    savedExpense = mockStore.saveExpense(input);
  }

  // Trigger Realtime Notifications
  try {
    addNotification({
      recipient_role: 'admin',
      type: 'expense',
      title: `Expense Logged: ₹${input.amount}`,
      message: `${input.worker_name || 'Worker'} logged ₹${Number(input.amount).toLocaleString('en-IN')} for ${input.category} (${input.description || 'No description'}).`,
      link: '/admin/expenses',
    });

    if (input.worker_id) {
      addNotification({
        recipient_role: 'worker',
        recipient_worker_id: input.worker_id,
        type: 'expense',
        title: `Expense Recorded: ₹${input.amount}`,
        message: `Your expense of ₹${Number(input.amount).toLocaleString('en-IN')} for ${input.category} was recorded.`,
        link: '/w/expenses',
      });
    }
  } catch (err) {
    console.error('Failed to dispatch expense notification:', err);
  }

  return savedExpense;
}

export async function deleteExpense(id: string): Promise<void> {
  try {
    await supabase.from('expenses').delete().eq('id', id);
  } catch {
    // fallback
  }
  mockStore.deleteExpense(id);
}

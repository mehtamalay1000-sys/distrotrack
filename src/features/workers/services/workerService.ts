import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type { Worker } from '@/lib/database.types';

export async function getWorkers(): Promise<Worker[]> {
  try {
    const { data, error } = await supabase
      .from('workers')
      .select('*')
      .order('name');
    if (error || !data) {
      return mockStore.getWorkers();
    }
    return data as Worker[];
  } catch {
    return mockStore.getWorkers();
  }
}

export async function getWorker(id: string): Promise<Worker> {
  try {
    const { data, error } = await supabase
      .from('workers')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) {
      const found = mockStore.getWorkers().find((w) => w.id === id);
      if (found) return found;
      throw new Error('Worker not found');
    }
    return data as Worker;
  } catch {
    const found = mockStore.getWorkers().find((w) => w.id === id);
    if (found) return found;
    throw new Error('Worker not found');
  }
}

export async function createWorker(input: { name: string; phone?: string; email?: string; notes?: string; monthly_target?: number }): Promise<Worker> {
  try {
    const { data, error } = await supabase
      .from('workers')
      .insert({ name: input.name, phone: input.phone ?? null, email: input.email ?? null, notes: input.notes ?? null, monthly_target: input.monthly_target ?? 50000, status: 'active' })
      .select()
      .single();
    if (error || !data) {
      return mockStore.saveWorker(input);
    }
    mockStore.saveWorker(data as Worker);
    return data as Worker;
  } catch {
    return mockStore.saveWorker(input);
  }
}

export async function updateWorker(id: string, input: Partial<Worker>): Promise<Worker> {
  try {
    const { data, error } = await supabase
      .from('workers')
      .update(input)
      .eq('id', id)
      .select()
      .single();
    if (error || !data) {
      return mockStore.saveWorker({ id, ...input });
    }
    mockStore.saveWorker(data as Worker);
    return data as Worker;
  } catch {
    return mockStore.saveWorker({ id, ...input });
  }
}

export async function deleteWorker(id: string): Promise<void> {
  try {
    await supabase.from('workers').delete().eq('id', id);
  } catch {
    // fallback
  }
  mockStore.deleteWorker(id);
}

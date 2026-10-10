import { supabase, isMockMode } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type { Worker } from '@/lib/database.types';

export async function getWorkers(): Promise<Worker[]> {
  try {
    const { data, error } = await supabase
      .from('workers')
      .select('*')
      .order('name');
    if (!error && data) {
      return (data as Worker[]).map((supaW) => ({
        ...supaW,
        monthly_target: supaW.monthly_target !== null && supaW.monthly_target !== undefined
          ? Number(supaW.monthly_target)
          : 50000,
      }));
    }
  } catch (err) {
    console.warn('[workerService] Supabase getWorkers failed:', err);
  }

  if (isMockMode()) {
    return mockStore.getWorkers();
  }
  return [];
}

export async function getWorker(id: string): Promise<Worker> {
  try {
    const { data, error } = await supabase
      .from('workers')
      .select('*')
      .eq('id', id)
      .single();
    if (!error && data) {
      return {
        ...(data as Worker),
        monthly_target: (data as Worker).monthly_target ?? 50000,
      };
    }
  } catch {
    // ignore
  }

  if (isMockMode()) {
    const found = mockStore.getWorkers().find((w) => w.id === id);
    if (found) return found;
  }
  throw new Error(`Worker with id ${id} not found`);
}

export async function createWorker(input: {
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  monthly_target?: number;
}): Promise<Worker> {
  if (isMockMode()) {
    return mockStore.saveWorker(input);
  }

  const { data, error } = await supabase
    .from('workers')
    .insert({
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      notes: input.notes ?? null,
      monthly_target: input.monthly_target ?? 50000,
      status: 'active',
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create worker: ${error?.message || 'Unknown database error'}`);
  }
  return data as Worker;
}

export async function updateWorker(id: string, input: Partial<Worker>): Promise<Worker> {
  if (isMockMode()) {
    return mockStore.saveWorker({ id, ...input });
  }

  const { data, error } = await supabase
    .from('workers')
    .update(input)
    .eq('id', id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to update worker: ${error?.message || 'Unknown database error'}`);
  }
  return {
    ...(data as Worker),
    monthly_target: input.monthly_target ?? (data as Worker).monthly_target ?? 50000,
  };
}

export async function deleteWorker(id: string): Promise<void> {
  if (isMockMode()) {
    mockStore.deleteWorker(id);
    return;
  }

  const { error } = await supabase.from('workers').delete().eq('id', id);
  if (error) {
    throw new Error(`Failed to delete worker: ${error.message}`);
  }
}


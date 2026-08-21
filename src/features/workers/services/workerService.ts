import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type { Worker } from '@/lib/database.types';

export async function getWorkers(): Promise<Worker[]> {
  const mockWorkers = mockStore.getWorkers();
  try {
    const { data, error } = await supabase
      .from('workers')
      .select('*')
      .order('name');
    if (error || !data || data.length === 0) {
      return mockWorkers;
    }
    // Merge Supabase workers with local store targets to prevent null overwrites
    return (data as Worker[]).map((supaW) => {
      const localMatch = mockWorkers.find(
        (mw) => mw.id === supaW.id || mw.name.trim().toLowerCase() === supaW.name.trim().toLowerCase()
      );
      return {
        ...supaW,
        monthly_target: supaW.monthly_target !== null && supaW.monthly_target !== undefined
          ? Number(supaW.monthly_target)
          : localMatch?.monthly_target ?? 50000,
      };
    });
  } catch {
    return mockWorkers;
  }
}

export async function getWorker(id: string): Promise<Worker> {
  const mockWorkers = mockStore.getWorkers();
  try {
    const { data, error } = await supabase
      .from('workers')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) {
      const found = mockWorkers.find((w) => w.id === id);
      if (found) return found;
      throw new Error('Worker not found');
    }
    const localMatch = mockWorkers.find((mw) => mw.id === id || mw.name.toLowerCase() === (data as Worker).name.toLowerCase());
    return {
      ...(data as Worker),
      monthly_target: (data as Worker).monthly_target ?? localMatch?.monthly_target ?? 50000,
    };
  } catch {
    const found = mockWorkers.find((w) => w.id === id);
    if (found) return found;
    throw new Error('Worker not found');
  }
}

export async function createWorker(input: { name: string; phone?: string; email?: string; notes?: string; monthly_target?: number }): Promise<Worker> {
  const localSaved = mockStore.saveWorker(input);
  try {
    const { data, error } = await supabase
      .from('workers')
      .insert({ name: input.name, phone: input.phone ?? null, email: input.email ?? null, notes: input.notes ?? null, monthly_target: input.monthly_target ?? 50000, status: 'active' })
      .select()
      .single();
    if (!error && data) {
      mockStore.saveWorker(data as Worker);
      return data as Worker;
    }
  } catch {
    // fallback
  }
  return localSaved;
}

export async function updateWorker(id: string, input: Partial<Worker>): Promise<Worker> {
  // Always update mockStore immediately
  const mockUpdated = mockStore.saveWorker({ id, ...input });
  try {
    const { data, error } = await supabase
      .from('workers')
      .update(input)
      .eq('id', id)
      .select()
      .single();
    if (!error && data) {
      mockStore.saveWorker(data as Worker);
      return { ...mockUpdated, ...(data as Worker), monthly_target: input.monthly_target ?? (data as Worker).monthly_target ?? mockUpdated.monthly_target };
    }
  } catch {
    // fallback to mockStore
  }
  return mockUpdated;
}

export async function deleteWorker(id: string): Promise<void> {
  try {
    await supabase.from('workers').delete().eq('id', id);
  } catch {
    // fallback
  }
  mockStore.deleteWorker(id);
}

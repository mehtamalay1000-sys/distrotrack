import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type { Delivery } from '@/lib/database.types';

export async function getDeliveries(): Promise<Delivery[]> {
  try {
    const { data, error } = await supabase
      .from('deliveries')
      .select('*, party:parties(*), worker:workers(*), invoice:invoices(*), picklist:picklists(*), payments(*)')
      .order('created_at', { ascending: false });
    if (error || !data) {
      return mockStore.getDeliveries();
    }
    return data as Delivery[];
  } catch {
    return mockStore.getDeliveries();
  }
}

export async function updateDeliveryStatus(
  id: string,
  status: Delivery['status'],
  notes?: string
): Promise<void> {
  try {
    const updateData: Partial<Delivery> = { status };
    if (notes) updateData.notes = notes;
    if (status === 'delivered') updateData.delivered_at = new Date().toISOString();

    await supabase
      .from('deliveries')
      .update(updateData)
      .eq('id', id);
  } catch {
    // fallback
  }
  mockStore.saveDelivery({ id, status, notes });
}

export async function deleteDelivery(id: string): Promise<void> {
  try {
    await supabase.from('payments').delete().eq('delivery_id', id);
    await supabase.from('delivery_items').delete().eq('delivery_id', id);
    await supabase.from('deliveries').delete().eq('id', id);
  } catch (err) {
    console.error('Error deleting delivery:', err);
  }
  mockStore.deleteDelivery(id);
}

export async function assignDeliveryWorker(id: string, workerId: string | null): Promise<void> {
  try {
    await supabase.from('deliveries').update({ worker_id: workerId }).eq('id', id);
  } catch {
    // fallback
  }
  mockStore.saveDelivery({ id, worker_id: workerId });
}

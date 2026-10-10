import { supabase, isMockMode } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type { Delivery } from '@/lib/database.types';

export async function getDeliveries(): Promise<Delivery[]> {
  try {
    const { data, error } = await supabase
      .from('deliveries')
      .select('*, party:parties(*), worker:workers(*), invoice:invoices(*), picklist:picklists(*), payments(*)')
      .order('created_at', { ascending: false });
    if (error || !data) {
      return isMockMode() ? mockStore.getDeliveries() : [];
    }

    // Defense-in-depth: Deduplicate by canonical identity (invoice_id, or picklist_id + party_id)
    const seen = new Map<string, Delivery>();
    for (const d of (data as Delivery[])) {
      const key = d.invoice_id
        ? `inv:${d.invoice_id}`
        : (d.picklist_id && d.party_id)
        ? `pl:${d.picklist_id}_${d.party_id}`
        : `id:${d.id}`;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, d);
      } else {
        // Keep the one with authoritative non-zero or higher amount
        if (Number(existing.total_amount || 0) === 0 && Number(d.total_amount || 0) > 0) {
          seen.set(key, d);
        }
      }
    }
    return Array.from(seen.values());
  } catch {
    return isMockMode() ? mockStore.getDeliveries() : [];
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
  if (isMockMode()) {
    mockStore.saveDelivery({ id, status, notes });
  }
}

export async function deleteDelivery(id: string): Promise<void> {
  try {
    await supabase.from('delivery_items').delete().eq('delivery_id', id);
    await supabase.from('deliveries').delete().eq('id', id);
  } catch (err) {
    console.error('Error deleting delivery:', err);
  }
  if (isMockMode()) {
    mockStore.deleteDelivery(id);
  }
}

export async function assignDeliveryWorker(id: string, workerId: string | null): Promise<void> {
  try {
    await supabase.from('deliveries').update({ worker_id: workerId }).eq('id', id);
  } catch {
    // fallback
  }
  if (isMockMode()) {
    mockStore.saveDelivery({ id, worker_id: workerId });
  }
}

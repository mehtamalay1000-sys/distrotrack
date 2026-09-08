import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type { Picklist, PicklistItem } from '@/lib/database.types';

export async function getPicklists(): Promise<Picklist[]> {
  try {
    const { data, error } = await supabase
      .from('picklists')
      .select('*, route:routes(id, name, code), worker:workers(id, name)')
      .order('created_at', { ascending: false });
    if (error || !data) {
      return mockStore.getPicklists();
    }
    return data as Picklist[];
  } catch {
    return mockStore.getPicklists();
  }
}

export async function getPicklist(id: string): Promise<Picklist> {
  try {
    const { data: picklist, error: plErr } = await supabase
      .from('picklists')
      .select('*, route:routes(id, name, code), worker:workers(id, name)')
      .eq('id', id)
      .single();

    if (plErr || !picklist) {
      const found = mockStore.getPicklists().find((pl) => pl.id === id);
      if (found) return found;
      throw new Error('Picklist not found');
    }

    const { data: items } = await supabase
      .from('picklist_items')
      .select('*, party:parties(id, name, code), product:products(id, name, sku)')
      .eq('picklist_id', id);

    return {
      ...(picklist as Picklist),
      items: (items ?? []) as PicklistItem[],
    };
  } catch {
    const found = mockStore.getPicklists().find((pl) => pl.id === id);
    if (found) return found;
    throw new Error('Picklist not found');
  }
}

export async function assignPicklistWorker(id: string, workerId: string | null): Promise<void> {
  try {
    const updateData: Partial<Picklist> = {
      worker_id: workerId,
      status: workerId ? 'assigned' : 'confirmed',
    };
    await supabase.from('picklists').update(updateData).eq('id', id);
    await supabase.from('deliveries').update({ worker_id: workerId }).eq('picklist_id', id);
  } catch {
    // fallback
  }
  mockStore.savePicklist({ id, worker_id: workerId, status: workerId ? 'assigned' : 'confirmed' });
}

export async function updatePicklistStatus(id: string, status: Picklist['status'], workerId?: string): Promise<void> {
  try {
    const updateData: Partial<Picklist> = { status };
    if (workerId) updateData.worker_id = workerId;

    await supabase
      .from('picklists')
      .update(updateData)
      .eq('id', id);
  } catch {
    // fallback
  }
  mockStore.savePicklist({ id, status, worker_id: workerId });
}

export async function deletePicklist(id: string): Promise<void> {
  try {
    const { data: delRecords } = await supabase
      .from('deliveries')
      .select('id')
      .eq('picklist_id', id);

    const deliveryIds = (delRecords || []).map((d) => d.id);
    if (deliveryIds.length > 0) {
      await supabase.from('delivery_items').delete().in('delivery_id', deliveryIds);
      await supabase.from('deliveries').delete().in('id', deliveryIds);
    }

    const { data: invoices } = await supabase
      .from('invoices')
      .select('id')
      .eq('picklist_id', id);

    const invoiceIds = (invoices || []).map((i) => i.id);
    if (invoiceIds.length > 0) {
      await supabase.from('invoice_items').delete().in('invoice_id', invoiceIds);
      await supabase.from('invoices').delete().in('id', invoiceIds);
    }

    await supabase.from('picklist_items').delete().eq('picklist_id', id);
    await supabase.from('picklist_parties').delete().eq('picklist_id', id);
    await supabase.from('picklists').delete().eq('id', id);
  } catch (err) {
    console.error('Error cascading picklist deletion:', err);
  }

  mockStore.deletePicklist(id);
}

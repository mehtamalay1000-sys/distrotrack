import { supabase, isMockMode } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type { Picklist, PicklistItem } from '@/lib/database.types';

export async function getPicklists(): Promise<Picklist[]> {
  try {
    const { data, error } = await supabase
      .from('picklists')
      .select('*, route:routes(id, name, code), worker:workers!picklists_worker_id_fkey(id, name)')
      .order('created_at', { ascending: false });
    if (error || !data) {
      return isMockMode() ? mockStore.getPicklists() : [];
    }
    return data as Picklist[];
  } catch {
    return isMockMode() ? mockStore.getPicklists() : [];
  }
}

export async function getPicklist(id: string): Promise<Picklist> {
  try {
    const { data: picklist, error: plErr } = await supabase
      .from('picklists')
      .select('*, route:routes(id, name, code), worker:workers!picklists_worker_id_fkey(id, name)')
      .eq('id', id)
      .single();

    if (plErr || !picklist) {
      if (isMockMode()) {
        const found = mockStore.getPicklists().find((pl) => pl.id === id);
        if (found) return found;
      }
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
  } catch (err) {
    if (isMockMode()) {
      const found = mockStore.getPicklists().find((pl) => pl.id === id);
      if (found) return found;
    }
    throw err instanceof Error ? err : new Error('Picklist not found');
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
  if (isMockMode()) {
    mockStore.savePicklist({ id, worker_id: workerId, status: workerId ? 'assigned' : 'confirmed' });
  }
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
  if (isMockMode()) {
    mockStore.savePicklist({ id, status, worker_id: workerId });
  }
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

  if (isMockMode()) {
    mockStore.deletePicklist(id);
  }
}

export async function adminAuthorizeRouteReconciliation(
  picklistId: string,
  action: 'approve' | 'reject',
  notes?: string
): Promise<any> {
  const { data, error } = await supabase.rpc('admin_authorize_route_reconciliation', {
    p_picklist_id: picklistId,
    p_action: action,
    p_notes: notes || null,
  });

  if (error) {
    throw new Error(`Reconciliation authorization failed: ${error.message}`);
  }

  // Update mockStore ONLY in mock mode
  if (isMockMode() && action === 'approve') {
    const pl = mockStore.getPicklists().find((p) => p.id === picklistId);
    if (pl) {
      mockStore.savePicklist({
        ...pl,
        status: 'completed',
        completed_at: new Date().toISOString(),
      });
    }
  }

  return data;
}

export async function getRouteStockExceptions(picklistId: string) {
  const { data, error } = await supabase
    .from('route_stock_exceptions')
    .select('*')
    .eq('picklist_id', picklistId)
    .order('created_at', { ascending: false });

  if (error) return [];
  return data || [];
}

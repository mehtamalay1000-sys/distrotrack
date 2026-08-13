import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type { Route } from '@/lib/database.types';

export async function getRoutes(): Promise<Route[]> {
  try {
    const { data, error } = await supabase
      .from('routes')
      .select('*, worker:workers(*)')
      .order('code');
    if (error || !data) {
      return mockStore.getRoutes();
    }
    return data as Route[];
  } catch {
    return mockStore.getRoutes();
  }
}

export async function createRoute(input: { name: string; code: string; description?: string; assigned_worker_id?: string }): Promise<Route> {
  try {
    const { data, error } = await supabase
      .from('routes')
      .insert({
        name: input.name,
        code: input.code,
        description: input.description ?? null,
        assigned_worker_id: input.assigned_worker_id || null,
        status: 'active',
      })
      .select()
      .single();
    if (error || !data) {
      return mockStore.saveRoute(input);
    }
    mockStore.saveRoute(data as Route);
    return data as Route;
  } catch {
    return mockStore.saveRoute(input);
  }
}

export async function updateRoute(id: string, input: Partial<Route>): Promise<Route> {
  try {
    const { data, error } = await supabase
      .from('routes')
      .update(input)
      .eq('id', id)
      .select()
      .single();

    // If worker assigned, propagate to picklists and deliveries on this route
    if (input.assigned_worker_id !== undefined) {
      const workerId = input.assigned_worker_id;
      await supabase
        .from('picklists')
        .update({
          worker_id: workerId,
          status: workerId ? 'assigned' : 'confirmed',
        })
        .eq('route_id', id)
        .neq('status', 'completed');

      await supabase
        .from('deliveries')
        .update({ worker_id: workerId })
        .in(
          'picklist_id',
          (await supabase.from('picklists').select('id').eq('route_id', id)).data?.map((p) => p.id) || []
        );
    }

    if (error || !data) {
      return mockStore.saveRoute({ id, ...input });
    }
    mockStore.saveRoute(data as Route);
    return data as Route;
  } catch {
    return mockStore.saveRoute({ id, ...input });
  }
}

export async function deleteRoute(id: string): Promise<void> {
  try {
    // 2. Find all picklists associated with this route
    const { data: routePicklists } = await supabase
      .from('picklists')
      .select('id')
      .eq('route_id', id);

    const picklistIds = (routePicklists || []).map((p) => p.id);

    // 3. Find all parties on this route
    const { data: routeParties } = await supabase
      .from('parties')
      .select('id')
      .eq('route_id', id);

    const partyIds = (routeParties || []).map((p) => p.id);

    // 4. Gather ALL delivery IDs linked to these picklists or parties
    const deliveryIds = new Set<string>();

    if (picklistIds.length > 0) {
      const { data: delByPicklist } = await supabase
        .from('deliveries')
        .select('id')
        .in('picklist_id', picklistIds);
      (delByPicklist || []).forEach((d) => deliveryIds.add(d.id));
    }

    if (partyIds.length > 0) {
      const { data: delByParty } = await supabase
        .from('deliveries')
        .select('id')
        .in('party_id', partyIds);
      (delByParty || []).forEach((d) => deliveryIds.add(d.id));
    }

    const delIdList = Array.from(deliveryIds);

    // 5. Delete ALL payments linked to these deliveries OR parties
    if (delIdList.length > 0) {
      await supabase.from('payments').delete().in('delivery_id', delIdList);
    }
    if (partyIds.length > 0) {
      await supabase.from('payments').delete().in('party_id', partyIds);
    }

    // 6. Delete delivery items & deliveries
    if (delIdList.length > 0) {
      await supabase.from('delivery_items').delete().in('delivery_id', delIdList);
      await supabase.from('deliveries').delete().in('id', delIdList);
    }

    // 7. Delete invoices and invoice items
    if (picklistIds.length > 0) {
      const { data: invoices } = await supabase
        .from('invoices')
        .select('id')
        .in('picklist_id', picklistIds);
      
      const invoiceIds = (invoices || []).map((i) => i.id);
      if (invoiceIds.length > 0) {
        await supabase.from('invoice_items').delete().in('invoice_id', invoiceIds);
        await supabase.from('invoices').delete().in('id', invoiceIds);
      }
    }

    // 8. Delete picklist items, picklist parties, and picklists
    if (picklistIds.length > 0) {
      await supabase.from('picklist_items').delete().in('picklist_id', picklistIds);
      await supabase.from('picklist_parties').delete().in('picklist_id', picklistIds);
      await supabase.from('picklists').delete().in('id', picklistIds);
    }

    // 9. Delete expenses associated with this route
    const { data: routeObj } = await supabase.from('routes').select('name, code').eq('id', id).single();
    if (routeObj) {
      await supabase.from('expenses').delete().or(`route_id.eq.${id},description.ilike.%${routeObj.name}%,description.ilike.%${routeObj.code}%`);
    } else {
      await supabase.from('expenses').delete().eq('route_id', id);
    }

    // 10. Delete the route itself
    await supabase.from('routes').delete().eq('id', id);
  } catch (err) {
    console.error('Error cascading route deletion:', err);
  }

  mockStore.deleteRoute(id);
}

export const OFFICIAL_ROUTES = [
  // ── Worker 1: Mahendra Rashinkar (w-mahindra) — Sangamner 1 to 6 ──
  { code: 'SANGAMNER_1', name: 'SANGAMNER 1', worker_id: 'w-mahindra' },
  { code: 'SANGAMNER_2', name: 'SANGAMNER 2', worker_id: 'w-mahindra' },
  { code: 'SANGAMNER_3', name: 'SANGAMNER 3', worker_id: 'w-mahindra' },
  { code: 'SANGAMNER_4', name: 'SANGAMNER 4', worker_id: 'w-mahindra' },
  { code: 'SANGAMNER_5', name: 'SANGAMNER 5', worker_id: 'w-mahindra' },
  { code: 'SANGAMNER_6', name: 'SANGAMNER 6', worker_id: 'w-mahindra' },

  // ── Worker 2: Balu Murtadak (w-balu) — Rajur, Akole, Kotul, etc. ──
  { code: 'RAJUR_1', name: 'RAJUR 1', worker_id: 'w-balu' },
  { code: 'RAJUR_2', name: 'RAJUR 2', worker_id: 'w-balu' },
  { code: 'AASHVI_1', name: 'AASHVI 1', worker_id: 'w-balu' },
  { code: 'AKOLE_1', name: 'AKOLE 1', worker_id: 'w-balu' },
  { code: 'GHULEWADI', name: 'GHULEWADI', worker_id: 'w-balu' },
  { code: 'AKOLE_2', name: 'AKOLE 2', worker_id: 'w-balu' },
  { code: 'KOTUL_1', name: 'KOTUL 1', worker_id: 'w-balu' },
  { code: 'KOTUL_2', name: 'KOTUL 2', worker_id: 'w-balu' },
  { code: 'SAKUR', name: 'SAKUR', worker_id: 'w-balu' },
  { code: 'JORVE', name: 'JORVE', worker_id: 'w-balu' },
  { code: 'SAYKHINDI', name: 'SAYKHINDI', worker_id: 'w-balu' },
  { code: 'AKLAPUR', name: 'AKLAPUR', worker_id: 'w-balu' },
  { code: 'SAMSHERPUR', name: 'SAMSHERPUR', worker_id: 'w-balu' },
  { code: 'KUMBEPHAL', name: 'KUMBEPHAL', worker_id: 'w-balu' },
];

export async function seedOfficialRoutes(): Promise<void> {
  for (const r of OFFICIAL_ROUTES) {
    try {
      const { data: existing } = await supabase
        .from('routes')
        .select('id')
        .eq('code', r.code)
        .single();

      if (existing) {
        await supabase
          .from('routes')
          .update({ name: r.name, assigned_worker_id: r.worker_id })
          .eq('id', existing.id);
      } else {
        await supabase.from('routes').insert({
          code: r.code,
          name: r.name,
          assigned_worker_id: r.worker_id,
          status: 'active',
        });
      }
    } catch {
      // ignore
    }
  }
}

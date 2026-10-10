import { supabase, isMockMode } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type { Route, RouteDeletePreview } from '@/lib/database.types';

export interface ActorInfo {
  userId?: string;
  userName?: string;
  role?: string;
}

export async function getRoutes(): Promise<Route[]> {
  try {
    const { data, error } = await supabase
      .from('routes')
      .select('*, worker:workers(*)')
      .order('code');
    if (error || !data) {
      return isMockMode() ? mockStore.getRoutes() : [];
    }
    return data as Route[];
  } catch {
    return isMockMode() ? mockStore.getRoutes() : [];
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
      if (isMockMode()) {
        return mockStore.saveRoute(input);
      }
      throw new Error(`Failed to create route: ${error?.message || 'Unknown database error'}`);
    }
    if (isMockMode()) {
      mockStore.saveRoute(data as Route);
    }
    return data as Route;
  } catch (err: any) {
    if (isMockMode()) {
      return mockStore.saveRoute(input);
    }
    throw err;
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
      if (isMockMode()) {
        return mockStore.saveRoute({ id, ...input });
      }
      throw new Error(`Failed to update route: ${error?.message || 'Unknown database error'}`);
    }
    if (isMockMode()) {
      mockStore.saveRoute(data as Route);
    }
    return data as Route;
  } catch (err: any) {
    if (isMockMode()) {
      return mockStore.saveRoute({ id, ...input });
    }
    throw err;
  }
}

export interface ActorInfo {
  userId?: string;
  userName?: string;
  role?: string;
}

export async function getRouteDeletePreview(id: string): Promise<RouteDeletePreview> {
  const isOnline = typeof window === 'undefined' || typeof navigator === 'undefined' || navigator.onLine !== false;

  // 1. Try Supabase RPC
  try {
    const { data, error } = await (supabase.rpc as any)('get_route_delete_preview', { p_route_id: id });
    if (!error && data) {
      const preview = data as any;
      return {
        route_id: preview.route_id || id,
        route_code: preview.route_code || '',
        route_name: preview.route_name || '',
        assigned_worker_id: preview.assigned_worker_id || null,
        assigned_worker_name: preview.assigned_worker_name || null,
        assignments_count: preview.assigned_worker_id ? 1 : 0,
        picklists_count: Number(preview.picklists || 0),
        deliveries_count: Number(preview.deliveries || 0),
        delivery_items_count: Number(preview.delivery_items || 0),
        payments_count: Number(preview.payments || 0),
        expenses_count: Number(preview.expenses || 0),
        returns_count: Number(preview.returns || 0),
        inventory_movements_count: Number(preview.inventory_movements || 0),
        financial_records_count: Number(preview.financial_records || 0),
        exceptions_count: Number(preview.exceptions || 0),
        parties_unlinked_count: Number(preview.parties_unlinked || 0),
        has_pending_offline_mutations: !isOnline,
        can_delete: isOnline,
        block_reason: !isOnline ? 'Cannot delete route while offline.' : null,
      };
    }
  } catch (err) {
    console.warn('[ROUTE] get_route_delete_preview RPC failed, using table/store inspection:', err);
  }

  // 2. Direct Supabase table inspection fallback
  try {
    const { data: route } = await supabase.from('routes').select('*, worker:workers(*)').eq('id', id).maybeSingle();
    if (route) {
      const { data: picklists } = await supabase.from('picklists').select('id').eq('route_id', id);
      const plIds = (picklists || []).map((p: any) => p.id);

      let deliveries: any[] = [];
      if (plIds.length > 0) {
        const { data: dPl } = await supabase.from('deliveries').select('id').in('picklist_id', plIds);
        deliveries = dPl || [];
      }
      const { data: dRoute } = await supabase.from('deliveries').select('id').eq('route_id', id);
      for (const d of dRoute || []) {
        if (!deliveries.some((x) => x.id === d.id)) deliveries.push(d);
      }
      const delIds = deliveries.map((d) => d.id);

      let deliveryItemCount = 0;
      if (delIds.length > 0) {
        const { count } = await supabase.from('delivery_items').select('id', { count: 'exact', head: true }).in('delivery_id', delIds);
        deliveryItemCount = count || 0;
      }

      // Payments
      let paymentCount = 0;
      const { count: pRoute } = await supabase.from('payments').select('id', { count: 'exact', head: true }).eq('route_id', id);
      paymentCount = pRoute || 0;
      if (plIds.length > 0) {
        const { count: pPl } = await supabase.from('payments').select('id', { count: 'exact', head: true }).in('picklist_id', plIds);
        paymentCount += (pPl || 0);
      }

      // Expenses
      let expenseCount = 0;
      const { count: eRoute } = await supabase.from('expenses').select('id', { count: 'exact', head: true }).eq('route_id', id);
      expenseCount = eRoute || 0;

      // Stock exceptions
      let excCount = 0;
      const { count: excRes } = await supabase.from('route_stock_exceptions').select('id', { count: 'exact', head: true }).eq('route_id', id);
      excCount = excRes || 0;

      // Financial ledger
      let finCount = 0;
      const { count: pflRes } = await supabase.from('party_financial_ledger').select('id', { count: 'exact', head: true }).eq('route_id', id);
      finCount = pflRes || 0;

      // Route inventory movements
      let movCount = 0;
      const { count: movRes } = await supabase
        .from('inventory_movements')
        .select('id', { count: 'exact', head: true })
        .eq('route_id', id)
        .not('movement_type', 'in', '("purchase_inward","sap_sales_baseline","opening_balance")');
      movCount = movRes || 0;

      // Parties
      const { count: partiesCount } = await supabase.from('parties').select('id', { count: 'exact', head: true }).eq('route_id', id);

      return {
        route_id: route.id,
        route_code: route.code,
        route_name: route.name,
        assigned_worker_id: route.assigned_worker_id,
        assigned_worker_name: route.worker?.name || null,
        assignments_count: route.assigned_worker_id ? 1 : 0,
        picklists_count: picklists?.length || 0,
        deliveries_count: deliveries.length,
        delivery_items_count: deliveryItemCount,
        payments_count: paymentCount,
        expenses_count: expenseCount,
        returns_count: 0,
        inventory_movements_count: movCount,
        financial_records_count: finCount,
        exceptions_count: excCount,
        parties_unlinked_count: partiesCount || 0,
        has_pending_offline_mutations: !isOnline,
        can_delete: isOnline,
        block_reason: !isOnline ? 'Cannot delete route while offline.' : null,
      };
    }
  } catch (directErr) {
    console.warn('[ROUTE] Direct table inspection failed, using mockStore:', directErr);
  }

  // 3. Fallback to mockStore ONLY in mock mode
  if (isMockMode()) {
    const msPreview = mockStore.getRouteDeletePreview(id);
    return {
      ...msPreview,
      has_pending_offline_mutations: !isOnline,
      can_delete: isOnline,
      block_reason: !isOnline ? 'Cannot delete route while offline.' : null,
    };
  }

  return {
    route_id: id,
    route_code: '',
    route_name: '',
    assigned_worker_id: null,
    assigned_worker_name: null,
    assignments_count: 0,
    picklists_count: 0,
    deliveries_count: 0,
    delivery_items_count: 0,
    payments_count: 0,
    expenses_count: 0,
    returns_count: 0,
    inventory_movements_count: 0,
    financial_records_count: 0,
    exceptions_count: 0,
    parties_unlinked_count: 0,
    has_pending_offline_mutations: !isOnline,
    can_delete: isOnline,
    block_reason: !isOnline ? 'Cannot delete route while offline.' : null,
  };
}

export async function deleteRoute(
  id: string,
  force: boolean = true,
  hardDelete: boolean = true,
  actor?: ActorInfo
): Promise<void> {
  // 1. Guard against offline deletion
  const isOnline = typeof window === 'undefined' || typeof navigator === 'undefined' || navigator.onLine !== false;
  if (!isOnline) {
    throw new Error('Route hard delete cannot be performed offline. Please connect to the internet.');
  }

  // 2. Authorize role if actor provided
  if (actor !== undefined) {
    const r = (actor.role || '').toLowerCase().trim();
    if (!['owner', 'master', 'admin'].includes(r)) {
      throw new Error('Unauthorized: Only Admin or Master can delete routes.');
    }
  }

  // 2.5 Guard: Live routes with financial/operational history MUST NOT be hard deleted
  const preview = await getRouteDeletePreview(id).catch(() => null);
  const routeName = preview?.route_name || '';
  const routeCode = preview?.route_code || '';
  const isTestRoute =
    /^(TEST|DEMO|VERIF|SAMPLE)/i.test(routeCode) ||
    /^(TEST|DEMO|VERIF|SAMPLE)/i.test(routeName) ||
    id.toLowerCase().includes('test') ||
    isMockMode();
  const hasFinancialOrOperationalHistory =
    (preview?.payments_count || 0) > 0 ||
    (preview?.financial_records_count || 0) > 0 ||
    (preview?.deliveries_count || 0) > 0 ||
    (preview?.picklists_count || 0) > 0;

  if (!isTestRoute && hasFinancialOrOperationalHistory) {
    throw new Error(
      `LIVE ROUTE HARD DELETE BLOCKED: Route "${routeName}" contains live financial/operational history. Permanent deletion is blocked to protect historical audit records. Please ARCHIVE this route instead.`
    );
  }

  // 3. Server-side deletion via RPC or direct PostgREST dependency order
  let rpcSuccess = false;
  try {
    const { error: rpcError } = await (supabase.rpc as any)('hard_delete_route', { p_route_id: id });
    if (!rpcError) {
      rpcSuccess = true;
    } else if (rpcError.code === '42501' || rpcError.message?.includes('Unauthorized')) {
      throw new Error(rpcError.message || 'Unauthorized: Only Admin or Master can delete routes.');
    } else {
      // Try delete_route RPC with p_hard_delete parameter
      const { error: delRpcError } = await (supabase.rpc as any)('delete_route', {
        p_route_id: id,
        p_force: force,
        p_hard_delete: hardDelete,
      });
      if (!delRpcError) {
        rpcSuccess = true;
      }
    }
  } catch (err: any) {
    if (err.message?.includes('Unauthorized')) throw err;
  }

  // If server RPC was not executed or not available, execute direct PostgREST cleanup in dependency order
  if (!rpcSuccess) {
    try {
      // Discover picklists on this route
      const { data: plRes } = await supabase.from('picklists').select('id').eq('route_id', id);
      const plIds = (plRes || []).map((p: any) => p.id);

      // Discover deliveries on this route
      let delIds: string[] = [];
      if (plIds.length > 0) {
        const { data: dPl } = await supabase.from('deliveries').select('id').in('picklist_id', plIds);
        delIds = (dPl || []).map((d: any) => d.id);
      }
      const { data: dRoute } = await supabase.from('deliveries').select('id').eq('route_id', id);
      for (const d of dRoute || []) {
        if (!delIds.includes(d.id)) delIds.push(d.id);
      }

      // Step 1: Delete party financial ledger records for this route
      await supabase.from('party_financial_ledger').delete().eq('route_id', id);
      if (plIds.length > 0) {
        await supabase.from('party_financial_ledger').delete().in('picklist_id', plIds);
      }
      if (delIds.length > 0) {
        await supabase.from('party_financial_ledger').delete().in('delivery_id', delIds);
      }

      // Step 2: Delete payments
      await supabase.from('payments').delete().eq('route_id', id);
      if (plIds.length > 0) {
        await supabase.from('payments').delete().in('picklist_id', plIds);
      }
      if (delIds.length > 0) {
        await supabase.from('payments').delete().in('delivery_id', delIds);
      }

      // Step 3: Delete expenses
      await supabase.from('expenses').delete().eq('route_id', id);
      if (plIds.length > 0) {
        await supabase.from('expenses').delete().in('picklist_id', plIds);
      }

      // Step 4: Delete route stock exceptions
      await supabase.from('route_stock_exceptions').delete().eq('route_id', id);
      if (plIds.length > 0) {
        await supabase.from('route_stock_exceptions').delete().in('picklist_id', plIds);
      }

      // Step 5: Delete route-owned inventory movements ONLY (NEVER purchase_inward or sap_sales_baseline)
      await supabase
        .from('inventory_movements')
        .delete()
        .eq('route_id', id)
        .not('movement_type', 'in', '("purchase_inward","sap_sales_baseline","opening_balance")');
      if (plIds.length > 0) {
        await supabase
          .from('inventory_movements')
          .delete()
          .in('picklist_id', plIds)
          .not('movement_type', 'in', '("purchase_inward","sap_sales_baseline","opening_balance")');
      }

      // Step 6: Delete delivery items
      if (delIds.length > 0) {
        await supabase.from('delivery_items').delete().in('delivery_id', delIds);
      }

      // Step 7: Delete deliveries
      if (delIds.length > 0) {
        await supabase.from('deliveries').delete().in('id', delIds);
      }
      await supabase.from('deliveries').delete().eq('route_id', id);

      // Step 8: Delete picklist items & picklists
      if (plIds.length > 0) {
        try {
          await supabase.from('picklist_load_items').delete().in('picklist_id', plIds);
        } catch {}
        try {
          await supabase.from('picklist_parties').delete().in('picklist_id', plIds);
        } catch {}
        await supabase.from('picklist_items').delete().in('picklist_id', plIds);
        await supabase.from('picklists').delete().in('id', plIds);
      }

      // Step 9: Preserve Parties (unlink route_id = NULL)
      await supabase.from('parties').update({ route_id: null, updated_at: new Date().toISOString() }).eq('route_id', id);

      // Step 10: Delete Route itself
      const { error: delError } = await supabase.from('routes').delete().eq('id', id);
      if (delError && !delError.message?.includes('0 rows')) {
        // If trigger blocked direct delete, decouple route_id
        await supabase.from('routes').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', id);
      }
    } catch (directErr: any) {
      console.warn('[ROUTE] Direct deletion encountered error, syncing local store:', directErr);
    }
  }

  // 4. Synchronize local store (atomic deletion of route & route-owned data, preserving shared masters)
  if (isMockMode()) {
    mockStore.deleteRoute(id, force, hardDelete);
  }
}

export async function archiveRoute(id: string): Promise<Route | undefined> {
  const { error: rpcError } = await (supabase.rpc as any)('archive_route', { p_route_id: id });
  if (rpcError) {
    const { error: updError } = await supabase
      .from('routes')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (updError) {
      throw new Error(updError.message || rpcError.message);
    }
  }
  if (isMockMode()) {
    return mockStore.archiveRoute(id);
  }
  return undefined;
}

export async function unarchiveRoute(id: string): Promise<Route | undefined> {
  const { error: rpcError } = await (supabase.rpc as any)('unarchive_route', { p_route_id: id });
  if (rpcError) {
    const { error: updError } = await supabase
      .from('routes')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (updError) {
      throw new Error(updError.message || rpcError.message);
    }
  }
  if (isMockMode()) {
    return mockStore.unarchiveRoute(id);
  }
  return undefined;
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

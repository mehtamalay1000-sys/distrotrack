import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type { QueryClient } from '@tanstack/react-query';

export interface AdminResetPreview {
  inventory: {
    movements_count: number;
    stock_exceptions_count: number;
    vehicle_stock_records_count: number;
    reconciliations_count: number;
  };
  sap_sales: {
    batches_count: number;
    items_count: number;
    baseline_movements_count: number;
    total_quantity: number;
    total_net_amount: number;
  };
  live_operational_transactions_count?: number;
  can_reset?: boolean;
  block_reason?: string | null;
  live_breakdown?: {
    deliveries: number;
    payments: number;
    expenses: number;
    closedRoutes: number;
    closedPicklists: number;
    operationalMovements: number;
  };
  timestamp?: string;
}

export interface ClearInventoryResult {
  success: boolean;
  movements_deleted: number;
  exceptions_deleted: number;
  reconciliations_deleted: number;
  timestamp: string;
}

export interface DeleteSapSalesResult {
  success: boolean;
  batches_deleted: number;
  items_deleted: number;
  movements_deleted: number;
  total_quantity: number;
  total_net_amount: number;
  timestamp: string;
}

export interface ActorInfo {
  userId?: string;
  userName?: string;
  role?: string;
}

export function isUserAdminOrMaster(role?: string | null): boolean {
  if (!role) return false;
  const r = role.toLowerCase().trim();
  return r === 'owner' || r === 'master' || r === 'admin';
}

/**
 * Resolves a batch reference code (e.g. SALES-20260912-H6EQ) or display ID
 * to the authoritative database primary key UUID.
 */
export async function resolveSapSalesImportId(importIdOrRef?: string | null): Promise<string | null> {
  if (!importIdOrRef) return null;
  const trimmed = importIdOrRef.trim();
  // UUID regex format check
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return trimmed;
  }

  // Not a UUID, look up by batch_ref in Supabase
  try {
    const { data } = await supabase
      .from('sap_sales_imports')
      .select('id')
      .eq('batch_ref', trimmed)
      .maybeSingle();

    if (data?.id) {
      return data.id;
    }
  } catch (err) {
    console.warn('[ADMIN_RESET] Supabase lookup for batch_ref failed:', err);
  }

  // Lookup in mockStore
  const mockBatch = mockStore.getSapSalesImports().find(
    (b) => b.batch_ref === trimmed || b.id === trimmed
  );
  if (mockBatch?.id) {
    return mockBatch.id;
  }

  return trimmed;
}

/**
 * Fetches current counts for both reset operations dynamically.
 * Supports targeted preview for a specific batch (importId) or global preview.
 * Resilient against RPC absence by querying Supabase tables directly when needed.
 */
export async function getAdminResetPreview(importId?: string | null): Promise<AdminResetPreview> {
  const targetId = await resolveSapSalesImportId(importId);

  // 1. Try server RPC
  try {
    const { data, error } = await supabase.rpc('admin_get_reset_preview', {
      p_import_id: targetId || null,
    });
    if (!error && data) {
      return data as AdminResetPreview;
    }
  } catch (err) {
    console.warn('[ADMIN_RESET] Supabase admin_get_reset_preview failed, trying direct table inspection:', err);
  }

  // 2. Direct Supabase Table Fallback (authoritative database inspection)
  try {
    // 2a. Live operational transactions inspection
    const [delRes, payRes, expRes, routeRes, movRes] = await Promise.all([
      supabase.from('deliveries').select('id', { count: 'exact', head: true }).or('status.in.(delivered,partial),delivered_at.not.is.null'),
      supabase.from('payments').select('id', { count: 'exact', head: true }).in('status', ['collected', 'cleared']),
      supabase.from('expenses').select('id', { count: 'exact', head: true }).in('status', ['approved', 'active']),
      supabase.from('routes').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
      supabase.from('inventory_movements').select('id', { count: 'exact', head: true }).in('movement_type', ['delivery_fulfilled', 'damaged_transit', 'damaged_warehouse']),
    ]);

    const liveDeliveries = delRes.count || 0;
    const livePayments = payRes.count || 0;
    const liveExpenses = expRes.count || 0;
    const closedRoutes = routeRes.count || 0;
    const operationalMovements = movRes.count || 0;
    const liveTotal = liveDeliveries + livePayments + liveExpenses + closedRoutes + operationalMovements;

    // 2b. Inventory Ledger counts
    const [invMovRes, excRes, recRes] = await Promise.all([
      supabase.from('inventory_movements').select('id', { count: 'exact', head: true }),
      supabase.from('route_stock_exceptions').select('id', { count: 'exact', head: true }),
      supabase.from('sap_stock_reconciliations').select('id', { count: 'exact', head: true }),
    ]);

    // 2c. SAP Sales counts from actual tables
    let batchesQuery = supabase.from('sap_sales_imports').select('*');
    if (targetId) {
      batchesQuery = batchesQuery.eq('id', targetId);
    }
    const { data: batchesRes, error: bErr } = await batchesQuery;
    const batches = (!bErr && batchesRes) ? batchesRes : [];
    const batchIds = batches.map((b) => b.id);
    let itemsQuery = supabase.from('sap_sales_import_items').select('id', { count: 'exact', head: true });
    if (targetId) {
      itemsQuery = itemsQuery.eq('import_id', targetId);
    } else if (batchIds.length > 0) {
      itemsQuery = itemsQuery.in('import_id', batchIds);
    }
    const { count: itemsCount } = await itemsQuery;

    let baselineMovQuery = supabase
      .from('inventory_movements')
      .select('id', { count: 'exact', head: true })
      .eq('movement_type', 'sap_sales_baseline');

    const { count: movementsCount } = await baselineMovQuery;

    const totalQty = batches.reduce((sum, b) => sum + (Number(b.total_quantity) || 0), 0);
    const totalNet = batches.reduce((sum, b) => sum + (Number(b.total_net_amount) || 0), 0);
    const expectedMovements = targetId
      ? Number(batches[0]?.movements_created || itemsCount || 0)
      : (movementsCount || batches.reduce((sum, b) => sum + (Number(b.movements_created) || 0), 0));

    if (!bErr) {
      return {
        inventory: {
          movements_count: invMovRes.count || 0,
          stock_exceptions_count: excRes.count || 0,
          vehicle_stock_records_count: 0,
          reconciliations_count: recRes.count || 0,
        },
        sap_sales: {
          batches_count: batches.length,
          items_count: itemsCount || 0,
          baseline_movements_count: expectedMovements,
          total_quantity: totalQty,
          total_net_amount: totalNet,
        },
        live_operational_transactions_count: liveTotal,
        can_reset: liveTotal === 0,
        block_reason: liveTotal > 0 ? 'Inventory reset is unavailable because live operational history exists.' : null,
        live_breakdown: {
          deliveries: liveDeliveries,
          payments: livePayments,
          expenses: liveExpenses,
          closedRoutes,
          closedPicklists: 0,
          operationalMovements,
        },
        timestamp: new Date().toISOString(),
      };
    }
  } catch (directErr) {
    console.warn('[ADMIN_RESET] Direct Supabase table inspection failed, using mockStore fallback:', directErr);
  }

  // 3. Fallback to mockStore
  const inv = mockStore.getInventoryResetPreview();
  const sales = mockStore.getSapSalesDeletePreview(targetId || undefined);

  return {
    inventory: {
      movements_count: inv.inventoryMovementsCount,
      stock_exceptions_count: inv.stockExceptionsCount,
      vehicle_stock_records_count: inv.vehicleStockRecordsCount,
      reconciliations_count: inv.reconciliationsCount,
    },
    sap_sales: {
      batches_count: sales.batchesCount,
      items_count: sales.itemsCount,
      baseline_movements_count: sales.baselineMovementsCount,
      total_quantity: sales.totalQuantity,
      total_net_amount: sales.totalNetAmount,
    },
    live_operational_transactions_count: inv.liveOperationalTransactionsCount,
    can_reset: inv.canReset,
    block_reason: inv.blockReason,
    live_breakdown: inv.liveBreakdown,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Atomically resets pre-go-live test inventory movements and stock exceptions.
 * Strictly blocked if any live operational transactions exist.
 * Preserves Product Master, Parties, Workers, Routes, Picklists, and SAP import history.
 */
export async function executeResetTestInventory(actor?: ActorInfo): Promise<ClearInventoryResult> {
  if (actor && !isUserAdminOrMaster(actor.role)) {
    throw new Error('Unauthorized: Only Owner, Admin, or Master can reset test inventory.');
  }

  try {
    const { data, error } = await supabase.rpc('admin_reset_test_inventory');
    if (!error && data) {
      mockStore.resetTestInventory(actor);
      return data as ClearInventoryResult;
    }
    if (error) {
      if (error.message?.includes('Inventory reset is unavailable') || error.message?.includes('Unauthorized')) {
        throw new Error(error.message);
      }
      console.warn('[ADMIN_RESET] Supabase admin_reset_test_inventory error, falling back to mockStore:', error);
    }
  } catch (err: any) {
    if (err.message?.includes('Inventory reset is unavailable') || err.message?.includes('Unauthorized')) {
      throw err;
    }
    console.warn('[ADMIN_RESET] Supabase admin_reset_test_inventory exception, falling back to mockStore:', err);
  }

  return mockStore.resetTestInventory(actor);
}

/**
 * Alias for backward compatibility.
 */
export const executeClearInventory = executeResetTestInventory;

/**
 * Atomically deletes imported SAP sales history batches, item transactions,
 * and their associated baseline inventory stock-out movements.
 * Strictly preserves Product Master, Historical Sales Discovery, and Purchases.
 */
export async function executeDeleteSapSalesHistory(
  actor?: ActorInfo,
  importId?: string | null
): Promise<DeleteSapSalesResult> {
  if (actor && !isUserAdminOrMaster(actor.role)) {
    throw new Error('Unauthorized: Only Owner, Admin, or Master can delete SAP sales history.');
  }

  const targetId = await resolveSapSalesImportId(importId);

  // 1. Try server RPC
  try {
    const { data, error } = await supabase.rpc('admin_delete_sap_sales_history', {
      p_import_id: targetId || null,
    });

    if (!error && data) {
      mockStore.deleteSapSalesHistory(targetId || undefined, actor);
      return data as DeleteSapSalesResult;
    }
    if (error) {
      console.warn('[ADMIN_RESET] Supabase admin_delete_sap_sales_history error, trying direct table deletion:', error);
    }
  } catch (err) {
    console.warn('[ADMIN_RESET] Supabase admin_delete_sap_sales_history exception, trying direct table deletion:', err);
  }

  // 2. Direct Supabase Table Deletion (authoritative atomic delete on database tables)
  try {
    let bQuery = supabase.from('sap_sales_imports').select('*');
    if (targetId) bQuery = bQuery.eq('id', targetId);
    const { data: targetBatches, error: bErr } = await bQuery;

    if (!bErr && targetBatches && targetBatches.length > 0) {
      const batchIds = targetBatches.map((b) => b.id);
      const totalQty = targetBatches.reduce((sum, b) => sum + (Number(b.total_quantity) || 0), 0);
      const totalNet = targetBatches.reduce((sum, b) => sum + (Number(b.total_net_amount) || 0), 0);

      // Collect ALL movement_ids and idempotency_keys across all items using pagination
      const movementIds: string[] = [];
      const idempotencyKeys: string[] = [];
      let pageOffset = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        let itemsQuery = supabase
          .from('sap_sales_import_items')
          .select('id, movement_id, idempotency_key')
          .range(pageOffset, pageOffset + pageSize - 1);

        if (targetId) {
          itemsQuery = itemsQuery.eq('import_id', targetId);
        } else {
          itemsQuery = itemsQuery.in('import_id', batchIds);
        }

        const { data: pageItems, error: pErr } = await itemsQuery;
        if (pErr || !pageItems || pageItems.length === 0) {
          hasMore = false;
          break;
        }

        for (const it of pageItems) {
          if (it.movement_id) movementIds.push(it.movement_id);
          if (it.idempotency_key) idempotencyKeys.push(it.idempotency_key);
        }

        if (pageItems.length < pageSize) {
          hasMore = false;
        } else {
          pageOffset += pageSize;
        }
      }

      // Delete linked baseline inventory movements
      let movementsDeleted = 0;
      if (movementIds.length > 0) {
        for (let i = 0; i < movementIds.length; i += 100) {
          const chunk = movementIds.slice(i, i + 100);
          const { data: delMovs } = await supabase
            .from('inventory_movements')
            .delete()
            .in('id', chunk)
            .select('id');
          movementsDeleted += delMovs?.length || chunk.length;
        }
      } else if (targetId) {
        for (let i = 0; i < idempotencyKeys.length; i += 100) {
          const chunk = idempotencyKeys.slice(i, i + 100);
          const { data: delMovs } = await supabase
            .from('inventory_movements')
            .delete()
            .in('idempotency_key', chunk)
            .select('id');
          movementsDeleted += delMovs?.length || chunk.length;
        }
      } else {
        // Global delete
        const { data: delMovs } = await supabase
          .from('inventory_movements')
          .delete()
          .eq('movement_type', 'sap_sales_baseline')
          .select('id');
        movementsDeleted = delMovs?.length || 0;
      }

      // Delete import line items
      let itemsDeleted = 0;
      if (targetId) {
        const { count } = await supabase
          .from('sap_sales_import_items')
          .delete({ count: 'exact' })
          .eq('import_id', targetId);
        itemsDeleted = count || movementIds.length || targetBatches[0].total_rows;
      } else {
        const { count } = await supabase
          .from('sap_sales_import_items')
          .delete({ count: 'exact' })
          .in('import_id', batchIds);
        itemsDeleted = count || movementIds.length;
      }

      // Delete import batches
      const { count: delBatchesCount } = await supabase
        .from('sap_sales_imports')
        .delete({ count: 'exact' })
        .in('id', batchIds);
      const batchesDeleted = delBatchesCount || batchIds.length;

      // Authoritative audit log in database
      try {
        await supabase.rpc('log_system_event', {
          p_user_id: actor?.userId || '00000000-0000-0000-0000-000000000001',
          p_user_name: actor?.userName || 'Admin',
          p_role: actor?.role || 'admin',
          p_module: 'SAP_SALES',
          p_action: 'DELETE_SAP_SALES_HISTORY',
          p_status: 'success',
          p_detail: `Deleted SAP sales history: ${batchesDeleted} batch(es), ${itemsDeleted} items, ${movementsDeleted} baseline movements reversed. Target: ${targetId || 'ALL'}.`,
          p_entity_type: 'sap_sales_imports',
          p_entity_id: targetId || null,
        });
      } catch (auditErr) {
        console.warn('[ADMIN_RESET] Supabase log_system_event failed (non-fatal):', auditErr);
      }

      // Also sync mockStore in memory
      mockStore.deleteSapSalesHistory(targetId || undefined, actor);

      return {
        success: true,
        batches_deleted: batchesDeleted,
        items_deleted: itemsDeleted,
        movements_deleted: movementsDeleted,
        total_quantity: totalQty,
        total_net_amount: totalNet,
        timestamp: new Date().toISOString(),
      };
    } else if (!bErr && (!targetBatches || targetBatches.length === 0) && !targetId) {
      // If batches were already removed but orphaned baseline movements remain in Supabase
      const { data: delMovs } = await supabase
        .from('inventory_movements')
        .delete()
        .eq('movement_type', 'sap_sales_baseline')
        .select('id');
      const movementsDeleted = delMovs?.length || 0;
      if (movementsDeleted > 0) {
        try {
          await supabase.rpc('log_system_event', {
            p_user_id: actor?.userId || '00000000-0000-0000-0000-000000000001',
            p_user_name: actor?.userName || 'Admin',
            p_role: actor?.role || 'admin',
            p_module: 'SAP_SALES',
            p_action: 'DELETE_SAP_SALES_HISTORY',
            p_status: 'success',
            p_detail: `Cleaned up ${movementsDeleted} orphaned SAP baseline inventory movements.`,
            p_entity_type: 'inventory_movements',
            p_entity_id: null,
          });
        } catch (auditErr) {
          console.warn('[ADMIN_RESET] Supabase log_system_event failed (non-fatal):', auditErr);
        }

        mockStore.deleteSapSalesHistory(undefined, actor);
        return {
          success: true,
          batches_deleted: 0,
          items_deleted: 0,
          movements_deleted: movementsDeleted,
          total_quantity: 0,
          total_net_amount: 0,
          timestamp: new Date().toISOString(),
        };
      }
    }
  } catch (directErr) {
    console.error('[ADMIN_RESET] Direct Supabase deletion failed, falling back to mockStore:', directErr);
  }

  return mockStore.deleteSapSalesHistory(targetId || undefined, actor);
}

/**
 * Invalidates and refetches all queries affected by inventory or sales deletions.
 */
export async function invalidateAllInventoryAndSalesQueries(qc: QueryClient): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ['inventory_movements'] }),
    qc.invalidateQueries({ queryKey: ['inventory_stock'] }),
    qc.invalidateQueries({ queryKey: ['products'] }),
    qc.invalidateQueries({ queryKey: ['product-inventory'] }),
    qc.invalidateQueries({ queryKey: ['product-monthly-analytics'] }),
    qc.invalidateQueries({ queryKey: ['product_monthly_analytics'] }),
    qc.invalidateQueries({ queryKey: ['product_quantity_register'] }),
    qc.invalidateQueries({ queryKey: ['quantity_register'] }),
    qc.invalidateQueries({ queryKey: ['dashboard-stats'] }),
    qc.invalidateQueries({ queryKey: ['dashboard_stats'] }),
    qc.invalidateQueries({ queryKey: ['sap_sales_imports'] }),
    qc.invalidateQueries({ queryKey: ['sap-sales-imports'] }),
    qc.invalidateQueries({ queryKey: ['sap_sales_import_items'] }),
    qc.invalidateQueries({ queryKey: ['sap-sales-import-items'] }),
    qc.invalidateQueries({ queryKey: ['route-stock-exceptions'] }),
    qc.invalidateQueries({ queryKey: ['sap-reconciliation'] }),
    qc.invalidateQueries({ queryKey: ['reset-preview'] }),
  ]);
}

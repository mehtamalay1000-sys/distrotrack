-- ============================================================================
-- MIGRATION 025: COMPLETE SAP SALES CASCADE DELETE & INVENTORY RESTORATION
-- Project: DistroTrack v2
-- Target: towyscllpnwofgweyrqi
-- Invariants:
--   - Owner/Master role check strictly enforced via is_current_user_admin_or_master()
--   - inventory_movements DELETE policy enables authorized purge of baseline movements
--   - Server-side atomic RPC: admin_delete_sap_sales_history
--   - Preserves Product Master, purchases, deliveries, payments, expenses, returns
--   - Preserves historical_sales_products catalog
-- ============================================================================

-- ── 1. RLS Policy: Grant DELETE on inventory_movements to Admin/Master ─────
DROP POLICY IF EXISTS "inventory_movements_admin_master_delete" ON public.inventory_movements;

CREATE POLICY "inventory_movements_admin_master_delete"
  ON public.inventory_movements FOR DELETE
  TO authenticated
  USING (public.is_current_user_admin_or_master());

-- ── 2. Authoritative Atomic RPC: admin_delete_sap_sales_history ────────────
CREATE OR REPLACE FUNCTION public.admin_delete_sap_sales_history(
  p_import_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_batches_deleted integer := 0;
  v_items_deleted integer := 0;
  v_movements_deleted integer := 0;
  v_total_qty numeric := 0;
  v_total_net numeric := 0;
BEGIN
  -- Strict role verification: Only Owner or Master may delete SAP sales history
  IF NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Authorization failure: Only Admin or Master can delete SAP sales history.'
      USING ERRCODE = '42501';
  END IF;

  v_caller_id := auth.uid();

  IF p_import_id IS NOT NULL THEN
    -- Target a specific import batch
    SELECT count(*), COALESCE(sum(total_quantity), 0), COALESCE(sum(total_net_amount), 0)
      INTO v_batches_deleted, v_total_qty, v_total_net
      FROM public.sap_sales_imports
     WHERE id = p_import_id;

    -- Collect items deleted count
    SELECT count(*) INTO v_items_deleted
      FROM public.sap_sales_import_items
     WHERE import_id = p_import_id;

    -- Count movements to delete (either directly linked or matching batch idempotency keys)
    SELECT count(*) INTO v_movements_deleted
      FROM public.inventory_movements
     WHERE id IN (SELECT movement_id FROM public.sap_sales_import_items WHERE import_id = p_import_id AND movement_id IS NOT NULL)
        OR idempotency_key IN (SELECT idempotency_key FROM public.sap_sales_import_items WHERE import_id = p_import_id);

    -- Delete associated inventory movements atomically
    DELETE FROM public.inventory_movements
     WHERE id IN (SELECT movement_id FROM public.sap_sales_import_items WHERE import_id = p_import_id AND movement_id IS NOT NULL)
        OR idempotency_key IN (SELECT idempotency_key FROM public.sap_sales_import_items WHERE import_id = p_import_id);

    -- Delete import line items
    DELETE FROM public.sap_sales_import_items WHERE import_id = p_import_id;

    -- Delete batch header
    DELETE FROM public.sap_sales_imports WHERE id = p_import_id;

  ELSE
    -- Target ALL SAP sales baseline data (including orphaned baseline movements)
    SELECT count(*), COALESCE(sum(total_quantity), 0), COALESCE(sum(total_net_amount), 0)
      INTO v_batches_deleted, v_total_qty, v_total_net
      FROM public.sap_sales_imports
     WHERE true;

    SELECT count(*) INTO v_items_deleted
      FROM public.sap_sales_import_items
     WHERE true;

    SELECT count(*) INTO v_movements_deleted
      FROM public.inventory_movements
     WHERE movement_type = 'sap_sales_baseline'
        OR idempotency_key LIKE 'sales_import:%'
        OR id IN (SELECT movement_id FROM public.sap_sales_import_items WHERE movement_id IS NOT NULL);

    -- Delete all baseline movements from inventory ledger
    DELETE FROM public.inventory_movements
     WHERE movement_type = 'sap_sales_baseline'
        OR idempotency_key LIKE 'sales_import:%'
        OR id IN (SELECT movement_id FROM public.sap_sales_import_items WHERE movement_id IS NOT NULL);

    -- Delete all sales line items and batches (with explicit WHERE clauses)
    DELETE FROM public.sap_sales_import_items WHERE true;
    DELETE FROM public.sap_sales_imports WHERE true;

  END IF;

  -- Authoritative Audit Log
  BEGIN
    PERFORM public.log_system_event(
      COALESCE(v_caller_id::text, '00000000-0000-0000-0000-000000000001'),
      'Admin/Master',
      'admin',
      'SAP_SALES',
      'DELETE_SAP_SALES_HISTORY',
      'success',
      'Admin deleted SAP sales history: ' || v_batches_deleted || ' batches, ' || v_items_deleted || ' items, ' || v_movements_deleted || ' baseline movements removed.',
      'sap_sales_imports',
      p_import_id::text
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'batches_deleted', v_batches_deleted,
    'items_deleted', v_items_deleted,
    'movements_deleted', v_movements_deleted,
    'total_quantity', v_total_qty,
    'total_net_amount', v_total_net,
    'timestamp', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_sap_sales_history(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_delete_sap_sales_history(uuid) FROM anon, PUBLIC;

-- ── 3. Reset Preview RPC: admin_get_reset_preview ──────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_reset_preview(
  p_import_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_batches_count integer := 0;
  v_items_count integer := 0;
  v_baseline_movements_count integer := 0;
  v_total_qty numeric := 0;
  v_total_net numeric := 0;
  v_live_total integer := 0;
  v_live_deliveries integer := 0;
  v_live_payments integer := 0;
  v_live_expenses integer := 0;
  v_closed_routes integer := 0;
  v_op_movements integer := 0;
  v_inv_movements integer := 0;
  v_exceptions_count integer := 0;
  v_reconciliations_count integer := 0;
BEGIN
  -- Strict role verification
  IF NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Authorization failure: Only Admin or Master can view reset preview.'
      USING ERRCODE = '42501';
  END IF;

  -- 1. Live operational transactions
  SELECT count(*) INTO v_live_deliveries
    FROM public.deliveries
   WHERE status IN ('delivered', 'partial') OR delivered_at IS NOT NULL;

  SELECT count(*) INTO v_live_payments
    FROM public.payments
   WHERE status IN ('collected', 'cleared');

  SELECT count(*) INTO v_live_expenses
    FROM public.expenses
   WHERE status IN ('approved', 'active');

  SELECT count(*) INTO v_closed_routes
    FROM public.routes
   WHERE status = 'completed';

  SELECT count(*) INTO v_op_movements
    FROM public.inventory_movements
   WHERE movement_type IN ('delivery_fulfilled', 'damaged_transit', 'damaged_warehouse');

  v_live_total := v_live_deliveries + v_live_payments + v_live_expenses + v_closed_routes + v_op_movements;

  -- 2. Inventory movements total
  SELECT count(*) INTO v_inv_movements FROM public.inventory_movements WHERE true;
  SELECT count(*) INTO v_exceptions_count FROM public.route_stock_exceptions WHERE true;
  SELECT count(*) INTO v_reconciliations_count FROM public.sap_stock_reconciliations WHERE true;

  -- 3. SAP Sales counts (including orphaned movements)
  IF p_import_id IS NOT NULL THEN
    SELECT count(*), COALESCE(sum(total_quantity), 0), COALESCE(sum(total_net_amount), 0)
      INTO v_batches_count, v_total_qty, v_total_net
      FROM public.sap_sales_imports
     WHERE id = p_import_id;

    SELECT count(*) INTO v_items_count
      FROM public.sap_sales_import_items
     WHERE import_id = p_import_id;

    SELECT count(*) INTO v_baseline_movements_count
      FROM public.inventory_movements
     WHERE id IN (SELECT movement_id FROM public.sap_sales_import_items WHERE import_id = p_import_id AND movement_id IS NOT NULL)
        OR idempotency_key IN (SELECT idempotency_key FROM public.sap_sales_import_items WHERE import_id = p_import_id);
  ELSE
    SELECT count(*), COALESCE(sum(total_quantity), 0), COALESCE(sum(total_net_amount), 0)
      INTO v_batches_count, v_total_qty, v_total_net
      FROM public.sap_sales_imports
     WHERE true;

    SELECT count(*) INTO v_items_count
      FROM public.sap_sales_import_items
     WHERE true;

    SELECT count(*) INTO v_baseline_movements_count
      FROM public.inventory_movements
     WHERE movement_type = 'sap_sales_baseline'
        OR idempotency_key LIKE 'sales_import:%'
        OR id IN (SELECT movement_id FROM public.sap_sales_import_items WHERE movement_id IS NOT NULL);
  END IF;

  RETURN jsonb_build_object(
    'inventory', jsonb_build_object(
      'movements_count', v_inv_movements,
      'stock_exceptions_count', v_exceptions_count,
      'vehicle_stock_records_count', 0,
      'reconciliations_count', v_reconciliations_count
    ),
    'sap_sales', jsonb_build_object(
      'batches_count', v_batches_count,
      'items_count', v_items_count,
      'baseline_movements_count', v_baseline_movements_count,
      'total_quantity', v_total_qty,
      'total_net_amount', v_total_net
    ),
    'live_operational_transactions_count', v_live_total,
    'can_reset', (v_live_total = 0),
    'block_reason', CASE WHEN v_live_total > 0 THEN 'Inventory reset is unavailable because live operational history exists.' ELSE NULL END,
    'live_breakdown', jsonb_build_object(
      'deliveries', v_live_deliveries,
      'payments', v_live_payments,
      'expenses', v_live_expenses,
      'closedRoutes', v_closed_routes,
      'closedPicklists', 0,
      'operationalMovements', v_op_movements
    ),
    'timestamp', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_reset_preview(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_get_reset_preview(uuid) FROM anon, PUBLIC;

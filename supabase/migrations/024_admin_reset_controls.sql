-- ================================================================
-- Migration 024: Admin/Master Reset Controls (Safety Hardened)
-- ================================================================
-- Implements controlled, atomic, destructive reset procedures for
-- Owner/Admin/Master roles with PRE-GO-LIVE LIVE-TRANSACTION GUARDS:
--
-- 1. admin_get_reset_preview()
--    Returns actual scope counts for both operations AND inspects
--    whether live operational transactions exist (deliveries, payments,
--    expenses, closed routes, delivery movements).
--
-- 2. admin_reset_test_inventory() / admin_clear_inventory()
--    Pre-go-live test inventory reset.
--    MANDATORY GUARD: If ANY live operational history exists, the reset
--    is BLOCKED server-side with an explicit error:
--    'Inventory reset is unavailable because live operational history exists.'
--    When allowed, removes test/import inventory movements and exceptions
--    while preserving Product Master, Parties, Workers, Routes, Picklists.
--
-- 3. admin_delete_sap_sales_history(p_import_id uuid DEFAULT NULL)
--    Atomically deletes imported SAP sales batches, items, and
--    their associated sap_sales_baseline inventory stock-out movements
--    without touching Product Master, Historical Sales Discovery,
--    or Purchase History.
-- ================================================================

-- ── 1. RPC: admin_get_reset_preview ─────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_reset_preview(
  p_import_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  -- Live operational checks
  v_live_deliveries integer := 0;
  v_live_payments integer := 0;
  v_live_expenses integer := 0;
  v_closed_routes integer := 0;
  v_operational_movements integer := 0;
  v_live_total integer := 0;

  -- Test inventory counts
  v_inv_movements integer := 0;
  v_stock_exceptions integer := 0;
  v_vehicle_stock_records integer := 0;
  v_reconciliations integer := 0;

  -- SAP Sales counts
  v_sales_batches integer := 0;
  v_sales_items integer := 0;
  v_sales_movements integer := 0;
  v_sales_total_qty numeric := 0;
  v_sales_total_net numeric := 0;
BEGIN
  -- Strict role verification
  IF NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Authorization failure: Only Admin or Master can preview reset controls.'
      USING ERRCODE = '42501';
  END IF;

  -- 1. Live Operational History Guard Inspection
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

  SELECT count(*) INTO v_operational_movements
    FROM public.inventory_movements
   WHERE movement_type IN ('delivery_fulfilled', 'damaged_transit', 'damaged_warehouse')
      OR (movement_type = 'route_return' AND delivery_id IS NOT NULL);

  v_live_total := v_live_deliveries + v_live_payments + v_live_expenses + v_closed_routes + v_operational_movements;

  -- 2. Inventory Ledger Counts
  SELECT count(*) INTO v_inv_movements FROM public.inventory_movements;
  SELECT count(*) INTO v_stock_exceptions FROM public.route_stock_exceptions;
  SELECT count(*) INTO v_vehicle_stock_records 
    FROM public.inventory_movements 
   WHERE to_location = 'vehicle' OR from_location = 'vehicle' OR movement_type = 'route_load';
  SELECT count(*) INTO v_reconciliations FROM public.sap_stock_reconciliations;

  -- 3. SAP Sales Counts (Targeted vs Global)
  IF p_import_id IS NOT NULL THEN
    SELECT count(*) INTO v_sales_batches FROM public.sap_sales_imports WHERE id = p_import_id;
    SELECT count(*) INTO v_sales_items FROM public.sap_sales_import_items WHERE import_id = p_import_id;
    SELECT count(*) INTO v_sales_movements 
      FROM public.inventory_movements 
     WHERE id IN (SELECT movement_id FROM public.sap_sales_import_items WHERE import_id = p_import_id AND movement_id IS NOT NULL)
        OR idempotency_key IN (SELECT idempotency_key FROM public.sap_sales_import_items WHERE import_id = p_import_id);

    SELECT COALESCE(sum(total_quantity), 0), COALESCE(sum(total_net_amount), 0)
      INTO v_sales_total_qty, v_sales_total_net
      FROM public.sap_sales_imports
     WHERE id = p_import_id;
  ELSE
    SELECT count(*) INTO v_sales_batches FROM public.sap_sales_imports;
    SELECT count(*) INTO v_sales_items FROM public.sap_sales_import_items;
    SELECT count(*) INTO v_sales_movements 
      FROM public.inventory_movements 
     WHERE movement_type = 'sap_sales_baseline' 
        OR idempotency_key LIKE 'sales_import:%'
        OR id IN (SELECT movement_id FROM public.sap_sales_import_items WHERE movement_id IS NOT NULL);

    SELECT COALESCE(sum(total_quantity), 0), COALESCE(sum(total_net_amount), 0)
      INTO v_sales_total_qty, v_sales_total_net
      FROM public.sap_sales_imports;
  END IF;

  RETURN jsonb_build_object(
    'live_operational_transactions_count', v_live_total,
    'can_reset', (v_live_total = 0),
    'block_reason', CASE 
      WHEN v_live_total > 0 THEN 'Inventory reset is unavailable because live operational history exists.'
      ELSE NULL 
    END,
    'live_breakdown', jsonb_build_object(
      'completed_deliveries', v_live_deliveries,
      'collected_payments', v_live_payments,
      'approved_expenses', v_live_expenses,
      'closed_routes', v_closed_routes,
      'operational_movements', v_operational_movements
    ),
    'inventory', jsonb_build_object(
      'movements_count', v_inv_movements,
      'stock_exceptions_count', v_stock_exceptions,
      'vehicle_stock_records_count', v_vehicle_stock_records,
      'reconciliations_count', v_reconciliations
    ),
    'sap_sales', jsonb_build_object(
      'batches_count', v_sales_batches,
      'items_count', v_sales_items,
      'baseline_movements_count', v_sales_movements,
      'total_quantity', v_sales_total_qty,
      'total_net_amount', v_sales_total_net
    ),
    'timestamp', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_reset_preview(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_get_reset_preview(uuid) FROM anon, PUBLIC;

-- ── 2. RPC: admin_reset_test_inventory ───────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reset_test_inventory()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  -- Live operational checks
  v_live_deliveries integer := 0;
  v_live_payments integer := 0;
  v_live_expenses integer := 0;
  v_closed_routes integer := 0;
  v_operational_movements integer := 0;
  v_live_total integer := 0;

  v_movements_deleted integer := 0;
  v_exceptions_deleted integer := 0;
  v_reconciliations_deleted integer := 0;
  v_caller_id uuid;
BEGIN
  -- Strict role verification
  IF NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Authorization failure: Only Admin or Master can execute Reset Test Inventory.'
      USING ERRCODE = '42501';
  END IF;

  v_caller_id := auth.uid();

  -- 1. MANDATORY LIVE-TRANSACTION GUARD
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

  SELECT count(*) INTO v_operational_movements
    FROM public.inventory_movements
   WHERE movement_type IN ('delivery_fulfilled', 'damaged_transit', 'damaged_warehouse')
      OR (movement_type = 'route_return' AND delivery_id IS NOT NULL);

  v_live_total := v_live_deliveries + v_live_payments + v_live_expenses + v_closed_routes + v_operational_movements;

  IF v_live_total > 0 THEN
    RAISE EXCEPTION 'Inventory reset is unavailable because live operational history exists.'
      USING ERRCODE = '22000';
  END IF;

  -- 2. Scope counts before deletion
  SELECT count(*) INTO v_movements_deleted FROM public.inventory_movements;
  SELECT count(*) INTO v_exceptions_deleted FROM public.route_stock_exceptions;
  SELECT count(*) INTO v_reconciliations_deleted FROM public.sap_stock_reconciliations;

  -- 3. Delete test stock reconciliation records
  DELETE FROM public.sap_stock_reconciliation_items;
  DELETE FROM public.sap_stock_reconciliations;

  -- 4. Delete test stock shortage exceptions and unmapped SKU exceptions
  DELETE FROM public.route_stock_exceptions;
  DELETE FROM public.unmapped_sku_exceptions;

  -- 5. Delete test/import inventory ledger movements
  -- In pre-go-live state with 0 live transactions, all movements originate from test imports/snapshots
  DELETE FROM public.inventory_movements;

  -- 6. Authoritative Audit Log
  PERFORM public.log_system_event(
    v_caller_id::text,
    NULL,
    'admin',
    'INVENTORY',
    'RESET_TEST_INVENTORY',
    'success',
    'Admin reset test inventory: ' || v_movements_deleted || ' test movements cleared, ' || v_exceptions_deleted || ' test exceptions cleared.',
    'inventory_movements',
    NULL
  );

  RETURN jsonb_build_object(
    'success', true,
    'movements_deleted', v_movements_deleted,
    'exceptions_deleted', v_exceptions_deleted,
    'reconciliations_deleted', v_reconciliations_deleted,
    'live_operational_transactions', 0,
    'timestamp', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reset_test_inventory() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_reset_test_inventory() FROM anon, PUBLIC;

-- Backward-compatibility alias
CREATE OR REPLACE FUNCTION public.admin_clear_inventory()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  RETURN public.admin_reset_test_inventory();
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_clear_inventory() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_clear_inventory() FROM anon, PUBLIC;

-- ── 3. RPC: admin_delete_sap_sales_history ────────────────────────
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
  -- Strict role verification
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

    IF v_batches_deleted = 0 THEN
      RAISE EXCEPTION 'Target SAP sales import batch % not found.', p_import_id
        USING ERRCODE = 'P0002';
    END IF;

    SELECT count(*) INTO v_items_deleted
      FROM public.sap_sales_import_items
     WHERE import_id = p_import_id;

    -- Count movements to delete
    SELECT count(*) INTO v_movements_deleted
      FROM public.inventory_movements
     WHERE id IN (SELECT movement_id FROM public.sap_sales_import_items WHERE import_id = p_import_id AND movement_id IS NOT NULL)
        OR idempotency_key IN (SELECT idempotency_key FROM public.sap_sales_import_items WHERE import_id = p_import_id);

    -- Delete associated inventory movements atomically
    DELETE FROM public.inventory_movements
     WHERE id IN (SELECT movement_id FROM public.sap_sales_import_items WHERE import_id = p_import_id AND movement_id IS NOT NULL)
        OR idempotency_key IN (SELECT idempotency_key FROM public.sap_sales_import_items WHERE import_id = p_import_id);

    -- Delete items
    DELETE FROM public.sap_sales_import_items WHERE import_id = p_import_id;

    -- Delete batch record
    DELETE FROM public.sap_sales_imports WHERE id = p_import_id;

  ELSE
    -- Target all SAP sales imports
    SELECT count(*), COALESCE(sum(total_quantity), 0), COALESCE(sum(total_net_amount), 0)
      INTO v_batches_deleted, v_total_qty, v_total_net
      FROM public.sap_sales_imports;

    SELECT count(*) INTO v_items_deleted
      FROM public.sap_sales_import_items;

    SELECT count(*) INTO v_movements_deleted
      FROM public.inventory_movements
     WHERE movement_type = 'sap_sales_baseline'
        OR idempotency_key LIKE 'sales_import:%'
        OR id IN (SELECT movement_id FROM public.sap_sales_import_items WHERE movement_id IS NOT NULL);

    -- Delete associated inventory movements atomically
    DELETE FROM public.inventory_movements
     WHERE movement_type = 'sap_sales_baseline'
        OR idempotency_key LIKE 'sales_import:%'
        OR id IN (SELECT movement_id FROM public.sap_sales_import_items WHERE movement_id IS NOT NULL);

    -- Delete all sales line items and batch imports
    DELETE FROM public.sap_sales_import_items;
    DELETE FROM public.sap_sales_imports;

  END IF;

  -- Authoritative Audit Log
  PERFORM public.log_system_event(
    v_caller_id::text,
    NULL,
    'admin',
    'SAP_SALES',
    'DELETE_SAP_SALES_HISTORY',
    'success',
    'Admin deleted SAP sales history: ' || v_batches_deleted || ' batches, ' || v_items_deleted || ' items, ' || v_movements_deleted || ' baseline movements removed.',
    'sap_sales_imports',
    p_import_id::text
  );

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

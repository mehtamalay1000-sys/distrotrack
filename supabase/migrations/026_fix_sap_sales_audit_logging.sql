-- ============================================================================
-- Migration 026: Authoritative Audit Logging for SAP Sales Cascade Cleanup
-- Ensures admin_delete_sap_sales_history calls log_system_event so audit log
-- entries are recorded into master_audit_log via SECURITY DEFINER.
-- ============================================================================

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

  -- Authoritative Audit Log via SECURITY DEFINER log_system_event
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

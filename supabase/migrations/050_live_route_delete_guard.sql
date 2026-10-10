-- ============================================================================
-- Migration 050: Live Route Hard-Delete Guard & Operational Protection
-- DistroTrack v2 — Enforce Live Route Deletion Safety in PostgreSQL RPC
-- ============================================================================

-- Update hard_delete_route to block permanent deletion of live routes
-- with financial or operational history, directing callers to archiveRoute instead.

CREATE OR REPLACE FUNCTION public.hard_delete_route(
  p_route_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_route record;
  v_picklist_ids uuid[] := '{}';
  v_delivery_ids uuid[] := '{}';
  v_payment_ids uuid[] := '{}';
  v_expense_ids uuid[] := '{}';
  v_exception_ids uuid[] := '{}';
  v_movement_ids uuid[] := '{}';
  v_ledger_ids uuid[] := '{}';
  v_party_ids uuid[] := '{}';

  v_picklists_deleted integer := 0;
  v_picklist_items_deleted integer := 0;
  v_deliveries_deleted integer := 0;
  v_delivery_items_deleted integer := 0;
  v_payments_deleted integer := 0;
  v_expenses_deleted integer := 0;
  v_exceptions_deleted integer := 0;
  v_movements_deleted integer := 0;
  v_ledger_records_deleted integer := 0;
  v_parties_unlinked integer := 0;
  v_caller_id uuid;
  v_caller_role text;
  v_is_test_route boolean := false;
  v_has_financial_or_operational_history boolean := false;
BEGIN
  -- 1. Security check: Only Admin, Master, or Owner
  IF NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Unauthorized: Only Admin or Master can permanently hard delete routes.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validate route exists
  SELECT * INTO v_route FROM public.routes WHERE id = p_route_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Route with ID % not found', p_route_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Discover all route-owned entity IDs for dependency assessment
  -- 3a. Picklists
  SELECT ARRAY_AGG(id) INTO v_picklist_ids FROM public.picklists WHERE route_id = p_route_id;
  IF v_picklist_ids IS NULL THEN v_picklist_ids := '{}'; END IF;

  -- 3b. Deliveries
  SELECT ARRAY_AGG(id) INTO v_delivery_ids 
  FROM public.deliveries 
  WHERE route_id = p_route_id 
     OR (picklist_id IS NOT NULL AND picklist_id = ANY(v_picklist_ids));
  IF v_delivery_ids IS NULL THEN v_delivery_ids := '{}'; END IF;

  -- 3c. Payments
  SELECT ARRAY_AGG(id) INTO v_payment_ids 
  FROM public.payments 
  WHERE route_id = p_route_id 
     OR (picklist_id IS NOT NULL AND picklist_id = ANY(v_picklist_ids))
     OR (delivery_id IS NOT NULL AND delivery_id = ANY(v_delivery_ids));
  IF v_payment_ids IS NULL THEN v_payment_ids := '{}'; END IF;

  -- 3d. Expenses
  SELECT ARRAY_AGG(id) INTO v_expense_ids 
  FROM public.expenses 
  WHERE route_id = p_route_id 
     OR (picklist_id IS NOT NULL AND picklist_id = ANY(v_picklist_ids));
  IF v_expense_ids IS NULL THEN v_expense_ids := '{}'; END IF;

  -- 3e. Route stock exceptions
  SELECT ARRAY_AGG(id) INTO v_exception_ids 
  FROM public.route_stock_exceptions 
  WHERE route_id = p_route_id 
     OR (picklist_id IS NOT NULL AND picklist_id = ANY(v_picklist_ids));
  IF v_exception_ids IS NULL THEN v_exception_ids := '{}'; END IF;

  -- 3f. Party financial ledger
  SELECT ARRAY_AGG(id) INTO v_ledger_ids 
  FROM public.party_financial_ledger 
  WHERE route_id = p_route_id 
     OR (picklist_id IS NOT NULL AND picklist_id = ANY(v_picklist_ids))
     OR (delivery_id IS NOT NULL AND delivery_id = ANY(v_delivery_ids));
  IF v_ledger_ids IS NULL THEN v_ledger_ids := '{}'; END IF;

  -- 3g. Route-scoped Inventory movements
  SELECT ARRAY_AGG(id) INTO v_movement_ids 
  FROM public.inventory_movements 
  WHERE (route_id = p_route_id OR (picklist_id IS NOT NULL AND picklist_id = ANY(v_picklist_ids)))
    AND movement_type NOT IN ('purchase_inward', 'sap_sales_baseline', 'opening_balance');
  IF v_movement_ids IS NULL THEN v_movement_ids := '{}'; END IF;

  -- 4. Check whether route is designated as a test/demo route
  v_is_test_route := (COALESCE(v_route.code, '') ~* '^(TEST|DEMO|VERIF|SAMPLE)')
                  OR (COALESCE(v_route.name, '') ~* '^(TEST|DEMO|VERIF|SAMPLE)');

  -- Check for live financial or operational history
  v_has_financial_or_operational_history := 
    array_length(v_payment_ids, 1) > 0 OR
    array_length(v_ledger_ids, 1) > 0 OR
    EXISTS (SELECT 1 FROM public.deliveries WHERE id = ANY(v_delivery_ids) AND status = 'delivered') OR
    EXISTS (SELECT 1 FROM public.picklists WHERE id = ANY(v_picklist_ids) AND status = 'completed');

  -- 5. LIVE ROUTE HARD-DELETE GUARD:
  -- Live routes with operational/financial records cannot be hard-deleted.
  IF NOT v_is_test_route AND v_has_financial_or_operational_history THEN
    RAISE EXCEPTION 'LIVE ROUTE HARD DELETE BLOCKED: Route "%" (%) contains live financial or operational history (% payments, % ledger rows). Permanent deletion is blocked to protect historical audit records. Please ARCHIVE this route instead.',
      v_route.name, v_route.code, COALESCE(array_length(v_payment_ids, 1), 0), COALESCE(array_length(v_ledger_ids, 1), 0)
      USING ERRCODE = '23503';
  END IF;

  -- Set transaction flag to allow deletion through trigger
  PERFORM set_config('distrotrack.allow_route_hard_delete', 'true', true);

  -- 6. Atomic dependency deletion (authorized test routes or empty routes only)
  -- 6a. Route stock exceptions
  IF array_length(v_exception_ids, 1) > 0 THEN
    DELETE FROM public.route_stock_exceptions WHERE id = ANY(v_exception_ids);
    GET DIAGNOSTICS v_exceptions_deleted = ROW_COUNT;
  END IF;

  -- 6b. Inventory movements (route-scoped only)
  IF array_length(v_movement_ids, 1) > 0 THEN
    DELETE FROM public.inventory_movements WHERE id = ANY(v_movement_ids);
    GET DIAGNOSTICS v_movements_deleted = ROW_COUNT;
  END IF;

  -- 6c. Party financial ledger
  IF array_length(v_ledger_ids, 1) > 0 THEN
    DELETE FROM public.party_financial_ledger WHERE id = ANY(v_ledger_ids);
    GET DIAGNOSTICS v_ledger_records_deleted = ROW_COUNT;
  END IF;

  -- 6d. Payments
  IF array_length(v_payment_ids, 1) > 0 THEN
    PERFORM set_config('distrotrack.allow_admin_payment_delete', 'on', true);
    DELETE FROM public.payments WHERE id = ANY(v_payment_ids);
    GET DIAGNOSTICS v_payments_deleted = ROW_COUNT;
  END IF;

  -- 6e. Expenses
  IF array_length(v_expense_ids, 1) > 0 THEN
    PERFORM set_config('distrotrack.allow_expense_delete', 'on', true);
    DELETE FROM public.expenses WHERE id = ANY(v_expense_ids);
    GET DIAGNOSTICS v_expenses_deleted = ROW_COUNT;
  END IF;

  -- 6f. Delivery items
  IF array_length(v_delivery_ids, 1) > 0 THEN
    DELETE FROM public.delivery_items WHERE delivery_id = ANY(v_delivery_ids);
    GET DIAGNOSTICS v_delivery_items_deleted = ROW_COUNT;
  END IF;

  -- 6g. Deliveries
  IF array_length(v_delivery_ids, 1) > 0 THEN
    DELETE FROM public.deliveries WHERE id = ANY(v_delivery_ids);
    GET DIAGNOSTICS v_deliveries_deleted = ROW_COUNT;
  END IF;

  -- 6h. Picklist load items
  IF array_length(v_picklist_ids, 1) > 0 THEN
    BEGIN
      DELETE FROM public.picklist_load_items WHERE picklist_id = ANY(v_picklist_ids);
    EXCEPTION WHEN undefined_table THEN
      -- table may not exist
    END;
  END IF;

  -- 6i. Picklist parties
  IF array_length(v_picklist_ids, 1) > 0 THEN
    BEGIN
      DELETE FROM public.picklist_parties WHERE picklist_id = ANY(v_picklist_ids);
    EXCEPTION WHEN undefined_table THEN
      -- table may not exist
    END;
  END IF;

  -- 6j. Picklist items
  IF array_length(v_picklist_ids, 1) > 0 THEN
    DELETE FROM public.picklist_items WHERE picklist_id = ANY(v_picklist_ids);
    GET DIAGNOSTICS v_picklist_items_deleted = ROW_COUNT;
  END IF;

  -- 6k. Picklists
  IF array_length(v_picklist_ids, 1) > 0 THEN
    DELETE FROM public.picklists WHERE id = ANY(v_picklist_ids);
    GET DIAGNOSTICS v_picklists_deleted = ROW_COUNT;
  END IF;

  -- 6l. Unlink Parties (preserve party master!)
  UPDATE public.parties 
  SET route_id = NULL, updated_at = now() 
  WHERE route_id = p_route_id;
  GET DIAGNOSTICS v_parties_unlinked = ROW_COUNT;

  -- 6m. Delete Route itself
  DELETE FROM public.routes WHERE id = p_route_id;

  -- 7. Audit log entry
  v_caller_id := auth.uid();
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;

  BEGIN
    INSERT INTO public.master_audit_log (
      occurred_at,
      user_id,
      user_name,
      role,
      module,
      action,
      status,
      detail,
      entity_type,
      entity_id
    ) VALUES (
      now(),
      v_caller_id,
      COALESCE(v_caller_role, 'system'),
      COALESCE(v_caller_role, 'admin'),
      'routes',
      'hard_delete_route',
      'success',
      format('Permanently deleted route "%s" (%s). Deleted: %s picklists, %s deliveries, %s payments, %s ledger records. Unlinked %s parties.',
        v_route.name, v_route.code, v_picklists_deleted, v_deliveries_deleted, v_payments_deleted, v_ledger_records_deleted, v_parties_unlinked),
      'route',
      p_route_id::text
    );
  EXCEPTION WHEN OTHERS THEN
    -- Audit logging must not abort the delete transaction
  END;

  RETURN jsonb_build_object(
    'success', true,
    'route_id', p_route_id,
    'route_code', v_route.code,
    'route_name', v_route.name,
    'picklists_deleted', v_picklists_deleted,
    'deliveries_deleted', v_deliveries_deleted,
    'delivery_items_deleted', v_delivery_items_deleted,
    'payments_deleted', v_payments_deleted,
    'expenses_deleted', v_expenses_deleted,
    'movements_deleted', v_movements_deleted,
    'exceptions_deleted', v_exceptions_deleted,
    'financial_records_deleted', v_ledger_records_deleted,
    'parties_unlinked', v_parties_unlinked,
    'message', format('Route %s permanently deleted with all test child operational records.', v_route.name)
  );
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.hard_delete_route(uuid) TO authenticated, service_role;

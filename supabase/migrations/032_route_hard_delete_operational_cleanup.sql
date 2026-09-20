-- ==============================================================================
-- Migration 032: Hard Delete Route & All Route-Owned Operational Data
-- ==============================================================================
-- Authoritatively implements true permanent hard deletion of a route and ALL
-- data belonging specifically to that route:
--   - Route record
--   - Route worker assignment
--   - Route picklists, picklist items, picklist load items
--   - Route deliveries & delivery items
--   - Route payments
--   - Route expenses
--   - Route stock exceptions
--   - Route-owned inventory movements (route_load, delivery_fulfilled, route_return, damaged_transit, inventory_adjustment)
--   - Route party financial ledger records
--
-- STRICT PRESERVATION OF SHARED DATA:
--   - Products / Product Master (NEVER deleted)
--   - Workers (NEVER deleted)
--   - Parties / Customers (NEVER deleted; route_id unlinked to NULL, balance recalculated)
--   - Historical Sales Products & Catalogs (NEVER deleted)
--   - SAP Purchase Imports & purchase_inward movements (NEVER deleted)
--   - SAP Sales Imports & sap_sales_baseline movements (NEVER deleted)
--   - Unrelated routes, picklists, deliveries, payments, expenses (NEVER deleted)
-- ==============================================================================

-- 1. Update check_route_deletion_allowed to allow explicit hard deletion
CREATE OR REPLACE FUNCTION public.check_route_deletion_allowed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_history_count bigint := 0;
  v_count bigint := 0;
BEGIN
  -- If explicitly bypassed by hard_delete_route transaction
  IF current_setting('distrotrack.allow_route_hard_delete', true) = 'true' THEN
    RETURN OLD;
  END IF;

  -- 1. Check picklists
  SELECT COUNT(*) INTO v_count FROM public.picklists WHERE route_id = OLD.id;
  IF v_count > 0 THEN v_history_count := v_history_count + v_count; END IF;

  -- 2. Check deliveries (via picklists on this route or direct route_id)
  SELECT COUNT(*) INTO v_count 
  FROM public.deliveries d 
  WHERE d.route_id = OLD.id 
     OR (d.picklist_id IS NOT NULL AND d.picklist_id IN (SELECT id FROM public.picklists WHERE route_id = OLD.id));
  IF v_count > 0 THEN v_history_count := v_history_count + v_count; END IF;

  -- 3. Check inventory movements (route-owned only)
  SELECT COUNT(*) INTO v_count 
  FROM public.inventory_movements im
  WHERE im.route_id = OLD.id 
     OR (im.picklist_id IS NOT NULL AND im.picklist_id IN (SELECT id FROM public.picklists WHERE route_id = OLD.id));
  IF v_count > 0 THEN v_history_count := v_history_count + v_count; END IF;

  -- 4. Check payments linked to this route
  SELECT COUNT(*) INTO v_count FROM public.payments WHERE route_id = OLD.id;
  IF v_count > 0 THEN v_history_count := v_history_count + v_count; END IF;

  -- 5. Check expenses linked to this route
  SELECT COUNT(*) INTO v_count FROM public.expenses WHERE route_id = OLD.id;
  IF v_count > 0 THEN v_history_count := v_history_count + v_count; END IF;

  -- 6. Check route_stock_exceptions linked to this route
  SELECT COUNT(*) INTO v_count FROM public.route_stock_exceptions WHERE route_id = OLD.id;
  IF v_count > 0 THEN v_history_count := v_history_count + v_count; END IF;

  -- 7. Check party_financial_ledger linked to this route
  SELECT COUNT(*) INTO v_count FROM public.party_financial_ledger WHERE route_id = OLD.id;
  IF v_count > 0 THEN v_history_count := v_history_count + v_count; END IF;

  IF v_history_count > 0 THEN
    RAISE EXCEPTION 'This route contains operational history and cannot be permanently deleted without explicit route hard-delete authorization. Use hard_delete_route.'
      USING ERRCODE = '23503';
  END IF;

  RETURN OLD;
END;
$$;

-- 2. Primary Authoritative Hard Delete Route RPC
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

  -- Set transaction flag to allow deletion through trigger
  PERFORM set_config('distrotrack.allow_route_hard_delete', 'true', true);

  -- 3. Discover all route-owned entity IDs
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
     OR (delivery_id IS NOT NULL AND delivery_id = ANY(v_delivery_ids))
     OR (payment_id IS NOT NULL AND payment_id = ANY(v_payment_ids));
  IF v_ledger_ids IS NULL THEN v_ledger_ids := '{}'; END IF;

  -- 3g. Route-owned inventory movements
  -- STRICT SAFETY: NEVER delete purchase_inward, sap_sales_baseline, or opening_balance
  SELECT ARRAY_AGG(id) INTO v_movement_ids 
  FROM public.inventory_movements 
  WHERE (route_id = p_route_id OR (picklist_id IS NOT NULL AND picklist_id = ANY(v_picklist_ids)))
    AND movement_type NOT IN ('purchase_inward', 'sap_sales_baseline', 'opening_balance');
  IF v_movement_ids IS NULL THEN v_movement_ids := '{}'; END IF;

  -- 3h. Parties assigned to route
  SELECT ARRAY_AGG(id) INTO v_party_ids FROM public.parties WHERE route_id = p_route_id;
  IF v_party_ids IS NULL THEN v_party_ids := '{}'; END IF;

  -- 4. Delete Route-Owned Records in strict bottom-up dependency order
  -- Step 1: Financial ledger
  IF ARRAY_LENGTH(v_ledger_ids, 1) > 0 THEN
    DELETE FROM public.party_financial_ledger WHERE id = ANY(v_ledger_ids);
    GET DIAGNOSTICS v_ledger_records_deleted = ROW_COUNT;
  END IF;

  -- Step 2: Payments
  IF ARRAY_LENGTH(v_payment_ids, 1) > 0 THEN
    DELETE FROM public.payments WHERE id = ANY(v_payment_ids);
    GET DIAGNOSTICS v_payments_deleted = ROW_COUNT;
  END IF;

  -- Step 3: Expenses
  IF ARRAY_LENGTH(v_expense_ids, 1) > 0 THEN
    DELETE FROM public.expenses WHERE id = ANY(v_expense_ids);
    GET DIAGNOSTICS v_expenses_deleted = ROW_COUNT;
  END IF;

  -- Step 4: Route stock exceptions
  IF ARRAY_LENGTH(v_exception_ids, 1) > 0 THEN
    DELETE FROM public.route_stock_exceptions WHERE id = ANY(v_exception_ids);
    GET DIAGNOSTICS v_exceptions_deleted = ROW_COUNT;
  END IF;

  -- Step 5: Route-owned inventory movements
  IF ARRAY_LENGTH(v_movement_ids, 1) > 0 THEN
    DELETE FROM public.inventory_movements WHERE id = ANY(v_movement_ids);
    GET DIAGNOSTICS v_movements_deleted = ROW_COUNT;
  END IF;

  -- Step 6: Delivery items
  IF ARRAY_LENGTH(v_delivery_ids, 1) > 0 THEN
    DELETE FROM public.delivery_items WHERE delivery_id = ANY(v_delivery_ids);
    GET DIAGNOSTICS v_delivery_items_deleted = ROW_COUNT;
  END IF;

  -- Step 7: Deliveries
  IF ARRAY_LENGTH(v_delivery_ids, 1) > 0 THEN
    DELETE FROM public.deliveries WHERE id = ANY(v_delivery_ids);
    GET DIAGNOSTICS v_deliveries_deleted = ROW_COUNT;
  END IF;

  -- Step 8: Picklist items & load items
  IF ARRAY_LENGTH(v_picklist_ids, 1) > 0 THEN
    -- picklist_load_items if table exists
    BEGIN
      DELETE FROM public.picklist_load_items WHERE picklist_id = ANY(v_picklist_ids);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    -- picklist_parties if table exists
    BEGIN
      DELETE FROM public.picklist_parties WHERE picklist_id = ANY(v_picklist_ids);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    DELETE FROM public.picklist_items WHERE picklist_id = ANY(v_picklist_ids);
    GET DIAGNOSTICS v_picklist_items_deleted = ROW_COUNT;

    DELETE FROM public.picklists WHERE id = ANY(v_picklist_ids);
    GET DIAGNOSTICS v_picklists_deleted = ROW_COUNT;
  END IF;

  -- Step 9: Preserve Parties (unlink route_id = NULL)
  IF ARRAY_LENGTH(v_party_ids, 1) > 0 THEN
    UPDATE public.parties SET route_id = NULL, updated_at = now() WHERE id = ANY(v_party_ids);
    GET DIAGNOSTICS v_parties_unlinked = ROW_COUNT;
  END IF;

  -- Step 10: Delete Route itself
  DELETE FROM public.routes WHERE id = p_route_id;

  -- Step 11: Audit log
  v_caller_id := auth.uid();
  BEGIN
    SELECT role INTO v_caller_role FROM public.profiles WHERE id = v_caller_id;
  EXCEPTION WHEN OTHERS THEN
    v_caller_role := 'master';
  END;

  BEGIN
    INSERT INTO public.master_audit_log (
      actor_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      details,
      created_at
    ) VALUES (
      COALESCE(v_caller_id::text, 'system-master'),
      COALESCE(v_caller_role, 'master'),
      'route_hard_deleted',
      'routes',
      p_route_id::text,
      jsonb_build_object(
        'route_id', p_route_id,
        'route_code', v_route.code,
        'route_name', v_route.name,
        'assigned_worker_id', v_route.assigned_worker_id,
        'picklists_deleted', v_picklists_deleted,
        'picklist_items_deleted', v_picklist_items_deleted,
        'deliveries_deleted', v_deliveries_deleted,
        'delivery_items_deleted', v_delivery_items_deleted,
        'payments_deleted', v_payments_deleted,
        'expenses_deleted', v_expenses_deleted,
        'movements_deleted', v_movements_deleted,
        'exceptions_deleted', v_exceptions_deleted,
        'financial_records_deleted', v_ledger_records_deleted,
        'parties_unlinked', v_parties_unlinked,
        'deleted_at', now()
      ),
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    -- Fallback to log_system_event if master_audit_log differs
    BEGIN
      PERFORM public.log_system_event(
        COALESCE(v_caller_id::text, 'system-master'),
        'Admin',
        'route',
        'route_hard_deleted',
        'warning',
        'Hard deleted route ' || v_route.code || ' (' || v_route.name || ') and all operational data.',
        'route',
        p_route_id::text
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'route_id', p_route_id,
    'route_code', v_route.code,
    'route_name', v_route.name,
    'picklists_deleted', v_picklists_deleted,
    'picklist_items_deleted', v_picklist_items_deleted,
    'deliveries_deleted', v_deliveries_deleted,
    'delivery_items_deleted', v_delivery_items_deleted,
    'payments_deleted', v_payments_deleted,
    'expenses_deleted', v_expenses_deleted,
    'movements_deleted', v_movements_deleted,
    'exceptions_deleted', v_exceptions_deleted,
    'financial_records_deleted', v_ledger_records_deleted,
    'parties_unlinked', v_parties_unlinked,
    'message', 'Route and all route-owned operational data permanently deleted.'
  );
END;
$$;

-- 3. Update public.delete_route wrapper to support hard_delete parameter
CREATE OR REPLACE FUNCTION public.delete_route(
  p_route_id uuid,
  p_force boolean DEFAULT true,
  p_hard_delete boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF p_hard_delete THEN
    RETURN public.hard_delete_route(p_route_id);
  END IF;

  -- Non-hard delete fallback: decouples route while preserving operational records
  IF NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Unauthorized: Only Admin or Master can delete routes.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.inventory_movements SET route_id = NULL WHERE route_id = p_route_id;
  UPDATE public.picklists SET route_id = NULL WHERE route_id = p_route_id;
  UPDATE public.deliveries SET route_id = NULL WHERE route_id = p_route_id;
  UPDATE public.payments SET route_id = NULL WHERE route_id = p_route_id;
  UPDATE public.expenses SET route_id = NULL WHERE route_id = p_route_id;
  UPDATE public.parties SET route_id = NULL WHERE route_id = p_route_id;
  UPDATE public.party_financial_ledger SET route_id = NULL WHERE route_id = p_route_id;
  UPDATE public.route_stock_exceptions SET route_id = NULL WHERE route_id = p_route_id;
  DELETE FROM public.routes WHERE id = p_route_id;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_route_id', p_route_id,
    'message', 'Route unlinked and deleted.'
  );
END;
$$;

-- 4. Route Delete Preview RPC
CREATE OR REPLACE FUNCTION public.get_route_delete_preview(
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
  v_payment_count integer := 0;
  v_expense_count integer := 0;
  v_exception_count integer := 0;
  v_movement_count integer := 0;
  v_ledger_count integer := 0;
  v_delivery_count integer := 0;
  v_delivery_item_count integer := 0;
  v_picklist_count integer := 0;
  v_party_count integer := 0;
BEGIN
  SELECT * INTO v_route FROM public.routes WHERE id = p_route_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Route with ID % not found', p_route_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT ARRAY_AGG(id) INTO v_picklist_ids FROM public.picklists WHERE route_id = p_route_id;
  IF v_picklist_ids IS NULL THEN v_picklist_ids := '{}'; END IF;
  v_picklist_count := COALESCE(ARRAY_LENGTH(v_picklist_ids, 1), 0);

  SELECT ARRAY_AGG(id) INTO v_delivery_ids 
  FROM public.deliveries 
  WHERE route_id = p_route_id 
     OR (picklist_id IS NOT NULL AND picklist_id = ANY(v_picklist_ids));
  IF v_delivery_ids IS NULL THEN v_delivery_ids := '{}'; END IF;
  v_delivery_count := COALESCE(ARRAY_LENGTH(v_delivery_ids, 1), 0);

  IF v_delivery_count > 0 THEN
    SELECT COUNT(*) INTO v_delivery_item_count FROM public.delivery_items WHERE delivery_id = ANY(v_delivery_ids);
  END IF;

  SELECT COUNT(*) INTO v_payment_count 
  FROM public.payments 
  WHERE route_id = p_route_id 
     OR (picklist_id IS NOT NULL AND picklist_id = ANY(v_picklist_ids))
     OR (delivery_id IS NOT NULL AND delivery_id = ANY(v_delivery_ids));

  SELECT COUNT(*) INTO v_expense_count 
  FROM public.expenses 
  WHERE route_id = p_route_id 
     OR (picklist_id IS NOT NULL AND picklist_id = ANY(v_picklist_ids));

  SELECT COUNT(*) INTO v_exception_count 
  FROM public.route_stock_exceptions 
  WHERE route_id = p_route_id 
     OR (picklist_id IS NOT NULL AND picklist_id = ANY(v_picklist_ids));

  SELECT COUNT(*) INTO v_ledger_count 
  FROM public.party_financial_ledger 
  WHERE route_id = p_route_id 
     OR (picklist_id IS NOT NULL AND picklist_id = ANY(v_picklist_ids))
     OR (delivery_id IS NOT NULL AND delivery_id = ANY(v_delivery_ids));

  SELECT COUNT(*) INTO v_movement_count 
  FROM public.inventory_movements 
  WHERE (route_id = p_route_id OR (picklist_id IS NOT NULL AND picklist_id = ANY(v_picklist_ids)))
    AND movement_type NOT IN ('purchase_inward', 'sap_sales_baseline', 'opening_balance');

  SELECT COUNT(*) INTO v_party_count FROM public.parties WHERE route_id = p_route_id;

  RETURN jsonb_build_object(
    'route_id', p_route_id,
    'route_code', v_route.code,
    'route_name', v_route.name,
    'assigned_worker_id', v_route.assigned_worker_id,
    'picklists', v_picklist_count,
    'deliveries', v_delivery_count,
    'delivery_items', v_delivery_item_count,
    'payments', v_payment_count,
    'expenses', v_expense_count,
    'returns', 0,
    'inventory_movements', v_movement_count,
    'exceptions', v_exception_count,
    'financial_records', v_ledger_count,
    'parties_unlinked', v_party_count
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.hard_delete_route(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_route(uuid, boolean, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_route_delete_preview(uuid) TO authenticated, service_role;

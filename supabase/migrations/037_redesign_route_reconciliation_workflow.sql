-- ================================================================
-- Migration 037: Redesign Route Close & Stock Discrepancy Workflow
-- ================================================================
-- 1. Updates picklists.status constraint to include 'pending_reconciliation'.
-- 2. Updates route_stock_exceptions constraints and adds exception_type.
-- 3. Updates check_route_stock to separate mathematical truck balance from physical expected return.
-- 4. Creates submit_route_checkin_and_reconciliation RPC for field workers (NO ADMIN PIN REQUIRED).
-- 5. Creates admin_authorize_route_reconciliation RPC for authenticated Admin/Master sessions.
-- ================================================================

-- ── 1. Update picklists status check constraint ──────────────────
ALTER TABLE public.picklists DROP CONSTRAINT IF EXISTS picklists_status_check;
ALTER TABLE public.picklists ADD CONSTRAINT picklists_status_check
  CHECK (status IN ('draft', 'confirmed', 'assigned', 'in_progress', 'pending_reconciliation', 'completed'));

-- ── 2. Update route_stock_exceptions constraints ─────────────────
ALTER TABLE public.route_stock_exceptions DROP CONSTRAINT IF EXISTS route_stock_exceptions_status_check;
ALTER TABLE public.route_stock_exceptions ADD CONSTRAINT route_stock_exceptions_status_check
  CHECK (status IN ('open', 'investigated', 'resolved', 'approved', 'rejected'));

ALTER TABLE public.route_stock_exceptions ADD COLUMN IF NOT EXISTS exception_type text DEFAULT 'warehouse_shortage';

-- Ensure RLS policies on route_stock_exceptions allow worker insert and admin/master update
DROP POLICY IF EXISTS "route_stock_exceptions_worker_insert" ON public.route_stock_exceptions;
CREATE POLICY "route_stock_exceptions_worker_insert"
  ON public.route_stock_exceptions FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "route_stock_exceptions_admin_master_all" ON public.route_stock_exceptions;
CREATE POLICY "route_stock_exceptions_admin_master_all"
  ON public.route_stock_exceptions FOR ALL
  TO authenticated
  USING (public.is_current_user_admin_or_master())
  WITH CHECK (public.is_current_user_admin_or_master());

-- ── 3. Update check_route_stock RPC ──────────────────────────────
-- Distinguishes mathematical vehicle balance from physical expected return on truck
CREATE OR REPLACE FUNCTION public.check_route_stock(
  p_picklist_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_items jsonb := '[]'::jsonb;
  v_item record;
  v_total_loaded numeric := 0;
  v_total_delivered numeric := 0;
  v_total_delivered_free numeric := 0;
  v_total_damaged numeric := 0;
  v_total_returned numeric := 0;
  v_total_expected numeric := 0;
  v_movement_count integer := 0;
  v_warehouse_loaded numeric := 0;
  v_warehouse_returned numeric := 0;
  v_picklist record;
  v_current_worker uuid;
BEGIN
  -- 0. Authorization check: Caller must be authenticated worker or admin/master
  IF NOT public.is_current_user_worker() AND NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_picklist FROM public.picklists WHERE id = p_picklist_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picklist % not found', p_picklist_id;
  END IF;

  v_current_worker := public.get_current_worker_id();
  IF public.is_current_user_worker() THEN
    IF v_picklist.worker_id IS DISTINCT FROM v_current_worker THEN
      RAISE EXCEPTION 'Unauthorized: Authenticated worker % is not assigned to picklist %', v_current_worker, p_picklist_id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Count total ledger movements for this picklist
  SELECT count(*) INTO v_movement_count
  FROM public.inventory_movements
  WHERE picklist_id = p_picklist_id;

  -- Warehouse impact totals
  SELECT COALESCE(SUM(quantity), 0) INTO v_warehouse_loaded
  FROM public.inventory_movements
  WHERE picklist_id = p_picklist_id AND movement_type = 'route_load';

  SELECT COALESCE(SUM(quantity), 0) INTO v_warehouse_returned
  FROM public.inventory_movements
  WHERE picklist_id = p_picklist_id AND movement_type = 'route_return';

  FOR v_item IN
    WITH loaded AS (
      SELECT pli.product_id, pli.sku, SUM(pli.loaded_quantity) as loaded_qty
      FROM public.picklist_load_items pli
      WHERE pli.picklist_id = p_picklist_id
      GROUP BY pli.product_id, pli.sku
    ),
    delivered_agg AS (
      SELECT
        di.product_id,
        COALESCE(SUM(di.delivered_qty), 0) as comm_delivered_qty,
        COALESCE(SUM(di.delivered_free_qty), 0) as free_delivered_qty,
        COALESCE(SUM(di.damaged_qty + di.damaged_free_qty), 0) as damaged_qty
      FROM public.delivery_items di
      JOIN public.deliveries d ON d.id = di.delivery_id
      WHERE d.picklist_id = p_picklist_id
        AND d.status IN ('delivered', 'partial')
      GROUP BY di.product_id
    ),
    returned_ledger AS (
      SELECT product_id, COALESCE(SUM(quantity), 0) as returned_qty
      FROM public.inventory_movements
      WHERE picklist_id = p_picklist_id AND movement_type = 'route_return'
      GROUP BY product_id
    )
    SELECT
      l.product_id,
      l.sku,
      p.name as product_name,
      l.loaded_qty,
      COALESCE(da.comm_delivered_qty, 0) as delivered_qty,
      COALESCE(da.free_delivered_qty, 0) as delivered_free_qty,
      COALESCE(da.damaged_qty, 0) as damaged_transit_qty,
      COALESCE(rl.returned_qty, 0) as route_return_qty,
      -- Mathematical vehicle balance (can be negative if delivery shortage took place)
      (l.loaded_qty - COALESCE(da.comm_delivered_qty, 0) - COALESCE(da.damaged_qty, 0) - COALESCE(rl.returned_qty, 0)) as vehicle_balance,
      -- Physical expected units remaining on vehicle for check-in
      GREATEST(0, (l.loaded_qty - COALESCE(da.comm_delivered_qty, 0) - COALESCE(da.damaged_qty, 0) - COALESCE(rl.returned_qty, 0))) as expected_vehicle_qty
    FROM loaded l
    JOIN public.products p ON p.id = l.product_id
    LEFT JOIN delivered_agg da ON da.product_id = l.product_id
    LEFT JOIN returned_ledger rl ON rl.product_id = l.product_id
    ORDER BY l.sku
  LOOP
    v_total_loaded := v_total_loaded + v_item.loaded_qty;
    v_total_delivered := v_total_delivered + v_item.delivered_qty;
    v_total_delivered_free := v_total_delivered_free + v_item.delivered_free_qty;
    v_total_damaged := v_total_damaged + v_item.damaged_transit_qty;
    v_total_returned := v_total_returned + v_item.route_return_qty;
    v_total_expected := v_total_expected + v_item.expected_vehicle_qty;

    v_items := v_items || jsonb_build_object(
      'product_id', v_item.product_id,
      'sku', v_item.sku,
      'product_name', v_item.product_name,
      'loaded_qty', v_item.loaded_qty,
      'delivered_qty', v_item.delivered_qty,
      'delivered_free_qty', v_item.delivered_free_qty,
      'damaged_transit_qty', v_item.damaged_transit_qty,
      'route_return_qty', v_item.route_return_qty,
      'vehicle_balance', v_item.vehicle_balance,
      'expected_vehicle_qty', v_item.expected_vehicle_qty
    );
  END LOOP;

  RETURN jsonb_build_object(
    'picklist_id', p_picklist_id,
    'items', v_items,
    'total_loaded', v_total_loaded,
    'total_delivered', v_total_delivered,
    'total_delivered_free', v_total_delivered_free,
    'total_damaged', v_total_damaged,
    'total_returned', v_total_returned,
    'total_expected_return', v_total_expected,
    'vehicle_balance', v_total_expected,
    'warehouse_impact', jsonb_build_object(
      'loaded_from_warehouse', v_warehouse_loaded,
      'returned_to_warehouse', v_warehouse_returned
    ),
    'movement_counts', v_movement_count
  );
END;
$$;

-- ── 4. Create submit_route_checkin_and_reconciliation RPC ────────
CREATE OR REPLACE FUNCTION public.submit_route_checkin_and_reconciliation(
  p_picklist_id uuid,
  p_worker_id uuid,
  p_return_items jsonb,
  p_actual_cash numeric DEFAULT 0,
  p_expenses jsonb DEFAULT '[]'::jsonb,
  p_stock_reason text DEFAULT NULL,
  p_cash_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_picklist record;
  v_current_worker uuid;
  v_unresolved_count integer := 0;
  v_item jsonb;
  v_prod_id uuid;
  v_sku text;
  v_prod_name text;
  v_ret numeric;
  v_dam_wh numeric;
  v_item_reason text;
  v_expected_physical numeric;
  v_discrepancy numeric;
  v_has_stock_discrepancy boolean := false;
  v_has_cash_discrepancy boolean := false;
  v_total_stock_discrepancy numeric := 0;
  v_expected_cash numeric(12, 2) := 0;
  v_expected_upi numeric(12, 2) := 0;
  v_expected_cheque numeric(12, 2) := 0;
  v_expected_credit numeric(12, 2) := 0;
  v_total_expenses numeric(12, 2) := 0;
  v_cash_expenses numeric(12, 2) := 0;
  v_net_cash_deposit numeric(12, 2) := 0;
  v_cash_diff numeric(12, 2) := 0;
  v_exp_item jsonb;
  v_exp_amt numeric;
  v_exp_cat text;
  v_exp_desc text;
  v_exp_method text;
  v_idx integer := 0;
  v_final_status text;
  v_final_fin_status text;
  v_loaded numeric;
  v_delivered numeric;
  v_dam_transit numeric;
BEGIN
  -- 0. Authorization check: Authenticated worker or Admin/Master
  IF NOT public.is_current_user_worker() AND NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_picklist
  FROM public.picklists
  WHERE id = p_picklist_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picklist % not found', p_picklist_id;
  END IF;

  v_current_worker := public.get_current_worker_id();
  IF public.is_current_user_worker() THEN
    IF v_picklist.worker_id IS DISTINCT FROM v_current_worker THEN
      RAISE EXCEPTION 'Unauthorized: Authenticated worker % is not assigned to picklist %', v_current_worker, p_picklist_id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Idempotency check: If already completed and reconciled, return early
  IF v_picklist.status = 'completed' AND v_picklist.financial_reconciliation_status = 'reconciled' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_completed', true,
      'status', 'completed',
      'message', 'Picklist is already completed and reconciled'
    );
  END IF;

  -- Verify all deliveries on route are completed or resolved
  SELECT count(*) INTO v_unresolved_count
  FROM public.deliveries
  WHERE picklist_id = p_picklist_id
    AND status IN ('pending', 'out_for_delivery');

  IF v_unresolved_count > 0 THEN
    RAISE EXCEPTION 'Cannot close route: % delivery(ies) are still unresolved', v_unresolved_count;
  END IF;

  -- 1. Process Physical Stock Returns & Check-In Discrepancies
  IF p_return_items IS NOT NULL AND jsonb_typeof(p_return_items) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_return_items) LOOP
      v_prod_id := (v_item->>'product_id')::uuid;
      v_sku := trim(v_item->>'sku');
      v_ret := COALESCE((v_item->>'returned_qty')::numeric, 0);
      v_dam_wh := COALESCE((v_item->>'damaged_warehouse_qty')::numeric, 0);
      v_item_reason := trim(COALESCE(v_item->>'reason', p_stock_reason, ''));

      -- Lookup product details
      SELECT name INTO v_prod_name FROM public.products WHERE id = v_prod_id;
      IF v_sku IS NULL OR length(v_sku) = 0 THEN
        SELECT sku INTO v_sku FROM public.products WHERE id = v_prod_id;
      END IF;

      -- Determine loaded and delivered quantities for this product
      SELECT COALESCE(SUM(loaded_quantity), 0) INTO v_loaded
      FROM public.picklist_load_items
      WHERE picklist_id = p_picklist_id AND product_id = v_prod_id;

      SELECT
        COALESCE(SUM(di.delivered_qty), 0),
        COALESCE(SUM(di.damaged_qty + di.damaged_free_qty), 0)
      INTO v_delivered, v_dam_transit
      FROM public.delivery_items di
      JOIN public.deliveries d ON d.id = di.delivery_id
      WHERE d.picklist_id = p_picklist_id
        AND di.product_id = v_prod_id
        AND d.status IN ('delivered', 'partial');

      -- Physical expected on vehicle
      v_expected_physical := GREATEST(0, v_loaded - v_delivered - v_dam_transit);

      -- Check-in difference
      v_discrepancy := v_expected_physical - (v_ret + v_dam_wh);

      -- A. Record actual physical returns to warehouse
      IF v_ret > 0 THEN
        INSERT INTO public.inventory_movements (
          product_id, sku, movement_type, quantity, direction,
          from_location, to_location, picklist_id, route_id,
          reference_number, idempotency_key, notes
        ) VALUES (
          v_prod_id, v_sku, 'route_return', v_ret, 'in',
          'vehicle', 'warehouse', p_picklist_id, v_picklist.route_id,
          'RET:' || p_picklist_id::text,
          'ret:' || p_picklist_id::text || ':' || v_prod_id::text,
          'Physical return to warehouse: ' || v_sku
        ) ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;

      -- B. Record warehouse damaged items
      IF v_dam_wh > 0 THEN
        INSERT INTO public.inventory_movements (
          product_id, sku, movement_type, quantity, direction,
          from_location, to_location, picklist_id, route_id,
          reference_number, idempotency_key, notes
        ) VALUES (
          v_prod_id, v_sku, 'damaged_warehouse', v_dam_wh, 'in',
          'vehicle', 'damaged_quarantine', p_picklist_id, v_picklist.route_id,
          'DAM_WH:' || p_picklist_id::text,
          'dam_wh:' || p_picklist_id::text || ':' || v_prod_id::text,
          'Damaged on warehouse return: ' || v_sku
        ) ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;

      -- C. If there is a check-in discrepancy, save as an exception for Admin/Master review
      IF v_discrepancy <> 0 THEN
        v_has_stock_discrepancy := true;
        v_total_stock_discrepancy := v_total_stock_discrepancy + v_discrepancy;

        INSERT INTO public.route_stock_exceptions (
          picklist_id, route_id, worker_id, product_id,
          sku, product_name, required_quantity,
          recorded_warehouse_stock, shortage_quantity,
          exception_type, status, notes
        ) VALUES (
          p_picklist_id, v_picklist.route_id, v_picklist.worker_id, v_prod_id,
          v_sku, COALESCE(v_prod_name, v_sku), v_expected_physical,
          (v_ret + v_dam_wh), v_discrepancy,
          'checkin_discrepancy', 'open',
          COALESCE(v_item_reason, p_stock_reason, 'Check-in stock discrepancy reported by field worker')
        );
      END IF;
    END LOOP;
  END IF;

  -- 2. Process Expenses
  IF p_expenses IS NOT NULL AND jsonb_typeof(p_expenses) = 'array' AND jsonb_array_length(p_expenses) > 0 THEN
    FOR v_exp_item IN SELECT * FROM jsonb_array_elements(p_expenses) LOOP
      v_idx := v_idx + 1;
      v_exp_amt := COALESCE((v_exp_item->>'amount')::numeric, 0);
      v_exp_cat := COALESCE(v_exp_item->>'category', 'Route Expense');
      v_exp_desc := v_exp_item->>'description';
      v_exp_method := COALESCE(v_exp_item->>'payment_method', 'cash');

      IF v_exp_method NOT IN ('cash', 'upi', 'bank', 'other') THEN
        v_exp_method := 'cash';
      END IF;

      IF v_exp_amt > 0 THEN
        INSERT INTO public.expenses (
          category, amount, date, payment_method, description, worker_id, route_id,
          picklist_id, status, visible_to_worker, idempotency_key, approved_at, approved_by
        ) VALUES (
          v_exp_cat, v_exp_amt, CURRENT_DATE, v_exp_method, v_exp_desc, v_picklist.worker_id, v_picklist.route_id,
          p_picklist_id, 'approved', true, 'exp:' || p_picklist_id::text || ':' || v_idx::text, now(),
          COALESCE(auth.uid()::text, v_picklist.worker_id::text)
        ) ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  -- 3. Calculate Route Finances
  SELECT COALESCE(SUM(amount), 0) INTO v_expected_cash
  FROM public.payments
  WHERE picklist_id = p_picklist_id AND payment_mode = 'cash' AND status NOT IN ('reversed', 'bounced');

  SELECT COALESCE(SUM(amount), 0) INTO v_expected_upi
  FROM public.payments
  WHERE picklist_id = p_picklist_id AND payment_mode = 'upi' AND status NOT IN ('reversed', 'bounced');

  SELECT COALESCE(SUM(amount), 0) INTO v_expected_cheque
  FROM public.payments
  WHERE picklist_id = p_picklist_id AND payment_mode = 'cheque' AND status NOT IN ('reversed', 'bounced');

  SELECT COALESCE(SUM(GREATEST(0, delivered_amount - collected_amount)), 0) INTO v_expected_credit
  FROM public.deliveries
  WHERE picklist_id = p_picklist_id AND status IN ('delivered', 'partial');

  SELECT COALESCE(SUM(amount), 0) INTO v_total_expenses
  FROM public.expenses WHERE picklist_id = p_picklist_id AND status = 'approved';

  SELECT COALESCE(SUM(amount), 0) INTO v_cash_expenses
  FROM public.expenses WHERE picklist_id = p_picklist_id AND status = 'approved' AND payment_method = 'cash';

  v_net_cash_deposit := v_expected_cash - v_cash_expenses;
  v_cash_diff := COALESCE(p_actual_cash, 0) - v_net_cash_deposit;

  IF ABS(v_cash_diff) > 0.01 THEN
    v_has_cash_discrepancy := true;
  END IF;

  -- 4. Set Appropriate Picklist Status & Financial Reconciliation Status
  IF v_has_stock_discrepancy OR v_has_cash_discrepancy THEN
    v_final_status := 'pending_reconciliation';
    v_final_fin_status := 'discrepancy';
  ELSE
    v_final_status := 'completed';
    v_final_fin_status := 'reconciled';
  END IF;

  UPDATE public.picklists
  SET status = v_final_status,
      completed_at = CASE WHEN v_final_status = 'completed' THEN COALESCE(completed_at, now()) ELSE completed_at END,
      expected_cash = v_expected_cash,
      actual_cash_returned = p_actual_cash,
      cash_discrepancy = v_cash_diff,
      total_expenses = v_total_expenses,
      net_cash_deposit = v_net_cash_deposit,
      expected_upi = v_expected_upi,
      expected_cheque = v_expected_cheque,
      expected_credit = v_expected_credit,
      financial_reconciled_at = CASE WHEN v_final_fin_status = 'reconciled' THEN now() ELSE financial_reconciled_at END,
      reconciled_by_worker_id = v_picklist.worker_id,
      financial_reconciliation_status = v_final_fin_status,
      notes = COALESCE(p_stock_reason, p_cash_reason, notes),
      updated_at = now()
  WHERE id = p_picklist_id;

  -- 5. Audit Log
  PERFORM public.log_system_event(
    COALESCE(auth.uid()::text, v_picklist.worker_id::text),
    CASE WHEN public.is_current_user_admin_or_master() THEN 'Admin/Master' ELSE 'Worker' END,
    'route_reconciliation',
    CASE WHEN v_has_stock_discrepancy OR v_has_cash_discrepancy THEN 'checkin_discrepancy_reported' ELSE 'route_closed' END,
    CASE WHEN v_has_stock_discrepancy OR v_has_cash_discrepancy THEN 'warning' ELSE 'success' END,
    'Route check-in submitted for picklist ' || p_picklist_id::text || '. Status: ' || v_final_status || '. Stock diff: ' || v_total_stock_discrepancy || ', Cash diff: ₹' || v_cash_diff,
    'picklist',
    p_picklist_id::text
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', v_final_status,
    'financial_status', v_final_fin_status,
    'has_stock_discrepancy', v_has_stock_discrepancy,
    'has_cash_discrepancy', v_has_cash_discrepancy,
    'stock_discrepancy', v_total_stock_discrepancy,
    'cash_discrepancy', v_cash_diff,
    'requires_admin_review', (v_has_stock_discrepancy OR v_has_cash_discrepancy)
  );
END;
$$;

-- ── 5. Create admin_authorize_route_reconciliation RPC ───────────
CREATE OR REPLACE FUNCTION public.admin_authorize_route_reconciliation(
  p_picklist_id uuid,
  p_action text, -- 'approve' or 'reject'
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_picklist record;
  v_ex record;
  v_adj_count integer := 0;
BEGIN
  -- 0. Authorization check: Strict Admin or Master session required
  IF NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Unauthorized: Only Admin or Master can authorize route reconciliations' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_picklist
  FROM public.picklists
  WHERE id = p_picklist_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picklist % not found', p_picklist_id;
  END IF;

  -- Idempotency check
  IF v_picklist.status = 'completed' AND v_picklist.financial_reconciliation_status = 'reconciled' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_reconciled', true,
      'status', 'completed',
      'message', 'Picklist is already reconciled and completed'
    );
  END IF;

  IF p_action = 'approve' THEN
    -- A. For each open check-in stock discrepancy, create authoritative inventory_adjustment movement
    FOR v_ex IN
      SELECT * FROM public.route_stock_exceptions
      WHERE picklist_id = p_picklist_id
        AND exception_type = 'checkin_discrepancy'
        AND status = 'open'
    LOOP
      IF v_ex.shortage_quantity <> 0 THEN
        INSERT INTO public.inventory_movements (
          product_id, sku, movement_type, quantity, direction,
          from_location, to_location, picklist_id, route_id,
          reference_number, idempotency_key, notes
        ) VALUES (
          v_ex.product_id, v_ex.sku, 'inventory_adjustment',
          ABS(v_ex.shortage_quantity),
          CASE WHEN v_ex.shortage_quantity > 0 THEN 'out' ELSE 'in' END,
          CASE WHEN v_ex.shortage_quantity > 0 THEN 'vehicle' ELSE 'adjustment' END,
          CASE WHEN v_ex.shortage_quantity > 0 THEN 'adjustment' ELSE 'vehicle' END,
          p_picklist_id, v_picklist.route_id,
          'ADJ:' || p_picklist_id::text,
          'adj:' || p_picklist_id::text || ':' || v_ex.id::text,
          'Authorized by supervisor: ' || COALESCE(p_notes, v_ex.notes, 'Reconciliation approved')
        ) ON CONFLICT (idempotency_key) DO NOTHING;

        v_adj_count := v_adj_count + 1;
      END IF;

      UPDATE public.route_stock_exceptions
      SET status = 'approved',
          notes = COALESCE(notes, '') || ' [Approved by Admin/Master: ' || COALESCE(p_notes, 'OK') || ']'
      WHERE id = v_ex.id;
    END LOOP;

    -- B. Close picklist
    UPDATE public.picklists
    SET status = 'completed',
        financial_reconciliation_status = 'reconciled',
        completed_at = COALESCE(completed_at, now()),
        financial_reconciled_at = now(),
        notes = CASE WHEN p_notes IS NOT NULL THEN COALESCE(notes, '') || ' [Admin: ' || p_notes || ']' ELSE notes END,
        updated_at = now()
    WHERE id = p_picklist_id;

    -- C. Audit Log
    PERFORM public.log_system_event(
      auth.uid()::text,
      'Admin/Master',
      'route_reconciliation',
      'reconciliation_authorized',
      'success',
      'Route reconciliation authorized by Admin/Master for picklist ' || p_picklist_id::text || '. Adjustments created: ' || v_adj_count,
      'picklist',
      p_picklist_id::text
    );

    RETURN jsonb_build_object(
      'success', true,
      'status', 'completed',
      'adjustments_created', v_adj_count,
      'message', 'Route reconciliation authorized and closed successfully'
    );

  ELSIF p_action = 'reject' THEN
    -- Mark exceptions as rejected
    UPDATE public.route_stock_exceptions
    SET status = 'rejected',
        notes = COALESCE(notes, '') || ' [Rejected: ' || COALESCE(p_notes, 'Discrepancy rejected by supervisor') || ']'
    WHERE picklist_id = p_picklist_id AND status = 'open';

    UPDATE public.picklists
    SET notes = COALESCE(notes, '') || ' [Reconciliation Rejected: ' || COALESCE(p_notes, '') || ']',
        updated_at = now()
    WHERE id = p_picklist_id;

    PERFORM public.log_system_event(
      auth.uid()::text,
      'Admin/Master',
      'route_reconciliation',
      'reconciliation_rejected',
      'warning',
      'Route reconciliation rejected by Admin/Master for picklist ' || p_picklist_id::text,
      'picklist',
      p_picklist_id::text
    );

    RETURN jsonb_build_object(
      'success', true,
      'status', 'pending_reconciliation',
      'message', 'Route reconciliation was rejected and remains open for correction'
    );

  ELSE
    RAISE EXCEPTION 'Invalid action %: must be approve or reject', p_action;
  END IF;
END;
$$;

-- ── 6. Permissions Grant ─────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.submit_route_checkin_and_reconciliation FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_route_checkin_and_reconciliation TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_authorize_route_reconciliation FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_authorize_route_reconciliation TO authenticated, service_role;

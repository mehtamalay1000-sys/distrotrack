-- ── Migration 027: Fix Worker Route Start Non-Blocking & Exceptions RLS ──
-- 1. Ensure route_stock_exceptions has proper RLS policies for authenticated workers
-- 2. Provide route_stops_exceptions compatibility view/alias
-- 3. Update start_route_with_load to be strictly non-blocking for warehouse stock shortages
--    and record shortage exceptions in public.route_stock_exceptions

-- ── 1. Fix RLS on route_stock_exceptions ──────────────────────────
ALTER TABLE public.route_stock_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "route_stock_exceptions_admin_master_all" ON public.route_stock_exceptions;
CREATE POLICY "route_stock_exceptions_admin_master_all"
  ON public.route_stock_exceptions FOR ALL
  TO authenticated
  USING (public.is_current_user_admin_or_master())
  WITH CHECK (public.is_current_user_admin_or_master());

DROP POLICY IF EXISTS "route_stock_exceptions_worker_insert" ON public.route_stock_exceptions;
CREATE POLICY "route_stock_exceptions_worker_insert"
  ON public.route_stock_exceptions FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_current_user_admin_or_master()
    OR (
      public.is_current_user_worker()
      AND (worker_id IS NULL OR worker_id = public.get_current_worker_id())
    )
  );

DROP POLICY IF EXISTS "route_stock_exceptions_worker_select" ON public.route_stock_exceptions;
CREATE POLICY "route_stock_exceptions_worker_select"
  ON public.route_stock_exceptions FOR SELECT
  TO authenticated
  USING (
    public.is_current_user_admin_or_master()
    OR (
      public.is_current_user_worker()
      AND (worker_id IS NULL OR worker_id = public.get_current_worker_id())
    )
  );

-- ── 2. Compatibility alias: route_stops_exceptions ───────────────
CREATE OR REPLACE VIEW public.route_stops_exceptions AS
  SELECT * FROM public.route_stock_exceptions;

GRANT SELECT, INSERT ON public.route_stops_exceptions TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_route_stops_exceptions_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.route_stock_exceptions (
    id, occurred_at, picklist_id, route_id, worker_id, product_id, sku,
    product_name, required_quantity, recorded_warehouse_stock,
    shortage_quantity, status, notes, created_at
  ) VALUES (
    COALESCE(NEW.id, gen_random_uuid()),
    COALESCE(NEW.occurred_at, now()),
    NEW.picklist_id,
    NEW.route_id,
    NEW.worker_id,
    NEW.product_id,
    NEW.sku,
    NEW.product_name,
    COALESCE(NEW.required_quantity, 0),
    COALESCE(NEW.recorded_warehouse_stock, 0),
    COALESCE(NEW.shortage_quantity, 0),
    COALESCE(NEW.status, 'open'),
    NEW.notes,
    COALESCE(NEW.created_at, now())
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_route_stops_exceptions_insert ON public.route_stops_exceptions;
CREATE TRIGGER trg_route_stops_exceptions_insert
  INSTEAD OF INSERT ON public.route_stops_exceptions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_route_stops_exceptions_insert();

-- ── 3. Non-Blocking Route Start RPC Implementation ────────────────
CREATE OR REPLACE FUNCTION public.start_route_with_load(
  p_picklist_id uuid,
  p_worker_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_picklist record;
  v_load record;
  v_prod record;
  v_wh_stock numeric;
  v_loaded_count integer := 0;
  v_load_items_found boolean := false;
  v_current_worker uuid;
  v_had_shortage boolean := false;
  v_shortage_count integer := 0;
BEGIN
  -- 0. Authorization check: Caller must be authenticated worker or admin/master
  IF NOT public.is_current_user_worker() AND NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- 1. Lock picklist FOR UPDATE
  SELECT * INTO v_picklist
  FROM public.picklists
  WHERE id = p_picklist_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picklist % not found', p_picklist_id;
  END IF;

  -- Horizontal Scope Check: Worker can only start assigned picklist or assigned route
  v_current_worker := public.get_current_worker_id();
  IF public.is_current_user_worker() THEN
    IF v_picklist.worker_id IS NULL THEN
      -- If picklist worker_id was unassigned, check if route is assigned to current worker
      IF NOT EXISTS (
        SELECT 1 FROM public.routes r
        WHERE r.id = v_picklist.route_id AND r.assigned_worker_id = v_current_worker
      ) THEN
        RAISE EXCEPTION 'Unauthorized: Authenticated worker % is not assigned to picklist %', v_current_worker, p_picklist_id USING ERRCODE = '42501';
      ELSE
        UPDATE public.picklists SET worker_id = v_current_worker WHERE id = p_picklist_id;
        v_picklist.worker_id := v_current_worker;
      END IF;
    ELSIF v_picklist.worker_id IS DISTINCT FROM v_current_worker THEN
      RAISE EXCEPTION 'Unauthorized: Authenticated worker % is not assigned to picklist %', v_current_worker, p_picklist_id USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_picklist.status = 'completed' THEN
    RAISE EXCEPTION 'Picklist % is already completed and cannot be restarted', p_picklist_id;
  END IF;

  IF v_picklist.status = 'in_progress' THEN
    IF EXISTS (
      SELECT 1 FROM public.inventory_movements
      WHERE picklist_id = p_picklist_id AND movement_type = 'route_load'
    ) THEN
      RETURN jsonb_build_object(
        'success', true,
        'already_started', true,
        'message', 'Route is already in progress with stock loaded'
      );
    END IF;
  END IF;

  -- Ensure picklist_load_items exist
  SELECT EXISTS(SELECT 1 FROM public.picklist_load_items WHERE picklist_id = p_picklist_id) INTO v_load_items_found;

  IF NOT v_load_items_found THEN
    INSERT INTO public.picklist_load_items (picklist_id, product_id, sku, loaded_quantity)
    SELECT
      p_picklist_id,
      di.product_id,
      di.sku,
      SUM(di.ordered_qty + di.free_quantity)
    FROM public.delivery_items di
    JOIN public.deliveries d ON d.id = di.delivery_id
    WHERE d.picklist_id = p_picklist_id
      AND di.product_id IS NOT NULL
    GROUP BY di.product_id, di.sku
    ON CONFLICT (picklist_id, product_id) DO UPDATE
      SET loaded_quantity = EXCLUDED.loaded_quantity;
  END IF;

  -- 2. Process Load Items: Stock shortage is non-blocking
  FOR v_load IN
    SELECT pli.*, p.name as product_name
    FROM public.picklist_load_items pli
    JOIN public.products p ON p.id = pli.product_id
    WHERE pli.picklist_id = p_picklist_id AND pli.loaded_quantity > 0
    ORDER BY pli.sku
  LOOP
    SELECT * INTO v_prod FROM public.products WHERE id = v_load.product_id FOR UPDATE;
    v_wh_stock := COALESCE(public.get_warehouse_stock(v_load.product_id), 0);

    -- NON-BLOCKING SHORTAGE EXCEPTION LOGGING
    IF v_wh_stock < v_load.loaded_quantity THEN
      v_had_shortage := true;
      v_shortage_count := v_shortage_count + 1;

      -- Record visible route stock exception
      INSERT INTO public.route_stock_exceptions (
        picklist_id,
        route_id,
        worker_id,
        product_id,
        sku,
        product_name,
        required_quantity,
        recorded_warehouse_stock,
        shortage_quantity,
        status,
        notes
      ) VALUES (
        p_picklist_id,
        v_picklist.route_id,
        COALESCE(v_picklist.worker_id, v_current_worker),
        v_load.product_id,
        v_load.sku,
        COALESCE(v_prod.name, v_load.sku),
        v_load.loaded_quantity,
        v_wh_stock,
        (v_load.loaded_quantity - v_wh_stock),
        'open',
        'Route started despite warehouse shortage (Required: ' || v_load.loaded_quantity || ', Available: ' || v_wh_stock || ')'
      );

      -- Record warning in Master Audit Log
      INSERT INTO public.master_audit_log (
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
        COALESCE(auth.uid()::text, v_picklist.worker_id::text, 'system'),
        CASE WHEN public.is_current_user_worker() THEN 'Worker' ELSE 'Admin' END,
        CASE WHEN public.is_current_user_worker() THEN 'worker' ELSE 'admin' END,
        'inventory',
        'route_start_stock_shortage',
        'warning',
        'Route started despite warehouse shortage for SKU ' || v_load.sku || ' (' || COALESCE(v_prod.name, '') || '): required ' || v_load.loaded_quantity || ', recorded warehouse stock ' || v_wh_stock,
        'picklist',
        p_picklist_id::text
      );
    END IF;

    -- Append route_load movement to maintain physical vehicle inventory ledger
    INSERT INTO public.inventory_movements (
      product_id,
      sku,
      movement_type,
      quantity,
      direction,
      from_location,
      to_location,
      picklist_id,
      route_id,
      worker_id,
      reference_number,
      idempotency_key,
      notes,
      source_location,
      destination_location,
      reference_type,
      reference_id,
      created_by
    ) VALUES (
      v_load.product_id,
      v_load.sku,
      'route_load',
      v_load.loaded_quantity,
      'out',
      'warehouse',
      'vehicle',
      p_picklist_id,
      v_picklist.route_id,
      COALESCE(p_worker_id, v_picklist.worker_id, v_current_worker),
      'RL-' || p_picklist_id::text || '-' || v_load.sku,
      'rl-' || p_picklist_id::text || '-' || v_load.sku || '-' || clock_timestamp()::text,
      'Loaded for route delivery: ' || v_load.sku,
      'warehouse',
      'vehicle:' || p_picklist_id::text,
      'picklist',
      p_picklist_id::text,
      COALESCE(auth.uid(), v_picklist.worker_id)
    );

    v_loaded_count := v_loaded_count + 1;
  END LOOP;

  -- 3. Transition picklist and deliveries to in-progress
  UPDATE public.picklists
  SET status = 'in_progress',
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  WHERE id = p_picklist_id;

  UPDATE public.deliveries
  SET status = 'out_for_delivery',
      updated_at = now()
  WHERE picklist_id = p_picklist_id
    AND status = 'pending';

  PERFORM public.log_system_event(
    COALESCE(auth.uid()::text, v_picklist.worker_id::text, 'unknown'),
    CASE WHEN public.is_current_user_admin_or_master() THEN 'Admin/Master' ELSE 'Worker' END,
    'route_lifecycle',
    'route_started',
    'success',
    'Route started for picklist ' || p_picklist_id::text || ' with ' || v_loaded_count || ' products loaded' ||
      CASE WHEN v_had_shortage THEN ' (' || v_shortage_count || ' stock shortage exceptions recorded)' ELSE '' END,
    'picklist',
    p_picklist_id::text
  );

  RETURN jsonb_build_object(
    'success', true,
    'picklist_id', p_picklist_id,
    'loaded_count', v_loaded_count,
    'had_shortage', v_had_shortage,
    'shortage_count', v_shortage_count,
    'message', CASE WHEN v_had_shortage
      THEN 'Route started. Warehouse stock shortage recorded as visible exception.'
      ELSE 'Route started successfully with stock loaded.'
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_route_with_load(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.start_route_with_load(uuid, uuid) FROM anon, PUBLIC;

COMMENT ON FUNCTION public.start_route_with_load(uuid, uuid) IS
  'Non-blocking route start: verifies worker authorization and route state, logs inventory exceptions for warehouse shortages, and transitions picklist to in_progress and deliveries to out_for_delivery.';

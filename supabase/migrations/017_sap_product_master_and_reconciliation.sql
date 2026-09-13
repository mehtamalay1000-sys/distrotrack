-- ================================================================
-- Migration 017: SAP Product Master + Non-Blocking Stock Route Start +
--                SAP Stock Reconciliation + Master Oversight
-- ================================================================

-- ── 1. Products Table: Extended SAP Fields ───────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS uom text DEFAULT 'EA',
  ADD COLUMN IF NOT EXISTS sub_category text,
  ADD COLUMN IF NOT EXISTS sub_brand text,
  ADD COLUMN IF NOT EXISTS variant text,
  ADD COLUMN IF NOT EXISTS ppg text,
  ADD COLUMN IF NOT EXISTS ppg_description text,
  ADD COLUMN IF NOT EXISTS material_group text,
  ADD COLUMN IF NOT EXISTS prod_hierarchy text,
  ADD COLUMN IF NOT EXISTS is_sap_master boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_products_brand ON public.products(brand);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category);
CREATE INDEX IF NOT EXISTS idx_products_sap_master ON public.products(is_sap_master);

-- ── 2. Inventory Movements: Defensive Column Compatibility ───────
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS source_location text,
  ADD COLUMN IF NOT EXISTS destination_location text,
  ADD COLUMN IF NOT EXISTS reference_type text,
  ADD COLUMN IF NOT EXISTS reference_id text,
  ADD COLUMN IF NOT EXISTS created_by uuid;

-- ── 3. Route Stock Shortage Exceptions Table ─────────────────────
-- Records discrepancies when route starts despite insufficient recorded warehouse stock.
-- Route start proceeds, but exception is visibly captured for Admin/Master.
CREATE TABLE IF NOT EXISTS public.route_stock_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  picklist_id uuid REFERENCES public.picklists(id) ON DELETE CASCADE,
  route_id uuid REFERENCES public.routes(id) ON DELETE SET NULL,
  worker_id uuid REFERENCES public.workers(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  sku text NOT NULL,
  product_name text NOT NULL,
  required_quantity numeric(10,2) NOT NULL,
  recorded_warehouse_stock numeric(10,2) NOT NULL,
  shortage_quantity numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigated', 'resolved')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_route_stock_exceptions_picklist ON public.route_stock_exceptions(picklist_id);
CREATE INDEX IF NOT EXISTS idx_route_stock_exceptions_sku ON public.route_stock_exceptions(sku);
CREATE INDEX IF NOT EXISTS idx_route_stock_exceptions_occurred ON public.route_stock_exceptions(occurred_at DESC);

ALTER TABLE public.route_stock_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "route_stock_exceptions_admin_master_select" ON public.route_stock_exceptions;
CREATE POLICY "route_stock_exceptions_admin_master_select"
  ON public.route_stock_exceptions FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin_or_master());

DROP POLICY IF EXISTS "route_stock_exceptions_worker_select" ON public.route_stock_exceptions;
CREATE POLICY "route_stock_exceptions_worker_select"
  ON public.route_stock_exceptions FOR SELECT
  TO authenticated
  USING (public.is_current_user_worker() AND worker_id = public.get_current_worker_id());

-- ── 4. Unmapped SKU Exceptions Table ─────────────────────────────
-- Captures unmapped SKUs discovered during picklist or invoice imports.
CREATE TABLE IF NOT EXISTS public.unmapped_sku_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  imported_product_name text,
  source_type text DEFAULT 'picklist' CHECK (source_type IN ('picklist', 'bill', 'sap_upload', 'other')),
  source_reference text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  affected_picklist_count integer NOT NULL DEFAULT 1,
  affected_bill_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'unresolved' CHECK (status IN ('unresolved', 'resolved', 'ignored')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unmapped_sku_status ON public.unmapped_sku_exceptions(status);
CREATE INDEX IF NOT EXISTS idx_unmapped_sku_last_seen ON public.unmapped_sku_exceptions(last_seen_at DESC);

ALTER TABLE public.unmapped_sku_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "unmapped_sku_exceptions_admin_master_all" ON public.unmapped_sku_exceptions;
CREATE POLICY "unmapped_sku_exceptions_admin_master_all"
  ON public.unmapped_sku_exceptions FOR ALL
  TO authenticated
  USING (public.is_current_user_admin_or_master())
  WITH CHECK (public.is_current_user_admin_or_master());

-- ── 5. SAP Stock Reconciliation Snapshot Tables ──────────────────
-- Immutable month-end / periodic comparison snapshots.
-- Does NOT modify physical inventory_movements.
CREATE TABLE IF NOT EXISTS public.sap_stock_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  file_name text,
  total_products integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  variance_count integer NOT NULL DEFAULT 0,
  incomplete_count integer NOT NULL DEFAULT 0,
  unmapped_count integer NOT NULL DEFAULT 0,
  positive_variance_count integer NOT NULL DEFAULT 0,
  negative_variance_count integer NOT NULL DEFAULT 0,
  total_sap_stock numeric(12,2) NOT NULL DEFAULT 0,
  total_distrotrack_stock numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sap_reconciliations_period ON public.sap_stock_reconciliations(period);
CREATE INDEX IF NOT EXISTS idx_sap_reconciliations_uploaded ON public.sap_stock_reconciliations(uploaded_at DESC);

ALTER TABLE public.sap_stock_reconciliations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sap_reconciliations_admin_master_all" ON public.sap_stock_reconciliations;
CREATE POLICY "sap_reconciliations_admin_master_all"
  ON public.sap_stock_reconciliations FOR ALL
  TO authenticated
  USING (public.is_current_user_admin_or_master())
  WITH CHECK (public.is_current_user_admin_or_master());

CREATE TABLE IF NOT EXISTS public.sap_stock_reconciliation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES public.sap_stock_reconciliations(id) ON DELETE CASCADE,
  sku text NOT NULL,
  product_name text NOT NULL,
  uom text DEFAULT 'pcs',
  sap_stock numeric(12,2),
  distrotrack_stock numeric(12,2),
  variance numeric(12,2),
  status text NOT NULL CHECK (status IN ('MATCHED', 'VARIANCE', 'INCOMPLETE DATA', 'UNMAPPED SKU')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sap_reconcil_items_rec_id ON public.sap_stock_reconciliation_items(reconciliation_id);
CREATE INDEX IF NOT EXISTS idx_sap_reconcil_items_sku ON public.sap_stock_reconciliation_items(sku);
CREATE INDEX IF NOT EXISTS idx_sap_reconcil_items_status ON public.sap_stock_reconciliation_items(status);

ALTER TABLE public.sap_stock_reconciliation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sap_reconciliation_items_admin_master_all" ON public.sap_stock_reconciliation_items;
CREATE POLICY "sap_reconciliation_items_admin_master_all"
  ON public.sap_stock_reconciliation_items FOR ALL
  TO authenticated
  USING (public.is_current_user_admin_or_master())
  WITH CHECK (public.is_current_user_admin_or_master());

-- ── 6. Non-Blocking Route Start RPC Implementation ────────────────
-- Warehouse stock shortage MUST NOT block route start.
-- It records an inventory shortage exception and warning in master_audit_log,
-- and allows the route to start normally.
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

  -- Horizontal Scope Check: Worker can only start assigned picklist
  v_current_worker := public.get_current_worker_id();
  IF public.is_current_user_worker() THEN
    IF v_picklist.worker_id IS DISTINCT FROM v_current_worker THEN
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

  -- 2. Process Load Items: Stock check is non-blocking
  FOR v_load IN
    SELECT pli.*, p.name as product_name
    FROM public.picklist_load_items pli
    JOIN public.products p ON p.id = pli.product_id
    WHERE pli.picklist_id = p_picklist_id AND pli.loaded_quantity > 0
    ORDER BY pli.sku
  LOOP
    SELECT * INTO v_prod FROM public.products WHERE id = v_load.product_id FOR UPDATE;
    v_wh_stock := COALESCE(public.get_warehouse_stock(v_load.product_id), 0);

    -- NON-BLOCKING CHECK: If warehouse stock is insufficient, log exception but do NOT block!
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
        v_picklist.worker_id,
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
      COALESCE(p_worker_id, v_picklist.worker_id),
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
  'Non-blocking route start: verifies worker authorization and route state, logs inventory exceptions for warehouse shortages, and allows route execution without fake stock.';

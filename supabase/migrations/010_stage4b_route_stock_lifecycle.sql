-- ================================================================
-- Migration 010: Stage 4B Route Stock Lifecycle
-- ================================================================
-- Complete Stage 4B inventory lifecycle:
-- 1. Create picklist_load_items (Page 1 manifest storage)
-- 2. Alter delivery_items (add delivered_free_qty, returned_qty, returned_free_qty, damaged_qty, damaged_free_qty)
-- 3. Expand deliveries.status check constraint to include 'refused'
-- 4. RPC start_route_with_load (Atomic warehouse -> vehicle stock movement)
-- 5. RPC complete_delivery_with_ledger (Atomic delivery completion + ledger + payments)
-- 6. RPC check_route_stock (Authoritative ledger query of vehicle stock)
-- 7. RPC close_route_with_reconciliation (Atomic return verification & route closure)
-- ================================================================

-- ── Step 1: Pre-flight checks on existing transactional data ─────
DO $$
BEGIN
  RAISE NOTICE 'Migration 010: Running pre-flight checks...';
  -- Verify no existing delivery_items violate new quantity bounds
  IF EXISTS (
    SELECT 1 FROM delivery_items
    WHERE delivered_qty > ordered_qty OR free_quantity < 0
  ) THEN
    RAISE EXCEPTION 'Pre-flight failed: delivery_items contains invalid records.';
  END IF;
  RAISE NOTICE 'Pre-flight checks passed.';
END $$;

-- ── Step 2: Create picklist_load_items ────────────────────────────
CREATE TABLE IF NOT EXISTS picklist_load_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  picklist_id uuid NOT NULL REFERENCES picklists(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  sku text NOT NULL,
  loaded_quantity numeric NOT NULL CHECK (loaded_quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_picklist_load_items UNIQUE (picklist_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_picklist_load_items_picklist ON picklist_load_items(picklist_id);
CREATE INDEX IF NOT EXISTS idx_picklist_load_items_product ON picklist_load_items(product_id);
CREATE INDEX IF NOT EXISTS idx_picklist_load_items_sku ON picklist_load_items(sku);

ALTER TABLE picklist_load_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_read_picklist_load_items" ON picklist_load_items;
CREATE POLICY "allow_read_picklist_load_items"
  ON picklist_load_items FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "allow_insert_picklist_load_items" ON picklist_load_items;
CREATE POLICY "allow_insert_picklist_load_items"
  ON picklist_load_items FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "allow_update_picklist_load_items" ON picklist_load_items;
CREATE POLICY "allow_update_picklist_load_items"
  ON picklist_load_items FOR UPDATE
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "block_delete_picklist_load_items" ON picklist_load_items;
CREATE POLICY "block_delete_picklist_load_items"
  ON picklist_load_items FOR DELETE
  TO anon, authenticated
  USING (false);

-- ── Step 3: Alter delivery_items table ───────────────────────────
ALTER TABLE delivery_items
  ADD COLUMN IF NOT EXISTS delivered_free_qty numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returned_qty numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returned_free_qty numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS damaged_qty numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS damaged_free_qty numeric NOT NULL DEFAULT 0;

DO $$
BEGIN
  -- Nonnegative constraints
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_delivery_items_delivered_free_qty_non_neg') THEN
    ALTER TABLE delivery_items ADD CONSTRAINT chk_delivery_items_delivered_free_qty_non_neg CHECK (delivered_free_qty >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_delivery_items_returned_qty_non_neg') THEN
    ALTER TABLE delivery_items ADD CONSTRAINT chk_delivery_items_returned_qty_non_neg CHECK (returned_qty >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_delivery_items_returned_free_qty_non_neg') THEN
    ALTER TABLE delivery_items ADD CONSTRAINT chk_delivery_items_returned_free_qty_non_neg CHECK (returned_free_qty >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_delivery_items_damaged_qty_non_neg') THEN
    ALTER TABLE delivery_items ADD CONSTRAINT chk_delivery_items_damaged_qty_non_neg CHECK (damaged_qty >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_delivery_items_damaged_free_qty_non_neg') THEN
    ALTER TABLE delivery_items ADD CONSTRAINT chk_delivery_items_damaged_free_qty_non_neg CHECK (damaged_free_qty >= 0);
  END IF;

  -- Conservation bounds
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_delivery_items_ordered_balance') THEN
    ALTER TABLE delivery_items ADD CONSTRAINT chk_delivery_items_ordered_balance
      CHECK (delivered_qty + returned_qty + damaged_qty <= ordered_qty);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_delivery_items_free_balance') THEN
    ALTER TABLE delivery_items ADD CONSTRAINT chk_delivery_items_free_balance
      CHECK (delivered_free_qty + returned_free_qty + damaged_free_qty <= free_quantity);
  END IF;
END $$;

-- ── Step 4: Expand deliveries.status to support 'refused' ────────
ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS deliveries_status_check;
ALTER TABLE deliveries ADD CONSTRAINT deliveries_status_check
  CHECK (status IN ('pending', 'out_for_delivery', 'delivered', 'failed', 'partial', 'refused', 'cancelled'));

-- ── Step 5: Helper Functions for Inventory Balances ──────────────

CREATE OR REPLACE FUNCTION get_warehouse_stock(p_product_id uuid)
RETURNS numeric AS $$
DECLARE
  v_balance numeric;
BEGIN
  SELECT COALESCE(
    SUM(
      CASE
        WHEN to_location = 'warehouse' THEN quantity
        WHEN from_location = 'warehouse' THEN -quantity
        ELSE 0
      END
    ), 0
  ) INTO v_balance
  FROM inventory_movements
  WHERE product_id = p_product_id;

  RETURN v_balance;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION get_vehicle_stock(p_picklist_id uuid, p_product_id uuid)
RETURNS numeric AS $$
DECLARE
  v_balance numeric;
BEGIN
  SELECT COALESCE(
    SUM(
      CASE
        WHEN to_location = 'vehicle' THEN quantity
        WHEN from_location = 'vehicle' THEN -quantity
        ELSE 0
      END
    ), 0
  ) INTO v_balance
  FROM inventory_movements
  WHERE picklist_id = p_picklist_id
    AND product_id = p_product_id;

  RETURN v_balance;
END;
$$ LANGUAGE plpgsql STABLE;

-- ── Step 6: RPC 1: start_route_with_load ─────────────────────────
CREATE OR REPLACE FUNCTION start_route_with_load(
  p_picklist_id uuid,
  p_worker_id uuid
) RETURNS jsonb AS $$
DECLARE
  v_picklist record;
  v_load record;
  v_prod record;
  v_wh_stock numeric;
  v_loaded_count integer := 0;
  v_load_items_found boolean := false;
BEGIN
  -- 1. Lock picklist FOR UPDATE
  SELECT * INTO v_picklist
  FROM picklists
  WHERE id = p_picklist_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picklist % not found', p_picklist_id;
  END IF;

  -- 2. Check if already started or completed
  IF v_picklist.status = 'completed' THEN
    RAISE EXCEPTION 'Picklist % is already completed and cannot be restarted', p_picklist_id;
  END IF;

  IF v_picklist.status = 'in_progress' THEN
    -- Check if route_load movements already exist
    IF EXISTS (
      SELECT 1 FROM inventory_movements
      WHERE picklist_id = p_picklist_id AND movement_type = 'route_load'
    ) THEN
      RETURN jsonb_build_object(
        'success', true,
        'already_started', true,
        'message', 'Route is already in progress with stock loaded'
      );
    END IF;
  END IF;

  -- 3. Verify worker assignment
  IF p_worker_id IS NOT NULL AND v_picklist.worker_id IS NOT NULL AND v_picklist.worker_id <> p_worker_id THEN
    RAISE EXCEPTION 'Worker % is not assigned to picklist %', p_worker_id, p_picklist_id;
  END IF;

  -- 4. Check if picklist_load_items has rows
  SELECT EXISTS(SELECT 1 FROM picklist_load_items WHERE picklist_id = p_picklist_id) INTO v_load_items_found;

  -- If not found in picklist_load_items, build from delivery_items on the fly
  IF NOT v_load_items_found THEN
    INSERT INTO picklist_load_items (picklist_id, product_id, sku, loaded_quantity)
    SELECT
      p_picklist_id,
      di.product_id,
      di.sku,
      SUM(di.ordered_qty + di.free_quantity)
    FROM delivery_items di
    JOIN deliveries d ON d.id = di.delivery_id
    WHERE d.picklist_id = p_picklist_id
      AND di.product_id IS NOT NULL
    GROUP BY di.product_id, di.sku
    ON CONFLICT (picklist_id, product_id) DO UPDATE
      SET loaded_quantity = EXCLUDED.loaded_quantity;
  END IF;

  -- 5. Iterate through load items, lock products, verify warehouse stock, and create movements
  FOR v_load IN
    SELECT pli.*, p.name as product_name
    FROM picklist_load_items pli
    JOIN products p ON p.id = pli.product_id
    WHERE pli.picklist_id = p_picklist_id AND pli.loaded_quantity > 0
    ORDER BY pli.sku
  LOOP
    -- Lock product row
    SELECT * INTO v_prod FROM products WHERE id = v_load.product_id FOR UPDATE;

    -- Calculate warehouse stock
    v_wh_stock := get_warehouse_stock(v_load.product_id);

    -- Reject if warehouse would become negative
    IF v_wh_stock < v_load.loaded_quantity THEN
      RAISE EXCEPTION 'Insufficient warehouse stock for SKU % (%): required %, available %',
        v_load.sku, v_prod.name, v_load.loaded_quantity, v_wh_stock;
    END IF;

    -- Insert route_load movement
    INSERT INTO inventory_movements (
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
      notes
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
      v_picklist.picklist_number,
      'route_load:' || p_picklist_id || ':' || v_load.product_id,
      'Loaded onto vehicle for picklist ' || v_picklist.picklist_number
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    v_loaded_count := v_loaded_count + 1;
  END LOOP;

  -- 6. Update picklist status
  UPDATE picklists
  SET status = 'in_progress',
      started_at = COALESCE(started_at, now()),
      worker_id = COALESCE(p_worker_id, worker_id)
  WHERE id = p_picklist_id;

  -- 7. Update pending deliveries to out_for_delivery
  UPDATE deliveries
  SET status = 'out_for_delivery',
      worker_id = COALESCE(p_worker_id, worker_id)
  WHERE picklist_id = p_picklist_id AND status = 'pending';

  -- 8. Audit log
  PERFORM log_system_event(
    COALESCE(p_worker_id::text, ''),
    'Worker',
    'worker',
    'route',
    'route_started',
    'success',
    'Route started with ' || v_loaded_count || ' loaded products for picklist ' || v_picklist.picklist_number,
    'picklist',
    p_picklist_id::text
  );

  RETURN jsonb_build_object(
    'success', true,
    'picklist_id', p_picklist_id,
    'status', 'in_progress',
    'products_loaded', v_loaded_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Step 7: RPC 2: complete_delivery_with_ledger ─────────────────
CREATE OR REPLACE FUNCTION complete_delivery_with_ledger(
  p_delivery_id uuid,
  p_worker_id uuid,
  p_items jsonb,
  p_payment_mode text,
  p_payment_amount numeric,
  p_reference_number text DEFAULT NULL,
  p_cheque_number text DEFAULT NULL,
  p_cheque_date date DEFAULT NULL,
  p_cheque_bank text DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_delivery record;
  v_picklist record;
  v_item record;
  v_item_input jsonb;
  v_item_id uuid;
  v_del_qty numeric;
  v_del_free numeric;
  v_ret_qty numeric;
  v_ret_free numeric;
  v_dam_qty numeric;
  v_dam_free numeric;
  v_phys_del numeric;
  v_phys_dam numeric;
  v_veh_stock numeric;
  v_final_delivered_amount numeric := 0;
  v_all_delivered boolean := true;
  v_all_zero boolean := true;
  v_final_status text;
  v_item_count integer := 0;
  v_input_count integer := 0;
  v_completed_count integer;
  v_total_collected numeric;
  v_total_cash numeric;
  v_total_cheque numeric;
  v_total_credit numeric;
BEGIN
  -- 1. Lock delivery FOR UPDATE
  SELECT * INTO v_delivery
  FROM deliveries
  WHERE id = p_delivery_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery % not found', p_delivery_id;
  END IF;

  -- Check if already finalized
  IF v_delivery.status IN ('delivered', 'partial', 'refused') THEN
    -- Idempotent return of existing state
    RETURN jsonb_build_object(
      'success', true,
      'already_completed', true,
      'status', v_delivery.status,
      'delivered_amount', v_delivery.delivered_amount,
      'message', 'Delivery was already finalized'
    );
  END IF;

  -- 2. Lock picklist FOR UPDATE
  SELECT * INTO v_picklist
  FROM picklists
  WHERE id = v_delivery.picklist_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picklist % for delivery % not found', v_delivery.picklist_id, p_delivery_id;
  END IF;

  -- 3. Lock delivery_items and validate counts
  SELECT count(*) INTO v_item_count FROM delivery_items WHERE delivery_id = p_delivery_id;
  v_input_count := jsonb_array_length(p_items);

  IF v_item_count <> v_input_count THEN
    RAISE EXCEPTION 'Item count mismatch: expected %, received %', v_item_count, v_input_count;
  END IF;

  -- 4. Process each item
  FOR v_item_input IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_id := (v_item_input->>'delivery_item_id')::uuid;
    v_del_qty := COALESCE((v_item_input->>'delivered_qty')::numeric, 0);
    v_del_free := COALESCE((v_item_input->>'delivered_free_qty')::numeric, 0);
    v_ret_qty := COALESCE((v_item_input->>'returned_qty')::numeric, 0);
    v_ret_free := COALESCE((v_item_input->>'returned_free_qty')::numeric, 0);
    v_dam_qty := COALESCE((v_item_input->>'damaged_qty')::numeric, 0);
    v_dam_free := COALESCE((v_item_input->>'damaged_free_qty')::numeric, 0);

    -- Find and lock item
    SELECT * INTO v_item
    FROM delivery_items
    WHERE id = v_item_id AND delivery_id = p_delivery_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Delivery item % does not belong to delivery %', v_item_id, p_delivery_id;
    END IF;

    -- Validate bounds
    IF v_del_qty < 0 OR v_del_free < 0 OR v_ret_qty < 0 OR v_ret_free < 0 OR v_dam_qty < 0 OR v_dam_free < 0 THEN
      RAISE EXCEPTION 'Negative quantity submitted for item %', v_item.sku;
    END IF;

    IF v_del_qty > v_item.ordered_qty THEN
      RAISE EXCEPTION 'Delivered qty % exceeds ordered qty % for SKU %', v_del_qty, v_item.ordered_qty, v_item.sku;
    END IF;

    IF v_del_free > v_item.free_quantity THEN
      RAISE EXCEPTION 'Delivered free qty % exceeds scheme free qty % for SKU %', v_del_free, v_item.free_quantity, v_item.sku;
    END IF;

    IF v_del_qty + v_ret_qty + v_dam_qty > v_item.ordered_qty THEN
      RAISE EXCEPTION 'Total disposition (% + % + %) exceeds ordered qty % for SKU %',
        v_del_qty, v_ret_qty, v_dam_qty, v_item.ordered_qty, v_item.sku;
    END IF;

    IF v_del_free + v_ret_free + v_dam_free > v_item.free_quantity THEN
      RAISE EXCEPTION 'Total free disposition (% + % + %) exceeds scheme free qty % for SKU %',
        v_del_free, v_ret_free, v_dam_free, v_item.free_quantity, v_item.sku;
    END IF;

    v_phys_del := v_del_qty + v_del_free;
    v_phys_dam := v_dam_qty + v_dam_free;

    -- Check if full delivery
    IF v_del_qty < v_item.ordered_qty OR v_del_free < v_item.free_quantity OR v_phys_dam > 0 THEN
      v_all_delivered := false;
    END IF;

    -- Check if anything was delivered
    IF v_phys_del > 0 THEN
      v_all_zero := false;
    END IF;

    -- Verify vehicle stock cannot become negative
    IF (v_phys_del + v_phys_dam) > 0 AND v_item.product_id IS NOT NULL THEN
      v_veh_stock := get_vehicle_stock(v_delivery.picklist_id, v_item.product_id);
      IF v_veh_stock < (v_phys_del + v_phys_dam) THEN
        RAISE EXCEPTION 'Insufficient vehicle stock for SKU % on picklist %: required %, available on truck %',
          v_item.sku, v_delivery.picklist_id, (v_phys_del + v_phys_dam), v_veh_stock;
      END IF;

      -- Emit delivery_fulfilled movement
      IF v_phys_del > 0 THEN
        INSERT INTO inventory_movements (
          product_id,
          sku,
          movement_type,
          quantity,
          direction,
          from_location,
          to_location,
          picklist_id,
          route_id,
          delivery_id,
          party_id,
          worker_id,
          reference_number,
          idempotency_key,
          notes
        ) VALUES (
          v_item.product_id,
          v_item.sku,
          'delivery_fulfilled',
          v_phys_del,
          'out',
          'vehicle',
          'customer',
          v_delivery.picklist_id,
          v_picklist.route_id,
          p_delivery_id,
          v_delivery.party_id,
          p_worker_id,
          v_delivery.invoice_id::text,
          'delivery_fulfilled:' || v_item.id,
          'Delivered ' || v_del_qty || ' commercial + ' || v_del_free || ' free to retailer'
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;

      -- Emit damaged_transit movement if damaged
      IF v_phys_dam > 0 THEN
        INSERT INTO inventory_movements (
          product_id,
          sku,
          movement_type,
          quantity,
          direction,
          from_location,
          to_location,
          picklist_id,
          route_id,
          delivery_id,
          party_id,
          worker_id,
          reference_number,
          idempotency_key,
          notes
        ) VALUES (
          v_item.product_id,
          v_item.sku,
          'damaged_transit',
          v_phys_dam,
          'out',
          'vehicle',
          'damaged_quarantine',
          v_delivery.picklist_id,
          v_picklist.route_id,
          p_delivery_id,
          v_delivery.party_id,
          p_worker_id,
          v_delivery.invoice_id::text,
          'damaged_transit:' || v_item.id,
          'Damaged in transit: ' || v_dam_qty || ' commercial + ' || v_dam_free || ' free'
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;
    END IF;

    -- Update line item
    UPDATE delivery_items
    SET delivered_qty = v_del_qty,
        delivered_free_qty = v_del_free,
        returned_qty = v_ret_qty,
        returned_free_qty = v_ret_free,
        damaged_qty = v_dam_qty,
        damaged_free_qty = v_dam_free
    WHERE id = v_item.id;

    v_final_delivered_amount := v_final_delivered_amount + (v_del_qty * v_item.rate);
  END LOOP;

  -- 5. Determine final delivery status
  IF v_all_delivered THEN
    v_final_status := 'delivered';
  ELSIF v_all_zero THEN
    v_final_status := 'refused';
  ELSE
    v_final_status := 'partial';
  END IF;

  -- Validate payment inputs
  IF p_payment_amount < 0 THEN
    RAISE EXCEPTION 'Payment amount cannot be negative';
  END IF;

  IF p_payment_mode <> 'credit' AND p_payment_amount > v_final_delivered_amount THEN
    RAISE EXCEPTION 'Payment amount % cannot exceed collectible amount %', p_payment_amount, v_final_delivered_amount;
  END IF;

  -- 6. Update delivery header
  UPDATE deliveries
  SET status = v_final_status,
      delivered_at = now(),
      delivered_amount = v_final_delivered_amount,
      collected_amount = CASE WHEN p_payment_mode = 'credit' THEN 0 ELSE p_payment_amount END,
      payment_mode = p_payment_mode,
      worker_id = COALESCE(p_worker_id, worker_id)
  WHERE id = p_delivery_id;

  -- 7. Insert payment (idempotent guard)
  IF NOT EXISTS (SELECT 1 FROM payments WHERE delivery_id = p_delivery_id) THEN
    INSERT INTO payments (
      delivery_id,
      party_id,
      invoice_id,
      worker_id,
      received_by_worker_id,
      amount,
      payment_mode,
      reference_number,
      cheque_number,
      cheque_date,
      cheque_bank,
      notes,
      payment_date,
      status
    ) VALUES (
      p_delivery_id,
      v_delivery.party_id,
      v_delivery.invoice_id,
      p_worker_id,
      p_worker_id,
      p_payment_amount,
      p_payment_mode,
      COALESCE(p_reference_number, 'PAY:' || p_delivery_id),
      p_cheque_number,
      p_cheque_date,
      p_cheque_bank,
      p_notes,
      CURRENT_DATE,
      CASE WHEN p_payment_mode = 'credit' THEN 'pending' ELSE 'collected' END
    );
  END IF;

  -- 8. Update invoice status
  IF v_delivery.invoice_id IS NOT NULL THEN
    UPDATE invoices
    SET status = CASE WHEN v_final_status = 'delivered' THEN 'delivered'
                      WHEN v_final_status = 'partial' THEN 'partial'
                      ELSE 'pending' END
    WHERE id = v_delivery.invoice_id;
  END IF;

  -- 9. Update customer outstanding balance if credit
  IF p_payment_mode = 'credit' AND v_final_delivered_amount > 0 THEN
    UPDATE parties
    SET outstanding_amount = outstanding_amount + v_final_delivered_amount
    WHERE id = v_delivery.party_id;
  END IF;

  -- 10. Update picklist financial totals
  SELECT count(*) INTO v_completed_count
  FROM deliveries
  WHERE picklist_id = v_delivery.picklist_id AND status IN ('delivered', 'partial', 'refused');

  SELECT COALESCE(SUM(amount), 0) INTO v_total_collected
  FROM payments
  WHERE delivery_id IN (SELECT id FROM deliveries WHERE picklist_id = v_delivery.picklist_id)
    AND payment_mode IN ('cash', 'cheque', 'upi');

  SELECT COALESCE(SUM(amount), 0) INTO v_total_cash
  FROM payments
  WHERE delivery_id IN (SELECT id FROM deliveries WHERE picklist_id = v_delivery.picklist_id)
    AND payment_mode = 'cash';

  SELECT COALESCE(SUM(amount), 0) INTO v_total_cheque
  FROM payments
  WHERE delivery_id IN (SELECT id FROM deliveries WHERE picklist_id = v_delivery.picklist_id)
    AND payment_mode IN ('cheque', 'upi');

  SELECT COALESCE(SUM(delivered_amount), 0) INTO v_total_credit
  FROM deliveries
  WHERE picklist_id = v_delivery.picklist_id AND payment_mode = 'credit';

  UPDATE picklists
  SET completed_parties = v_completed_count,
      total_collected = v_total_collected,
      total_cash = v_total_cash,
      total_cheque = v_total_cheque,
      total_credit = v_total_credit
  WHERE id = v_delivery.picklist_id;

  -- 11. Audit log
  PERFORM log_system_event(
    COALESCE(p_worker_id::text, ''),
    'Worker',
    'worker',
    'delivery',
    'delivery_' || v_final_status,
    'success',
    'Delivery ' || p_delivery_id || ' marked ' || v_final_status || ' for party ' || v_delivery.party_id || ' (amount: ' || v_final_delivered_amount || ')',
    'delivery',
    p_delivery_id::text
  );

  RETURN jsonb_build_object(
    'success', true,
    'delivery_id', p_delivery_id,
    'status', v_final_status,
    'delivered_amount', v_final_delivered_amount
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Step 8: RPC 3: check_route_stock ─────────────────────────────
CREATE OR REPLACE FUNCTION check_route_stock(
  p_picklist_id uuid
) RETURNS jsonb AS $$
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
BEGIN
  -- Count total ledger movements for this picklist
  SELECT count(*) INTO v_movement_count
  FROM inventory_movements
  WHERE picklist_id = p_picklist_id;

  -- Warehouse impact totals
  SELECT COALESCE(SUM(quantity), 0) INTO v_warehouse_loaded
  FROM inventory_movements
  WHERE picklist_id = p_picklist_id AND movement_type = 'route_load';

  SELECT COALESCE(SUM(quantity), 0) INTO v_warehouse_returned
  FROM inventory_movements
  WHERE picklist_id = p_picklist_id AND movement_type = 'route_return';

  FOR v_item IN
    WITH loaded AS (
      SELECT product_id, sku, SUM(quantity) as loaded_qty
      FROM inventory_movements
      WHERE picklist_id = p_picklist_id AND movement_type = 'route_load'
      GROUP BY product_id, sku
    ),
    delivered_ledger AS (
      SELECT product_id, SUM(quantity) as delivered_fulfilled_qty
      FROM inventory_movements
      WHERE picklist_id = p_picklist_id AND movement_type = 'delivery_fulfilled'
      GROUP BY product_id
    ),
    damaged AS (
      SELECT product_id, SUM(quantity) as damaged_qty
      FROM inventory_movements
      WHERE picklist_id = p_picklist_id AND movement_type = 'damaged_transit'
      GROUP BY product_id
    ),
    returned AS (
      SELECT product_id, SUM(quantity) as returned_qty
      FROM inventory_movements
      WHERE picklist_id = p_picklist_id AND movement_type = 'route_return'
      GROUP BY product_id
    ),
    item_breakdown AS (
      SELECT
        di.product_id,
        COALESCE(SUM(di.delivered_qty), 0) as comm_delivered_qty,
        COALESCE(SUM(di.delivered_free_qty), 0) as free_delivered_qty
      FROM delivery_items di
      JOIN deliveries d ON d.id = di.delivery_id
      WHERE d.picklist_id = p_picklist_id
      GROUP BY di.product_id
    )
    SELECT
      l.product_id,
      l.sku,
      p.name as product_name,
      l.loaded_qty,
      COALESCE(ib.comm_delivered_qty, COALESCE(dl.delivered_fulfilled_qty, 0)) as delivered_qty,
      COALESCE(ib.free_delivered_qty, 0) as delivered_free_qty,
      COALESCE(dam.damaged_qty, 0) as damaged_transit_qty,
      COALESCE(r.returned_qty, 0) as route_return_qty,
      (l.loaded_qty - COALESCE(dl.delivered_fulfilled_qty, 0) - COALESCE(dam.damaged_qty, 0) - COALESCE(r.returned_qty, 0)) as expected_vehicle_qty
    FROM loaded l
    JOIN products p ON p.id = l.product_id
    LEFT JOIN delivered_ledger dl ON dl.product_id = l.product_id
    LEFT JOIN damaged dam ON dam.product_id = l.product_id
    LEFT JOIN returned r ON r.product_id = l.product_id
    LEFT JOIN item_breakdown ib ON ib.product_id = l.product_id
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
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ── Step 9: RPC 4: close_route_with_reconciliation ───────────────
CREATE OR REPLACE FUNCTION close_route_with_reconciliation(
  p_picklist_id uuid,
  p_worker_id uuid,
  p_return_items jsonb
) RETURNS jsonb AS $$
DECLARE
  v_picklist record;
  v_item_input jsonb;
  v_prod_id uuid;
  v_sku text;
  v_ret numeric;
  v_dam_wh numeric;
  v_adj numeric;
  v_adj_reason text;
  v_expected numeric;
  v_unresolved_count integer;
  v_processed_count integer := 0;
  v_unaccounted record;
BEGIN
  -- 1. Lock picklist FOR UPDATE
  SELECT * INTO v_picklist
  FROM picklists
  WHERE id = p_picklist_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picklist % not found', p_picklist_id;
  END IF;

  IF v_picklist.status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_completed', true,
      'status', 'completed',
      'message', 'Picklist is already completed and closed'
    );
  END IF;

  IF v_picklist.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Picklist % is not in progress (current status: %)', p_picklist_id, v_picklist.status;
  END IF;

  -- 2. Verify all deliveries are resolved
  SELECT count(*) INTO v_unresolved_count
  FROM deliveries
  WHERE picklist_id = p_picklist_id AND status IN ('pending', 'out_for_delivery');

  IF v_unresolved_count > 0 THEN
    RAISE EXCEPTION 'Cannot close route: % deliveries are still unresolved', v_unresolved_count;
  END IF;

  -- 3. Process each return item and verify conservation
  FOR v_item_input IN SELECT * FROM jsonb_array_elements(p_return_items) LOOP
    v_prod_id := (v_item_input->>'product_id')::uuid;
    v_ret := COALESCE((v_item_input->>'returned_qty')::numeric, 0);
    v_dam_wh := COALESCE((v_item_input->>'damaged_warehouse_qty')::numeric, 0);
    v_adj := COALESCE((v_item_input->>'adjustment_qty')::numeric, 0);
    v_adj_reason := v_item_input->>'adjustment_reason';

    -- Get SKU
    SELECT sku INTO v_sku FROM products WHERE id = v_prod_id;

    -- Calculate expected vehicle stock from ledger
    v_expected := get_vehicle_stock(p_picklist_id, v_prod_id);

    -- Conservation rule check: expected = return + damaged + adjustment
    IF v_expected <> (v_ret + v_dam_wh + v_adj) THEN
      RAISE EXCEPTION 'Stock discrepancy for SKU % on picklist %: expected vehicle stock %, entered return % + damaged % + adj % (difference: %)',
        v_sku, p_picklist_id, v_expected, v_ret, v_dam_wh, v_adj, (v_expected - (v_ret + v_dam_wh + v_adj));
    END IF;

    -- If adjustment exists, require reason and verify authorization
    IF v_adj <> 0 THEN
      IF (v_adj_reason IS NULL OR length(trim(v_adj_reason)) = 0) THEN
        RAISE EXCEPTION 'Discrepancy adjustment for SKU % requires an explicit adjustment_reason', v_sku;
      END IF;

      IF p_worker_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pin_users WHERE id = p_worker_id AND role IN ('admin', 'master')
      ) THEN
        RAISE EXCEPTION 'Worker % is not authorized to approve inventory adjustments. Adjustments require Admin or Master approval.', p_worker_id;
      END IF;
    END IF;

    -- Record route_return movement: vehicle -> warehouse
    IF v_ret > 0 THEN
      INSERT INTO inventory_movements (
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
        notes
      ) VALUES (
        v_prod_id,
        v_sku,
        'route_return',
        v_ret,
        'in',
        'vehicle',
        'warehouse',
        p_picklist_id,
        v_picklist.route_id,
        p_worker_id,
        v_picklist.picklist_number,
        'route_return:' || p_picklist_id || ':' || v_prod_id,
        'Physical check-in returned from vehicle to warehouse'
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    -- Record damaged_warehouse movement: vehicle -> damaged_quarantine
    IF v_dam_wh > 0 THEN
      INSERT INTO inventory_movements (
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
        notes
      ) VALUES (
        v_prod_id,
        v_sku,
        'damaged_warehouse',
        v_dam_wh,
        'out',
        'vehicle',
        'damaged_quarantine',
        p_picklist_id,
        v_picklist.route_id,
        p_worker_id,
        v_picklist.picklist_number,
        'damaged_wh:' || p_picklist_id || ':' || v_prod_id,
        'Returned damaged to warehouse quarantine'
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    -- Record inventory_adjustment if approved discrepancy
    IF v_adj <> 0 THEN
      INSERT INTO inventory_movements (
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
        notes
      ) VALUES (
        v_prod_id,
        v_sku,
        'inventory_adjustment',
        ABS(v_adj),
        CASE WHEN v_adj > 0 THEN 'in' ELSE 'out' END,
        CASE WHEN v_adj > 0 THEN 'adjustment' ELSE 'vehicle' END,
        CASE WHEN v_adj > 0 THEN 'vehicle' ELSE 'adjustment' END,
        p_picklist_id,
        v_picklist.route_id,
        p_worker_id,
        v_picklist.picklist_number,
        'adj:' || p_picklist_id || ':' || v_prod_id || ':' || extract(epoch from now())::bigint,
        'Route check-in reconciliation adjustment: ' || v_adj_reason
      );
    END IF;

    v_processed_count := v_processed_count + 1;
  END LOOP;

  -- Verify no unreturned stock remains in vehicle for omitted products
  FOR v_unaccounted IN
    SELECT DISTINCT product_id, sku
    FROM inventory_movements
    WHERE picklist_id = p_picklist_id
  LOOP
    v_expected := get_vehicle_stock(p_picklist_id, v_unaccounted.product_id);
    IF v_expected > 0 THEN
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_return_items) elem
        WHERE (elem->>'product_id')::uuid = v_unaccounted.product_id
      ) THEN
        RAISE EXCEPTION 'Stock discrepancy: SKU % has % unreturned units remaining on vehicle that were not accounted for in check-in', v_unaccounted.sku, v_expected;
      END IF;
    END IF;
  END LOOP;

  -- 4. Mark picklist completed
  UPDATE picklists
  SET status = 'completed',
      completed_at = now()
  WHERE id = p_picklist_id;

  -- 5. Audit log
  PERFORM log_system_event(
    COALESCE(p_worker_id::text, ''),
    'Worker',
    'worker',
    'route',
    'route_completed',
    'success',
    'Route for picklist ' || v_picklist.picklist_number || ' closed and reconciled with ' || v_processed_count || ' items verified',
    'picklist',
    p_picklist_id::text
  );

  RETURN jsonb_build_object(
    'success', true,
    'picklist_id', p_picklist_id,
    'status', 'completed',
    'items_reconciled', v_processed_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Step 10: Grant Execute Permissions on RPCs ───────────────────
GRANT EXECUTE ON FUNCTION start_route_with_load(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_delivery_with_ledger(uuid, uuid, jsonb, text, numeric, text, text, date, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION check_route_stock(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION close_route_with_reconciliation(uuid, uuid, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_warehouse_stock(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_vehicle_stock(uuid, uuid) TO anon, authenticated;

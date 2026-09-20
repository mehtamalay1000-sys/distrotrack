-- =====================================================================
-- Migration 039: Authoritative Multi-Location Inventory Accounting
--
-- INVARIANTS:
--   1. Warehouse -> Vehicle transfer (route_load) has NET ZERO effect on Total Operational Stock.
--      Warehouse stock decreases by quantity, Vehicle stock increases by quantity.
--   2. Vehicle -> Customer delivery (delivery_fulfilled) reduces Vehicle stock and
--      Total Operational Stock exactly once. Warehouse stock is NOT affected.
--   3. Vehicle -> Warehouse return (route_return) has NET ZERO effect on Total Operational Stock.
--      Vehicle stock decreases by quantity, Warehouse stock increases by quantity.
--   4. Transit/Warehouse damage (damaged_transit, damaged_warehouse) is a true loss,
--      reducing Total Operational Stock by damaged quantity.
--   5. Total Operational Stock = Warehouse Stock + Vehicle Stock.
-- =====================================================================

-- 1. Helper: Calculate total operational stock across all operational locations (Warehouse + Vehicles)
CREATE OR REPLACE FUNCTION public.get_total_operational_stock(p_product_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance numeric;
BEGIN
  SELECT COALESCE(
    SUM(
      CASE
        -- Enters operational custody (e.g. supplier -> warehouse)
        WHEN to_location IN ('warehouse', 'vehicle') AND from_location NOT IN ('warehouse', 'vehicle') THEN quantity
        -- Leaves operational custody (e.g. vehicle -> customer, vehicle -> damaged_quarantine, warehouse -> damaged_quarantine)
        WHEN from_location IN ('warehouse', 'vehicle') AND to_location NOT IN ('warehouse', 'vehicle') THEN -quantity
        -- Internal location transfer (warehouse <-> vehicle) has net 0 effect
        ELSE 0
      END
    ), 0
  ) INTO v_balance
  FROM public.inventory_movements
  WHERE product_id = p_product_id;

  RETURN v_balance;
END;
$$;

-- 2. Helper: Calculate total operational stock by SKU string (handles unmapped/catalog lookup)
CREATE OR REPLACE FUNCTION public.get_total_operational_stock_by_sku(p_sku text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance numeric;
  v_norm text;
BEGIN
  v_norm := regexp_replace(upper(trim(p_sku)), '^0+', '');
  IF v_norm = '' THEN
    v_norm := upper(trim(p_sku));
  END IF;

  SELECT COALESCE(
    SUM(
      CASE
        WHEN to_location IN ('warehouse', 'vehicle') AND from_location NOT IN ('warehouse', 'vehicle') THEN quantity
        WHEN from_location IN ('warehouse', 'vehicle') AND to_location NOT IN ('warehouse', 'vehicle') THEN -quantity
        ELSE 0
      END
    ), 0
  ) INTO v_balance
  FROM public.inventory_movements
  WHERE regexp_replace(upper(trim(sku)), '^0+', '') = v_norm
     OR upper(trim(sku)) = upper(trim(p_sku));

  RETURN v_balance;
END;
$$;

-- 3. Helper: Calculate warehouse stock by SKU string
CREATE OR REPLACE FUNCTION public.get_warehouse_stock_by_sku(p_sku text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance numeric;
  v_norm text;
BEGIN
  v_norm := regexp_replace(upper(trim(p_sku)), '^0+', '');
  IF v_norm = '' THEN
    v_norm := upper(trim(p_sku));
  END IF;

  SELECT COALESCE(
    SUM(
      CASE
        WHEN to_location = 'warehouse' THEN quantity
        WHEN from_location = 'warehouse' THEN -quantity
        ELSE 0
      END
    ), 0
  ) INTO v_balance
  FROM public.inventory_movements
  WHERE regexp_replace(upper(trim(sku)), '^0+', '') = v_norm
     OR upper(trim(sku)) = upper(trim(p_sku));

  RETURN v_balance;
END;
$$;

-- 4. Authoritative Multi-Location Balance Summary RPC
CREATE OR REPLACE FUNCTION public.get_product_stock_balances_by_sku(p_sku text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_norm text;
  v_wh numeric := 0;
  v_veh numeric := 0;
  v_total numeric := 0;
  v_inbound numeric := 0;
  v_delivered numeric := 0;
  v_returned numeric := 0;
  v_damaged numeric := 0;
  v_adjustments numeric := 0;
  v_opening numeric := 0;
  v_loaded numeric := 0;
BEGIN
  v_norm := regexp_replace(upper(trim(p_sku)), '^0+', '');
  IF v_norm = '' THEN
    v_norm := upper(trim(p_sku));
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN to_location = 'warehouse' THEN quantity WHEN from_location = 'warehouse' THEN -quantity ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN to_location = 'vehicle' THEN quantity WHEN from_location = 'vehicle' THEN -quantity ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN movement_type = 'purchase_inward' THEN quantity ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN movement_type = 'delivery_fulfilled' THEN quantity ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN movement_type = 'route_return' THEN quantity ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN movement_type IN ('damaged_transit', 'damaged_warehouse') THEN quantity ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN movement_type = 'opening_balance' THEN quantity ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN movement_type = 'route_load' THEN quantity ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN movement_type = 'inventory_adjustment' THEN (CASE WHEN direction = 'in' THEN quantity ELSE -quantity END) ELSE 0 END), 0)
  INTO
    v_wh,
    v_veh,
    v_inbound,
    v_delivered,
    v_returned,
    v_damaged,
    v_opening,
    v_loaded,
    v_adjustments
  FROM public.inventory_movements
  WHERE regexp_replace(upper(trim(sku)), '^0+', '') = v_norm
     OR upper(trim(sku)) = upper(trim(p_sku));

  v_total := v_wh + v_veh;

  RETURN jsonb_build_object(
    'sku', p_sku,
    'warehouse_stock', v_wh,
    'vehicle_stock', v_veh,
    'total_operational_stock', v_total,
    'opening_stock', v_opening,
    'inbound_qty', v_inbound,
    'route_loaded_qty', v_loaded,
    'delivered_qty', v_delivered,
    'returned_qty', v_returned,
    'damaged_qty', v_damaged,
    'adjustment_qty', v_adjustments
  );
END;
$$;

-- 5. Authoritative Multi-Location Balance Summary RPC by Product ID
CREATE OR REPLACE FUNCTION public.get_product_stock_balances(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wh numeric := 0;
  v_veh numeric := 0;
  v_total numeric := 0;
  v_inbound numeric := 0;
  v_delivered numeric := 0;
  v_returned numeric := 0;
  v_damaged numeric := 0;
  v_adjustments numeric := 0;
  v_opening numeric := 0;
  v_loaded numeric := 0;
  v_sku text := '';
BEGIN
  SELECT sku INTO v_sku FROM public.products WHERE id = p_product_id;

  SELECT
    COALESCE(SUM(CASE WHEN to_location = 'warehouse' THEN quantity WHEN from_location = 'warehouse' THEN -quantity ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN to_location = 'vehicle' THEN quantity WHEN from_location = 'vehicle' THEN -quantity ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN movement_type = 'purchase_inward' THEN quantity ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN movement_type = 'delivery_fulfilled' THEN quantity ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN movement_type = 'route_return' THEN quantity ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN movement_type IN ('damaged_transit', 'damaged_warehouse') THEN quantity ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN movement_type = 'opening_balance' THEN quantity ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN movement_type = 'route_load' THEN quantity ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN movement_type = 'inventory_adjustment' THEN (CASE WHEN direction = 'in' THEN quantity ELSE -quantity END) ELSE 0 END), 0)
  INTO
    v_wh,
    v_veh,
    v_inbound,
    v_delivered,
    v_returned,
    v_damaged,
    v_opening,
    v_loaded,
    v_adjustments
  FROM public.inventory_movements
  WHERE product_id = p_product_id;

  v_total := v_wh + v_veh;

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'sku', v_sku,
    'warehouse_stock', v_wh,
    'vehicle_stock', v_veh,
    'total_operational_stock', v_total,
    'opening_stock', v_opening,
    'inbound_qty', v_inbound,
    'route_loaded_qty', v_loaded,
    'delivered_qty', v_delivered,
    'returned_qty', v_returned,
    'damaged_qty', v_damaged,
    'adjustment_qty', v_adjustments
  );
END;
$$;

-- 6. Permissions and Execution Grants
GRANT EXECUTE ON FUNCTION public.get_total_operational_stock(uuid) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.get_total_operational_stock_by_sku(text) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.get_warehouse_stock_by_sku(text) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.get_product_stock_balances_by_sku(text) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.get_product_stock_balances(uuid) TO authenticated, service_role, anon;

COMMENT ON FUNCTION public.get_total_operational_stock(uuid) IS
  'Authoritative total operational stock across warehouse and active vehicles. Internal location transfers (route_load, route_return) have net 0 impact.';
COMMENT ON FUNCTION public.get_product_stock_balances_by_sku(text) IS
  'Authoritative multi-location stock breakdown (warehouse, vehicle, total) by SKU.';

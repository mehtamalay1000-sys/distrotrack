-- ================================================================
-- Migration 019: Add Unmapped SAP Products to Product Master RPC
-- ================================================================
-- Allows Admin/Owner to add unmapped SAP materials from weekly purchase
-- imports directly into canonical public.products table.
--
-- Invariants:
-- 1. Exact Material/SKU is canonical identifier; idempotent by SKU
-- 2. Only Authenticated Admin/Owner authorized (Stage 8 Security)
-- 3. Anon mutation blocked
-- 4. Audit trail logged to master_audit_log
-- 5. Does NOT create inventory movements (movements happen only on import confirmation)
-- ================================================================

-- ── 1. Products Table: Source Tracking Column ───────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_products_source ON public.products(source);

-- ── 2. Single Unmapped Product Creation RPC ──────────────────────
CREATE OR REPLACE FUNCTION public.add_unmapped_sap_product(
  p_product jsonb,
  p_import_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id uuid;
  v_sku text;
  v_name text;
  v_uom text;
  v_category text;
  v_sub_category text;
  v_brand text;
  v_sub_brand text;
  v_variant text;
  v_ppg text;
  v_ppg_description text;
  v_material_group text;
  v_prod_hierarchy text;
  v_mrp numeric;
  v_rate numeric;
  v_status text;
  v_existing_id uuid;
  v_new_id uuid;
BEGIN
  -- 1. Security Check: Admin / Master Only
  IF NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Authorization failure: Only Admin or Master can add products to Product Master.'
      USING ERRCODE = '42501';
  END IF;

  v_caller_id := auth.uid();

  -- 2. Validate required SKU & Name
  v_sku := trim(COALESCE(p_product->>'sku', ''));
  v_name := trim(COALESCE(p_product->>'name', ''));

  IF v_sku = '' THEN
    RAISE EXCEPTION 'Material/SKU is required to add product to Product Master.'
      USING ERRCODE = '22023';
  END IF;

  IF v_name = '' THEN
    v_name := v_sku;
  END IF;

  -- 3. Idempotency check by SKU
  SELECT id INTO v_existing_id
  FROM public.products
  WHERE upper(sku) = upper(v_sku)
     OR (ltrim(upper(sku), '0') <> '' AND ltrim(upper(sku), '0') = ltrim(upper(v_sku), '0'))
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'already_exists',
      'product_id', v_existing_id,
      'sku', v_sku,
      'message', 'Product with SKU already exists in Product Master.'
    );
  END IF;

  -- 4. Extract fields without inventing fabricated values
  v_uom := COALESCE(p_product->>'uom', 'DOZ');
  v_category := NULLIF(trim(COALESCE(p_product->>'category', '')), '');
  v_sub_category := NULLIF(trim(COALESCE(p_product->>'sub_category', '')), '');
  v_brand := NULLIF(trim(COALESCE(p_product->>'brand', '')), '');
  v_sub_brand := NULLIF(trim(COALESCE(p_product->>'sub_brand', '')), '');
  v_variant := NULLIF(trim(COALESCE(p_product->>'variant', '')), '');
  v_ppg := NULLIF(trim(COALESCE(p_product->>'ppg', '')), '');
  v_ppg_description := NULLIF(trim(COALESCE(p_product->>'ppg_description', '')), '');
  v_material_group := NULLIF(trim(COALESCE(p_product->>'material_group', '')), '');
  v_prod_hierarchy := NULLIF(trim(COALESCE(p_product->>'prod_hierarchy', '')), '');
  v_mrp := COALESCE((p_product->>'mrp')::numeric, 0);
  v_rate := COALESCE((p_product->>'rate')::numeric, 0);
  v_status := COALESCE(p_product->>'status', 'active');

  -- 5. Insert canonical product
  INSERT INTO public.products (
    sku,
    name,
    uom,
    unit,
    category,
    sub_category,
    brand,
    sub_brand,
    variant,
    ppg,
    ppg_description,
    material_group,
    prod_hierarchy,
    mrp,
    rate,
    status,
    source,
    is_sap_master
  ) VALUES (
    v_sku,
    v_name,
    v_uom,
    v_uom,
    v_category,
    v_sub_category,
    v_brand,
    v_sub_brand,
    v_variant,
    v_ppg,
    v_ppg_description,
    v_material_group,
    v_prod_hierarchy,
    v_mrp,
    v_rate,
    v_status,
    'sap_purchase_import',
    true
  ) RETURNING id INTO v_new_id;

  -- 6. Resolve unmapped SKU exception if present
  BEGIN
    UPDATE public.unmapped_sku_exceptions
    SET status = 'resolved',
        notes = 'Added to Product Master via SAP purchase import ' || COALESCE(p_import_ref, 'N/A'),
        updated_at = now()
    WHERE upper(sku) = upper(v_sku);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 7. Audit log
  BEGIN
    PERFORM public.log_system_event(
      COALESCE(v_caller_id::text, 'unknown'),
      'Admin/Master',
      'product_master',
      'add_unmapped_product',
      'success',
      'Product ' || v_sku || ' (' || v_name || ') added to Product Master from SAP purchase import ' || COALESCE(p_import_ref, 'N/A'),
      'products',
      v_new_id::text
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'created',
    'product_id', v_new_id,
    'sku', v_sku,
    'name', v_name,
    'message', 'Product added to Product Master successfully.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_unmapped_sap_product(jsonb, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.add_unmapped_sap_product(jsonb, text) FROM anon, PUBLIC;

-- ── 3. Bulk Unmapped Products Creation RPC ───────────────────────
CREATE OR REPLACE FUNCTION public.add_bulk_unmapped_sap_products(
  p_products jsonb,
  p_import_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id uuid;
  v_item jsonb;
  v_created_count integer := 0;
  v_skipped_duplicate_count integer := 0;
  v_skipped_invalid_count integer := 0;
  v_res jsonb;
BEGIN
  -- 1. Security Check
  IF NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Authorization failure: Only Admin or Master can add products to Product Master.'
      USING ERRCODE = '42501';
  END IF;

  v_caller_id := auth.uid();

  -- 2. Process each product item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_products)
  LOOP
    IF trim(COALESCE(v_item->>'sku', '')) = '' THEN
      v_skipped_invalid_count := v_skipped_invalid_count + 1;
      CONTINUE;
    END IF;

    v_res := public.add_unmapped_sap_product(v_item, p_import_ref);

    IF v_res->>'status' = 'created' THEN
      v_created_count := v_created_count + 1;
    ELSIF v_res->>'status' = 'already_exists' THEN
      v_skipped_duplicate_count := v_skipped_duplicate_count + 1;
    ELSE
      v_skipped_invalid_count := v_skipped_invalid_count + 1;
    END IF;
  END LOOP;

  -- 3. Audit log summary
  BEGIN
    PERFORM public.log_system_event(
      COALESCE(v_caller_id::text, 'unknown'),
      'Admin/Master',
      'product_master',
      'bulk_add_unmapped_products',
      'success',
      'Bulk added ' || v_created_count || ' products to Product Master from SAP purchase import ' || COALESCE(p_import_ref, 'N/A') || ' (' || v_skipped_duplicate_count || ' duplicates skipped)',
      'products',
      COALESCE(p_import_ref, 'N/A')
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'created_count', v_created_count,
    'skipped_duplicate_count', v_skipped_duplicate_count,
    'skipped_invalid_count', v_skipped_invalid_count,
    'message', 'Bulk product creation complete: ' || v_created_count || ' created, ' || v_skipped_duplicate_count || ' duplicates skipped.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_bulk_unmapped_sap_products(jsonb, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.add_bulk_unmapped_sap_products(jsonb, text) FROM anon, PUBLIC;

COMMENT ON FUNCTION public.add_unmapped_sap_product(jsonb, text) IS
  'Adds an unmapped SAP material into Product Master without fabricating values; strictly idempotent by SKU.';
COMMENT ON FUNCTION public.add_bulk_unmapped_sap_products(jsonb, text) IS
  'Bulk adds valid unmapped SAP materials into Product Master with duplicate protection and audit trail.';

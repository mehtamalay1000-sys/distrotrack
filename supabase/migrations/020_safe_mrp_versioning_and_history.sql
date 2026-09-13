-- ==============================================================================
-- MIGRATION 020: Safe MRP Versioning, Transaction Snapshot & Product MRP History
--
-- 1. Adds mrp_at_sale snapshot column to delivery_items & picklist_items to protect
--    historical transaction records from changing when Product Master current MRP changes.
-- 2. Creates public.product_mrp_history table for auditing product MRP changes over time.
-- 3. Implements secure update_product_mrp and update_bulk_product_mrp RPCs (Owner/Admin only).
-- ==============================================================================

-- 1. Add mrp_at_sale snapshot columns to operational line item tables
ALTER TABLE public.delivery_items ADD COLUMN IF NOT EXISTS mrp_at_sale numeric(10,2) DEFAULT NULL;
ALTER TABLE public.picklist_items ADD COLUMN IF NOT EXISTS mrp_at_sale numeric(10,2) DEFAULT NULL;

-- Backfill existing delivery_items & picklist_items from products if available
UPDATE public.delivery_items di
SET mrp_at_sale = p.mrp
FROM public.products p
WHERE di.product_id = p.id AND di.mrp_at_sale IS NULL AND p.mrp IS NOT NULL AND p.mrp > 0;

UPDATE public.picklist_items pi
SET mrp_at_sale = p.mrp
FROM public.products p
WHERE pi.product_id = p.id AND pi.mrp_at_sale IS NULL AND p.mrp IS NOT NULL AND p.mrp > 0;

-- 2. Create product_mrp_history table
CREATE TABLE IF NOT EXISTS public.product_mrp_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  sku text NOT NULL,
  old_mrp numeric(10,2) NOT NULL,
  new_mrp numeric(10,2) NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'SAP_PURCHASE_IMPORT',
  import_reference text,
  changed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_mrp_history_sku ON public.product_mrp_history(sku);
CREATE INDEX IF NOT EXISTS idx_product_mrp_history_effective ON public.product_mrp_history(effective_at DESC);

-- Enable RLS
ALTER TABLE public.product_mrp_history ENABLE ROW LEVEL SECURITY;

-- Read policy: authenticated users can view MRP history
DROP POLICY IF EXISTS "Authenticated users view product_mrp_history" ON public.product_mrp_history;
CREATE POLICY "Authenticated users view product_mrp_history"
  ON public.product_mrp_history
  FOR SELECT
  TO authenticated
  USING (true);

-- Mutation policy: Admin / Master only
DROP POLICY IF EXISTS "Admin and Master can manage product_mrp_history" ON public.product_mrp_history;
CREATE POLICY "Admin and Master can manage product_mrp_history"
  ON public.product_mrp_history
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('owner', 'master')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('owner', 'master')
    )
  );

-- 3. Secure RPC: update_product_mrp
CREATE OR REPLACE FUNCTION public.update_product_mrp(
  p_sku text,
  p_new_mrp numeric,
  p_source text DEFAULT 'SAP_PURCHASE_IMPORT',
  p_import_ref text DEFAULT NULL,
  p_effective_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_user_id uuid;
  v_is_authorized boolean := false;
  v_prod_id uuid;
  v_old_mrp numeric(10,2);
  v_clean_sku text;
  v_unpadded_sku text;
BEGIN
  v_current_user_id := auth.uid();

  -- Stage 8 Authorization: Check if caller is admin or master
  SELECT (role IN ('owner', 'master')) INTO v_is_authorized
  FROM public.profiles
  WHERE id = v_current_user_id;

  IF v_current_user_id IS NOT NULL AND NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Only Owner/Admin can update Product Master MRP.';
  END IF;

  v_clean_sku := UPPER(TRIM(p_sku));
  v_unpadded_sku := REGEXP_REPLACE(v_clean_sku, '^0+', '');

  -- Find existing product
  SELECT id, mrp INTO v_prod_id, v_old_mrp
  FROM public.products
  WHERE UPPER(sku) = v_clean_sku
     OR (v_unpadded_sku <> '' AND UPPER(sku) = v_unpadded_sku)
  LIMIT 1;

  IF v_prod_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'not_found',
      'message', format('Product with SKU %s not found in Product Master', v_clean_sku)
    );
  END IF;

  -- If old MRP matches new MRP, no update needed
  IF v_old_mrp = p_new_mrp THEN
    RETURN jsonb_build_object(
      'status', 'unchanged',
      'sku', v_clean_sku,
      'mrp', v_old_mrp,
      'message', 'Incoming MRP matches current Product Master MRP. No change.'
    );
  END IF;

  -- Update Product Master current MRP (NEVER touches historical delivery_items/picklist_items!)
  UPDATE public.products
  SET mrp = p_new_mrp,
      updated_at = now()
  WHERE id = v_prod_id;

  -- Insert history record
  INSERT INTO public.product_mrp_history (
    product_id,
    sku,
    old_mrp,
    new_mrp,
    effective_at,
    source,
    import_reference,
    changed_by
  ) VALUES (
    v_prod_id,
    v_clean_sku,
    v_old_mrp,
    p_new_mrp,
    COALESCE(p_effective_at, now()),
    COALESCE(p_source, 'SAP_PURCHASE_IMPORT'),
    p_import_ref,
    v_current_user_id
  );

  -- Log in master_audit_log
  INSERT INTO public.master_audit_log (
    action_type,
    entity_type,
    entity_id,
    actor_id,
    actor_role,
    metadata
  ) VALUES (
    'product_mrp_updated',
    'product',
    v_prod_id,
    v_current_user_id,
    'admin',
    jsonb_build_object(
      'sku', v_clean_sku,
      'old_mrp', v_old_mrp,
      'new_mrp', p_new_mrp,
      'source', COALESCE(p_source, 'SAP_PURCHASE_IMPORT'),
      'import_ref', p_import_ref,
      'effective_at', COALESCE(p_effective_at, now())
    )
  );

  RETURN jsonb_build_object(
    'status', 'updated',
    'sku', v_clean_sku,
    'old_mrp', v_old_mrp,
    'new_mrp', p_new_mrp,
    'message', format('Updated SKU %s MRP from ₹%s to ₹%s', v_clean_sku, v_old_mrp, p_new_mrp)
  );
END;
$$;

-- 4. Secure RPC: update_bulk_product_mrp
CREATE OR REPLACE FUNCTION public.update_bulk_product_mrp(
  p_updates jsonb,
  p_import_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_sku text;
  v_new_mrp numeric;
  v_source text;
  v_effective_at timestamptz;
  v_single_res jsonb;
  v_total int := 0;
  v_updated int := 0;
  v_unchanged int := 0;
  v_details jsonb := '[]'::jsonb;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    v_total := v_total + 1;
    v_sku := v_item->>'sku';
    v_new_mrp := (v_item->>'new_mrp')::numeric;
    v_source := COALESCE(v_item->>'source', 'SAP_PURCHASE_IMPORT');
    IF v_item->>'effective_at' IS NOT NULL AND v_item->>'effective_at' <> '' THEN
      v_effective_at := (v_item->>'effective_at')::timestamptz;
    ELSE
      v_effective_at := now();
    END IF;

    IF v_sku IS NULL OR v_sku = '' OR v_new_mrp IS NULL OR v_new_mrp <= 0 THEN
      v_details := v_details || jsonb_build_object('sku', COALESCE(v_sku, ''), 'status', 'invalid', 'error', 'Invalid SKU or MRP');
      CONTINUE;
    END IF;

    v_single_res := public.update_product_mrp(v_sku, v_new_mrp, v_source, p_import_ref, v_effective_at);
    v_details := v_details || v_single_res;

    IF v_single_res->>'status' = 'updated' THEN
      v_updated := v_updated + 1;
    ELSIF v_single_res->>'status' = 'unchanged' THEN
      v_unchanged := v_unchanged + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'total', v_total,
    'updated_count', v_updated,
    'unchanged_count', v_unchanged,
    'details', v_details
  );
END;
$$;

-- Grant permissions
REVOKE EXECUTE ON FUNCTION public.update_product_mrp FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_product_mrp FROM anon;
GRANT EXECUTE ON FUNCTION public.update_product_mrp TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_product_mrp TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_bulk_product_mrp FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_bulk_product_mrp FROM anon;
GRANT EXECUTE ON FUNCTION public.update_bulk_product_mrp TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_bulk_product_mrp TO service_role;

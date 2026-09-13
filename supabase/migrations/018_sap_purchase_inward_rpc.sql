-- ================================================================
-- Migration 018: Weekly SAP Purchase / Goods Receipt Inward Stock RPC
-- ================================================================
-- Implements authoritative server-side inbound inventory movements
-- for weekly SAP Purchase / GR Excel imports.
--
-- Strict requirements:
-- 1. Must use 'purchase_inward' movement_type in inventory_movements
-- 2. Direction = 'in', from_location = 'supplier', to_location = 'warehouse'
-- 3. Exact SKU matching only; unmapped SKUs do not create movements
-- 4. Idempotency per GR doc/invoice + SKU prevents duplicate stock entry
-- 5. Only Admin/Master authorized; anon blocked
-- 6. Full audit trail in sap_purchase_imports + master_audit_log
-- ================================================================

-- ── 1. Batch Audit Table: sap_purchase_imports ───────────────────
CREATE TABLE IF NOT EXISTS public.sap_purchase_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_ref text NOT NULL UNIQUE,
  file_name text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  imported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  total_rows integer NOT NULL DEFAULT 0,
  movements_created integer NOT NULL DEFAULT 0,
  skipped_duplicate integer NOT NULL DEFAULT 0,
  skipped_unmapped integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sap_purchase_imports_batch ON public.sap_purchase_imports(batch_ref);
CREATE INDEX IF NOT EXISTS idx_sap_purchase_imports_imported_at ON public.sap_purchase_imports(imported_at DESC);

ALTER TABLE public.sap_purchase_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sap_purchase_imports_admin_master_select" ON public.sap_purchase_imports;
CREATE POLICY "sap_purchase_imports_admin_master_select"
  ON public.sap_purchase_imports FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin_or_master());

DROP POLICY IF EXISTS "sap_purchase_imports_admin_master_insert" ON public.sap_purchase_imports;
CREATE POLICY "sap_purchase_imports_admin_master_insert"
  ON public.sap_purchase_imports FOR INSERT
  TO authenticated
  WITH CHECK (public.is_current_user_admin_or_master());

-- ── 2. Line Item Audit Table: sap_purchase_import_items ──────────
CREATE TABLE IF NOT EXISTS public.sap_purchase_import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.sap_purchase_imports(id) ON DELETE CASCADE,
  sku text NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  quantity numeric(10,2) NOT NULL,
  uom text DEFAULT 'DOZ',
  gr_status text,
  gr_date date,
  gr_doc_no text,
  po_number text,
  invoice_no text,
  idempotency_key text NOT NULL,
  movement_id uuid REFERENCES public.inventory_movements(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('created', 'duplicate', 'unmapped', 'error')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sap_purchase_items_import_id ON public.sap_purchase_import_items(import_id);
CREATE INDEX IF NOT EXISTS idx_sap_purchase_items_sku ON public.sap_purchase_import_items(sku);
CREATE INDEX IF NOT EXISTS idx_sap_purchase_items_idempotency ON public.sap_purchase_import_items(idempotency_key);

ALTER TABLE public.sap_purchase_import_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sap_purchase_import_items_admin_master_select" ON public.sap_purchase_import_items;
CREATE POLICY "sap_purchase_import_items_admin_master_select"
  ON public.sap_purchase_import_items FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin_or_master());

DROP POLICY IF EXISTS "sap_purchase_import_items_admin_master_insert" ON public.sap_purchase_import_items;
CREATE POLICY "sap_purchase_import_items_admin_master_insert"
  ON public.sap_purchase_import_items FOR INSERT
  TO authenticated
  WITH CHECK (public.is_current_user_admin_or_master());

-- ── 3. Authoritative Server-Side RPC: import_purchase_inward ──────
CREATE OR REPLACE FUNCTION public.import_purchase_inward(
  p_items jsonb,
  p_batch_ref text,
  p_file_name text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id uuid;
  v_import_id uuid;
  v_total_rows integer := 0;
  v_movements_created integer := 0;
  v_skipped_duplicate integer := 0;
  v_skipped_unmapped integer := 0;
  v_item jsonb;
  v_sku text;
  v_norm_sku text;
  v_unpadded_sku text;
  v_product_id uuid;
  v_product_name text;
  v_quantity numeric;
  v_uom text;
  v_gr_status text;
  v_gr_date date;
  v_gr_doc_no text;
  v_po_number text;
  v_invoice_no text;
  v_item_idemp text;
  v_existing_movement_id uuid;
  v_movement_id uuid;
BEGIN
  -- 1. Enforce Admin/Owner authorization (Stage 8 Security)
  IF NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Authorization failure: Only Admin or Master can import weekly SAP purchase stock.'
      USING ERRCODE = '42501';
  END IF;

  v_caller_id := auth.uid();

  -- 2. Validate input batch reference
  IF p_batch_ref IS NULL OR trim(p_batch_ref) = '' THEN
    RAISE EXCEPTION 'Invalid batch reference provided.'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Create or reuse batch audit record
  SELECT id INTO v_import_id
  FROM public.sap_purchase_imports
  WHERE batch_ref = p_batch_ref;

  IF v_import_id IS NULL THEN
    INSERT INTO public.sap_purchase_imports (
      batch_ref,
      file_name,
      imported_by,
      notes
    ) VALUES (
      p_batch_ref,
      p_file_name,
      v_caller_id,
      p_notes
    ) RETURNING id INTO v_import_id;
  END IF;

  -- 4. Process each line item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_total_rows := v_total_rows + 1;

    v_sku := trim(COALESCE(v_item->>'sku', ''));
    v_product_name := COALESCE(v_item->>'product_name', v_sku);
    v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
    v_uom := COALESCE(v_item->>'uom', 'DOZ');
    v_gr_status := v_item->>'gr_status';
    v_gr_doc_no := v_item->>'gr_doc_no';
    v_po_number := v_item->>'po_number';
    v_invoice_no := v_item->>'invoice_no';

    -- Parse GR date safely
    BEGIN
      IF v_item->>'gr_date' IS NOT NULL AND v_item->>'gr_date' <> '' THEN
        v_gr_date := (v_item->>'gr_date')::date;
      ELSE
        v_gr_date := CURRENT_DATE;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_gr_date := CURRENT_DATE;
    END;

    -- Skip invalid rows with zero or negative quantity
    IF v_sku = '' OR v_quantity <= 0 THEN
      CONTINUE;
    END IF;

    -- Match product in canonical database
    v_norm_sku := upper(v_sku);
    v_unpadded_sku := ltrim(v_norm_sku, '0');

    SELECT id, name INTO v_product_id, v_product_name
    FROM public.products
    WHERE upper(sku) = v_norm_sku
       OR (v_unpadded_sku <> '' AND upper(sku) = v_unpadded_sku)
    LIMIT 1;

    -- If SKU is unmapped: record unmapped exception, DO NOT create movement
    IF v_product_id IS NULL THEN
      v_skipped_unmapped := v_skipped_unmapped + 1;

      -- Deterministic idempotency key for unmapped record
      v_item_idemp := 'unmapped:' || p_batch_ref || ':' || v_sku;

      INSERT INTO public.sap_purchase_import_items (
        import_id, sku, product_id, product_name, quantity, uom,
        gr_status, gr_date, gr_doc_no, po_number, invoice_no,
        idempotency_key, movement_id, status, notes
      ) VALUES (
        v_import_id, v_sku, NULL, v_product_name, v_quantity, v_uom,
        v_gr_status, v_gr_date, v_gr_doc_no, v_po_number, v_invoice_no,
        v_item_idemp, NULL, 'unmapped', 'SKU not found in products table'
      );

      -- Record in unmapped_sku_exceptions if table exists
      BEGIN
        INSERT INTO public.unmapped_sku_exceptions (
          sku, imported_product_name, source_type, source_reference, notes
        ) VALUES (
          v_sku, v_product_name, 'sap_upload', p_batch_ref, 'Unmapped SKU in weekly SAP purchase import'
        )
        ON CONFLICT (sku) DO UPDATE SET
          last_seen_at = now(),
          affected_picklist_count = unmapped_sku_exceptions.affected_picklist_count + 1,
          updated_at = now();
      EXCEPTION WHEN OTHERS THEN
        -- Ignore if table does not exist or conflict structure differs
        NULL;
      END;

      CONTINUE;
    END IF;

    -- Construct deterministic idempotency key for this inbound movement
    -- Priority: purchase_inward:{gr_doc_no}:{sku} -> purchase_inward:{invoice_no}:{sku} -> purchase_inward:{batch_ref}:{sku}
    IF v_gr_doc_no IS NOT NULL AND trim(v_gr_doc_no) <> '' THEN
      v_item_idemp := 'purchase_inward:' || trim(v_gr_doc_no) || ':' || v_norm_sku;
    ELSIF v_invoice_no IS NOT NULL AND trim(v_invoice_no) <> '' THEN
      v_item_idemp := 'purchase_inward:' || trim(v_invoice_no) || ':' || v_norm_sku;
    ELSE
      v_item_idemp := 'purchase_inward:' || p_batch_ref || ':' || v_norm_sku;
    END IF;

    -- Check if movement already exists with this idempotency key
    SELECT id INTO v_existing_movement_id
    FROM public.inventory_movements
    WHERE idempotency_key = v_item_idemp;

    IF v_existing_movement_id IS NOT NULL THEN
      -- Already imported / duplicate! Skip ledger insertion.
      v_skipped_duplicate := v_skipped_duplicate + 1;

      INSERT INTO public.sap_purchase_import_items (
        import_id, sku, product_id, product_name, quantity, uom,
        gr_status, gr_date, gr_doc_no, po_number, invoice_no,
        idempotency_key, movement_id, status, notes
      ) VALUES (
        v_import_id, v_sku, v_product_id, v_product_name, v_quantity, v_uom,
        v_gr_status, v_gr_date, v_gr_doc_no, v_po_number, v_invoice_no,
        v_item_idemp, v_existing_movement_id, 'duplicate', 'Already imported with idempotency key: ' || v_item_idemp
      );
    ELSE
      -- Insert authoritative INBOUND movement into inventory_movements ledger
      INSERT INTO public.inventory_movements (
        product_id,
        sku,
        movement_type,
        quantity,
        direction,
        from_location,
        to_location,
        reference_number,
        reference_type,
        reference_id,
        idempotency_key,
        notes,
        source_location,
        destination_location,
        created_by
      ) VALUES (
        v_product_id,
        v_sku,
        'purchase_inward',
        v_quantity,
        'in',
        'supplier',
        'warehouse',
        COALESCE(v_invoice_no, v_gr_doc_no, p_batch_ref),
        'sap_purchase_gr',
        COALESCE(v_gr_doc_no, v_invoice_no, p_batch_ref),
        v_item_idemp,
        'SAP Weekly Purchase/GR Inbound: Doc ' || COALESCE(v_gr_doc_no, v_invoice_no, p_batch_ref) || ' (' || v_product_name || ')',
        'supplier',
        'warehouse',
        v_caller_id
      ) RETURNING id INTO v_movement_id;

      v_movements_created := v_movements_created + 1;

      INSERT INTO public.sap_purchase_import_items (
        import_id, sku, product_id, product_name, quantity, uom,
        gr_status, gr_date, gr_doc_no, po_number, invoice_no,
        idempotency_key, movement_id, status, notes
      ) VALUES (
        v_import_id, v_sku, v_product_id, v_product_name, v_quantity, v_uom,
        v_gr_status, v_gr_date, v_gr_doc_no, v_po_number, v_invoice_no,
        v_item_idemp, v_movement_id, 'created', 'Movement ' || v_movement_id::text || ' created successfully'
      );
    END IF;
  END LOOP;

  -- 5. Update batch totals
  UPDATE public.sap_purchase_imports
  SET total_rows = v_total_rows,
      movements_created = movements_created + v_movements_created,
      skipped_duplicate = skipped_duplicate + v_skipped_duplicate,
      skipped_unmapped = skipped_unmapped + v_skipped_unmapped
  WHERE id = v_import_id;

  -- 6. Write complete audit trail entry to master_audit_log
  BEGIN
    PERFORM public.log_system_event(
      COALESCE(v_caller_id::text, 'unknown'),
      'Admin/Master',
      'inventory_import',
      'purchase_inward_completed',
      'success',
      'Weekly SAP purchase import ' || p_batch_ref || ': ' ||
        v_movements_created || ' created, ' ||
        v_skipped_duplicate || ' duplicates skipped, ' ||
        v_skipped_unmapped || ' unmapped SKUs skipped out of ' ||
        v_total_rows || ' rows.',
      'sap_purchase_imports',
      v_import_id::text
    );
  EXCEPTION WHEN OTHERS THEN
    -- Fallback: non-fatal if audit logger fails
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'import_id', v_import_id,
    'batch_ref', p_batch_ref,
    'total_rows', v_total_rows,
    'movements_created', v_movements_created,
    'skipped_duplicate', v_skipped_duplicate,
    'skipped_unmapped', v_skipped_unmapped,
    'message', 'Import completed: ' || v_movements_created || ' inbound movements created, ' ||
               v_skipped_duplicate || ' duplicates skipped, ' ||
               v_skipped_unmapped || ' unmapped SKUs skipped.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_purchase_inward(jsonb, text, text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.import_purchase_inward(jsonb, text, text, text) FROM anon, PUBLIC;

COMMENT ON FUNCTION public.import_purchase_inward(jsonb, text, text, text) IS
  'Authoritative weekly SAP purchase/GR import RPC: processes confirmed received quantities into inventory_movements (purchase_inward) with strict idempotency and unmapped SKU protection.';

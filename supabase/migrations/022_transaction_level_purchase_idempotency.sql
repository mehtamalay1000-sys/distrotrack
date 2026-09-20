-- ==============================================================================
-- Migration 022: Transaction-Level SAP Purchase Import Idempotency & Safe Recovery
--
-- 1. Adds item_no column to public.sap_purchase_import_items.
-- 2. Upgrades public.import_purchase_inward RPC:
--    - Replaces naive GR+SKU key with transaction-level key:
--      purchase_inward:{docRef}:{itemNo}:{normSku}
--    - Preserves distinct SAP line items on the same GR document / invoice.
--    - Strictly maintains idempotency upon repeat import of the same file.
-- 3. Creates public.recover_missing_sap_purchase_items RPC:
--    - Idempotently recovers skipped SAP purchase transaction lines without
--      resetting, altering, or duplicating existing inventory movements.
-- 4. RLS & Security: Restricts execution strictly to authenticated Admin and Master.
-- ==============================================================================

-- ── 1. Schema Enhancement ────────────────────────────────────────────────────
ALTER TABLE public.sap_purchase_import_items
  ADD COLUMN IF NOT EXISTS item_no text;

CREATE INDEX IF NOT EXISTS idx_sap_purchase_items_item_no
  ON public.sap_purchase_import_items(item_no);

-- ── 2. Upgraded Inbound RPC: import_purchase_inward ──────────────────────────
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
  v_item_no text;
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
    v_gr_doc_no := trim(COALESCE(v_item->>'gr_doc_no', ''));
    v_po_number := trim(COALESCE(v_item->>'po_number', ''));
    v_invoice_no := trim(COALESCE(v_item->>'invoice_no', ''));
    v_item_no := trim(COALESCE(v_item->>'item_no', ''));
    v_item_idemp := trim(COALESCE(v_item->>'idempotency_key', ''));

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

    -- If SKU is unmapped: record unmapped audit entry, DO NOT create movement
    IF v_product_id IS NULL THEN
      v_skipped_unmapped := v_skipped_unmapped + 1;

      IF v_item_idemp = '' THEN
        v_item_idemp := 'unmapped:' || p_batch_ref || ':' || COALESCE(NULLIF(v_item_no, ''), 'row') || ':' || v_sku;
      END IF;

      INSERT INTO public.sap_purchase_import_items (
        import_id, sku, product_id, product_name, quantity, uom,
        gr_status, gr_date, gr_doc_no, po_number, invoice_no, item_no,
        idempotency_key, movement_id, status, notes
      ) VALUES (
        v_import_id, v_sku, NULL, v_product_name, v_quantity, v_uom,
        v_gr_status, v_gr_date, v_gr_doc_no, v_po_number, v_invoice_no, v_item_no,
        v_item_idemp, NULL, 'unmapped', 'SKU not found in products table'
      );

      CONTINUE;
    END IF;

    -- 5. Construct or validate transaction-level idempotency key
    -- Format: purchase_inward:{docRef}:{itemRef}:{normSku}
    IF v_item_idemp = '' THEN
      IF v_item_no <> '' THEN
        IF v_gr_doc_no <> '' THEN
          v_item_idemp := 'purchase_inward:' || v_gr_doc_no || ':' || v_item_no || ':' || v_norm_sku;
        ELSIF v_invoice_no <> '' THEN
          v_item_idemp := 'purchase_inward:' || v_invoice_no || ':' || v_item_no || ':' || v_norm_sku;
        ELSE
          v_item_idemp := 'purchase_inward:' || p_batch_ref || ':' || v_item_no || ':' || v_norm_sku;
        END IF;
      ELSE
        -- Fallback if item_no is not provided: include invoice + batch
        v_item_idemp := 'purchase_inward:' || COALESCE(NULLIF(v_gr_doc_no, ''), p_batch_ref) || ':' ||
                        COALESCE(NULLIF(v_invoice_no, ''), '0') || ':' || v_norm_sku;
      END IF;
    END IF;

    -- Check if movement already exists with this transaction-level idempotency key
    SELECT id INTO v_existing_movement_id
    FROM public.inventory_movements
    WHERE idempotency_key = v_item_idemp;

    IF v_existing_movement_id IS NOT NULL THEN
      -- Already imported / duplicate! Skip ledger insertion.
      v_skipped_duplicate := v_skipped_duplicate + 1;

      INSERT INTO public.sap_purchase_import_items (
        import_id, sku, product_id, product_name, quantity, uom,
        gr_status, gr_date, gr_doc_no, po_number, invoice_no, item_no,
        idempotency_key, movement_id, status, notes
      ) VALUES (
        v_import_id, v_sku, v_product_id, v_product_name, v_quantity, v_uom,
        v_gr_status, v_gr_date, v_gr_doc_no, v_po_number, v_invoice_no, v_item_no,
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
        occurred_at,
        created_by
      ) VALUES (
        v_product_id,
        v_norm_sku,
        'purchase_inward',
        v_quantity,
        'in',
        'supplier',
        'warehouse',
        COALESCE(NULLIF(v_gr_doc_no, ''), NULLIF(v_invoice_no, ''), p_batch_ref),
        'sap_purchase_import',
        v_import_id,
        v_item_idemp,
        'SAP Inbound Purchase: GR ' || COALESCE(v_gr_doc_no, 'N/A') || ' Item ' || COALESCE(v_item_no, 'N/A') || ' Inv ' || COALESCE(v_invoice_no, 'N/A'),
        'warehouse',
        v_gr_date::timestamptz,
        v_caller_id
      ) RETURNING id INTO v_movement_id;

      v_movements_created := v_movements_created + 1;

      -- Audit entry for created movement
      INSERT INTO public.sap_purchase_import_items (
        import_id, sku, product_id, product_name, quantity, uom,
        gr_status, gr_date, gr_doc_no, po_number, invoice_no, item_no,
        idempotency_key, movement_id, status, notes
      ) VALUES (
        v_import_id, v_sku, v_product_id, v_product_name, v_quantity, v_uom,
        v_gr_status, v_gr_date, v_gr_doc_no, v_po_number, v_invoice_no, v_item_no,
        v_item_idemp, v_movement_id, 'created', 'Recorded in authoritative ledger'
      );
    END IF;
  END LOOP;

  -- 6. Update batch audit totals
  UPDATE public.sap_purchase_imports SET
    total_rows = v_total_rows,
    movements_created = movements_created + v_movements_created,
    skipped_duplicate = skipped_duplicate + v_skipped_duplicate,
    skipped_unmapped = skipped_unmapped + v_skipped_unmapped
  WHERE id = v_import_id;

  RETURN jsonb_build_object(
    'success', true,
    'import_id', v_import_id,
    'batch_ref', p_batch_ref,
    'total_rows', v_total_rows,
    'movements_created', v_movements_created,
    'skipped_duplicate', v_skipped_duplicate,
    'skipped_unmapped', v_skipped_unmapped,
    'message', format('SAP Purchase Inward: %s movements created, %s duplicate skipped, %s unmapped skipped.',
      v_movements_created, v_skipped_duplicate, v_skipped_unmapped)
  );
END;
$$;

-- ── 3. Safe Idempotent Recovery RPC: recover_missing_sap_purchase_items ──────
CREATE OR REPLACE FUNCTION public.recover_missing_sap_purchase_items(
  p_items jsonb,
  p_batch_ref text DEFAULT 'RECOVERY_BATCH',
  p_notes text DEFAULT 'Idempotent recovery of legitimate SAP purchase lines'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_item jsonb;
  v_sku text;
  v_norm_sku text;
  v_product_id uuid;
  v_product_name text;
  v_quantity numeric;
  v_uom text;
  v_gr_doc_no text;
  v_invoice_no text;
  v_item_no text;
  v_item_idemp text;
  v_gr_date date;
  v_recovered_count integer := 0;
  v_total_recovered_qty numeric := 0;
  v_existing_id uuid;
  v_new_mov_id uuid;
BEGIN
  -- Enforce Admin / Master authorization
  IF NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Authorization failure: Only Admin or Master can execute purchase transaction recovery.'
      USING ERRCODE = '42501';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_sku := trim(COALESCE(v_item->>'sku', ''));
    v_norm_sku := upper(v_sku);
    v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
    v_uom := COALESCE(v_item->>'uom', 'DOZ');
    v_gr_doc_no := trim(COALESCE(v_item->>'gr_doc_no', ''));
    v_invoice_no := trim(COALESCE(v_item->>'invoice_no', ''));
    v_item_no := trim(COALESCE(v_item->>'item_no', ''));
    v_item_idemp := trim(COALESCE(v_item->>'idempotency_key', ''));

    IF v_sku = '' OR v_quantity <= 0 THEN
      CONTINUE;
    END IF;

    -- Determine transaction idempotency key
    IF v_item_idemp = '' THEN
      v_item_idemp := 'purchase_inward:' || v_gr_doc_no || ':' || v_item_no || ':' || v_norm_sku;
    END IF;

    -- Strict check: ONLY insert if this transaction key does NOT already exist in ledger
    SELECT id INTO v_existing_id
    FROM public.inventory_movements
    WHERE idempotency_key = v_item_idemp;

    IF v_existing_id IS NULL THEN
      -- Resolve product id
      SELECT id, name INTO v_product_id, v_product_name
      FROM public.products
      WHERE upper(sku) = v_norm_sku
      LIMIT 1;

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
        idempotency_key,
        notes,
        source_location,
        occurred_at
      ) VALUES (
        v_product_id,
        v_norm_sku,
        'purchase_inward',
        v_quantity,
        'in',
        'supplier',
        'warehouse',
        v_gr_doc_no,
        'sap_purchase_recovery',
        v_item_idemp,
        'Recovered SAP Inbound: GR ' || v_gr_doc_no || ' Item ' || v_item_no || ' Inv ' || v_invoice_no,
        'warehouse',
        v_gr_date::timestamptz
      ) RETURNING id INTO v_new_mov_id;

      v_recovered_count := v_recovered_count + 1;
      v_total_recovered_qty := v_total_recovered_qty + v_quantity;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'recovered_count', v_recovered_count,
    'total_recovered_qty', v_total_recovered_qty,
    'message', format('Recovered %s missing inbound movements (%s %s).', v_recovered_count, v_total_recovered_qty, 'DOZ')
  );
END;
$$;

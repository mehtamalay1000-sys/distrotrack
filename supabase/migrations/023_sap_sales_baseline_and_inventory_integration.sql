-- ==============================================================================
-- Migration 023: Go-Live SAP Sales Baseline Import & Inventory Integration
--
-- 1. Adds 'sap_sales_baseline' to public.inventory_movements movement_type CHECK constraint.
--    This establishes the authoritative ledger movement for pre-go-live SAP sales stock-out.
-- 2. Creates public.sap_sales_imports:
--    Authoritative batch audit ledger for SAP sales/billing imports.
-- 3. Creates public.sap_sales_import_items:
--    Transaction-level ledger preserving invoice number, line sequence, customer,
--    exact commercial pricing, cancellation flag, and idempotency key.
-- 4. Creates public.import_sap_sales_baseline RPC:
--    Atomic, idempotent, server-side import RPC enforcing Admin/Master role authorization,
--    preventing double-deduction on re-import, and creating append-only movements.
-- 5. Enables strict Row Level Security (Admin/Master only; anon blocked).
-- ==============================================================================

-- ── 1. Update inventory_movements CHECK Constraint ───────────────────────────
DO $$
BEGIN
  -- Safely drop old check constraint if present
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_movements_movement_type_check'
  ) THEN
    ALTER TABLE public.inventory_movements
      DROP CONSTRAINT inventory_movements_movement_type_check;
  END IF;

  -- Add updated check constraint including 'sap_sales_baseline'
  ALTER TABLE public.inventory_movements
    ADD CONSTRAINT inventory_movements_movement_type_check CHECK (movement_type IN (
      'opening_balance',
      'purchase_inward',
      'sap_sales_baseline',
      'route_load',
      'delivery_fulfilled',
      'route_return',
      'damaged_transit',
      'damaged_warehouse',
      'inventory_adjustment'
    ));

  RAISE NOTICE 'Migration 023: Added sap_sales_baseline to inventory_movements constraint.';
END $$;

-- ── 2. Batch Audit Table: sap_sales_imports ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sap_sales_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_ref text NOT NULL UNIQUE,
  file_name text,
  cutoff_date date NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  imported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  total_rows integer NOT NULL DEFAULT 0,
  movements_created integer NOT NULL DEFAULT 0,
  skipped_duplicate integer NOT NULL DEFAULT 0,
  skipped_unmapped integer NOT NULL DEFAULT 0,
  total_quantity numeric(10,2) NOT NULL DEFAULT 0,
  total_net_amount numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sap_sales_imports_batch ON public.sap_sales_imports(batch_ref);
CREATE INDEX IF NOT EXISTS idx_sap_sales_imports_cutoff ON public.sap_sales_imports(cutoff_date);
CREATE INDEX IF NOT EXISTS idx_sap_sales_imports_imported_at ON public.sap_sales_imports(imported_at DESC);

ALTER TABLE public.sap_sales_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sap_sales_imports_admin_master_select" ON public.sap_sales_imports;
CREATE POLICY "sap_sales_imports_admin_master_select"
  ON public.sap_sales_imports FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin_or_master());

DROP POLICY IF EXISTS "sap_sales_imports_admin_master_all" ON public.sap_sales_imports;
CREATE POLICY "sap_sales_imports_admin_master_all"
  ON public.sap_sales_imports FOR ALL
  TO authenticated
  USING (public.is_current_user_admin_or_master())
  WITH CHECK (public.is_current_user_admin_or_master());

-- ── 3. Line Item Table: sap_sales_import_items ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.sap_sales_import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.sap_sales_imports(id) ON DELETE CASCADE,
  invoice_no text NOT NULL,
  invoice_date date,
  item_seq integer NOT NULL DEFAULT 10,
  sku text NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  cust_code text,
  cust_name text,
  quantity numeric(10,2) NOT NULL,
  uom text DEFAULT 'EA',
  rate numeric(10,2),
  gross_val numeric(12,2),
  net_val numeric(12,2),
  is_cancellation boolean NOT NULL DEFAULT false,
  reference_doc text,
  idempotency_key text NOT NULL UNIQUE,
  movement_id uuid REFERENCES public.inventory_movements(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('created', 'duplicate', 'unmapped', 'error')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sap_sales_items_import_id ON public.sap_sales_import_items(import_id);
CREATE INDEX IF NOT EXISTS idx_sap_sales_items_sku ON public.sap_sales_import_items(sku);
CREATE INDEX IF NOT EXISTS idx_sap_sales_items_invoice ON public.sap_sales_import_items(invoice_no);
CREATE INDEX IF NOT EXISTS idx_sap_sales_items_idempotency ON public.sap_sales_import_items(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_sap_sales_items_cust_code ON public.sap_sales_import_items(cust_code);

ALTER TABLE public.sap_sales_import_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sap_sales_import_items_admin_master_select" ON public.sap_sales_import_items;
CREATE POLICY "sap_sales_import_items_admin_master_select"
  ON public.sap_sales_import_items FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin_or_master());

DROP POLICY IF EXISTS "sap_sales_import_items_admin_master_all" ON public.sap_sales_import_items;
CREATE POLICY "sap_sales_import_items_admin_master_all"
  ON public.sap_sales_import_items FOR ALL
  TO authenticated
  USING (public.is_current_user_admin_or_master())
  WITH CHECK (public.is_current_user_admin_or_master());

-- ── 4. Authoritative Server-Side RPC: import_sap_sales_baseline ──────────────
CREATE OR REPLACE FUNCTION public.import_sap_sales_baseline(
  p_items jsonb,
  p_batch_ref text,
  p_cutoff_date date,
  p_file_name text DEFAULT 'sale.xlsx',
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
  v_total_qty numeric := 0;
  v_total_net numeric := 0;

  v_item jsonb;
  v_sku text;
  v_norm_sku text;
  v_unpadded_sku text;
  v_invoice_no text;
  v_item_seq integer;
  v_product_id uuid;
  v_product_name text;
  v_cust_code text;
  v_cust_name text;
  v_quantity numeric;
  v_uom text;
  v_rate numeric;
  v_gross numeric;
  v_net numeric;
  v_is_cancel boolean;
  v_ref_doc text;
  v_invoice_date date;

  v_item_idemp text;
  v_existing_movement_id uuid;
  v_movement_id uuid;
BEGIN
  -- 1. Security check: Only Admin or Master authorized
  IF NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Authorization failure: Only Admin or Master can import SAP sales baseline.'
      USING ERRCODE = '42501';
  END IF;

  v_caller_id := auth.uid();

  -- 2. Validate parameters
  IF p_batch_ref IS NULL OR trim(p_batch_ref) = '' THEN
    RAISE EXCEPTION 'Invalid batch reference provided.'
      USING ERRCODE = '22023';
  END IF;

  IF p_cutoff_date IS NULL THEN
    RAISE EXCEPTION 'Cutoff / Go-Live Date is required.'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Create or reuse batch audit record
  SELECT id INTO v_import_id
  FROM public.sap_sales_imports
  WHERE batch_ref = p_batch_ref;

  IF v_import_id IS NULL THEN
    INSERT INTO public.sap_sales_imports (
      batch_ref,
      file_name,
      cutoff_date,
      imported_by,
      notes
    ) VALUES (
      p_batch_ref,
      p_file_name,
      p_cutoff_date,
      v_caller_id,
      p_notes
    ) RETURNING id INTO v_import_id;
  END IF;

  -- 4. Process each sales row
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_total_rows := v_total_rows + 1;

    v_sku := trim(COALESCE(v_item->>'sku', ''));
    v_invoice_no := trim(COALESCE(v_item->>'invoice_no', ''));
    v_item_seq := COALESCE((v_item->>'item_seq')::integer, (v_total_rows * 10));
    v_product_name := COALESCE(v_item->>'product_name', v_sku);
    v_cust_code := NULLIF(trim(COALESCE(v_item->>'cust_code', '')), '');
    v_cust_name := NULLIF(trim(COALESCE(v_item->>'cust_name', '')), '');
    v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
    v_uom := COALESCE(v_item->>'uom', 'EA');
    v_rate := (v_item->>'rate')::numeric;
    v_gross := COALESCE((v_item->>'gross_val')::numeric, 0);
    v_net := COALESCE((v_item->>'net_val')::numeric, 0);
    v_is_cancel := COALESCE((v_item->>'is_cancellation')::boolean, false);
    v_ref_doc := NULLIF(trim(COALESCE(v_item->>'reference_doc', '')), '');

    IF v_item->>'invoice_date' IS NOT NULL AND trim(v_item->>'invoice_date') <> '' THEN
      BEGIN
        v_invoice_date := (v_item->>'invoice_date')::date;
      EXCEPTION WHEN OTHERS THEN
        v_invoice_date := p_cutoff_date;
      END;
    ELSE
      v_invoice_date := p_cutoff_date;
    END IF;

    v_total_qty := v_total_qty + v_quantity;
    v_total_net := v_total_net + v_net;

    -- Canonical normalized SKU
    v_norm_sku := upper(v_sku);
    v_unpadded_sku := regexp_replace(v_norm_sku, '^0+', '');
    IF v_unpadded_sku = '' THEN
      v_unpadded_sku := v_norm_sku;
    END IF;

    -- Transaction-level idempotency key:
    -- sales_import:{invoice_no}:{item_seq}:{norm_sku}
    v_item_idemp := 'sales_import:' || v_invoice_no || ':' || v_item_seq || ':' || v_norm_sku;

    -- Lookup product in canonical Product Master
    SELECT id INTO v_product_id
    FROM public.products
    WHERE upper(trim(sku)) = v_norm_sku
       OR regexp_replace(upper(trim(sku)), '^0+', '') = v_unpadded_sku
    LIMIT 1;

    -- If not yet in Product Master, auto-register canonical product
    IF v_product_id IS NULL AND v_norm_sku <> '' THEN
      INSERT INTO public.products (
        sku, name, category, mrp, rate, unit, status, is_sap_master
      ) VALUES (
        v_norm_sku, v_product_name, 'General', COALESCE(v_rate, 50), COALESCE(v_rate, 50), v_uom, 'active', true
      ) RETURNING id INTO v_product_id;
    END IF;

    -- Check if movement already exists under this idempotency key
    SELECT id INTO v_existing_movement_id
    FROM public.inventory_movements
    WHERE idempotency_key = v_item_idemp;

    v_movement_id := v_existing_movement_id;

    IF v_existing_movement_id IS NOT NULL THEN
      -- Already imported: skip movement creation to prevent double-deduction
      v_skipped_duplicate := v_skipped_duplicate + 1;

      INSERT INTO public.sap_sales_import_items (
        import_id, invoice_no, invoice_date, item_seq, sku, product_id, product_name,
        cust_code, cust_name, quantity, uom, rate, gross_val, net_val,
        is_cancellation, reference_doc, idempotency_key, movement_id, status, notes
      ) VALUES (
        v_import_id, v_invoice_no, v_invoice_date, v_item_seq, v_sku, v_product_id, v_product_name,
        v_cust_code, v_cust_name, v_quantity, v_uom, v_rate, v_gross, v_net,
        v_is_cancel, v_ref_doc, v_item_idemp, v_existing_movement_id, 'duplicate',
        'Duplicate transaction: movement already exists in ledger.'
      ) ON CONFLICT (idempotency_key) DO NOTHING;

    ELSIF v_product_id IS NULL THEN
      -- Unmapped product: record item audit but do NOT deduct stock
      v_skipped_unmapped := v_skipped_unmapped + 1;

      INSERT INTO public.sap_sales_import_items (
        import_id, invoice_no, invoice_date, item_seq, sku, product_id, product_name,
        cust_code, cust_name, quantity, uom, rate, gross_val, net_val,
        is_cancellation, reference_doc, idempotency_key, movement_id, status, notes
      ) VALUES (
        v_import_id, v_invoice_no, v_invoice_date, v_item_seq, v_sku, NULL, v_product_name,
        v_cust_code, v_cust_name, v_quantity, v_uom, v_rate, v_gross, v_net,
        v_is_cancel, v_ref_doc, v_item_idemp, NULL, 'unmapped',
        'SKU not found in Product Master. Stock movement skipped until mapped.'
      ) ON CONFLICT (idempotency_key) DO NOTHING;

    ELSIF v_quantity > 0 AND (v_invoice_date <= p_cutoff_date) THEN
      -- Valid baseline sale: create authoritative stock-out movement
      IF v_is_cancel THEN
        -- Tax cancellation / credit note: reverse deduction (inbound return)
        INSERT INTO public.inventory_movements (
          product_id, sku, movement_type, quantity, direction,
          from_location, to_location, reference_number, notes, idempotency_key, occurred_at
        ) VALUES (
          v_product_id, v_sku, 'route_return', abs(v_quantity), 'in',
          'customer', 'warehouse', v_invoice_no,
          'SAP Sales Cancellation: ' || COALESCE(v_cust_name, 'Credit Note'),
          v_item_idemp, v_invoice_date::timestamptz
        ) RETURNING id INTO v_movement_id;
      ELSE
        -- Standard pre-go-live sales stock-out
        INSERT INTO public.inventory_movements (
          product_id, sku, movement_type, quantity, direction,
          from_location, to_location, reference_number, notes, idempotency_key, occurred_at
        ) VALUES (
          v_product_id, v_sku, 'sap_sales_baseline', abs(v_quantity), 'out',
          'warehouse', 'customer', v_invoice_no,
          'SAP Baseline Sale: ' || COALESCE(v_cust_name, 'Pre-Go-Live Sales'),
          v_item_idemp, v_invoice_date::timestamptz
        ) RETURNING id INTO v_movement_id;
      END IF;

      v_movements_created := v_movements_created + 1;

      INSERT INTO public.sap_sales_import_items (
        import_id, invoice_no, invoice_date, item_seq, sku, product_id, product_name,
        cust_code, cust_name, quantity, uom, rate, gross_val, net_val,
        is_cancellation, reference_doc, idempotency_key, movement_id, status, notes
      ) VALUES (
        v_import_id, v_invoice_no, v_invoice_date, v_item_seq, v_sku, v_product_id, v_product_name,
        v_cust_code, v_cust_name, v_quantity, v_uom, v_rate, v_gross, v_net,
        v_is_cancel, v_ref_doc, v_item_idemp, v_movement_id, 'created',
        CASE WHEN v_is_cancel THEN 'Cancellation recorded as inventory return.' ELSE 'Baseline stock-out movement created.' END
      ) ON CONFLICT (idempotency_key) DO UPDATE
        SET movement_id = EXCLUDED.movement_id, status = EXCLUDED.status;

    ELSE
      -- Row past cutoff date or 0 quantity
      INSERT INTO public.sap_sales_import_items (
        import_id, invoice_no, invoice_date, item_seq, sku, product_id, product_name,
        cust_code, cust_name, quantity, uom, rate, gross_val, net_val,
        is_cancellation, reference_doc, idempotency_key, movement_id, status, notes
      ) VALUES (
        v_import_id, v_invoice_no, v_invoice_date, v_item_seq, v_sku, v_product_id, v_product_name,
        v_cust_code, v_cust_name, v_quantity, v_uom, v_rate, v_gross, v_net,
        v_is_cancel, v_ref_doc, v_item_idemp, NULL, 'created',
        'Recorded without inventory movement (zero quantity or past cutoff).'
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

  END LOOP;

  -- 5. Update summary statistics on batch
  UPDATE public.sap_sales_imports
  SET
    total_rows = v_total_rows,
    movements_created = v_movements_created,
    skipped_duplicate = v_skipped_duplicate,
    skipped_unmapped = v_skipped_unmapped,
    total_quantity = v_total_qty,
    total_net_amount = v_total_net
  WHERE id = v_import_id;

  RETURN jsonb_build_object(
    'import_id', v_import_id,
    'batch_ref', p_batch_ref,
    'total_rows', v_total_rows,
    'movements_created', v_movements_created,
    'skipped_duplicate', v_skipped_duplicate,
    'skipped_unmapped', v_skipped_unmapped,
    'total_quantity', v_total_qty,
    'total_net_amount', v_total_net
  );
END;
$$;

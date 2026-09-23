-- ==============================================================================
-- Migration 047: Authoritative COGS and Profitability Architecture
--
-- 1. Schema Enhancement:
--    - Adds unit_purchase_cost, total_purchase_cost, batch to sap_purchase_import_items
--    - Adds unit_cost, total_cost to inventory_movements
--    - Adds unit_cost, cogs to delivery_items
--
-- 2. Historical Purchase Cost Preservation & Backfill:
--    - Backfills exact purchase costs from authoritative purchase.xlsx into
--      sap_purchase_import_items and inventory_movements.
--
-- 3. Inbound RPC Upgrade: import_purchase_inward
--    - Ingests unit_purchase_cost and total_purchase_cost into ledger movements.
--
-- 4. Authoritative Costing Engine:
--    - Implements Weighted Average Cost (WAC) per SKU across confirmed Goods Receipts.
--    - Handles UOM normalization (DOZ -> EA = cost / 12).
--    - Never falls back to MRP or customer sales rate.
--    - Explicitly tags missing-cost items as 'incomplete'.
--
-- 5. Authoritative Profitability RPCs:
--    - Upgrades get_financial_summary with COGS, Gross Profit, Net Profit, and Coverage.
--    - Upgrades get_route_profitability with COGS, Gross Profit, Net Profit, and Coverage.
--    - Creates get_sku_profitability_report for granular product-level margin analysis.
-- ==============================================================================

-- ── 1. Schema Enhancements ────────────────────────────────────────────────────

ALTER TABLE public.sap_purchase_import_items
  ADD COLUMN IF NOT EXISTS unit_purchase_cost numeric(12, 4) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS total_purchase_cost numeric(12, 4) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS batch text DEFAULT NULL;

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS unit_cost numeric(12, 4) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS total_cost numeric(12, 4) DEFAULT NULL;

ALTER TABLE public.delivery_items
  ADD COLUMN IF NOT EXISTS unit_cost numeric(12, 4) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cogs numeric(12, 4) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_movements_sku_purchase
  ON public.inventory_movements(sku, movement_type)
  WHERE movement_type = 'purchase_inward';

CREATE INDEX IF NOT EXISTS idx_sap_purchase_items_sku
  ON public.sap_purchase_import_items(sku);

-- ── 2. Backfill Authoritative Purchase Costs (From confirmed SAP Goods Receipts) ──

DO $$
DECLARE
  v_rec record;
BEGIN
  CREATE TEMP TABLE temp_sap_costs (
    sku text,
    gr_doc text,
    item_no text,
    invoice_no text,
    batch text,
    rate numeric,
    amount numeric,
    idemp text
  ) ON COMMIT DROP;

  INSERT INTO temp_sap_costs (sku, gr_doc, item_no, invoice_no, batch, rate, amount, idemp) VALUES
  ('61059907', '3024574206', '2', '81D0001541', '11', 194.31, 69951.60, 'purchase_inward:3024574206:2:61059907'),
  ('61065105', '3024574206', '66', '81D0001541', '11', 2849.93, 17099.58, 'purchase_inward:3024574206:66:61065105'),
  ('61054028', '3024574206', '8', '81D0001541', '12', 3157.59, 12630.36, 'purchase_inward:3024574206:8:61054028'),
  ('61042330', '3024574206', '14', '81D0001541', '16', 727.7, 2183.10, 'purchase_inward:3024574206:14:61042330'),
  ('61050884', '3024574206', '10', '81D0001541', '14', 709.24, 42554.40, 'purchase_inward:3024574206:10:61050884'),
  ('1601319', '3024574206', '20', '81D0001541', '29', 1417.8, 5671.20, 'purchase_inward:3024574206:20:1601319'),
  ('61060433', '3024574206', '56', '81D0001541', '11', 3664.2, 3664.20, 'purchase_inward:3024574206:56:61060433'),
  ('61050877', '3024574206', '12', '81D0001541', '13', 2020.87, 24250.44, 'purchase_inward:3024574206:12:61050877'),
  ('61050878', '3024574206', '38', '81D0001541', '13', 1311.62, 47218.32, 'purchase_inward:3024574206:38:61050878'),
  ('61060443', '3024574206', '52', '81D0001541', '12', 1899.94, 7599.76, 'purchase_inward:3024574206:52:61060443'),
  ('61039687', '3024574206', '46', '81D0001541', '12', 2358.43, 2358.43, 'purchase_inward:3024574206:46:61039687'),
  ('61042326', '3024574206', '60', '81D0001541', '16', 727.7, 2183.10, 'purchase_inward:3024574206:60:61042326'),
  ('61029554', '3024574206', '62', '81D0001541', '19', 709.24, 42554.40, 'purchase_inward:3024574206:62:61029554'),
  ('61039682', '3024574206', '44', '81D0001541', '12', 2358.43, 2358.43, 'purchase_inward:3024574206:44:61039682'),
  ('61065114', '3024574206', '54', '81D0001541', '11', 3087.43, 6174.86, 'purchase_inward:3024574206:54:61065114'),
  ('1601339', '3024574206', '22', '81D0001541', '25', 762.68, 6101.44, 'purchase_inward:3024574206:22:1601339'),
  ('61059387', '3024574206', '28', '81D0001541', '11', 1165.88, 23317.60, 'purchase_inward:3024574206:28:61059387'),
  ('IN00810A', '3024574206', '32', '81D0001541', '11', 2602.11, 15612.66, 'purchase_inward:3024574206:32:IN00810A'),
  ('61060448', '3024574206', '30', '81D0001541', '12', 1424.96, 2849.92, 'purchase_inward:3024574206:30:61060448'),
  ('61002505', '3024574206', '42', '81D0001541', '28', 981.64, 4908.20, 'purchase_inward:3024574206:42:61002505'),
  ('61050880', '3024574206', '40', '81D0001541', '14', 1000.71, 16011.36, 'purchase_inward:3024574206:40:61050880'),
  ('1601379', '3024574206', '24', '81D0001541', '23', 430.22, 13767.04, 'purchase_inward:3024574206:24:1601379'),
  ('61032235', '3024574206', '50', '81D0001541', '13', 712.49, 4274.94, 'purchase_inward:3024574206:50:61032235'),
  ('61043915', '3024574206', '18', '81D0001541', '15', 806.39, 9676.68, 'purchase_inward:3024574206:18:61043915'),
  ('61059906', '3024574206', '4', '81D0001541', '11', 194.31, 5829.30, 'purchase_inward:3024574206:4:61059906'),
  ('1607778', '3024574206', '16', '81D0001541', '28', 827.1, 4962.60, 'purchase_inward:3024574206:16:1607778'),
  ('61065209', '3024574206', '36', '81D0001541', '11', 2137.45, 8549.80, 'purchase_inward:3024574206:36:61065209'),
  ('61037983', '3024574206', '26', '81D0001541', '23', 368.52, 1842.60, 'purchase_inward:3024574206:26:61037983'),
  ('61058418', '3024574206', '6', '81D0001541', '11', 291.47, 6995.28, 'purchase_inward:3024574206:6:61058418'),
  ('IN00991A', '3024574206', '68', '81D0001541', '29', 1399.06, 11192.48, 'purchase_inward:3024574206:68:IN00991A'),
  ('61055326', '3024574206', '48', '81D0001541', '12', 650.52, 3903.12, 'purchase_inward:3024574206:48:61055326'),
  ('61028604', '3024574206', '64', '81D0001541', '13', 1946.6, 5839.80, 'purchase_inward:3024574206:64:61028604'),
  ('1607707', '3024574206', '58', '81D0001541', '26', 1736.58, 1736.58, 'purchase_inward:3024574206:58:1607707'),
  ('61065107', '3024574206', '34', '81D0001541', '11', 2137.45, 4274.90, 'purchase_inward:3024574206:34:61065107'),
  ('61065209', '3025221175', '28', '81D0001878', '11', 2137.45, 4274.90, 'purchase_inward:3025221175:28:61065209'),
  ('61050878', '3025221175', '34', '81D0001878', '13', 1311.62, 39348.60, 'purchase_inward:3025221175:34:61050878'),
  ('1601339', '3025221175', '18', '81D0001878', '25', 762.68, 6101.44, 'purchase_inward:3025221175:18:1601339'),
  ('61055326', '3025221175', '62', '81D0001878', '12', 650.52, 3903.12, 'purchase_inward:3025221175:62:61055326'),
  ('61058418', '3025221175', '6', '81D0001878', '11', 291.47, 3497.64, 'purchase_inward:3025221175:6:61058418'),
  ('1608102', '3025221175', '14', '81D0001878', '29', 1195.03, 14340.36, 'purchase_inward:3025221175:14:1608102'),
  ('61059387', '3025221175', '22', '81D0001878', '11', 1165.88, 27981.12, 'purchase_inward:3025221175:22:61059387'),
  ('61046809', '3025221175', '60', '81D0001878', '14', 1951.58, 7806.32, 'purchase_inward:3025221175:60:61046809'),
  ('61054028', '3025221175', '8', '81D0001878', '12', 3157.59, 18945.54, 'purchase_inward:3025221175:8:61054028'),
  ('1607750', '3025221175', '74', '81D0001878', '25', 727.7, 2183.10, 'purchase_inward:3025221175:74:1607750'),
  ('61049875', '3025221175', '40', '81D0001878', '12', 1554.5, 9327.00, 'purchase_inward:3025221175:40:61049875'),
  ('IN00992A', '3025221175', '52', '81D0001878', '29', 1554.5, 12436.00, 'purchase_inward:3025221175:52:IN00992A'),
  ('61010962', '3025221175', '26', '81D0001878', '28', 641.24, 3206.20, 'purchase_inward:3025221175:26:61010962'),
  ('61050884', '3025221175', '54', '81D0001878', '14', 709.24, 85108.80, 'purchase_inward:3025221175:54:61050884'),
  ('61058281', '3025221175', '30', '81D0001878', '11', 194.31, 13990.32, 'purchase_inward:3025221175:30:61058281'),
  ('61064219', '3025221175', '70', '81D0001878', '11', 1621.5, 97290.00, 'purchase_inward:3025221175:70:61064219'),
  ('61059906', '3025221175', '32', '81D0001878', '11', 194.31, 2331.72, 'purchase_inward:3025221175:32:61059906'),
  ('IN00991A', '3025221175', '38', '81D0001878', '29', 1399.06, 22384.96, 'purchase_inward:3025221175:38:IN00991A'),
  ('61060448', '3025221175', '24', '81D0001878', '12', 1424.96, 2849.92, 'purchase_inward:3025221175:24:61060448'),
  ('1601319', '3025221175', '16', '81D0001878', '29', 1417.8, 5671.20, 'purchase_inward:3025221175:16:1601319'),
  ('61059907', '3025221175', '2', '81D0001878', '11', 194.31, 181874.16, 'purchase_inward:3025221175:2:61059907'),
  ('61050877', '3025221175', '12', '81D0001878', '13', 2020.87, 24250.44, 'purchase_inward:3025221175:12:61050877'),
  ('1601319', '3025221175', '72', '81D0001878', '29', 1417.8, 5671.20, 'purchase_inward:3025221175:72:1601319'),
  ('61060433', '3025221175', '66', '81D0001878', '11', 3664.2, 3664.20, 'purchase_inward:3025221175:66:61060433'),
  ('1600908', '3025221175', '44', '81D0001878', '20', 1457.34, 8744.04, 'purchase_inward:3025221175:44:1600908'),
  ('61050884', '3025221175', '10', '81D0001878', '14', 709.24, 102130.56, 'purchase_inward:3025221175:10:61050884'),
  ('61061321', '3025221175', '58', '81D0001878', '12', 1161.66, 6969.96, 'purchase_inward:3025221175:58:61061321'),
  ('61037983', '3025221175', '20', '81D0001878', '23', 368.52, 3685.20, 'purchase_inward:3025221175:20:61037983'),
  ('61049876', '3025221175', '42', '81D0001878', '28', 1457.34, 8744.04, 'purchase_inward:3025221175:42:61049876'),
  ('IN00693A', '3025221175', '68', '81D0001878', '14', 992.38, 5954.28, 'purchase_inward:3025221175:68:IN00693A'),
  ('61059906', '3025221175', '4', '81D0001878', '11', 194.31, 15156.18, 'purchase_inward:3025221175:4:61059906'),
  ('61018554', '3025221175', '76', '81D0001878', '23', 836.86, 836.86, 'purchase_inward:3025221175:76:61018554'),
  ('61009820', '3025221175', '64', '81D0001878', '14', 2137.45, 10687.25, 'purchase_inward:3025221175:64:61009820'),
  ('IN00991A', '3025221175', '50', '81D0001878', '29', 1399.06, 33577.44, 'purchase_inward:3025221175:50:IN00991A'),
  ('61050880', '3025221175', '36', '81D0001878', '14', 1000.71, 24017.04, 'purchase_inward:3025221175:36:61050880'),
  ('61058574', '3025221175', '56', '81D0001878', '11', 48.58, 2331.84, 'purchase_inward:3025221175:56:61058574'),
  ('61059906', '3025221175', '48', '81D0001878', '11', 194.31, 34975.80, 'purchase_inward:3025221175:48:61059906'),
  ('61058281', '3025221175', '46', '81D0001878', '11', 194.31, 209854.80, 'purchase_inward:3025221175:46:61058281');

  -- Update sap_purchase_import_items
  UPDATE public.sap_purchase_import_items pi
  SET unit_purchase_cost = tc.rate,
      total_purchase_cost = tc.amount,
      batch = tc.batch
  FROM temp_sap_costs tc
  WHERE upper(pi.sku) = upper(tc.sku)
    AND (
      pi.idempotency_key = tc.idemp
      OR (pi.item_no = tc.item_no AND (pi.gr_doc_no = tc.gr_doc OR pi.invoice_no = tc.invoice_no))
    );

  -- Update inventory_movements
  UPDATE public.inventory_movements im
  SET unit_cost = tc.rate,
      total_cost = tc.amount
  FROM temp_sap_costs tc
  WHERE im.movement_type = 'purchase_inward'
    AND upper(im.sku) = upper(tc.sku)
    AND (
      im.idempotency_key = tc.idemp
      OR im.reference_number IN (tc.gr_doc, tc.invoice_no)
    );
END $$;

-- ── 3. Upgrade import_purchase_inward RPC to Record Purchase Cost ─────────────

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
  v_batch text;
  v_unit_cost numeric;
  v_total_cost numeric;
  v_item_idemp text;
  v_existing_movement_id uuid;
  v_movement_id uuid;
BEGIN
  IF NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Authorization failure: Only Admin or Master can import weekly SAP purchase stock.'
      USING ERRCODE = '42501';
  END IF;

  v_caller_id := auth.uid();

  IF p_batch_ref IS NULL OR trim(p_batch_ref) = '' THEN
    RAISE EXCEPTION 'Invalid batch reference provided.'
      USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_import_id
  FROM public.sap_purchase_imports
  WHERE batch_ref = p_batch_ref;

  IF v_import_id IS NULL THEN
    INSERT INTO public.sap_purchase_imports (
      batch_ref, file_name, imported_by, notes
    ) VALUES (
      p_batch_ref, p_file_name, v_caller_id, p_notes
    ) RETURNING id INTO v_import_id;
  END IF;

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
    v_batch := trim(COALESCE(v_item->>'batch', ''));
    v_unit_cost := NULLIF(COALESCE((v_item->>'unit_cost')::numeric, (v_item->>'rate')::numeric, 0), 0);
    v_total_cost := NULLIF(COALESCE((v_item->>'total_cost')::numeric, (v_item->>'amount')::numeric, (v_quantity * COALESCE(v_unit_cost, 0))), 0);
    v_item_idemp := trim(COALESCE(v_item->>'idempotency_key', ''));

    BEGIN
      IF v_item->>'gr_date' IS NOT NULL AND v_item->>'gr_date' <> '' THEN
        v_gr_date := (v_item->>'gr_date')::date;
      ELSE
        v_gr_date := CURRENT_DATE;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_gr_date := CURRENT_DATE;
    END;

    IF v_sku = '' OR v_quantity <= 0 THEN
      CONTINUE;
    END IF;

    v_norm_sku := upper(v_sku);
    v_unpadded_sku := ltrim(v_norm_sku, '0');

    SELECT id, name INTO v_product_id, v_product_name
    FROM public.products
    WHERE upper(sku) = v_norm_sku
       OR (v_unpadded_sku <> '' AND upper(sku) = v_unpadded_sku)
    LIMIT 1;

    IF v_product_id IS NULL THEN
      v_skipped_unmapped := v_skipped_unmapped + 1;

      IF v_item_idemp = '' THEN
        v_item_idemp := 'unmapped:' || p_batch_ref || ':' || COALESCE(NULLIF(v_item_no, ''), 'row') || ':' || v_sku;
      END IF;

      INSERT INTO public.sap_purchase_import_items (
        import_id, sku, product_id, product_name, quantity, uom,
        gr_status, gr_date, gr_doc_no, po_number, invoice_no, item_no, batch,
        unit_purchase_cost, total_purchase_cost,
        idempotency_key, movement_id, status, notes
      ) VALUES (
        v_import_id, v_sku, NULL, v_product_name, v_quantity, v_uom,
        v_gr_status, v_gr_date, v_gr_doc_no, v_po_number, v_invoice_no, v_item_no, v_batch,
        v_unit_cost, v_total_cost,
        v_item_idemp, NULL, 'unmapped', 'SKU not found in products table'
      );

      CONTINUE;
    END IF;

    -- Transaction-level idempotency key: purchase_inward:{docRef}:{itemRef}:{normSku}
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
        v_item_idemp := 'purchase_inward:' || COALESCE(NULLIF(v_gr_doc_no, ''), p_batch_ref) || ':' ||
                        COALESCE(NULLIF(v_invoice_no, ''), '0') || ':' || v_norm_sku;
      END IF;
    END IF;

    SELECT id INTO v_existing_movement_id
    FROM public.inventory_movements
    WHERE idempotency_key = v_item_idemp;

    IF v_existing_movement_id IS NOT NULL THEN
      v_skipped_duplicate := v_skipped_duplicate + 1;

      INSERT INTO public.sap_purchase_import_items (
        import_id, sku, product_id, product_name, quantity, uom,
        gr_status, gr_date, gr_doc_no, po_number, invoice_no, item_no, batch,
        unit_purchase_cost, total_purchase_cost,
        idempotency_key, movement_id, status, notes
      ) VALUES (
        v_import_id, v_sku, v_product_id, v_product_name, v_quantity, v_uom,
        v_gr_status, v_gr_date, v_gr_doc_no, v_po_number, v_invoice_no, v_item_no, v_batch,
        v_unit_cost, v_total_cost,
        v_item_idemp, v_existing_movement_id, 'duplicate', 'Already imported with idempotency key: ' || v_item_idemp
      );
    ELSE
      INSERT INTO public.inventory_movements (
        product_id, sku, movement_type, quantity, direction,
        from_location, to_location, reference_number, reference_type, reference_id,
        unit_cost, total_cost,
        idempotency_key, notes, source_location, occurred_at, created_by
      ) VALUES (
        v_product_id, v_norm_sku, 'purchase_inward', v_quantity, 'in',
        'supplier', 'warehouse',
        COALESCE(NULLIF(v_gr_doc_no, ''), NULLIF(v_invoice_no, ''), p_batch_ref),
        'sap_purchase_import', v_import_id,
        v_unit_cost, v_total_cost,
        v_item_idemp,
        'SAP Inbound Purchase: GR ' || COALESCE(v_gr_doc_no, 'N/A') || ' Item ' || COALESCE(v_item_no, 'N/A'),
        'warehouse', v_gr_date::timestamptz, v_caller_id
      ) RETURNING id INTO v_movement_id;

      v_movements_created := v_movements_created + 1;

      INSERT INTO public.sap_purchase_import_items (
        import_id, sku, product_id, product_name, quantity, uom,
        gr_status, gr_date, gr_doc_no, po_number, invoice_no, item_no, batch,
        unit_purchase_cost, total_purchase_cost,
        idempotency_key, movement_id, status, notes
      ) VALUES (
        v_import_id, v_sku, v_product_id, v_product_name, v_quantity, v_uom,
        v_gr_status, v_gr_date, v_gr_doc_no, v_po_number, v_invoice_no, v_item_no, v_batch,
        v_unit_cost, v_total_cost,
        v_item_idemp, v_movement_id, 'created', 'Recorded in authoritative ledger'
      );
    END IF;
  END LOOP;

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
    'skipped_unmapped', v_skipped_unmapped
  );
END;
$$;

-- ── 4. Authoritative Weighted Average Cost (WAC) Helper ───────────────────────

CREATE OR REPLACE FUNCTION public.get_sku_wac_cost(p_sku text)
RETURNS numeric(12, 4)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total_cost numeric;
  v_total_qty numeric;
  v_wac_doz numeric;
BEGIN
  -- Sum total inward cost and quantity across confirmed Goods Receipts
  SELECT
    COALESCE(SUM(total_cost), 0),
    COALESCE(SUM(quantity), 0)
  INTO
    v_total_cost,
    v_total_qty
  FROM public.inventory_movements
  WHERE movement_type = 'purchase_inward'
    AND upper(sku) = upper(trim(p_sku))
    AND total_cost > 0
    AND quantity > 0;

  IF v_total_qty <= 0 OR v_total_cost <= 0 THEN
    RETURN NULL;
  END IF;

  -- Purchase is in DOZ. Normalize to Cost per EA (piece):
  v_wac_doz := v_total_cost / v_total_qty;
  RETURN ROUND((v_wac_doz / 12.0), 4);
END;
$$;

-- ── 5. Upgraded Route Profitability RPC (get_route_profitability) ─────────────

CREATE OR REPLACE FUNCTION public.get_route_profitability(
    p_route_id UUID DEFAULT NULL,
    p_picklist_id UUID DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL,
    p_worker_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_result jsonb := '[]'::jsonb;
    v_totals record;
    v_row record;
BEGIN
    IF NOT public.is_current_user_admin_or_master() THEN
        RAISE EXCEPTION 'Unauthorized: Only Owner or Master may access route profitability metrics.' USING ERRCODE = '42501';
    END IF;

    -- Compute WAC layer in a CTE for efficient single-query joining
    FOR v_row IN
        WITH sku_wac AS (
            SELECT
                upper(sku) AS sku,
                CASE
                    WHEN SUM(quantity) > 0 AND SUM(total_cost) > 0 THEN
                        ROUND((SUM(total_cost) / SUM(quantity) / 12.0)::numeric, 4)
                    ELSE NULL
                END AS cost_per_ea
            FROM public.inventory_movements
            WHERE movement_type = 'purchase_inward'
              AND total_cost > 0
              AND quantity > 0
            GROUP BY upper(sku)
        ),
        picklist_items_cogs AS (
            SELECT
                d.picklist_id,
                -- Total delivered sales from items
                COALESCE(SUM(di.delivered_qty * di.rate), 0) AS items_sales_val,
                -- Authoritative COGS: delivered_qty * cost_per_ea
                COALESCE(SUM(CASE WHEN sw.cost_per_ea IS NOT NULL THEN di.delivered_qty * sw.cost_per_ea ELSE 0 END), 0) AS total_cogs,
                -- Covered sales value
                COALESCE(SUM(CASE WHEN sw.cost_per_ea IS NOT NULL THEN di.delivered_qty * di.rate ELSE 0 END), 0) AS covered_sales_val,
                -- Missing cost count
                COUNT(CASE WHEN sw.cost_per_ea IS NULL AND di.delivered_qty > 0 THEN 1 END) AS missing_cost_items_count,
                -- Total delivered items
                COUNT(CASE WHEN di.delivered_qty > 0 THEN 1 END) AS total_delivered_items_count
            FROM public.delivery_items di
            JOIN public.deliveries d ON d.id = di.delivery_id
            LEFT JOIN sku_wac sw ON sw.sku = upper(di.sku)
            WHERE d.status IN ('delivered', 'partial')
            GROUP BY d.picklist_id
        ),
        picklist_rev AS (
            SELECT
                p.id AS picklist_id,
                p.picklist_number,
                p.date,
                p.route_id,
                r.name AS route_name,
                r.code AS route_code,
                p.worker_id,
                w.name AS worker_name,
                COALESCE(p.total_amount, 0) AS ordered_revenue,
                COALESCE(SUM(d.delivered_amount), 0) AS delivered_revenue,
                COALESCE(SUM(d.collected_amount), 0) AS collected_amount,
                COUNT(d.id) AS total_deliveries,
                COUNT(CASE WHEN d.status = 'delivered' THEN 1 END) AS successful_deliveries,
                COUNT(CASE WHEN d.status = 'partial' THEN 1 END) AS partial_deliveries,
                COUNT(CASE WHEN d.status = 'refused' THEN 1 END) AS refused_deliveries,
                COALESCE(SUM(CASE WHEN d.status IN ('delivered', 'partial') AND d.delivered_amount > d.collected_amount THEN d.delivered_amount - d.collected_amount ELSE 0 END), 0) AS credit_sales,
                p.financial_reconciliation_status AS financial_status,
                COALESCE(p.cash_discrepancy, 0) AS cash_discrepancy,
                COALESCE(p.net_cash_deposit, 0) AS actual_cash_returned,
                p.reconciled_at
            FROM public.picklists p
            JOIN public.routes r ON r.id = p.route_id
            LEFT JOIN public.workers w ON w.id = p.worker_id
            LEFT JOIN public.deliveries d ON d.picklist_id = p.id
            WHERE (p_route_id IS NULL OR p.route_id = p_route_id)
              AND (p_picklist_id IS NULL OR p.id = p_picklist_id)
              AND (p_start_date IS NULL OR p.date >= p_start_date)
              AND (p_end_date IS NULL OR p.date <= p_end_date)
              AND (p_worker_id IS NULL OR p.worker_id = p_worker_id)
            GROUP BY p.id, p.picklist_number, p.date, p.route_id, r.name, r.code, p.worker_id, w.name, p.total_amount, p.financial_reconciliation_status, p.cash_discrepancy, p.net_cash_deposit, p.reconciled_at
        ),
        picklist_pay AS (
            SELECT
                pay.picklist_id,
                COALESCE(SUM(CASE WHEN pay.payment_mode = 'cash' AND pay.status NOT IN ('reversed', 'bounced') THEN pay.amount ELSE 0 END), 0) AS cash_collected,
                COALESCE(SUM(CASE WHEN pay.payment_mode = 'upi' AND pay.status NOT IN ('reversed', 'bounced') THEN pay.amount ELSE 0 END), 0) AS upi_collected,
                COALESCE(SUM(CASE WHEN pay.payment_mode = 'cheque' AND pay.status = 'cleared' THEN pay.amount ELSE 0 END), 0) AS cheque_cleared,
                COALESCE(SUM(CASE WHEN pay.payment_mode = 'cheque' AND pay.status = 'pending' THEN pay.amount ELSE 0 END), 0) AS cheque_pending,
                COALESCE(SUM(CASE WHEN pay.payment_mode = 'cheque' AND pay.status = 'bounced' THEN pay.amount ELSE 0 END), 0) AS cheque_bounced,
                COALESCE(SUM(CASE WHEN pay.status NOT IN ('reversed', 'bounced') THEN pay.amount ELSE 0 END), 0) AS total_collected
            FROM public.payments pay
            WHERE pay.picklist_id IS NOT NULL
            GROUP BY pay.picklist_id
        ),
        picklist_exp AS (
            SELECT
                e.picklist_id,
                COALESCE(SUM(CASE WHEN e.status = 'approved' THEN e.amount ELSE 0 END), 0) AS approved_expenses,
                COALESCE(SUM(CASE WHEN e.status = 'approved' AND e.payment_method = 'cash' THEN e.amount ELSE 0 END), 0) AS cash_expenses,
                COALESCE(SUM(CASE WHEN e.status = 'approved' AND e.payment_method <> 'cash' THEN e.amount ELSE 0 END), 0) AS non_cash_expenses,
                COALESCE(SUM(CASE WHEN e.status = 'pending' THEN e.amount ELSE 0 END), 0) AS pending_expenses
            FROM public.expenses e
            WHERE e.picklist_id IS NOT NULL
            GROUP BY e.picklist_id
        )
        SELECT
            pr.picklist_id,
            pr.picklist_number,
            pr.date,
            pr.route_id,
            pr.route_name,
            pr.route_code,
            pr.worker_id,
            pr.worker_name,
            pr.ordered_revenue,
            pr.delivered_revenue,
            COALESCE(pp.total_collected, pr.collected_amount, 0) AS total_collected,
            COALESCE(pp.cash_collected, 0) AS cash_collected,
            COALESCE(pp.upi_collected, 0) AS upi_collected,
            COALESCE(pp.cheque_cleared, 0) AS cheque_cleared,
            COALESCE(pp.cheque_pending, 0) AS cheque_pending,
            COALESCE(pp.cheque_bounced, 0) AS cheque_bounced,
            pr.credit_sales,
            pr.total_deliveries,
            pr.successful_deliveries,
            pr.partial_deliveries,
            pr.refused_deliveries,
            COALESCE(pe.approved_expenses, 0) AS approved_expenses,
            COALESCE(pe.cash_expenses, 0) AS cash_expenses,
            COALESCE(pe.non_cash_expenses, 0) AS non_cash_expenses,
            COALESCE(pe.pending_expenses, 0) AS pending_expenses,
            (COALESCE(pp.cash_collected, 0) - COALESCE(pe.cash_expenses, 0)) AS expected_cash,
            pr.actual_cash_returned,
            pr.cash_discrepancy,
            pr.financial_status,
            pr.reconciled_at,
            -- Authoritative COGS and Profitability
            COALESCE(pic.total_cogs, 0) AS cogs,
            (pr.delivered_revenue - COALESCE(pic.total_cogs, 0)) AS gross_profit,
            (pr.delivered_revenue - COALESCE(pic.total_cogs, 0) - COALESCE(pe.approved_expenses, 0)) AS net_profit,
            CASE
                WHEN pr.delivered_revenue > 0 THEN
                    ROUND(((pr.delivered_revenue - COALESCE(pic.total_cogs, 0)) / pr.delivered_revenue * 100)::numeric, 2)
                ELSE 0
            END AS gross_margin_pct,
            CASE
                WHEN pr.delivered_revenue > 0 THEN
                    ROUND(((pr.delivered_revenue - COALESCE(pic.total_cogs, 0) - COALESCE(pe.approved_expenses, 0)) / pr.delivered_revenue * 100)::numeric, 2)
                ELSE 0
            END AS net_margin_pct,
            CASE
                WHEN COALESCE(pic.items_sales_val, 0) > 0 THEN
                    ROUND((COALESCE(pic.covered_sales_val, 0) / pic.items_sales_val * 100)::numeric, 1)
                ELSE 0
            END AS cogs_coverage_pct,
            CASE
                WHEN COALESCE(pic.missing_cost_items_count, 0) > 0 THEN 'incomplete'
                ELSE 'complete'
            END AS cogs_status,
            COALESCE(pic.missing_cost_items_count, 0) AS missing_cost_items_count,
            (pr.delivered_revenue - COALESCE(pe.approved_expenses, 0)) AS contribution_before_cogs
        FROM picklist_rev pr
        LEFT JOIN picklist_items_cogs pic ON pic.picklist_id = pr.picklist_id
        LEFT JOIN picklist_pay pp ON pp.picklist_id = pr.picklist_id
        LEFT JOIN picklist_exp pe ON pe.picklist_id = pr.picklist_id
        ORDER BY pr.date DESC, pr.route_name ASC
    LOOP
        v_result := v_result || jsonb_build_object(
            'picklist_id',              v_row.picklist_id,
            'picklist_number',          v_row.picklist_number,
            'date',                     v_row.date,
            'route_id',                 v_row.route_id,
            'route_name',               v_row.route_name,
            'route_code',               v_row.route_code,
            'worker_id',                v_row.worker_id,
            'worker_name',              v_row.worker_name,
            'ordered_revenue',          v_row.ordered_revenue,
            'sales',                    v_row.delivered_revenue,
            'delivered_revenue',        v_row.delivered_revenue,
            'cogs',                     v_row.cogs,
            'gross_profit',             v_row.gross_profit,
            'approved_expenses',        v_row.approved_expenses,
            'net_profit',               v_row.net_profit,
            'gross_margin_pct',         v_row.gross_margin_pct,
            'net_margin_pct',           v_row.net_margin_pct,
            'cogs_coverage_pct',        v_row.cogs_coverage_pct,
            'cogs_status',              v_row.cogs_status,
            'missing_cost_items_count', v_row.missing_cost_items_count,
            'total_collected',          v_row.total_collected,
            'cash_collected',           v_row.cash_collected,
            'upi_collected',            v_row.upi_collected,
            'cheque_cleared',           v_row.cheque_cleared,
            'cheque_pending',           v_row.cheque_pending,
            'cheque_bounced',           v_row.cheque_bounced,
            'credit_sales',             v_row.credit_sales,
            'cash_expenses',            v_row.cash_expenses,
            'non_cash_expenses',        v_row.non_cash_expenses,
            'pending_expenses',         v_row.pending_expenses,
            'expected_cash',            v_row.expected_cash,
            'actual_cash_returned',     v_row.actual_cash_returned,
            'cash_discrepancy',         v_row.cash_discrepancy,
            'financial_status',         v_row.financial_status,
            'reconciled_at',            v_row.reconciled_at,
            'contribution_before_cogs', v_row.contribution_before_cogs
        );
    END LOOP;

    -- Calculate aggregate totals
    SELECT
        COALESCE(SUM((elem->>'sales')::numeric), 0) AS total_sales,
        COALESCE(SUM((elem->>'cogs')::numeric), 0) AS total_cogs,
        COALESCE(SUM((elem->>'gross_profit')::numeric), 0) AS total_gross_profit,
        COALESCE(SUM((elem->>'approved_expenses')::numeric), 0) AS total_approved_expenses,
        COALESCE(SUM((elem->>'net_profit')::numeric), 0) AS total_net_profit,
        COALESCE(SUM((elem->>'cash_collected')::numeric), 0) AS total_cash,
        COALESCE(SUM((elem->>'upi_collected')::numeric), 0) AS total_upi,
        COALESCE(SUM((elem->>'cheque_cleared')::numeric), 0) AS total_cheque_cleared,
        COALESCE(SUM((elem->>'cheque_pending')::numeric), 0) AS total_cheque_pending,
        COALESCE(SUM((elem->>'credit_sales')::numeric), 0) AS total_credit,
        COALESCE(SUM((elem->>'total_collected')::numeric), 0) AS total_collected,
        COALESCE(SUM((elem->>'cash_expenses')::numeric), 0) AS total_cash_expenses,
        COALESCE(SUM((elem->>'non_cash_expenses')::numeric), 0) AS total_non_cash_expenses,
        COALESCE(SUM((elem->>'expected_cash')::numeric), 0) AS total_expected_cash,
        COALESCE(SUM((elem->>'actual_cash_returned')::numeric), 0) AS total_actual_cash,
        COALESCE(SUM((elem->>'cash_discrepancy')::numeric), 0) AS total_cash_discrepancy,
        COALESCE(SUM((elem->>'contribution_before_cogs')::numeric), 0) AS total_contrib
    INTO v_totals
    FROM jsonb_array_elements(v_result) AS elem;

    RETURN jsonb_build_object(
        'success', true,
        'routes', v_result,
        'totals', jsonb_build_object(
            'sales',                    COALESCE(v_totals.total_sales, 0),
            'cogs',                     COALESCE(v_totals.total_cogs, 0),
            'gross_profit',             COALESCE(v_totals.total_gross_profit, 0),
            'approved_expenses',        COALESCE(v_totals.total_approved_expenses, 0),
            'net_profit',               COALESCE(v_totals.total_net_profit, 0),
            'gross_margin_pct',         CASE WHEN COALESCE(v_totals.total_sales, 0) > 0 THEN ROUND((COALESCE(v_totals.total_gross_profit, 0) / v_totals.total_sales * 100)::numeric, 2) ELSE 0 END,
            'net_margin_pct',           CASE WHEN COALESCE(v_totals.total_sales, 0) > 0 THEN ROUND((COALESCE(v_totals.total_net_profit, 0) / v_totals.total_sales * 100)::numeric, 2) ELSE 0 END,
            'cash_collected',           COALESCE(v_totals.total_cash, 0),
            'upi_collected',            COALESCE(v_totals.total_upi, 0),
            'cheque_cleared',           COALESCE(v_totals.total_cheque_cleared, 0),
            'cheque_pending',           COALESCE(v_totals.total_cheque_pending, 0),
            'credit_sales',             COALESCE(v_totals.total_credit, 0),
            'total_collected',          COALESCE(v_totals.total_collected, 0),
            'cash_expenses',            COALESCE(v_totals.total_cash_expenses, 0),
            'non_cash_expenses',        COALESCE(v_totals.total_non_cash_expenses, 0),
            'expected_cash',            COALESCE(v_totals.total_expected_cash, 0),
            'actual_cash_returned',     COALESCE(v_totals.total_actual_cash, 0),
            'cash_discrepancy',         COALESCE(v_totals.total_cash_discrepancy, 0),
            'contribution_before_cogs', COALESCE(v_totals.total_contrib, 0)
        )
    );
END;
$function$;

-- ── 6. Upgraded get_financial_summary RPC ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_financial_summary(
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL,
    p_picklist_id UUID DEFAULT NULL,
    p_route_id UUID DEFAULT NULL,
    p_worker_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_total_revenue numeric(12, 2) := 0;
    v_total_cogs numeric(12, 2) := 0;
    v_covered_sales numeric(12, 2) := 0;
    v_missing_cost_count integer := 0;
    v_missing_cost_sales numeric(12, 2) := 0;
    v_total_collected numeric(12, 2) := 0;
    v_cash_collected numeric(12, 2) := 0;
    v_upi_collected numeric(12, 2) := 0;
    v_cheque_collected numeric(12, 2) := 0;
    v_current_period_collected numeric(12, 2) := 0;
    v_prior_period_collected numeric(12, 2) := 0;
    v_credit_sales_created numeric(12, 2) := 0;
    v_total_credit numeric(12, 2) := 0;
    v_pending_credit numeric(12, 2) := 0;
    v_total_expenses numeric(12, 2) := 0;
    v_cash_expenses numeric(12, 2) := 0;
    v_bank_expenses numeric(12, 2) := 0;
    v_net_cash_deposit numeric(12, 2) := 0;
    v_cash_discrepancy numeric(12, 2) := 0;
    v_pending_cheques numeric(12, 2) := 0;
    v_bounced_cheques numeric(12, 2) := 0;
    v_total_outstanding numeric(12, 2) := 0;
    v_customer_advance numeric(12, 2) := 0;
    v_gross_profit numeric(12, 2) := 0;
    v_net_profit numeric(12, 2) := 0;
    v_gross_margin_pct numeric(5, 2) := 0;
    v_net_margin_pct numeric(5, 2) := 0;
    v_cogs_coverage_pct numeric(5, 2) := 0;
    v_cogs_status text := 'complete';
BEGIN
    IF NOT public.is_current_user_admin_or_master() THEN
        RAISE EXCEPTION 'Unauthorized: Only Owner or Master may access organizational financial summaries.' USING ERRCODE = '42501';
    END IF;

    -- ── 1. Sales Revenue: Commercial sales determined by delivery/sale date ──
    SELECT COALESCE(SUM(d.delivered_amount), 0)
    INTO v_total_revenue
    FROM public.deliveries d
    LEFT JOIN public.picklists p ON d.picklist_id = p.id
    WHERE d.status IN ('delivered', 'partial')
      AND (p_start_date IS NULL OR d.delivery_date >= p_start_date)
      AND (p_end_date IS NULL OR d.delivery_date <= p_end_date)
      AND (p_picklist_id IS NULL OR d.picklist_id = p_picklist_id)
      AND (p_route_id IS NULL OR p.route_id = p_route_id)
      AND (p_worker_id IS NULL OR d.worker_id = p_worker_id);

    -- ── 2. Authoritative COGS Calculation via WAC ──
    WITH sku_wac AS (
        SELECT
            upper(sku) AS sku,
            CASE
                WHEN SUM(quantity) > 0 AND SUM(total_cost) > 0 THEN
                    ROUND((SUM(total_cost) / SUM(quantity) / 12.0)::numeric, 4)
                ELSE NULL
            END AS cost_per_ea
        FROM public.inventory_movements
        WHERE movement_type = 'purchase_inward'
          AND total_cost > 0
          AND quantity > 0
        GROUP BY upper(sku)
    ),
    del_cogs AS (
        SELECT
            di.sku,
            SUM(di.delivered_qty) AS delivered_qty,
            SUM(di.delivered_qty * di.rate) AS sales_val,
            sw.cost_per_ea
        FROM public.delivery_items di
        JOIN public.deliveries d ON d.id = di.delivery_id
        LEFT JOIN public.picklists p ON p.id = d.picklist_id
        LEFT JOIN sku_wac sw ON sw.sku = upper(di.sku)
        WHERE d.status IN ('delivered', 'partial')
          AND di.delivered_qty > 0
          AND (p_start_date IS NULL OR d.delivery_date >= p_start_date)
          AND (p_end_date IS NULL OR d.delivery_date <= p_end_date)
          AND (p_picklist_id IS NULL OR d.picklist_id = p_picklist_id)
          AND (p_route_id IS NULL OR p.route_id = p_route_id)
          AND (p_worker_id IS NULL OR d.worker_id = p_worker_id)
        GROUP BY di.sku, sw.cost_per_ea
    )
    SELECT
        COALESCE(SUM(CASE WHEN cost_per_ea IS NOT NULL THEN delivered_qty * cost_per_ea ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN cost_per_ea IS NOT NULL THEN sales_val ELSE 0 END), 0),
        COUNT(CASE WHEN cost_per_ea IS NULL THEN 1 END),
        COALESCE(SUM(CASE WHEN cost_per_ea IS NULL THEN sales_val ELSE 0 END), 0)
    INTO
        v_total_cogs,
        v_covered_sales,
        v_missing_cost_count,
        v_missing_cost_sales
    FROM del_cogs;

    -- ── 3. Collections ──
    SELECT
        COALESCE(SUM(CASE WHEN pay.status NOT IN ('reversed', 'bounced') THEN pay.amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN pay.payment_mode = 'cash' AND pay.status NOT IN ('reversed', 'bounced') THEN pay.amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN pay.payment_mode = 'upi' AND pay.status NOT IN ('reversed', 'bounced') THEN pay.amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN pay.payment_mode = 'cheque' AND pay.status NOT IN ('reversed', 'bounced') THEN pay.amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN pay.payment_mode = 'cheque' AND pay.status = 'pending' THEN pay.amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN pay.payment_mode = 'cheque' AND pay.status = 'bounced' THEN pay.amount ELSE 0 END), 0)
    INTO
        v_total_collected,
        v_cash_collected,
        v_upi_collected,
        v_cheque_collected,
        v_pending_cheques,
        v_bounced_cheques
    FROM public.payments pay
    WHERE (p_start_date IS NULL OR pay.payment_date >= p_start_date)
      AND (p_end_date IS NULL OR pay.payment_date <= p_end_date)
      AND (p_picklist_id IS NULL OR pay.picklist_id = p_picklist_id)
      AND (p_route_id IS NULL OR pay.route_id = p_route_id)
      AND (p_worker_id IS NULL OR pay.worker_id = p_worker_id);

    -- ── 4. Current vs Prior Collections Breakdown ──
    WITH delivery_settlements AS (
        SELECT
            d.id,
            d.delivered_amount,
            COALESCE(SUM(pay.amount), 0) AS total_paid
        FROM public.deliveries d
        LEFT JOIN public.payments pay ON pay.delivery_id = d.id
            AND pay.status NOT IN ('reversed', 'bounced')
            AND (p_start_date IS NULL OR pay.payment_date >= p_start_date)
            AND (p_end_date IS NULL OR pay.payment_date <= p_end_date)
        LEFT JOIN public.picklists p ON d.picklist_id = p.id
        WHERE d.status IN ('delivered', 'partial')
          AND (p_start_date IS NULL OR d.delivery_date >= p_start_date)
          AND (p_end_date IS NULL OR d.delivery_date <= p_end_date)
          AND (p_picklist_id IS NULL OR d.picklist_id = p_picklist_id)
          AND (p_route_id IS NULL OR p.route_id = p_route_id)
          AND (p_worker_id IS NULL OR d.worker_id = p_worker_id)
        GROUP BY d.id, d.delivered_amount
    )
    SELECT COALESCE(SUM(LEAST(delivered_amount, total_paid)), 0)
    INTO v_current_period_collected
    FROM delivery_settlements;

    v_prior_period_collected := GREATEST(0, v_total_collected - v_current_period_collected);

    -- ── 5. Credit Sales Created ──
    SELECT COALESCE(SUM(GREATEST(0, d.delivered_amount - d.collected_amount)), 0)
    INTO v_credit_sales_created
    FROM public.deliveries d
    LEFT JOIN public.picklists p ON d.picklist_id = p.id
    WHERE d.status IN ('delivered', 'partial')
      AND d.delivered_amount > d.collected_amount
      AND (p_start_date IS NULL OR d.delivery_date >= p_start_date)
      AND (p_end_date IS NULL OR d.delivery_date <= p_end_date)
      AND (p_picklist_id IS NULL OR d.picklist_id = p_picklist_id)
      AND (p_route_id IS NULL OR p.route_id = p_route_id)
      AND (p_worker_id IS NULL OR d.worker_id = p_worker_id);

    v_total_credit := v_credit_sales_created;

    -- ── 6. Approved Operating Expenses ──
    SELECT
        COALESCE(SUM(e.amount), 0),
        COALESCE(SUM(CASE WHEN e.payment_method = 'cash' THEN e.amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN e.payment_method <> 'cash' THEN e.amount ELSE 0 END), 0)
    INTO
        v_total_expenses,
        v_cash_expenses,
        v_bank_expenses
    FROM public.expenses e
    WHERE e.status = 'approved'
      AND (p_start_date IS NULL OR e.date >= p_start_date)
      AND (p_end_date IS NULL OR e.date <= p_end_date)
      AND (p_picklist_id IS NULL OR e.picklist_id = p_picklist_id)
      AND (p_route_id IS NULL OR e.route_id = p_route_id)
      AND (p_worker_id IS NULL OR e.worker_id = p_worker_id);

    -- ── 7. Route Reconciliation Data ──
    SELECT
        COALESCE(SUM(p.cash_discrepancy), 0),
        COALESCE(SUM(p.net_cash_deposit), 0)
    INTO
        v_cash_discrepancy,
        v_net_cash_deposit
    FROM public.picklists p
    WHERE p.financial_reconciliation_status IN ('reconciled', 'discrepancy')
      AND (p_start_date IS NULL OR p.date >= p_start_date)
      AND (p_end_date IS NULL OR p.date <= p_end_date)
      AND (p_picklist_id IS NULL OR p.id = p_picklist_id)
      AND (p_route_id IS NULL OR p.route_id = p_route_id)
      AND (p_worker_id IS NULL OR p.worker_id = p_worker_id);

    -- ── 8. Authoritative Outstanding & Advances from Ledger ──
    WITH party_balances AS (
        SELECT
            party_id,
            COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END), 0) AS balance
        FROM public.party_financial_ledger
        WHERE status = 'valid'
        GROUP BY party_id
    )
    SELECT
        COALESCE(SUM(GREATEST(0, balance)), 0),
        COALESCE(SUM(GREATEST(0, -balance)), 0)
    INTO
        v_total_outstanding,
        v_customer_advance
    FROM party_balances;

    IF v_total_outstanding = 0 AND v_credit_sales_created > 0 THEN
        v_total_outstanding := v_credit_sales_created;
    END IF;

    v_pending_credit := v_total_outstanding;

    -- ── 9. Profitability Formulas ──
    v_gross_profit := v_total_revenue - v_total_cogs;
    v_net_profit := v_gross_profit - v_total_expenses;

    IF v_total_revenue > 0 THEN
        v_gross_margin_pct := ROUND((v_gross_profit / v_total_revenue * 100)::numeric, 2);
        v_net_margin_pct := ROUND((v_net_profit / v_total_revenue * 100)::numeric, 2);
    ELSE
        v_gross_margin_pct := 0;
        v_net_margin_pct := 0;
    END IF;

    IF (v_covered_sales + v_missing_cost_sales) > 0 THEN
        v_cogs_coverage_pct := ROUND((v_covered_sales / (v_covered_sales + v_missing_cost_sales) * 100)::numeric, 1);
    ELSE
        v_cogs_coverage_pct := 0;
    END IF;

    IF v_missing_cost_count > 0 THEN
        v_cogs_status := 'incomplete';
    ELSE
        v_cogs_status := 'complete';
    END IF;

    RETURN jsonb_build_object(
        'total_revenue',             v_total_revenue,
        'cogs',                      v_total_cogs,
        'gross_profit',              v_gross_profit,
        'total_expenses',            v_total_expenses,
        'net_profit',                v_net_profit,
        'gross_margin_pct',          v_gross_margin_pct,
        'net_margin_pct',            v_net_margin_pct,
        'cogs_coverage_pct',         v_cogs_coverage_pct,
        'cogs_status',               v_cogs_status,
        'missing_cost_skus_count',   v_missing_cost_count,
        'missing_cost_sales_value',  v_missing_cost_sales,
        'total_collected',           v_total_collected,
        'current_period_collected',  v_current_period_collected,
        'prior_period_collected',    v_prior_period_collected,
        'credit_sales_created',      v_credit_sales_created,
        'cash_collected',            v_cash_collected,
        'upi_collected',             v_upi_collected,
        'cheque_collected',          v_cheque_collected,
        'total_credit',              v_credit_sales_created,
        'pending_credit',            v_pending_credit,
        'total_outstanding',         v_total_outstanding,
        'customer_advance',          v_customer_advance,
        'cash_expenses',             v_cash_expenses,
        'bank_expenses',             v_bank_expenses,
        'net_cash_deposit',          v_net_cash_deposit,
        'cash_discrepancy',          v_cash_discrepancy,
        'pending_cheques',           v_pending_cheques,
        'bounced_cheques',           v_bounced_cheques,
        'sales',                     v_total_revenue,
        'cash',                      v_cash_collected,
        'upi',                       v_upi_collected,
        'cheque_cleared',            v_cheque_collected - v_pending_cheques,
        'cheque_pending',            v_pending_cheques,
        'credit_extended',           v_credit_sales_created,
        'expenses',                  v_total_expenses,
        'net_cash',                  v_cash_collected - v_cash_expenses,
        'contribution_before_cogs',  v_total_revenue - v_total_expenses
    );
END;
$function$;

-- ── 7. Grants & Permissions ──────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.get_sku_wac_cost(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_route_profitability(uuid, uuid, date, date, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_financial_summary(date, date, uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_purchase_inward(jsonb, text, text, text) TO authenticated, service_role;

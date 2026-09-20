-- ==============================================================================
-- Migration 021: Historical Sales Product Discovery & Idempotent Import Layer
--
-- 1. Creates public.historical_sales_products table as a PRODUCT DISCOVERY source.
--    This represents historical sales reference data from previous sales (e.g. sale.xlsx).
--    CRITICAL: Historical sales are discovery/analytics data ONLY.
--    They do NOT increase current warehouse stock and do NOT create inventory movements.
-- 2. Indexes table by exact Material / SKU and date.
-- 3. Implements strict RLS: Admin / Master only. Blocked from Workers and unauthenticated public access.
-- 4. Creates secure idempotent bulk import RPC: import_historical_sales_products.
-- ==============================================================================

-- ── 1. Create Table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.historical_sales_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  product_name text NOT NULL,
  category text,
  subcategory text,
  hsn_code text,
  uom text DEFAULT 'EA',
  first_sale_date date,
  latest_sale_date date,
  total_historical_qty numeric NOT NULL DEFAULT 0,
  historical_invoice_count integer NOT NULL DEFAULT 0,
  historical_row_count integer NOT NULL DEFAULT 0,
  average_rate numeric(10,2) DEFAULT NULL,
  latest_rate numeric(10,2) DEFAULT NULL,
  source_file text DEFAULT 'sale.xlsx',
  import_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_historical_sales_products_sku
  ON public.historical_sales_products(upper(sku));

CREATE INDEX IF NOT EXISTS idx_historical_sales_products_latest_date
  ON public.historical_sales_products(latest_sale_date DESC);

-- ── 3. Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE public.historical_sales_products ENABLE ROW LEVEL SECURITY;

-- Read policy: Only Admin and Master can view historical sales discovery data
DROP POLICY IF EXISTS "Admin and Master view historical_sales_products" ON public.historical_sales_products;
CREATE POLICY "Admin and Master view historical_sales_products"
  ON public.historical_sales_products
  FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin_or_master());

-- Mutation policy: Only Admin and Master can manage historical sales discovery data
DROP POLICY IF EXISTS "Admin and Master manage historical_sales_products" ON public.historical_sales_products;
CREATE POLICY "Admin and Master manage historical_sales_products"
  ON public.historical_sales_products
  FOR ALL
  TO authenticated
  USING (public.is_current_user_admin_or_master())
  WITH CHECK (public.is_current_user_admin_or_master());

-- ── 4. Idempotent Bulk Import RPC ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.import_historical_sales_products(
  p_products jsonb,
  p_import_hash text DEFAULT NULL,
  p_source_file text DEFAULT 'sale.xlsx'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_prod jsonb;
  v_count integer := 0;
  v_sku text;
  v_name text;
BEGIN
  -- Security check: Admin / Master role required
  IF NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Authorization failure: Only Admin or Master can import historical sales discovery records.'
      USING ERRCODE = '42501';
  END IF;

  FOR v_prod IN SELECT * FROM jsonb_array_elements(p_products)
  LOOP
    v_sku := trim(COALESCE(v_prod->>'sku', ''));
    v_name := trim(COALESCE(v_prod->>'product_name', ''));

    IF v_sku <> '' AND v_name <> '' THEN
      INSERT INTO public.historical_sales_products (
        sku,
        product_name,
        category,
        subcategory,
        hsn_code,
        uom,
        first_sale_date,
        latest_sale_date,
        total_historical_qty,
        historical_invoice_count,
        historical_row_count,
        average_rate,
        latest_rate,
        source_file,
        import_hash,
        updated_at
      ) VALUES (
        v_sku,
        v_name,
        NULLIF(trim(COALESCE(v_prod->>'category', '')), ''),
        NULLIF(trim(COALESCE(v_prod->>'subcategory', '')), ''),
        NULLIF(trim(COALESCE(v_prod->>'hsn_code', '')), ''),
        COALESCE(NULLIF(trim(v_prod->>'uom'), ''), 'EA'),
        NULLIF(v_prod->>'first_sale_date', '')::date,
        NULLIF(v_prod->>'latest_sale_date', '')::date,
        COALESCE((v_prod->>'total_historical_qty')::numeric, 0),
        COALESCE((v_prod->>'historical_invoice_count')::integer, 0),
        COALESCE((v_prod->>'historical_row_count')::integer, 0),
        NULLIF(v_prod->>'average_rate', '')::numeric,
        NULLIF(v_prod->>'latest_rate', '')::numeric,
        COALESCE(p_source_file, 'sale.xlsx'),
        p_import_hash,
        now()
      )
      ON CONFLICT (sku) DO UPDATE SET
        product_name = EXCLUDED.product_name,
        category = COALESCE(EXCLUDED.category, public.historical_sales_products.category),
        subcategory = COALESCE(EXCLUDED.subcategory, public.historical_sales_products.subcategory),
        hsn_code = COALESCE(EXCLUDED.hsn_code, public.historical_sales_products.hsn_code),
        uom = COALESCE(EXCLUDED.uom, public.historical_sales_products.uom),
        first_sale_date = LEAST(public.historical_sales_products.first_sale_date, EXCLUDED.first_sale_date),
        latest_sale_date = GREATEST(public.historical_sales_products.latest_sale_date, EXCLUDED.latest_sale_date),
        total_historical_qty = EXCLUDED.total_historical_qty,
        historical_invoice_count = EXCLUDED.historical_invoice_count,
        historical_row_count = EXCLUDED.historical_row_count,
        average_rate = COALESCE(EXCLUDED.average_rate, public.historical_sales_products.average_rate),
        latest_rate = COALESCE(EXCLUDED.latest_rate, public.historical_sales_products.latest_rate),
        source_file = EXCLUDED.source_file,
        import_hash = EXCLUDED.import_hash,
        updated_at = now();

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'imported_count', v_count,
    'source_file', p_source_file
  );
END;
$$;

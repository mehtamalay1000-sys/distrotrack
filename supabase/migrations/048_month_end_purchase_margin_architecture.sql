-- ==============================================================================
-- Migration 048: Month-End Purchase-Basis Net Margin Architecture
--
-- Distinctly implements the Month-End Profitability Model:
--   Month-End Net Margin = Monthly Sales - Confirmed Monthly SAP Purchases - Approved Monthly Expenses
--
-- Coexists with Real-Time Route Profitability:
--   Route Profit = Route Sales - Delivered Goods COGS - Approved Route Expenses
-- ==============================================================================

-- Create index for fast monthly purchase grouping
CREATE INDEX IF NOT EXISTS idx_sap_purchase_items_gr_date_status
  ON public.sap_purchase_import_items(gr_date, gr_status);

-- ── RPC: get_month_end_purchase_margin ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_month_end_purchase_margin(
    p_year integer,
    p_month integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_sales_revenue numeric(12, 2) := 0;
    v_purchase_spend numeric(12, 2) := 0;
    v_approved_expenses numeric(12, 2) := 0;
    v_net_margin numeric(12, 2) := 0;
    v_net_margin_pct numeric(6, 2) := NULL;
    v_purchase_batches_count integer := 0;
    v_purchase_items_count integer := 0;
    v_total_received_qty numeric(12, 2) := 0;
    v_realized_cogs numeric(12, 2) := 0;
    v_realized_gross_profit numeric(12, 2) := 0;
    v_realized_net_profit numeric(12, 2) := 0;
    v_purchase_batches jsonb := '[]'::jsonb;
    v_sales_by_route jsonb := '[]'::jsonb;
    v_expenses_breakdown jsonb := '[]'::jsonb;
    v_start_date date;
    v_end_date date;
    v_cutoff_date date;
    v_sap_sales numeric(12, 2) := 0;
    v_delivery_sales numeric(12, 2) := 0;
BEGIN
    IF NOT public.is_current_user_admin_or_master() THEN
        RAISE EXCEPTION 'Unauthorized: Only Owner or Master may access organizational financial summaries.' USING ERRCODE = '42501';
    END IF;

    -- Calculate calendar month bounds
    v_start_date := make_date(p_year, p_month, 1);
    v_end_date := (v_start_date + interval '1 month - 1 day')::date;

    -- ── 1. Monthly Sales Revenue (Authoritative delivered commercial sales + SAP baseline) ──
    SELECT COALESCE(MAX(imp.cutoff_date), NULL)
    INTO v_cutoff_date
    FROM public.sap_sales_imports imp
    WHERE imp.cutoff_date >= v_start_date AND imp.cutoff_date <= v_end_date;

    SELECT COALESCE(SUM(
        CASE
            WHEN s.net_val IS NOT NULL THEN s.net_val
            WHEN s.is_cancellation THEN -(s.quantity * s.rate)
            ELSE s.quantity * s.rate
        END
    ), 0)
    INTO v_sap_sales
    FROM public.sap_sales_import_items s
    WHERE s.invoice_date >= v_start_date AND s.invoice_date <= v_end_date;

    IF v_sap_sales > 0 THEN
        IF v_cutoff_date IS NOT NULL THEN
            SELECT COALESCE(SUM(d.delivered_amount), 0)
            INTO v_delivery_sales
            FROM public.deliveries d
            WHERE d.status IN ('delivered', 'partial')
              AND d.delivery_date > v_cutoff_date
              AND d.delivery_date <= v_end_date;
        ELSE
            SELECT COALESCE(SUM(d.delivered_amount), 0)
            INTO v_delivery_sales
            FROM public.deliveries d
            WHERE d.status IN ('delivered', 'partial')
              AND d.delivery_date >= v_start_date
              AND d.delivery_date <= v_end_date;
        END IF;
        v_sales_revenue := v_sap_sales + v_delivery_sales;
    ELSE
        SELECT COALESCE(SUM(d.delivered_amount), 0)
        INTO v_sales_revenue
        FROM public.deliveries d
        WHERE d.status IN ('delivered', 'partial')
          AND d.delivery_date >= v_start_date
          AND d.delivery_date <= v_end_date;
    END IF;

    -- Also aggregate route sales breakdown
    SELECT COALESCE(jsonb_agg(r_row), '[]'::jsonb)
    INTO v_sales_by_route
    FROM (
        SELECT
            COALESCE(r.name, 'Unassigned Route') AS route_name,
            COALESCE(r.code, 'N/A') AS route_code,
            COALESCE(SUM(d.delivered_amount), 0) AS sales,
            COUNT(d.id) AS deliveries_count
        FROM public.deliveries d
        LEFT JOIN public.routes r ON d.route_id = r.id
        WHERE d.status IN ('delivered', 'partial')
          AND d.delivery_date >= v_start_date
          AND d.delivery_date <= v_end_date
        GROUP BY r.name, r.code
        ORDER BY sales DESC
    ) r_row;

    -- ── 2. Total Confirmed Monthly SAP Purchase Spend ──
    -- Includes all confirmed/received SAP purchase imports whose gr_date falls in the month
    SELECT
        COALESCE(SUM(COALESCE(pi.total_purchase_cost, pi.received_qty * COALESCE(pi.unit_purchase_cost, 0))), 0),
        COUNT(pi.id),
        COALESCE(SUM(pi.received_qty), 0)
    INTO
        v_purchase_spend,
        v_purchase_items_count,
        v_total_received_qty
    FROM public.sap_purchase_import_items pi
    WHERE (pi.gr_status IN ('Completed', 'Received', 'GR Completed') OR pi.gr_status IS NULL)
      AND pi.gr_date >= v_start_date
      AND pi.gr_date <= v_end_date;

    -- Aggregate purchase batches / imports drilldown
    SELECT
        COUNT(DISTINCT b_row.import_id),
        COALESCE(jsonb_agg(b_row), '[]'::jsonb)
    INTO
        v_purchase_batches_count,
        v_purchase_batches
    FROM (
        SELECT
            pi.import_id,
            COALESCE(imp.batch_ref, 'BATCH-' || to_char(pi.gr_date, 'YYYYMMDD')) AS batch_ref,
            COALESCE(imp.file_name, 'purchase.xlsx') AS file_name,
            pi.gr_date,
            COALESCE(pi.gr_doc_no, 'N/A') AS gr_doc_no,
            COUNT(DISTINCT pi.sku) AS sku_count,
            COUNT(pi.id) AS line_items_count,
            COALESCE(SUM(pi.received_qty), 0) AS total_qty,
            COALESCE(SUM(COALESCE(pi.total_purchase_cost, pi.received_qty * COALESCE(pi.unit_purchase_cost, 0))), 0) AS total_amount
        FROM public.sap_purchase_import_items pi
        LEFT JOIN public.sap_purchase_imports imp ON pi.import_id = imp.id
        WHERE (pi.gr_status IN ('Completed', 'Received', 'GR Completed') OR pi.gr_status IS NULL)
          AND pi.gr_date >= v_start_date
          AND pi.gr_date <= v_end_date
        GROUP BY pi.import_id, imp.batch_ref, imp.file_name, pi.gr_date, pi.gr_doc_no
        ORDER BY pi.gr_date ASC, pi.gr_doc_no ASC
    ) b_row;

    -- ── 3. Monthly Approved Operating Expenses ──
    SELECT COALESCE(SUM(e.amount), 0)
    INTO v_approved_expenses
    FROM public.expenses e
    WHERE e.status = 'approved'
      AND e.date >= v_start_date
      AND e.date <= v_end_date;

    -- Aggregate expense categories drilldown
    SELECT COALESCE(jsonb_agg(e_row), '[]'::jsonb)
    INTO v_expenses_breakdown
    FROM (
        SELECT
            COALESCE(e.category, 'General') AS category,
            COUNT(e.id) AS count,
            COALESCE(SUM(e.amount), 0) AS amount
        FROM public.expenses e
        WHERE e.status = 'approved'
          AND e.date >= v_start_date
          AND e.date <= v_end_date
        GROUP BY e.category
        ORDER BY amount DESC
    ) e_row;

    -- ── 4. Month-End Net Margin Calculation ──
    v_net_margin := v_sales_revenue - v_purchase_spend - v_approved_expenses;

    IF v_sales_revenue > 0 THEN
        v_net_margin_pct := ROUND(((v_net_margin / v_sales_revenue) * 100)::numeric, 2);
    ELSE
        v_net_margin_pct := NULL;
    END IF;

    -- ── 5. Realized Route Profitability (Delivered Goods COGS Basis for Comparison) ──
    -- Calculate realized COGS from delivery items in this period
    WITH sku_wac AS (
        SELECT
            upper(sku) AS sku,
            CASE
                WHEN SUM(received_qty * CASE WHEN upper(COALESCE(uom, 'DOZ')) = 'DOZ' THEN 12 ELSE 1 END) > 0 THEN
                    SUM(COALESCE(total_purchase_cost, received_qty * COALESCE(unit_purchase_cost, 0))) /
                    SUM(received_qty * CASE WHEN upper(COALESCE(uom, 'DOZ')) = 'DOZ' THEN 12 ELSE 1 END)
                ELSE NULL
            END AS wac_cost_ea
        FROM public.sap_purchase_import_items
        WHERE (gr_status IN ('Completed', 'Received', 'GR Completed') OR gr_status IS NULL)
        GROUP BY upper(sku)
    )
    SELECT
        COALESCE(SUM(di.quantity * COALESCE(di.unit_cost, w.wac_cost_ea, 0)), 0)
    INTO v_realized_cogs
    FROM public.delivery_items di
    JOIN public.deliveries d ON di.delivery_id = d.id
    LEFT JOIN sku_wac w ON upper(di.sku) = w.sku
    WHERE d.status IN ('delivered', 'partial')
      AND d.delivery_date >= v_start_date
      AND d.delivery_date <= v_end_date;

    v_realized_gross_profit := v_sales_revenue - v_realized_cogs;
    v_realized_net_profit := v_realized_gross_profit - v_approved_expenses;

    RETURN jsonb_build_object(
        'success', true,
        'year', p_year,
        'month', p_month,
        'start_date', v_start_date,
        'end_date', v_end_date,
        -- Month-End Purchase-Basis Metrics
        'sales_revenue', v_sales_revenue,
        'purchase_spend', v_purchase_spend,
        'approved_expenses', v_approved_expenses,
        'month_end_net_margin', v_net_margin,
        'net_margin_pct', v_net_margin_pct,
        'purchase_batches_count', v_purchase_batches_count,
        'purchase_items_count', v_purchase_items_count,
        'total_received_qty', v_total_received_qty,
        'purchase_batches', v_purchase_batches,
        'sales_by_route', v_sales_by_route,
        'expenses_breakdown', v_expenses_breakdown,
        -- Realized Route COGS & Profit for direct comparison
        'realized_cogs', v_realized_cogs,
        'realized_gross_profit', v_realized_gross_profit,
        'realized_net_profit', v_realized_net_profit,
        'model_label', 'Month-End Net Margin (Purchase Basis)',
        'model_explanation', 'Sales − Confirmed Monthly Purchases − Approved Expenses'
    );
END;
$function$;

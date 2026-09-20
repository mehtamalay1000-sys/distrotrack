-- ============================================================================
-- Migration 038: Fix get_financial_summary JSONB Keys & Add Pending Credit
-- ============================================================================
-- 1. Adds 'sales' alias for total_revenue in get_financial_summary JSONB return
--    so TS code reading finSummaryRes?.sales works correctly alongside total_revenue.
-- 2. Adds 'pending_credit' as an explicit JSONB key (= total_credit).
-- 3. Adds 'cash', 'upi', 'cheque_cleared', 'cheque_pending', 'credit_extended',
--    'expenses', 'net_cash', 'contribution_before_cogs' alias keys for TS
--    dashboard code that reads legacy mapped key names.
-- 4. Adds a get_pending_credit_deliveries function for Admin/Master to see
--    outstanding credit receivables with party details (no RLS bypass needed —
--    uses SECURITY DEFINER with admin_or_master check).
-- ============================================================================

-- ── 1. Update get_financial_summary to include both key families ──────────

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
    v_total_collected numeric(12, 2) := 0;
    v_cash_collected numeric(12, 2) := 0;
    v_upi_collected numeric(12, 2) := 0;
    v_cheque_collected numeric(12, 2) := 0;
    v_total_credit numeric(12, 2) := 0;
    v_total_expenses numeric(12, 2) := 0;
    v_cash_expenses numeric(12, 2) := 0;
    v_bank_expenses numeric(12, 2) := 0;
    v_net_cash_deposit numeric(12, 2) := 0;
    v_cash_discrepancy numeric(12, 2) := 0;
    v_pending_cheques numeric(12, 2) := 0;
    v_bounced_cheques numeric(12, 2) := 0;
    v_total_outstanding numeric(12, 2) := 0;
    v_pending_credit numeric(12, 2) := 0;
BEGIN
    IF NOT public.is_current_user_admin_or_master() THEN
        RAISE EXCEPTION 'Unauthorized: Only Owner or Master may access organizational financial summaries.' USING ERRCODE = '42501';
    END IF;

    -- ── Sales: SUM of delivered_amount from completed/partial deliveries ──
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

    -- ── Collections: SUM from payments table (cash/upi/cheque actually received) ──
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

    -- ── Pending Credit: delivered_amount not yet collected ──
    -- (Sales - Collections for credit deliveries)
    SELECT COALESCE(SUM(GREATEST(0, d.delivered_amount - d.collected_amount)), 0)
    INTO v_total_credit
    FROM public.deliveries d
    LEFT JOIN public.picklists p ON d.picklist_id = p.id
    WHERE d.status IN ('delivered', 'partial')
      AND d.delivered_amount > d.collected_amount
      AND (p_start_date IS NULL OR d.delivery_date >= p_start_date)
      AND (p_end_date IS NULL OR d.delivery_date <= p_end_date)
      AND (p_picklist_id IS NULL OR d.picklist_id = p_picklist_id)
      AND (p_route_id IS NULL OR p.route_id = p_route_id)
      AND (p_worker_id IS NULL OR d.worker_id = p_worker_id);

    v_pending_credit := v_total_credit;

    -- ── Expenses ──
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

    -- ── Route reconciliation data ──
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

    -- ── Outstanding: from party_financial_ledger ──
    SELECT COALESCE(SUM(
        CASE WHEN direction = 'debit' THEN amount ELSE -amount END
    ), 0) INTO v_total_outstanding
    FROM public.party_financial_ledger
    WHERE status = 'valid';

    RETURN jsonb_build_object(
        -- Authoritative RPC keys (canonical names)
        'total_revenue',             v_total_revenue,
        'total_collected',           v_total_collected,
        'cash_collected',            v_cash_collected,
        'upi_collected',             v_upi_collected,
        'cheque_collected',          v_cheque_collected,
        'total_credit',              v_total_credit,
        'pending_credit',            v_pending_credit,
        'total_expenses',            v_total_expenses,
        'cash_expenses',             v_cash_expenses,
        'bank_expenses',             v_bank_expenses,
        'net_cash_deposit',          v_net_cash_deposit,
        'cash_discrepancy',          v_cash_discrepancy,
        'pending_cheques',           v_pending_cheques,
        'bounced_cheques',           v_bounced_cheques,
        'total_outstanding',         v_total_outstanding,
        -- Legacy / TS mapped alias keys for backward compatibility
        'sales',                     v_total_revenue,
        'cash',                      v_cash_collected,
        'upi',                       v_upi_collected,
        'cheque_cleared',            v_cheque_collected - v_pending_cheques,
        'cheque_pending',            v_pending_cheques,
        'credit_extended',           v_total_credit,
        'expenses',                  v_total_expenses,
        'net_cash',                  v_cash_collected - v_cash_expenses,
        'contribution_before_cogs',  v_total_revenue - v_total_expenses
    );
END;
$function$;

-- ── 2. get_pending_credit_deliveries: Admin/Master actionable credit queue ─

CREATE OR REPLACE FUNCTION public.get_pending_credit_deliveries(
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0,
    p_route_id UUID DEFAULT NULL,
    p_worker_id UUID DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_result jsonb;
BEGIN
    IF NOT public.is_current_user_admin_or_master() THEN
        RAISE EXCEPTION 'Unauthorized: Only Owner or Master may access pending credit receivables.' USING ERRCODE = '42501';
    END IF;

    SELECT jsonb_agg(row_to_json(t)) INTO v_result
    FROM (
        SELECT
            d.id AS delivery_id,
            d.delivery_date,
            d.status AS delivery_status,
            d.delivered_amount AS sale_amount,
            d.collected_amount,
            GREATEST(0, d.delivered_amount - d.collected_amount) AS pending_amount,
            d.payment_mode,
            d.picklist_id,
            d.worker_id,
            -- Party info
            pt.id AS party_id,
            pt.name AS party_name,
            pt.code AS party_code,
            -- Invoice info
            inv.invoice_number,
            inv.net_amount AS invoice_amount,
            -- Route info
            r.id AS route_id,
            r.name AS route_name,
            r.code AS route_code,
            -- Worker info
            w.name AS worker_name,
            -- Picklist info
            pl.picklist_number,
            pl.date AS route_date,
            -- Age in days
            EXTRACT(DAY FROM (CURRENT_DATE - d.delivery_date))::integer AS days_outstanding
        FROM public.deliveries d
        LEFT JOIN public.parties pt ON pt.id = d.party_id
        LEFT JOIN public.invoices inv ON inv.id = d.invoice_id
        LEFT JOIN public.picklists pl ON pl.id = d.picklist_id
        LEFT JOIN public.routes r ON r.id = pl.route_id
        LEFT JOIN public.workers w ON w.id = d.worker_id
        WHERE d.status IN ('delivered', 'partial')
          AND d.delivered_amount > d.collected_amount
          AND (p_start_date IS NULL OR d.delivery_date >= p_start_date)
          AND (p_end_date IS NULL OR d.delivery_date <= p_end_date)
          AND (p_route_id IS NULL OR pl.route_id = p_route_id)
          AND (p_worker_id IS NULL OR d.worker_id = p_worker_id)
        ORDER BY d.delivery_date ASC, pt.name ASC
        LIMIT p_limit OFFSET p_offset
    ) t;

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- Grant access to authenticated users (RLS check is inside the function)
GRANT EXECUTE ON FUNCTION public.get_pending_credit_deliveries(integer, integer, uuid, uuid, date, date)
    TO authenticated, service_role;

-- Security hardening
ALTER FUNCTION public.get_pending_credit_deliveries(integer, integer, uuid, uuid, date, date)
    SET search_path = public, pg_temp;

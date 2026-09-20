-- Migration 043: Enhance get_financial_summary with accurate current vs prior collection breakdown
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
BEGIN
    IF NOT public.is_current_user_admin_or_master() THEN
        RAISE EXCEPTION 'Unauthorized: Only Owner or Master may access organizational financial summaries.' USING ERRCODE = '42501';
    END IF;

    -- ── 1. Sales: Commercial sales determined by delivery/sale date ──
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

    -- ── 2. Collections: Actual money received determined by payment date ──
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

    -- ── 3. Collections Breakdown: Current-Period Sales Collected vs Prior-Period Udhari / Advance Collected ──
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

    -- Prior-period collections: total money received this period that did not settle current-period deliveries
    v_prior_period_collected := GREATEST(0, v_total_collected - v_current_period_collected);

    -- ── 4. Credit Sales Created: delivered goods in period not settled at time of delivery ──
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

    -- ── 5. Expenses ──
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

    -- ── 6. Route reconciliation data ──
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

    -- ── 7. Authoritative Outstanding & Advances from party_financial_ledger ──
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

    -- Fallback to credit sales created if ledger has no open balances
    IF v_total_outstanding = 0 AND v_credit_sales_created > 0 THEN
        v_total_outstanding := v_credit_sales_created;
    END IF;

    v_pending_credit := v_total_outstanding;

    RETURN jsonb_build_object(
        'total_revenue',             v_total_revenue,
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
        'total_expenses',            v_total_expenses,
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

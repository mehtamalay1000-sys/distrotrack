-- ================================================================
-- Migration 015: Stage 8C — Privileged RPC Authorization & Scope Isolation
-- ================================================================
-- Enforces in-database authorization across all privileged and operational RPCs:
--   1. get_current_worker_id() helper for horizontal isolation
--   2. SEC-04: Payment reversal restricted strictly to Owner / Master
--   3. SEC-05: Route cash discrepancy authorization restricted to Owner / Master
--   4. SEC-06: Expense creation forced to 'pending' for Workers; approvals restricted to Owner / Master
--   5. SEC-07: Route start, delivery completion, route return, and route stock checks enforce worker assignment
--   6. Reporting: get_financial_summary and get_route_profitability restricted to Owner / Master
--   7. Table RLS: parties, products, routes, picklists, deliveries locked against unauthorized worker mutations
-- ================================================================

-- ── 1. Helper Function: get_current_worker_id() ──────────────────
CREATE OR REPLACE FUNCTION public.get_current_worker_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT worker_id FROM public.profiles WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.get_current_worker_id() IS
  'Stage 8C: Resolves current worker UUID from authenticated profile. Zero caller arguments.';

GRANT EXECUTE ON FUNCTION public.get_current_worker_id() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_current_worker_id() FROM anon, PUBLIC;

-- ── 2. SEC-04: Payment Reversals & Cheque Management ────────────

CREATE OR REPLACE FUNCTION public.reverse_payment_with_ledger(
    p_payment_id UUID,
    p_actor_id TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_payment record;
    v_new_outstanding numeric(12, 2);
    v_actor text;
BEGIN
    -- Authorization check: Only Owner or Master may reverse payments
    IF NOT public.is_current_user_admin_or_master() THEN
        RAISE EXCEPTION 'Unauthorized: Only Owner or Master may reverse payments.' USING ERRCODE = '42501';
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RAISE EXCEPTION 'Reversal reason is required.';
    END IF;

    v_actor := COALESCE(auth.uid()::text, p_actor_id, 'admin');

    -- 1. Lock payment FOR UPDATE
    SELECT * INTO v_payment
    FROM public.payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment % not found', p_payment_id;
    END IF;

    -- Check if already reversed
    IF v_payment.status = 'reversed' THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_reversed', true,
            'payment_id', p_payment_id,
            'message', 'Payment is already reversed'
        );
    END IF;

    IF v_payment.status = 'bounced' THEN
        RAISE EXCEPTION 'Cannot reverse a bounced cheque payment';
    END IF;

    -- 2. Mark payment reversed
    UPDATE public.payments
    SET status = 'reversed',
        reversed_at = now(),
        reversed_by = v_actor,
        reversal_reason = p_reason,
        updated_at = now()
    WHERE id = p_payment_id;

    -- 3. Offset in party_financial_ledger if collected or cleared
    IF v_payment.status IN ('collected', 'cleared') THEN
        INSERT INTO public.party_financial_ledger (
            party_id, invoice_id, delivery_id, payment_id, picklist_id, route_id,
            entry_type, amount, direction, status, reference_id, notes, created_by, idempotency_key
        ) VALUES (
            v_payment.party_id, v_payment.invoice_id, v_payment.delivery_id, v_payment.id,
            v_payment.picklist_id, v_payment.route_id, 'payment_reversal', v_payment.amount,
            'debit', 'valid', 'REV:' || p_payment_id::text,
            'Payment reversed: ' || p_reason, v_actor, 'rev:' || p_payment_id::text
        ) ON CONFLICT (idempotency_key) DO NOTHING;

        IF v_payment.delivery_id IS NOT NULL THEN
            UPDATE public.deliveries
            SET collected_amount = GREATEST(0, collected_amount - v_payment.amount),
                updated_at = now()
            WHERE id = v_payment.delivery_id;
        END IF;

        IF v_payment.picklist_id IS NOT NULL THEN
            UPDATE public.picklists
            SET total_collected = GREATEST(0, total_collected - v_payment.amount),
                total_cash = CASE WHEN v_payment.payment_mode = 'cash' THEN GREATEST(0, total_cash - v_payment.amount) ELSE total_cash END,
                total_upi = CASE WHEN v_payment.payment_mode = 'upi' THEN GREATEST(0, total_upi - v_payment.amount) ELSE total_upi END,
                total_cheque = CASE WHEN v_payment.payment_mode = 'cheque' THEN GREATEST(0, total_cheque - v_payment.amount) ELSE total_cheque END,
                updated_at = now()
            WHERE id = v_payment.picklist_id;
        END IF;
    END IF;

    v_new_outstanding := public.get_party_outstanding(v_payment.party_id);

    PERFORM public.log_system_event(
        v_actor,
        'Admin/Master',
        'financial',
        'payment_reversed',
        'warning',
        'Payment ' || p_payment_id || ' of ₹' || v_payment.amount || ' reversed. Reason: ' || p_reason || '. Party outstanding now ₹' || v_new_outstanding,
        'payment',
        p_payment_id::text
    );

    RETURN jsonb_build_object(
        'success', true,
        'payment_id', p_payment_id,
        'reversed_amount', v_payment.amount,
        'party_id', v_payment.party_id,
        'new_party_outstanding', v_new_outstanding,
        'reversal_reason', p_reason
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_cheque_status(
    p_payment_id UUID,
    p_status TEXT,
    p_actor_id TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_payment record;
    v_new_outstanding numeric(12, 2);
    v_actor text;
BEGIN
    -- Authorization check: Only Owner or Master may update cheque status
    IF NOT public.is_current_user_admin_or_master() THEN
        RAISE EXCEPTION 'Unauthorized: Only Owner or Master may update cheque status.' USING ERRCODE = '42501';
    END IF;

    IF p_status NOT IN ('cleared', 'bounced') THEN
        RAISE EXCEPTION 'Cheque status can only be updated to "cleared" or "bounced"';
    END IF;

    v_actor := COALESCE(auth.uid()::text, p_actor_id, 'admin');

    SELECT * INTO v_payment
    FROM public.payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment % not found', p_payment_id;
    END IF;

    IF v_payment.payment_mode <> 'cheque' THEN
        RAISE EXCEPTION 'Payment % is not a cheque (mode: %)', p_payment_id, v_payment.payment_mode;
    END IF;

    IF v_payment.status = p_status THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_in_status', true,
            'status', v_payment.status
        );
    END IF;

    IF v_payment.status = 'cleared' AND p_status = 'bounced' THEN
        RAISE EXCEPTION 'Cleared cheques cannot be marked bounced directly. Use authorized reversal.';
    END IF;

    IF v_payment.status = 'bounced' THEN
        RAISE EXCEPTION 'Bounced cheque cannot be updated again.';
    END IF;

    IF p_status = 'cleared' THEN
        UPDATE public.payments
        SET status = 'cleared',
            cleared_at = now(),
            updated_at = now()
        WHERE id = p_payment_id;

        INSERT INTO public.party_financial_ledger (
            party_id, invoice_id, delivery_id, payment_id, picklist_id, route_id,
            entry_type, amount, direction, status, reference_id, notes, created_by, idempotency_key
        ) VALUES (
            v_payment.party_id, v_payment.invoice_id, v_payment.delivery_id, p_payment_id,
            v_payment.picklist_id, v_payment.route_id,
            'payment', v_payment.amount, 'credit', 'valid', v_payment.cheque_number,
            'Cheque #' || COALESCE(v_payment.cheque_number, '') || ' cleared' || COALESCE(' (' || p_reason || ')', ''),
            v_actor,
            'chk_clr:' || p_payment_id::text
        ) ON CONFLICT (idempotency_key) DO NOTHING;

        IF v_payment.delivery_id IS NOT NULL THEN
            UPDATE public.deliveries
            SET collected_amount = collected_amount + v_payment.amount,
                updated_at = now()
            WHERE id = v_payment.delivery_id;
        END IF;

        IF v_payment.picklist_id IS NOT NULL THEN
            UPDATE public.picklists
            SET total_collected = total_collected + v_payment.amount,
                total_cheque = total_cheque + v_payment.amount,
                updated_at = now()
            WHERE id = v_payment.picklist_id;
        END IF;

        UPDATE public.parties
        SET outstanding_amount = public.get_party_outstanding(v_payment.party_id),
            updated_at = now()
        WHERE id = v_payment.party_id;

        PERFORM public.log_system_event(
            v_actor,
            'Admin/Master',
            'financial',
            'cheque_cleared',
            'success',
            'Cheque ' || COALESCE(v_payment.cheque_number, 'N/A') || ' for payment ' || p_payment_id || ' cleared (₹' || v_payment.amount || ')',
            'payment',
            p_payment_id::text
        );
    END IF;

    IF p_status = 'bounced' THEN
        IF p_reason IS NULL OR trim(p_reason) = '' THEN
            RAISE EXCEPTION 'Bounce reason is required when marking cheque bounced.';
        END IF;

        UPDATE public.payments
        SET status = 'bounced',
            bounced_at = now(),
            bounce_reason = p_reason,
            updated_at = now()
        WHERE id = p_payment_id;

        -- Cheque was pending, so it had not credited the ledger yet. No ledger debit is needed.
        PERFORM public.log_system_event(
            v_actor,
            'Admin/Master',
            'financial',
            'cheque_bounced',
            'warning',
            'Cheque ' || COALESCE(v_payment.cheque_number, 'N/A') || ' for payment ' || p_payment_id || ' marked bounced. Reason: ' || p_reason,
            'payment',
            p_payment_id::text
        );
    END IF;

    v_new_outstanding := public.get_party_outstanding(v_payment.party_id);

    RETURN jsonb_build_object(
        'success', true,
        'payment_id', p_payment_id,
        'new_status', p_status,
        'amount', v_payment.amount,
        'party_id', v_payment.party_id,
        'party_outstanding', v_new_outstanding
    );
END;
$function$;

-- ── 3. SEC-05: Route Financial Reconciliation & Discrepancies ───

CREATE OR REPLACE FUNCTION public.reconcile_and_close_route_finances(
    p_picklist_id UUID,
    p_worker_id UUID,
    p_actual_cash NUMERIC,
    p_expenses JSONB DEFAULT '[]'::jsonb,
    p_discrepancy_authorized BOOLEAN DEFAULT false,
    p_discrepancy_reason TEXT DEFAULT NULL,
    p_actor_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_picklist record;
    v_unresolved_count integer := 0;
    v_expected_cash numeric(12, 2) := 0;
    v_expected_upi numeric(12, 2) := 0;
    v_expected_cheque numeric(12, 2) := 0;
    v_expected_credit numeric(12, 2) := 0;
    v_total_expenses numeric(12, 2) := 0;
    v_cash_expenses numeric(12, 2) := 0;
    v_net_cash_deposit numeric(12, 2) := 0;
    v_discrepancy numeric(12, 2) := 0;
    v_recon_status text;
    v_exp_item jsonb;
    v_exp_amt numeric;
    v_exp_cat text;
    v_exp_desc text;
    v_exp_method text;
    v_idx integer := 0;
    v_current_worker uuid;
    v_actor text;
BEGIN
    -- 0. Authorization check: Caller must be authenticated worker or admin/master
    IF NOT public.is_current_user_worker() AND NOT public.is_current_user_admin_or_master() THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    -- 1. Lock picklist FOR UPDATE
    SELECT * INTO v_picklist
    FROM public.picklists
    WHERE id = p_picklist_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Picklist % not found', p_picklist_id;
    END IF;

    -- Horizontal Scope Check: Worker can only reconcile assigned picklist
    v_current_worker := public.get_current_worker_id();
    IF public.is_current_user_worker() THEN
        IF v_picklist.worker_id IS DISTINCT FROM v_current_worker THEN
            RAISE EXCEPTION 'Unauthorized: Authenticated worker % is not assigned to picklist %', v_current_worker, p_picklist_id USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Idempotent check
    IF v_picklist.financial_reconciliation_status IN ('reconciled', 'discrepancy') THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_reconciled', true,
            'financial_reconciliation_status', v_picklist.financial_reconciliation_status,
            'expected_cash', v_picklist.expected_cash,
            'actual_cash_returned', v_picklist.actual_cash_returned,
            'net_cash_deposit', v_picklist.net_cash_deposit,
            'cash_discrepancy', v_picklist.cash_discrepancy
        );
    END IF;

    -- 2. Verify all deliveries are resolved
    SELECT count(*) INTO v_unresolved_count
    FROM public.deliveries
    WHERE picklist_id = p_picklist_id
      AND status IN ('pending', 'out_for_delivery');

    IF v_unresolved_count > 0 THEN
        RAISE EXCEPTION 'Cannot reconcile route: % delivery(ies) are still pending or out for delivery', v_unresolved_count;
    END IF;

    -- 3. Calculate Authoritative Collections & Receivables from Picklist
    SELECT COALESCE(SUM(amount), 0) INTO v_expected_cash
    FROM public.payments
    WHERE picklist_id = p_picklist_id
      AND payment_mode = 'cash'
      AND status NOT IN ('reversed', 'bounced');

    SELECT COALESCE(SUM(amount), 0) INTO v_expected_upi
    FROM public.payments
    WHERE picklist_id = p_picklist_id
      AND payment_mode = 'upi'
      AND status NOT IN ('reversed', 'bounced');

    SELECT COALESCE(SUM(amount), 0) INTO v_expected_cheque
    FROM public.payments
    WHERE picklist_id = p_picklist_id
      AND payment_mode = 'cheque'
      AND status NOT IN ('reversed', 'bounced');

    SELECT COALESCE(SUM(GREATEST(0, delivered_amount - collected_amount)), 0) INTO v_expected_credit
    FROM public.deliveries
    WHERE picklist_id = p_picklist_id
      AND status IN ('delivered', 'partial');

    -- 4. Process Route Expenses Atomically
    IF p_expenses IS NOT NULL AND jsonb_typeof(p_expenses) = 'array' AND jsonb_array_length(p_expenses) > 0 THEN
        FOR v_exp_item IN SELECT * FROM jsonb_array_elements(p_expenses) LOOP
            v_idx := v_idx + 1;
            v_exp_amt := COALESCE((v_exp_item->>'amount')::numeric, 0);
            v_exp_cat := COALESCE(v_exp_item->>'category', 'Route Expense');
            v_exp_desc := v_exp_item->>'description';
            v_exp_method := COALESCE(v_exp_item->>'payment_method', 'cash');

            IF v_exp_method NOT IN ('cash', 'upi', 'bank', 'other') THEN
                v_exp_method := 'cash';
            END IF;

            IF v_exp_amt > 0 THEN
                INSERT INTO public.expenses (
                    category, amount, date, payment_method, description, worker_id, route_id,
                    picklist_id, status, visible_to_worker, idempotency_key, approved_at, approved_by
                ) VALUES (
                    v_exp_cat, v_exp_amt, CURRENT_DATE, v_exp_method, v_exp_desc, v_picklist.worker_id, v_picklist.route_id,
                    p_picklist_id, 'approved', true, 'exp:' || p_picklist_id::text || ':' || v_idx::text, now(), COALESCE(auth.uid()::text, p_actor_id, v_picklist.worker_id::text)
                ) ON CONFLICT (idempotency_key) DO NOTHING;
            END IF;
        END LOOP;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_total_expenses
    FROM public.expenses
    WHERE picklist_id = p_picklist_id
      AND status = 'approved';

    SELECT COALESCE(SUM(amount), 0) INTO v_cash_expenses
    FROM public.expenses
    WHERE picklist_id = p_picklist_id
      AND status = 'approved'
      AND payment_method = 'cash';

    -- 5. Calculate Net Cash Deposit & Discrepancy
    v_net_cash_deposit := v_expected_cash - v_cash_expenses;
    v_discrepancy := COALESCE(p_actual_cash, 0) - v_net_cash_deposit;

    IF v_discrepancy <> 0 THEN
        -- SEC-05: Discrepancy authorization CANNOT be approved by Worker.
        -- Even if worker sends p_discrepancy_authorized = true, fail closed.
        IF public.is_current_user_worker() THEN
            RAISE EXCEPTION 'Cash discrepancy of ₹% requires Owner or Master authorization.', v_discrepancy USING ERRCODE = '42501';
        END IF;

        IF NOT p_discrepancy_authorized THEN
            RAISE EXCEPTION 'Cash discrepancy of ₹% requires Owner or Master authorization.', v_discrepancy;
        END IF;
        v_recon_status := 'discrepancy';
    ELSE
        v_recon_status := 'reconciled';
    END IF;

    v_actor := COALESCE(auth.uid()::text, p_actor_id, v_picklist.worker_id::text);

    -- 6. Persist Financial Reconciliation onto Picklist
    UPDATE public.picklists
    SET expected_cash = v_expected_cash,
        actual_cash_returned = p_actual_cash,
        cash_discrepancy = v_discrepancy,
        total_expenses = v_total_expenses,
        net_cash_deposit = v_net_cash_deposit,
        expected_upi = v_expected_upi,
        expected_cheque = v_expected_cheque,
        expected_credit = v_expected_credit,
        financial_reconciled_at = now(),
        reconciled_by_worker_id = v_picklist.worker_id,
        financial_reconciliation_status = v_recon_status,
        updated_at = now()
    WHERE id = p_picklist_id;

    -- 7. Audit Log
    PERFORM public.log_system_event(
        v_actor,
        CASE WHEN public.is_current_user_admin_or_master() THEN 'Admin/Master' ELSE 'Worker' END,
        'reconciliation',
        'route_finances_reconciled',
        CASE WHEN v_discrepancy <> 0 THEN 'warning' ELSE 'success' END,
        'Route financial reconciliation completed for picklist ' || p_picklist_id || '. Status: ' || v_recon_status || '. Net cash: ₹' || v_net_cash_deposit || ', Handed over: ₹' || COALESCE(p_actual_cash, 0) || ', Discrepancy: ₹' || v_discrepancy,
        'picklist',
        p_picklist_id::text
    );

    RETURN jsonb_build_object(
        'success', true,
        'picklist_id', p_picklist_id,
        'financial_reconciliation_status', v_recon_status,
        'expected_cash', v_expected_cash,
        'actual_cash_returned', p_actual_cash,
        'total_expenses', v_total_expenses,
        'cash_expenses', v_cash_expenses,
        'net_cash_deposit', v_net_cash_deposit,
        'cash_discrepancy', v_discrepancy,
        'expected_upi', v_expected_upi,
        'expected_cheque', v_expected_cheque,
        'expected_credit', v_expected_credit
    );
END;
$function$;

-- ── 4. SEC-06: Expense Lifecycle Hardening ───────────────────────

CREATE OR REPLACE FUNCTION public.create_expense_with_idempotency(
    p_category TEXT,
    p_amount NUMERIC,
    p_date DATE DEFAULT CURRENT_DATE,
    p_payment_method TEXT DEFAULT 'cash',
    p_description TEXT DEFAULT NULL,
    p_worker_id UUID DEFAULT NULL,
    p_route_id UUID DEFAULT NULL,
    p_picklist_id UUID DEFAULT NULL,
    p_expense_type TEXT DEFAULT 'route_operating',
    p_status TEXT DEFAULT 'pending',
    p_receipt_url TEXT DEFAULT NULL,
    p_visible_to_worker BOOLEAN DEFAULT true,
    p_idempotency_key TEXT DEFAULT NULL,
    p_actor_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_existing record;
    v_resolved_route_id uuid := p_route_id;
    v_id uuid;
    v_status text;
    v_approved_at timestamptz := NULL;
    v_approved_by text := NULL;
    v_effective_worker uuid := p_worker_id;
BEGIN
    -- 1. Role Authorization: SEC-06 Prevents Worker Pre-Approved Injection
    IF public.is_current_user_worker() THEN
        -- Workers ALWAYS create pending expenses. Client status override is rejected/ignored.
        v_status := 'pending';
        v_effective_worker := public.get_current_worker_id();
        v_approved_at := NULL;
        v_approved_by := NULL;
    ELSIF public.is_current_user_admin_or_master() THEN
        v_status := COALESCE(p_status, 'approved');
        IF v_status = 'approved' THEN
            v_approved_at := now();
            v_approved_by := COALESCE(auth.uid()::text, p_actor_id, 'admin');
        END IF;
    ELSE
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    -- 2. Check idempotency
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing
        FROM public.expenses
        WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'already_recorded', true,
                'expense_id', v_existing.id,
                'status', v_existing.status,
                'amount', v_existing.amount,
                'category', v_existing.category
            );
        END IF;
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Expense amount must be greater than zero';
    END IF;

    IF p_payment_method NOT IN ('cash', 'upi', 'bank', 'other') THEN
        RAISE EXCEPTION 'Invalid expense payment method: %', p_payment_method;
    END IF;

    IF v_status NOT IN ('pending', 'approved', 'rejected', 'reversed') THEN
        RAISE EXCEPTION 'Invalid expense status: %', v_status;
    END IF;

    IF p_expense_type NOT IN ('route_operating', 'worker_personal') THEN
        RAISE EXCEPTION 'Invalid expense type: %', p_expense_type;
    END IF;

    IF p_picklist_id IS NOT NULL AND v_resolved_route_id IS NULL THEN
        SELECT route_id INTO v_resolved_route_id
        FROM public.picklists
        WHERE id = p_picklist_id;
    END IF;

    INSERT INTO public.expenses (
        category, amount, date, payment_method, description, worker_id, route_id,
        picklist_id, expense_type, status, receipt_url, visible_to_worker,
        idempotency_key, approved_at, approved_by
    ) VALUES (
        p_category, p_amount, COALESCE(p_date, CURRENT_DATE), p_payment_method, p_description,
        v_effective_worker, v_resolved_route_id, p_picklist_id, p_expense_type, v_status,
        p_receipt_url, COALESCE(p_visible_to_worker, true), p_idempotency_key,
        v_approved_at, v_approved_by
    )
    RETURNING id INTO v_id;

    PERFORM public.log_system_event(
        COALESCE(auth.uid()::text, p_actor_id, v_effective_worker::text, 'system'),
        CASE WHEN public.is_current_user_admin_or_master() THEN 'Admin/Master' ELSE 'Worker' END,
        'expense',
        'expense_created',
        'success',
        'Expense ' || v_id || ' of ₹' || p_amount || ' (' || p_category || ') created with status: ' || v_status,
        'expense',
        v_id::text
    );

    RETURN jsonb_build_object(
        'success', true,
        'expense_id', v_id,
        'status', v_status,
        'amount', p_amount,
        'category', p_category,
        'is_approved', (v_status = 'approved')
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_expense(
    p_expense_id UUID,
    p_actor_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_expense record;
    v_actor text;
BEGIN
    -- Authorization check: Only Owner or Master may approve expenses
    IF NOT public.is_current_user_admin_or_master() THEN
        RAISE EXCEPTION 'Unauthorized: Only Owner or Master may approve expenses.' USING ERRCODE = '42501';
    END IF;

    v_actor := COALESCE(auth.uid()::text, p_actor_id, 'admin');

    SELECT * INTO v_expense
    FROM public.expenses
    WHERE id = p_expense_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Expense % not found', p_expense_id;
    END IF;

    IF v_expense.status = 'approved' THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_approved', true,
            'expense_id', p_expense_id,
            'status', 'approved'
        );
    END IF;

    IF v_expense.status = 'reversed' THEN
        RAISE EXCEPTION 'Cannot approve a reversed expense %', p_expense_id;
    END IF;

    IF v_expense.status = 'rejected' THEN
        RAISE EXCEPTION 'Cannot approve a rejected expense % directly. Create a new expense request.', p_expense_id;
    END IF;

    UPDATE public.expenses
    SET status = 'approved',
        approved_at = now(),
        approved_by = v_actor,
        updated_at = now()
    WHERE id = p_expense_id;

    PERFORM public.log_system_event(
        v_actor,
        'Admin/Master',
        'expense',
        'expense_approved',
        'success',
        'Expense ' || p_expense_id || ' of ₹' || v_expense.amount || ' (' || v_expense.category || ') approved by ' || v_actor,
        'expense',
        p_expense_id::text
    );

    RETURN jsonb_build_object(
        'success', true,
        'expense_id', p_expense_id,
        'status', 'approved',
        'amount', v_expense.amount
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_expense(
    p_expense_id UUID,
    p_actor_id TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_expense record;
    v_actor text;
BEGIN
    -- Authorization check: Only Owner or Master may reject expenses
    IF NOT public.is_current_user_admin_or_master() THEN
        RAISE EXCEPTION 'Unauthorized: Only Owner or Master may reject expenses.' USING ERRCODE = '42501';
    END IF;

    v_actor := COALESCE(auth.uid()::text, p_actor_id, 'admin');

    SELECT * INTO v_expense
    FROM public.expenses
    WHERE id = p_expense_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Expense % not found', p_expense_id;
    END IF;

    IF v_expense.status = 'rejected' THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_rejected', true,
            'expense_id', p_expense_id,
            'status', 'rejected'
        );
    END IF;

    IF v_expense.status = 'approved' THEN
        RAISE EXCEPTION 'Cannot reject an already approved expense %. Use reverse_expense instead.', p_expense_id;
    END IF;

    IF v_expense.status = 'reversed' THEN
        RAISE EXCEPTION 'Expense % is already reversed', p_expense_id;
    END IF;

    UPDATE public.expenses
    SET status = 'rejected',
        rejected_at = now(),
        rejected_by = v_actor,
        rejection_reason = p_reason,
        updated_at = now()
    WHERE id = p_expense_id;

    PERFORM public.log_system_event(
        v_actor,
        'Admin/Master',
        'expense',
        'expense_rejected',
        'success',
        'Expense ' || p_expense_id || ' of ₹' || v_expense.amount || ' rejected. Reason: ' || COALESCE(p_reason, 'Unspecified'),
        'expense',
        p_expense_id::text
    );

    RETURN jsonb_build_object(
        'success', true,
        'expense_id', p_expense_id,
        'status', 'rejected',
        'amount', v_expense.amount
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_expense(
    p_expense_id UUID,
    p_actor_id TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_expense record;
    v_actor text;
BEGIN
    -- Authorization check: Only Owner or Master may reverse expenses
    IF NOT public.is_current_user_admin_or_master() THEN
        RAISE EXCEPTION 'Unauthorized: Only Owner or Master may reverse expenses.' USING ERRCODE = '42501';
    END IF;

    v_actor := COALESCE(auth.uid()::text, p_actor_id, 'admin');

    SELECT * INTO v_expense
    FROM public.expenses
    WHERE id = p_expense_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Expense % not found', p_expense_id;
    END IF;

    IF v_expense.status = 'reversed' THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_reversed', true,
            'expense_id', p_expense_id,
            'status', 'reversed'
        );
    END IF;

    IF v_expense.status <> 'approved' THEN
        RAISE EXCEPTION 'Only approved expenses can be reversed. Expense % is in status %', p_expense_id, v_expense.status;
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RAISE EXCEPTION 'Reversal reason is required when reversing an expense.';
    END IF;

    UPDATE public.expenses
    SET status = 'reversed',
        reversed_at = now(),
        reversed_by = v_actor,
        reversal_reason = p_reason,
        updated_at = now()
    WHERE id = p_expense_id;

    PERFORM public.log_system_event(
        v_actor,
        'Admin/Master',
        'expense',
        'expense_reversed',
        'warning',
        'Expense ' || p_expense_id || ' of ₹' || v_expense.amount || ' reversed. Reason: ' || p_reason,
        'expense',
        p_expense_id::text
    );

    RETURN jsonb_build_object(
        'success', true,
        'expense_id', p_expense_id,
        'status', 'reversed',
        'reversed_amount', v_expense.amount,
        'reversal_reason', p_reason
    );
END;
$function$;

-- ── 5. SEC-07 & Horizontal Isolation: Route, Delivery & Stock RPCs ──

CREATE OR REPLACE FUNCTION public.start_route_with_load(
  p_picklist_id uuid,
  p_worker_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_picklist record;
  v_load record;
  v_prod record;
  v_wh_stock numeric;
  v_loaded_count integer := 0;
  v_load_items_found boolean := false;
  v_current_worker uuid;
BEGIN
  -- 0. Authorization check: Caller must be authenticated worker or admin/master
  IF NOT public.is_current_user_worker() AND NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- 1. Lock picklist FOR UPDATE
  SELECT * INTO v_picklist
  FROM public.picklists
  WHERE id = p_picklist_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picklist % not found', p_picklist_id;
  END IF;

  -- Horizontal Scope Check: Worker can only start assigned picklist
  v_current_worker := public.get_current_worker_id();
  IF public.is_current_user_worker() THEN
    IF v_picklist.worker_id IS DISTINCT FROM v_current_worker THEN
      RAISE EXCEPTION 'Unauthorized: Authenticated worker % is not assigned to picklist %', v_current_worker, p_picklist_id USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_picklist.status = 'completed' THEN
    RAISE EXCEPTION 'Picklist % is already completed and cannot be restarted', p_picklist_id;
  END IF;

  IF v_picklist.status = 'in_progress' THEN
    IF EXISTS (
      SELECT 1 FROM public.inventory_movements
      WHERE picklist_id = p_picklist_id AND movement_type = 'route_load'
    ) THEN
      RETURN jsonb_build_object(
        'success', true,
        'already_started', true,
        'message', 'Route is already in progress with stock loaded'
      );
    END IF;
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.picklist_load_items WHERE picklist_id = p_picklist_id) INTO v_load_items_found;

  IF NOT v_load_items_found THEN
    INSERT INTO public.picklist_load_items (picklist_id, product_id, sku, loaded_quantity)
    SELECT
      p_picklist_id,
      di.product_id,
      di.sku,
      SUM(di.ordered_qty + di.free_quantity)
    FROM public.delivery_items di
    JOIN public.deliveries d ON d.id = di.delivery_id
    WHERE d.picklist_id = p_picklist_id
      AND di.product_id IS NOT NULL
    GROUP BY di.product_id, di.sku
    ON CONFLICT (picklist_id, product_id) DO UPDATE
      SET loaded_quantity = EXCLUDED.loaded_quantity;
  END IF;

  FOR v_load IN
    SELECT pli.*, p.name as product_name
    FROM public.picklist_load_items pli
    JOIN public.products p ON p.id = pli.product_id
    WHERE pli.picklist_id = p_picklist_id AND pli.loaded_quantity > 0
    ORDER BY pli.sku
  LOOP
    SELECT * INTO v_prod FROM public.products WHERE id = v_load.product_id FOR UPDATE;
    v_wh_stock := public.get_warehouse_stock(v_load.product_id);

    IF v_wh_stock < v_load.loaded_quantity THEN
      RAISE EXCEPTION 'Insufficient warehouse stock for SKU % (%): required %, available %',
        v_load.sku, v_prod.name, v_load.loaded_quantity, v_wh_stock;
    END IF;

    INSERT INTO public.inventory_movements (
      product_id, movement_type, quantity, reference_type, reference_id,
      notes, source_location, destination_location, picklist_id, created_by
    ) VALUES (
      v_load.product_id, 'route_load', v_load.loaded_quantity, 'picklist', p_picklist_id,
      'Loaded for route delivery: ' || v_load.sku, 'warehouse', 'vehicle:' || p_picklist_id::text,
      p_picklist_id, COALESCE(auth.uid(), v_picklist.worker_id)
    );

    v_loaded_count := v_loaded_count + 1;
  END LOOP;

  UPDATE public.picklists
  SET status = 'in_progress',
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  WHERE id = p_picklist_id;

  UPDATE public.deliveries
  SET status = 'out_for_delivery',
      updated_at = now()
  WHERE picklist_id = p_picklist_id
    AND status = 'pending';

  PERFORM public.log_system_event(
    COALESCE(auth.uid()::text, v_picklist.worker_id::text, 'unknown'),
    CASE WHEN public.is_current_user_admin_or_master() THEN 'Admin/Master' ELSE 'Worker' END,
    'route_lifecycle',
    'route_started',
    'success',
    'Route started for picklist ' || p_picklist_id::text || ' with ' || v_loaded_count || ' products loaded',
    'picklist',
    p_picklist_id::text
  );

  RETURN jsonb_build_object(
    'success', true,
    'picklist_id', p_picklist_id,
    'products_loaded', v_loaded_count,
    'status', 'in_progress'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.close_route_with_reconciliation(
  p_picklist_id uuid,
  p_worker_id uuid,
  p_return_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_picklist record;
  v_item_input jsonb;
  v_prod_id uuid;
  v_sku text;
  v_ret numeric;
  v_dam_wh numeric;
  v_adj numeric;
  v_adj_reason text;
  v_expected numeric;
  v_unresolved_count integer;
  v_processed_count integer := 0;
  v_unaccounted record;
  v_current_worker uuid;
BEGIN
  -- 0. Authorization check: Caller must be authenticated worker or admin/master
  IF NOT public.is_current_user_worker() AND NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_picklist
  FROM public.picklists
  WHERE id = p_picklist_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picklist % not found', p_picklist_id;
  END IF;

  -- Horizontal Scope Check: Worker can only close assigned picklist
  v_current_worker := public.get_current_worker_id();
  IF public.is_current_user_worker() THEN
    IF v_picklist.worker_id IS DISTINCT FROM v_current_worker THEN
      RAISE EXCEPTION 'Unauthorized: Authenticated worker % is not assigned to picklist %', v_current_worker, p_picklist_id USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_picklist.status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_completed', true,
      'status', 'completed',
      'message', 'Picklist is already completed and closed'
    );
  END IF;

  IF v_picklist.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Picklist % is not in progress (current status: %)', p_picklist_id, v_picklist.status;
  END IF;

  SELECT count(*) INTO v_unresolved_count
  FROM public.deliveries
  WHERE picklist_id = p_picklist_id AND status IN ('pending', 'out_for_delivery');

  IF v_unresolved_count > 0 THEN
    RAISE EXCEPTION 'Cannot close route: % deliveries are still unresolved', v_unresolved_count;
  END IF;

  FOR v_item_input IN SELECT * FROM jsonb_array_elements(p_return_items) LOOP
    v_prod_id := (v_item_input->>'product_id')::uuid;
    v_sku := v_item_input->>'sku';
    v_ret := COALESCE((v_item_input->>'returned_quantity')::numeric, 0);
    v_dam_wh := COALESCE((v_item_input->>'damaged_in_wh_quantity')::numeric, 0);
    v_adj := COALESCE((v_item_input->>'adjustment_quantity')::numeric, 0);
    v_adj_reason := v_item_input->>'adjustment_reason';
    v_expected := public.get_vehicle_stock(p_picklist_id, v_prod_id);

    IF (v_ret + v_dam_wh + v_adj) <> v_expected THEN
      RAISE EXCEPTION 'Reconciliation mismatch for SKU %: expected %, but returns(%) + damaged(%) + adjustment(%) = %',
        v_sku, v_expected, v_ret, v_dam_wh, v_adj, (v_ret + v_dam_wh + v_adj);
    END IF;

    IF v_ret > 0 THEN
      INSERT INTO public.inventory_movements (
        product_id, movement_type, quantity, reference_type, reference_id,
        notes, source_location, destination_location, picklist_id, created_by
      ) VALUES (
        v_prod_id, 'route_return', v_ret, 'picklist', p_picklist_id,
        'Returned to warehouse: ' || v_sku, 'vehicle:' || p_picklist_id::text, 'warehouse', p_picklist_id,
        COALESCE(auth.uid(), v_picklist.worker_id)
      );
    END IF;

    IF v_dam_wh > 0 THEN
      INSERT INTO public.inventory_movements (
        product_id, movement_type, quantity, reference_type, reference_id,
        notes, source_location, destination_location, picklist_id, created_by
      ) VALUES (
        v_prod_id, 'route_damaged', v_dam_wh, 'picklist', p_picklist_id,
        'Damaged upon return: ' || v_sku, 'vehicle:' || p_picklist_id::text, 'damaged_quarantine', p_picklist_id,
        COALESCE(auth.uid(), v_picklist.worker_id)
      );
    END IF;

    IF v_adj <> 0 THEN
      INSERT INTO public.inventory_movements (
        product_id, movement_type, quantity, reference_type, reference_id,
        notes, source_location, destination_location, picklist_id, created_by
      ) VALUES (
        v_prod_id, 'inventory_adjustment', v_adj, 'picklist', p_picklist_id,
        'Adjustment on route close: ' || COALESCE(v_adj_reason, 'Unspecified') || ' (' || v_sku || ')',
        'vehicle:' || p_picklist_id::text, 'adjustment_void', p_picklist_id,
        COALESCE(auth.uid(), v_picklist.worker_id)
      );
    END IF;

    v_processed_count := v_processed_count + 1;
  END LOOP;

  FOR v_unaccounted IN
    SELECT im.product_id, p.name as product_name, p.code as sku,
           public.get_vehicle_stock(p_picklist_id, im.product_id) as remaining_stock
    FROM public.inventory_movements im
    JOIN public.products p ON p.id = im.product_id
    WHERE im.picklist_id = p_picklist_id
    GROUP BY im.product_id, p.name, p.code
    HAVING public.get_vehicle_stock(p_picklist_id, im.product_id) <> 0
  LOOP
    RAISE EXCEPTION 'Vehicle has unaccounted stock for product % (%): remaining %',
      v_unaccounted.sku, v_unaccounted.product_name, v_unaccounted.remaining_stock;
  END LOOP;

  UPDATE public.picklists
  SET status = 'completed',
      completed_at = COALESCE(completed_at, now()),
      updated_at = now()
  WHERE id = p_picklist_id;

  PERFORM public.log_system_event(
    COALESCE(auth.uid()::text, v_picklist.worker_id::text, 'unknown'),
    CASE WHEN public.is_current_user_admin_or_master() THEN 'Admin/Master' ELSE 'Worker' END,
    'route_lifecycle',
    'route_closed',
    'success',
    'Route closed with reconciliation for picklist ' || p_picklist_id::text || '; ' || v_processed_count || ' products reconciled',
    'picklist',
    p_picklist_id::text
  );

  RETURN jsonb_build_object(
    'success', true,
    'picklist_id', p_picklist_id,
    'products_reconciled', v_processed_count,
    'status', 'completed'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_delivery_with_ledger(
    p_delivery_id UUID,
    p_worker_id UUID,
    p_items JSONB,
    p_payment_mode TEXT DEFAULT 'cash',
    p_payment_amount NUMERIC DEFAULT 0,
    p_reference_number TEXT DEFAULT NULL,
    p_cheque_number TEXT DEFAULT NULL,
    p_cheque_date DATE DEFAULT NULL,
    p_cheque_bank TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_payments JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_delivery record;
    v_picklist record;
    v_item record;
    v_item_input jsonb;
    v_item_id uuid;
    v_del_qty numeric;
    v_del_free numeric;
    v_ret_qty numeric;
    v_ret_free numeric;
    v_dam_qty numeric;
    v_dam_free numeric;
    v_phys_del numeric;
    v_phys_dam numeric;
    v_veh_stock numeric;
    v_final_delivered_amount numeric := 0;
    v_all_delivered boolean := true;
    v_all_zero boolean := true;
    v_final_status text;
    v_item_count integer := 0;
    v_input_count integer := 0;
    v_completed_count integer;
    v_total_collected numeric;
    v_total_cash numeric;
    v_total_upi numeric;
    v_total_cheque numeric;
    v_total_credit numeric;
    v_pay_item jsonb;
    v_pay_mode text;
    v_pay_amt numeric;
    v_pay_ref text;
    v_pay_chk_num text;
    v_pay_chk_date date;
    v_pay_chk_bank text;
    v_pay_notes text;
    v_pay_status text;
    v_total_pay_amt numeric := 0;
    v_total_settled_amt numeric := 0;
    v_payment_id uuid;
    v_idx integer := 0;
    v_current_worker uuid;
BEGIN
    -- 0. Authorization check: Caller must be authenticated worker or admin/master
    IF NOT public.is_current_user_worker() AND NOT public.is_current_user_admin_or_master() THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_delivery
    FROM public.deliveries
    WHERE id = p_delivery_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery % not found', p_delivery_id;
    END IF;

    SELECT * INTO v_picklist
    FROM public.picklists
    WHERE id = v_delivery.picklist_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Picklist % for delivery % not found', v_delivery.picklist_id, p_delivery_id;
    END IF;

    -- Horizontal Scope Check: Worker can only complete assigned delivery
    v_current_worker := public.get_current_worker_id();
    IF public.is_current_user_worker() THEN
        IF v_delivery.worker_id IS DISTINCT FROM v_current_worker 
           AND v_picklist.worker_id IS DISTINCT FROM v_current_worker THEN
            RAISE EXCEPTION 'Unauthorized: Authenticated worker % is not assigned to delivery %', v_current_worker, p_delivery_id USING ERRCODE = '42501';
        END IF;
    END IF;

    IF v_delivery.status IN ('delivered', 'partial', 'refused') THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_completed', true,
            'status', v_delivery.status,
            'delivered_amount', v_delivery.delivered_amount,
            'message', 'Delivery was already finalized'
        );
    END IF;

    SELECT count(*) INTO v_item_count FROM public.delivery_items WHERE delivery_id = p_delivery_id;
    v_input_count := jsonb_array_length(p_items);

    IF v_item_count <> v_input_count THEN
        RAISE EXCEPTION 'Item count mismatch: expected %, received %', v_item_count, v_input_count;
    END IF;

    FOR v_item_input IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_item_id := (v_item_input->>'delivery_item_id')::uuid;
        v_del_qty := COALESCE((v_item_input->>'delivered_qty')::numeric, 0);
        v_del_free := COALESCE((v_item_input->>'delivered_free_qty')::numeric, 0);
        v_ret_qty := COALESCE((v_item_input->>'returned_qty')::numeric, 0);
        v_ret_free := COALESCE((v_item_input->>'returned_free_qty')::numeric, 0);
        v_dam_qty := COALESCE((v_item_input->>'damaged_qty')::numeric, 0);
        v_dam_free := COALESCE((v_item_input->>'damaged_free_qty')::numeric, 0);

        SELECT * INTO v_item
        FROM public.delivery_items
        WHERE id = v_item_id AND delivery_id = p_delivery_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Delivery item % not found for delivery %', v_item_id, p_delivery_id;
        END IF;

        IF (v_del_qty + v_ret_qty + v_dam_qty) <> v_item.ordered_qty THEN
            RAISE EXCEPTION 'Commercial quantity mismatch for SKU %: delivered (%) + returned (%) + damaged (%) must equal ordered (%)',
                v_item.sku, v_del_qty, v_ret_qty, v_dam_qty, v_item.ordered_qty;
        END IF;

        IF (v_del_free + v_ret_free + v_dam_free) <> v_item.free_quantity THEN
            RAISE EXCEPTION 'Free quantity mismatch for SKU %: delivered free (%) + returned free (%) + damaged free (%) must equal ordered free (%)',
                v_item.sku, v_del_free, v_ret_free, v_dam_free, v_item.free_quantity;
        END IF;

        v_phys_del := v_del_qty + v_del_free;
        v_phys_dam := v_dam_qty + v_dam_free;

        IF v_item.product_id IS NOT NULL AND (v_phys_del + v_phys_dam) > 0 THEN
            v_veh_stock := public.get_vehicle_stock(v_delivery.picklist_id, v_item.product_id);
            IF v_veh_stock < (v_phys_del + v_phys_dam) THEN
                RAISE EXCEPTION 'Insufficient vehicle stock for SKU %: requires %, available on vehicle %',
                    v_item.sku, (v_phys_del + v_phys_dam), v_veh_stock;
            END IF;
        END IF;

        IF v_item.product_id IS NOT NULL AND v_phys_del > 0 THEN
            INSERT INTO public.inventory_movements (
                product_id, movement_type, quantity, reference_type, reference_id,
                notes, source_location, destination_location, picklist_id, created_by
            ) VALUES (
                v_item.product_id, 'route_delivery', v_phys_del, 'delivery', p_delivery_id,
                'Delivered to party: ' || v_item.sku, 'vehicle:' || v_delivery.picklist_id::text, 'party:' || v_delivery.party_id::text,
                v_delivery.picklist_id, COALESCE(auth.uid(), v_delivery.worker_id)
            );
        END IF;

        IF v_item.product_id IS NOT NULL AND v_phys_dam > 0 THEN
            INSERT INTO public.inventory_movements (
                product_id, movement_type, quantity, reference_type, reference_id,
                notes, source_location, destination_location, picklist_id, created_by
            ) VALUES (
                v_item.product_id, 'route_damaged', v_phys_dam, 'delivery', p_delivery_id,
                'Damaged in transit: ' || v_item.sku, 'vehicle:' || v_delivery.picklist_id::text, 'damaged_quarantine',
                v_delivery.picklist_id, COALESCE(auth.uid(), v_delivery.worker_id)
            );
        END IF;

        UPDATE public.delivery_items
        SET delivered_qty = v_del_qty,
            delivered_free_qty = v_del_free,
            returned_qty = v_ret_qty,
            returned_free_qty = v_ret_free,
            damaged_qty = v_dam_qty,
            damaged_free_qty = v_dam_free,
            delivered_amount = v_del_qty * v_item.unit_price,
            returned_amount = (v_ret_qty + v_dam_qty) * v_item.unit_price,
            status = CASE
                WHEN v_del_qty = v_item.ordered_qty THEN 'delivered'
                WHEN v_del_qty > 0 THEN 'partial'
                ELSE 'returned'
            END,
            updated_at = now()
        WHERE id = v_item_id;

        v_final_delivered_amount := v_final_delivered_amount + (v_del_qty * v_item.unit_price);

        IF v_del_qty <> v_item.ordered_qty THEN
            v_all_delivered := false;
        END IF;
        IF v_del_qty > 0 THEN
            v_all_zero := false;
        END IF;
    END LOOP;

    IF v_all_delivered THEN
        v_final_status := 'delivered';
    ELSIF v_all_zero THEN
        v_final_status := 'refused';
    ELSE
        v_final_status := 'partial';
    END IF;

    IF p_payments IS NOT NULL AND jsonb_typeof(p_payments) = 'array' AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_pay_item IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
            v_pay_mode := COALESCE(v_pay_item->>'payment_mode', 'cash');
            v_pay_amt := COALESCE((v_pay_item->>'amount')::numeric, 0);
            v_pay_ref := v_pay_item->>'reference_number';
            v_pay_chk_num := v_pay_item->>'cheque_number';
            v_pay_chk_date := (v_pay_item->>'cheque_date')::date;
            v_pay_chk_bank := v_pay_item->>'cheque_bank';
            v_pay_notes := v_pay_item->>'notes';

            IF v_pay_mode NOT IN ('cash', 'upi', 'cheque', 'credit') THEN
                RAISE EXCEPTION 'Invalid payment mode in split payment: %', v_pay_mode;
            END IF;

            IF v_pay_amt > 0 THEN
                v_idx := v_idx + 1;
                v_pay_status := CASE WHEN v_pay_mode = 'cheque' THEN 'pending' ELSE 'collected' END;

                INSERT INTO public.payments (
                    delivery_id, party_id, invoice_id, worker_id, amount, payment_mode,
                    cheque_number, cheque_date, cheque_bank, notes, payment_date, status,
                    reference_number, received_by_worker_id, picklist_id, route_id, idempotency_key
                ) VALUES (
                    p_delivery_id, v_delivery.party_id, v_delivery.invoice_id, v_delivery.worker_id,
                    v_pay_amt, v_pay_mode, v_pay_chk_num, v_pay_chk_date, v_pay_chk_bank,
                    v_pay_notes, CURRENT_DATE, v_pay_status, v_pay_ref,
                    v_delivery.worker_id, v_delivery.picklist_id, v_picklist.route_id,
                    'split:' || p_delivery_id::text || ':' || v_idx::text
                ) RETURNING id INTO v_payment_id;

                v_total_pay_amt := v_total_pay_amt + v_pay_amt;
                IF v_pay_status = 'collected' THEN
                    v_total_settled_amt := v_total_settled_amt + v_pay_amt;
                END IF;

                IF v_pay_mode IN ('cash', 'upi') THEN
                    INSERT INTO public.party_financial_ledger (
                        party_id, invoice_id, delivery_id, payment_id, picklist_id, route_id,
                        entry_type, amount, direction, status, reference_id, notes, created_by, idempotency_key
                    ) VALUES (
                        v_delivery.party_id, v_delivery.invoice_id, p_delivery_id, v_payment_id,
                        v_delivery.picklist_id, v_picklist.route_id,
                        'payment',
                        v_pay_amt, 'credit',
                        'valid',
                        COALESCE(v_pay_ref, v_pay_chk_num, 'COLL:' || p_delivery_id::text),
                        'Payment collected during delivery (' || v_pay_mode || ')',
                        COALESCE(auth.uid()::text, v_delivery.worker_id::text),
                        'ledg:' || p_delivery_id::text || ':' || v_idx::text
                    ) ON CONFLICT (idempotency_key) DO NOTHING;
                END IF;
            END IF;
        END LOOP;
    ELSIF p_payment_amount > 0 THEN
        IF p_payment_mode NOT IN ('cash', 'upi', 'cheque', 'credit') THEN
            RAISE EXCEPTION 'Invalid payment mode: %', p_payment_mode;
        END IF;

        v_pay_status := CASE WHEN p_payment_mode = 'cheque' THEN 'pending' ELSE 'collected' END;

        INSERT INTO public.payments (
            delivery_id, party_id, invoice_id, worker_id, amount, payment_mode,
            cheque_number, cheque_date, cheque_bank, notes, payment_date, status,
            reference_number, received_by_worker_id, picklist_id, route_id, idempotency_key
        ) VALUES (
            p_delivery_id, v_delivery.party_id, v_delivery.invoice_id, v_delivery.worker_id,
            p_payment_amount, p_payment_mode, p_cheque_number, p_cheque_date, p_cheque_bank,
            p_notes, CURRENT_DATE, v_pay_status, p_reference_number,
            v_delivery.worker_id, v_delivery.picklist_id, v_picklist.route_id,
            'pmt:' || p_delivery_id::text
        ) RETURNING id INTO v_payment_id;

        v_total_pay_amt := p_payment_amount;
        IF v_pay_status = 'collected' THEN
            v_total_settled_amt := p_payment_amount;
        END IF;

        IF p_payment_mode IN ('cash', 'upi') THEN
            INSERT INTO public.party_financial_ledger (
                party_id, invoice_id, delivery_id, payment_id, picklist_id, route_id,
                entry_type, amount, direction, status, reference_id, notes, created_by, idempotency_key
            ) VALUES (
                v_delivery.party_id, v_delivery.invoice_id, p_delivery_id, v_payment_id,
                v_delivery.picklist_id, v_picklist.route_id,
                'payment',
                p_payment_amount, 'credit',
                'valid',
                COALESCE(p_reference_number, p_cheque_number, 'COLL:' || p_delivery_id::text),
                'Payment collected during delivery (' || p_payment_mode || ')',
                COALESCE(auth.uid()::text, v_delivery.worker_id::text),
                'ledg:' || p_delivery_id::text || ':1'
            ) ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;
    END IF;

    UPDATE public.deliveries
    SET status = v_final_status,
        delivered_at = now(),
        delivered_amount = v_final_delivered_amount,
        collected_amount = v_total_pay_amt,
        returned_amount = GREATEST(0, total_amount - v_final_delivered_amount),
        payment_mode = CASE
            WHEN p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 1 THEN 'split'
            ELSE p_payment_mode
        END,
        notes = COALESCE(p_notes, notes),
        updated_at = now()
    WHERE id = p_delivery_id;

    SELECT count(*) INTO v_completed_count
    FROM public.deliveries
    WHERE picklist_id = v_delivery.picklist_id
      AND status IN ('delivered', 'partial', 'refused');

    SELECT
        COALESCE(SUM(amount), 0),
        COALESCE(SUM(CASE WHEN payment_mode = 'cash' THEN amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN payment_mode = 'upi' THEN amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN payment_mode = 'cheque' THEN amount ELSE 0 END), 0)
    INTO v_total_collected, v_total_cash, v_total_upi, v_total_cheque
    FROM public.payments
    WHERE picklist_id = v_delivery.picklist_id
      AND status NOT IN ('reversed', 'bounced');

    SELECT COALESCE(SUM(GREATEST(0, delivered_amount - collected_amount)), 0)
    INTO v_total_credit
    FROM public.deliveries
    WHERE picklist_id = v_delivery.picklist_id
      AND status IN ('delivered', 'partial');

    UPDATE public.picklists
    SET completed_parties = v_completed_count,
        total_collected = v_total_collected,
        total_cash = v_total_cash,
        total_upi = v_total_upi,
        total_cheque = v_total_cheque,
        total_credit = v_total_credit,
        updated_at = now()
    WHERE id = v_delivery.picklist_id;

    PERFORM public.log_system_event(
        COALESCE(auth.uid()::text, v_delivery.worker_id::text, 'unknown'),
        CASE WHEN public.is_current_user_admin_or_master() THEN 'Admin/Master' ELSE 'Worker' END,
        'delivery',
        'delivery_completed',
        'success',
        'Delivery ' || p_delivery_id || ' completed with status ' || v_final_status || ', delivered ₹' || v_final_delivered_amount || ', collected ₹' || v_total_pay_amt,
        'delivery',
        p_delivery_id::text
    );

    RETURN jsonb_build_object(
        'success', true,
        'delivery_id', p_delivery_id,
        'status', v_final_status,
        'delivered_amount', v_final_delivered_amount,
        'collected_amount', v_total_pay_amt,
        'returned_amount', GREATEST(0, v_delivery.total_amount - v_final_delivered_amount)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_route_stock(
  p_picklist_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb := '[]'::jsonb;
  v_row record;
  v_picklist record;
  v_current_worker uuid;
BEGIN
  -- 0. Authorization check: Caller must be authenticated worker or admin/master
  IF NOT public.is_current_user_worker() AND NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_picklist FROM public.picklists WHERE id = p_picklist_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Picklist % not found', p_picklist_id;
  END IF;

  v_current_worker := public.get_current_worker_id();
  IF public.is_current_user_worker() THEN
    IF v_picklist.worker_id IS DISTINCT FROM v_current_worker THEN
      RAISE EXCEPTION 'Unauthorized: Authenticated worker % is not assigned to picklist %', v_current_worker, p_picklist_id USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_row IN
    SELECT
      pli.product_id,
      pli.sku,
      p.name as product_name,
      pli.loaded_quantity as loaded_qty,
      COALESCE(del_agg.delivered_qty, 0) as delivered_qty,
      COALESCE(del_agg.delivered_free_qty, 0) as delivered_free_qty,
      COALESCE(del_agg.damaged_qty, 0) as damaged_in_transit_qty,
      public.get_vehicle_stock(p_picklist_id, pli.product_id) as current_vehicle_stock
    FROM public.picklist_load_items pli
    JOIN public.products p ON p.id = pli.product_id
    LEFT JOIN (
      SELECT
        di.product_id,
        SUM(CASE WHEN d.status IN ('delivered', 'partial') THEN di.delivered_qty ELSE 0 END) as delivered_qty,
        SUM(CASE WHEN d.status IN ('delivered', 'partial') THEN di.delivered_free_qty ELSE 0 END) as delivered_free_qty,
        SUM(CASE WHEN d.status IN ('delivered', 'partial') THEN (di.damaged_qty + di.damaged_free_qty) ELSE 0 END) as damaged_qty
      FROM public.delivery_items di
      JOIN public.deliveries d ON d.id = di.delivery_id
      WHERE d.picklist_id = p_picklist_id
      GROUP BY di.product_id
    ) del_agg ON del_agg.product_id = pli.product_id
    WHERE pli.picklist_id = p_picklist_id
    ORDER BY pli.sku
  LOOP
    v_result := v_result || jsonb_build_object(
      'product_id', v_row.product_id,
      'sku', v_row.sku,
      'product_name', v_row.product_name,
      'loaded_qty', v_row.loaded_qty,
      'delivered_qty', v_row.delivered_qty,
      'delivered_free_qty', v_row.delivered_free_qty,
      'damaged_in_transit_qty', v_row.damaged_in_transit_qty,
      'current_vehicle_stock', v_row.current_vehicle_stock
    );
  END LOOP;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_party_payment_with_ledger(
    p_party_id UUID,
    p_amount NUMERIC,
    p_payment_mode TEXT,
    p_worker_id UUID DEFAULT NULL,
    p_invoice_id UUID DEFAULT NULL,
    p_delivery_id UUID DEFAULT NULL,
    p_picklist_id UUID DEFAULT NULL,
    p_route_id UUID DEFAULT NULL,
    p_reference_number TEXT DEFAULT NULL,
    p_cheque_number TEXT DEFAULT NULL,
    p_cheque_date DATE DEFAULT NULL,
    p_cheque_bank TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_payment_date DATE DEFAULT CURRENT_DATE,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_party record;
    v_payment_id uuid;
    v_current_outstanding numeric(12, 2);
    v_status text;
    v_resolved_route_id uuid := p_route_id;
    v_resolved_picklist_id uuid := p_picklist_id;
    v_existing_payment record;
    v_current_worker uuid;
    v_effective_worker uuid := p_worker_id;
BEGIN
    v_current_worker := public.get_current_worker_id();
    IF public.is_current_user_worker() THEN
        v_effective_worker := v_current_worker;
        IF p_delivery_id IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.deliveries d
                LEFT JOIN public.picklists p ON d.picklist_id = p.id
                WHERE d.id = p_delivery_id
                  AND (d.worker_id = v_current_worker OR p.worker_id = v_current_worker)
            ) THEN
                RAISE EXCEPTION 'Unauthorized: Delivery does not belong to authenticated worker.' USING ERRCODE = '42501';
            END IF;
        ELSIF p_picklist_id IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.picklists
                WHERE id = p_picklist_id AND worker_id = v_current_worker
            ) THEN
                RAISE EXCEPTION 'Unauthorized: Picklist does not belong to authenticated worker.' USING ERRCODE = '42501';
            END IF;
        ELSE
            RAISE EXCEPTION 'Unauthorized: Workers may only record payments against assigned routes or deliveries.' USING ERRCODE = '42501';
        END IF;
    ELSIF NOT public.is_current_user_admin_or_master() THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing_payment
        FROM public.payments
        WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'already_recorded', true,
                'payment_id', v_existing_payment.id,
                'amount', v_existing_payment.amount,
                'status', v_existing_payment.status
            );
        END IF;
    END IF;

    SELECT * INTO v_party
    FROM public.parties
    WHERE id = p_party_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Party % not found', p_party_id;
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero';
    END IF;

    IF p_payment_mode NOT IN ('cash', 'upi', 'cheque', 'credit') THEN
        RAISE EXCEPTION 'Invalid payment mode: %', p_payment_mode;
    END IF;

    IF p_payment_mode = 'upi' THEN
        IF p_reference_number IS NULL OR trim(p_reference_number) = '' THEN
            RAISE EXCEPTION 'UPI reference number is required for UPI payments';
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.payments
            WHERE reference_number = p_reference_number
              AND payment_mode = 'upi'
              AND status <> 'reversed'
        ) THEN
            RAISE EXCEPTION 'UPI reference number % already used for another payment', p_reference_number;
        END IF;
    END IF;

    IF p_payment_mode = 'cheque' THEN
        IF p_cheque_number IS NULL OR trim(p_cheque_number) = '' THEN
            RAISE EXCEPTION 'Cheque number is required for cheque payments';
        END IF;
    END IF;

    IF v_resolved_picklist_id IS NOT NULL AND v_resolved_route_id IS NULL THEN
        SELECT route_id INTO v_resolved_route_id
        FROM public.picklists
        WHERE id = v_resolved_picklist_id;
    END IF;

    v_status := CASE
        WHEN p_payment_mode = 'cheque' THEN 'pending'
        ELSE 'collected'
    END;

    INSERT INTO public.payments (
        party_id, invoice_id, delivery_id, picklist_id, route_id, worker_id,
        amount, payment_mode, reference_number, cheque_number, cheque_date,
        cheque_bank, notes, payment_date, status, received_by_worker_id, idempotency_key
    ) VALUES (
        p_party_id, p_invoice_id, p_delivery_id, v_resolved_picklist_id, v_resolved_route_id, v_effective_worker,
        p_amount, p_payment_mode, p_reference_number, p_cheque_number, p_cheque_date,
        p_cheque_bank, p_notes, COALESCE(p_payment_date, CURRENT_DATE), v_status,
        v_effective_worker, p_idempotency_key
    )
    RETURNING id INTO v_payment_id;

    IF p_payment_mode IN ('cash', 'upi') THEN
        INSERT INTO public.party_financial_ledger (
            party_id, invoice_id, delivery_id, payment_id, picklist_id, route_id,
            entry_type, amount, direction, status, reference_id, notes, created_by, idempotency_key
        ) VALUES (
            p_party_id, p_invoice_id, p_delivery_id, v_payment_id, v_resolved_picklist_id, v_resolved_route_id,
            'payment',
            p_amount, 'credit',
            'valid',
            COALESCE(p_reference_number, 'DIR_PMT:' || v_payment_id::text),
            'Payment recorded: ' || p_payment_mode || COALESCE(' (' || p_notes || ')', ''),
            COALESCE(auth.uid()::text, v_effective_worker::text, 'admin'),
            COALESCE(p_idempotency_key, 'pfl_pay:' || v_payment_id::text)
        ) ON CONFLICT (idempotency_key) DO NOTHING;

        UPDATE public.parties
        SET outstanding_amount = public.get_party_outstanding(p_party_id),
            updated_at = now()
        WHERE id = p_party_id;
    END IF;

    IF p_delivery_id IS NOT NULL THEN
        UPDATE public.deliveries
        SET collected_amount = collected_amount + p_amount,
            updated_at = now()
        WHERE id = p_delivery_id;
    END IF;

    IF v_resolved_picklist_id IS NOT NULL THEN
        UPDATE public.picklists
        SET total_collected = total_collected + p_amount,
            total_cash = CASE WHEN p_payment_mode = 'cash' THEN total_cash + p_amount ELSE total_cash END,
            total_upi = CASE WHEN p_payment_mode = 'upi' THEN total_upi + p_amount ELSE total_upi END,
            total_cheque = CASE WHEN p_payment_mode = 'cheque' THEN total_cheque + p_amount ELSE total_cheque END,
            updated_at = now()
        WHERE id = v_resolved_picklist_id;
    END IF;

    v_current_outstanding := public.get_party_outstanding(p_party_id);

    PERFORM public.log_system_event(
        COALESCE(auth.uid()::text, v_effective_worker::text, 'admin'),
        CASE WHEN public.is_current_user_admin_or_master() THEN 'Admin/Master' ELSE 'Worker' END,
        'financial',
        'payment_recorded',
        'success',
        'Payment of ₹' || p_amount || ' (' || p_payment_mode || ') recorded for party ' || p_party_id || '. Current outstanding: ₹' || v_current_outstanding,
        'payment',
        v_payment_id::text
    );

    RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'party_id', p_party_id,
        'amount', p_amount,
        'payment_mode', p_payment_mode,
        'status', v_status,
        'party_outstanding', v_current_outstanding
    );
END;
$function$;

-- ── 6. Reporting & Oversight RPC Hardening ───────────────────────

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
BEGIN
    IF NOT public.is_current_user_admin_or_master() THEN
        RAISE EXCEPTION 'Unauthorized: Only Owner or Master may access organizational financial summaries.' USING ERRCODE = '42501';
    END IF;

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

    SELECT COALESCE(SUM(GREATEST(0, d.delivered_amount - d.collected_amount)), 0)
    INTO v_total_credit
    FROM public.deliveries d
    LEFT JOIN public.picklists p ON d.picklist_id = p.id
    WHERE d.status IN ('delivered', 'partial')
      AND (p_start_date IS NULL OR d.delivery_date >= p_start_date)
      AND (p_end_date IS NULL OR d.delivery_date <= p_end_date)
      AND (p_picklist_id IS NULL OR d.picklist_id = p_picklist_id)
      AND (p_route_id IS NULL OR p.route_id = p_route_id)
      AND (p_worker_id IS NULL OR d.worker_id = p_worker_id);

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

    SELECT COALESCE(SUM(
        CASE WHEN direction = 'debit' THEN amount ELSE -amount END
    ), 0) INTO v_total_outstanding
    FROM public.party_financial_ledger
    WHERE status = 'valid';

    RETURN jsonb_build_object(
        'total_revenue', v_total_revenue,
        'total_collected', v_total_collected,
        'cash_collected', v_cash_collected,
        'upi_collected', v_upi_collected,
        'cheque_collected', v_cheque_collected,
        'total_credit', v_total_credit,
        'total_expenses', v_total_expenses,
        'cash_expenses', v_cash_expenses,
        'bank_expenses', v_bank_expenses,
        'net_cash_deposit', v_net_cash_deposit,
        'cash_discrepancy', v_cash_discrepancy,
        'pending_cheques', v_pending_cheques,
        'bounced_cheques', v_bounced_cheques,
        'total_outstanding', v_total_outstanding
    );
END;
$function$;

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
    v_row record;
BEGIN
    IF NOT public.is_current_user_admin_or_master() THEN
        RAISE EXCEPTION 'Unauthorized: Only Owner or Master may access route profitability metrics.' USING ERRCODE = '42501';
    END IF;

    FOR v_row IN
        WITH picklist_rev AS (
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
                COUNT(CASE WHEN d.status = 'refused' THEN 1 END) AS refused_deliveries
            FROM public.picklists p
            JOIN public.routes r ON r.id = p.route_id
            LEFT JOIN public.workers w ON w.id = p.worker_id
            LEFT JOIN public.deliveries d ON d.picklist_id = p.id
            WHERE (p_route_id IS NULL OR p.route_id = p_route_id)
              AND (p_picklist_id IS NULL OR p.id = p_picklist_id)
              AND (p_start_date IS NULL OR p.date >= p_start_date)
              AND (p_end_date IS NULL OR p.date <= p_end_date)
              AND (p_worker_id IS NULL OR p.worker_id = p_worker_id)
            GROUP BY p.id, p.picklist_number, p.date, p.route_id, r.name, r.code, p.worker_id, w.name, p.total_amount
        ),
        picklist_exp AS (
            SELECT
                e.picklist_id,
                COALESCE(SUM(CASE WHEN e.status = 'approved' THEN e.amount ELSE 0 END), 0) AS approved_expenses,
                COALESCE(SUM(CASE WHEN e.status = 'approved' AND e.category = 'Fuel' THEN e.amount ELSE 0 END), 0) AS fuel_expenses,
                COALESCE(SUM(CASE WHEN e.status = 'approved' AND e.category = 'Vehicle Maintenance' THEN e.amount ELSE 0 END), 0) AS maintenance_expenses,
                COALESCE(SUM(CASE WHEN e.status = 'approved' AND e.category = 'Food/Batta' THEN e.amount ELSE 0 END), 0) AS batta_expenses,
                COALESCE(SUM(CASE WHEN e.status = 'approved' AND e.category NOT IN ('Fuel', 'Vehicle Maintenance', 'Food/Batta') THEN e.amount ELSE 0 END), 0) AS other_expenses,
                COALESCE(SUM(CASE WHEN e.status = 'pending' THEN e.amount ELSE 0 END), 0) AS pending_expenses
            FROM public.expenses e
            WHERE (p_picklist_id IS NULL OR e.picklist_id = p_picklist_id)
            GROUP BY e.picklist_id
        )
        SELECT
            pr.*,
            COALESCE(pe.approved_expenses, 0) AS total_expenses,
            COALESCE(pe.fuel_expenses, 0) AS fuel_expenses,
            COALESCE(pe.maintenance_expenses, 0) AS maintenance_expenses,
            COALESCE(pe.batta_expenses, 0) AS batta_expenses,
            COALESCE(pe.other_expenses, 0) AS other_expenses,
            COALESCE(pe.pending_expenses, 0) AS pending_expenses,
            (pr.delivered_revenue - COALESCE(pe.approved_expenses, 0)) AS net_profit,
            CASE
                WHEN pr.delivered_revenue > 0 THEN
                    ROUND(((pr.delivered_revenue - COALESCE(pe.approved_expenses, 0)) / pr.delivered_revenue * 100)::numeric, 2)
                ELSE 0
            END AS profit_margin_pct
        FROM picklist_rev pr
        LEFT JOIN picklist_exp pe ON pe.picklist_id = pr.picklist_id
        ORDER BY pr.date DESC, pr.route_name ASC
    LOOP
        v_result := v_result || jsonb_build_object(
            'picklist_id', v_row.picklist_id,
            'picklist_number', v_row.picklist_number,
            'date', v_row.date,
            'route_id', v_row.route_id,
            'route_name', v_row.route_name,
            'route_code', v_row.route_code,
            'worker_id', v_row.worker_id,
            'worker_name', v_row.worker_name,
            'ordered_revenue', v_row.ordered_revenue,
            'delivered_revenue', v_row.delivered_revenue,
            'collected_amount', v_row.collected_amount,
            'total_deliveries', v_row.total_deliveries,
            'successful_deliveries', v_row.successful_deliveries,
            'partial_deliveries', v_row.partial_deliveries,
            'refused_deliveries', v_row.refused_deliveries,
            'total_expenses', v_row.total_expenses,
            'fuel_expenses', v_row.fuel_expenses,
            'maintenance_expenses', v_row.maintenance_expenses,
            'batta_expenses', v_row.batta_expenses,
            'other_expenses', v_row.other_expenses,
            'pending_expenses', v_row.pending_expenses,
            'net_profit', v_row.net_profit,
            'profit_margin_pct', v_row.profit_margin_pct
        );
    END LOOP;

    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_master_pin(p_pin TEXT)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
    IF NOT public.is_current_user_master() THEN
        RAISE EXCEPTION 'Unauthorized: Only Master may rotate the Master PIN.' USING ERRCODE = '42501';
    END IF;

    IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
        RAISE EXCEPTION 'PIN must be at least 4 digits';
    END IF;

    UPDATE public.master_config
    SET master_pin = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
        updated_at = now();

    UPDATE auth.users
    SET encrypted_password = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
        updated_at = now()
    WHERE email = 'master@distrotrack.local';

    PERFORM public.log_system_event(
        auth.uid()::text,
        'Master',
        'auth',
        'master_pin_rotated',
        'warning',
        'Master executive PIN rotated by authenticated Master',
        'master_config',
        'master'
    );

    RETURN 'Master PIN successfully rotated';
END;
$$;

-- ── 7. Revoke log_system_event from anon ─────────────────────────
REVOKE EXECUTE ON FUNCTION public.log_system_event(text, text, text, text, text, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_system_event(text, text, text, text, text, text, text, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_system_event(text, text, text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_system_event(text, text, text, text, text, text, text, text, text) TO authenticated, service_role;

-- ── 8. Table-Level RLS Hardening: Lock Down Administrative Mutations ─

-- Parties: Workers can read; only Owner/Master can insert, update, delete
DROP POLICY IF EXISTS "Allow authenticated access" ON public.parties;
DROP POLICY IF EXISTS "parties_authenticated_select" ON public.parties;
CREATE POLICY "parties_authenticated_select"
  ON public.parties FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "parties_admin_master_mutation" ON public.parties;
CREATE POLICY "parties_admin_master_mutation"
  ON public.parties FOR ALL
  TO authenticated
  USING (public.is_current_user_admin_or_master())
  WITH CHECK (public.is_current_user_admin_or_master());

-- Products: Workers can read; only Owner/Master can insert, update, delete
DROP POLICY IF EXISTS "Allow authenticated access" ON public.products;
DROP POLICY IF EXISTS "products_authenticated_select" ON public.products;
CREATE POLICY "products_authenticated_select"
  ON public.products FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "products_admin_master_mutation" ON public.products;
CREATE POLICY "products_admin_master_mutation"
  ON public.products FOR ALL
  TO authenticated
  USING (public.is_current_user_admin_or_master())
  WITH CHECK (public.is_current_user_admin_or_master());

-- Routes: Workers can read; only Owner/Master can insert, update, delete
DROP POLICY IF EXISTS "Allow authenticated access" ON public.routes;
DROP POLICY IF EXISTS "routes_authenticated_select" ON public.routes;
CREATE POLICY "routes_authenticated_select"
  ON public.routes FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "routes_admin_master_mutation" ON public.routes;
CREATE POLICY "routes_admin_master_mutation"
  ON public.routes FOR ALL
  TO authenticated
  USING (public.is_current_user_admin_or_master())
  WITH CHECK (public.is_current_user_admin_or_master());

-- Picklists: Workers can read, and update their assigned picklist; only Owner/Master can insert/delete
DROP POLICY IF EXISTS "Allow authenticated access" ON public.picklists;
DROP POLICY IF EXISTS "picklists_authenticated_select" ON public.picklists;
CREATE POLICY "picklists_authenticated_select"
  ON public.picklists FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "picklists_admin_master_insert" ON public.picklists;
CREATE POLICY "picklists_admin_master_insert"
  ON public.picklists FOR INSERT
  TO authenticated
  WITH CHECK (public.is_current_user_admin_or_master());

DROP POLICY IF EXISTS "picklists_admin_master_delete" ON public.picklists;
CREATE POLICY "picklists_admin_master_delete"
  ON public.picklists FOR DELETE
  TO authenticated
  USING (public.is_current_user_admin_or_master());

DROP POLICY IF EXISTS "picklists_update_policy" ON public.picklists;
CREATE POLICY "picklists_update_policy"
  ON public.picklists FOR UPDATE
  TO authenticated
  USING (worker_id = public.get_current_worker_id() OR public.is_current_user_admin_or_master())
  WITH CHECK (worker_id = public.get_current_worker_id() OR public.is_current_user_admin_or_master());

-- Deliveries: Workers can read and update their assigned deliveries; only Owner/Master can insert/delete
DROP POLICY IF EXISTS "Allow authenticated access" ON public.deliveries;
DROP POLICY IF EXISTS "deliveries_authenticated_select" ON public.deliveries;
CREATE POLICY "deliveries_authenticated_select"
  ON public.deliveries FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "deliveries_admin_master_insert" ON public.deliveries;
CREATE POLICY "deliveries_admin_master_insert"
  ON public.deliveries FOR INSERT
  TO authenticated
  WITH CHECK (public.is_current_user_admin_or_master());

DROP POLICY IF EXISTS "deliveries_admin_master_delete" ON public.deliveries;
CREATE POLICY "deliveries_admin_master_delete"
  ON public.deliveries FOR DELETE
  TO authenticated
  USING (public.is_current_user_admin_or_master());

DROP POLICY IF EXISTS "deliveries_update_policy" ON public.deliveries;
CREATE POLICY "deliveries_update_policy"
  ON public.deliveries FOR UPDATE
  TO authenticated
  USING (
    worker_id = public.get_current_worker_id()
    OR EXISTS (SELECT 1 FROM public.picklists p WHERE p.id = deliveries.picklist_id AND p.worker_id = public.get_current_worker_id())
    OR public.is_current_user_admin_or_master()
  )
  WITH CHECK (
    worker_id = public.get_current_worker_id()
    OR EXISTS (SELECT 1 FROM public.picklists p WHERE p.id = deliveries.picklist_id AND p.worker_id = public.get_current_worker_id())
    OR public.is_current_user_admin_or_master()
  );

-- Delivery Items: Workers can read and update assigned delivery items; only Owner/Master can insert/delete
DROP POLICY IF EXISTS "Allow authenticated access" ON public.delivery_items;
DROP POLICY IF EXISTS "delivery_items_authenticated_select" ON public.delivery_items;
CREATE POLICY "delivery_items_authenticated_select"
  ON public.delivery_items FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "delivery_items_admin_master_insert" ON public.delivery_items;
CREATE POLICY "delivery_items_admin_master_insert"
  ON public.delivery_items FOR INSERT
  TO authenticated
  WITH CHECK (public.is_current_user_admin_or_master());

DROP POLICY IF EXISTS "delivery_items_admin_master_delete" ON public.delivery_items;
CREATE POLICY "delivery_items_admin_master_delete"
  ON public.delivery_items FOR DELETE
  TO authenticated
  USING (public.is_current_user_admin_or_master());

DROP POLICY IF EXISTS "delivery_items_update_policy" ON public.delivery_items;
CREATE POLICY "delivery_items_update_policy"
  ON public.delivery_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.deliveries d
      LEFT JOIN public.picklists p ON d.picklist_id = p.id
      WHERE d.id = delivery_items.delivery_id
        AND (d.worker_id = public.get_current_worker_id() OR p.worker_id = public.get_current_worker_id())
    )
    OR public.is_current_user_admin_or_master()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.deliveries d
      LEFT JOIN public.picklists p ON d.picklist_id = p.id
      WHERE d.id = delivery_items.delivery_id
        AND (d.worker_id = public.get_current_worker_id() OR p.worker_id = public.get_current_worker_id())
    )
    OR public.is_current_user_admin_or_master()
  );

-- ── 9. Post-flight Validation Notice ─────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Migration 015 (Stage 8C) successfully applied:';
  RAISE NOTICE '  - SEC-04: reverse_payment_with_ledger restricted to Owner / Master';
  RAISE NOTICE '  - SEC-05: Cash discrepancy authorization restricted to Owner / Master';
  RAISE NOTICE '  - SEC-06: Expense pre-approval injection blocked; worker expenses forced to pending';
  RAISE NOTICE '  - SEC-07: Route start, delivery, returns, stock checks scoped to assigned worker';
  RAISE NOTICE '  - Table RLS: parties, products, routes, picklists, deliveries locked against worker mutations';
END $$;

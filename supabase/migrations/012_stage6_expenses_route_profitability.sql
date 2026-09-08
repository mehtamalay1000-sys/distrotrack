-- ============================================================================
-- MIGRATION 012: STAGE 6 — EXPENSES + ROUTE PROFITABILITY + COST ALLOCATION
-- Project: DistroTrack v2
-- Production Target: towyscllpnwofgweyrqi
-- Invariants:
--   - Stages 3, 4A, 4B, and 5 remain completely intact.
--   - Append-only financial ledger & inventory ledger remain strictly immutable.
--   - No product cost/COGS invented: terminology is "Route Contribution Before COGS".
--   - Commercial Sales: SUM(delivered_qty * rate). Free & refused units = 0 sales.
--   - Expense Lifecycle: pending -> approved / rejected / reversed.
--   - Only APPROVED expenses affect profitability & cash handover.
--   - Only APPROVED CASH expenses reduce expected physical cash handover.
--   - Non-physical deletion of expenses: trg_expenses_no_delete trigger.
--   - Authoritative Route Profitability RPC: get_route_profitability.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. HARDEN expenses TABLE WITH STAGE 6 FIELDS
-- ----------------------------------------------------------------------------

ALTER TABLE public.expenses
    ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash',
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved',
    ADD COLUMN IF NOT EXISTS expense_type TEXT NOT NULL DEFAULT 'route_operating',
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_by TEXT,
    ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_by TEXT,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reversed_by TEXT,
    ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

-- Status constraint
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS chk_expenses_status;
ALTER TABLE public.expenses ADD CONSTRAINT chk_expenses_status
    CHECK (status IN ('pending', 'approved', 'rejected', 'reversed'));

-- Payment method constraint
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS chk_expenses_payment_method;
ALTER TABLE public.expenses ADD CONSTRAINT chk_expenses_payment_method
    CHECK (payment_method IN ('cash', 'upi', 'bank', 'other'));

-- Expense type constraint
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS chk_expenses_type;
ALTER TABLE public.expenses ADD CONSTRAINT chk_expenses_type
    CHECK (expense_type IN ('route_operating', 'worker_personal'));

-- Positive amount constraint
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS chk_expenses_amount_pos;
ALTER TABLE public.expenses ADD CONSTRAINT chk_expenses_amount_pos
    CHECK (amount > 0);

-- Trigger: Block direct physical DELETE on expenses
CREATE OR REPLACE FUNCTION public.prevent_expense_deletion()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Direct deletion of expenses is prohibited. Use authorized expense rejection or reversal.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_expenses_no_delete ON public.expenses;
CREATE TRIGGER trg_expenses_no_delete
BEFORE DELETE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.prevent_expense_deletion();

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_expenses_worker ON public.expenses(worker_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON public.expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_payment_method ON public.expenses(payment_method);
CREATE INDEX IF NOT EXISTS idx_expenses_route_status ON public.expenses(route_id, status);
CREATE INDEX IF NOT EXISTS idx_expenses_picklist_status ON public.expenses(picklist_id, status);

-- ----------------------------------------------------------------------------
-- 2. RPC: create_expense_with_idempotency
-- ----------------------------------------------------------------------------

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
AS $function$
DECLARE
    v_existing record;
    v_resolved_route_id uuid := p_route_id;
    v_id uuid;
    v_status text := p_status;
    v_approved_at timestamptz := NULL;
    v_approved_by text := NULL;
BEGIN
    -- 1. Check idempotency
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

    -- 2. Validations
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

    -- 3. Resolve route from picklist if needed
    IF p_picklist_id IS NOT NULL AND v_resolved_route_id IS NULL THEN
        SELECT route_id INTO v_resolved_route_id
        FROM public.picklists
        WHERE id = p_picklist_id;
    END IF;

    IF v_status = 'approved' THEN
        v_approved_at := now();
        v_approved_by := COALESCE(p_actor_id, p_worker_id::text);
    END IF;

    -- 4. Insert expense
    INSERT INTO public.expenses (
        category,
        amount,
        date,
        payment_method,
        description,
        worker_id,
        route_id,
        picklist_id,
        expense_type,
        status,
        receipt_url,
        visible_to_worker,
        idempotency_key,
        approved_at,
        approved_by
    ) VALUES (
        trim(p_category),
        p_amount,
        COALESCE(p_date, CURRENT_DATE),
        p_payment_method,
        p_description,
        p_worker_id,
        v_resolved_route_id,
        p_picklist_id,
        p_expense_type,
        v_status,
        p_receipt_url,
        p_visible_to_worker,
        p_idempotency_key,
        v_approved_at,
        v_approved_by
    )
    RETURNING id INTO v_id;

    -- 5. Audit Log
    PERFORM public.log_system_event(
        COALESCE(p_actor_id, p_worker_id::text, ''),
        'Worker/Admin',
        'expense',
        'expense_created',
        'success',
        'Expense ' || v_id || ' of ₹' || p_amount || ' (' || p_category || ', ' || p_payment_method || ') created with status ' || v_status,
        'expense',
        v_id::text
    );

    RETURN jsonb_build_object(
        'success', true,
        'expense_id', v_id,
        'status', v_status,
        'amount', p_amount,
        'category', p_category,
        'payment_method', p_payment_method
    );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. RPC: approve_expense
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.approve_expense(
    p_expense_id UUID,
    p_actor_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_expense record;
BEGIN
    -- 1. Lock expense row
    SELECT * INTO v_expense
    FROM public.expenses
    WHERE id = p_expense_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Expense % not found', p_expense_id;
    END IF;

    -- Idempotent check
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

    -- 2. Transition to approved
    UPDATE public.expenses
    SET status = 'approved',
        approved_at = now(),
        approved_by = p_actor_id,
        updated_at = now()
    WHERE id = p_expense_id;

    -- 3. Audit Log
    PERFORM public.log_system_event(
        COALESCE(p_actor_id, ''),
        'Admin/Master',
        'expense',
        'expense_approved',
        'success',
        'Expense ' || p_expense_id || ' of ₹' || v_expense.amount || ' (' || v_expense.category || ') approved by ' || COALESCE(p_actor_id, 'Admin'),
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

-- ----------------------------------------------------------------------------
-- 4. RPC: reject_expense
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reject_expense(
    p_expense_id UUID,
    p_actor_id TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_expense record;
BEGIN
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
        rejected_by = p_actor_id,
        rejection_reason = p_reason,
        updated_at = now()
    WHERE id = p_expense_id;

    PERFORM public.log_system_event(
        COALESCE(p_actor_id, ''),
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

-- ----------------------------------------------------------------------------
-- 5. RPC: reverse_expense
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reverse_expense(
    p_expense_id UUID,
    p_actor_id TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_expense record;
BEGIN
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
        RAISE EXCEPTION 'Only approved expenses can be reversed (current status: %)', v_expense.status;
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RAISE EXCEPTION 'Reversal reason is mandatory when reversing an approved expense';
    END IF;

    UPDATE public.expenses
    SET status = 'reversed',
        reversed_at = now(),
        reversed_by = p_actor_id,
        reversal_reason = p_reason,
        updated_at = now()
    WHERE id = p_expense_id;

    PERFORM public.log_system_event(
        COALESCE(p_actor_id, ''),
        'Admin/Master',
        'expense',
        'expense_reversed',
        'warning',
        'Approved expense ' || p_expense_id || ' of ₹' || v_expense.amount || ' reversed by ' || COALESCE(p_actor_id, 'Admin') || '. Reason: ' || p_reason,
        'expense',
        p_expense_id::text
    );

    RETURN jsonb_build_object(
        'success', true,
        'expense_id', p_expense_id,
        'status', 'reversed',
        'reversed_amount', v_expense.amount
    );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 6. UPDATE reconcile_and_close_route_finances (Stage 6 Integration)
-- ----------------------------------------------------------------------------

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
BEGIN
    -- 1. Lock picklist FOR UPDATE
    SELECT * INTO v_picklist
    FROM public.picklists
    WHERE id = p_picklist_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Picklist % not found', p_picklist_id;
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

    -- 4. Process Route Expenses Atomically with Stage 6 Status & Payment Method
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
                    v_exp_cat, v_exp_amt, CURRENT_DATE, v_exp_method, v_exp_desc, p_worker_id, v_picklist.route_id,
                    p_picklist_id, 'approved', true, 'exp:' || p_picklist_id::text || ':' || v_idx::text, now(), COALESCE(p_actor_id, p_worker_id::text)
                ) ON CONFLICT (idempotency_key) DO NOTHING;
            END IF;
        END LOOP;
    END IF;

    -- Authoritative total approved expenses for this picklist
    SELECT COALESCE(SUM(amount), 0) INTO v_total_expenses
    FROM public.expenses
    WHERE picklist_id = p_picklist_id
      AND status = 'approved';

    -- Authoritative approved CASH expenses (only cash expenses reduce physical cash handover)
    SELECT COALESCE(SUM(amount), 0) INTO v_cash_expenses
    FROM public.expenses
    WHERE picklist_id = p_picklist_id
      AND status = 'approved'
      AND payment_method = 'cash';

    -- 5. Calculate Net Cash Deposit & Discrepancy
    v_net_cash_deposit := v_expected_cash - v_cash_expenses;
    v_discrepancy := COALESCE(p_actual_cash, 0) - v_net_cash_deposit;

    IF v_discrepancy <> 0 THEN
        IF NOT p_discrepancy_authorized THEN
            RAISE EXCEPTION 'Cash discrepancy of ₹% requires Admin/Master PIN authorization.', v_discrepancy;
        END IF;
        v_recon_status := 'discrepancy';
    ELSE
        v_recon_status := 'reconciled';
    END IF;

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
        reconciled_by_worker_id = p_worker_id,
        financial_reconciliation_status = v_recon_status,
        updated_at = now()
    WHERE id = p_picklist_id;

    -- 7. Audit Log
    PERFORM public.log_system_event(
        COALESCE(p_actor_id, p_worker_id::text, ''),
        'Worker/Admin',
        'route',
        CASE WHEN v_discrepancy <> 0 THEN 'route_financial_discrepancy' ELSE 'route_financial_reconciled' END,
        'success',
        'Route ' || p_picklist_id || ' financial reconciliation: Expected Net ₹' || v_net_cash_deposit || ' (Cash coll: ₹' || v_expected_cash || ' - Cash exp: ₹' || v_cash_expenses || '), Actual ₹' || p_actual_cash || ' (Discrepancy: ₹' || v_discrepancy || ')',
        'picklist',
        p_picklist_id::text
    );

    RETURN jsonb_build_object(
        'success', true,
        'picklist_id', p_picklist_id,
        'status', v_recon_status,
        'expected_cash', v_expected_cash,
        'total_expenses', v_total_expenses,
        'cash_expenses', v_cash_expenses,
        'net_cash_deposit', v_net_cash_deposit,
        'actual_cash_returned', p_actual_cash,
        'cash_discrepancy', v_discrepancy,
        'expected_upi', v_expected_upi,
        'expected_cheque', v_expected_cheque,
        'expected_credit', v_expected_credit
    );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 7. RPC: get_route_profitability (Authoritative Route Contribution)
-- ----------------------------------------------------------------------------

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
AS $function$
DECLARE
    v_routes_cursor CURSOR FOR
        SELECT DISTINCT
            p.id AS picklist_id,
            p.picklist_number,
            p.date AS picklist_date,
            r.id AS route_id,
            r.name AS route_name,
            r.code AS route_code,
            w.id AS worker_id,
            w.name AS worker_name,
            p.financial_reconciliation_status,
            p.actual_cash_returned,
            p.financial_reconciled_at
        FROM public.picklists p
        LEFT JOIN public.routes r ON p.route_id = r.id
        LEFT JOIN public.workers w ON p.worker_id = w.id
        WHERE (p_picklist_id IS NULL OR p.id = p_picklist_id)
          AND (p_route_id IS NULL OR p.route_id = p_route_id)
          AND (p_worker_id IS NULL OR p.worker_id = p_worker_id)
          AND (p_start_date IS NULL OR p.date >= p_start_date)
          AND (p_end_date IS NULL OR p.date <= p_end_date)
        ORDER BY p.date DESC;

    v_rec record;
    v_sales numeric(12, 2);
    v_cash numeric(12, 2);
    v_upi numeric(12, 2);
    v_cheque_cleared numeric(12, 2);
    v_cheque_pending numeric(12, 2);
    v_cheque_bounced numeric(12, 2);
    v_credit numeric(12, 2);
    v_approved_expenses numeric(12, 2);
    v_cash_expenses numeric(12, 2);
    v_expected_cash numeric(12, 2);
    v_actual_cash numeric(12, 2);
    v_discrepancy numeric(12, 2);
    v_contribution numeric(12, 2);

    v_route_list jsonb := '[]'::jsonb;

    -- Aggregate totals
    v_tot_sales numeric(12, 2) := 0;
    v_tot_cash numeric(12, 2) := 0;
    v_tot_upi numeric(12, 2) := 0;
    v_tot_cheque_cleared numeric(12, 2) := 0;
    v_tot_cheque_pending numeric(12, 2) := 0;
    v_tot_credit numeric(12, 2) := 0;
    v_tot_approved_exp numeric(12, 2) := 0;
    v_tot_cash_exp numeric(12, 2) := 0;
    v_tot_expected_cash numeric(12, 2) := 0;
    v_tot_actual_cash numeric(12, 2) := 0;
    v_tot_discrepancy numeric(12, 2) := 0;
    v_tot_contribution numeric(12, 2) := 0;
BEGIN
    OPEN v_routes_cursor;
    LOOP
        FETCH v_routes_cursor INTO v_rec;
        EXIT WHEN NOT FOUND;

        -- 1. Delivered Commercial Sales for this trip
        SELECT COALESCE(SUM(delivered_amount), 0) INTO v_sales
        FROM public.deliveries
        WHERE picklist_id = v_rec.picklist_id
          AND status IN ('delivered', 'partial');

        -- 2. Collections by mode for this trip
        SELECT COALESCE(SUM(amount), 0) INTO v_cash
        FROM public.payments
        WHERE picklist_id = v_rec.picklist_id
          AND payment_mode = 'cash'
          AND status IN ('collected', 'cleared');

        SELECT COALESCE(SUM(amount), 0) INTO v_upi
        FROM public.payments
        WHERE picklist_id = v_rec.picklist_id
          AND payment_mode = 'upi'
          AND status IN ('collected', 'cleared');

        SELECT COALESCE(SUM(CASE WHEN status = 'cleared' THEN amount ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN status = 'bounced' THEN amount ELSE 0 END), 0)
        INTO v_cheque_cleared, v_cheque_pending, v_cheque_bounced
        FROM public.payments
        WHERE picklist_id = v_rec.picklist_id
          AND payment_mode = 'cheque';

        -- 3. Credit extended on this trip
        SELECT COALESCE(SUM(GREATEST(0, delivered_amount - collected_amount)), 0) INTO v_credit
        FROM public.deliveries
        WHERE picklist_id = v_rec.picklist_id
          AND status IN ('delivered', 'partial');

        -- 4. Approved Expenses for this trip
        SELECT COALESCE(SUM(amount), 0) INTO v_approved_expenses
        FROM public.expenses
        WHERE picklist_id = v_rec.picklist_id
          AND status = 'approved';

        SELECT COALESCE(SUM(amount), 0) INTO v_cash_expenses
        FROM public.expenses
        WHERE picklist_id = v_rec.picklist_id
          AND status = 'approved'
          AND payment_method = 'cash';

        -- 5. Cash handover math
        v_expected_cash := v_cash - v_cash_expenses;
        v_actual_cash := COALESCE(v_rec.actual_cash_returned, 0);
        v_discrepancy := v_actual_cash - v_expected_cash;

        -- 6. Route Contribution Before COGS = Commercial Sales - Approved Expenses
        v_contribution := v_sales - v_approved_expenses;

        -- Accumulate totals
        v_tot_sales := v_tot_sales + v_sales;
        v_tot_cash := v_tot_cash + v_cash;
        v_tot_upi := v_tot_upi + v_upi;
        v_tot_cheque_cleared := v_tot_cheque_cleared + v_cheque_cleared;
        v_tot_cheque_pending := v_tot_cheque_pending + v_cheque_pending;
        v_tot_credit := v_tot_credit + v_credit;
        v_tot_approved_exp := v_tot_approved_exp + v_approved_expenses;
        v_tot_cash_exp := v_tot_cash_exp + v_cash_expenses;
        v_tot_expected_cash := v_tot_expected_cash + v_expected_cash;
        v_tot_actual_cash := v_tot_actual_cash + v_actual_cash;
        v_tot_discrepancy := v_tot_discrepancy + v_discrepancy;
        v_tot_contribution := v_tot_contribution + v_contribution;

        v_route_list := v_route_list || jsonb_build_object(
            'picklist_id', v_rec.picklist_id,
            'picklist_number', v_rec.picklist_number,
            'date', v_rec.picklist_date,
            'route_id', v_rec.route_id,
            'route_name', v_rec.route_name,
            'route_code', v_rec.route_code,
            'worker_id', v_rec.worker_id,
            'worker_name', v_rec.worker_name,
            'sales', v_sales,
            'cash_collected', v_cash,
            'upi_collected', v_upi,
            'cheque_cleared', v_cheque_cleared,
            'cheque_pending', v_cheque_pending,
            'cheque_bounced', v_cheque_bounced,
            'credit_sales', v_credit,
            'total_collected', (v_cash + v_upi + v_cheque_cleared),
            'approved_expenses', v_approved_expenses,
            'cash_expenses', v_cash_expenses,
            'non_cash_expenses', (v_approved_expenses - v_cash_expenses),
            'expected_cash', v_expected_cash,
            'actual_cash_returned', v_actual_cash,
            'cash_discrepancy', v_discrepancy,
            'contribution_before_cogs', v_contribution,
            'financial_status', COALESCE(v_rec.financial_reconciliation_status, 'pending'),
            'reconciled_at', v_rec.financial_reconciled_at
        );
    END LOOP;
    CLOSE v_routes_cursor;

    RETURN jsonb_build_object(
        'success', true,
        'routes', v_route_list,
        'totals', jsonb_build_object(
            'sales', v_tot_sales,
            'cash_collected', v_tot_cash,
            'upi_collected', v_tot_upi,
            'cheque_cleared', v_tot_cheque_cleared,
            'cheque_pending', v_tot_cheque_pending,
            'credit_sales', v_tot_credit,
            'total_collected', (v_tot_cash + v_tot_upi + v_tot_cheque_cleared),
            'approved_expenses', v_tot_approved_exp,
            'cash_expenses', v_tot_cash_exp,
            'non_cash_expenses', (v_tot_approved_exp - v_tot_cash_exp),
            'expected_cash', v_tot_expected_cash,
            'actual_cash_returned', v_tot_actual_cash,
            'cash_discrepancy', v_tot_discrepancy,
            'contribution_before_cogs', v_tot_contribution
        )
    );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 8. UPDATE get_financial_summary (Approved Expenses & Cash Separation)
-- ----------------------------------------------------------------------------

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
AS $function$
DECLARE
    v_sales numeric(12, 2) := 0;
    v_cash numeric(12, 2) := 0;
    v_upi numeric(12, 2) := 0;
    v_cheque_cleared numeric(12, 2) := 0;
    v_cheque_pending numeric(12, 2) := 0;
    v_credit_extended numeric(12, 2) := 0;
    v_approved_expenses numeric(12, 2) := 0;
    v_cash_expenses numeric(12, 2) := 0;
    v_outstanding numeric(12, 2) := 0;
    v_total_collected numeric(12, 2) := 0;
    v_net_cash numeric(12, 2) := 0;
    v_contribution numeric(12, 2) := 0;
BEGIN
    -- 1. Delivered Commercial Sales
    SELECT COALESCE(SUM(d.delivered_amount), 0) INTO v_sales
    FROM public.deliveries d
    WHERE d.status IN ('delivered', 'partial')
      AND (p_picklist_id IS NULL OR d.picklist_id = p_picklist_id)
      AND (p_worker_id IS NULL OR d.worker_id = p_worker_id)
      AND (p_start_date IS NULL OR d.delivery_date >= p_start_date)
      AND (p_end_date IS NULL OR d.delivery_date <= p_end_date);

    -- 2. Cash Collections
    SELECT COALESCE(SUM(p.amount), 0) INTO v_cash
    FROM public.payments p
    WHERE p.payment_mode = 'cash'
      AND p.status IN ('collected', 'cleared')
      AND (p_picklist_id IS NULL OR p.picklist_id = p_picklist_id)
      AND (p_route_id IS NULL OR p.route_id = p_route_id)
      AND (p_worker_id IS NULL OR p.worker_id = p_worker_id)
      AND (p_start_date IS NULL OR p.payment_date >= p_start_date)
      AND (p_end_date IS NULL OR p.payment_date <= p_end_date);

    -- 3. UPI Collections
    SELECT COALESCE(SUM(p.amount), 0) INTO v_upi
    FROM public.payments p
    WHERE p.payment_mode = 'upi'
      AND p.status IN ('collected', 'cleared')
      AND (p_picklist_id IS NULL OR p.picklist_id = p_picklist_id)
      AND (p_route_id IS NULL OR p.route_id = p_route_id)
      AND (p_worker_id IS NULL OR p.worker_id = p_worker_id)
      AND (p_start_date IS NULL OR p.payment_date >= p_start_date)
      AND (p_end_date IS NULL OR p.payment_date <= p_end_date);

    -- 4. Cheque Cleared & Pending
    SELECT COALESCE(SUM(CASE WHEN p.status = 'cleared' THEN p.amount ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN p.status = 'pending' THEN p.amount ELSE 0 END), 0)
    INTO v_cheque_cleared, v_cheque_pending
    FROM public.payments p
    WHERE p.payment_mode = 'cheque'
      AND (p_picklist_id IS NULL OR p.picklist_id = p_picklist_id)
      AND (p_route_id IS NULL OR p.route_id = p_route_id)
      AND (p_worker_id IS NULL OR p.worker_id = p_worker_id)
      AND (p_start_date IS NULL OR p.payment_date >= p_start_date)
      AND (p_end_date IS NULL OR p.payment_date <= p_end_date);

    -- 5. Credit Extended (Delivered commercial minus doorstep collected)
    SELECT COALESCE(SUM(GREATEST(0, d.delivered_amount - d.collected_amount)), 0) INTO v_credit_extended
    FROM public.deliveries d
    WHERE d.status IN ('delivered', 'partial')
      AND (p_picklist_id IS NULL OR d.picklist_id = p_picklist_id)
      AND (p_worker_id IS NULL OR d.worker_id = p_worker_id)
      AND (p_start_date IS NULL OR d.delivery_date >= p_start_date)
      AND (p_end_date IS NULL OR d.delivery_date <= p_end_date);

    -- 6. Authoritative Approved Expenses only
    SELECT COALESCE(SUM(e.amount), 0) INTO v_approved_expenses
    FROM public.expenses e
    WHERE e.status = 'approved'
      AND (p_picklist_id IS NULL OR e.picklist_id = p_picklist_id)
      AND (p_route_id IS NULL OR e.route_id = p_route_id)
      AND (p_worker_id IS NULL OR e.worker_id = p_worker_id)
      AND (p_start_date IS NULL OR e.date >= p_start_date)
      AND (p_end_date IS NULL OR e.date <= p_end_date);

    SELECT COALESCE(SUM(e.amount), 0) INTO v_cash_expenses
    FROM public.expenses e
    WHERE e.status = 'approved'
      AND e.payment_method = 'cash'
      AND (p_picklist_id IS NULL OR e.picklist_id = p_picklist_id)
      AND (p_route_id IS NULL OR e.route_id = p_route_id)
      AND (p_worker_id IS NULL OR e.worker_id = p_worker_id)
      AND (p_start_date IS NULL OR e.date >= p_start_date)
      AND (p_end_date IS NULL OR e.date <= p_end_date);

    -- 7. Cumulative Customer Outstanding across ledger
    SELECT COALESCE(
        SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END),
        0
    ) INTO v_outstanding
    FROM public.party_financial_ledger
    WHERE status = 'valid';

    v_total_collected := v_cash + v_upi + v_cheque_cleared;
    v_net_cash := v_cash - v_cash_expenses;
    v_contribution := v_sales - v_approved_expenses;

    RETURN jsonb_build_object(
        'sales', v_sales,
        'total_collected', v_total_collected,
        'cash', v_cash,
        'upi', v_upi,
        'cheque_cleared', v_cheque_cleared,
        'cheque_pending', v_cheque_pending,
        'credit_extended', v_credit_extended,
        'expenses', v_approved_expenses,
        'cash_expenses', v_cash_expenses,
        'net_cash', v_net_cash,
        'total_outstanding', v_outstanding,
        'contribution_before_cogs', v_contribution
    );
END;
$function$;

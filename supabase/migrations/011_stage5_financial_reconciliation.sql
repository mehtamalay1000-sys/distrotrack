-- ============================================================================
-- Migration: 011_stage5_financial_reconciliation.sql
-- Description: Stage 5: Production-Grade Payment & Financial Reconciliation Subsystem
--   1. party_financial_ledger table (append-only double-entry customer receivables)
--   2. payments hardening (idempotency, UPI partial unique index, reversal tracking, immutability trigger)
--   3. picklists financial reconciliation columns (total_upi, expected cash, actual cash, discrepancy)
--   4. expenses picklist linkage & idempotency
--   5. Core RPCs:
--      - get_party_outstanding (authoritative ledger balance)
--      - record_party_payment_with_ledger (atomic standalone/ad-hoc payments)
--      - reverse_payment_with_ledger (authorized payment reversal)
--      - update_cheque_status (pending -> cleared / bounced lifecycle)
--      - complete_delivery_with_ledger (integrated split payments & ledger debits/credits)
--      - reconcile_and_close_route_finances (atomic two-stage route financial reconciliation)
--      - get_financial_summary (unified authoritative financial reporting)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CREATE party_financial_ledger
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.party_financial_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_id UUID NOT NULL REFERENCES public.parties(id) ON DELETE RESTRICT,
    invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
    delivery_id UUID REFERENCES public.deliveries(id) ON DELETE SET NULL,
    payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
    picklist_id UUID REFERENCES public.picklists(id) ON DELETE SET NULL,
    route_id UUID REFERENCES public.routes(id) ON DELETE SET NULL,
    entry_type TEXT NOT NULL CHECK (entry_type IN ('sale', 'payment', 'payment_reversal', 'cheque_bounce', 'credit_adjustment')),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
    status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'void')),
    reference_id TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT,
    idempotency_key TEXT UNIQUE
);

-- Indexes on party_financial_ledger
CREATE INDEX IF NOT EXISTS idx_pfl_party_id ON public.party_financial_ledger(party_id);
CREATE INDEX IF NOT EXISTS idx_pfl_delivery_id ON public.party_financial_ledger(delivery_id);
CREATE INDEX IF NOT EXISTS idx_pfl_invoice_id ON public.party_financial_ledger(invoice_id);
CREATE INDEX IF NOT EXISTS idx_pfl_payment_id ON public.party_financial_ledger(payment_id);
CREATE INDEX IF NOT EXISTS idx_pfl_picklist_id ON public.party_financial_ledger(picklist_id);
CREATE INDEX IF NOT EXISTS idx_pfl_created_at ON public.party_financial_ledger(created_at);

-- Trigger: Append-only protection on party_financial_ledger
CREATE OR REPLACE FUNCTION public.prevent_financial_ledger_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'party_financial_ledger is append-only. UPDATE and DELETE operations are prohibited.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_party_financial_ledger_immutable ON public.party_financial_ledger;
CREATE TRIGGER trg_party_financial_ledger_immutable
BEFORE UPDATE OR DELETE ON public.party_financial_ledger
FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_ledger_modification();

-- ----------------------------------------------------------------------------
-- 2. HARDEN payments TABLE
-- ----------------------------------------------------------------------------

-- Add picklist_id, route_id, idempotency_key, and reversal columns to payments
ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS picklist_id UUID REFERENCES public.picklists(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS route_id UUID REFERENCES public.routes(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reversed_by TEXT,
    ADD COLUMN IF NOT EXISTS reversal_reason TEXT,
    ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS bounce_reason TEXT;

-- Update payments status check constraint to include 'cleared' and 'reversed'
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check
    CHECK (status IN ('collected', 'pending', 'cleared', 'bounced', 'reversed'));

-- Positive amount constraint
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS chk_payments_amount_positive;
ALTER TABLE public.payments ADD CONSTRAINT chk_payments_amount_positive
    CHECK (amount > 0);

-- Partial Unique Index on UPI reference (non-empty UPI reference cannot be duplicated)
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_upi_ref ON public.payments (reference_number)
WHERE payment_mode = 'upi' AND reference_number IS NOT NULL AND trim(reference_number) <> '';

-- Indexes on payments
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON public.payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_worker ON public.payments (worker_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON public.payments (payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments (status);
CREATE INDEX IF NOT EXISTS idx_payments_picklist ON public.payments (picklist_id);
CREATE INDEX IF NOT EXISTS idx_payments_route ON public.payments (route_id);

-- Trigger: Block direct physical DELETE on payments
CREATE OR REPLACE FUNCTION public.prevent_payment_deletion()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Direct deletion of payments is prohibited. Use authorized payment reversal.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_no_delete ON public.payments;
CREATE TRIGGER trg_payments_no_delete
BEFORE DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.prevent_payment_deletion();

-- ----------------------------------------------------------------------------
-- 3. EXPAND picklists FOR FINANCIAL RECONCILIATION
-- ----------------------------------------------------------------------------

ALTER TABLE public.picklists
    ADD COLUMN IF NOT EXISTS total_upi NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS expected_cash NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS actual_cash_returned NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cash_discrepancy NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_expenses NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS net_cash_deposit NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS expected_upi NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS expected_cheque NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS expected_credit NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS financial_reconciled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reconciled_by_worker_id UUID REFERENCES public.workers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS financial_reconciliation_status TEXT NOT NULL DEFAULT 'pending';

-- Status constraint for financial reconciliation
ALTER TABLE public.picklists DROP CONSTRAINT IF EXISTS chk_picklists_fin_recon_status;
ALTER TABLE public.picklists ADD CONSTRAINT chk_picklists_fin_recon_status
    CHECK (financial_reconciliation_status IN ('pending', 'reconciled', 'discrepancy'));

-- ----------------------------------------------------------------------------
-- 4. HARDEN expenses TABLE
-- ----------------------------------------------------------------------------

ALTER TABLE public.expenses
    ADD COLUMN IF NOT EXISTS picklist_id UUID REFERENCES public.picklists(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_expenses_picklist ON public.expenses (picklist_id);

-- ----------------------------------------------------------------------------
-- 5. RPC: get_party_outstanding (Authoritative Ledger Balance)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_party_outstanding(p_party_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END),
        0
    )::numeric(12, 2)
    FROM public.party_financial_ledger
    WHERE party_id = p_party_id AND status = 'valid';
$$;

-- ----------------------------------------------------------------------------
-- 6. RPC: record_party_payment_with_ledger (Atomic Ad-Hoc / Standalone Payments)
-- ----------------------------------------------------------------------------

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
AS $function$
DECLARE
    v_party record;
    v_payment_id uuid;
    v_current_outstanding numeric(12, 2);
    v_status text;
    v_resolved_route_id uuid := p_route_id;
    v_resolved_picklist_id uuid := p_picklist_id;
    v_existing_payment record;
BEGIN
    -- 1. Check idempotency
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

    -- 2. Lock party FOR UPDATE
    SELECT * INTO v_party
    FROM public.parties
    WHERE id = p_party_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Party % not found', p_party_id;
    END IF;

    -- 3. Validate amount & mode
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero';
    END IF;

    IF p_payment_mode NOT IN ('cash', 'upi', 'cheque', 'credit') THEN
        RAISE EXCEPTION 'Invalid payment mode: %', p_payment_mode;
    END IF;

    -- 4. Validate UPI
    IF p_payment_mode = 'upi' THEN
        IF p_reference_number IS NULL OR trim(p_reference_number) = '' THEN
            RAISE EXCEPTION 'UPI reference number is required for UPI payments';
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.payments
            WHERE payment_mode = 'upi'
              AND reference_number = trim(p_reference_number)
              AND status NOT IN ('reversed', 'bounced')
        ) THEN
            RAISE EXCEPTION 'Duplicate UPI reference number %: already recorded in system', trim(p_reference_number);
        END IF;
    END IF;

    -- 5. Validate Cheque
    IF p_payment_mode = 'cheque' THEN
        IF p_cheque_number IS NULL OR trim(p_cheque_number) = '' THEN
            RAISE EXCEPTION 'Cheque number is required for cheque payments';
        END IF;
    END IF;

    -- 6. Check overpayment against current outstanding
    v_current_outstanding := public.get_party_outstanding(p_party_id);
    IF p_amount > v_current_outstanding AND v_current_outstanding > 0 THEN
        RAISE EXCEPTION 'Payment amount ₹% exceeds customer outstanding balance ₹%', p_amount, v_current_outstanding;
    END IF;

    -- 7. Resolve route / picklist from delivery if provided
    IF p_delivery_id IS NOT NULL AND (v_resolved_picklist_id IS NULL OR v_resolved_route_id IS NULL) THEN
        SELECT picklist_id INTO v_resolved_picklist_id FROM public.deliveries WHERE id = p_delivery_id;
        IF v_resolved_picklist_id IS NOT NULL AND v_resolved_route_id IS NULL THEN
            SELECT route_id INTO v_resolved_route_id FROM public.picklists WHERE id = v_resolved_picklist_id;
        END IF;
    END IF;

    -- 8. Set initial payment status
    -- Cheque starts as 'pending' until cleared; cash and UPI are 'collected'
    v_status := CASE WHEN p_payment_mode = 'cheque' THEN 'pending'
                     WHEN p_payment_mode = 'credit' THEN 'pending'
                     ELSE 'collected' END;

    -- 9. Insert payment
    INSERT INTO public.payments (
        party_id,
        invoice_id,
        delivery_id,
        picklist_id,
        route_id,
        worker_id,
        received_by_worker_id,
        amount,
        payment_mode,
        reference_number,
        cheque_number,
        cheque_date,
        cheque_bank,
        notes,
        payment_date,
        status,
        idempotency_key
    ) VALUES (
        p_party_id,
        p_invoice_id,
        p_delivery_id,
        v_resolved_picklist_id,
        v_resolved_route_id,
        p_worker_id,
        p_worker_id,
        p_amount,
        p_payment_mode,
        trim(p_reference_number),
        trim(p_cheque_number),
        p_cheque_date,
        p_cheque_bank,
        p_notes,
        p_payment_date,
        v_status,
        p_idempotency_key
    )
    RETURNING id INTO v_payment_id;

    -- 10. For cash or upi settlement: record credit in party_financial_ledger
    IF p_payment_mode IN ('cash', 'upi') THEN
        INSERT INTO public.party_financial_ledger (
            party_id,
            invoice_id,
            delivery_id,
            payment_id,
            picklist_id,
            route_id,
            entry_type,
            amount,
            direction,
            status,
            reference_id,
            notes,
            created_by,
            idempotency_key
        ) VALUES (
            p_party_id,
            p_invoice_id,
            p_delivery_id,
            v_payment_id,
            v_resolved_picklist_id,
            v_resolved_route_id,
            'payment',
            p_amount,
            'credit',
            'valid',
            v_payment_id::text,
            'Settlement via ' || p_payment_mode || COALESCE(' (Ref: ' || p_reference_number || ')', ''),
            p_worker_id::text,
            COALESCE(p_idempotency_key, 'pfl_pay:' || v_payment_id::text)
        );

        -- Atomically update cached parties.outstanding_amount
        UPDATE public.parties
        SET outstanding_amount = public.get_party_outstanding(p_party_id),
            updated_at = now()
        WHERE id = p_party_id;
    END IF;

    -- 11. Audit log
    PERFORM public.log_system_event(
        COALESCE(p_worker_id::text, ''),
        'Worker',
        'payment',
        'payment_created',
        'success',
        'Payment of ₹' || p_amount || ' via ' || p_payment_mode || ' recorded for party ' || p_party_id,
        'payment',
        v_payment_id::text
    );

    RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'amount', p_amount,
        'status', v_status,
        'new_outstanding', public.get_party_outstanding(p_party_id)
    );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 7. RPC: reverse_payment_with_ledger (Authorized Payment Reversal)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reverse_payment_with_ledger(
    p_payment_id UUID,
    p_actor_id TEXT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_payment record;
    v_new_outstanding numeric(12, 2);
BEGIN
    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RAISE EXCEPTION 'Reversal reason is required.';
    END IF;

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
        reversed_by = p_actor_id,
        reversal_reason = p_reason,
        updated_at = now()
    WHERE id = p_payment_id;

    -- 3. If payment had reduced receivable (status was 'collected' or 'cleared'):
    -- create offsetting debit in party_financial_ledger to restore the debt
    IF v_payment.status IN ('collected', 'cleared') THEN
        INSERT INTO public.party_financial_ledger (
            party_id,
            invoice_id,
            delivery_id,
            payment_id,
            picklist_id,
            route_id,
            entry_type,
            amount,
            direction,
            status,
            reference_id,
            notes,
            created_by,
            idempotency_key
        ) VALUES (
            v_payment.party_id,
            v_payment.invoice_id,
            v_payment.delivery_id,
            p_payment_id,
            v_payment.picklist_id,
            v_payment.route_id,
            'payment_reversal',
            v_payment.amount,
            'debit',
            'valid',
            p_payment_id::text,
            'Reversal of payment ' || p_payment_id || ': ' || p_reason,
            p_actor_id,
            'rev:' || p_payment_id::text
        );

        -- Update delivery collected_amount if attached
        IF v_payment.delivery_id IS NOT NULL THEN
            UPDATE public.deliveries
            SET collected_amount = GREATEST(0, collected_amount - v_payment.amount),
                updated_at = now()
            WHERE id = v_payment.delivery_id;
        END IF;

        -- Atomically update cached parties.outstanding_amount
        UPDATE public.parties
        SET outstanding_amount = public.get_party_outstanding(v_payment.party_id),
            updated_at = now()
        WHERE id = v_payment.party_id;
    END IF;

    v_new_outstanding := public.get_party_outstanding(v_payment.party_id);

    -- 4. Audit event
    PERFORM public.log_system_event(
        COALESCE(p_actor_id, ''),
        'Admin/Master',
        'payment',
        'payment_reversed',
        'success',
        'Payment ' || p_payment_id || ' of ₹' || v_payment.amount || ' reversed by ' || p_actor_id || '. Reason: ' || p_reason,
        'payment',
        p_payment_id::text
    );

    RETURN jsonb_build_object(
        'success', true,
        'payment_id', p_payment_id,
        'status', 'reversed',
        'reversed_amount', v_payment.amount,
        'new_outstanding', v_new_outstanding
    );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 8. RPC: update_cheque_status (Pending -> Cleared / Bounced Lifecycle)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_cheque_status(
    p_payment_id UUID,
    p_status TEXT,
    p_actor_id TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_payment record;
    v_new_outstanding numeric(12, 2);
BEGIN
    IF p_status NOT IN ('cleared', 'bounced') THEN
        RAISE EXCEPTION 'Cheque status can only be updated to "cleared" or "bounced"';
    END IF;

    -- 1. Lock payment FOR UPDATE
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

    -- Idempotent check
    IF v_payment.status = p_status THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_in_status', true,
            'status', v_payment.status
        );
    END IF;

    -- Prohibit cleared -> bounced directly
    IF v_payment.status = 'cleared' AND p_status = 'bounced' THEN
        RAISE EXCEPTION 'Cleared cheques cannot be marked bounced directly. Use authorized reversal.';
    END IF;

    IF v_payment.status = 'bounced' THEN
        RAISE EXCEPTION 'Bounced cheque cannot be updated again.';
    END IF;

    IF v_payment.status = 'reversed' THEN
        RAISE EXCEPTION 'Reversed payment cannot be updated.';
    END IF;

    -- 2. Handle Pending -> Cleared
    IF p_status = 'cleared' THEN
        UPDATE public.payments
        SET status = 'cleared',
            updated_at = now()
        WHERE id = p_payment_id;

        -- Record settlement credit in ledger
        INSERT INTO public.party_financial_ledger (
            party_id,
            invoice_id,
            delivery_id,
            payment_id,
            picklist_id,
            route_id,
            entry_type,
            amount,
            direction,
            status,
            reference_id,
            notes,
            created_by,
            idempotency_key
        ) VALUES (
            v_payment.party_id,
            v_payment.invoice_id,
            v_payment.delivery_id,
            p_payment_id,
            v_payment.picklist_id,
            v_payment.route_id,
            'payment',
            v_payment.amount,
            'credit',
            'valid',
            v_payment.cheque_number,
            'Cheque #' || COALESCE(v_payment.cheque_number, '') || ' cleared' || COALESCE(' (' || p_reason || ')', ''),
            p_actor_id,
            'chk_clr:' || p_payment_id::text
        );

        -- Update delivery collected_amount
        IF v_payment.delivery_id IS NOT NULL THEN
            UPDATE public.deliveries
            SET collected_amount = collected_amount + v_payment.amount,
                updated_at = now()
            WHERE id = v_payment.delivery_id;
        END IF;

        -- Update cached parties.outstanding_amount
        UPDATE public.parties
        SET outstanding_amount = public.get_party_outstanding(v_payment.party_id),
            updated_at = now()
        WHERE id = v_payment.party_id;

        PERFORM public.log_system_event(
            COALESCE(p_actor_id, ''),
            'Admin',
            'payment',
            'cheque_cleared',
            'success',
            'Cheque ' || COALESCE(v_payment.cheque_number, '') || ' (₹' || v_payment.amount || ') marked cleared for party ' || v_payment.party_id,
            'payment',
            p_payment_id::text
        );
    END IF;

    -- 3. Handle Pending -> Bounced
    IF p_status = 'bounced' THEN
        IF p_reason IS NULL OR trim(p_reason) = '' THEN
            RAISE EXCEPTION 'Reason is required when marking a cheque bounced';
        END IF;

        UPDATE public.payments
        SET status = 'bounced',
            notes = COALESCE(notes || ' | Bounced: ' || p_reason, 'Bounced: ' || p_reason),
            updated_at = now()
        WHERE id = p_payment_id;

        -- Cheque was pending, so it had not credited the ledger yet. No ledger debit is needed.
        PERFORM public.log_system_event(
            COALESCE(p_actor_id, ''),
            'Admin',
            'payment',
            'cheque_bounced',
            'success',
            'Cheque ' || COALESCE(v_payment.cheque_number, '') || ' (₹' || v_payment.amount || ') marked bounced. Reason: ' || p_reason,
            'payment',
            p_payment_id::text
        );
    END IF;

    v_new_outstanding := public.get_party_outstanding(v_payment.party_id);

    RETURN jsonb_build_object(
        'success', true,
        'payment_id', p_payment_id,
        'status', p_status,
        'new_outstanding', v_new_outstanding
    );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 9. RPC: complete_delivery_with_ledger (Integrated Split Payments & Ledger)
-- ----------------------------------------------------------------------------

-- Drop old 10-parameter signature from Stage 4B to avoid ambiguous overload
DROP FUNCTION IF EXISTS public.complete_delivery_with_ledger(uuid, uuid, jsonb, text, numeric, text, text, date, text, text);

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
BEGIN
    -- 1. Lock delivery FOR UPDATE
    SELECT * INTO v_delivery
    FROM public.deliveries
    WHERE id = p_delivery_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery % not found', p_delivery_id;
    END IF;

    -- Idempotent check
    IF v_delivery.status IN ('delivered', 'partial', 'refused') THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_completed', true,
            'status', v_delivery.status,
            'delivered_amount', v_delivery.delivered_amount,
            'message', 'Delivery was already finalized'
        );
    END IF;

    -- 2. Lock picklist FOR UPDATE
    SELECT * INTO v_picklist
    FROM public.picklists
    WHERE id = v_delivery.picklist_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Picklist % for delivery % not found', v_delivery.picklist_id, p_delivery_id;
    END IF;

    -- 3. Lock delivery_items and validate counts
    SELECT count(*) INTO v_item_count FROM public.delivery_items WHERE delivery_id = p_delivery_id;
    v_input_count := jsonb_array_length(p_items);

    IF v_item_count <> v_input_count THEN
        RAISE EXCEPTION 'Item count mismatch: expected %, received %', v_item_count, v_input_count;
    END IF;

    -- 4. Process each item (Stage 4B Inventory Movements & Disposition)
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
            RAISE EXCEPTION 'Delivery item % does not belong to delivery %', v_item_id, p_delivery_id;
        END IF;

        IF v_del_qty < 0 OR v_del_free < 0 OR v_ret_qty < 0 OR v_ret_free < 0 OR v_dam_qty < 0 OR v_dam_free < 0 THEN
            RAISE EXCEPTION 'Negative quantity submitted for item %', v_item.sku;
        END IF;

        IF v_del_qty > v_item.ordered_qty THEN
            RAISE EXCEPTION 'Delivered qty % exceeds ordered qty % for SKU %', v_del_qty, v_item.ordered_qty, v_item.sku;
        END IF;

        IF v_del_free > v_item.free_quantity THEN
            RAISE EXCEPTION 'Delivered free qty % exceeds scheme free qty % for SKU %', v_del_free, v_item.free_quantity, v_item.sku;
        END IF;

        IF v_del_qty + v_ret_qty + v_dam_qty > v_item.ordered_qty THEN
            RAISE EXCEPTION 'Total disposition exceeds ordered qty % for SKU %', v_item.ordered_qty, v_item.sku;
        END IF;

        IF v_del_free + v_ret_free + v_dam_free > v_item.free_quantity THEN
            RAISE EXCEPTION 'Total free disposition exceeds scheme free qty % for SKU %', v_item.free_quantity, v_item.sku;
        END IF;

        v_phys_del := v_del_qty + v_del_free;
        v_phys_dam := v_dam_qty + v_dam_free;

        IF v_del_qty < v_item.ordered_qty OR v_del_free < v_item.free_quantity OR v_phys_dam > 0 THEN
            v_all_delivered := false;
        END IF;

        IF v_phys_del > 0 THEN
            v_all_zero := false;
        END IF;

        -- Verify vehicle stock
        IF (v_phys_del + v_phys_dam) > 0 AND v_item.product_id IS NOT NULL THEN
            v_veh_stock := public.get_vehicle_stock(v_delivery.picklist_id, v_item.product_id);
            IF v_veh_stock < (v_phys_del + v_phys_dam) THEN
                RAISE EXCEPTION 'Insufficient vehicle stock for SKU % on picklist %: required %, available %',
                    v_item.sku, v_delivery.picklist_id, (v_phys_del + v_phys_dam), v_veh_stock;
            END IF;

            IF v_phys_del > 0 THEN
                INSERT INTO public.inventory_movements (
                    product_id, sku, movement_type, quantity, direction,
                    from_location, to_location, picklist_id, route_id,
                    delivery_id, party_id, worker_id, reference_number,
                    idempotency_key, notes
                ) VALUES (
                    v_item.product_id, v_item.sku, 'delivery_fulfilled', v_phys_del, 'out',
                    'vehicle', 'customer', v_delivery.picklist_id, v_picklist.route_id,
                    p_delivery_id, v_delivery.party_id, p_worker_id, v_delivery.invoice_id::text,
                    'delivery_fulfilled:' || v_item.id,
                    'Delivered ' || v_del_qty || ' commercial + ' || v_del_free || ' free'
                ) ON CONFLICT (idempotency_key) DO NOTHING;
            END IF;

            IF v_phys_dam > 0 THEN
                INSERT INTO public.inventory_movements (
                    product_id, sku, movement_type, quantity, direction,
                    from_location, to_location, picklist_id, route_id,
                    delivery_id, party_id, worker_id, reference_number,
                    idempotency_key, notes
                ) VALUES (
                    v_item.product_id, v_item.sku, 'damaged_transit', v_phys_dam, 'out',
                    'vehicle', 'damaged_quarantine', v_delivery.picklist_id, v_picklist.route_id,
                    p_delivery_id, v_delivery.party_id, p_worker_id, v_delivery.invoice_id::text,
                    'damaged_transit:' || v_item.id,
                    'Damaged in transit: ' || v_dam_qty || ' commercial + ' || v_dam_free || ' free'
                ) ON CONFLICT (idempotency_key) DO NOTHING;
            END IF;
        END IF;

        UPDATE public.delivery_items
        SET delivered_qty = v_del_qty,
            delivered_free_qty = v_del_free,
            returned_qty = v_ret_qty,
            returned_free_qty = v_ret_free,
            damaged_qty = v_dam_qty,
            damaged_free_qty = v_dam_free
        WHERE id = v_item.id;

        -- Commercial delivered value (strictly commercial units * rate)
        v_final_delivered_amount := v_final_delivered_amount + (v_del_qty * v_item.rate);
    END LOOP;

    -- 5. Determine delivery status
    IF v_all_delivered THEN
        v_final_status := 'delivered';
    ELSIF v_all_zero THEN
        v_final_status := 'refused';
        v_final_delivered_amount := 0;
    ELSE
        v_final_status := 'partial';
    END IF;

    -- 6. Record Commercial Sale in party_financial_ledger
    IF v_final_delivered_amount > 0 THEN
        INSERT INTO public.party_financial_ledger (
            party_id, invoice_id, delivery_id, picklist_id, route_id,
            entry_type, amount, direction, status, reference_id,
            notes, created_by, idempotency_key
        ) VALUES (
            v_delivery.party_id, v_delivery.invoice_id, p_delivery_id, v_delivery.picklist_id, v_picklist.route_id,
            'sale', v_final_delivered_amount, 'debit', 'valid', v_delivery.invoice_id::text,
            'Delivered commercial sale (' || v_final_status || ')',
            p_worker_id::text,
            'sale:' || p_delivery_id::text
        ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    -- 7. Normalize Payments (Split Payments array or legacy single payment)
    -- Calculate total submitted payment
    IF p_payments IS NOT NULL AND jsonb_typeof(p_payments) = 'array' AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_pay_item IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
            v_pay_amt := COALESCE((v_pay_item->>'amount')::numeric, 0);
            v_pay_mode := COALESCE(v_pay_item->>'mode', 'cash');
            IF v_pay_mode <> 'credit' THEN
                v_total_pay_amt := v_total_pay_amt + v_pay_amt;
            END IF;
        END LOOP;
    ELSE
        IF p_payment_mode <> 'credit' THEN
            v_total_pay_amt := COALESCE(p_payment_amount, 0);
        END IF;
    END IF;

    -- Validate payment cannot exceed delivered commercial amount
    IF v_total_pay_amt < 0 THEN
        RAISE EXCEPTION 'Payment amount cannot be negative';
    END IF;

    IF v_total_pay_amt > v_final_delivered_amount THEN
        RAISE EXCEPTION 'Total payment amount ₹% cannot exceed collectible commercial amount ₹%',
            v_total_pay_amt, v_final_delivered_amount;
    END IF;

    -- 8. Process Payments & Settlements
    IF p_payments IS NOT NULL AND jsonb_typeof(p_payments) = 'array' AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_pay_item IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
            v_idx := v_idx + 1;
            v_pay_amt := COALESCE((v_pay_item->>'amount')::numeric, 0);
            v_pay_mode := COALESCE(v_pay_item->>'mode', 'cash');
            v_pay_ref := trim(v_pay_item->>'reference_number');
            v_pay_chk_num := trim(v_pay_item->>'cheque_number');
            v_pay_chk_bank := v_pay_item->>'cheque_bank';
            v_pay_notes := v_pay_item->>'notes';
            IF (v_pay_item->>'cheque_date') IS NOT NULL AND (v_pay_item->>'cheque_date') <> '' THEN
                v_pay_chk_date := (v_pay_item->>'cheque_date')::date;
            ELSE
                v_pay_chk_date := NULL;
            END IF;

            IF v_pay_amt > 0 AND v_pay_mode IN ('cash', 'upi', 'cheque') THEN
                IF v_pay_mode = 'upi' THEN
                    IF v_pay_ref IS NULL OR v_pay_ref = '' THEN
                        RAISE EXCEPTION 'UPI reference number is required for UPI payment in delivery';
                    END IF;
                    IF EXISTS (SELECT 1 FROM public.payments WHERE payment_mode = 'upi' AND reference_number = v_pay_ref AND delivery_id <> p_delivery_id AND status NOT IN ('reversed', 'bounced')) THEN
                        RAISE EXCEPTION 'Duplicate UPI reference number %', v_pay_ref;
                    END IF;
                END IF;

                v_pay_status := CASE WHEN v_pay_mode = 'cheque' THEN 'pending' ELSE 'collected' END;

                INSERT INTO public.payments (
                    delivery_id, party_id, invoice_id, picklist_id, route_id,
                    worker_id, received_by_worker_id, amount, payment_mode,
                    reference_number, cheque_number, cheque_date, cheque_bank,
                    notes, payment_date, status, idempotency_key
                ) VALUES (
                    p_delivery_id, v_delivery.party_id, v_delivery.invoice_id, v_delivery.picklist_id, v_picklist.route_id,
                    p_worker_id, p_worker_id, v_pay_amt, v_pay_mode,
                    v_pay_ref, v_pay_chk_num, v_pay_chk_date, v_pay_chk_bank,
                    v_pay_notes, CURRENT_DATE, v_pay_status,
                    'pay:' || p_delivery_id::text || ':' || v_idx::text
                )
                ON CONFLICT (idempotency_key) DO NOTHING
                RETURNING id INTO v_payment_id;

                -- If cash or upi: credit receivable in party_financial_ledger
                IF v_pay_mode IN ('cash', 'upi') THEN
                    v_total_settled_amt := v_total_settled_amt + v_pay_amt;

                    INSERT INTO public.party_financial_ledger (
                        party_id, invoice_id, delivery_id, payment_id, picklist_id, route_id,
                        entry_type, amount, direction, status, reference_id,
                        notes, created_by, idempotency_key
                    ) VALUES (
                        v_delivery.party_id, v_delivery.invoice_id, p_delivery_id, v_payment_id,
                        v_delivery.picklist_id, v_picklist.route_id,
                        'payment', v_pay_amt, 'credit', 'valid', v_pay_ref,
                        'Doorstep payment via ' || v_pay_mode,
                        p_worker_id::text,
                        'pfl_pay:' || p_delivery_id::text || ':' || v_idx::text
                    ) ON CONFLICT (idempotency_key) DO NOTHING;
                END IF;
            END IF;
        END LOOP;
    ELSE
        -- Single payment handling
        IF p_payment_mode IN ('cash', 'upi', 'cheque') AND p_payment_amount > 0 THEN
            IF p_payment_mode = 'upi' THEN
                IF p_reference_number IS NULL OR trim(p_reference_number) = '' THEN
                    RAISE EXCEPTION 'UPI reference number is required for UPI payment';
                END IF;
                IF EXISTS (SELECT 1 FROM public.payments WHERE payment_mode = 'upi' AND reference_number = trim(p_reference_number) AND delivery_id <> p_delivery_id AND status NOT IN ('reversed', 'bounced')) THEN
                    RAISE EXCEPTION 'Duplicate UPI reference number %', trim(p_reference_number);
                END IF;
            END IF;

            v_pay_status := CASE WHEN p_payment_mode = 'cheque' THEN 'pending' ELSE 'collected' END;

            INSERT INTO public.payments (
                delivery_id, party_id, invoice_id, picklist_id, route_id,
                worker_id, received_by_worker_id, amount, payment_mode,
                reference_number, cheque_number, cheque_date, cheque_bank,
                notes, payment_date, status, idempotency_key
            ) VALUES (
                p_delivery_id, v_delivery.party_id, v_delivery.invoice_id, v_delivery.picklist_id, v_picklist.route_id,
                p_worker_id, p_worker_id, p_payment_amount, p_payment_mode,
                trim(p_reference_number), trim(p_cheque_number), p_cheque_date, p_cheque_bank,
                p_notes, CURRENT_DATE, v_pay_status,
                'pay:' || p_delivery_id::text || ':1'
            )
            ON CONFLICT (idempotency_key) DO NOTHING
            RETURNING id INTO v_payment_id;

            IF p_payment_mode IN ('cash', 'upi') THEN
                v_total_settled_amt := p_payment_amount;

                INSERT INTO public.party_financial_ledger (
                    party_id, invoice_id, delivery_id, payment_id, picklist_id, route_id,
                    entry_type, amount, direction, status, reference_id,
                    notes, created_by, idempotency_key
                ) VALUES (
                    v_delivery.party_id, v_delivery.invoice_id, p_delivery_id, v_payment_id,
                    v_delivery.picklist_id, v_picklist.route_id,
                    'payment', p_payment_amount, 'credit', 'valid', p_reference_number,
                    'Doorstep payment via ' || p_payment_mode,
                    p_worker_id::text,
                    'pfl_pay:' || p_delivery_id::text || ':1'
                ) ON CONFLICT (idempotency_key) DO NOTHING;
            END IF;
        END IF;
    END IF;

    -- 9. Update delivery header
    UPDATE public.deliveries
    SET status = v_final_status,
        delivered_at = now(),
        delivered_amount = v_final_delivered_amount,
        collected_amount = v_total_settled_amt,
        payment_mode = CASE WHEN v_total_pay_amt = 0 THEN 'credit'
                            WHEN p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 1 THEN 'split'
                            ELSE p_payment_mode END,
        worker_id = COALESCE(p_worker_id, worker_id),
        updated_at = now()
    WHERE id = p_delivery_id;

    -- 10. Update invoice status
    IF v_delivery.invoice_id IS NOT NULL THEN
        UPDATE public.invoices
        SET status = CASE WHEN v_final_status = 'delivered' AND v_total_settled_amt >= v_final_delivered_amount THEN 'paid'
                          WHEN v_final_status = 'delivered' THEN 'delivered'
                          WHEN v_final_status = 'partial' THEN 'partial'
                          ELSE 'pending' END,
            updated_at = now()
        WHERE id = v_delivery.invoice_id;
    END IF;

    -- 11. Atomically update cached parties.outstanding_amount to match ledger
    UPDATE public.parties
    SET outstanding_amount = public.get_party_outstanding(v_delivery.party_id),
        updated_at = now()
    WHERE id = v_delivery.party_id;

    -- 12. Update picklist financial totals
    SELECT count(*) INTO v_completed_count
    FROM public.deliveries
    WHERE picklist_id = v_delivery.picklist_id AND status IN ('delivered', 'partial', 'refused');

    SELECT COALESCE(SUM(amount), 0) INTO v_total_cash
    FROM public.payments
    WHERE picklist_id = v_delivery.picklist_id
      AND payment_mode = 'cash'
      AND status NOT IN ('reversed', 'bounced');

    SELECT COALESCE(SUM(amount), 0) INTO v_total_upi
    FROM public.payments
    WHERE picklist_id = v_delivery.picklist_id
      AND payment_mode = 'upi'
      AND status NOT IN ('reversed', 'bounced');

    SELECT COALESCE(SUM(amount), 0) INTO v_total_cheque
    FROM public.payments
    WHERE picklist_id = v_delivery.picklist_id
      AND payment_mode = 'cheque'
      AND status NOT IN ('reversed', 'bounced');

    SELECT COALESCE(SUM(GREATEST(0, delivered_amount - collected_amount)), 0) INTO v_total_credit
    FROM public.deliveries
    WHERE picklist_id = v_delivery.picklist_id
      AND status IN ('delivered', 'partial');

    v_total_collected := v_total_cash + v_total_upi;

    UPDATE public.picklists
    SET completed_parties = v_completed_count,
        total_collected = v_total_collected,
        total_cash = v_total_cash,
        total_upi = v_total_upi,
        total_cheque = v_total_cheque,
        total_credit = v_total_credit,
        updated_at = now()
    WHERE id = v_delivery.picklist_id;

    -- 13. Audit log
    PERFORM public.log_system_event(
        COALESCE(p_worker_id::text, ''),
        'Worker',
        'delivery',
        'delivery_' || v_final_status,
        'success',
        'Delivery ' || p_delivery_id || ' marked ' || v_final_status || ' (commercial: ₹' || v_final_delivered_amount || ', collected: ₹' || v_total_settled_amt || ')',
        'delivery',
        p_delivery_id::text
    );

    RETURN jsonb_build_object(
        'success', true,
        'delivery_id', p_delivery_id,
        'status', v_final_status,
        'delivered_amount', v_final_delivered_amount,
        'collected_amount', v_total_settled_amt,
        'party_outstanding', public.get_party_outstanding(v_delivery.party_id)
    );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 10. RPC: reconcile_and_close_route_finances (Atomic Route Financial Close)
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
    v_net_cash_deposit numeric(12, 2) := 0;
    v_discrepancy numeric(12, 2) := 0;
    v_recon_status text;
    v_exp_item jsonb;
    v_exp_amt numeric;
    v_exp_cat text;
    v_exp_desc text;
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

    -- 4. Process Route Expenses Atomically
    IF p_expenses IS NOT NULL AND jsonb_typeof(p_expenses) = 'array' AND jsonb_array_length(p_expenses) > 0 THEN
        FOR v_exp_item IN SELECT * FROM jsonb_array_elements(p_expenses) LOOP
            v_idx := v_idx + 1;
            v_exp_amt := COALESCE((v_exp_item->>'amount')::numeric, 0);
            v_exp_cat := COALESCE(v_exp_item->>'category', 'Route Expense');
            v_exp_desc := v_exp_item->>'description';

            IF v_exp_amt > 0 THEN
                INSERT INTO public.expenses (
                    category, amount, date, description, worker_id, route_id,
                    picklist_id, visible_to_worker, idempotency_key
                ) VALUES (
                    v_exp_cat, v_exp_amt, CURRENT_DATE, v_exp_desc, p_worker_id, v_picklist.route_id,
                    p_picklist_id, true, 'exp:' || p_picklist_id::text || ':' || v_idx::text
                ) ON CONFLICT (idempotency_key) DO NOTHING;
            END IF;
        END LOOP;
    END IF;

    -- Authoritative total expenses for this picklist
    SELECT COALESCE(SUM(amount), 0) INTO v_total_expenses
    FROM public.expenses
    WHERE picklist_id = p_picklist_id;

    -- 5. Calculate Net Cash Deposit & Discrepancy
    v_net_cash_deposit := v_expected_cash - v_total_expenses;
    v_discrepancy := COALESCE(p_actual_cash, 0) - v_net_cash_deposit;

    IF v_discrepancy <> 0 THEN
        IF NOT p_discrepancy_authorized THEN
            RAISE EXCEPTION 'Cash discrepancy of ₹% requires Admin/Master PIN authorization.', v_discrepancy;
        END IF;

        IF p_discrepancy_reason IS NULL OR trim(p_discrepancy_reason) = '' THEN
            RAISE EXCEPTION 'Reason is required for authorized cash discrepancy.';
        END IF;

        v_recon_status := 'discrepancy';
    ELSE
        v_recon_status := 'reconciled';
    END IF;

    -- 6. Persist Financial Reconciliation Columns to Picklist
    UPDATE public.picklists
    SET total_cash = v_expected_cash,
        total_upi = v_expected_upi,
        total_cheque = v_expected_cheque,
        total_credit = v_expected_credit,
        total_collected = v_expected_cash + v_expected_upi,
        expected_cash = v_expected_cash,
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
        'Route ' || p_picklist_id || ' financial reconciliation: Expected Net ₹' || v_net_cash_deposit || ', Actual ₹' || p_actual_cash || ' (Discrepancy: ₹' || v_discrepancy || ')',
        'picklist',
        p_picklist_id::text
    );

    RETURN jsonb_build_object(
        'success', true,
        'picklist_id', p_picklist_id,
        'status', v_recon_status,
        'expected_cash', v_expected_cash,
        'total_expenses', v_total_expenses,
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
-- 11. RPC: get_financial_summary (Authoritative Unified Financial Reporting)
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
    v_expenses numeric(12, 2) := 0;
    v_outstanding numeric(12, 2) := 0;
    v_total_collected numeric(12, 2) := 0;
    v_net_cash numeric(12, 2) := 0;
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

    -- 6. Expenses
    SELECT COALESCE(SUM(e.amount), 0) INTO v_expenses
    FROM public.expenses e
    WHERE (p_picklist_id IS NULL OR e.picklist_id = p_picklist_id)
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
    v_net_cash := v_cash - v_expenses;

    RETURN jsonb_build_object(
        'sales', v_sales,
        'total_collected', v_total_collected,
        'cash', v_cash,
        'upi', v_upi,
        'cheque_cleared', v_cheque_cleared,
        'cheque_pending', v_cheque_pending,
        'credit_extended', v_credit_extended,
        'expenses', v_expenses,
        'net_cash', v_net_cash,
        'total_outstanding', v_outstanding
    );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 12. RLS POLICIES FOR party_financial_ledger & payments
-- ----------------------------------------------------------------------------

ALTER TABLE public.party_financial_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to party_financial_ledger" ON public.party_financial_ledger;
CREATE POLICY "Allow read access to party_financial_ledger"
    ON public.party_financial_ledger FOR SELECT
    USING (true);

-- Direct client INSERT, UPDATE, DELETE on party_financial_ledger are blocked by RLS
-- (Writes occur only via SECURITY DEFINER RPCs)

DROP POLICY IF EXISTS "Allow anon read payments" ON public.payments;
DROP POLICY IF EXISTS "Allow authenticated read payments" ON public.payments;
CREATE POLICY "Allow anon read payments" ON public.payments FOR SELECT USING (true);
CREATE POLICY "Allow authenticated read payments" ON public.payments FOR SELECT USING (true);

-- Re-confirm anonymous DELETE block
DROP POLICY IF EXISTS "anon_no_delete_payments" ON public.payments;
CREATE POLICY "anon_no_delete_payments" ON public.payments FOR DELETE USING (false);

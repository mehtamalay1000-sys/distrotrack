-- ================================================================
-- Migration 029: Admin Payment Deletion & Ledger Recalibration
-- ================================================================
-- Implements controlled, authoritative payment deletion for Admin/Master roles:
--
-- 1. Updates prevent_payment_deletion() and prevent_financial_ledger_modification()
--    triggers to allow deletion when transaction-local configuration
--    'distrotrack.allow_admin_payment_delete' is 'on'.
--
-- 2. admin_delete_payment(p_payment_id uuid, p_reason text DEFAULT 'Deleted by admin')
--    - Strictly checks public.is_current_user_admin_or_master()
--    - Validates payment existence
--    - If status was 'collected' or 'cleared' and attached to a delivery:
--        Decrements deliveries.collected_amount
--    - Sets session config 'distrotrack.allow_admin_payment_delete' = 'on'
--    - Deletes all entries in public.party_financial_ledger for this payment_id
--    - Deletes the record in public.payments
--    - Recalculates parties.outstanding_amount via public.get_party_outstanding(party_id)
--    - Logs security audit event via public.log_system_event
-- ================================================================

-- 1. Update trigger functions to respect 'distrotrack.allow_admin_payment_delete'
CREATE OR REPLACE FUNCTION public.prevent_payment_deletion()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('distrotrack.allow_admin_payment_delete', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Direct deletion of payments is prohibited. Use authorized payment reversal or Admin Delete.';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.prevent_financial_ledger_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('distrotrack.allow_admin_payment_delete', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        ELSE
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'party_financial_ledger is append-only. UPDATE and DELETE operations are prohibited.';
END;
$$ LANGUAGE plpgsql;

-- 2. Implement admin_delete_payment RPC
CREATE OR REPLACE FUNCTION public.admin_delete_payment(
    p_payment_id UUID,
    p_reason TEXT DEFAULT 'Deleted by admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_payment record;
    v_party_id uuid;
    v_delivery_id uuid;
    v_amount numeric(12, 2);
    v_status text;
    v_new_outstanding numeric(12, 2);
    v_actor_id text;
BEGIN
    -- Strict authorization check: Only Admin or Master can delete payments
    IF NOT public.is_current_user_admin_or_master() THEN
        RAISE EXCEPTION 'Unauthorized: Only Admin or Master can delete payments.' USING ERRCODE = '42501';
    END IF;

    IF p_payment_id IS NULL THEN
        RAISE EXCEPTION 'Payment ID is required.';
    END IF;

    -- Lock the payment row
    SELECT * INTO v_payment
    FROM public.payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment % not found.', p_payment_id;
    END IF;

    v_party_id := v_payment.party_id;
    v_delivery_id := v_payment.delivery_id;
    v_amount := v_payment.amount;
    v_status := v_payment.status;
    v_actor_id := COALESCE(auth.uid()::text, 'admin');

    -- Enable transaction-local bypass for ledger & payment triggers
    PERFORM set_config('distrotrack.allow_admin_payment_delete', 'on', true);

    -- 1. If payment was collected or cleared and linked to a delivery, adjust delivery collected_amount
    IF v_delivery_id IS NOT NULL AND v_status IN ('collected', 'cleared') THEN
        UPDATE public.deliveries
        SET collected_amount = GREATEST(0, COALESCE(collected_amount, 0) - v_amount),
            updated_at = now()
        WHERE id = v_delivery_id;
    END IF;

    -- 2. Delete related entries in party_financial_ledger
    DELETE FROM public.party_financial_ledger
    WHERE payment_id = p_payment_id;

    -- 3. Delete the payment record itself
    DELETE FROM public.payments
    WHERE id = p_payment_id;

    -- 4. Recalculate customer's cached outstanding_amount
    v_new_outstanding := public.get_party_outstanding(v_party_id);
    UPDATE public.parties
    SET outstanding_amount = v_new_outstanding,
        updated_at = now()
    WHERE id = v_party_id;

    -- 5. Audit log
    BEGIN
        PERFORM public.log_system_event(
            v_actor_id,
            'Admin',
            'payment',
            'payment_deleted',
            'warning',
            'Payment ' || p_payment_id || ' (₹' || v_amount || ', ' || v_status || ') permanently deleted: ' || COALESCE(p_reason, 'No reason given'),
            'payment',
            p_payment_id::text
        );
    EXCEPTION WHEN OTHERS THEN
        -- Non-blocking audit log
    END;

    RETURN jsonb_build_object(
        'success', true,
        'payment_id', p_payment_id,
        'amount', v_amount,
        'party_id', v_party_id,
        'new_outstanding', v_new_outstanding,
        'message', 'Payment permanently deleted and customer balance recalibrated.'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_payment(UUID, TEXT) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_delete_payment(UUID, TEXT) FROM anon, PUBLIC;

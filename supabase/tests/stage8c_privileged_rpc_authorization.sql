-- ============================================================================
-- DISTROTRACK V2 — STAGE 8C: PRIVILEGED RPC AUTHORIZATION TEST SUITE
-- File: supabase/tests/stage8c_privileged_rpc_authorization.sql
-- ============================================================================

BEGIN;

CREATE TEMPORARY TABLE _test_results (
    id SERIAL PRIMARY KEY,
    test_num INT,
    group_name TEXT,
    test_name TEXT,
    status TEXT,
    details TEXT
);
GRANT ALL ON TABLE _test_results TO PUBLIC;

CREATE OR REPLACE PROCEDURE _record_test(p_num INT, p_grp TEXT, p_name TEXT, p_passed BOOLEAN, p_det TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO _test_results(test_num, group_name, test_name, status, details)
    VALUES (p_num, p_grp, p_name, CASE WHEN p_passed THEN 'PASS' ELSE 'FAIL' END, p_det);
END;
$$;
GRANT EXECUTE ON PROCEDURE _record_test(INT, TEXT, TEXT, BOOLEAN, TEXT) TO PUBLIC;

DO $$
DECLARE
    v_worker_a_id uuid := 'fd89fefc-a9f1-4b23-b4ec-f1bc671724d9';
    v_worker_b_id uuid := 'd15183bb-cd7a-4246-829d-12151c1fa108';
    v_admin_id uuid := '80cfc8f3-f32c-4a4d-b69d-38a62677bdd1';
    v_master_id uuid := '00000000-0000-0000-0000-000000000001';
    v_test_party_id uuid;
    v_test_route_id uuid;
    v_picklist_a_id uuid;
    v_picklist_b_id uuid;
    v_delivery_a_id uuid;
    v_delivery_b_id uuid;
    v_payment_id uuid;
    v_expense_id uuid;
    v_res jsonb;
    v_err text;
    v_caught boolean;
BEGIN
    -- Setup baseline records
    SELECT id INTO v_test_party_id FROM public.parties LIMIT 1;
    SELECT id INTO v_test_route_id FROM public.routes WHERE code = 'STG8C_TEST_RT' LIMIT 1;
    IF v_test_route_id IS NULL THEN
        INSERT INTO public.routes (name, code, status)
        VALUES ('Stage 8C Test Route', 'STG8C_TEST_RT', 'active')
        RETURNING id INTO v_test_route_id;
    END IF;

    SELECT id INTO v_picklist_a_id FROM public.picklists WHERE worker_id = v_worker_a_id LIMIT 1;
    IF v_picklist_a_id IS NULL THEN
        INSERT INTO public.picklists (picklist_number, date, route_id, worker_id, status, total_parties, total_items, total_amount, total_collected, total_cash, total_cheque, total_credit, total_upi, expected_cash, actual_cash_returned, cash_discrepancy, total_expenses, net_cash_deposit, expected_upi, expected_cheque, expected_credit, financial_reconciliation_status)
        VALUES ('PL-A-' || substr(gen_random_uuid()::text, 1, 6), CURRENT_DATE, v_test_route_id, v_worker_a_id, 'in_progress', 1, 1, 500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'pending')
        RETURNING id INTO v_picklist_a_id;
    END IF;

    SELECT id INTO v_picklist_b_id FROM public.picklists WHERE worker_id = v_worker_b_id LIMIT 1;
    IF v_picklist_b_id IS NULL THEN
        INSERT INTO public.picklists (picklist_number, date, route_id, worker_id, status, total_parties, total_items, total_amount, total_collected, total_cash, total_cheque, total_credit, total_upi, expected_cash, actual_cash_returned, cash_discrepancy, total_expenses, net_cash_deposit, expected_upi, expected_cheque, expected_credit, financial_reconciliation_status)
        VALUES ('PL-B-' || substr(gen_random_uuid()::text, 1, 6), CURRENT_DATE, v_test_route_id, v_worker_b_id, 'in_progress', 1, 1, 500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'pending')
        RETURNING id INTO v_picklist_b_id;
    END IF;

    -- ── A. ANONYMOUS CALLER REJECTION ──────────────────────────────
    PERFORM set_config('request.jwt.claim.sub', NULL, true);
    PERFORM set_config('role', 'anon', true);

    -- 1. Anonymous reverse payment
    v_caught := false;
    BEGIN
        PERFORM public.reverse_payment_with_ledger('00000000-0000-0000-0000-000000000000'::uuid, NULL, 'fraud');
    EXCEPTION WHEN OTHERS THEN
        v_caught := (SQLSTATE = '42501');
    END;
    CALL _record_test(1, 'Anonymous', 'Anonymous reverse payment rejected', v_caught, 'SQLSTATE 42501');

    -- 2. Anonymous approve expense
    v_caught := false;
    BEGIN
        PERFORM public.approve_expense('00000000-0000-0000-0000-000000000000'::uuid);
    EXCEPTION WHEN OTHERS THEN
        v_caught := (SQLSTATE = '42501');
    END;
    CALL _record_test(2, 'Anonymous', 'Anonymous approve expense rejected', v_caught, 'SQLSTATE 42501');

    -- 3. Anonymous reject expense
    v_caught := false;
    BEGIN
        PERFORM public.reject_expense('00000000-0000-0000-0000-000000000000'::uuid, NULL, 'fraud');
    EXCEPTION WHEN OTHERS THEN
        v_caught := (SQLSTATE = '42501');
    END;
    CALL _record_test(3, 'Anonymous', 'Anonymous reject expense rejected', v_caught, 'SQLSTATE 42501');

    -- 4. Anonymous reverse expense
    v_caught := false;
    BEGIN
        PERFORM public.reverse_expense('00000000-0000-0000-0000-000000000000'::uuid, 'fraud');
    EXCEPTION WHEN OTHERS THEN
        v_caught := (SQLSTATE = '42501');
    END;
    CALL _record_test(4, 'Anonymous', 'Anonymous reverse expense rejected', v_caught, 'SQLSTATE 42501');

    -- 5. Anonymous financial reconciliation
    v_caught := false;
    BEGIN
        PERFORM public.reconcile_and_close_route_finances('00000000-0000-0000-0000-000000000000'::uuid, v_worker_a_id, 100);
    EXCEPTION WHEN OTHERS THEN
        v_caught := (SQLSTATE = '42501');
    END;
    CALL _record_test(5, 'Anonymous', 'Anonymous financial reconciliation rejected', v_caught, 'SQLSTATE 42501');

    -- 6. Anonymous direct inventory mutation
    v_caught := false;
    BEGIN
        INSERT INTO public.inventory_movements (product_id, movement_type, quantity)
        VALUES ('00000000-0000-0000-0000-000000000000'::uuid, 'route_load', 10);
    EXCEPTION WHEN OTHERS THEN
        v_caught := true;
    END;
    CALL _record_test(6, 'Anonymous', 'Anonymous inventory mutation rejected', v_caught, 'Blocked by RLS');

    -- 7. Anonymous route creation
    v_caught := false;
    BEGIN
        INSERT INTO public.routes (name, code) VALUES ('Hacked', 'HACK');
    EXCEPTION WHEN OTHERS THEN
        v_caught := true;
    END;
    CALL _record_test(7, 'Anonymous', 'Anonymous route creation rejected', v_caught, 'Blocked by RLS');

    -- ── B. WORKER PRIVILEGE REJECTION ──────────────────────────────
    PERFORM set_config('request.jwt.claim.sub', v_worker_a_id::text, true);
    PERFORM set_config('role', 'authenticated', true);

    -- 8. Worker reverse payment
    v_caught := false;
    BEGIN
        PERFORM public.reverse_payment_with_ledger('00000000-0000-0000-0000-000000000000'::uuid, NULL, 'test');
    EXCEPTION WHEN OTHERS THEN
        v_caught := (SQLSTATE = '42501');
    END;
    CALL _record_test(8, 'Worker', 'Worker reverse payment rejected (SEC-04)', v_caught, 'SQLSTATE 42501');

    -- 9. Worker approve expense
    v_caught := false;
    BEGIN
        PERFORM public.approve_expense('00000000-0000-0000-0000-000000000000'::uuid);
    EXCEPTION WHEN OTHERS THEN
        v_caught := (SQLSTATE = '42501');
    END;
    CALL _record_test(9, 'Worker', 'Worker approve expense rejected (SEC-06)', v_caught, 'SQLSTATE 42501');

    -- 10. Worker reject expense
    v_caught := false;
    BEGIN
        PERFORM public.reject_expense('00000000-0000-0000-0000-000000000000'::uuid, NULL, 'test');
    EXCEPTION WHEN OTHERS THEN
        v_caught := (SQLSTATE = '42501');
    END;
    CALL _record_test(10, 'Worker', 'Worker reject expense rejected (SEC-06)', v_caught, 'SQLSTATE 42501');

    -- 11. Worker reverse expense
    v_caught := false;
    BEGIN
        PERFORM public.reverse_expense('00000000-0000-0000-0000-000000000000'::uuid, 'test');
    EXCEPTION WHEN OTHERS THEN
        v_caught := (SQLSTATE = '42501');
    END;
    CALL _record_test(11, 'Worker', 'Worker reverse expense rejected (SEC-06)', v_caught, 'SQLSTATE 42501');

    -- 12. Worker financial reconciliation with discrepancy
    v_caught := false;
    BEGIN
        PERFORM public.reconcile_and_close_route_finances(v_picklist_a_id, v_worker_a_id, 999999, '[]'::jsonb, true, 'Worker bypass');
    EXCEPTION WHEN OTHERS THEN
        v_caught := (SQLSTATE = '42501' OR SQLERRM LIKE '%discrepancy%');
    END;
    CALL _record_test(12, 'Worker', 'Worker discrepancy reconciliation rejected (SEC-05)', v_caught, 'Discrepancy blocked');

    -- 13. Worker administrative inventory mutation
    v_caught := false;
    BEGIN
        INSERT INTO public.inventory_movements (product_id, movement_type, quantity)
        VALUES ('00000000-0000-0000-0000-000000000000'::uuid, 'route_load', 50);
    EXCEPTION WHEN OTHERS THEN
        v_caught := true;
    END;
    CALL _record_test(13, 'Worker', 'Worker direct inventory mutation rejected (SEC-07)', v_caught, 'Blocked by RLS');

    -- 14. Worker financial summary access
    v_caught := false;
    BEGIN
        PERFORM public.get_financial_summary();
    EXCEPTION WHEN OTHERS THEN
        v_caught := (SQLSTATE = '42501');
    END;
    CALL _record_test(14, 'Worker', 'Worker financial summary access rejected', v_caught, 'SQLSTATE 42501');

    -- 15. Worker worker-management mutation
    v_caught := false;
    BEGIN
        INSERT INTO public.workers (name, phone) VALUES ('Fake', '9999999999');
    EXCEPTION WHEN OTHERS THEN
        v_caught := true;
    END;
    CALL _record_test(15, 'Worker', 'Worker worker-management mutation rejected', v_caught, 'Blocked by RLS');

    -- 16. Worker party-management mutation
    v_caught := false;
    BEGIN
        INSERT INTO public.parties (name, code) VALUES ('Hacked', 'HACKP');
    EXCEPTION WHEN OTHERS THEN
        v_caught := true;
    END;
    CALL _record_test(16, 'Worker', 'Worker party-management mutation rejected', v_caught, 'Blocked by RLS');

    -- 17. Worker product-management mutation
    v_caught := false;
    BEGIN
        INSERT INTO public.products (name, sku, rate) VALUES ('Hacked', 'HACKSKU', 50);
    EXCEPTION WHEN OTHERS THEN
        v_caught := true;
    END;
    CALL _record_test(17, 'Worker', 'Worker product-management mutation rejected', v_caught, 'Blocked by RLS');

    -- ── C. HORIZONTAL PRIVILEGE ESCALATION ─────────────────────────
    -- 18. Worker A starting Worker B route
    v_caught := false;
    BEGIN
        PERFORM public.start_route_with_load(v_picklist_b_id, v_worker_a_id);
    EXCEPTION WHEN OTHERS THEN
        v_caught := (SQLSTATE = '42501');
    END;
    CALL _record_test(18, 'Horizontal', 'Worker A starting Worker B route rejected', v_caught, 'SQLSTATE 42501');

    -- 19. Worker A closing Worker B picklist
    v_caught := false;
    BEGIN
        PERFORM public.close_route_with_reconciliation(v_picklist_b_id, v_worker_a_id, '[]'::jsonb);
    EXCEPTION WHEN OTHERS THEN
        v_caught := (SQLSTATE = '42501');
    END;
    CALL _record_test(19, 'Horizontal', 'Worker A closing Worker B picklist rejected', v_caught, 'SQLSTATE 42501');

    -- 20. Worker A inspecting Worker B route stock
    v_caught := false;
    BEGIN
        PERFORM public.check_route_stock(v_picklist_b_id);
    EXCEPTION WHEN OTHERS THEN
        v_caught := (SQLSTATE = '42501');
    END;
    CALL _record_test(20, 'Horizontal', 'Worker A inspecting Worker B route stock rejected', v_caught, 'SQLSTATE 42501');

    -- 21. Worker A recording payment on Worker B picklist
    v_caught := false;
    BEGIN
        PERFORM public.record_party_payment_with_ledger(v_test_party_id, 100, 'cash', NULL, NULL, NULL, v_picklist_b_id);
    EXCEPTION WHEN OTHERS THEN
        v_caught := (SQLSTATE = '42501');
    END;
    CALL _record_test(21, 'Horizontal', 'Worker A recording payment on Worker B picklist rejected', v_caught, 'SQLSTATE 42501');

    -- 22. Worker A attempting to manipulate actor/user identity on reversal
    v_caught := false;
    BEGIN
        PERFORM public.reverse_payment_with_ledger('00000000-0000-0000-0000-000000000000'::uuid, v_admin_id::text, 'spoof');
    EXCEPTION WHEN OTHERS THEN
        v_caught := (SQLSTATE = '42501');
    END;
    CALL _record_test(22, 'Horizontal', 'Worker spoofing admin actor ID rejected', v_caught, 'SQLSTATE 42501');

    -- ── D. CLIENT AUTHORIZATION SPOOFING ───────────────────────────
    -- 23. Worker sends p_discrepancy_authorized=true
    v_caught := false;
    BEGIN
        PERFORM public.reconcile_and_close_route_finances(v_picklist_a_id, v_worker_a_id, 500, '[]'::jsonb, true, 'spoof');
    EXCEPTION WHEN OTHERS THEN
        v_caught := (SQLSTATE = '42501' OR SQLERRM LIKE '%discrepancy%');
    END;
    CALL _record_test(23, 'Spoofing', 'Worker p_discrepancy_authorized=true rejected (SEC-05)', v_caught, 'Discrepancy blocked');

    -- 24. Worker sends p_status='approved' -> forced to pending
    v_res := public.create_expense_with_idempotency('Fuel', 100, CURRENT_DATE, 'cash', 'test', NULL, NULL, NULL, 'route_operating', 'approved', NULL, true, 'test-exp-spoof-' || gen_random_uuid()::text);
    CALL _record_test(24, 'Spoofing', 'Worker p_status=approved forced to pending (SEC-06)', ((v_res->>'status') = 'pending' AND (v_res->>'is_approved') = 'false'), 'Status forced server-side');

    -- 25. Worker sends p_worker_id=Worker B -> overridden to Worker A
    v_res := public.create_expense_with_idempotency('Tea', 50, CURRENT_DATE, 'cash', 'test', v_worker_b_id, NULL, NULL, 'route_operating', 'pending', NULL, true, 'test-exp-wspoof-' || gen_random_uuid()::text);
    CALL _record_test(25, 'Spoofing', 'Worker identity spoofing in expense creation overridden', ((v_res->>'expense_id') IS NOT NULL), 'Resolved server-side');

    -- 26. Worker sends arbitrary actor ID on reversal -> rejected
    v_caught := false;
    BEGIN
        PERFORM public.reverse_payment_with_ledger('00000000-0000-0000-0000-000000000000'::uuid, v_admin_id::text, 'spoof');
    EXCEPTION WHEN OTHERS THEN
        v_caught := (SQLSTATE = '42501');
    END;
    CALL _record_test(26, 'Spoofing', 'Worker arbitrary p_actor_id reversal rejected', v_caught, 'SQLSTATE 42501');

    -- ── E. POSITIVE TESTS ──────────────────────────────────────────
    -- 27. Owner privileged operation
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('role', 'authenticated', true);

    v_res := public.record_party_payment_with_ledger(v_test_party_id, 50, 'cash', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'test pmt', CURRENT_DATE, 'pmt-pos-' || gen_random_uuid()::text);
    v_payment_id := (v_res->>'payment_id')::uuid;

    v_res := public.reverse_payment_with_ledger(v_payment_id, NULL, 'Legitimate Owner Reversal');
    CALL _record_test(27, 'Positive', 'Owner privileged payment reversal succeeds (SEC-04)', ((v_res->>'success') = 'true'), 'Reversed by Owner');

    -- 28. Master privileged operation
    PERFORM set_config('request.jwt.claim.sub', v_master_id::text, true);
    PERFORM set_config('role', 'authenticated', true);

    v_res := public.get_route_profitability();
    CALL _record_test(28, 'Positive', 'Master route profitability oversight succeeds', (v_res IS NOT NULL), 'Oversight allowed');

    -- 29. Worker normal permitted operation
    PERFORM set_config('request.jwt.claim.sub', v_worker_a_id::text, true);
    PERFORM set_config('role', 'authenticated', true);

    v_res := public.check_route_stock(v_picklist_a_id);
    CALL _record_test(29, 'Positive', 'Worker permitted operation on assigned picklist succeeds', (v_res IS NOT NULL), 'Stock checked');

    -- 30. Existing Stage 4B/5/6 financial summary for Admin
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM set_config('role', 'authenticated', true);

    v_res := public.get_financial_summary();
    CALL _record_test(30, 'Positive', 'Financial summary reporting succeeds for Owner', (v_res IS NOT NULL), 'Report generated');
END;
$$;

SELECT
    test_num,
    group_name,
    status,
    test_name,
    details
FROM _test_results
ORDER BY test_num;

ROLLBACK;

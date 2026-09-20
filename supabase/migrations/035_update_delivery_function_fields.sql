-- ================================================================
-- Migration 035: Update complete_delivery_with_ledger with correct route_id and reference
-- ================================================================

CREATE OR REPLACE FUNCTION public.complete_delivery_with_ledger(
    p_delivery_id uuid,
    p_worker_id uuid,
    p_items jsonb,
    p_payment_mode text DEFAULT 'cash',
    p_payment_amount numeric DEFAULT 0,
    p_reference_number text DEFAULT NULL,
    p_cheque_number text DEFAULT NULL,
    p_cheque_date date DEFAULT NULL,
    p_cheque_bank text DEFAULT NULL,
    p_notes text DEFAULT NULL,
    p_payments jsonb DEFAULT NULL
)
RETURNS jsonb
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
    v_item_rate numeric;
    v_veh_stock numeric;
    v_item_count integer;
    v_input_count integer;
    v_final_delivered_amount numeric := 0;
    v_all_delivered boolean := true;
    v_all_zero boolean := true;
    v_final_status text;
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

    -- 1. Lock delivery record FOR UPDATE
    SELECT * INTO v_delivery
    FROM public.deliveries
    WHERE id = p_delivery_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery % not found', p_delivery_id;
    END IF;

    -- 2. Lock picklist record FOR UPDATE
    SELECT * INTO v_picklist
    FROM public.picklists
    WHERE id = v_delivery.picklist_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Picklist % for delivery % not found', v_delivery.picklist_id, p_delivery_id;
    END IF;

    -- 3. Horizontal Scope Check: Worker can only complete assigned delivery
    v_current_worker := public.get_current_worker_id();
    IF public.is_current_user_worker() THEN
        IF v_delivery.worker_id IS DISTINCT FROM v_current_worker 
           AND v_picklist.worker_id IS DISTINCT FROM v_current_worker THEN
            RAISE EXCEPTION 'Unauthorized: Authenticated worker % is not assigned to delivery %', v_current_worker, p_delivery_id USING ERRCODE = '42501';
        END IF;
    END IF;

    -- 4. Idempotency guard: If delivery already finalized, return current state safely
    IF v_delivery.status IN ('delivered', 'partial', 'refused') THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_completed', true,
            'status', v_delivery.status,
            'delivered_amount', v_delivery.delivered_amount,
            'message', 'Delivery was already finalized'
        );
    END IF;

    -- 5. Item Count Validation: Verify submitted items match delivery item count
    SELECT count(*) INTO v_item_count FROM public.delivery_items WHERE delivery_id = p_delivery_id;
    v_input_count := jsonb_array_length(p_items);

    IF v_item_count <> v_input_count THEN
        RAISE EXCEPTION 'Item count mismatch: expected %, received %', v_item_count, v_input_count;
    END IF;

    -- 6. Process and validate each submitted item
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
        v_item_rate := COALESCE(v_item.rate, 0);

        -- Defensive check: SKU and product_id must be resolved before recording movements
        IF (v_phys_del > 0 OR v_phys_dam > 0) THEN
            IF v_item.sku IS NULL OR trim(v_item.sku) = '' THEN
                RAISE EXCEPTION 'Product identity unresolved: SKU is null or empty for item % (%). Admin review required.',
                    COALESCE(v_item.product_name, 'Unknown'), v_item_id;
            END IF;
            IF v_item.product_id IS NULL THEN
                RAISE EXCEPTION 'Product identity unresolved: product_id is null for item % (SKU: %). Admin review required.',
                    COALESCE(v_item.product_name, 'Unknown'), v_item.sku;
            END IF;

            -- 7. VEHICLE STOCK SHORTAGE: Non-blocking operational exception
            v_veh_stock := public.get_vehicle_stock(v_delivery.picklist_id, v_item.product_id);
            IF v_veh_stock < (v_phys_del + v_phys_dam) THEN
                -- Stock shortage is an operational exception, NOT a delivery blocker.
                INSERT INTO public.route_stock_exceptions (
                    picklist_id,
                    route_id,
                    worker_id,
                    product_id,
                    sku,
                    product_name,
                    required_quantity,
                    recorded_warehouse_stock,
                    shortage_quantity,
                    status,
                    notes
                ) VALUES (
                    v_delivery.picklist_id,
                    v_picklist.route_id,
                    v_delivery.worker_id,
                    v_item.product_id,
                    v_item.sku,
                    COALESCE(v_item.product_name, v_item.sku),
                    (v_phys_del + v_phys_dam),
                    v_veh_stock,
                    (v_phys_del + v_phys_dam) - v_veh_stock,
                    'open',
                    'Operational exception: Insufficient vehicle stock during delivery completion. Delivery authorized to proceed.'
                );
            END IF;
        END IF;

        -- 8. Insert Authoritative Inventory Movements
        IF v_item.product_id IS NOT NULL AND v_phys_del > 0 THEN
            INSERT INTO public.inventory_movements (
                product_id,
                sku,
                movement_type,
                quantity,
                direction,
                from_location,
                to_location,
                picklist_id,
                route_id,
                delivery_id,
                party_id,
                worker_id,
                reference_number,
                notes,
                idempotency_key
            ) VALUES (
                v_item.product_id,
                v_item.sku,
                'delivery_fulfilled',
                v_phys_del,
                'out',
                'vehicle',
                'customer',
                v_delivery.picklist_id,
                v_picklist.route_id,
                p_delivery_id,
                v_delivery.party_id,
                v_delivery.worker_id,
                'DEL:' || p_delivery_id::text,
                'Delivered to customer: ' || v_item.sku,
                'del-mov:' || p_delivery_id::text || ':' || v_item_id::text || ':del'
            );
        END IF;

        IF v_item.product_id IS NOT NULL AND v_phys_dam > 0 THEN
            INSERT INTO public.inventory_movements (
                product_id,
                sku,
                movement_type,
                quantity,
                direction,
                from_location,
                to_location,
                picklist_id,
                route_id,
                delivery_id,
                party_id,
                worker_id,
                reference_number,
                notes,
                idempotency_key
            ) VALUES (
                v_item.product_id,
                v_item.sku,
                'damaged_transit',
                v_phys_dam,
                'out',
                'vehicle',
                'damaged_quarantine',
                v_delivery.picklist_id,
                v_picklist.route_id,
                p_delivery_id,
                v_delivery.party_id,
                v_delivery.worker_id,
                'DEL:' || p_delivery_id::text,
                'Damaged in transit: ' || v_item.sku,
                'del-mov:' || p_delivery_id::text || ':' || v_item_id::text || ':dam'
            );
        END IF;

        -- 9. Update Delivery Item with actual delivered quantities and rate
        UPDATE public.delivery_items
        SET delivered_qty = v_del_qty,
            delivered_free_qty = v_del_free,
            returned_qty = v_ret_qty,
            returned_free_qty = v_ret_free,
            damaged_qty = v_dam_qty,
            damaged_free_qty = v_dam_free,
            delivered_amount = v_del_qty * v_item_rate,
            returned_amount = (v_ret_qty + v_dam_qty) * v_item_rate,
            status = CASE
                WHEN v_del_qty = v_item.ordered_qty THEN 'delivered'
                WHEN v_del_qty > 0 THEN 'partial'
                ELSE 'returned'
            END,
            updated_at = now()
        WHERE id = v_item_id;

        v_final_delivered_amount := v_final_delivered_amount + (v_del_qty * v_item_rate);

        IF v_del_qty <> v_item.ordered_qty THEN
            v_all_delivered := false;
        END IF;
        IF v_del_qty > 0 THEN
            v_all_zero := false;
        END IF;
    END LOOP;

    -- 10. Determine overall delivery status
    IF v_all_delivered THEN
        v_final_status := 'delivered';
    ELSIF v_all_zero THEN
        v_final_status := 'refused';
    ELSE
        v_final_status := 'partial';
    END IF;

    -- 11. Record Payments & Financial Ledger
    IF p_payments IS NOT NULL AND jsonb_typeof(p_payments) = 'array' AND jsonb_array_length(p_payments) > 0 THEN
        FOR v_pay_item IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
            v_pay_mode := COALESCE(v_pay_item->>'mode', v_pay_item->>'payment_mode', 'cash');
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

    -- 12. Finalize Delivery record
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

    -- 13. Update Picklist aggregate metrics
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

    -- 14. Audit log system event
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

    -- 15. Return authoritative JSON response
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

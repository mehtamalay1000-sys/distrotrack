-- ==============================================================================
-- Migration 040: Fix get_pending_credit_deliveries RPC and Worker Access
--
-- 1. Fixes PostgreSQL syntax error: EXTRACT(DAY FROM integer) -> date difference
--    is already an integer (number of days).
-- 2. Extends authorization so Workers can fetch pending credit deliveries for
--    their assigned routes/worker_id as payment collection reminders.
-- 3. Grants execute access to authenticated users and service_role.
-- ==============================================================================

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
    v_auth_worker uuid;
BEGIN
    -- Role check: Admin/Master can see all; Worker can only query their own worker_id or assigned route
    IF NOT public.is_current_user_admin_or_master() THEN
        IF public.is_current_user_worker() THEN
            v_auth_worker := public.get_current_worker_id();
            IF p_worker_id IS NOT NULL AND p_worker_id <> v_auth_worker THEN
                RAISE EXCEPTION 'Unauthorized: Workers may only access their own pending credit receivables.' USING ERRCODE = '42501';
            END IF;
            p_worker_id := v_auth_worker;
        ELSE
            -- Allow if authenticated user has valid session or service role
            IF auth.uid() IS NULL THEN
                RAISE EXCEPTION 'Unauthorized: Authentication required to access pending credit receivables.' USING ERRCODE = '42501';
            END IF;
        END IF;
    END IF;

    SELECT jsonb_agg(row_to_json(t)) INTO v_result
    FROM (
        SELECT
            d.id AS delivery_id,
            COALESCE(d.delivery_date, d.delivered_at::date, pl.date, CURRENT_DATE) AS delivery_date,
            d.status AS delivery_status,
            COALESCE(d.delivered_amount, 0) AS sale_amount,
            COALESCE(d.collected_amount, 0) AS collected_amount,
            GREATEST(0, COALESCE(d.delivered_amount, 0) - COALESCE(d.collected_amount, 0)) AS pending_amount,
            d.payment_mode,
            d.picklist_id,
            d.worker_id,
            -- Party info
            pt.id AS party_id,
            pt.name AS party_name,
            pt.code AS party_code,
            pt.phone AS party_phone,
            pt.address AS party_address,
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
            -- Age in days (Postgres date - date yields integer days)
            GREATEST(0, (CURRENT_DATE - COALESCE(d.delivery_date, d.delivered_at::date, pl.date, CURRENT_DATE)))::integer AS days_outstanding
        FROM public.deliveries d
        LEFT JOIN public.parties pt ON pt.id = d.party_id
        LEFT JOIN public.invoices inv ON inv.id = d.invoice_id
        LEFT JOIN public.picklists pl ON pl.id = d.picklist_id
        LEFT JOIN public.routes r ON r.id = pl.route_id
        LEFT JOIN public.workers w ON w.id = d.worker_id
        WHERE d.status IN ('delivered', 'partial')
          AND COALESCE(d.delivered_amount, 0) > COALESCE(d.collected_amount, 0)
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

GRANT EXECUTE ON FUNCTION public.get_pending_credit_deliveries(integer, integer, uuid, uuid, date, date)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.get_pending_credit_deliveries IS
    'Returns pending credit receivables with party, route, and invoice metadata for Admin and Worker dashboards.';

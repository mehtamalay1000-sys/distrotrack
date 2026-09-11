-- ================================================================
-- Migration 016: Stage 8D — Remaining Security Hardening
-- ================================================================
-- Closes all remaining vulnerabilities identified in Stage 8 Security Audit:
--   1. SEC-08: PIN brute-force rate limiting & lockout mechanism
--   2. SEC-09: Audit log verification, spoofing prevention & read isolation
--   3. SEC-10: Strict horizontal data isolation on financial ledgers & payments
--   4. SEC-07: Explicit lockdown on inventory_movements direct client INSERT
--   5. SEC-11: Global safe search_path hardening across all functions
--   6. SEC-12: Directory enumeration protection on pin_users and workers
-- ================================================================

-- ── 1. SEC-08: PIN Brute-Force Rate Limiting & Lockout ───────────

CREATE TABLE IF NOT EXISTS public.pin_attempt_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier   text NOT NULL, -- Actor UUID, phone, or 'master'
  actor_type   text NOT NULL, -- 'admin', 'worker', 'master'
  success      boolean NOT NULL DEFAULT false,
  attempt_time timestamptz NOT NULL DEFAULT now(),
  ip_address   text,
  user_agent   text
);

CREATE INDEX IF NOT EXISTS idx_pin_attempt_logs_identifier_time 
  ON public.pin_attempt_logs(identifier, attempt_time DESC);

ALTER TABLE public.pin_attempt_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pin_attempt_logs_deny_all" ON public.pin_attempt_logs;
CREATE POLICY "pin_attempt_logs_deny_all" ON public.pin_attempt_logs
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

GRANT ALL ON public.pin_attempt_logs TO service_role;
GRANT ALL ON public.pin_attempt_logs TO postgres;

-- Helper to check rate limit: 5 failed attempts in 15 minutes triggers lockout
CREATE OR REPLACE FUNCTION public.check_pin_rate_limit(
  p_identifier   text,
  p_max_attempts int DEFAULT 5,
  p_window       interval DEFAULT interval '15 minutes'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_failed_count int;
  v_last_attempt timestamptz;
BEGIN
  SELECT COUNT(*), MAX(attempt_time)
    INTO v_failed_count, v_last_attempt
    FROM public.pin_attempt_logs
   WHERE identifier = p_identifier
     AND success = false
     AND attempt_time > (now() - p_window);

  IF v_failed_count >= p_max_attempts THEN
    RAISE EXCEPTION 'Rate limit exceeded: Account temporarily locked due to % failed attempts. Please try again after 15 minutes.', v_failed_count
      USING ERRCODE = 'P0001';
  END IF;

  RETURN true;
END;
$$;

-- Helper to record an attempt
CREATE OR REPLACE FUNCTION public.record_pin_attempt(
  p_identifier text,
  p_actor_type text,
  p_success    boolean,
  p_ip         text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.pin_attempt_logs (identifier, actor_type, success, attempt_time, ip_address)
  VALUES (p_identifier, p_actor_type, p_success, now(), p_ip);

  -- If successful, clear out recent failed attempts for this identifier
  IF p_success THEN
    DELETE FROM public.pin_attempt_logs
     WHERE identifier = p_identifier
       AND success = false;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL; -- Rate-limit logging failures must not break caller flow
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_pin_rate_limit(text, int, interval) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_pin_attempt(text, text, boolean, text) TO authenticated, anon, service_role;

-- Update check_master_pin with rate limiting
CREATE OR REPLACE FUNCTION public.check_master_pin(p_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_hash text;
  v_match boolean := false;
BEGIN
  -- 1. Check rate limit
  PERFORM public.check_pin_rate_limit('master', 5, interval '15 minutes');

  -- 2. Fetch master hash
  SELECT master_pin INTO v_hash FROM master_config WHERE id = 1 LIMIT 1;
  IF NOT FOUND OR v_hash IS NULL THEN
    PERFORM public.record_pin_attempt('master', 'master', false);
    RETURN false;
  END IF;

  -- 3. Compare hash
  BEGIN
    v_match := (extensions.crypt(p_pin, v_hash) = v_hash);
  EXCEPTION WHEN OTHERS THEN
    v_match := (crypt(p_pin, v_hash) = v_hash);
  END;

  -- 4. Record attempt
  PERFORM public.record_pin_attempt('master', 'master', COALESCE(v_match, false));

  RETURN COALESCE(v_match, false);
END;
$$;

-- Update verify_admin_pin with rate limiting
CREATE OR REPLACE FUNCTION public.verify_admin_pin(
  p_user_id uuid,
  p_pin     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_stored_pin  text;
  v_name        text;
  v_status      text;
  v_master_hash text;
  v_is_master   boolean := false;
  v_match       boolean := false;
  v_identifier  text := 'admin:' || p_user_id::text;
BEGIN
  -- 1. Check rate limit
  PERFORM public.check_pin_rate_limit(v_identifier, 5, interval '15 minutes');

  -- 2. Fetch admin record
  SELECT pin, name, status
    INTO v_stored_pin, v_name, v_status
    FROM pin_users
   WHERE id = p_user_id
   LIMIT 1;

  IF NOT FOUND THEN
    PERFORM public.record_pin_attempt(v_identifier, 'admin', false);
    RETURN jsonb_build_object('role', null, 'error', 'User not found.');
  END IF;

  IF v_status <> 'active' THEN
    PERFORM public.record_pin_attempt(v_identifier, 'admin', false);
    RETURN jsonb_build_object('role', null, 'error', 'Account is inactive.');
  END IF;

  -- 3. Check normal admin PIN
  IF TRIM(v_stored_pin) = TRIM(p_pin) THEN
    PERFORM public.record_pin_attempt(v_identifier, 'admin', true);
    RETURN jsonb_build_object('role', 'owner', 'error', null, 'name', v_name);
  END IF;

  -- 4. Check master PIN override
  SELECT master_pin INTO v_master_hash FROM master_config WHERE id = 1 LIMIT 1;
  IF FOUND AND v_master_hash IS NOT NULL THEN
    BEGIN
      v_is_master := (extensions.crypt(p_pin, v_master_hash) = v_master_hash);
    EXCEPTION WHEN OTHERS THEN
      v_is_master := (crypt(p_pin, v_master_hash) = v_master_hash);
    END;

    IF v_is_master = true THEN
      PERFORM public.record_pin_attempt(v_identifier, 'admin', true);
      RETURN jsonb_build_object('role', 'master', 'error', null, 'name', v_name);
    END IF;
  END IF;

  -- 5. Neither matched
  PERFORM public.record_pin_attempt(v_identifier, 'admin', false);
  RETURN jsonb_build_object('role', null, 'error', 'Incorrect PIN. Please try again.');
END;
$$;


-- ── 2. SEC-09: Audit Log Identity Verification & Ingestion Hardening ─

-- Add system_authoritative indicator to audit log
ALTER TABLE public.master_audit_log 
  ADD COLUMN IF NOT EXISTS system_authoritative boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.log_system_event(
  p_user_id     text,
  p_user_name   text,
  p_role        text,
  p_module      text,
  p_action      text,
  p_status      text DEFAULT 'success',
  p_detail      text DEFAULT null,
  p_entity_type text DEFAULT null,
  p_entity_id   text DEFAULT null
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_verified_id   text := p_user_id;
  v_verified_name text := p_user_name;
  v_verified_role text := p_role;
  v_is_auth       boolean := false;
  v_profile       record;
BEGIN
  -- If caller is authenticated through Supabase Auth, verify and bind identity from public.profiles
  IF auth.uid() IS NOT NULL THEN
    SELECT id, full_name, role INTO v_profile
      FROM public.profiles
     WHERE id = auth.uid()
     LIMIT 1;

    IF FOUND THEN
      v_verified_id   := v_profile.id::text;
      v_verified_name := COALESCE(v_profile.full_name, p_user_name);
      v_verified_role := COALESCE(v_profile.role, p_role);
      v_is_auth       := true;
    END IF;
  ELSIF current_user = 'service_role' OR current_user = 'postgres' THEN
    v_is_auth := true;
  END IF;

  INSERT INTO public.master_audit_log (
    user_id,
    user_name,
    role,
    module,
    action,
    status,
    detail,
    entity_type,
    entity_id,
    system_authoritative
  ) VALUES (
    v_verified_id,
    v_verified_name,
    v_verified_role,
    p_module,
    p_action,
    p_status,
    p_detail,
    p_entity_type,
    p_entity_id,
    v_is_auth
  );
EXCEPTION WHEN OTHERS THEN
  NULL; -- Audit failures must not abort caller transaction
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_system_event(text, text, text, text, text, text, text, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_system_event(text, text, text, text, text, text, text, text, text) TO authenticated, service_role;

-- Restrict master_audit_log read access strictly to Admin and Master
DROP POLICY IF EXISTS "Allow all reads for authenticated" ON public.master_audit_log;
DROP POLICY IF EXISTS "Authenticated read audit log" ON public.master_audit_log;
DROP POLICY IF EXISTS "master_audit_log_admin_master_select" ON public.master_audit_log;

CREATE POLICY "master_audit_log_admin_master_select"
  ON public.master_audit_log FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin_or_master());


-- ── 3. SEC-10: Horizontal Isolation on Financial Ledgers & Payments ──

-- Restrict party_financial_ledger reads:
--   Owner/Master can inspect all ledger entries.
--   Workers can only inspect ledger entries for parties assigned to their active picklists.
DROP POLICY IF EXISTS "authenticated_read_party_financial_ledger" ON public.party_financial_ledger;
DROP POLICY IF EXISTS "party_financial_ledger_horizontal_select" ON public.party_financial_ledger;

CREATE POLICY "party_financial_ledger_horizontal_select"
  ON public.party_financial_ledger FOR SELECT
  TO authenticated
  USING (
    public.is_current_user_admin_or_master()
    OR (
      public.is_current_user_worker()
      AND EXISTS (
        SELECT 1
          FROM public.picklist_parties pp
          JOIN public.picklists pl ON pp.picklist_id = pl.id
         WHERE pp.party_id = party_financial_ledger.party_id
           AND pl.worker_id = public.get_current_worker_id()
      )
    )
  );

-- Restrict payments reads:
--   Owner/Master can inspect all payments.
--   Workers can only inspect payments recorded by them or belonging to their assigned picklists.
DROP POLICY IF EXISTS "payments_authenticated_select" ON public.payments;
DROP POLICY IF EXISTS "Allow authenticated access" ON public.payments;
DROP POLICY IF EXISTS "payments_horizontal_select" ON public.payments;

CREATE POLICY "payments_horizontal_select"
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    public.is_current_user_admin_or_master()
    OR (
      public.is_current_user_worker()
      AND (
        worker_id = public.get_current_worker_id()
        OR EXISTS (
          SELECT 1
            FROM public.picklists pl
           WHERE pl.id = payments.picklist_id
             AND pl.worker_id = public.get_current_worker_id()
        )
      )
    )
  );


-- ── 4. SEC-07: Explicit Lockdown on inventory_movements Direct INSERT ─

-- Ensure NO client (anon or authenticated) can directly INSERT into inventory_movements.
-- All stock mutations must flow strictly through audited SECURITY DEFINER RPCs.
DROP POLICY IF EXISTS "anon_insert_inventory_movements" ON public.inventory_movements;
DROP POLICY IF EXISTS "inventory_movements_deny_direct_insert" ON public.inventory_movements;

CREATE POLICY "inventory_movements_deny_direct_insert"
  ON public.inventory_movements FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);


-- ── 5. SEC-11: Global Safe search_path Sweep ─────────────────────

-- Explicitly enforce SET search_path = public, pg_temp on all operational functions
ALTER FUNCTION public.get_warehouse_stock(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_vehicle_stock(uuid, uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_party_outstanding(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_financial_summary(date, date, uuid, uuid, uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_route_profitability(uuid, uuid, date, date, uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.check_route_stock(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.check_pin_rate_limit(text, int, interval) SET search_path = public, pg_temp;
ALTER FUNCTION public.record_pin_attempt(text, text, boolean, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.log_system_event(text, text, text, text, text, text, text, text, text) SET search_path = public, pg_temp;


-- ── 6. SEC-12: Directory Enumeration Hardening ───────────────────

-- pin_users: Only expose id, name, role to authenticated users; deny access to pin column
REVOKE ALL ON public.pin_users FROM anon, PUBLIC;
GRANT SELECT (id, name, role, status) ON public.pin_users TO authenticated;
GRANT ALL ON public.pin_users TO service_role;
GRANT ALL ON public.pin_users TO postgres;

-- workers: Confirm pin column is strictly denied to everyone except service_role and postgres
REVOKE SELECT (pin) ON public.workers FROM anon, authenticated, PUBLIC;


-- ── 7. Post-flight Validation Notice ─────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Migration 016 (Stage 8D) successfully applied:';
  RAISE NOTICE '  - SEC-08: PIN rate limiting table & lockout protection established';
  RAISE NOTICE '  - SEC-09: Audit log verified identity binding & Master/Admin read isolation';
  RAISE NOTICE '  - SEC-10: Horizontal data isolation enforced on party_financial_ledger & payments';
  RAISE NOTICE '  - SEC-07: Direct INSERT on inventory_movements strictly denied';
  RAISE NOTICE '  - SEC-11: search_path = public, pg_temp hardened across functions';
  RAISE NOTICE '  - SEC-12: Directory enumeration locked down; pin column permanently revoked';
END $$;

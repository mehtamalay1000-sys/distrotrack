-- ================================================================
-- Migration 014: Stage 8B — Server-Side Role & RLS Authorization Foundation
-- ================================================================
-- Establishes the database-enforced authorization boundary for DistroTrack v2:
--   1. Server-side role resolution: get_current_app_role() using auth.uid()
--   2. Role helper functions: is_current_user_owner(), is_current_user_worker(),
--      is_current_user_master(), is_current_user_admin_or_master()
--   3. Role immutability: Blocks direct client INSERT, UPDATE, DELETE on profiles
--   4. Workers table hardening: Admin/master control over worker records
--   5. Direct table mutation lockdown: Revokes write access from anon across all tables
--   6. RPC anonymous revocation: Revokes EXECUTE on sensitive business RPCs from anon
-- ================================================================

-- ── 1. Server-Side Role Resolution Function ──────────────────────
-- Strictly resolves role from auth.uid() -> public.profiles.role.
-- Never accepts caller-supplied user_id, role, or boolean admin flags.
-- Fails closed (returns NULL if no profile or unauthenticated).
CREATE OR REPLACE FUNCTION public.get_current_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.get_current_app_role() IS 
  'Stage 8B: Derives authenticated user role (owner, worker, master) server-side directly from auth.uid(). Zero caller arguments.';

GRANT EXECUTE ON FUNCTION public.get_current_app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_app_role() TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_current_app_role() FROM anon, PUBLIC;

-- ── 2. Server-Side Role Helper Functions ─────────────────────────
-- Zero-argument helpers for RLS policies and future RPC authorization.
CREATE OR REPLACE FUNCTION public.is_current_user_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((public.get_current_app_role() = 'owner'), false);
$$;

CREATE OR REPLACE FUNCTION public.is_current_user_worker()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((public.get_current_app_role() = 'worker'), false);
$$;

CREATE OR REPLACE FUNCTION public.is_current_user_master()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((public.get_current_app_role() = 'master'), false);
$$;

CREATE OR REPLACE FUNCTION public.is_current_user_admin_or_master()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((public.get_current_app_role() IN ('owner', 'master')), false);
$$;

GRANT EXECUTE ON FUNCTION public.is_current_user_owner() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_current_user_worker() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_current_user_master() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_current_user_admin_or_master() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_current_user_owner() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_current_user_worker() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_current_user_master() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_current_user_admin_or_master() FROM anon, PUBLIC;

-- ── 3. Profile Role Immutability & Identity Binding ──────────────
-- Eliminate client-side role modification vulnerability.
-- Drop the dangerous policy allowing authenticated users to update their own profile.
DROP POLICY IF EXISTS "Authenticated update own profile" ON public.profiles;

-- Deny direct client INSERT, UPDATE, DELETE on profiles.
-- Profiles must only be created/managed via database triggers and service_role.
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM authenticated, anon, PUBLIC;

DROP POLICY IF EXISTS "profiles_deny_direct_insert" ON public.profiles;
CREATE POLICY "profiles_deny_direct_insert"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "profiles_deny_direct_update" ON public.profiles;
CREATE POLICY "profiles_deny_direct_update"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "profiles_deny_direct_delete" ON public.profiles;
CREATE POLICY "profiles_deny_direct_delete"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (false);

-- Defense-in-depth trigger preventing role mutation on profiles
CREATE OR REPLACE FUNCTION public.prevent_profile_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Direct modification of profiles is strictly forbidden.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_tampering ON public.profiles;
CREATE TRIGGER trg_prevent_profile_tampering
  BEFORE UPDATE OR DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_tampering();

-- ── 4. Workers Table Hardening ───────────────────────────────────
-- Maintain directory read for login dropdown (non-sensitive columns only).
-- Restrict worker mutations (INSERT/UPDATE/DELETE) strictly to Owner / Master.
DROP POLICY IF EXISTS "Allow anon all" ON public.workers;
DROP POLICY IF EXISTS "Allow authenticated access" ON public.workers;

DROP POLICY IF EXISTS "workers_authenticated_select" ON public.workers;
CREATE POLICY "workers_authenticated_select"
  ON public.workers FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "workers_admin_master_mutation" ON public.workers;
CREATE POLICY "workers_admin_master_mutation"
  ON public.workers FOR ALL
  TO authenticated
  USING (public.is_current_user_admin_or_master())
  WITH CHECK (public.is_current_user_admin_or_master());

-- ── 5. pin_users Table Hardening ─────────────────────────────────
-- Keep directory read for admin dropdown.
-- Restrict pin_users mutations strictly to Owner / Master.
DROP POLICY IF EXISTS "Allow anon all" ON public.pin_users;
DROP POLICY IF EXISTS "Allow authenticated access" ON public.pin_users;

DROP POLICY IF EXISTS "pin_users_authenticated_select" ON public.pin_users;
CREATE POLICY "pin_users_authenticated_select"
  ON public.pin_users FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "pin_users_admin_master_mutation" ON public.pin_users;
CREATE POLICY "pin_users_admin_master_mutation"
  ON public.pin_users FOR ALL
  TO authenticated
  USING (public.is_current_user_admin_or_master())
  WITH CHECK (public.is_current_user_admin_or_master());

-- ── 6. Direct Table Mutation Lockdown (ANON Revocation) ──────────
-- Revoke all write privileges on all schema tables from anon.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, PUBLIC;

-- Drop all permissive anon policies on sensitive business tables.
DROP POLICY IF EXISTS "Allow anon all" ON public.deliveries;
DROP POLICY IF EXISTS "Allow anon all" ON public.delivery_items;
DROP POLICY IF EXISTS "Allow anon all" ON public.expenses;
DROP POLICY IF EXISTS "Allow anon all" ON public.parties;
DROP POLICY IF EXISTS "Allow anon all" ON public.payments;
DROP POLICY IF EXISTS "Allow anon read payments" ON public.payments;
DROP POLICY IF EXISTS "Allow anon all" ON public.picklist_items;
DROP POLICY IF EXISTS "Allow anon all" ON public.picklist_parties;
DROP POLICY IF EXISTS "Allow anon all" ON public.picklists;
DROP POLICY IF EXISTS "Allow anon all" ON public.products;
DROP POLICY IF EXISTS "Allow anon all" ON public.routes;
DROP POLICY IF EXISTS "Allow anon insert" ON public.master_audit_log;
DROP POLICY IF EXISTS "Allow anon select" ON public.master_audit_log;
DROP POLICY IF EXISTS "anon_insert_inventory_movements" ON public.inventory_movements;
DROP POLICY IF EXISTS "anon_read_inventory_movements" ON public.inventory_movements;
DROP POLICY IF EXISTS "allow_insert_picklist_load_items" ON public.picklist_load_items;
DROP POLICY IF EXISTS "allow_read_picklist_load_items" ON public.picklist_load_items;
DROP POLICY IF EXISTS "allow_update_picklist_load_items" ON public.picklist_load_items;
DROP POLICY IF EXISTS "block_delete_picklist_load_items" ON public.picklist_load_items;
DROP POLICY IF EXISTS "Allow read access to party_financial_ledger" ON public.party_financial_ledger;

-- Ensure authenticated read policies exist for tables previously opened to public/anon.
DROP POLICY IF EXISTS "authenticated_read_party_financial_ledger" ON public.party_financial_ledger;
CREATE POLICY "authenticated_read_party_financial_ledger"
  ON public.party_financial_ledger FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated_read_inventory_movements" ON public.inventory_movements;
CREATE POLICY "authenticated_read_inventory_movements"
  ON public.inventory_movements FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated_read_picklist_load_items" ON public.picklist_load_items;
CREATE POLICY "authenticated_read_picklist_load_items"
  ON public.picklist_load_items FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated_modify_picklist_load_items" ON public.picklist_load_items;
CREATE POLICY "authenticated_modify_picklist_load_items"
  ON public.picklist_load_items FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── 7. Sensitive RPC Lockdown (ANON Revocation) ──────────────────
-- Revoke EXECUTE from anon & PUBLIC on all business mutation RPCs.
REVOKE EXECUTE ON FUNCTION public.approve_expense(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_expense(uuid, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reverse_expense(uuid, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reverse_payment_with_ledger(uuid, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_party_payment_with_ledger(uuid, numeric, text, uuid, uuid, uuid, uuid, uuid, text, text, date, text, text, date, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_delivery_with_ledger(uuid, uuid, jsonb, text, numeric, text, text, date, text, text, jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.start_route_with_load(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_route_with_reconciliation(uuid, uuid, jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reconcile_and_close_route_finances(uuid, uuid, numeric, jsonb, boolean, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_cheque_status(uuid, text, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_expense_with_idempotency(text, numeric, date, text, text, uuid, uuid, uuid, text, text, text, boolean, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_route_stock(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_financial_summary(date, date, uuid, uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_party_outstanding(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_route_profitability(uuid, uuid, date, date, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_vehicle_stock(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_warehouse_stock(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_master_pin(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_actor_identity(uuid, text, text, text, text, text) FROM anon, PUBLIC;

-- Grant EXECUTE to authenticated and service_role.
GRANT EXECUTE ON FUNCTION public.approve_expense(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_expense(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverse_expense(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverse_payment_with_ledger(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_party_payment_with_ledger(uuid, numeric, text, uuid, uuid, uuid, uuid, uuid, text, text, date, text, text, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_delivery_with_ledger(uuid, uuid, jsonb, text, numeric, text, text, date, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_route_with_load(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_route_with_reconciliation(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_and_close_route_finances(uuid, uuid, numeric, jsonb, boolean, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_cheque_status(uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_expense_with_idempotency(text, numeric, date, text, text, uuid, uuid, uuid, text, text, text, boolean, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_route_stock(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_financial_summary(date, date, uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_party_outstanding(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_route_profitability(uuid, uuid, date, date, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_vehicle_stock(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_warehouse_stock(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_master_pin(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_actor_identity(uuid, text, text, text, text, text) TO service_role;

-- ── 8. Harden search_path on Functions ───────────────────────────
ALTER FUNCTION public.get_current_app_role() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_current_user_owner() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_current_user_worker() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_current_user_master() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_current_user_admin_or_master() SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_profile_tampering() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_master_pin(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_actor_identity(uuid, text, text, text, text, text) SET search_path = public, auth, extensions, pg_temp;

-- ── 9. Post-flight Validation Notice ─────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Migration 014 (Stage 8B) successfully applied:';
  RAISE NOTICE '  - Server-side role resolution functions established (get_current_app_role, is_current_user_*)';
  RAISE NOTICE '  - Profiles immutability enforced (direct client INSERT/UPDATE/DELETE blocked)';
  RAISE NOTICE '  - Workers table mutation restricted to Owner/Master';
  RAISE NOTICE '  - Anonymous direct table mutation privileges revoked across public schema';
  RAISE NOTICE '  - Anonymous EXECUTE revoked on 17+ business mutation RPCs';
END $$;

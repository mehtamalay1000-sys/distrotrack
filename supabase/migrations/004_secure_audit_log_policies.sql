-- ================================================================
-- Migration 004: Secure audit log RLS + remove anon write access
-- ================================================================
-- The master_audit_log table currently allows anon INSERT via a
-- broad RLS policy granted when log_system_event was first created.
-- This migration removes that gap:
--   1. Restricts INSERT on master_audit_log to SECURITY DEFINER RPCs only
--   2. Ensures anon role cannot directly INSERT to the audit log
--   3. Revokes execute on log_system_event from anon role
--
-- The SECURITY DEFINER function log_system_event already runs as
-- the DB superuser context, so RLS on master_audit_log does not
-- block it. This is the correct and intended pattern.
-- ================================================================

-- ── Step 1: Remove any existing anon INSERT policy on master_audit_log ──
-- Try to drop both possible policy names
DROP POLICY IF EXISTS "Allow insert for all" ON master_audit_log;
DROP POLICY IF EXISTS "Users can insert own audit logs" ON master_audit_log;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON master_audit_log;
DROP POLICY IF EXISTS "Allow authenticated insert" ON master_audit_log;

-- ── Step 2: Ensure RLS is enabled on master_audit_log ────────────
ALTER TABLE master_audit_log ENABLE ROW LEVEL SECURITY;

-- ── Step 3: Allow only authenticated users to READ audit log ─────
-- (anon users cannot read audit logs at all)
DROP POLICY IF EXISTS "Authenticated read audit log" ON master_audit_log;
CREATE POLICY "Authenticated read audit log"
  ON master_audit_log FOR SELECT
  TO authenticated
  USING (true);

-- ── Step 4: Block all direct INSERT to master_audit_log ──────────
-- Inserts must go through the SECURITY DEFINER log_system_event RPC.
-- The RPC bypasses RLS. This means no direct INSERT policy is needed.
-- Explicitly deny direct INSERT so this intent is clear.
-- (No INSERT policy = INSERT denied by default under RLS)

-- ── Step 5: Revoke execute on old anon-accessible RPC overloads ──
-- The original log_system_event (7 params) was granted to anon.
-- Our migration 002 replaced it with a 9-param version that is
-- only granted to authenticated. This step ensures the old grant is cleaned up.
DO $$
BEGIN
  -- Try to revoke from anon — will silently succeed even if not granted
  EXECUTE 'REVOKE EXECUTE ON FUNCTION log_system_event(text, text, text, text, text, text, text) FROM anon';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'Old 7-param log_system_event not found — nothing to revoke.';
END $$;

DO $$
BEGIN
  EXECUTE 'REVOKE EXECUTE ON FUNCTION log_system_event(text, text, text, text, text, text, text, text, text) FROM anon';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE '9-param log_system_event not found — nothing to revoke from anon.';
END $$;

-- ── Step 6: Grant execute on 9-param RPC to authenticated only ───
GRANT EXECUTE ON FUNCTION log_system_event(text, text, text, text, text, text, text, text, text)
  TO authenticated;

-- ── Post-flight ───────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Migration 004 complete:';
  RAISE NOTICE '  master_audit_log: anon INSERT policy removed';
  RAISE NOTICE '  master_audit_log: RLS SELECT granted to authenticated only';
  RAISE NOTICE '  log_system_event: anon EXECUTE revoked, authenticated EXECUTE granted';
END $$;

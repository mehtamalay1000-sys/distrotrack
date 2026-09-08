-- ================================================================
-- Migration 007: Lockdown pin_users RLS and Revoke Anon Access to PIN
-- ================================================================
-- Eliminates direct anonymous access to the sensitive `pin` column on
-- the `pin_users` table while ensuring the three authentication RPCs
-- (verify_admin_pin, check_master_pin, set_master_pin) and public
-- admin dropdown selection (id, name, phone) continue to function.
-- ================================================================

-- ── Step 1: Ensure Row Level Security is enabled on pin_users ────
ALTER TABLE pin_users ENABLE ROW LEVEL SECURITY;

-- ── Step 2: Block direct anonymous writes (INSERT, UPDATE, DELETE) ─
DROP POLICY IF EXISTS "anon_no_insert_pin_users" ON pin_users;
CREATE POLICY "anon_no_insert_pin_users"
  ON pin_users FOR INSERT
  TO anon
  WITH CHECK (false);

DROP POLICY IF EXISTS "anon_no_update_pin_users" ON pin_users;
CREATE POLICY "anon_no_update_pin_users"
  ON pin_users FOR UPDATE
  TO anon
  USING (false);

DROP POLICY IF EXISTS "anon_no_delete_pin_users" ON pin_users;
CREATE POLICY "anon_no_delete_pin_users"
  ON pin_users FOR DELETE
  TO anon
  USING (false);

-- ── Step 3: Column-level privilege restriction on pin_users ──────
-- Revoke whole-table SELECT from public and anon
REVOKE ALL ON pin_users FROM anon;
REVOKE ALL ON pin_users FROM PUBLIC;

-- Grant column-specific SELECT to anon for public display only
-- NOTE: The sensitive `pin` column is EXCLUDED from this grant.
GRANT SELECT (id, name, phone, role, status, created_at, updated_at)
  ON pin_users
  TO anon;

-- Full access retained for authenticated users and service_role
GRANT ALL ON pin_users TO service_role;
GRANT ALL ON pin_users TO postgres;

-- ── Step 4: Ensure verify_admin_pin has EXECUTE permission ───────
-- verify_admin_pin is SECURITY DEFINER, so it accesses pin_users
-- internally with postgres superuser privileges, bypassing the
-- column-level restriction on anon.
GRANT EXECUTE ON FUNCTION verify_admin_pin(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION verify_admin_pin(uuid, text) TO authenticated;

-- Ensure check_master_pin & set_master_pin execution grants remain intact
GRANT EXECUTE ON FUNCTION check_master_pin(text) TO anon;
GRANT EXECUTE ON FUNCTION check_master_pin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION set_master_pin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION set_master_pin(text) TO service_role;

-- ── Post-flight notification ─────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Migration 007 complete:';
  RAISE NOTICE '  - pin_users: RLS enabled';
  RAISE NOTICE '  - pin_users: direct anon INSERT, UPDATE, DELETE blocked';
  RAISE NOTICE '  - pin_users: anon SELECT on `pin` column REVOKED';
  RAISE NOTICE '  - verify_admin_pin RPC execute confirmed for anon & authenticated';
END $$;

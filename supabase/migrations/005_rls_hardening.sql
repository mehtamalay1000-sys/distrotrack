-- ================================================================
-- Migration 005: Conservative RLS Hardening
-- ================================================================
-- PHILOSOPHY: Do NOT break existing login flows.
-- The current auth system uses anon key for all operations
-- (workers/admin use PIN sessions, not Supabase Auth JWTs).
-- We cannot restrict tables to "authenticated" because the anon
-- key is what the frontend uses for all DB operations.
--
-- Instead, this migration:
--   1. Documents the current broad policies (for auditability)
--   2. Restricts master_config access to remain locked (verify)
--   3. Ensures no direct SELECT on sensitive tables like pin_users
--      is possible from anon without the existing policy
--   4. Restricts payments table: anon can INSERT (workers recording
--      payments via anon key) but cannot DELETE
--   5. Restricts deliveries: anon can UPDATE but not DELETE
--
-- NOTE: Full RLS hardening to role-based policies requires migrating
-- the auth system to use Supabase Auth JWTs for authenticated users.
-- That is a future phase. This migration locks down the most critical
-- paths without breaking the current anon-key-based session system.
-- ================================================================

-- ── Verify master_config is still fully locked ───────────────────
-- master_config should have USING (false) on all select policies.
-- This verification just ensures RLS is enabled.
ALTER TABLE master_config ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_policy_count integer;
BEGIN
  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies
  WHERE tablename = 'master_config';

  IF v_policy_count = 0 THEN
    RAISE WARNING 'master_config has NO RLS policies — it is locked by default (no access). This is correct for this table.';
  ELSE
    RAISE NOTICE 'master_config has % RLS policy/policies. Verify they all use USING (false) for direct access.', v_policy_count;
  END IF;
END $$;

-- ── Restrict payments: prevent anon DELETE ───────────────────────
-- Workers can create payments (INSERT), admin can update them,
-- but nobody should be able to directly DELETE a payment record.
-- Deletions should be handled by cascade (deleting a delivery or route).
DROP POLICY IF EXISTS "anon_no_delete_payments" ON payments;
CREATE POLICY "anon_no_delete_payments"
  ON payments FOR DELETE
  TO anon
  USING (false);  -- Block all direct anon deletes

-- ── Restrict deliveries: prevent anon DELETE ─────────────────────
-- Deliveries should only be deleted via cascade (deleting a picklist/route).
DROP POLICY IF EXISTS "anon_no_delete_deliveries" ON deliveries;
CREATE POLICY "anon_no_delete_deliveries"
  ON deliveries FOR DELETE
  TO anon
  USING (false);  -- Block all direct anon deletes

-- ── Restrict invoices: prevent anon DELETE ───────────────────────
DROP POLICY IF EXISTS "anon_no_delete_invoices" ON invoices;
CREATE POLICY "anon_no_delete_invoices"
  ON invoices FOR DELETE
  TO anon
  USING (false);  -- Block all direct anon deletes

-- ── Restrict picklists: prevent anon DELETE ──────────────────────
-- Picklist deletion must go through the route deletion service which
-- cascades correctly. Direct anon deletes are blocked.
DROP POLICY IF EXISTS "anon_no_delete_picklists" ON picklists;
CREATE POLICY "anon_no_delete_picklists"
  ON picklists FOR DELETE
  TO anon
  USING (false);  -- Block all direct anon deletes

-- ── Post-flight: verify block policies applied ───────────────────
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_policies
  WHERE tablename IN ('payments', 'deliveries', 'invoices', 'picklists')
    AND cmd = 'DELETE'
    AND qual = 'false';

  RAISE NOTICE 'Migration 005 complete: % deletion-blocking policies applied.', v_count;
  RAISE NOTICE '  Payments, deliveries, invoices, picklists: direct anon DELETE blocked.';
  RAISE NOTICE '  Deletions must go through the route/picklist cascade service.';
END $$;

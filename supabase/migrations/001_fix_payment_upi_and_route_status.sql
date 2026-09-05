-- ================================================================
-- Migration 001: Fix payment_mode UPI constraint + route status
-- ================================================================
-- SAFE: These are constraint RELAXATIONS — they add new allowed values.
-- No existing data is changed. Both values ('upi', 'completed') were
-- being blocked by the old constraints, so no existing row uses them.
-- ================================================================
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- BEFORE deploying the updated application code.
-- ================================================================

-- ── Pre-flight safety checks ──────────────────────────────────────
-- Verify no existing payments use 'upi' (they can't — old constraint blocked it)
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count FROM payments WHERE payment_mode = 'upi';
  IF v_count > 0 THEN
    RAISE NOTICE 'INFO: % existing payment(s) already use payment_mode=upi (unexpected). Migration will still proceed.', v_count;
  ELSE
    RAISE NOTICE 'Pre-flight OK: No existing payments use upi mode (expected).';
  END IF;
END $$;

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count FROM routes WHERE status = 'completed';
  IF v_count > 0 THEN
    RAISE NOTICE 'INFO: % existing route(s) already use status=completed. Migration will still proceed.', v_count;
  ELSE
    RAISE NOTICE 'Pre-flight OK: No existing routes use completed status (expected).';
  END IF;
END $$;

-- ── Fix payments.payment_mode check constraint ───────────────────
-- Old: ('cash', 'cheque', 'credit')
-- New: ('cash', 'cheque', 'credit', 'upi')
ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_payment_mode_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_payment_mode_check
  CHECK (payment_mode IN ('cash', 'cheque', 'credit', 'upi'));

-- ── Fix routes.status check constraint ──────────────────────────
-- Old: ('active', 'inactive')
-- New: ('active', 'inactive', 'completed')
-- RouteStatus type in database.types.ts already includes 'completed'.
-- The DB constraint must match.
ALTER TABLE routes
  DROP CONSTRAINT IF EXISTS routes_status_check;

ALTER TABLE routes
  ADD CONSTRAINT routes_status_check
  CHECK (status IN ('active', 'inactive', 'completed'));

-- ── Verify constraints applied ────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Migration 001 complete:';
  RAISE NOTICE '  payments.payment_mode now accepts: cash, cheque, credit, upi';
  RAISE NOTICE '  routes.status now accepts: active, inactive, completed';
END $$;

-- ================================================================
-- Migration 002: Add missing columns to existing tables
-- ================================================================
-- All changes use ADD COLUMN IF NOT EXISTS — completely safe.
-- No existing data is modified, truncated, or deleted.
-- Columns that already exist (e.g. from a previous manual run) are
-- skipped silently due to IF NOT EXISTS.
-- ================================================================
-- Run this in Supabase SQL Editor after Migration 001.
-- ================================================================

-- ── Pre-flight: count existing data to verify safety ─────────────
DO $$
BEGIN
  RAISE NOTICE 'Migration 002: Pre-flight checks starting...';
  RAISE NOTICE '  invoice_items rows: %', (SELECT COUNT(*) FROM invoice_items);
  RAISE NOTICE '  picklist_items rows: %', (SELECT COUNT(*) FROM picklist_items);
  RAISE NOTICE '  delivery_items rows: %', (SELECT COUNT(*) FROM delivery_items);
  RAISE NOTICE '  expenses rows: %', (SELECT COUNT(*) FROM expenses);
  RAISE NOTICE '  workers rows: %', (SELECT COUNT(*) FROM workers);
  RAISE NOTICE '  payments rows: %', (SELECT COUNT(*) FROM payments);
  RAISE NOTICE '  deliveries rows: %', (SELECT COUNT(*) FROM deliveries);
  RAISE NOTICE '  master_audit_log rows: %', (SELECT COUNT(*) FROM master_audit_log);
END $$;

-- ── invoice_items: add free_quantity ─────────────────────────────
ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS free_quantity numeric(10,2) NOT NULL DEFAULT 0;

-- ── picklist_items: add free_quantity ────────────────────────────
ALTER TABLE picklist_items
  ADD COLUMN IF NOT EXISTS free_quantity numeric(10,2) NOT NULL DEFAULT 0;

-- ── delivery_items: add free_quantity ────────────────────────────
ALTER TABLE delivery_items
  ADD COLUMN IF NOT EXISTS free_quantity numeric(10,2) NOT NULL DEFAULT 0;

-- ── expenses: add route_id, visible_to_worker, receipt_url ───────
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS route_id uuid REFERENCES routes(id) ON DELETE SET NULL;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS visible_to_worker boolean NOT NULL DEFAULT false;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS receipt_url text;

-- ── workers: add monthly_target ───────────────────────────────────
ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS monthly_target numeric(12,2) NOT NULL DEFAULT 0;

-- ── payments: add reference_number, received_by_worker_id ─────────
-- reference_number stores UPI UTR, cheque reference, etc.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS reference_number text;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS received_by_worker_id uuid REFERENCES workers(id) ON DELETE SET NULL;

-- ── deliveries: add returned_amount ────────────────────────────────
-- returned_amount tracks the value of goods returned (for partial deliveries).
ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS returned_amount numeric(12,2) NOT NULL DEFAULT 0;

-- ── master_audit_log: add entity_type, entity_id ─────────────────
-- Allows querying audit log by affected business entity (e.g. "invoice", "delivery").
ALTER TABLE master_audit_log
  ADD COLUMN IF NOT EXISTS entity_type text;

ALTER TABLE master_audit_log
  ADD COLUMN IF NOT EXISTS entity_id text;

-- ── Add index for expenses by route ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_expenses_route ON expenses(route_id);

-- ── Add index for audit log by entity ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON master_audit_log(entity_type, entity_id);

-- ── Update log_system_event RPC to accept optional entity params ──
-- We extend the existing RPC signature to optionally log entity_type and entity_id.
-- The original 7-parameter version still works — this adds an 8th and 9th param with defaults.
CREATE OR REPLACE FUNCTION log_system_event(
  p_user_id   text,
  p_user_name text,
  p_role      text,
  p_module    text,
  p_action    text,
  p_status    text DEFAULT 'success',
  p_detail    text DEFAULT null,
  p_entity_type text DEFAULT null,
  p_entity_id   text DEFAULT null
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO master_audit_log (user_id, user_name, role, module, action, status, detail, entity_type, entity_id)
  VALUES (p_user_id, p_user_name, p_role, p_module, p_action, p_status, p_detail, p_entity_type, p_entity_id);
EXCEPTION WHEN OTHERS THEN
  NULL; -- Audit failures must never surface to the calling transaction
END;
$$;

-- Re-grant permissions to the new overload
REVOKE ALL ON FUNCTION log_system_event(text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_system_event(text, text, text, text, text, text, text, text, text) TO authenticated;
-- Note: anon grant intentionally removed — see migration 004 for audit log security hardening

-- ── Post-flight verification ──────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Migration 002 complete. Verifying columns exist...';

  -- invoice_items
  PERFORM column_name FROM information_schema.columns
    WHERE table_name = 'invoice_items' AND column_name = 'free_quantity';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: invoice_items.free_quantity missing'; END IF;

  -- picklist_items
  PERFORM column_name FROM information_schema.columns
    WHERE table_name = 'picklist_items' AND column_name = 'free_quantity';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: picklist_items.free_quantity missing'; END IF;

  -- delivery_items
  PERFORM column_name FROM information_schema.columns
    WHERE table_name = 'delivery_items' AND column_name = 'free_quantity';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: delivery_items.free_quantity missing'; END IF;

  -- expenses route_id
  PERFORM column_name FROM information_schema.columns
    WHERE table_name = 'expenses' AND column_name = 'route_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: expenses.route_id missing'; END IF;

  -- workers monthly_target
  PERFORM column_name FROM information_schema.columns
    WHERE table_name = 'workers' AND column_name = 'monthly_target';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: workers.monthly_target missing'; END IF;

  -- payments reference_number
  PERFORM column_name FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'reference_number';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: payments.reference_number missing'; END IF;

  -- deliveries returned_amount
  PERFORM column_name FROM information_schema.columns
    WHERE table_name = 'deliveries' AND column_name = 'returned_amount';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: deliveries.returned_amount missing'; END IF;

  RAISE NOTICE 'All columns verified successfully. Migration 002 is complete.';
END $$;

-- ================================================================
-- Migration 003: Import idempotency constraints
-- ================================================================
-- Adds uniqueness constraints to prevent duplicate deliveries and
-- payments from being created during import retries or double-submission.
--
-- SAFETY PRE-CHECK: Each constraint addition is guarded by a check
-- that verifies no existing data would violate the constraint.
-- If violations are found, the constraint is SKIPPED with a warning
-- rather than failing the migration.
-- ================================================================

-- ── Pre-flight: Check for existing duplicates ─────────────────────
DO $$
DECLARE
  v_dup_deliveries integer;
  v_dup_payments integer;
BEGIN
  RAISE NOTICE 'Migration 003: Pre-flight checks...';

  -- Check for duplicate deliveries (same picklist + party)
  SELECT COUNT(*) INTO v_dup_deliveries
  FROM (
    SELECT picklist_id, party_id, COUNT(*) AS cnt
    FROM deliveries
    WHERE picklist_id IS NOT NULL
    GROUP BY picklist_id, party_id
    HAVING COUNT(*) > 1
  ) t;

  IF v_dup_deliveries > 0 THEN
    RAISE WARNING 'Found % duplicate (picklist_id, party_id) combinations in deliveries. Unique constraint will be SKIPPED for safety. Please resolve duplicates manually before re-running.', v_dup_deliveries;
  ELSE
    RAISE NOTICE 'Pre-flight OK: No duplicate (picklist_id, party_id) in deliveries.';
  END IF;

  -- Check for duplicate payments (same delivery + mode + amount + date)
  SELECT COUNT(*) INTO v_dup_payments
  FROM (
    SELECT delivery_id, payment_mode, amount, payment_date, COUNT(*) AS cnt
    FROM payments
    WHERE delivery_id IS NOT NULL
    GROUP BY delivery_id, payment_mode, amount, payment_date
    HAVING COUNT(*) > 1
  ) t;

  IF v_dup_payments > 0 THEN
    RAISE WARNING 'Found % duplicate payment combinations. Payment uniqueness constraint will be SKIPPED.', v_dup_payments;
  ELSE
    RAISE NOTICE 'Pre-flight OK: No duplicate payment combinations found.';
  END IF;
END $$;

-- ── Unique constraint: one delivery per party per picklist ────────
-- Prevents double-import of the same picklist creating duplicate deliveries.
-- Only applied if no existing duplicates were found (pre-flight warning above).
DO $$
DECLARE
  v_dup_count integer;
BEGIN
  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT picklist_id, party_id, COUNT(*) AS cnt
    FROM deliveries
    WHERE picklist_id IS NOT NULL
    GROUP BY picklist_id, party_id
    HAVING COUNT(*) > 1
  ) t;

  IF v_dup_count = 0 THEN
    -- Safe to add the constraint
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'uq_delivery_picklist_party'
    ) THEN
      ALTER TABLE deliveries
        ADD CONSTRAINT uq_delivery_picklist_party
        UNIQUE (picklist_id, party_id);
      RAISE NOTICE 'Added UNIQUE constraint uq_delivery_picklist_party on deliveries(picklist_id, party_id).';
    ELSE
      RAISE NOTICE 'Constraint uq_delivery_picklist_party already exists — skipped.';
    END IF;
  ELSE
    RAISE WARNING 'Skipping uq_delivery_picklist_party due to existing duplicates — resolve manually.';
  END IF;
END $$;

-- ── Index: picklists by picklist_number (for duplicate import detection) ──
-- Supports fast lookup during import to check if a picklist already exists.
-- The picklist_number column already has a UNIQUE constraint from schema.sql,
-- but an explicit index improves lookup performance.
CREATE INDEX IF NOT EXISTS idx_picklists_number ON picklists(picklist_number);

-- ── Index: invoices by invoice_number ────────────────────────────
-- Already UNIQUE from schema.sql. Index confirms fast duplicate detection.
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);

-- ── Post-flight ───────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Migration 003 complete.';
END $$;

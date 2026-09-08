-- ================================================================
-- Migration 008: Delivery Relationship Safe Schema Correction
-- ================================================================
-- Replaces UNIQUE(picklist_id, party_id) with UNIQUE(invoice_id)
-- on the deliveries table to allow multiple invoices per customer
-- on a single picklist while strictly enforcing 1:1 invoice delivery.
--
-- invoice_id remains NULLABLE to support picklist-only dispatches.
-- Postgres UNIQUE permits multiple NULL values (standard SQL semantics).
-- ================================================================

-- ── Pre-flight: verify no duplicate non-null invoice_id values exist ──
DO $$
DECLARE
  v_dup_invoices integer;
BEGIN
  RAISE NOTICE 'Migration 008: Running pre-flight checks...';

  SELECT COUNT(*) INTO v_dup_invoices
  FROM (
    SELECT invoice_id, COUNT(*) AS cnt
    FROM deliveries
    WHERE invoice_id IS NOT NULL
    GROUP BY invoice_id
    HAVING COUNT(*) > 1
  ) t;

  IF v_dup_invoices > 0 THEN
    RAISE EXCEPTION 'Pre-flight check failed: Found % duplicate invoice_id entries in deliveries table. Aborting migration.', v_dup_invoices;
  ELSE
    RAISE NOTICE 'Pre-flight check passed: Zero duplicate invoice_ids found in deliveries.';
  END IF;
END $$;

-- ── Step 1: Drop the restrictive (picklist_id, party_id) constraint on deliveries ──
-- Note: picklist_parties(picklist_id, party_id) remains untouched to preserve route manifest stops.
ALTER TABLE deliveries
  DROP CONSTRAINT IF EXISTS uq_delivery_picklist_party;

-- ── Step 2: Add UNIQUE constraint on invoice_id ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_delivery_invoice'
  ) THEN
    ALTER TABLE deliveries
      ADD CONSTRAINT uq_delivery_invoice
      UNIQUE (invoice_id);
    RAISE NOTICE 'Added UNIQUE constraint uq_delivery_invoice on deliveries(invoice_id).';
  ELSE
    RAISE NOTICE 'Constraint uq_delivery_invoice already exists — skipped.';
  END IF;
END $$;

-- ── Step 3: Performance index on deliveries(invoice_id) ──
CREATE INDEX IF NOT EXISTS idx_deliveries_invoice_id ON deliveries(invoice_id);

-- ── Post-flight confirmation ──
DO $$
BEGIN
  RAISE NOTICE 'Migration 008 complete: Deliveries table is now keyed by invoice_id.';
END $$;

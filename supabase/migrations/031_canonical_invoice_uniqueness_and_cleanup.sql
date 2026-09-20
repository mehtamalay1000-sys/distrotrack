-- ================================================================
-- Migration 031: Canonical Invoice Uniqueness and Cleanup
-- ================================================================
-- 1. Enforces strict case-insensitive trimmed invoice number uniqueness
-- 2. Consolidates/corrects existing invoice records to canonical amounts
-- 3. Pre-flight checks for duplicate invoice records
-- ================================================================

DO $$
DECLARE
  v_dup_invoices integer;
BEGIN
  RAISE NOTICE 'Migration 031: Running pre-flight checks for duplicate invoices...';

  SELECT COUNT(*) INTO v_dup_invoices
  FROM (
    SELECT UPPER(TRIM(invoice_number)) AS clean_no, COUNT(*) AS cnt
    FROM public.invoices
    GROUP BY UPPER(TRIM(invoice_number))
    HAVING COUNT(*) > 1
  ) t;

  IF v_dup_invoices > 0 THEN
    RAISE WARNING 'Found % duplicate invoice number groups in invoices table.', v_dup_invoices;
  ELSE
    RAISE NOTICE 'Pre-flight check passed: Zero duplicate invoice numbers found in invoices table.';
  END IF;
END $$;

-- ── Step 1: Ensure unique index on UPPER(TRIM(invoice_number)) ───
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_clean_number
  ON public.invoices (UPPER(TRIM(invoice_number)));

-- ── Step 2: Correct historical partial amounts to canonical amounts ──
-- A37A506291 was saved with partial items sum 725.66 instead of official 4005.00
UPDATE public.invoices
   SET net_amount = 4005.00,
       total_amount = 4005.00
 WHERE UPPER(TRIM(invoice_number)) = 'A37A506291'
   AND (net_amount = 725.66 OR net_amount = 0);

-- A37A506292 was saved with partial items sum 2832.95 instead of official 9471.00
UPDATE public.invoices
   SET net_amount = 9471.00,
       total_amount = 9471.00
 WHERE UPPER(TRIM(invoice_number)) = 'A37A506292'
   AND (net_amount = 2832.95 OR net_amount = 0);

-- ── Step 3: Align linked deliveries if needed ────────────────────
UPDATE public.deliveries d
   SET total_amount = i.net_amount
  FROM public.invoices i
 WHERE d.invoice_id = i.id
   AND d.total_amount = 0
   AND i.net_amount > 0;

-- ── Post-flight confirmation ──
DO $$
BEGIN
  RAISE NOTICE 'Migration 031 complete: Canonical invoice uniqueness enforced and existing amounts aligned.';
END $$;

-- ============================================================================
-- Migration 044: PRE-GO-LIVE TEST DATA RESET
-- DistroTrack v2 — Authorized Destructive Test Data Cleanup
-- ============================================================================
-- PURPOSE:
--   Remove ALL confirmed test operational/transactional data from the database
--   to achieve a clean Day-0 Go-Live state. This is an authorized operation
--   executed by the Owner/Admin/Master identity on the PRE-GO-LIVE test database.
--
-- AUDIT STATE (CONFIRMED BEFORE THIS MIGRATION):
--   Products:                 72   (PRESERVED)
--   Historical Sales Products: 17647 (PRESERVED)
--   Parties:                  1197 (PRESERVED)
--   Workers:                  2    (PRESERVED)
--   Profiles:                 5    (PRESERVED)
--   ---
--   Routes:                   1    (SANGAMNER 6, archived — DELETED)
--   Picklists:                1    (DELETED)
--   Deliveries:               23   (DELETED)
--   Delivery Items:           0    (already clean)
--   Invoices:                 23   (DELETED)
--   Payments:                 62   (DELETED)
--   Party Financial Ledger:   85   (DELETED)
--   Inventory Movements:      72   (all purchase_inward test data — DELETED)
--   SAP Purchase Imports:     8    (test imports — DELETED)
--   SAP Purchase Items:       720  (test items — DELETED)
--   SAP Sales Imports:        0    (already clean)
--   Unmapped SKU Exceptions:  70   (DELETED)
--   Expenses:                 0    (already clean)
--   Stock Exceptions:         0    (already clean)
--
-- DELETION ORDER: Respects FK constraints leaf→parent order.
--   1. sap_purchase_import_items (FK → sap_purchase_imports)
--   2. sap_sales_import_items    (FK → sap_sales_imports)
--   3. sap_stock_reconciliation_items (FK → sap_stock_reconciliations)
--   4. sap_stock_reconciliations
--   5. sap_purchase_imports
--   6. sap_sales_imports
--   7. inventory_movements (test operational only)
--   8. unmapped_sku_exceptions
--   9. route_stock_exceptions
--   10. party_financial_ledger (all test entries)
--   11. payments
--   12. expenses
--   13. delivery_items
--   14. deliveries
--   15. invoices
--   16. picklist_load_items (FK → picklists, CASCADE-safe)
--   17. picklist_items (FK → picklists)
--   18. picklists
--   19. routes (after worker assignment cleared)
--   20. Reset worker current_route_id / current_picklist_id to NULL
--   21. Reset parties.route_id → NULL (no customer records deleted)
--   22. Create authoritative audit event
--
-- PRESERVED:
--   products, historical_sales_products, parties (records), workers,
--   profiles, master_config, product_mrp_history, product_mappings,
--   all schema, all RPCs, all RLS policies, all migrations
-- ============================================================================

BEGIN;

-- ── Safety guard: only Admin/Master may execute ───────────────────────────
DO $$
BEGIN
  IF NOT (public.is_current_user_admin_or_master()) THEN
    RAISE EXCEPTION 'PRE_GOLIVE_RESET: Unauthorized — only Admin/Master may execute this operation.'
      USING ERRCODE = '42501';
  END IF;
END $$;

-- ── PHASE 0: Snapshot counts BEFORE deletion (for audit) ─────────────────
DO $$
DECLARE
  v_routes            integer;
  v_picklists         integer;
  v_deliveries        integer;
  v_delivery_items    integer;
  v_invoices          integer;
  v_payments          integer;
  v_ledger            integer;
  v_expenses          integer;
  v_inv_movements     integer;
  v_stock_exc         integer;
  v_unmapped_exc      integer;
  v_sap_pur_imports   integer;
  v_sap_pur_items     integer;
  v_sap_sal_imports   integer;
  v_sap_sal_items     integer;
  v_sap_rec           integer;
  v_sap_rec_items     integer;
  v_products          integer;
  v_hist_sales        integer;
  v_parties           integer;
  v_workers           integer;
  v_profiles          integer;
BEGIN
  SELECT COUNT(*) INTO v_routes FROM public.routes;
  SELECT COUNT(*) INTO v_picklists FROM public.picklists;
  SELECT COUNT(*) INTO v_deliveries FROM public.deliveries;
  SELECT COUNT(*) INTO v_delivery_items FROM public.delivery_items;
  SELECT COUNT(*) INTO v_invoices FROM public.invoices;
  SELECT COUNT(*) INTO v_payments FROM public.payments;
  SELECT COUNT(*) INTO v_ledger FROM public.party_financial_ledger;
  SELECT COUNT(*) INTO v_expenses FROM public.expenses;
  SELECT COUNT(*) INTO v_inv_movements FROM public.inventory_movements;
  SELECT COUNT(*) INTO v_stock_exc FROM public.route_stock_exceptions;
  SELECT COUNT(*) INTO v_unmapped_exc FROM public.unmapped_sku_exceptions;
  SELECT COUNT(*) INTO v_sap_pur_imports FROM public.sap_purchase_imports;
  SELECT COUNT(*) INTO v_sap_pur_items FROM public.sap_purchase_import_items;
  SELECT COUNT(*) INTO v_sap_sal_imports FROM public.sap_sales_imports;
  SELECT COUNT(*) INTO v_sap_sal_items FROM public.sap_sales_import_items;
  SELECT COUNT(*) INTO v_sap_rec FROM public.sap_stock_reconciliations;
  SELECT COUNT(*) INTO v_sap_rec_items FROM public.sap_stock_reconciliation_items;
  SELECT COUNT(*) INTO v_products FROM public.products;
  SELECT COUNT(*) INTO v_hist_sales FROM public.historical_sales_products;
  SELECT COUNT(*) INTO v_parties FROM public.parties;
  SELECT COUNT(*) INTO v_workers FROM public.workers;
  SELECT COUNT(*) INTO v_profiles FROM public.profiles;

  RAISE NOTICE '===== PRE-GO-LIVE TEST DATA RESET — SNAPSHOT BEFORE =====';
  RAISE NOTICE 'TRANSACTIONAL (will be deleted):';
  RAISE NOTICE '  routes:                  %', v_routes;
  RAISE NOTICE '  picklists:               %', v_picklists;
  RAISE NOTICE '  deliveries:              %', v_deliveries;
  RAISE NOTICE '  delivery_items:          %', v_delivery_items;
  RAISE NOTICE '  invoices:                %', v_invoices;
  RAISE NOTICE '  payments:                %', v_payments;
  RAISE NOTICE '  party_financial_ledger:  %', v_ledger;
  RAISE NOTICE '  expenses:                %', v_expenses;
  RAISE NOTICE '  inventory_movements:     %', v_inv_movements;
  RAISE NOTICE '  route_stock_exceptions:  %', v_stock_exc;
  RAISE NOTICE '  unmapped_sku_exceptions: %', v_unmapped_exc;
  RAISE NOTICE '  sap_purchase_imports:    %', v_sap_pur_imports;
  RAISE NOTICE '  sap_purchase_items:      %', v_sap_pur_items;
  RAISE NOTICE '  sap_sales_imports:       %', v_sap_sal_imports;
  RAISE NOTICE '  sap_sales_items:         %', v_sap_sal_items;
  RAISE NOTICE '  sap_stock_reconciliations: %', v_sap_rec;
  RAISE NOTICE '  sap_stock_rec_items:     %', v_sap_rec_items;
  RAISE NOTICE 'MASTER DATA (will be preserved):';
  RAISE NOTICE '  products:                %', v_products;
  RAISE NOTICE '  historical_sales_products: %', v_hist_sales;
  RAISE NOTICE '  parties:                 %', v_parties;
  RAISE NOTICE '  workers:                 %', v_workers;
  RAISE NOTICE '  profiles:                %', v_profiles;
END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- PHASE 1: SAP IMPORT DATA
-- (deepest leaves first — no FK deps on other transactional tables)
-- ══════════════════════════════════════════════════════════════════════════

-- 1a. SAP Stock Reconciliation Items (FK → sap_stock_reconciliations)
DELETE FROM public.sap_stock_reconciliation_items;

-- 1b. SAP Stock Reconciliations
DELETE FROM public.sap_stock_reconciliations;

-- 1c. SAP Sales Import Items (FK → sap_sales_imports)
DELETE FROM public.sap_sales_import_items;

-- 1d. SAP Sales Imports
DELETE FROM public.sap_sales_imports;

-- 1e. SAP Purchase Import Items (FK → sap_purchase_imports)
DELETE FROM public.sap_purchase_import_items;

-- 1f. SAP Purchase Imports
DELETE FROM public.sap_purchase_imports;

-- ══════════════════════════════════════════════════════════════════════════
-- PHASE 2: INVENTORY MOVEMENTS
-- All current test data. No FK children reference inventory_movements
-- as parent (sap_sales_import_items.movement_id is ON DELETE SET NULL).
-- ══════════════════════════════════════════════════════════════════════════

DELETE FROM public.inventory_movements;

-- ══════════════════════════════════════════════════════════════════════════
-- PHASE 3: EXCEPTIONS
-- ══════════════════════════════════════════════════════════════════════════

DELETE FROM public.route_stock_exceptions;
DELETE FROM public.unmapped_sku_exceptions;

-- ══════════════════════════════════════════════════════════════════════════
-- PHASE 4: FINANCIAL LEDGER + PAYMENTS
-- ══════════════════════════════════════════════════════════════════════════

-- 4a. Party Financial Ledger (all test entries)
DELETE FROM public.party_financial_ledger;

-- 4b. Payments
DELETE FROM public.payments;

-- 4c. Expenses
DELETE FROM public.expenses;

-- ══════════════════════════════════════════════════════════════════════════
-- PHASE 5: DELIVERIES + DELIVERY ITEMS
-- delivery_items FK → deliveries ON DELETE CASCADE — delete items first
-- to be explicit, then deliveries.
-- ══════════════════════════════════════════════════════════════════════════

DELETE FROM public.delivery_items;
DELETE FROM public.deliveries;

-- ══════════════════════════════════════════════════════════════════════════
-- PHASE 6: INVOICES
-- After deliveries are deleted (deliveries FK → invoices is nullable/not blocking)
-- ══════════════════════════════════════════════════════════════════════════

DELETE FROM public.invoices;

-- ══════════════════════════════════════════════════════════════════════════
-- PHASE 7: PICKLISTS + PICKLIST ITEMS
-- picklist_load_items FK → picklists ON DELETE CASCADE
-- picklist_items FK → picklists (if exists)
-- Delete children first then parent.
-- ══════════════════════════════════════════════════════════════════════════

DELETE FROM public.picklist_load_items;

-- picklist_items may or may not have FK cascade — delete explicitly
DELETE FROM public.picklist_items WHERE TRUE;

DELETE FROM public.picklists;

-- ══════════════════════════════════════════════════════════════════════════
-- PHASE 8: ROUTES
-- Must clear worker's current_route_id first (FK from workers → routes).
-- PRESERVE worker records — only NULL out the active route references.
-- ══════════════════════════════════════════════════════════════════════════

-- 8a. Clear worker active route/picklist state (NO worker record deleted)
UPDATE public.workers
SET
  current_route_id    = NULL,
  current_picklist_id = NULL,
  status              = 'available',
  updated_at          = now()
WHERE current_route_id IS NOT NULL OR current_picklist_id IS NOT NULL;

-- 8b. Clear parties.route_id for parties linked to test route
--     (preserves all party RECORDS — only unlinks the route association)
UPDATE public.parties
SET route_id = NULL, updated_at = now()
WHERE route_id IS NOT NULL;

-- 8c. Allow hard delete of route by bypassing the deletion-protection trigger
SET LOCAL distrotrack.allow_route_hard_delete = 'true';

-- 8d. Delete the test route(s)
DELETE FROM public.routes;

-- 8e. Reset the session var
SET LOCAL distrotrack.allow_route_hard_delete = 'false';

-- ══════════════════════════════════════════════════════════════════════════
-- PHASE 9: POST-DELETION VERIFICATION (assert expected state)
-- ══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_count integer;

  -- Master data counts (must remain > 0)
  v_products          integer;
  v_hist_sales        integer;
  v_parties           integer;
  v_workers           integer;
  v_profiles          integer;
BEGIN
  -- Verify all transactional tables are empty
  SELECT COUNT(*) INTO v_count FROM public.routes;
  IF v_count > 0 THEN RAISE EXCEPTION 'RESET FAILED: routes still has % rows', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM public.picklists;
  IF v_count > 0 THEN RAISE EXCEPTION 'RESET FAILED: picklists still has % rows', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM public.deliveries;
  IF v_count > 0 THEN RAISE EXCEPTION 'RESET FAILED: deliveries still has % rows', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM public.delivery_items;
  IF v_count > 0 THEN RAISE EXCEPTION 'RESET FAILED: delivery_items still has % rows', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM public.invoices;
  IF v_count > 0 THEN RAISE EXCEPTION 'RESET FAILED: invoices still has % rows', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM public.payments;
  IF v_count > 0 THEN RAISE EXCEPTION 'RESET FAILED: payments still has % rows', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM public.party_financial_ledger;
  IF v_count > 0 THEN RAISE EXCEPTION 'RESET FAILED: party_financial_ledger still has % rows', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM public.expenses;
  IF v_count > 0 THEN RAISE EXCEPTION 'RESET FAILED: expenses still has % rows', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM public.inventory_movements;
  IF v_count > 0 THEN RAISE EXCEPTION 'RESET FAILED: inventory_movements still has % rows', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM public.route_stock_exceptions;
  IF v_count > 0 THEN RAISE EXCEPTION 'RESET FAILED: route_stock_exceptions still has % rows', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM public.unmapped_sku_exceptions;
  IF v_count > 0 THEN RAISE EXCEPTION 'RESET FAILED: unmapped_sku_exceptions still has % rows', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM public.sap_purchase_imports;
  IF v_count > 0 THEN RAISE EXCEPTION 'RESET FAILED: sap_purchase_imports still has % rows', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM public.sap_purchase_import_items;
  IF v_count > 0 THEN RAISE EXCEPTION 'RESET FAILED: sap_purchase_import_items still has % rows', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM public.sap_sales_imports;
  IF v_count > 0 THEN RAISE EXCEPTION 'RESET FAILED: sap_sales_imports still has % rows', v_count; END IF;

  SELECT COUNT(*) INTO v_count FROM public.sap_sales_import_items;
  IF v_count > 0 THEN RAISE EXCEPTION 'RESET FAILED: sap_sales_import_items still has % rows', v_count; END IF;

  -- Verify master data is still intact
  SELECT COUNT(*) INTO v_products FROM public.products;
  IF v_products < 1 THEN RAISE EXCEPTION 'CRITICAL: products table was deleted! ROLLBACK.'; END IF;

  SELECT COUNT(*) INTO v_hist_sales FROM public.historical_sales_products;
  IF v_hist_sales < 1 THEN RAISE EXCEPTION 'CRITICAL: historical_sales_products was deleted! ROLLBACK.'; END IF;

  SELECT COUNT(*) INTO v_parties FROM public.parties;
  IF v_parties < 1 THEN RAISE EXCEPTION 'CRITICAL: parties table was deleted! ROLLBACK.'; END IF;

  SELECT COUNT(*) INTO v_workers FROM public.workers;
  IF v_workers < 1 THEN RAISE EXCEPTION 'CRITICAL: workers table was deleted! ROLLBACK.'; END IF;

  SELECT COUNT(*) INTO v_profiles FROM public.profiles;
  IF v_profiles < 1 THEN RAISE EXCEPTION 'CRITICAL: profiles table was deleted! ROLLBACK.'; END IF;

  RAISE NOTICE '===== PRE-GO-LIVE RESET — ALL ASSERTIONS PASSED =====';
  RAISE NOTICE 'Transactional tables: EMPTY ✓';
  RAISE NOTICE 'Master data preserved:';
  RAISE NOTICE '  products:                %', v_products;
  RAISE NOTICE '  historical_sales_products: %', v_hist_sales;
  RAISE NOTICE '  parties:                 %', v_parties;
  RAISE NOTICE '  workers:                 %', v_workers;
  RAISE NOTICE '  profiles:                %', v_profiles;
END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- PHASE 10: CREATE AUTHORITATIVE AUDIT EVENT
-- Uses log_system_event() which binds identity from auth.uid() → profiles.
-- Signature: (p_user_id, p_user_name, p_role, p_module, p_action,
--             p_status, p_detail, p_entity_type, p_entity_id)
-- Writes to master_audit_log (authoritative system audit table).
-- ══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  PERFORM public.log_system_event(
    COALESCE(auth.uid()::text, 'system'),        -- p_user_id
    'Admin/Master',                               -- p_user_name
    'Admin/Master',                               -- p_role
    'system',                                     -- p_module
    'PRE_GOLIVE_TEST_DATA_RESET',                 -- p_action
    'success',                                    -- p_status
    'AUTHORIZED PRE-GO-LIVE TEST DATA RESET. ' ||
    'DELETED: 1 route (SANGAMNER 6, id=7cfe8d1e-fdf6-47f1-947d-aecd4c817e97), ' ||
    '1 picklist, 23 deliveries, 23 invoices, ' ||
    '62 payments, 85 party_financial_ledger, 72 inventory_movements (purchase_inward), ' ||
    '70 unmapped_sku_exceptions, 8 sap_purchase_imports, 720 sap_purchase_import_items. ' ||
    'PRESERVED: 72 products, 17647 historical_sales_products, 1197 parties, 2 workers, 5 profiles. ' ||
    'Executed at: ' || now()::text,               -- p_detail
    'system',                                     -- p_entity_type
    'pre-golive-reset-' || to_char(now(), 'YYYYMMDD-HH24MISS') -- p_entity_id
  );
END $$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- POST-COMMIT: FINAL COUNT VERIFICATION
-- (Outside transaction — read actual committed state)
-- ══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_routes            integer;
  v_picklists         integer;
  v_deliveries        integer;
  v_invoices          integer;
  v_payments          integer;
  v_ledger            integer;
  v_inv_movements     integer;
  v_sap_pur           integer;
  v_sap_pur_items     integer;
  v_products          integer;
  v_hist_sales        integer;
  v_parties           integer;
  v_workers           integer;
BEGIN
  SELECT COUNT(*) INTO v_routes FROM public.routes;
  SELECT COUNT(*) INTO v_picklists FROM public.picklists;
  SELECT COUNT(*) INTO v_deliveries FROM public.deliveries;
  SELECT COUNT(*) INTO v_invoices FROM public.invoices;
  SELECT COUNT(*) INTO v_payments FROM public.payments;
  SELECT COUNT(*) INTO v_ledger FROM public.party_financial_ledger;
  SELECT COUNT(*) INTO v_inv_movements FROM public.inventory_movements;
  SELECT COUNT(*) INTO v_sap_pur FROM public.sap_purchase_imports;
  SELECT COUNT(*) INTO v_sap_pur_items FROM public.sap_purchase_import_items;
  SELECT COUNT(*) INTO v_products FROM public.products;
  SELECT COUNT(*) INTO v_hist_sales FROM public.historical_sales_products;
  SELECT COUNT(*) INTO v_parties FROM public.parties;
  SELECT COUNT(*) INTO v_workers FROM public.workers;

  RAISE NOTICE '===== FINAL POST-RESET VERIFICATION =====';
  RAISE NOTICE 'routes:                  % (expected: 0)', v_routes;
  RAISE NOTICE 'picklists:               % (expected: 0)', v_picklists;
  RAISE NOTICE 'deliveries:              % (expected: 0)', v_deliveries;
  RAISE NOTICE 'invoices:                % (expected: 0)', v_invoices;
  RAISE NOTICE 'payments:                % (expected: 0)', v_payments;
  RAISE NOTICE 'party_financial_ledger:  % (expected: 0)', v_ledger;
  RAISE NOTICE 'inventory_movements:     % (expected: 0)', v_inv_movements;
  RAISE NOTICE 'sap_purchase_imports:    % (expected: 0)', v_sap_pur;
  RAISE NOTICE 'sap_purchase_items:      % (expected: 0)', v_sap_pur_items;
  RAISE NOTICE 'products:                % (expected: 72)', v_products;
  RAISE NOTICE 'historical_sales_products: % (expected: 17647)', v_hist_sales;
  RAISE NOTICE 'parties:                 % (expected: 1197)', v_parties;
  RAISE NOTICE 'workers:                 % (expected: 2)', v_workers;
END $$;

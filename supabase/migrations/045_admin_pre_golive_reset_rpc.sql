-- ============================================================================
-- Migration 045 v2: Admin Pre-Go-Live Reset RPC
-- DistroTrack v2 — Revised with explicit WHERE true clauses
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_pre_golive_reset(
  p_reason TEXT DEFAULT 'Authorized Pre-Go-Live Test Data Reset'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_pre_routes               integer := 0;
  v_pre_picklists            integer := 0;
  v_pre_deliveries           integer := 0;
  v_pre_delivery_items       integer := 0;
  v_pre_invoices             integer := 0;
  v_pre_payments             integer := 0;
  v_pre_ledger               integer := 0;
  v_pre_expenses             integer := 0;
  v_pre_inv_movements        integer := 0;
  v_pre_stock_exc            integer := 0;
  v_pre_unmapped_exc         integer := 0;
  v_pre_sap_pur_imports      integer := 0;
  v_pre_sap_pur_items        integer := 0;
  v_pre_sap_sal_imports      integer := 0;
  v_pre_sap_sal_items        integer := 0;
  v_pre_sap_rec              integer := 0;
  v_pre_sap_rec_items        integer := 0;
  v_pre_picklist_items       integer := 0;
  v_pre_picklist_load_items  integer := 0;

  v_products                 integer := 0;
  v_hist_sales               integer := 0;
  v_parties                  integer := 0;
  v_workers                  integer := 0;
  v_profiles                 integer := 0;

  v_post_routes              integer := 0;
  v_post_picklists           integer := 0;
  v_post_deliveries          integer := 0;
  v_post_invoices            integer := 0;
  v_post_payments            integer := 0;
  v_post_ledger              integer := 0;
  v_post_inv_movements       integer := 0;
  v_post_sap_pur_imports     integer := 0;
  v_post_sap_pur_items       integer := 0;
  v_post_parties_out         integer := 0;

  v_actor_id                 text;
  v_actor_role               text;
  v_phase                    text := 'init';
BEGIN
  -- ── AUTHORIZATION GATE ────────────────────────────────────────────────
  IF NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'ADMIN_PRE_GOLIVE_RESET: Unauthorized. Only Admin/Master may execute this operation.'
      USING ERRCODE = '42501';
  END IF;

  v_actor_id   := COALESCE(auth.uid()::text, 'system');
  v_actor_role := COALESCE(public.get_current_app_role(), 'unknown');

  -- ── PHASE 0: MASTER DATA SAFETY CHECK ───────────────────────────────────
  v_phase := 'master_data_check';
  SELECT COUNT(*) INTO v_products FROM public.products;
  SELECT COUNT(*) INTO v_hist_sales FROM public.historical_sales_products;
  SELECT COUNT(*) INTO v_parties FROM public.parties;
  SELECT COUNT(*) INTO v_workers FROM public.workers;
  SELECT COUNT(*) INTO v_profiles FROM public.profiles;

  IF v_products < 1 THEN
    RAISE EXCEPTION 'SAFETY ABORT: products table is empty.';
  END IF;
  IF v_parties < 1 THEN
    RAISE EXCEPTION 'SAFETY ABORT: parties table is empty.';
  END IF;

  -- ── PHASE 0b: SNAPSHOT TRANSACTIONAL DATA ───────────────────────────────
  v_phase := 'snapshot';
  SELECT COUNT(*) INTO v_pre_routes FROM public.routes;
  SELECT COUNT(*) INTO v_pre_picklists FROM public.picklists;
  SELECT COUNT(*) INTO v_pre_deliveries FROM public.deliveries;
  SELECT COUNT(*) INTO v_pre_delivery_items FROM public.delivery_items;
  SELECT COUNT(*) INTO v_pre_invoices FROM public.invoices;
  SELECT COUNT(*) INTO v_pre_payments FROM public.payments;
  SELECT COUNT(*) INTO v_pre_ledger FROM public.party_financial_ledger;
  SELECT COUNT(*) INTO v_pre_expenses FROM public.expenses;
  SELECT COUNT(*) INTO v_pre_inv_movements FROM public.inventory_movements;
  SELECT COUNT(*) INTO v_pre_stock_exc FROM public.route_stock_exceptions;
  SELECT COUNT(*) INTO v_pre_unmapped_exc FROM public.unmapped_sku_exceptions;
  SELECT COUNT(*) INTO v_pre_sap_pur_imports FROM public.sap_purchase_imports;
  SELECT COUNT(*) INTO v_pre_sap_pur_items FROM public.sap_purchase_import_items;
  SELECT COUNT(*) INTO v_pre_sap_sal_imports FROM public.sap_sales_imports;
  SELECT COUNT(*) INTO v_pre_sap_sal_items FROM public.sap_sales_import_items;
  SELECT COUNT(*) INTO v_pre_sap_rec FROM public.sap_stock_reconciliations;
  SELECT COUNT(*) INTO v_pre_sap_rec_items FROM public.sap_stock_reconciliation_items;
  SELECT COUNT(*) INTO v_pre_picklist_items FROM public.picklist_items;
  SELECT COUNT(*) INTO v_pre_picklist_load_items FROM public.picklist_load_items;

  -- ── ENABLE BYPASS FLAGS ────────────────────────────────────────────────
  -- transaction-local config (true = scoped to this transaction)
  PERFORM set_config('distrotrack.allow_admin_payment_delete', 'on', true);
  PERFORM set_config('distrotrack.allow_route_hard_delete', 'true', true);

  -- ══════════════════════════════════════════════════════════════════════
  -- PHASE 1: SAP IMPORT DATA (leaves first, FK-safe)
  -- ══════════════════════════════════════════════════════════════════════
  v_phase := 'sap_rec_items';
  DELETE FROM public.sap_stock_reconciliation_items WHERE id IS NOT NULL OR id IS NULL;

  v_phase := 'sap_rec';
  DELETE FROM public.sap_stock_reconciliations WHERE id IS NOT NULL OR id IS NULL;

  v_phase := 'sap_sales_items';
  DELETE FROM public.sap_sales_import_items WHERE id IS NOT NULL OR id IS NULL;

  v_phase := 'sap_sales_imports';
  DELETE FROM public.sap_sales_imports WHERE id IS NOT NULL OR id IS NULL;

  v_phase := 'sap_pur_items';
  DELETE FROM public.sap_purchase_import_items WHERE id IS NOT NULL OR id IS NULL;

  v_phase := 'sap_pur_imports';
  DELETE FROM public.sap_purchase_imports WHERE id IS NOT NULL OR id IS NULL;

  -- ══════════════════════════════════════════════════════════════════════
  -- PHASE 2: INVENTORY MOVEMENTS
  -- ══════════════════════════════════════════════════════════════════════
  v_phase := 'inventory_movements';
  DELETE FROM public.inventory_movements WHERE id IS NOT NULL OR id IS NULL;

  -- ══════════════════════════════════════════════════════════════════════
  -- PHASE 3: EXCEPTIONS
  -- ══════════════════════════════════════════════════════════════════════
  v_phase := 'route_stock_exceptions';
  DELETE FROM public.route_stock_exceptions WHERE id IS NOT NULL OR id IS NULL;

  v_phase := 'unmapped_sku_exceptions';
  DELETE FROM public.unmapped_sku_exceptions WHERE id IS NOT NULL OR id IS NULL;

  -- ══════════════════════════════════════════════════════════════════════
  -- PHASE 4: FINANCIAL LEDGER + PAYMENTS + EXPENSES
  -- ══════════════════════════════════════════════════════════════════════
  v_phase := 'party_financial_ledger';
  DELETE FROM public.party_financial_ledger WHERE id IS NOT NULL OR id IS NULL;

  v_phase := 'payments';
  DELETE FROM public.payments WHERE id IS NOT NULL OR id IS NULL;

  v_phase := 'expenses';
  DELETE FROM public.expenses WHERE id IS NOT NULL OR id IS NULL;

  -- ══════════════════════════════════════════════════════════════════════
  -- PHASE 5: DELIVERIES + DELIVERY ITEMS
  -- ══════════════════════════════════════════════════════════════════════
  v_phase := 'delivery_items';
  DELETE FROM public.delivery_items WHERE id IS NOT NULL OR id IS NULL;

  v_phase := 'deliveries';
  DELETE FROM public.deliveries WHERE id IS NOT NULL OR id IS NULL;

  -- ══════════════════════════════════════════════════════════════════════
  -- PHASE 6: INVOICES
  -- ══════════════════════════════════════════════════════════════════════
  v_phase := 'invoices';
  DELETE FROM public.invoices WHERE id IS NOT NULL OR id IS NULL;

  -- ══════════════════════════════════════════════════════════════════════
  -- PHASE 7: PICKLISTS
  -- ══════════════════════════════════════════════════════════════════════
  v_phase := 'picklist_load_items';
  DELETE FROM public.picklist_load_items WHERE id IS NOT NULL OR id IS NULL;

  v_phase := 'picklist_items';
  DELETE FROM public.picklist_items WHERE id IS NOT NULL OR id IS NULL;

  v_phase := 'picklists';
  DELETE FROM public.picklists WHERE id IS NOT NULL OR id IS NULL;

  -- ══════════════════════════════════════════════════════════════════════
  -- PHASE 8: PARTY ROUTE UNLINK + ROUTES
  -- NOTE: workers table has no current_route_id/current_picklist_id columns.
  --       Worker-route state is tracked in routes.assigned_worker_id only.
  --       Worker records themselves are preserved intact.
  -- ══════════════════════════════════════════════════════════════════════

  -- No worker column update needed — workers have no route-state columns.

  v_phase := 'party_route_unlink';
  UPDATE public.parties
  SET route_id   = NULL,
      updated_at = now()
  WHERE route_id IS NOT NULL;

  v_phase := 'party_outstanding_reset';
  UPDATE public.parties
  SET outstanding_amount = 0,
      updated_at         = now()
  WHERE outstanding_amount != 0;

  v_phase := 'routes';
  DELETE FROM public.routes WHERE id IS NOT NULL OR id IS NULL;

  -- ══════════════════════════════════════════════════════════════════════
  -- PHASE 9: POST-DELETION ASSERTIONS
  -- ══════════════════════════════════════════════════════════════════════
  v_phase := 'assertions';

  SELECT COUNT(*) INTO v_post_routes FROM public.routes;
  IF v_post_routes > 0 THEN RAISE EXCEPTION 'ASSERTION: routes still has % rows', v_post_routes; END IF;

  SELECT COUNT(*) INTO v_post_picklists FROM public.picklists;
  IF v_post_picklists > 0 THEN RAISE EXCEPTION 'ASSERTION: picklists still has % rows', v_post_picklists; END IF;

  SELECT COUNT(*) INTO v_post_deliveries FROM public.deliveries;
  IF v_post_deliveries > 0 THEN RAISE EXCEPTION 'ASSERTION: deliveries still has % rows', v_post_deliveries; END IF;

  SELECT COUNT(*) INTO v_post_invoices FROM public.invoices;
  IF v_post_invoices > 0 THEN RAISE EXCEPTION 'ASSERTION: invoices still has % rows', v_post_invoices; END IF;

  SELECT COUNT(*) INTO v_post_payments FROM public.payments;
  IF v_post_payments > 0 THEN RAISE EXCEPTION 'ASSERTION: payments still has % rows', v_post_payments; END IF;

  SELECT COUNT(*) INTO v_post_ledger FROM public.party_financial_ledger;
  IF v_post_ledger > 0 THEN RAISE EXCEPTION 'ASSERTION: party_financial_ledger still has % rows', v_post_ledger; END IF;

  SELECT COUNT(*) INTO v_post_inv_movements FROM public.inventory_movements;
  IF v_post_inv_movements > 0 THEN RAISE EXCEPTION 'ASSERTION: inventory_movements still has % rows', v_post_inv_movements; END IF;

  SELECT COUNT(*) INTO v_post_sap_pur_imports FROM public.sap_purchase_imports;
  IF v_post_sap_pur_imports > 0 THEN RAISE EXCEPTION 'ASSERTION: sap_purchase_imports still has % rows', v_post_sap_pur_imports; END IF;

  SELECT COUNT(*) INTO v_post_sap_pur_items FROM public.sap_purchase_import_items;
  IF v_post_sap_pur_items > 0 THEN RAISE EXCEPTION 'ASSERTION: sap_purchase_import_items still has % rows', v_post_sap_pur_items; END IF;

  SELECT COUNT(*) INTO v_post_parties_out FROM public.parties WHERE outstanding_amount != 0;
  IF v_post_parties_out > 0 THEN RAISE EXCEPTION 'ASSERTION: parties still has % rows with non-zero outstanding_amount', v_post_parties_out; END IF;

  -- Verify master data preserved
  SELECT COUNT(*) INTO v_products FROM public.products;
  IF v_products < 1 THEN RAISE EXCEPTION 'CRITICAL: products was deleted!'; END IF;

  SELECT COUNT(*) INTO v_hist_sales FROM public.historical_sales_products;
  IF v_hist_sales < 1 THEN RAISE EXCEPTION 'CRITICAL: historical_sales_products was deleted!'; END IF;

  SELECT COUNT(*) INTO v_parties FROM public.parties;
  IF v_parties < 1 THEN RAISE EXCEPTION 'CRITICAL: parties was deleted!'; END IF;

  SELECT COUNT(*) INTO v_workers FROM public.workers;
  IF v_workers < 1 THEN RAISE EXCEPTION 'CRITICAL: workers was deleted!'; END IF;

  SELECT COUNT(*) INTO v_profiles FROM public.profiles;
  IF v_profiles < 1 THEN RAISE EXCEPTION 'CRITICAL: profiles was deleted!'; END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- PHASE 10: AUDIT EVENT
  -- ══════════════════════════════════════════════════════════════════════
  v_phase := 'audit';
  BEGIN
    PERFORM public.log_system_event(
      v_actor_id,
      'Admin/Master',
      v_actor_role,
      'system',
      'PRE_GOLIVE_TEST_DATA_RESET',
      'success',
      'AUTHORIZED PRE-GO-LIVE TEST DATA RESET. ' ||
      'Reason: ' || COALESCE(p_reason, 'None given') || '. ' ||
      'DELETED: ' || v_pre_routes || ' routes, ' ||
      v_pre_picklists || ' picklists, ' ||
      v_pre_deliveries || ' deliveries, ' ||
      v_pre_invoices || ' invoices, ' ||
      v_pre_payments || ' payments, ' ||
      v_pre_ledger || ' ledger_entries, ' ||
      v_pre_inv_movements || ' inv_movements, ' ||
      v_pre_sap_pur_imports || ' sap_purchase_imports, ' ||
      v_pre_sap_pur_items || ' sap_purchase_items. ' ||
      'PRESERVED: ' || v_products || ' products, ' ||
      v_hist_sales || ' historical_sales_products, ' ||
      v_parties || ' parties, ' ||
      v_workers || ' workers, ' ||
      v_profiles || ' profiles.',
      'system',
      'pre-golive-reset-' || to_char(now(), 'YYYYMMDD-HH24MISS')
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Audit log failed (non-blocking): %', SQLERRM;
  END;

  -- ── RETURN RESULT ──────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'success', true,
    'message', 'PRE-GO-LIVE CLEANUP COMPLETE',
    'executed_by', v_actor_id,
    'executed_as', v_actor_role,
    'executed_at', now(),
    'deleted', jsonb_build_object(
      'routes', v_pre_routes,
      'picklists', v_pre_picklists,
      'picklist_items', v_pre_picklist_items,
      'picklist_load_items', v_pre_picklist_load_items,
      'deliveries', v_pre_deliveries,
      'delivery_items', v_pre_delivery_items,
      'invoices', v_pre_invoices,
      'payments', v_pre_payments,
      'party_financial_ledger', v_pre_ledger,
      'expenses', v_pre_expenses,
      'inventory_movements', v_pre_inv_movements,
      'route_stock_exceptions', v_pre_stock_exc,
      'unmapped_sku_exceptions', v_pre_unmapped_exc,
      'sap_purchase_imports', v_pre_sap_pur_imports,
      'sap_purchase_import_items', v_pre_sap_pur_items,
      'sap_sales_imports', v_pre_sap_sal_imports,
      'sap_sales_import_items', v_pre_sap_sal_items,
      'sap_stock_reconciliations', v_pre_sap_rec,
      'sap_stock_reconciliation_items', v_pre_sap_rec_items
    ),
    'preserved', jsonb_build_object(
      'products', v_products,
      'historical_sales_products', v_hist_sales,
      'parties', v_parties,
      'workers', v_workers,
      'profiles', v_profiles
    ),
    'post_reset', jsonb_build_object(
      'routes', v_post_routes,
      'picklists', v_post_picklists,
      'deliveries', v_post_deliveries,
      'invoices', v_post_invoices,
      'payments', v_post_payments,
      'party_financial_ledger', v_post_ledger,
      'inventory_movements', v_post_inv_movements,
      'sap_purchase_imports', v_post_sap_pur_imports,
      'sap_purchase_import_items', v_post_sap_pur_items
    )
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'admin_pre_golive_reset FAILED at phase [%] — rolled back. Error: %', v_phase, SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_pre_golive_reset(TEXT) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_pre_golive_reset(TEXT) FROM anon, PUBLIC;

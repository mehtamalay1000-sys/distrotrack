BEGIN;

-- 1. Temporarily disable no-delete and append-only guard triggers for cleanup
ALTER TABLE public.expenses DISABLE TRIGGER trg_expenses_no_delete;
ALTER TABLE public.payments DISABLE TRIGGER trg_payments_no_delete;
ALTER TABLE public.party_financial_ledger DISABLE TRIGGER trg_party_financial_ledger_immutable;

-- 2. Remove test party financial ledger entries
DELETE FROM public.party_financial_ledger;

-- 3. Remove test payments
DELETE FROM public.payments;

-- 4. Remove test expenses
DELETE FROM public.expenses;

-- 5. Remove test delivery items and deliveries
DELETE FROM public.delivery_items;
DELETE FROM public.deliveries;

-- 6. Remove test picklist items, parties junction, and picklists
DELETE FROM public.picklist_items;
DELETE FROM public.picklist_parties;
DELETE FROM public.picklists;

-- 7. Remove test routes
DELETE FROM public.routes WHERE code = 'STG8C_TEST_RT';

-- 8. Reset party outstanding balances modified by test runs back to 0
UPDATE public.parties SET outstanding_amount = 0 WHERE outstanding_amount != 0;

-- 9. Re-enable all guard triggers
ALTER TABLE public.expenses ENABLE TRIGGER trg_expenses_no_delete;
ALTER TABLE public.payments ENABLE TRIGGER trg_payments_no_delete;
ALTER TABLE public.party_financial_ledger ENABLE TRIGGER trg_party_financial_ledger_immutable;

COMMIT;

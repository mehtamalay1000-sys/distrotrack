-- ==============================================================================
-- Migration 028: Route Deletion Protection, Operational History Guard & Archival
-- ==============================================================================
-- Fixes critical data-integrity bug where route deletion wiped or unlinked
-- authoritative historical stock ledger records (inventory_movements), picklists,
-- deliveries, payments, and financial ledgers.
-- ==============================================================================

-- 1. Update routes_status_check to support 'archived' status
ALTER TABLE public.routes DROP CONSTRAINT IF EXISTS routes_status_check;
ALTER TABLE public.routes ADD CONSTRAINT routes_status_check 
  CHECK (status IN ('active', 'inactive', 'completed', 'archived'));

-- 2. Update routes.code uniqueness to allow reusing code for new routes if previous is archived
ALTER TABLE public.routes DROP CONSTRAINT IF EXISTS routes_code_key;
DROP INDEX IF EXISTS public.idx_routes_active_code;
CREATE UNIQUE INDEX idx_routes_active_code ON public.routes(code) WHERE status != 'archived';

-- 3. Update Foreign Key constraints on operational/ledger tables to ON DELETE RESTRICT
-- This ensures the DB engine itself structurally blocks any deletion of a route with history.

-- inventory_movements -> routes
ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_route_id_fkey;
ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_route_id_fkey 
  FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE RESTRICT;

-- picklists -> routes
ALTER TABLE public.picklists DROP CONSTRAINT IF EXISTS picklists_route_id_fkey;
ALTER TABLE public.picklists ADD CONSTRAINT picklists_route_id_fkey 
  FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE RESTRICT;

-- expenses -> routes
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_route_id_fkey;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_route_id_fkey 
  FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE RESTRICT;

-- payments -> routes
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_route_id_fkey;
ALTER TABLE public.payments ADD CONSTRAINT payments_route_id_fkey 
  FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE RESTRICT;

-- party_financial_ledger -> routes
ALTER TABLE public.party_financial_ledger DROP CONSTRAINT IF EXISTS party_financial_ledger_route_id_fkey;
ALTER TABLE public.party_financial_ledger ADD CONSTRAINT party_financial_ledger_route_id_fkey 
  FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE RESTRICT;

-- route_stock_exceptions -> routes
ALTER TABLE public.route_stock_exceptions DROP CONSTRAINT IF EXISTS route_stock_exceptions_route_id_fkey;
ALTER TABLE public.route_stock_exceptions ADD CONSTRAINT route_stock_exceptions_route_id_fkey 
  FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE RESTRICT;

-- 4. Server-Side Trigger to Enforce Clear Operational History Guard
CREATE OR REPLACE FUNCTION public.check_route_deletion_allowed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_history_count bigint := 0;
  v_count bigint := 0;
BEGIN
  -- 1. Check picklists
  SELECT COUNT(*) INTO v_count FROM public.picklists WHERE route_id = OLD.id;
  IF v_count > 0 THEN
    v_history_count := v_history_count + v_count;
  END IF;

  -- 2. Check deliveries (via picklists on this route)
  SELECT COUNT(*) INTO v_count 
  FROM public.deliveries d 
  JOIN public.picklists pl ON d.picklist_id = pl.id 
  WHERE pl.route_id = OLD.id;
  IF v_count > 0 THEN
    v_history_count := v_history_count + v_count;
  END IF;

  -- 3. Check inventory movements (either direct route_id or picklist on this route)
  SELECT COUNT(*) INTO v_count 
  FROM public.inventory_movements im
  WHERE im.route_id = OLD.id 
     OR (im.picklist_id IS NOT NULL AND im.picklist_id IN (SELECT id FROM public.picklists WHERE route_id = OLD.id));
  IF v_count > 0 THEN
    v_history_count := v_history_count + v_count;
  END IF;

  -- 4. Check payments linked to this route
  SELECT COUNT(*) INTO v_count FROM public.payments WHERE route_id = OLD.id;
  IF v_count > 0 THEN
    v_history_count := v_history_count + v_count;
  END IF;

  -- 5. Check expenses linked to this route
  SELECT COUNT(*) INTO v_count FROM public.expenses WHERE route_id = OLD.id;
  IF v_count > 0 THEN
    v_history_count := v_history_count + v_count;
  END IF;

  -- 6. Check route_stock_exceptions linked to this route
  SELECT COUNT(*) INTO v_count FROM public.route_stock_exceptions WHERE route_id = OLD.id;
  IF v_count > 0 THEN
    v_history_count := v_history_count + v_count;
  END IF;

  -- 7. Check party_financial_ledger linked to this route
  SELECT COUNT(*) INTO v_count FROM public.party_financial_ledger WHERE route_id = OLD.id;
  IF v_count > 0 THEN
    v_history_count := v_history_count + v_count;
  END IF;

  IF v_history_count > 0 THEN
    RAISE EXCEPTION 'This route contains operational history and cannot be permanently deleted. Archive it instead.'
      USING ERRCODE = '23503';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_used_route_deletion ON public.routes;
CREATE TRIGGER trg_prevent_used_route_deletion
  BEFORE DELETE ON public.routes
  FOR EACH ROW
  EXECUTE FUNCTION public.check_route_deletion_allowed();

-- 5. Stored Procedures (RPCs) for Route Archival, Unarchival, and Deletion

-- 5a. Archive Route RPC
CREATE OR REPLACE FUNCTION public.archive_route(p_route_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_route record;
BEGIN
  IF NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Unauthorized: Only Admin or Master can archive routes.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_route FROM public.routes WHERE id = p_route_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Route with ID % not found', p_route_id
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.routes
  SET status = 'archived',
      updated_at = now()
  WHERE id = p_route_id;

  -- Audit log if table exists
  BEGIN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      entity_type,
      entity_id,
      details,
      created_at
    ) VALUES (
      auth.uid(),
      'ARCHIVE_ROUTE',
      'routes',
      p_route_id,
      jsonb_build_object(
        'name', v_route.name,
        'code', v_route.code,
        'previous_status', v_route.status
      ),
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    -- Keep non-blocking if audit_logs schema differs
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'route_id', p_route_id,
    'status', 'archived',
    'message', 'Route archived successfully. Historical records preserved.'
  );
END;
$$;

-- 5b. Unarchive Route RPC
CREATE OR REPLACE FUNCTION public.unarchive_route(p_route_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_route record;
BEGIN
  IF NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Unauthorized: Only Admin or Master can unarchive routes.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_route FROM public.routes WHERE id = p_route_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Route with ID % not found', p_route_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Check if another non-archived route already uses this code
  IF EXISTS (SELECT 1 FROM public.routes WHERE code = v_route.code AND status != 'archived' AND id != p_route_id) THEN
    RAISE EXCEPTION 'Cannot unarchive route: Another active route already exists with code "%"', v_route.code
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.routes
  SET status = 'active',
      updated_at = now()
  WHERE id = p_route_id;

  RETURN jsonb_build_object(
    'success', true,
    'route_id', p_route_id,
    'status', 'active',
    'message', 'Route unarchived successfully.'
  );
END;
$$;

-- 5c. Delete Route RPC (Enforces authorization and trigger rules)
CREATE OR REPLACE FUNCTION public.delete_route(p_route_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_route record;
BEGIN
  IF NOT public.is_current_user_admin_or_master() THEN
    RAISE EXCEPTION 'Unauthorized: Only Admin or Master can delete routes.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_route FROM public.routes WHERE id = p_route_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Route with ID % not found', p_route_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Executing DELETE will trigger check_route_deletion_allowed()
  DELETE FROM public.routes WHERE id = p_route_id;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_route_id', p_route_id,
    'message', 'Unused route permanently deleted.'
  );
END;
$$;

-- Grant permissions on functions
GRANT EXECUTE ON FUNCTION public.archive_route(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unarchive_route(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_route(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_route_deletion_allowed() TO authenticated;

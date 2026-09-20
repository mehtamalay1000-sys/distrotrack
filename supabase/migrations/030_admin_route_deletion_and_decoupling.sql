-- ================================================================
-- Migration 030: Admin Route Deletion with Record Preservation
-- ================================================================
-- Allows Admin/Master to permanently delete a route definition
-- while strictly preserving all inventory movements, picklists,
-- deliveries, payments, expenses, and parties by unlinking route_id (SET NULL).
-- ================================================================

CREATE OR REPLACE FUNCTION public.delete_route(
  p_route_id uuid,
  p_force boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_route record;
  v_mov_count integer := 0;
  v_pl_count integer := 0;
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

  -- Count existing references for audit
  SELECT COUNT(*) INTO v_mov_count FROM public.inventory_movements WHERE route_id = p_route_id;
  SELECT COUNT(*) INTO v_pl_count FROM public.picklists WHERE route_id = p_route_id;

  -- Decouple foreign keys to NULL before deleting to guarantee
  -- that NO inventory movements, picklists, or financial records are ever deleted.
  UPDATE public.inventory_movements SET route_id = NULL WHERE route_id = p_route_id;
  UPDATE public.picklists SET route_id = NULL WHERE route_id = p_route_id;
  UPDATE public.deliveries SET route_id = NULL WHERE route_id = p_route_id;
  UPDATE public.payments SET route_id = NULL WHERE route_id = p_route_id;
  UPDATE public.expenses SET route_id = NULL WHERE route_id = p_route_id;
  UPDATE public.parties SET route_id = NULL WHERE route_id = p_route_id;
  UPDATE public.party_financial_ledger SET route_id = NULL WHERE route_id = p_route_id;
  UPDATE public.route_stock_exceptions SET route_id = NULL WHERE route_id = p_route_id;

  -- Delete the route record
  DELETE FROM public.routes WHERE id = p_route_id;

  -- Audit log
  BEGIN
    PERFORM public.log_system_event(
      auth.uid()::text,
      'Admin',
      'route',
      'route_deleted',
      'warning',
      'Route ' || v_route.code || ' (' || v_route.name || ') deleted. ' || v_mov_count || ' movements and ' || v_pl_count || ' picklists preserved.',
      'route',
      p_route_id::text
    );
  EXCEPTION WHEN OTHERS THEN
    -- Non-blocking audit log
  END;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_route_id', p_route_id,
    'preserved_movements', v_mov_count,
    'preserved_picklists', v_pl_count,
    'message', 'Route permanently deleted. All historical records preserved.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_route(uuid, boolean) TO authenticated, service_role;

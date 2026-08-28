-- ================================================================
-- DistroTrack Master Access Setup
-- Run this ONCE in your Supabase SQL Editor.
-- This file is NOT executed automatically; it is a manual migration.
-- ================================================================

-- ── 0. Extensions ────────────────────────────────────────────────
-- pgcrypto gives us crypt() for bcrypt hashing.
-- In Supabase, extensions are typically installed in the 'extensions' schema.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── 1. master_config  ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS master_config (
  id          integer PRIMARY KEY DEFAULT 1,
  master_pin  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Enable RLS and deny direct table access to client
ALTER TABLE master_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all direct access" ON master_config;
CREATE POLICY "Deny all direct access"
  ON master_config
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- Insert the hashed master PIN (9129).
-- Using extensions.crypt and extensions.gen_salt with fallback to public schema.
DO $$
BEGIN
  INSERT INTO master_config (id, master_pin)
  VALUES (1, extensions.crypt('9129', extensions.gen_salt('bf', 10)))
  ON CONFLICT (id) DO UPDATE
    SET master_pin = extensions.crypt('9129', extensions.gen_salt('bf', 10));
EXCEPTION WHEN OTHERS THEN
  -- Fallback if pgcrypto is in public schema
  INSERT INTO master_config (id, master_pin)
  VALUES (1, crypt('9129', gen_salt('bf', 10)))
  ON CONFLICT (id) DO UPDATE
    SET master_pin = crypt('9129', gen_salt('bf', 10));
END $$;


-- ── 2. master_audit_log  ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS master_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  user_id     text,
  user_name   text,
  role        text,
  module      text NOT NULL,
  action      text NOT NULL,
  status      text NOT NULL DEFAULT 'success',
  detail      text,
  ip_hint     text
);

CREATE INDEX IF NOT EXISTS idx_audit_log_occurred ON master_audit_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON master_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_module ON master_audit_log(module);

ALTER TABLE master_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated insert" ON master_audit_log;
DROP POLICY IF EXISTS "Allow all reads for authenticated" ON master_audit_log;
DROP POLICY IF EXISTS "Allow anon insert" ON master_audit_log;
DROP POLICY IF EXISTS "Allow anon select" ON master_audit_log;

CREATE POLICY "Allow authenticated insert" ON master_audit_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow all reads for authenticated" ON master_audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow anon insert" ON master_audit_log FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon select" ON master_audit_log FOR SELECT TO anon USING (true);


-- ── 3. log_system_event RPC  ──────────────────────────────────────
CREATE OR REPLACE FUNCTION log_system_event(
  p_user_id   text,
  p_user_name text,
  p_role      text,
  p_module    text,
  p_action    text,
  p_status    text DEFAULT 'success',
  p_detail    text DEFAULT null
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO master_audit_log (user_id, user_name, role, module, action, status, detail)
  VALUES (p_user_id, p_user_name, p_role, p_module, p_action, p_status, p_detail);
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

REVOKE ALL ON FUNCTION log_system_event(text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_system_event(text, text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION log_system_event(text, text, text, text, text, text, text) TO authenticated;


-- ── 4. check_master_pin RPC  ──────────────────────────────────────
-- Checks if the provided PIN matches the hashed master PIN (9129).
-- Uses search_path = public, extensions so crypt() is always found.
CREATE OR REPLACE FUNCTION check_master_pin(p_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash text;
  v_match boolean;
BEGIN
  SELECT master_pin INTO v_hash FROM master_config WHERE id = 1 LIMIT 1;
  IF NOT FOUND OR v_hash IS NULL THEN
    RETURN false;
  END IF;

  -- Test bcrypt hash match
  BEGIN
    v_match := (extensions.crypt(p_pin, v_hash) = v_hash);
  EXCEPTION WHEN OTHERS THEN
    v_match := (crypt(p_pin, v_hash) = v_hash);
  END;

  RETURN COALESCE(v_match, false);
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION check_master_pin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_master_pin(text) TO anon;
GRANT EXECUTE ON FUNCTION check_master_pin(text) TO authenticated;


-- ── 5. verify_admin_pin RPC (Alternative Unified RPC) ──────────────
CREATE OR REPLACE FUNCTION verify_admin_pin(
  p_user_id uuid,
  p_pin     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_stored_pin  text;
  v_name        text;
  v_status      text;
  v_master_hash text;
  v_is_master   boolean := false;
BEGIN
  -- 1. Fetch admin record
  SELECT pin, name, status
    INTO v_stored_pin, v_name, v_status
    FROM pin_users
   WHERE id = p_user_id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('role', null, 'error', 'User not found.');
  END IF;

  IF v_status <> 'active' THEN
    RETURN jsonb_build_object('role', null, 'error', 'Account is inactive.');
  END IF;

  -- 2. Check normal admin PIN
  IF TRIM(v_stored_pin) = TRIM(p_pin) THEN
    RETURN jsonb_build_object('role', 'owner', 'error', null, 'name', v_name);
  END IF;

  -- 3. Check master PIN
  SELECT master_pin INTO v_master_hash FROM master_config WHERE id = 1 LIMIT 1;
  IF FOUND AND v_master_hash IS NOT NULL THEN
    BEGIN
      v_is_master := (extensions.crypt(p_pin, v_master_hash) = v_master_hash);
    EXCEPTION WHEN OTHERS THEN
      v_is_master := (crypt(p_pin, v_master_hash) = v_master_hash);
    END;

    IF v_is_master = true THEN
      RETURN jsonb_build_object('role', 'master', 'error', null, 'name', v_name);
    END IF;
  END IF;

  -- 4. Neither matched
  RETURN jsonb_build_object('role', null, 'error', 'Incorrect PIN. Please try again.');
END;
$$;

REVOKE ALL ON FUNCTION verify_admin_pin(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_admin_pin(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION verify_admin_pin(uuid, text) TO authenticated;

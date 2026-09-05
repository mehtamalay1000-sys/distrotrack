-- ================================================================
-- Migration 006: Create set_master_pin Function
-- ================================================================
-- Allows securely updating the hashed master PIN stored in master_config.
-- Can be run via Supabase SQL Editor:
--   SELECT set_master_pin('your_new_pin_here');
-- ================================================================

-- ── Ensure pgcrypto extension exists ─────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── Ensure master_config table exists with single-row constraint ──
CREATE TABLE IF NOT EXISTS master_config (
  id          integer PRIMARY KEY DEFAULT 1,
  master_pin  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

ALTER TABLE master_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all direct access" ON master_config;
CREATE POLICY "Deny all direct access"
  ON master_config
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- ── Create or Replace set_master_pin Function ────────────────────
CREATE OR REPLACE FUNCTION set_master_pin(p_pin text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_clean text;
BEGIN
  v_clean := TRIM(p_pin);
  IF v_clean IS NULL OR length(v_clean) < 4 THEN
    RAISE EXCEPTION 'Master PIN must be at least 4 digits/characters';
  END IF;

  BEGIN
    INSERT INTO master_config (id, master_pin, created_at)
    VALUES (1, extensions.crypt(v_clean, extensions.gen_salt('bf', 10)), now())
    ON CONFLICT (id) DO UPDATE
      SET master_pin = extensions.crypt(v_clean, extensions.gen_salt('bf', 10)),
          created_at = now();
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO master_config (id, master_pin, created_at)
    VALUES (1, crypt(v_clean, gen_salt('bf', 10)), now())
    ON CONFLICT (id) DO UPDATE
      SET master_pin = crypt(v_clean, gen_salt('bf', 10)),
          created_at = now();
  END;

  RETURN 'Master PIN updated successfully';
END;
$$;

-- Security: Revoke execute from anon & public to prevent unauthenticated users
-- from changing the master PIN over the client API.
-- (Allowed for postgres superuser in SQL editor & authenticated administrators)
REVOKE ALL ON FUNCTION set_master_pin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_master_pin(text) FROM anon;
GRANT EXECUTE ON FUNCTION set_master_pin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION set_master_pin(text) TO service_role;

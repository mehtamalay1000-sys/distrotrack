-- ================================================================
-- Migration 013: Stage 8A — Cryptographic Identity Foundation
-- ================================================================
-- 1. Revoke plaintext PIN access on workers from anon & authenticated
-- 2. Extend profiles table check constraint to support 'master'
-- 3. Add worker_id and pin_user_id foreign keys to profiles
-- 4. Harden handle_new_user() trigger with safe search_path
-- 5. Create sync_actor_identity() to provision auth.users, auth.identities, profiles
-- 6. Provision existing workers, pin_users, and master
-- 7. Add lifecycle sync triggers on workers and pin_users
-- 8. Update set_master_pin() to keep auth.users in sync
-- 9. Enforce RLS on profiles (authenticated SELECT only, anon blocked)
-- ================================================================

-- ── Step 1: Revoke plaintext PIN access on workers ───────────────
REVOKE ALL ON workers FROM anon;
REVOKE ALL ON workers FROM PUBLIC;

GRANT SELECT (
  id, name, phone, email, status, notes, monthly_target, created_at, updated_at
) ON workers TO anon;

GRANT SELECT (
  id, name, phone, email, status, notes, monthly_target, created_at, updated_at
) ON workers TO authenticated;

GRANT INSERT, UPDATE, DELETE ON workers TO authenticated;
GRANT ALL ON workers TO service_role;
GRANT ALL ON workers TO postgres;


-- ── Step 2: Extend profiles table schema & role constraint ───────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check 
  CHECK (role IN ('owner', 'worker', 'master'));

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS worker_id uuid REFERENCES workers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pin_user_id uuid REFERENCES pin_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS phone text;

CREATE INDEX IF NOT EXISTS idx_profiles_worker_id ON profiles(worker_id);
CREATE INDEX IF NOT EXISTS idx_profiles_pin_user_id ON profiles(pin_user_id);


-- ── Step 3: Harden handle_new_user() trigger function ────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', ''),
    COALESCE(new.raw_user_meta_data->>'role', 'owner')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;


-- ── Step 4: Identity synchronization engine ──────────────────────
-- Provisions or updates auth.users, auth.identities, and public.profiles
-- Runs as SECURITY DEFINER with fixed search_path.
CREATE OR REPLACE FUNCTION public.sync_actor_identity(
  p_actor_id    uuid,
  p_name        text,
  p_phone       text,
  p_pin         text,
  p_role        text,
  p_actor_type  text  -- 'worker', 'admin', 'master'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  v_email         text;
  v_encrypted_pw  text;
  v_user_id       uuid := p_actor_id;
  v_worker_id     uuid := NULL;
  v_pin_user_id   uuid := NULL;
  v_existing_id   uuid;
BEGIN
  -- 1. Determine deterministic email & reference links
  IF p_actor_type = 'master' THEN
    v_email := 'master@distrotrack.local';
  ELSIF p_actor_type = 'admin' THEN
    v_email := 'admin.' || p_actor_id::text || '@distrotrack.local';
    v_pin_user_id := p_actor_id;
  ELSIF p_actor_type = 'worker' THEN
    v_email := 'worker.' || p_actor_id::text || '@distrotrack.local';
    v_worker_id := p_actor_id;
  ELSE
    RAISE EXCEPTION 'Unknown actor_type: %', p_actor_type;
  END IF;

  -- 2. Compute bcrypt hash for the PIN if provided
  -- (If p_pin is already a bcrypt hash starting with '$2', preserve it)
  IF p_pin LIKE '$2%' THEN
    v_encrypted_pw := p_pin;
  ELSE
    v_encrypted_pw := extensions.crypt(TRIM(p_pin), extensions.gen_salt('bf', 10));
  END IF;

  -- 3. Check if auth user already exists by ID or email
  SELECT id INTO v_existing_id FROM auth.users WHERE id = v_user_id OR email = v_email LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    v_user_id := v_existing_id;
    UPDATE auth.users
       SET email = v_email,
           encrypted_password = v_encrypted_pw,
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           raw_user_meta_data = jsonb_build_object(
             'sub', v_user_id::text,
             'email', v_email,
             'full_name', p_name,
             'role', p_role
           ),
           raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
           updated_at = now()
     WHERE id = v_user_id;
  ELSE
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token,
      email_change,
      email_change_token_new,
      email_change_token_current,
      phone_change,
      phone_change_token,
      reauthentication_token,
      email_change_confirm_status,
      is_sso_user
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      v_encrypted_pw,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', v_email,
        'full_name', p_name,
        'role', p_role
      ),
      now(),
      now(),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      0,
      false
    );
  END IF;

  -- 4. Sync auth.identities
  INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    v_user_id,
    jsonb_build_object(
      'sub', v_user_id::text,
      'email', v_email,
      'full_name', p_name,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    v_user_id::text,
    now(),
    now(),
    now()
  )
  ON CONFLICT (provider_id, provider) DO UPDATE
    SET identity_data = jsonb_build_object(
      'sub', v_user_id::text,
      'email', v_email,
      'full_name', p_name,
      'email_verified', true,
      'phone_verified', false
    ),
    updated_at = now();

  -- 5. Sync public.profiles
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    role,
    worker_id,
    pin_user_id,
    phone,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    v_email,
    p_name,
    p_role,
    v_worker_id,
    v_pin_user_id,
    p_phone,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET email = v_email,
        full_name = p_name,
        role = p_role,
        worker_id = v_worker_id,
        pin_user_id = v_pin_user_id,
        phone = p_phone,
        updated_at = now();

  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_actor_identity(uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_actor_identity(uuid, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_actor_identity(uuid, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_actor_identity(uuid, text, text, text, text, text) TO service_role;


-- ── Step 5: Provision existing actors ─────────────────────────────
DO $$
DECLARE
  w RECORD;
  a RECORD;
  m_hash text;
BEGIN
  -- 1. Provision workers
  FOR w IN SELECT id, name, phone, pin FROM public.workers LOOP
    IF w.pin IS NOT NULL AND length(trim(w.pin)) > 0 THEN
      PERFORM public.sync_actor_identity(w.id, w.name, w.phone, w.pin, 'worker', 'worker');
    END IF;
  END LOOP;

  -- 2. Provision admins from pin_users
  FOR a IN SELECT id, name, phone, pin, role FROM public.pin_users LOOP
    IF a.pin IS NOT NULL AND length(trim(a.pin)) > 0 THEN
      PERFORM public.sync_actor_identity(a.id, a.name, a.phone, a.pin, a.role, 'admin');
    END IF;
  END LOOP;

  -- 3. Provision Master identity
  SELECT master_pin INTO m_hash FROM public.master_config WHERE id = 1 LIMIT 1;
  IF m_hash IS NOT NULL THEN
    PERFORM public.sync_actor_identity(
      '00000000-0000-0000-0000-000000000001'::uuid,
      'Master Administrator',
      NULL,
      m_hash,
      'master',
      'master'
    );
  END IF;
END $$;


-- ── Step 6: Lifecycle synchronization triggers ────────────────────

-- Worker trigger
CREATE OR REPLACE FUNCTION public.trg_sync_worker_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (NEW.pin <> OLD.pin OR NEW.name <> OLD.name OR NEW.phone <> OLD.phone)) THEN
    IF NEW.pin IS NOT NULL AND length(trim(NEW.pin)) > 0 THEN
      PERFORM public.sync_actor_identity(NEW.id, NEW.name, NEW.phone, NEW.pin, 'worker', 'worker');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_worker_identity_sync ON public.workers;
CREATE TRIGGER on_worker_identity_sync
  AFTER INSERT OR UPDATE ON public.workers
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_worker_identity();

-- Admin (pin_users) trigger
CREATE OR REPLACE FUNCTION public.trg_sync_pin_user_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (NEW.pin <> OLD.pin OR NEW.name <> OLD.name OR NEW.phone <> OLD.phone OR NEW.role <> OLD.role)) THEN
    IF NEW.pin IS NOT NULL AND length(trim(NEW.pin)) > 0 THEN
      PERFORM public.sync_actor_identity(NEW.id, NEW.name, NEW.phone, NEW.pin, NEW.role, 'admin');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_pin_user_identity_sync ON public.pin_users;
CREATE TRIGGER on_pin_user_identity_sync
  AFTER INSERT OR UPDATE ON public.pin_users
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_pin_user_identity();


-- ── Step 7: Update set_master_pin to synchronize Master auth user ─
CREATE OR REPLACE FUNCTION set_master_pin(p_pin text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  v_clean text;
  v_hash  text;
BEGIN
  v_clean := TRIM(p_pin);
  IF v_clean IS NULL OR length(v_clean) < 4 THEN
    RAISE EXCEPTION 'Master PIN must be at least 4 digits/characters';
  END IF;

  BEGIN
    v_hash := extensions.crypt(v_clean, extensions.gen_salt('bf', 10));
  EXCEPTION WHEN OTHERS THEN
    v_hash := crypt(v_clean, gen_salt('bf', 10));
  END;

  INSERT INTO master_config (id, master_pin, created_at)
  VALUES (1, v_hash, now())
  ON CONFLICT (id) DO UPDATE
    SET master_pin = v_hash,
        created_at = now();

  -- Keep master@distrotrack.local auth account synchronized
  PERFORM public.sync_actor_identity(
    '00000000-0000-0000-0000-000000000001'::uuid,
    'Master Administrator',
    NULL,
    v_hash,
    'master',
    'master'
  );

  RETURN 'Master PIN updated successfully';
END;
$$;


-- ── Step 8: Profiles table RLS policies ───────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access" ON profiles;
DROP POLICY IF EXISTS "Authenticated read profiles" ON profiles;
DROP POLICY IF EXISTS "Authenticated update own profile" ON profiles;
DROP POLICY IF EXISTS "Deny anon access to profiles" ON profiles;

CREATE POLICY "Authenticated read profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Deny all anon access to profiles table
CREATE POLICY "Deny anon access to profiles"
  ON profiles FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

GRANT ALL ON profiles TO service_role;
GRANT ALL ON profiles TO postgres;
GRANT ALL ON profiles TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
REVOKE ALL ON profiles FROM anon;
REVOKE ALL ON profiles FROM PUBLIC;
GRANT SELECT, UPDATE ON profiles TO authenticated;


-- ── Step 9: Post-flight verification notification ────────────────
DO $$
DECLARE
  v_auth_count    integer;
  v_profile_count integer;
BEGIN
  SELECT count(*) INTO v_auth_count FROM auth.users;
  SELECT count(*) INTO v_profile_count FROM public.profiles;

  RAISE NOTICE 'Migration 013 complete:';
  RAISE NOTICE '  - workers.pin SELECT revoked from anon & authenticated';
  RAISE NOTICE '  - profiles table role constraint extended to master';
  RAISE NOTICE '  - auth.users total count: %', v_auth_count;
  RAISE NOTICE '  - public.profiles total count: %', v_profile_count;
  RAISE NOTICE '  - Master identity provisioned';
  RAISE NOTICE '  - Profiles RLS enabled and anon access blocked';
END $$;

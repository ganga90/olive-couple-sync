-- 1) Create the enum only if it doesn't already exist (in public schema)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'member_role' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.member_role AS ENUM ('owner','member');
  END IF;
END $$;

-- 2) Drop ALL policies on clerk_couple_members table systematically
DO $$
DECLARE
    policy_rec RECORD;
BEGIN
    -- Get all policies for clerk_couple_members table
    FOR policy_rec IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'clerk_couple_members'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                      policy_rec.policyname,
                      policy_rec.schemaname,
                      policy_rec.tablename);
    END LOOP;
END $$;

-- 3) Now safely convert the column type with proper casting
DO $$
DECLARE
    col_type text;
BEGIN
    -- Get current column type
    SELECT data_type INTO col_type
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clerk_couple_members' AND column_name='role';
    
    -- If not already member_role type, convert it
    IF col_type != 'USER-DEFINED' THEN
        -- First drop any existing default
        ALTER TABLE public.clerk_couple_members ALTER COLUMN role DROP DEFAULT;
        
        -- Then convert the column type with proper text casting
        ALTER TABLE public.clerk_couple_members
          ALTER COLUMN role TYPE public.member_role
          USING (CASE
                   WHEN role::text IN ('owner','member') THEN role::text::public.member_role
                   WHEN role::text = 'partner' THEN 'member'::public.member_role
                   ELSE 'member'::public.member_role
                 END);
        
        -- Now set the new default with proper enum type
        ALTER TABLE public.clerk_couple_members
          ALTER COLUMN role SET DEFAULT 'member'::public.member_role;
    END IF;
END $$;

-- 4) Recreate helper functions (ensure they exist)
CREATE OR REPLACE FUNCTION public.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

CREATE OR REPLACE FUNCTION public.jwt_sub() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT public.jwt()->>'sub'
$$;

-- 5) Recreate create_couple function with proper enum usage
CREATE OR REPLACE FUNCTION public.create_couple(
  p_title         text,
  p_you_name      text,
  p_partner_name  text
)
RETURNS TABLE (couple_id uuid, invite_token text)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_actor_id   text := public.jwt_sub();
  v_couple_id  uuid;
  v_token      text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Create couple
  INSERT INTO public.clerk_couples (title, you_name, partner_name, created_by)
  VALUES (p_title, p_you_name, p_partner_name, v_actor_id)
  RETURNING id INTO v_couple_id;

  -- Add creator as owner using proper enum type
  INSERT INTO public.clerk_couple_members (couple_id, user_id, role)
  VALUES (v_couple_id, v_actor_id, 'owner'::public.member_role);

  -- Create invite token  
  INSERT INTO public.invites (couple_id, invited_by, token, status)
  VALUES (
    v_couple_id,
    v_actor_id,
    encode(gen_random_bytes(18), 'base64'),
    'pending'
  )
  RETURNING token INTO v_token;

  RETURN QUERY SELECT v_couple_id, v_token;
END
$$;

-- 6) Recreate essential RLS policies with proper enum comparisons
CREATE POLICY couple_members_insert_self
ON public.clerk_couple_members
FOR INSERT TO authenticated
WITH CHECK (user_id = public.jwt_sub());

CREATE POLICY couple_members_select
ON public.clerk_couple_members
FOR SELECT TO authenticated
USING (user_id = public.jwt_sub());

CREATE POLICY couple_members_manage
ON public.clerk_couple_members
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.clerk_couple_members m
    WHERE m.couple_id = clerk_couple_members.couple_id
      AND m.user_id   = public.jwt_sub()
      AND m.role      = 'owner'::public.member_role
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.clerk_couple_members m
    WHERE m.couple_id = clerk_couple_members.couple_id
      AND m.user_id   = public.jwt_sub()
      AND m.role      = 'owner'::public.member_role
  )
);

-- Make sure PostgREST sees the schema changes immediately
SELECT pg_notify('pgrst', 'reload schema');
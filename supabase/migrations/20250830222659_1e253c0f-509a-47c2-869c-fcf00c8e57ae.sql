-- Fix member_role enum issues comprehensively

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

-- 2) Ensure clerk_couple_members.role uses the enum type
DO $$
DECLARE
    current_type text;
BEGIN
    -- Get current column type
    SELECT data_type INTO current_type
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clerk_couple_members' AND column_name='role';
    
    -- Only convert if it's not already the enum type
    IF current_type != 'USER-DEFINED' THEN
        -- Drop default first
        ALTER TABLE public.clerk_couple_members ALTER COLUMN role DROP DEFAULT;
        
        -- Convert the column type
        ALTER TABLE public.clerk_couple_members
          ALTER COLUMN role TYPE public.member_role
          USING (CASE
                   WHEN role IN ('owner','member') THEN role::public.member_role
                   WHEN role = 'partner' THEN 'member'::public.member_role
                   ELSE 'member'::public.member_role
                 END);
        
        -- Set new default with proper enum type
        ALTER TABLE public.clerk_couple_members
          ALTER COLUMN role SET DEFAULT 'member'::public.member_role;
    END IF;
END $$;

-- 3) Ensure pgcrypto extension exists
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 4) Recreate helper functions
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

  INSERT INTO public.clerk_couples (title, you_name, partner_name, created_by)
  VALUES (p_title, p_you_name, p_partner_name, v_actor_id)
  RETURNING id INTO v_couple_id;

  INSERT INTO public.clerk_couple_members (couple_id, user_id, role)
  VALUES (v_couple_id, v_actor_id, 'owner'::public.member_role);

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

-- 6) Drop and recreate policies with proper enum comparisons
DROP POLICY IF EXISTS couple_members_manage ON public.clerk_couple_members;
DROP POLICY IF EXISTS couple_members_insert_self ON public.clerk_couple_members;
DROP POLICY IF EXISTS couple_members_select ON public.clerk_couple_members;

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
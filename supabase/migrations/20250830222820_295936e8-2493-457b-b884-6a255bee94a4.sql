-- Fix member_role enum with proper text casting

-- 1) Create the enum only if it doesn't already exist
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

-- 2) Drop ALL policies on clerk_couple_members table
DO $$
DECLARE
    policy_rec RECORD;
BEGIN
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

-- 3) Convert column type with proper text casting
DO $$
DECLARE
    current_type text;
BEGIN
    SELECT data_type INTO current_type
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clerk_couple_members' AND column_name='role';
    
    IF current_type != 'USER-DEFINED' THEN
        ALTER TABLE public.clerk_couple_members ALTER COLUMN role DROP DEFAULT;
        
        -- Update data first to ensure valid values
        UPDATE public.clerk_couple_members SET role = 'member' WHERE role = 'partner';
        
        -- Now convert with text casting
        ALTER TABLE public.clerk_couple_members
          ALTER COLUMN role TYPE public.member_role
          USING (CASE
                   WHEN role::text IN ('owner','member') THEN role::text::public.member_role
                   ELSE 'member'::public.member_role
                 END);
        
        ALTER TABLE public.clerk_couple_members
          ALTER COLUMN role SET DEFAULT 'member'::public.member_role;
    END IF;
END $$;

-- 4) Ensure pgcrypto extension exists
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 5) Recreate helper functions
CREATE OR REPLACE FUNCTION public.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

CREATE OR REPLACE FUNCTION public.jwt_sub() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT public.jwt()->>'sub'
$$;

-- 6) Recreate create_couple function
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

-- 7) Recreate essential policies
CREATE POLICY couple_members_insert_self
ON public.clerk_couple_members
FOR INSERT TO authenticated
WITH CHECK (user_id = public.jwt_sub());

CREATE POLICY couple_members_select
ON public.clerk_couple_members
FOR SELECT TO authenticated
USING (user_id = public.jwt_sub());

-- Notify PostgREST to reload schema
SELECT pg_notify('pgrst', 'reload schema');
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

-- 2) Ensure clerk_couple_members.role uses the enum (handle default separately)
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
        
        -- Then convert the column type
        ALTER TABLE public.clerk_couple_members
          ALTER COLUMN role TYPE public.member_role
          USING (CASE
                   WHEN role IN ('owner','member','partner') THEN 
                     CASE 
                       WHEN role = 'partner' THEN 'member'::public.member_role
                       ELSE role::public.member_role
                     END
                   ELSE 'member'::public.member_role
                 END);
        
        -- Now set the new default with proper enum type
        ALTER TABLE public.clerk_couple_members
          ALTER COLUMN role SET DEFAULT 'member'::public.member_role;
    END IF;
END $$;

-- 3) Recreate helper functions (ensure they exist)
CREATE OR REPLACE FUNCTION public.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

CREATE OR REPLACE FUNCTION public.jwt_sub() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT public.jwt()->>'sub'
$$;

-- 4) Recreate create_couple function with proper enum usage
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

-- 5) Update policies to use proper enum comparisons
DROP POLICY IF EXISTS couple_members_manage ON public.clerk_couple_members;
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

-- Update other policies to use proper enum casting
DROP POLICY IF EXISTS memberships_insert ON public.clerk_couple_members;
CREATE POLICY memberships_insert
ON public.clerk_couple_members
FOR INSERT TO authenticated
WITH CHECK (
  user_id = public.jwt_sub() AND 
  role = ANY(ARRAY['owner'::public.member_role, 'member'::public.member_role])
);

-- Make sure PostgREST sees the schema changes immediately
SELECT pg_notify('pgrst', 'reload schema');
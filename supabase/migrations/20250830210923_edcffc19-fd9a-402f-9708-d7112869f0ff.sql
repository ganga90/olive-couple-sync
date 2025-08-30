-- Drop all existing policies first
DROP POLICY IF EXISTS couples_select ON public.clerk_couples;
DROP POLICY IF EXISTS couples_update ON public.clerk_couples;
DROP POLICY IF EXISTS "memberships.select.mine" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "invites.insert" ON public.invites;
DROP POLICY IF EXISTS "invites.select.mine" ON public.invites;
DROP POLICY IF EXISTS "notes.insert" ON public.clerk_notes;
DROP POLICY IF EXISTS "notes.select" ON public.clerk_notes;
DROP POLICY IF EXISTS "notes.update" ON public.clerk_notes;
DROP POLICY IF EXISTS "notes.delete" ON public.clerk_notes;
DROP POLICY IF EXISTS "lists.insert" ON public.clerk_lists;
DROP POLICY IF EXISTS "lists.select" ON public.clerk_lists;
DROP POLICY IF EXISTS "lists.update" ON public.clerk_lists;
DROP POLICY IF EXISTS "lists.delete" ON public.clerk_lists;

-- Now drop the functions
DROP FUNCTION IF EXISTS public.is_couple_member(uuid, text);
DROP FUNCTION IF EXISTS public.is_couple_owner(uuid, text);
DROP FUNCTION IF EXISTS public.create_couple(text, text, text);
DROP FUNCTION IF EXISTS public.create_invite(uuid);
DROP FUNCTION IF EXISTS public.accept_invite(text);

-- Create enum for roles
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_role') THEN
    CREATE TYPE member_role AS ENUM ('owner','partner');
  END IF;
END $$;

-- Add role column to clerk_couple_members if missing
ALTER TABLE public.clerk_couple_members
  ADD COLUMN IF NOT EXISTS role member_role NOT NULL DEFAULT 'owner';

-- Add accepted_at column to invites if missing  
ALTER TABLE public.invites
  ADD COLUMN IF NOT EXISTS accepted_at timestamp with time zone;

-- Helper functions (stable + simple)
CREATE OR REPLACE FUNCTION public.is_couple_member(cpl uuid, uid text)
RETURNS boolean 
LANGUAGE sql 
STABLE 
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clerk_couple_members m
    WHERE m.couple_id = cpl AND m.user_id = uid
  );
$$;

CREATE OR REPLACE FUNCTION public.is_couple_owner(cpl uuid, uid text)
RETURNS boolean 
LANGUAGE sql 
STABLE 
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clerk_couple_members m
    WHERE m.couple_id = cpl AND m.user_id = uid AND m.role = 'owner'
  );
$$;

-- RPCs used by the app
-- create couple + owner membership in one transaction
CREATE OR REPLACE FUNCTION public.create_couple(p_title text, p_you text, p_partner text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user text := auth.jwt()->>'sub';
  v_id   uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.clerk_couples (title, you_name, partner_name, created_by)
  VALUES (p_title, p_you, p_partner, v_user)
  RETURNING id INTO v_id;

  INSERT INTO public.clerk_couple_members (couple_id, user_id, role)
  VALUES (v_id, v_user, 'owner');

  RETURN v_id;
END;
$$;

-- create invite (only members)
CREATE OR REPLACE FUNCTION public.create_invite(p_couple_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user text := auth.jwt()->>'sub';
  v_token uuid := gen_random_uuid();
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_couple_member(p_couple_id, v_user) THEN
    RAISE EXCEPTION 'not a member of couple %', p_couple_id USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.invites (couple_id, invited_by, token)
  VALUES (p_couple_id, v_user, v_token::text)
  RETURNING id INTO v_id;

  RETURN v_token; -- return token to build the link
END;
$$;

-- accept invite (partner joins)
CREATE OR REPLACE FUNCTION public.accept_invite(p_token uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user text := auth.jwt()->>'sub';
  v_couple uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT couple_id INTO v_couple FROM public.invites
  WHERE token = p_token::text AND accepted_at IS NULL
  FOR UPDATE;

  IF v_couple IS NULL THEN
    RAISE EXCEPTION 'invalid or used invite' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.clerk_couple_members (couple_id, user_id, role)
  VALUES (v_couple, v_user, 'partner')
  ON CONFLICT DO NOTHING;

  UPDATE public.invites SET accepted_at = now() WHERE token = p_token::text;

  RETURN v_couple;
END;
$$;
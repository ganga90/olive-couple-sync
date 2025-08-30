-- Drop ALL existing policies that depend on the functions
-- clerk_couples policies
DROP POLICY IF EXISTS "couples.select" ON public.clerk_couples;
DROP POLICY IF EXISTS "couples.update" ON public.clerk_couples;
DROP POLICY IF EXISTS "couples.delete" ON public.clerk_couples;
DROP POLICY IF EXISTS "couples.insert" ON public.clerk_couples;

-- clerk_couple_members policies  
DROP POLICY IF EXISTS "memberships.select.mine" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "memberships.manage" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "memberships.insert" ON public.clerk_couple_members;

-- invites policies
DROP POLICY IF EXISTS "invites.insert" ON public.invites;
DROP POLICY IF EXISTS "invites.select.mine" ON public.invites;
DROP POLICY IF EXISTS "invites.update" ON public.invites;
DROP POLICY IF EXISTS "invites.delete" ON public.invites;

-- clerk_notes policies
DROP POLICY IF EXISTS "notes.insert" ON public.clerk_notes;
DROP POLICY IF EXISTS "notes.select" ON public.clerk_notes;
DROP POLICY IF EXISTS "notes.update" ON public.clerk_notes;
DROP POLICY IF EXISTS "notes.delete" ON public.clerk_notes;

-- clerk_lists policies
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

-- Recreate RLS Policies with new functions
-- clerk_profiles
ALTER TABLE public.clerk_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profile_select ON public.clerk_profiles
FOR SELECT TO authenticated
USING (id = auth.jwt()->>'sub');

CREATE POLICY profile_upsert ON public.clerk_profiles
FOR INSERT TO authenticated
WITH CHECK (id = auth.jwt()->>'sub');

CREATE POLICY profile_update ON public.clerk_profiles
FOR UPDATE TO authenticated
USING (id = auth.jwt()->>'sub')
WITH CHECK (id = auth.jwt()->>'sub');

-- clerk_couples
ALTER TABLE public.clerk_couples ENABLE ROW LEVEL SECURITY;
CREATE POLICY couples_insert ON public.clerk_couples
FOR INSERT TO authenticated
WITH CHECK (created_by = auth.jwt()->>'sub');

CREATE POLICY couples_select ON public.clerk_couples
FOR SELECT TO authenticated
USING (public.is_couple_member(id, auth.jwt()->>'sub'));

CREATE POLICY couples_update ON public.clerk_couples
FOR UPDATE TO authenticated
USING (public.is_couple_member(id, auth.jwt()->>'sub'))
WITH CHECK (public.is_couple_member(id, auth.jwt()->>'sub'));

CREATE POLICY couples_delete ON public.clerk_couples
FOR DELETE TO authenticated
USING (public.is_couple_owner(id, auth.jwt()->>'sub'));

-- clerk_couple_members
ALTER TABLE public.clerk_couple_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY members_insert ON public.clerk_couple_members
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.jwt()->>'sub'
  OR public.is_couple_owner(couple_id, auth.jwt()->>'sub')
);

CREATE POLICY members_select ON public.clerk_couple_members
FOR SELECT TO authenticated
USING (
  user_id = auth.jwt()->>'sub'
  OR public.is_couple_member(couple_id, auth.jwt()->>'sub')
);

CREATE POLICY members_update ON public.clerk_couple_members
FOR UPDATE TO authenticated
USING (public.is_couple_owner(couple_id, auth.jwt()->>'sub'))
WITH CHECK (public.is_couple_owner(couple_id, auth.jwt()->>'sub'));

CREATE POLICY members_delete ON public.clerk_couple_members
FOR DELETE TO authenticated
USING (public.is_couple_owner(couple_id, auth.jwt()->>'sub'));

-- invites
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY invites_insert ON public.invites
FOR INSERT TO authenticated
WITH CHECK (
  invited_by = auth.jwt()->>'sub'
  AND public.is_couple_member(couple_id, auth.jwt()->>'sub')
);

CREATE POLICY invites_select_mine ON public.invites
FOR SELECT TO authenticated
USING (invited_by = auth.jwt()->>'sub' OR public.is_couple_member(couple_id, auth.jwt()->>'sub'));

CREATE POLICY invites_update ON public.invites
FOR UPDATE TO authenticated
USING (public.is_couple_owner(couple_id, auth.jwt()->>'sub'))
WITH CHECK (public.is_couple_owner(couple_id, auth.jwt()->>'sub'));

CREATE POLICY invites_delete ON public.invites
FOR DELETE TO authenticated
USING (public.is_couple_owner(couple_id, auth.jwt()->>'sub'));

-- public read by token for landing page
CREATE POLICY invites_by_token ON public.invites
FOR SELECT TO anon, authenticated
USING (token IS NOT NULL);

-- clerk_notes
ALTER TABLE public.clerk_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notes_select ON public.clerk_notes
FOR SELECT TO authenticated
USING ((author_id = auth.jwt()->>'sub') OR 
       (couple_id IS NOT NULL AND public.is_couple_member(couple_id, auth.jwt()->>'sub')));

CREATE POLICY notes_insert ON public.clerk_notes
FOR INSERT TO authenticated
WITH CHECK ((author_id = auth.jwt()->>'sub') AND 
           (couple_id IS NULL OR public.is_couple_member(couple_id, auth.jwt()->>'sub')));

CREATE POLICY notes_update ON public.clerk_notes
FOR UPDATE TO authenticated
USING ((author_id = auth.jwt()->>'sub') OR 
       (couple_id IS NOT NULL AND public.is_couple_member(couple_id, auth.jwt()->>'sub')));

CREATE POLICY notes_delete ON public.clerk_notes
FOR DELETE TO authenticated
USING ((author_id = auth.jwt()->>'sub') OR 
       (couple_id IS NOT NULL AND public.is_couple_member(couple_id, auth.jwt()->>'sub')));

-- clerk_lists
ALTER TABLE public.clerk_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY lists_select ON public.clerk_lists
FOR SELECT TO authenticated
USING ((author_id = auth.jwt()->>'sub') OR 
       (couple_id IS NOT NULL AND public.is_couple_member(couple_id, auth.jwt()->>'sub')));

CREATE POLICY lists_insert ON public.clerk_lists
FOR INSERT TO authenticated
WITH CHECK ((author_id = auth.jwt()->>'sub') AND 
           (couple_id IS NULL OR public.is_couple_member(couple_id, auth.jwt()->>'sub')));

CREATE POLICY lists_update ON public.clerk_lists
FOR UPDATE TO authenticated
USING ((author_id = auth.jwt()->>'sub') OR 
       (couple_id IS NOT NULL AND public.is_couple_member(couple_id, auth.jwt()->>'sub')));

CREATE POLICY lists_delete ON public.clerk_lists
FOR DELETE TO authenticated
USING ((author_id = auth.jwt()->>'sub') OR 
       (couple_id IS NOT NULL AND public.is_couple_member(couple_id, auth.jwt()->>'sub')));
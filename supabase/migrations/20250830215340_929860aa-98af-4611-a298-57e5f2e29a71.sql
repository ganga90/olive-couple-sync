-- Drop the existing create_couple function to change its return type
DROP FUNCTION IF EXISTS public.create_couple(text, text, text);

-- 1.1 Ensure enum exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_role') THEN
    CREATE TYPE public.member_role AS ENUM ('owner','member');
  END IF;
END $$;

-- 1.2 Helpers to read JWT (handy in policies too)
CREATE OR REPLACE FUNCTION public.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

CREATE OR REPLACE FUNCTION public.jwt_sub() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT public.jwt()->>'sub'
$$;

-- 1.3 SAFE create_couple: fix ambiguous user_id & arg names
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

  -- create couple
  INSERT INTO public.clerk_couples (title, you_name, partner_name, created_by)
  VALUES (p_title, p_you_name, p_partner_name, v_actor_id)
  RETURNING id INTO v_couple_id;

  -- add creator as owner
  INSERT INTO public.clerk_couple_members (couple_id, user_id, role)
  VALUES (v_couple_id, v_actor_id, 'owner'::public.member_role);

  -- create invite for partner
  INSERT INTO public.invites (couple_id, invited_by, token, status)
  VALUES (
    v_couple_id,
    v_actor_id,
    encode(gen_random_bytes(18), 'base64'), -- 24-ish chars, URL-safe after encodeURIComponent
    'pending'
  )
  RETURNING token INTO v_token;

  RETURN QUERY SELECT v_couple_id, v_token;
END
$$;

-- 2. Minimal, safe RLS for couple creation and invite
-- clerk_couples
ALTER TABLE public.clerk_couples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS couples_insert ON public.clerk_couples;
CREATE POLICY couples_insert
ON public.clerk_couples
FOR INSERT TO authenticated
WITH CHECK (created_by = public.jwt_sub());

DROP POLICY IF EXISTS couples_select ON public.clerk_couples;
CREATE POLICY couples_select
ON public.clerk_couples
FOR SELECT TO authenticated
USING (created_by = public.jwt_sub()
    OR EXISTS (
         SELECT 1 FROM public.clerk_couple_members m
         WHERE m.couple_id = clerk_couples.id AND m.user_id = public.jwt_sub()
       ));

-- clerk_couple_members
ALTER TABLE public.clerk_couple_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS couple_members_insert_self ON public.clerk_couple_members;
CREATE POLICY couple_members_insert_self
ON public.clerk_couple_members
FOR INSERT TO authenticated
WITH CHECK (user_id = public.jwt_sub());

DROP POLICY IF EXISTS couple_members_select ON public.clerk_couple_members;
CREATE POLICY couple_members_select
ON public.clerk_couple_members
FOR SELECT TO authenticated
USING (user_id = public.jwt_sub());

-- invites
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invites_insert ON public.invites;
CREATE POLICY invites_insert
ON public.invites
FOR INSERT TO authenticated
WITH CHECK (invited_by = public.jwt_sub());

DROP POLICY IF EXISTS invites_select ON public.invites;
CREATE POLICY invites_select
ON public.invites
FOR SELECT TO authenticated
USING (
  invited_by = public.jwt_sub()
  OR EXISTS (
    SELECT 1 FROM public.clerk_couple_members m
    WHERE m.couple_id = invites.couple_id AND m.user_id = public.jwt_sub()
  )
);

-- Fix notes update policy for task_owner updates
ALTER TABLE public.clerk_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notes_update ON public.clerk_notes;
CREATE POLICY notes_update
ON public.clerk_notes
FOR UPDATE TO authenticated
USING (
  author_id = public.jwt_sub()
  OR (couple_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.clerk_couple_members m
        WHERE m.couple_id = clerk_notes.couple_id AND m.user_id = public.jwt_sub()
      ))
)
WITH CHECK (
  author_id = public.jwt_sub()
  OR (couple_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.clerk_couple_members m
        WHERE m.couple_id = clerk_notes.couple_id AND m.user_id = public.jwt_sub()
      ))
);

-- Tell PostgREST to reload quickly
SELECT pg_notify('pgrst', 'reload schema');
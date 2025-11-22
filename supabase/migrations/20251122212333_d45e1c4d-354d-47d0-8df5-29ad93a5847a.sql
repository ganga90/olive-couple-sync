-- Fix ambiguous column reference error in is_couple_member function
-- Step 1: Drop function CASCADE to remove dependent policies
DROP FUNCTION IF EXISTS public.is_couple_member(uuid, text) CASCADE;

-- Step 2: Recreate function with non-conflicting parameter name
CREATE OR REPLACE FUNCTION public.is_couple_member(couple_uuid uuid, p_user_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.clerk_couple_members m
    WHERE m.couple_id = couple_uuid AND m.user_id = p_user_id
  );
END;
$function$;

-- Step 3: Recreate all RLS policies that depended on this function

-- clerk_couples policies
DROP POLICY IF EXISTS "couples.select" ON public.clerk_couples;
CREATE POLICY "couples.select" ON public.clerk_couples
  FOR SELECT
  USING (is_couple_member(id, (auth.jwt() ->> 'sub'::text)));

DROP POLICY IF EXISTS "couples.update" ON public.clerk_couples;
CREATE POLICY "couples.update" ON public.clerk_couples
  FOR UPDATE
  USING (is_couple_member(id, (auth.jwt() ->> 'sub'::text)))
  WITH CHECK (is_couple_member(id, (auth.jwt() ->> 'sub'::text)));

-- invites policies
DROP POLICY IF EXISTS "invites.insert" ON public.invites;
CREATE POLICY "invites.insert" ON public.invites
  FOR INSERT
  WITH CHECK ((invited_by = (auth.jwt() ->> 'sub'::text)) AND is_couple_member(couple_id, (auth.jwt() ->> 'sub'::text)));

DROP POLICY IF EXISTS "invites.select.mine" ON public.invites;
CREATE POLICY "invites.select.mine" ON public.invites
  FOR SELECT
  USING ((invited_by = (auth.jwt() ->> 'sub'::text)) OR is_couple_member(couple_id, (auth.jwt() ->> 'sub'::text)));

-- clerk_lists policies
DROP POLICY IF EXISTS "lists.insert" ON public.clerk_lists;
CREATE POLICY "lists.insert" ON public.clerk_lists
  FOR INSERT
  WITH CHECK ((author_id = (auth.jwt() ->> 'sub'::text)) AND ((couple_id IS NULL) OR is_couple_member(couple_id, (auth.jwt() ->> 'sub'::text))));

DROP POLICY IF EXISTS "lists.select" ON public.clerk_lists;
CREATE POLICY "lists.select" ON public.clerk_lists
  FOR SELECT
  USING ((author_id = (auth.jwt() ->> 'sub'::text)) OR ((couple_id IS NOT NULL) AND is_couple_member(couple_id, (auth.jwt() ->> 'sub'::text))));

DROP POLICY IF EXISTS "lists.update" ON public.clerk_lists;
CREATE POLICY "lists.update" ON public.clerk_lists
  FOR UPDATE
  USING ((author_id = (auth.jwt() ->> 'sub'::text)) OR ((couple_id IS NOT NULL) AND is_couple_member(couple_id, (auth.jwt() ->> 'sub'::text))));

DROP POLICY IF EXISTS "lists.delete" ON public.clerk_lists;
CREATE POLICY "lists.delete" ON public.clerk_lists
  FOR DELETE
  USING ((author_id = (auth.jwt() ->> 'sub'::text)) OR ((couple_id IS NOT NULL) AND is_couple_member(couple_id, (auth.jwt() ->> 'sub'::text))));
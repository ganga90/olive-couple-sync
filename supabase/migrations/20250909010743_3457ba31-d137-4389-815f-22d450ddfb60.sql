-- Fix infinite recursion by creating security definer functions and fixing RLS policies

-- First, create a security definer function to check couple membership without recursion
CREATE OR REPLACE FUNCTION public.is_couple_member_safe(couple_uuid uuid, user_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.clerk_couple_members m
    WHERE m.couple_id = couple_uuid AND m.user_id = user_id
  );
END;
$$;

-- Drop all existing policies for clerk_notes to start fresh
DROP POLICY IF EXISTS "notes_select" ON public.clerk_notes;
DROP POLICY IF EXISTS "notes_insert" ON public.clerk_notes;
DROP POLICY IF EXISTS "notes_update" ON public.clerk_notes;
DROP POLICY IF EXISTS "notes_delete" ON public.clerk_notes;
DROP POLICY IF EXISTS "notes.select" ON public.clerk_notes;
DROP POLICY IF EXISTS "notes.insert" ON public.clerk_notes;
DROP POLICY IF EXISTS "notes.update" ON public.clerk_notes;
DROP POLICY IF EXISTS "notes.delete" ON public.clerk_notes;

-- Create simplified policies for clerk_notes that allow personal notes
CREATE POLICY "clerk_notes_select" ON public.clerk_notes
FOR SELECT TO authenticated
USING (
  -- Personal notes: I created them and they have no couple_id
  (author_id = (auth.jwt() ->> 'sub') AND couple_id IS NULL)
  OR
  -- Shared notes: I'm a member of the couple (using safe function)
  (couple_id IS NOT NULL AND public.is_couple_member_safe(couple_id, auth.jwt() ->> 'sub'))
);

CREATE POLICY "clerk_notes_insert" ON public.clerk_notes
FOR INSERT TO authenticated
WITH CHECK (
  -- Must be inserting as myself
  author_id = (auth.jwt() ->> 'sub')
  AND (
    -- Personal notes: no couple_id
    couple_id IS NULL
    OR
    -- Shared notes: I'm a member of the couple
    public.is_couple_member_safe(couple_id, auth.jwt() ->> 'sub')
  )
);

CREATE POLICY "clerk_notes_update" ON public.clerk_notes
FOR UPDATE TO authenticated
USING (
  -- Personal notes: I created them and they have no couple_id
  (author_id = (auth.jwt() ->> 'sub') AND couple_id IS NULL)
  OR
  -- Shared notes: I'm a member of the couple
  (couple_id IS NOT NULL AND public.is_couple_member_safe(couple_id, auth.jwt() ->> 'sub'))
);

CREATE POLICY "clerk_notes_delete" ON public.clerk_notes
FOR DELETE TO authenticated
USING (
  -- Personal notes: I created them and they have no couple_id
  (author_id = (auth.jwt() ->> 'sub') AND couple_id IS NULL)
  OR
  -- Shared notes: I'm a member of the couple
  (couple_id IS NOT NULL AND public.is_couple_member_safe(couple_id, auth.jwt() ->> 'sub'))
);

-- Fix clerk_couple_members policies to avoid recursion
DROP POLICY IF EXISTS "couple_members_select" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "couple_members_insert" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "couple_members_insert_self" ON public.clerk_couple_members;

-- Simple policies for clerk_couple_members
CREATE POLICY "clerk_couple_members_select" ON public.clerk_couple_members
FOR SELECT TO authenticated
USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "clerk_couple_members_insert" ON public.clerk_couple_members
FOR INSERT TO authenticated
WITH CHECK (user_id = (auth.jwt() ->> 'sub'));
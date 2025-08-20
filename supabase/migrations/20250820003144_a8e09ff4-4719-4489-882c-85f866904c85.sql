-- Fix infinite recursion in RLS policies by creating security definer functions
-- and make couple_id optional in notes

-- Create security definer function to check if user is owner of a couple
CREATE OR REPLACE FUNCTION public.is_couple_owner(couple_uuid uuid, user_text text)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM clerk_couple_members 
    WHERE couple_id = couple_uuid 
    AND user_id = user_text 
    AND role = 'owner'::member_role
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Create security definer function to check if user is member of a couple
CREATE OR REPLACE FUNCTION public.is_couple_member(couple_uuid uuid, user_text text)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM clerk_couple_members 
    WHERE couple_id = couple_uuid 
    AND user_id = user_text
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Owners can manage members via Clerk" ON clerk_couple_members;
DROP POLICY IF EXISTS "Members can view their couples via Clerk" ON clerk_couples;
DROP POLICY IF EXISTS "Members can update their couples via Clerk" ON clerk_couples;
DROP POLICY IF EXISTS "Owners can delete their couples via Clerk" ON clerk_couples;
DROP POLICY IF EXISTS "Users can view their couple notes via Clerk" ON clerk_notes;
DROP POLICY IF EXISTS "Users can insert notes via Clerk" ON clerk_notes;
DROP POLICY IF EXISTS "Users can update their couple notes via Clerk" ON clerk_notes;
DROP POLICY IF EXISTS "Users can delete their couple notes via Clerk" ON clerk_notes;

-- Recreate policies using security definer functions
CREATE POLICY "Owners can manage members via Clerk" ON clerk_couple_members
FOR ALL USING (public.is_couple_owner(couple_id, auth.jwt() ->> 'sub'::text));

CREATE POLICY "Members can view their couples via Clerk" ON clerk_couples
FOR SELECT USING (public.is_couple_member(id, auth.jwt() ->> 'sub'::text));

CREATE POLICY "Members can update their couples via Clerk" ON clerk_couples
FOR UPDATE USING (public.is_couple_member(id, auth.jwt() ->> 'sub'::text));

CREATE POLICY "Owners can delete their couples via Clerk" ON clerk_couples
FOR DELETE USING (public.is_couple_owner(id, auth.jwt() ->> 'sub'::text));

-- Make couple_id optional in notes and allow personal notes
ALTER TABLE clerk_notes ALTER COLUMN couple_id DROP NOT NULL;

-- Create policies for notes that work with or without couples
CREATE POLICY "Users can view their notes via Clerk" ON clerk_notes
FOR SELECT USING (
  author_id = (auth.jwt() ->> 'sub'::text) OR 
  (couple_id IS NOT NULL AND public.is_couple_member(couple_id, auth.jwt() ->> 'sub'::text))
);

CREATE POLICY "Users can insert their own notes via Clerk" ON clerk_notes
FOR INSERT WITH CHECK (
  author_id = (auth.jwt() ->> 'sub'::text) AND
  (couple_id IS NULL OR public.is_couple_member(couple_id, auth.jwt() ->> 'sub'::text))
);

CREATE POLICY "Users can update their notes via Clerk" ON clerk_notes
FOR UPDATE USING (
  author_id = (auth.jwt() ->> 'sub'::text) OR 
  (couple_id IS NOT NULL AND public.is_couple_member(couple_id, auth.jwt() ->> 'sub'::text))
);

CREATE POLICY "Users can delete their notes via Clerk" ON clerk_notes
FOR DELETE USING (
  author_id = (auth.jwt() ->> 'sub'::text) OR 
  (couple_id IS NOT NULL AND public.is_couple_member(couple_id, auth.jwt() ->> 'sub'::text))
);
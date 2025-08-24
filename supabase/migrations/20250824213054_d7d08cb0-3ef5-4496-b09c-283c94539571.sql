-- Fix RLS policies for Clerk authentication

-- Drop existing policies and recreate them properly
DROP POLICY IF EXISTS "Users can create couples via Clerk" ON clerk_couples;
DROP POLICY IF EXISTS "Members can view their couples via Clerk" ON clerk_couples;
DROP POLICY IF EXISTS "Members can update their couples via Clerk" ON clerk_couples;
DROP POLICY IF EXISTS "Owners can delete their couples via Clerk" ON clerk_couples;

DROP POLICY IF EXISTS "Users can insert memberships via Clerk" ON clerk_couple_members;
DROP POLICY IF EXISTS "Users can view their memberships via Clerk" ON clerk_couple_members;
DROP POLICY IF EXISTS "Owners can manage members via Clerk" ON clerk_couple_members;

DROP POLICY IF EXISTS "Clerk couple members can create invites" ON invites;
DROP POLICY IF EXISTS "Clerk couple members can view their couple invites" ON invites;
DROP POLICY IF EXISTS "Clerk couple owners can update invites" ON invites;
DROP POLICY IF EXISTS "Clerk couple owners can delete invites" ON invites;
DROP POLICY IF EXISTS "Clerk users can view invites they sent" ON invites;
DROP POLICY IF EXISTS "Public can view invite by token for acceptance" ON invites;

-- Create a helper function to get current Clerk user ID
CREATE OR REPLACE FUNCTION public.get_clerk_user_id()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    auth.jwt() ->> 'sub',
    current_setting('request.jwt.claims', true)::json ->> 'sub',
    current_setting('request.jwt.claim.sub', true)
  );
$$;

-- clerk_couples policies
CREATE POLICY "Users can create couples via Clerk"
ON clerk_couples FOR INSERT
WITH CHECK (created_by = get_clerk_user_id());

CREATE POLICY "Members can view their couples via Clerk"
ON clerk_couples FOR SELECT
USING (is_couple_member(id, get_clerk_user_id()));

CREATE POLICY "Members can update their couples via Clerk"
ON clerk_couples FOR UPDATE
USING (is_couple_member(id, get_clerk_user_id()));

CREATE POLICY "Owners can delete their couples via Clerk"
ON clerk_couples FOR DELETE
USING (is_couple_owner(id, get_clerk_user_id()));

-- clerk_couple_members policies
CREATE POLICY "Users can insert memberships via Clerk"
ON clerk_couple_members FOR INSERT
WITH CHECK (user_id = get_clerk_user_id());

CREATE POLICY "Users can view their memberships via Clerk"
ON clerk_couple_members FOR SELECT
USING (user_id = get_clerk_user_id());

CREATE POLICY "Owners can manage members via Clerk"
ON clerk_couple_members FOR ALL
USING (is_couple_owner(couple_id, get_clerk_user_id()));

-- invites policies
CREATE POLICY "Users can create invites for their couples"
ON invites FOR INSERT
WITH CHECK (
  invited_by = get_clerk_user_id() AND 
  is_couple_member(couple_id, get_clerk_user_id())
);

CREATE POLICY "Users can view invites they created"
ON invites FOR SELECT
USING (invited_by = get_clerk_user_id());

CREATE POLICY "Couple members can view couple invites"
ON invites FOR SELECT  
USING (is_couple_member(couple_id, get_clerk_user_id()));

CREATE POLICY "Owners can manage invites"
ON invites FOR UPDATE
USING (is_couple_owner(couple_id, get_clerk_user_id()));

CREATE POLICY "Owners can delete invites"
ON invites FOR DELETE
USING (is_couple_owner(couple_id, get_clerk_user_id()));

CREATE POLICY "Public can view invites by token"
ON invites FOR SELECT
USING (token IS NOT NULL);
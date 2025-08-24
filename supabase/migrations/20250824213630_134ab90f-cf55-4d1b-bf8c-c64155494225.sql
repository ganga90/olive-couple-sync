-- Update RLS policies to use the new third-party auth approach

-- Drop existing policies and recreate with direct auth.jwt() usage
DROP POLICY IF EXISTS "Users can create couples via Clerk" ON clerk_couples;
DROP POLICY IF EXISTS "Members can view their couples via Clerk" ON clerk_couples;
DROP POLICY IF EXISTS "Members can update their couples via Clerk" ON clerk_couples;
DROP POLICY IF EXISTS "Owners can delete their couples via Clerk" ON clerk_couples;

DROP POLICY IF EXISTS "Users can insert memberships via Clerk" ON clerk_couple_members;
DROP POLICY IF EXISTS "Users can view their memberships via Clerk" ON clerk_couple_members;
DROP POLICY IF EXISTS "Owners can manage members via Clerk" ON clerk_couple_members;

DROP POLICY IF EXISTS "Users can create invites for their couples" ON invites;
DROP POLICY IF EXISTS "Users can view invites they created" ON invites;
DROP POLICY IF EXISTS "Couple members can view couple invites" ON invites;
DROP POLICY IF EXISTS "Owners can manage invites" ON invites;
DROP POLICY IF EXISTS "Owners can delete invites" ON invites;
DROP POLICY IF EXISTS "Public can view invites by token" ON invites;

-- Update helper functions to work with direct JWT access
CREATE OR REPLACE FUNCTION public.is_couple_member(couple_uuid uuid, user_text text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Use direct user_text comparison since it's already extracted from JWT
  RETURN EXISTS (
    SELECT 1 FROM clerk_couple_members 
    WHERE couple_id = couple_uuid 
    AND user_id = user_text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_couple_owner(couple_uuid uuid, user_text text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Use direct user_text comparison since it's already extracted from JWT
  RETURN EXISTS (
    SELECT 1 FROM clerk_couple_members 
    WHERE couple_id = couple_uuid 
    AND user_id = user_text 
    AND role = 'owner'::member_role
  );
END;
$$;

-- clerk_couples policies - using auth.jwt()->>'sub' directly
CREATE POLICY "Users can create couples via Clerk"
ON clerk_couples FOR INSERT
TO authenticated
WITH CHECK (created_by = (auth.jwt()->>'sub'));

CREATE POLICY "Members can view their couples via Clerk"
ON clerk_couples FOR SELECT
TO authenticated
USING (is_couple_member(id, (auth.jwt()->>'sub')));

CREATE POLICY "Members can update their couples via Clerk"
ON clerk_couples FOR UPDATE
TO authenticated
USING (is_couple_member(id, (auth.jwt()->>'sub')));

CREATE POLICY "Owners can delete their couples via Clerk"
ON clerk_couples FOR DELETE
TO authenticated
USING (is_couple_owner(id, (auth.jwt()->>'sub')));

-- clerk_couple_members policies
CREATE POLICY "Users can insert memberships via Clerk"
ON clerk_couple_members FOR INSERT
TO authenticated
WITH CHECK (user_id = (auth.jwt()->>'sub'));

CREATE POLICY "Users can view their memberships via Clerk"
ON clerk_couple_members FOR SELECT
TO authenticated
USING (user_id = (auth.jwt()->>'sub'));

CREATE POLICY "Owners can manage members via Clerk"
ON clerk_couple_members FOR ALL
TO authenticated
USING (is_couple_owner(couple_id, (auth.jwt()->>'sub')));

-- invites policies
CREATE POLICY "Users can create invites for their couples"
ON invites FOR INSERT
TO authenticated
WITH CHECK (
  invited_by = (auth.jwt()->>'sub') AND 
  is_couple_member(couple_id, (auth.jwt()->>'sub'))
);

CREATE POLICY "Users can view invites they created"
ON invites FOR SELECT
TO authenticated
USING (invited_by = (auth.jwt()->>'sub'));

CREATE POLICY "Couple members can view couple invites"
ON invites FOR SELECT  
TO authenticated
USING (is_couple_member(couple_id, (auth.jwt()->>'sub')));

CREATE POLICY "Owners can manage invites"
ON invites FOR UPDATE
TO authenticated
USING (is_couple_owner(couple_id, (auth.jwt()->>'sub')));

CREATE POLICY "Owners can delete invites"
ON invites FOR DELETE
TO authenticated
USING (is_couple_owner(couple_id, (auth.jwt()->>'sub')));

CREATE POLICY "Public can view invites by token"
ON invites FOR SELECT
USING (token IS NOT NULL);
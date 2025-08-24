-- Fix RLS policies to ensure proper WITH CHECK clauses for all operations

-- Drop and recreate clerk_couples policies with comprehensive checks
DROP POLICY IF EXISTS "Users can create couples via Clerk" ON clerk_couples;
DROP POLICY IF EXISTS "Members can view their couples via Clerk" ON clerk_couples;
DROP POLICY IF EXISTS "Members can update their couples via Clerk" ON clerk_couples;
DROP POLICY IF EXISTS "Owners can delete their couples via Clerk" ON clerk_couples;

-- Create comprehensive clerk_couples policies
CREATE POLICY "Users can create couples via Clerk"
ON clerk_couples FOR INSERT
TO authenticated
WITH CHECK (
  auth.jwt()->>'sub' IS NOT NULL 
  AND created_by = (auth.jwt()->>'sub')
);

CREATE POLICY "Members can view their couples via Clerk"
ON clerk_couples FOR SELECT
TO authenticated
USING (is_couple_member(id, (auth.jwt()->>'sub')));

CREATE POLICY "Members can update their couples via Clerk"
ON clerk_couples FOR UPDATE
TO authenticated
USING (is_couple_member(id, (auth.jwt()->>'sub')))
WITH CHECK (is_couple_member(id, (auth.jwt()->>'sub')));

CREATE POLICY "Owners can delete their couples via Clerk"
ON clerk_couples FOR DELETE
TO authenticated
USING (is_couple_owner(id, (auth.jwt()->>'sub')));

-- Drop and recreate clerk_couple_members policies
DROP POLICY IF EXISTS "Users can insert memberships via Clerk" ON clerk_couple_members;
DROP POLICY IF EXISTS "Users can view their memberships via Clerk" ON clerk_couple_members;
DROP POLICY IF EXISTS "Owners can manage members via Clerk" ON clerk_couple_members;

-- Create comprehensive clerk_couple_members policies
CREATE POLICY "Users can insert memberships via Clerk"
ON clerk_couple_members FOR INSERT
TO authenticated
WITH CHECK (
  auth.jwt()->>'sub' IS NOT NULL 
  AND user_id = (auth.jwt()->>'sub')
);

CREATE POLICY "Users can view their memberships via Clerk"
ON clerk_couple_members FOR SELECT
TO authenticated
USING (user_id = (auth.jwt()->>'sub'));

CREATE POLICY "Members can view couple memberships via Clerk"
ON clerk_couple_members FOR SELECT
TO authenticated
USING (is_couple_member(couple_id, (auth.jwt()->>'sub')));

CREATE POLICY "Owners can manage members via Clerk"
ON clerk_couple_members FOR ALL
TO authenticated
USING (is_couple_owner(couple_id, (auth.jwt()->>'sub')))
WITH CHECK (is_couple_owner(couple_id, (auth.jwt()->>'sub')));

-- Drop and recreate invites policies with comprehensive checks
DROP POLICY IF EXISTS "Users can create invites for their couples" ON invites;
DROP POLICY IF EXISTS "Users can view invites they created" ON invites;
DROP POLICY IF EXISTS "Couple members can view couple invites" ON invites;
DROP POLICY IF EXISTS "Owners can manage invites" ON invites;
DROP POLICY IF EXISTS "Owners can delete invites" ON invites;
DROP POLICY IF EXISTS "Public can view invites by token" ON invites;

-- Create comprehensive invites policies
CREATE POLICY "Users can create invites for their couples"
ON invites FOR INSERT
TO authenticated
WITH CHECK (
  auth.jwt()->>'sub' IS NOT NULL 
  AND invited_by = (auth.jwt()->>'sub') 
  AND is_couple_member(couple_id, (auth.jwt()->>'sub'))
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
USING (is_couple_owner(couple_id, (auth.jwt()->>'sub')))
WITH CHECK (is_couple_owner(couple_id, (auth.jwt()->>'sub')));

CREATE POLICY "Owners can delete invites"
ON invites FOR DELETE
TO authenticated
USING (is_couple_owner(couple_id, (auth.jwt()->>'sub')));

CREATE POLICY "Public can view invites by token"
ON invites FOR SELECT
TO anon, authenticated
USING (token IS NOT NULL);

-- Add comprehensive policies for clerk_notes and clerk_lists if they don't exist
-- clerk_notes policies (should already exist but let's ensure they're comprehensive)
DO $$ 
BEGIN
  -- Check if policies exist, if not create them
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'clerk_notes' AND policyname = 'Users can insert their own notes via Clerk') THEN
    CREATE POLICY "Users can insert their own notes via Clerk"
    ON clerk_notes FOR INSERT
    TO authenticated
    WITH CHECK (
      auth.jwt()->>'sub' IS NOT NULL 
      AND author_id = (auth.jwt()->>'sub') 
      AND (couple_id IS NULL OR is_couple_member(couple_id, (auth.jwt()->>'sub')))
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'clerk_notes' AND policyname = 'Users can view their notes via Clerk') THEN
    CREATE POLICY "Users can view their notes via Clerk"
    ON clerk_notes FOR SELECT
    TO authenticated
    USING (
      author_id = (auth.jwt()->>'sub') 
      OR (couple_id IS NOT NULL AND is_couple_member(couple_id, (auth.jwt()->>'sub')))
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'clerk_notes' AND policyname = 'Users can update their notes via Clerk') THEN
    CREATE POLICY "Users can update their notes via Clerk"
    ON clerk_notes FOR UPDATE
    TO authenticated
    USING (
      author_id = (auth.jwt()->>'sub') 
      OR (couple_id IS NOT NULL AND is_couple_member(couple_id, (auth.jwt()->>'sub')))
    )
    WITH CHECK (
      author_id = (auth.jwt()->>'sub') 
      OR (couple_id IS NOT NULL AND is_couple_member(couple_id, (auth.jwt()->>'sub')))
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'clerk_notes' AND policyname = 'Users can delete their notes via Clerk') THEN
    CREATE POLICY "Users can delete their notes via Clerk"
    ON clerk_notes FOR DELETE
    TO authenticated
    USING (
      author_id = (auth.jwt()->>'sub') 
      OR (couple_id IS NOT NULL AND is_couple_member(couple_id, (auth.jwt()->>'sub')))
    );
  END IF;
END $$;
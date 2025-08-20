-- Update RLS policies for Clerk integration using auth.jwt()->>'sub'

-- Drop existing policies for clerk_notes table
DROP POLICY IF EXISTS "Members can delete clerk notes in their couples" ON clerk_notes;
DROP POLICY IF EXISTS "Members can update clerk notes in their couples" ON clerk_notes;
DROP POLICY IF EXISTS "Members can view clerk notes in their couples" ON clerk_notes;
DROP POLICY IF EXISTS "Permissive clerk notes insert" ON clerk_notes;

-- Create new RLS policies for clerk_notes using Clerk JWT
CREATE POLICY "Users can view their couple notes via Clerk"
ON clerk_notes FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = clerk_notes.couple_id 
    AND m.user_id = (auth.jwt()->>'sub')::text
  )
);

CREATE POLICY "Users can insert notes via Clerk"
ON clerk_notes FOR INSERT
TO authenticated
WITH CHECK (
  auth.jwt()->>'sub' IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = clerk_notes.couple_id 
    AND m.user_id = (auth.jwt()->>'sub')::text
  )
);

CREATE POLICY "Users can update their couple notes via Clerk"
ON clerk_notes FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = clerk_notes.couple_id 
    AND m.user_id = (auth.jwt()->>'sub')::text
  )
);

CREATE POLICY "Users can delete their couple notes via Clerk"
ON clerk_notes FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = clerk_notes.couple_id 
    AND m.user_id = (auth.jwt()->>'sub')::text
  )
);

-- Update clerk_couple_members policies
DROP POLICY IF EXISTS "Users can view their clerk memberships" ON clerk_couple_members;
DROP POLICY IF EXISTS "Permissive clerk members insert" ON clerk_couple_members;
DROP POLICY IF EXISTS "Owners can add clerk members" ON clerk_couple_members;
DROP POLICY IF EXISTS "Owners can update clerk members" ON clerk_couple_members;
DROP POLICY IF EXISTS "Owners can remove clerk members" ON clerk_couple_members;

CREATE POLICY "Users can view their memberships via Clerk"
ON clerk_couple_members FOR SELECT
TO authenticated
USING (user_id = (auth.jwt()->>'sub')::text);

CREATE POLICY "Users can insert memberships via Clerk"
ON clerk_couple_members FOR INSERT
TO authenticated
WITH CHECK (
  auth.jwt()->>'sub' IS NOT NULL
  AND user_id = (auth.jwt()->>'sub')::text
);

CREATE POLICY "Owners can manage members via Clerk"
ON clerk_couple_members FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = clerk_couple_members.couple_id 
    AND m.user_id = (auth.jwt()->>'sub')::text
    AND m.role = 'owner'::member_role
  )
);

-- Update clerk_couples policies
DROP POLICY IF EXISTS "Members can view their clerk couples" ON clerk_couples;
DROP POLICY IF EXISTS "Members can update their clerk couples" ON clerk_couples;
DROP POLICY IF EXISTS "Owners can delete their clerk couples" ON clerk_couples;
DROP POLICY IF EXISTS "Permissive clerk couples insert" ON clerk_couples;

CREATE POLICY "Members can view their couples via Clerk"
ON clerk_couples FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = clerk_couples.id 
    AND m.user_id = (auth.jwt()->>'sub')::text
  )
);

CREATE POLICY "Users can create couples via Clerk"
ON clerk_couples FOR INSERT
TO authenticated
WITH CHECK (
  auth.jwt()->>'sub' IS NOT NULL
  AND created_by = (auth.jwt()->>'sub')::text
);

CREATE POLICY "Members can update their couples via Clerk"
ON clerk_couples FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = clerk_couples.id 
    AND m.user_id = (auth.jwt()->>'sub')::text
  )
);

CREATE POLICY "Owners can delete their couples via Clerk"
ON clerk_couples FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = clerk_couples.id 
    AND m.user_id = (auth.jwt()->>'sub')::text
    AND m.role = 'owner'::member_role
  )
);

-- Update clerk_profiles policies  
DROP POLICY IF EXISTS "Clerk profiles are viewable by owner" ON clerk_profiles;
DROP POLICY IF EXISTS "Permissive clerk profile insert" ON clerk_profiles;
DROP POLICY IF EXISTS "Users can update own clerk profile" ON clerk_profiles;

CREATE POLICY "Users can view their own profile via Clerk"
ON clerk_profiles FOR SELECT
TO authenticated
USING (id = (auth.jwt()->>'sub')::uuid);

CREATE POLICY "Users can insert their own profile via Clerk"
ON clerk_profiles FOR INSERT
TO authenticated
WITH CHECK (
  auth.jwt()->>'sub' IS NOT NULL
  AND id = (auth.jwt()->>'sub')::uuid
);

CREATE POLICY "Users can update their own profile via Clerk"
ON clerk_profiles FOR UPDATE
TO authenticated
USING (id = (auth.jwt()->>'sub')::uuid);
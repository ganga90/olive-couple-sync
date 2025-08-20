-- Step 7: Recreate RLS policies for Clerk integration with TEXT user IDs

-- clerk_profiles policies
CREATE POLICY "Users can view their own profile via Clerk"
ON clerk_profiles FOR SELECT
TO authenticated
USING (id = (auth.jwt()->>'sub'));

CREATE POLICY "Users can insert their own profile via Clerk"
ON clerk_profiles FOR INSERT
TO authenticated
WITH CHECK (
  auth.jwt()->>'sub' IS NOT NULL
  AND id = (auth.jwt()->>'sub')
);

CREATE POLICY "Users can update their own profile via Clerk"
ON clerk_profiles FOR UPDATE
TO authenticated
USING (id = (auth.jwt()->>'sub'));

-- clerk_couple_members policies
CREATE POLICY "Users can view their memberships via Clerk"
ON clerk_couple_members FOR SELECT
TO authenticated
USING (user_id = (auth.jwt()->>'sub'));

CREATE POLICY "Users can insert memberships via Clerk"
ON clerk_couple_members FOR INSERT
TO authenticated
WITH CHECK (
  auth.jwt()->>'sub' IS NOT NULL
  AND user_id = (auth.jwt()->>'sub')
);

CREATE POLICY "Owners can manage members via Clerk"
ON clerk_couple_members FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = clerk_couple_members.couple_id 
    AND m.user_id = (auth.jwt()->>'sub')
    AND m.role = 'owner'::member_role
  )
);

-- clerk_couples policies
CREATE POLICY "Members can view their couples via Clerk"
ON clerk_couples FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = clerk_couples.id 
    AND m.user_id = (auth.jwt()->>'sub')
  )
);

CREATE POLICY "Users can create couples via Clerk"
ON clerk_couples FOR INSERT
TO authenticated
WITH CHECK (
  auth.jwt()->>'sub' IS NOT NULL
  AND created_by = (auth.jwt()->>'sub')
);

CREATE POLICY "Members can update their couples via Clerk"
ON clerk_couples FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = clerk_couples.id 
    AND m.user_id = (auth.jwt()->>'sub')
  )
);

CREATE POLICY "Owners can delete their couples via Clerk"
ON clerk_couples FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = clerk_couples.id 
    AND m.user_id = (auth.jwt()->>'sub')
    AND m.role = 'owner'::member_role
  )
);

-- clerk_notes policies
CREATE POLICY "Users can view their couple notes via Clerk"
ON clerk_notes FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = clerk_notes.couple_id 
    AND m.user_id = (auth.jwt()->>'sub')
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
    AND m.user_id = (auth.jwt()->>'sub')
  )
);

CREATE POLICY "Users can update their couple notes via Clerk"
ON clerk_notes FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = clerk_notes.couple_id 
    AND m.user_id = (auth.jwt()->>'sub')
  )
);

CREATE POLICY "Users can delete their couple notes via Clerk"
ON clerk_notes FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = clerk_notes.couple_id 
    AND m.user_id = (auth.jwt()->>'sub')
  )
);

-- Recreate invite policies
CREATE POLICY "Clerk couple members can view their couple invites"
ON invites FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = invites.couple_id 
    AND m.user_id = (auth.jwt()->>'sub')
  )
);

CREATE POLICY "Clerk couple owners can create invites"
ON invites FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = invites.couple_id 
    AND m.user_id = (auth.jwt()->>'sub')
    AND m.role = 'owner'::member_role
  )
  AND invited_by = (auth.jwt()->>'sub')
);

CREATE POLICY "Clerk couple owners can update invites"
ON invites FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = invites.couple_id 
    AND m.user_id = (auth.jwt()->>'sub')
    AND m.role = 'owner'::member_role
  )
);

CREATE POLICY "Clerk couple owners can delete invites"
ON invites FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = invites.couple_id 
    AND m.user_id = (auth.jwt()->>'sub')
    AND m.role = 'owner'::member_role
  )
);
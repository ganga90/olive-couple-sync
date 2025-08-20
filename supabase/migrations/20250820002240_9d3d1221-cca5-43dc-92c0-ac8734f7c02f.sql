-- Drop policies on invites table that reference clerk_couple_members
DROP POLICY IF EXISTS "Clerk couple members can view their couple invites" ON invites;
DROP POLICY IF EXISTS "Clerk couple owners can create invites" ON invites;
DROP POLICY IF EXISTS "Clerk couple owners can delete invites" ON invites;
DROP POLICY IF EXISTS "Clerk couple owners can update invites" ON invites;
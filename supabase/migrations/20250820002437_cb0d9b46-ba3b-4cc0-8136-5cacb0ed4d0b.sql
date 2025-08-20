-- Drop remaining invites policies
DROP POLICY IF EXISTS "Clerk users can view invites they sent" ON invites;
DROP POLICY IF EXISTS "Public can view invite by token for acceptance" ON invites;
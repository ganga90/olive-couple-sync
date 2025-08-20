-- Drop ALL remaining policies completely
DROP POLICY IF EXISTS "Users can view their clerk memberships" ON clerk_couple_members;

-- Also check for any other policies I might have missed
-- List of all possible policy names that might exist on these tables:

-- clerk_profiles
DROP POLICY IF EXISTS "Profiles are viewable by owner" ON clerk_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON clerk_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON clerk_profiles;

-- clerk_couple_members  
DROP POLICY IF EXISTS "Users can view their memberships" ON clerk_couple_members;

-- clerk_couples
DROP POLICY IF EXISTS "Users can create couples" ON clerk_couples;

-- clerk_notes
-- All should be dropped already
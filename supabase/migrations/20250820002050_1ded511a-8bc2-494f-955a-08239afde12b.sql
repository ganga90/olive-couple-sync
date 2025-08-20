-- Drop ALL remaining policies from Clerk tables

-- Get all policies for clerk_profiles
DROP POLICY IF EXISTS "Clerk profiles are viewable by owner" ON clerk_profiles;

-- Get all policies for clerk_couple_members  
DROP POLICY IF EXISTS "Owners can add clerk members" ON clerk_couple_members;
DROP POLICY IF EXISTS "Owners can remove clerk members" ON clerk_couple_members;
DROP POLICY IF EXISTS "Owners can update clerk members" ON clerk_couple_members;
DROP POLICY IF EXISTS "Permissive clerk members insert" ON clerk_couple_members;

-- Get all policies for clerk_couples
DROP POLICY IF EXISTS "Members can update their clerk couples" ON clerk_couples;
DROP POLICY IF EXISTS "Members can view their clerk couples" ON clerk_couples;
DROP POLICY IF EXISTS "Owners can delete their clerk couples" ON clerk_couples;
DROP POLICY IF EXISTS "Permissive clerk couples insert" ON clerk_couples;

-- Get all policies for clerk_notes
DROP POLICY IF EXISTS "Members can delete clerk notes in their couples" ON clerk_notes;
DROP POLICY IF EXISTS "Members can update clerk notes in their couples" ON clerk_notes;
DROP POLICY IF EXISTS "Members can view clerk notes in their couples" ON clerk_notes;
DROP POLICY IF EXISTS "Permissive clerk notes insert" ON clerk_notes;
-- Step 1: Drop all RLS policies that reference user_id columns

-- Drop clerk_profiles policies
DROP POLICY IF EXISTS "Users can view their own profile via Clerk" ON clerk_profiles;
DROP POLICY IF EXISTS "Users can insert their own profile via Clerk" ON clerk_profiles;
DROP POLICY IF EXISTS "Users can update their own profile via Clerk" ON clerk_profiles;

-- Drop clerk_couple_members policies
DROP POLICY IF EXISTS "Users can view their memberships via Clerk" ON clerk_couple_members;
DROP POLICY IF EXISTS "Users can insert memberships via Clerk" ON clerk_couple_members;
DROP POLICY IF EXISTS "Owners can manage members via Clerk" ON clerk_couple_members;

-- Drop clerk_couples policies
DROP POLICY IF EXISTS "Members can view their couples via Clerk" ON clerk_couples;
DROP POLICY IF EXISTS "Users can create couples via Clerk" ON clerk_couples;
DROP POLICY IF EXISTS "Members can update their couples via Clerk" ON clerk_couples;
DROP POLICY IF EXISTS "Owners can delete their couples via Clerk" ON clerk_couples;

-- Drop clerk_notes policies
DROP POLICY IF EXISTS "Users can view their couple notes via Clerk" ON clerk_notes;
DROP POLICY IF EXISTS "Users can insert notes via Clerk" ON clerk_notes;
DROP POLICY IF EXISTS "Users can update their couple notes via Clerk" ON clerk_notes;
DROP POLICY IF EXISTS "Users can delete their couple notes via Clerk" ON clerk_notes;
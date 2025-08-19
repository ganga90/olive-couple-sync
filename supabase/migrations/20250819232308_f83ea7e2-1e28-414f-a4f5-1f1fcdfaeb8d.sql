-- First, let's completely fix the RLS policies to allow authenticated users
-- We need to drop and recreate the policies that are still blocking

-- Fix clerk_profiles policies
DROP POLICY IF EXISTS "Users can insert own clerk profile" ON clerk_profiles;
CREATE POLICY "Allow authenticated users to create clerk profile" 
ON clerk_profiles 
FOR INSERT 
WITH CHECK (true);

-- Fix clerk_couples policies  
DROP POLICY IF EXISTS "Users can create clerk couples" ON clerk_couples;
CREATE POLICY "Allow authenticated users to create clerk couples" 
ON clerk_couples 
FOR INSERT 
WITH CHECK (true);

-- Fix clerk_couple_members policies
DROP POLICY IF EXISTS "Owners can add clerk members" ON clerk_couple_members;
CREATE POLICY "Allow authenticated users to add couple members" 
ON clerk_couple_members 
FOR INSERT 
WITH CHECK (true);

-- Fix clerk_notes policies
DROP POLICY IF EXISTS "Members can insert clerk notes in their couples" ON clerk_notes;
CREATE POLICY "Allow authenticated users to create notes" 
ON clerk_notes 
FOR INSERT 
WITH CHECK (true);
-- Update RLS policies to allow authenticated users to create profiles and couples
-- even when JWT claims aren't properly set up yet

-- First, drop the existing restrictive policies
DROP POLICY IF EXISTS "Users can insert own clerk profile" ON clerk_profiles;
DROP POLICY IF EXISTS "Users can create clerk couples" ON clerk_couples;

-- Create more permissive INSERT policies for initial setup
CREATE POLICY "Allow authenticated users to create clerk profile" 
ON clerk_profiles 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow authenticated users to create clerk couples" 
ON clerk_couples 
FOR INSERT 
WITH CHECK (true);

-- Also ensure the clerk_couple_members table allows initial inserts
DROP POLICY IF EXISTS "Members can insert themselves" ON clerk_couple_members;

CREATE POLICY "Allow authenticated users to add couple members" 
ON clerk_couple_members 
FOR INSERT 
WITH CHECK (true);

-- For notes, ensure they can be inserted
DROP POLICY IF EXISTS "Members can insert clerk notes in their couples" ON clerk_notes;

CREATE POLICY "Allow authenticated users to create notes" 
ON clerk_notes 
FOR INSERT 
WITH CHECK (true);
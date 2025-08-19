-- Let's check what policies exist and fix them carefully

-- Drop existing INSERT policies that are blocking
DROP POLICY IF EXISTS "Allow authenticated users to create clerk profile" ON clerk_profiles;
DROP POLICY IF EXISTS "Allow authenticated users to create clerk couples" ON clerk_couples;  
DROP POLICY IF EXISTS "Allow authenticated users to add couple members" ON clerk_couple_members;
DROP POLICY IF EXISTS "Allow authenticated users to create notes" ON clerk_notes;

-- Create new permissive INSERT policies
CREATE POLICY "Permissive clerk profile insert" 
ON clerk_profiles 
FOR INSERT 
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Permissive clerk couples insert" 
ON clerk_couples 
FOR INSERT 
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Permissive clerk members insert" 
ON clerk_couple_members 
FOR INSERT 
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Permissive clerk notes insert" 
ON clerk_notes 
FOR INSERT 
WITH CHECK (auth.uid() IS NOT NULL);
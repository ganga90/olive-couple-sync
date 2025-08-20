-- Fix RLS policies for Clerk integration with correct type casting

-- Update clerk_profiles policies with correct type casting
DROP POLICY IF EXISTS "Users can view their own profile via Clerk" ON clerk_profiles;
DROP POLICY IF EXISTS "Users can insert their own profile via Clerk" ON clerk_profiles; 
DROP POLICY IF EXISTS "Users can update their own profile via Clerk" ON clerk_profiles;

CREATE POLICY "Users can view their own profile via Clerk"
ON clerk_profiles FOR SELECT
TO authenticated
USING (id::text = (auth.jwt()->>'sub'));

CREATE POLICY "Users can insert their own profile via Clerk"
ON clerk_profiles FOR INSERT
TO authenticated
WITH CHECK (
  auth.jwt()->>'sub' IS NOT NULL
  AND id::text = (auth.jwt()->>'sub')
);

CREATE POLICY "Users can update their own profile via Clerk"
ON clerk_profiles FOR UPDATE
TO authenticated
USING (id::text = (auth.jwt()->>'sub'));
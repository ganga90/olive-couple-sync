-- Drop the remaining policy
DROP POLICY IF EXISTS "Users can update own clerk profile" ON clerk_profiles;
DROP POLICY IF EXISTS "Permissive clerk profile insert" ON clerk_profiles;
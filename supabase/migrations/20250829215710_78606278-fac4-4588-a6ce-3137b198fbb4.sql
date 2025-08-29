-- Remove the conflicting stricter INSERT policies, keep only the relaxed one
DROP POLICY IF EXISTS "Users can create couples via Clerk" ON clerk_couples;

-- Verify only the relaxed policy remains
SELECT policyname, cmd, with_check
FROM pg_policies  
WHERE schemaname='public' AND tablename='clerk_couples' AND cmd='INSERT';
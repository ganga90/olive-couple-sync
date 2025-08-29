-- Check and fix RLS policy for couples insert
DROP POLICY IF EXISTS "couples.insert" ON clerk_couples;
CREATE POLICY "couples.insert"
ON clerk_couples FOR INSERT
TO authenticated
WITH CHECK ( created_by = (auth.jwt()->>'sub') );
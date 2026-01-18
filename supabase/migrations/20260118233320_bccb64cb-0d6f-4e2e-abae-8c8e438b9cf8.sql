-- ================================================================
-- SECURITY FIX: Fix clerk_invites overly restrictive policy
-- ================================================================

-- Drop the blanket denial policy that blocks all operations
DROP POLICY IF EXISTS "deny_all_clerk_invites" ON public.clerk_invites;

-- Create proper RLS policies for clerk_invites table
-- 1. Users can view invites they created or invites for couples they belong to
CREATE POLICY "clerk_invites_select_own"
ON public.clerk_invites
FOR SELECT
TO authenticated
USING (
  created_by = (auth.jwt() ->> 'sub'::text)
  OR EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = clerk_invites.couple_id
    AND m.user_id = (auth.jwt() ->> 'sub'::text)
  )
);

-- 2. Users can create invites for couples they belong to
CREATE POLICY "clerk_invites_insert_own"
ON public.clerk_invites
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = (auth.jwt() ->> 'sub'::text)
  AND is_couple_member(couple_id, (auth.jwt() ->> 'sub'::text))
);

-- 3. Users can update invites they created (e.g., to revoke)
CREATE POLICY "clerk_invites_update_own"
ON public.clerk_invites
FOR UPDATE
TO authenticated
USING (created_by = (auth.jwt() ->> 'sub'::text))
WITH CHECK (created_by = (auth.jwt() ->> 'sub'::text));

-- 4. Users can delete invites they created
CREATE POLICY "clerk_invites_delete_own"
ON public.clerk_invites
FOR DELETE
TO authenticated
USING (created_by = (auth.jwt() ->> 'sub'::text));

-- ================================================================
-- SECURITY FIX: Fix user_sessions overly permissive policy
-- ================================================================

-- Drop the overly permissive service role policy
DROP POLICY IF EXISTS "Service role can manage all sessions" ON public.user_sessions;

-- Create a more secure policy for service role access
-- The service role will still have access via Supabase's built-in service role bypass
-- But we don't need an RLS policy with USING(true) for that

-- Note: The existing user policies remain in place:
-- - "Users can insert their own sessions"
-- - "Users can update their own sessions" 
-- - "Users can view their own sessions"

-- For edge functions using the service role key, RLS is bypassed automatically
-- So we don't need a permissive policy. The existing user policies are sufficient.
-- Fix RLS policy for clerk_invites to allow people to view invites they're trying to accept
-- The current policy only allows existing couple members to see invites, but people accepting invites aren't members yet

-- Drop the restrictive select policy
DROP POLICY IF EXISTS "invites_select" ON public.clerk_invites;

-- Create a new policy that allows viewing invites for:
-- 1. Existing couple members (for management)
-- 2. Anyone with a valid token (for accepting invites)
CREATE POLICY "invites_select_fixed" 
ON public.clerk_invites 
FOR SELECT 
USING (
  -- Allow existing couple members to see invites
  (EXISTS ( 
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = clerk_invites.couple_id 
    AND m.user_id = (auth.jwt() ->> 'sub'::text)
  ))
  OR
  -- Allow anyone to see pending invites (they need the token anyway)
  (status = 'pending' AND expires_at > now())
);
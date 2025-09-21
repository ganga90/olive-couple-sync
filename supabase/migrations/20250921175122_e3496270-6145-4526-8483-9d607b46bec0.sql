-- Fix the ambiguous column references in clerk_invites RLS policy
DROP POLICY IF EXISTS "clerk_invites_select" ON public.clerk_invites;

-- Create a new policy with ALL columns fully qualified
CREATE POLICY "clerk_invites_select" 
ON public.clerk_invites 
FOR SELECT 
USING (
  -- Allow existing couple members to see invites for their couple
  (EXISTS ( 
    SELECT 1 FROM public.clerk_couple_members ccm
    WHERE ccm.couple_id = clerk_invites.couple_id 
    AND ccm.user_id = (auth.jwt() ->> 'sub'::text)
  ))
  OR
  -- Allow anyone to see pending non-expired invites (fully qualified columns)
  (clerk_invites.status = 'pending'::text AND clerk_invites.expires_at > now())
);
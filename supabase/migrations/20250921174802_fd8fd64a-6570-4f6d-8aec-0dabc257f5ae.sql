-- Drop all existing policies on clerk_invites to clean up any conflicts
DROP POLICY IF EXISTS "invites_insert" ON public.clerk_invites;
DROP POLICY IF EXISTS "invites_select_fixed" ON public.clerk_invites;

-- Create clean policies with fully qualified column references
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
  -- Allow anyone to see pending non-expired invites (they need the token anyway to use them)
  (clerk_invites.status = 'pending'::text AND clerk_invites.expires_at > now())
);

CREATE POLICY "clerk_invites_insert" 
ON public.clerk_invites 
FOR INSERT 
WITH CHECK (
  clerk_invites.created_by = (auth.jwt() ->> 'sub'::text) 
  AND EXISTS ( 
    SELECT 1 FROM public.clerk_couple_members ccm
    WHERE ccm.couple_id = clerk_invites.couple_id 
    AND ccm.user_id = (auth.jwt() ->> 'sub'::text) 
    AND ccm.role = 'owner'::member_role
  )
);
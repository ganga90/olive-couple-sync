-- Fix the ambiguous user_id column reference in the RLS policy
DROP POLICY IF EXISTS "invites_select_fixed" ON public.clerk_invites;

-- Create a new policy with properly qualified column references
CREATE POLICY "invites_select_fixed" 
ON public.clerk_invites 
FOR SELECT 
USING (
  -- Allow existing couple members to see invites
  (EXISTS ( 
    SELECT 1 FROM public.clerk_couple_members m
    WHERE m.couple_id = clerk_invites.couple_id 
    AND m.user_id = (auth.jwt() ->> 'sub'::text)
  ))
  OR
  -- Allow anyone to see pending invites (they need the token anyway)
  (clerk_invites.status = 'pending' AND clerk_invites.expires_at > now())
);
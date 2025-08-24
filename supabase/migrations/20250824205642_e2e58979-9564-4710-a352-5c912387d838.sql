-- Update RLS policy for invites to be more permissive during invite creation
-- Allow users to create invites if they are members of the couple (not just owners)
DROP POLICY IF EXISTS "Clerk couple owners can create invites" ON public.invites;

CREATE POLICY "Clerk couple members can create invites" 
ON public.invites 
FOR INSERT 
WITH CHECK (
  (EXISTS ( 
    SELECT 1 FROM clerk_couple_members m 
    WHERE m.couple_id = invites.couple_id 
    AND m.user_id = (auth.jwt() ->> 'sub'::text)
  )) 
  AND (invited_by = (auth.jwt() ->> 'sub'::text))
);

-- Also ensure couple creation works by making the policy more explicit
DROP POLICY IF EXISTS "Users can create couples via Clerk" ON public.clerk_couples;

CREATE POLICY "Users can create couples via Clerk" 
ON public.clerk_couples 
FOR INSERT 
WITH CHECK (
  (auth.jwt() ->> 'sub'::text) IS NOT NULL 
  AND (created_by = (auth.jwt() ->> 'sub'::text))
);
-- Update ALL RLS policies to use the correct Clerk JWT claims method
-- Drop existing policies first
DROP POLICY IF EXISTS "Users can create couples via Clerk" ON public.clerk_couples;
DROP POLICY IF EXISTS "Members can view their couples via Clerk" ON public.clerk_couples;
DROP POLICY IF EXISTS "Members can update their couples via Clerk" ON public.clerk_couples;
DROP POLICY IF EXISTS "Owners can delete their couples via Clerk" ON public.clerk_couples;
DROP POLICY IF EXISTS "Users can view their memberships via Clerk" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "Users can insert memberships via Clerk" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "Owners can manage members via Clerk" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "Clerk couple members can create invites" ON public.invites;
DROP POLICY IF EXISTS "Clerk users can view invites they sent" ON public.invites;
DROP POLICY IF EXISTS "Clerk couple members can view their couple invites" ON public.invites;
DROP POLICY IF EXISTS "Clerk couple owners can update invites" ON public.invites;
DROP POLICY IF EXISTS "Clerk couple owners can delete invites" ON public.invites;

-- Recreate policies using current_setting() method for Clerk JWT claims
CREATE POLICY "Users can create couples via Clerk" 
ON public.clerk_couples 
FOR INSERT 
WITH CHECK (
  current_setting('request.jwt.claims', true)::json->>'sub' IS NOT NULL 
  AND created_by = current_setting('request.jwt.claims', true)::json->>'sub'
);

CREATE POLICY "Members can view their couples via Clerk" 
ON public.clerk_couples 
FOR SELECT 
USING (is_couple_member(id, current_setting('request.jwt.claims', true)::json->>'sub'));

CREATE POLICY "Members can update their couples via Clerk" 
ON public.clerk_couples 
FOR UPDATE 
USING (is_couple_member(id, current_setting('request.jwt.claims', true)::json->>'sub'));

CREATE POLICY "Owners can delete their couples via Clerk" 
ON public.clerk_couples 
FOR DELETE 
USING (is_couple_owner(id, current_setting('request.jwt.claims', true)::json->>'sub'));

CREATE POLICY "Users can view their memberships via Clerk" 
ON public.clerk_couple_members 
FOR SELECT 
USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "Users can insert memberships via Clerk" 
ON public.clerk_couple_members 
FOR INSERT 
WITH CHECK (
  current_setting('request.jwt.claims', true)::json->>'sub' IS NOT NULL 
  AND user_id = current_setting('request.jwt.claims', true)::json->>'sub'
);

CREATE POLICY "Owners can manage members via Clerk" 
ON public.clerk_couple_members 
FOR ALL 
USING (is_couple_owner(couple_id, current_setting('request.jwt.claims', true)::json->>'sub'));

CREATE POLICY "Clerk couple members can create invites" 
ON public.invites 
FOR INSERT 
WITH CHECK (
  (EXISTS ( 
    SELECT 1 FROM clerk_couple_members m 
    WHERE m.couple_id = invites.couple_id 
    AND m.user_id = current_setting('request.jwt.claims', true)::json->>'sub'
  )) 
  AND (invited_by = current_setting('request.jwt.claims', true)::json->>'sub')
);

CREATE POLICY "Clerk users can view invites they sent" 
ON public.invites 
FOR SELECT 
USING (invited_by = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "Clerk couple members can view their couple invites" 
ON public.invites 
FOR SELECT 
USING (EXISTS ( 
  SELECT 1 FROM clerk_couple_members m 
  WHERE m.couple_id = invites.couple_id 
  AND m.user_id = current_setting('request.jwt.claims', true)::json->>'sub'
));

CREATE POLICY "Clerk couple owners can update invites" 
ON public.invites 
FOR UPDATE 
USING (is_couple_owner(couple_id, current_setting('request.jwt.claims', true)::json->>'sub'));

CREATE POLICY "Clerk couple owners can delete invites" 
ON public.invites 
FOR DELETE 
USING (is_couple_owner(couple_id, current_setting('request.jwt.claims', true)::json->>'sub'));
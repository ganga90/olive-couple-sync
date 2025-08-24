-- Create a function to extract Clerk user ID from JWT
CREATE OR REPLACE FUNCTION public.get_clerk_user_id()
RETURNS TEXT AS $$
BEGIN
  RETURN COALESCE(
    auth.jwt() ->> 'sub',
    current_setting('request.jwt.claims', true)::json ->> 'sub'
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Update all Clerk RLS policies to use the function instead of direct JWT parsing
-- This provides better compatibility with Clerk's JWT format

-- Update clerk_couples policies
DROP POLICY IF EXISTS "Users can create couples via Clerk" ON public.clerk_couples;
DROP POLICY IF EXISTS "Members can view their couples via Clerk" ON public.clerk_couples;
DROP POLICY IF EXISTS "Members can update their couples via Clerk" ON public.clerk_couples;
DROP POLICY IF EXISTS "Owners can delete their couples via Clerk" ON public.clerk_couples;

CREATE POLICY "Users can create couples via Clerk" 
ON public.clerk_couples 
FOR INSERT 
WITH CHECK (
  public.get_clerk_user_id() IS NOT NULL 
  AND created_by = public.get_clerk_user_id()
);

CREATE POLICY "Members can view their couples via Clerk" 
ON public.clerk_couples 
FOR SELECT 
USING (is_couple_member(id, public.get_clerk_user_id()));

CREATE POLICY "Members can update their couples via Clerk" 
ON public.clerk_couples 
FOR UPDATE 
USING (is_couple_member(id, public.get_clerk_user_id()));

CREATE POLICY "Owners can delete their couples via Clerk" 
ON public.clerk_couples 
FOR DELETE 
USING (is_couple_owner(id, public.get_clerk_user_id()));

-- Update clerk_couple_members policies  
DROP POLICY IF EXISTS "Users can view their memberships via Clerk" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "Users can insert memberships via Clerk" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "Owners can manage members via Clerk" ON public.clerk_couple_members;

CREATE POLICY "Users can view their memberships via Clerk" 
ON public.clerk_couple_members 
FOR SELECT 
USING (user_id = public.get_clerk_user_id());

CREATE POLICY "Users can insert memberships via Clerk" 
ON public.clerk_couple_members 
FOR INSERT 
WITH CHECK (
  public.get_clerk_user_id() IS NOT NULL 
  AND user_id = public.get_clerk_user_id()
);

CREATE POLICY "Owners can manage members via Clerk" 
ON public.clerk_couple_members 
FOR ALL 
USING (is_couple_owner(couple_id, public.get_clerk_user_id()));

-- Update invites policies
DROP POLICY IF EXISTS "Clerk couple members can create invites" ON public.invites;
DROP POLICY IF EXISTS "Clerk users can view invites they sent" ON public.invites;
DROP POLICY IF EXISTS "Clerk couple members can view their couple invites" ON public.invites;
DROP POLICY IF EXISTS "Clerk couple owners can update invites" ON public.invites;
DROP POLICY IF EXISTS "Clerk couple owners can delete invites" ON public.invites;

CREATE POLICY "Clerk couple members can create invites" 
ON public.invites 
FOR INSERT 
WITH CHECK (
  (EXISTS ( 
    SELECT 1 FROM clerk_couple_members m 
    WHERE m.couple_id = invites.couple_id 
    AND m.user_id = public.get_clerk_user_id()
  )) 
  AND (invited_by = public.get_clerk_user_id())
);

CREATE POLICY "Clerk users can view invites they sent" 
ON public.invites 
FOR SELECT 
USING (invited_by = public.get_clerk_user_id());

CREATE POLICY "Clerk couple members can view their couple invites" 
ON public.invites 
FOR SELECT 
USING (EXISTS ( 
  SELECT 1 FROM clerk_couple_members m 
  WHERE m.couple_id = invites.couple_id 
  AND m.user_id = public.get_clerk_user_id()
));

CREATE POLICY "Clerk couple owners can update invites" 
ON public.invites 
FOR UPDATE 
USING (is_couple_owner(couple_id, public.get_clerk_user_id()));

CREATE POLICY "Clerk couple owners can delete invites" 
ON public.invites 
FOR DELETE 
USING (is_couple_owner(couple_id, public.get_clerk_user_id()));
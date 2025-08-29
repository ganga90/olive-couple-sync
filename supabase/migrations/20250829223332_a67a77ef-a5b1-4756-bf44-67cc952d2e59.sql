-- Drop all existing policies and recreate them consistently
DROP POLICY IF EXISTS "couples.insert" ON public.clerk_couples;
DROP POLICY IF EXISTS "couples.select" ON public.clerk_couples;
DROP POLICY IF EXISTS "couples.update" ON public.clerk_couples;
DROP POLICY IF EXISTS "couples.delete" ON public.clerk_couples;
DROP POLICY IF EXISTS "Members can update their couples via Clerk" ON public.clerk_couples;
DROP POLICY IF EXISTS "Members can view their couples via Clerk" ON public.clerk_couples;
DROP POLICY IF EXISTS "Owners can delete their couples via Clerk" ON public.clerk_couples;

ALTER TABLE public.clerk_couples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "couples.insert" ON public.clerk_couples
FOR INSERT TO authenticated
WITH CHECK ( created_by IS NULL OR created_by = auth.jwt()->>'sub' );

CREATE POLICY "couples.select" ON public.clerk_couples
FOR SELECT TO authenticated
USING ( public.is_couple_member(id) );

CREATE POLICY "couples.update" ON public.clerk_couples
FOR UPDATE TO authenticated
USING ( public.is_couple_member(id) )
WITH CHECK ( public.is_couple_member(id) );

CREATE POLICY "couples.delete" ON public.clerk_couples
FOR DELETE TO authenticated
USING ( public.is_couple_owner(id) );

-- clerk_couple_members policies
DROP POLICY IF EXISTS "memberships.insert" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "memberships.select.mine" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "memberships.manage" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "Members can view couple memberships via Clerk" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "Owners can manage members via Clerk" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "Users can insert memberships via Clerk" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "Users can view their memberships via Clerk" ON public.clerk_couple_members;

ALTER TABLE public.clerk_couple_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "memberships.insert" ON public.clerk_couple_members
FOR INSERT TO authenticated
WITH CHECK ( user_id = auth.jwt()->>'sub' );

CREATE POLICY "memberships.select.mine" ON public.clerk_couple_members
FOR SELECT TO authenticated
USING ( user_id = auth.jwt()->>'sub' OR public.is_couple_member(couple_id) );

CREATE POLICY "memberships.manage" ON public.clerk_couple_members
FOR ALL TO authenticated
USING ( public.is_couple_owner(couple_id) )
WITH CHECK ( public.is_couple_owner(couple_id) );

-- invites policies  
DROP POLICY IF EXISTS "invites.insert" ON public.invites;
DROP POLICY IF EXISTS "invites.select" ON public.invites;
DROP POLICY IF EXISTS "invites.update" ON public.invites;
DROP POLICY IF EXISTS "invites.delete" ON public.invites;
DROP POLICY IF EXISTS "invites.by_token" ON public.invites;
DROP POLICY IF EXISTS "Couple members can view couple invites" ON public.invites;
DROP POLICY IF EXISTS "Owners can delete invites" ON public.invites;
DROP POLICY IF EXISTS "Owners can manage invites" ON public.invites;
DROP POLICY IF EXISTS "Public can view invites by token" ON public.invites;
DROP POLICY IF EXISTS "Users can create invites for their couples" ON public.invites;
DROP POLICY IF EXISTS "Users can view invites they created" ON public.invites;

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invites.insert" ON public.invites
FOR INSERT TO authenticated
WITH CHECK ( invited_by = auth.jwt()->>'sub' AND public.is_couple_member(couple_id) );

CREATE POLICY "invites.select" ON public.invites
FOR SELECT TO authenticated
USING ( invited_by = auth.jwt()->>'sub' OR public.is_couple_member(couple_id) );

CREATE POLICY "invites.update" ON public.invites
FOR UPDATE TO authenticated
USING ( public.is_couple_owner(couple_id) )
WITH CHECK ( public.is_couple_owner(couple_id) );

CREATE POLICY "invites.delete" ON public.invites
FOR DELETE TO authenticated
USING ( public.is_couple_owner(couple_id) );

CREATE POLICY "invites.by_token" ON public.invites
FOR SELECT TO anon, authenticated
USING ( token IS NOT NULL );
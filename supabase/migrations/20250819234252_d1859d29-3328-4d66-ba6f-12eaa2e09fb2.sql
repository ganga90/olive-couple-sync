-- Step 2: Update Database Schema for New Clerk-Supabase Integration

-- 1. Drop custom functions that are no longer needed
DROP FUNCTION IF EXISTS public.get_clerk_user_id();
DROP FUNCTION IF EXISTS public.debug_jwt_claims();

-- 2. Update table structures: Change text columns to uuid for Clerk user IDs

-- Update clerk_profiles table
ALTER TABLE public.clerk_profiles 
  ALTER COLUMN id TYPE uuid USING id::uuid;

-- Update clerk_couple_members table  
ALTER TABLE public.clerk_couple_members
  ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

-- Update invites table
ALTER TABLE public.invites
  ALTER COLUMN invited_by TYPE uuid USING invited_by::uuid;

-- 3. Update all RLS policies to use auth.uid() instead of get_clerk_user_id()

-- Update clerk_profiles policies
DROP POLICY IF EXISTS "Clerk profiles are viewable by owner" ON public.clerk_profiles;
DROP POLICY IF EXISTS "Users can update own clerk profile" ON public.clerk_profiles;

CREATE POLICY "Clerk profiles are viewable by owner" 
ON public.clerk_profiles 
FOR SELECT 
USING (id = auth.uid());

CREATE POLICY "Users can update own clerk profile" 
ON public.clerk_profiles 
FOR UPDATE 
USING (id = auth.uid());

-- Update clerk_couple_members policies
DROP POLICY IF EXISTS "Users can view their clerk memberships" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "Owners can add clerk members" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "Owners can update clerk members" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "Owners can remove clerk members" ON public.clerk_couple_members;

CREATE POLICY "Users can view their clerk memberships" 
ON public.clerk_couple_members 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "Owners can add clerk members" 
ON public.clerk_couple_members 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m 
    WHERE m.couple_id = clerk_couple_members.couple_id 
    AND m.user_id = auth.uid() 
    AND m.role = 'owner'::member_role
  )
);

CREATE POLICY "Owners can update clerk members" 
ON public.clerk_couple_members 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m 
    WHERE m.couple_id = clerk_couple_members.couple_id 
    AND m.user_id = auth.uid() 
    AND m.role = 'owner'::member_role
  )
);

CREATE POLICY "Owners can remove clerk members" 
ON public.clerk_couple_members 
FOR DELETE 
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m 
    WHERE m.couple_id = clerk_couple_members.couple_id 
    AND m.user_id = auth.uid() 
    AND m.role = 'owner'::member_role
  )
);

-- Update clerk_couples policies
DROP POLICY IF EXISTS "Members can view their clerk couples" ON public.clerk_couples;
DROP POLICY IF EXISTS "Members can update their clerk couples" ON public.clerk_couples;
DROP POLICY IF EXISTS "Owners can delete their clerk couples" ON public.clerk_couples;

CREATE POLICY "Members can view their clerk couples" 
ON public.clerk_couples 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m 
    WHERE m.couple_id = clerk_couples.id 
    AND m.user_id = auth.uid()
  )
);

CREATE POLICY "Members can update their clerk couples" 
ON public.clerk_couples 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m 
    WHERE m.couple_id = clerk_couples.id 
    AND m.user_id = auth.uid()
  )
);

CREATE POLICY "Owners can delete their clerk couples" 
ON public.clerk_couples 
FOR DELETE 
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m 
    WHERE m.couple_id = clerk_couples.id 
    AND m.user_id = auth.uid() 
    AND m.role = 'owner'::member_role
  )
);

-- Update clerk_notes policies
DROP POLICY IF EXISTS "Members can view clerk notes in their couples" ON public.clerk_notes;
DROP POLICY IF EXISTS "Members can update clerk notes in their couples" ON public.clerk_notes;
DROP POLICY IF EXISTS "Members can delete clerk notes in their couples" ON public.clerk_notes;

CREATE POLICY "Members can view clerk notes in their couples" 
ON public.clerk_notes 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m 
    WHERE m.couple_id = clerk_notes.couple_id 
    AND m.user_id = auth.uid()
  )
);

CREATE POLICY "Members can update clerk notes in their couples" 
ON public.clerk_notes 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m 
    WHERE m.couple_id = clerk_notes.couple_id 
    AND m.user_id = auth.uid()
  )
);

CREATE POLICY "Members can delete clerk notes in their couples" 
ON public.clerk_notes 
FOR DELETE 
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m 
    WHERE m.couple_id = clerk_notes.couple_id 
    AND m.user_id = auth.uid()
  )
);

-- Update invites policies
DROP POLICY IF EXISTS "Clerk users can view invites they sent" ON public.invites;
DROP POLICY IF EXISTS "Clerk couple members can view their couple invites" ON public.invites;
DROP POLICY IF EXISTS "Clerk couple owners can create invites" ON public.invites;
DROP POLICY IF EXISTS "Clerk couple owners can update invites" ON public.invites;
DROP POLICY IF EXISTS "Clerk couple owners can delete invites" ON public.invites;

CREATE POLICY "Clerk users can view invites they sent" 
ON public.invites 
FOR SELECT 
USING (invited_by = auth.uid());

CREATE POLICY "Clerk couple members can view their couple invites" 
ON public.invites 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m 
    WHERE m.couple_id = invites.couple_id 
    AND m.user_id = auth.uid()
  )
);

CREATE POLICY "Clerk couple owners can create invites" 
ON public.invites 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m 
    WHERE m.couple_id = invites.couple_id 
    AND m.user_id = auth.uid() 
    AND m.role = 'owner'::member_role
  ) 
  AND invited_by = auth.uid()
);

CREATE POLICY "Clerk couple owners can update invites" 
ON public.invites 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m 
    WHERE m.couple_id = invites.couple_id 
    AND m.user_id = auth.uid() 
    AND m.role = 'owner'::member_role
  )
);

CREATE POLICY "Clerk couple owners can delete invites" 
ON public.invites 
FOR DELETE 
USING (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m 
    WHERE m.couple_id = invites.couple_id 
    AND m.user_id = auth.uid() 
    AND m.role = 'owner'::member_role
  )
);

-- Update the add_clerk_creator_as_member trigger function to use auth.uid()
CREATE OR REPLACE FUNCTION public.add_clerk_creator_as_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
begin
  if new.created_by is not null then
    insert into public.clerk_couple_members (couple_id, user_id, role)
    values (new.id, new.created_by, 'owner'::member_role)
    on conflict do nothing;
  end if;
  return new;
end;
$function$;
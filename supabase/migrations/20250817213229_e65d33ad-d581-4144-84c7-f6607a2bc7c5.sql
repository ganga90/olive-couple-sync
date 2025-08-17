-- Update profiles table to use Clerk user IDs
ALTER TABLE public.profiles ALTER COLUMN id TYPE text;

-- Create a function to get the current Clerk user ID from JWT
CREATE OR REPLACE FUNCTION auth.clerk_user_id() RETURNS text AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::json->>'sub',
    current_setting('request.jwt.claims', true)::json->>'user_id'
  );
$$ LANGUAGE sql STABLE;

-- Update RLS policies for profiles table to use Clerk authentication
DROP POLICY IF EXISTS "Profiles are viewable by owner" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Profiles are viewable by owner"
ON public.profiles FOR SELECT
USING (id = auth.clerk_user_id());

CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT
WITH CHECK (id = auth.clerk_user_id());

CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
USING (id = auth.clerk_user_id());

-- Update couples table to use text for created_by
ALTER TABLE public.couples ALTER COLUMN created_by TYPE text;

-- Update couple_members table to use text for user_id
ALTER TABLE public.couple_members ALTER COLUMN user_id TYPE text;

-- Update notes table to use text for author_id
ALTER TABLE public.notes ALTER COLUMN author_id TYPE text;

-- Update invites table to use text for invited_by
ALTER TABLE public.invites ALTER COLUMN invited_by TYPE text;

-- Update RLS policies for couples table
DROP POLICY IF EXISTS "Users can create couples" ON public.couples;
DROP POLICY IF EXISTS "Members can view their couples" ON public.couples;
DROP POLICY IF EXISTS "Members can update their couples" ON public.couples;
DROP POLICY IF EXISTS "Owners can delete their couples" ON public.couples;

CREATE POLICY "Users can create couples"
ON public.couples FOR INSERT
WITH CHECK (created_by = auth.clerk_user_id());

CREATE POLICY "Members can view their couples"
ON public.couples FOR SELECT
USING (EXISTS (
  SELECT 1 FROM couple_members m
  WHERE m.couple_id = couples.id AND m.user_id = auth.clerk_user_id()
));

CREATE POLICY "Members can update their couples"
ON public.couples FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM couple_members m
  WHERE m.couple_id = couples.id AND m.user_id = auth.clerk_user_id()
));

CREATE POLICY "Owners can delete their couples"
ON public.couples FOR DELETE
USING (EXISTS (
  SELECT 1 FROM couple_members m
  WHERE m.couple_id = couples.id AND m.user_id = auth.clerk_user_id() AND m.role = 'owner'::member_role
));

-- Update RLS policies for couple_members table
DROP POLICY IF EXISTS "Users can view their memberships" ON public.couple_members;
DROP POLICY IF EXISTS "Owners can add members" ON public.couple_members;
DROP POLICY IF EXISTS "Owners can update members" ON public.couple_members;
DROP POLICY IF EXISTS "Owners can remove members" ON public.couple_members;

CREATE POLICY "Users can view their memberships"
ON public.couple_members FOR SELECT
USING (user_id = auth.clerk_user_id());

CREATE POLICY "Owners can add members"
ON public.couple_members FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM couple_members m
  WHERE m.couple_id = couple_members.couple_id AND m.user_id = auth.clerk_user_id() AND m.role = 'owner'::member_role
));

CREATE POLICY "Owners can update members"
ON public.couple_members FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM couple_members m
  WHERE m.couple_id = couple_members.couple_id AND m.user_id = auth.clerk_user_id() AND m.role = 'owner'::member_role
));

CREATE POLICY "Owners can remove members"
ON public.couple_members FOR DELETE
USING (EXISTS (
  SELECT 1 FROM couple_members m
  WHERE m.couple_id = couple_members.couple_id AND m.user_id = auth.clerk_user_id() AND m.role = 'owner'::member_role
));

-- Update RLS policies for notes table
DROP POLICY IF EXISTS "Members can view notes in their couples" ON public.notes;
DROP POLICY IF EXISTS "Members can insert notes in their couples" ON public.notes;
DROP POLICY IF EXISTS "Members can update notes in their couples" ON public.notes;
DROP POLICY IF EXISTS "Members can delete notes in their couples" ON public.notes;

CREATE POLICY "Members can view notes in their couples"
ON public.notes FOR SELECT
USING (EXISTS (
  SELECT 1 FROM couple_members m
  WHERE m.couple_id = notes.couple_id AND m.user_id = auth.clerk_user_id()
));

CREATE POLICY "Members can insert notes in their couples"
ON public.notes FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM couple_members m
    WHERE m.couple_id = notes.couple_id AND m.user_id = auth.clerk_user_id()
  ) AND author_id = auth.clerk_user_id()
);

CREATE POLICY "Members can update notes in their couples"
ON public.notes FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM couple_members m
  WHERE m.couple_id = notes.couple_id AND m.user_id = auth.clerk_user_id()
));

CREATE POLICY "Members can delete notes in their couples"
ON public.notes FOR DELETE
USING (EXISTS (
  SELECT 1 FROM couple_members m
  WHERE m.couple_id = notes.couple_id AND m.user_id = auth.clerk_user_id()
));

-- Update RLS policies for invites table
DROP POLICY IF EXISTS "Inviter can view invite" ON public.invites;
DROP POLICY IF EXISTS "Owners can manage invites" ON public.invites;

CREATE POLICY "Inviter can view invite"
ON public.invites FOR SELECT
USING (invited_by = auth.clerk_user_id());

CREATE POLICY "Owners can manage invites"
ON public.invites FOR ALL
USING (EXISTS (
  SELECT 1 FROM couple_members m
  WHERE m.couple_id = invites.couple_id AND m.user_id = auth.clerk_user_id() AND m.role = 'owner'::member_role
))
WITH CHECK (EXISTS (
  SELECT 1 FROM couple_members m
  WHERE m.couple_id = invites.couple_id AND m.user_id = auth.clerk_user_id() AND m.role = 'owner'::member_role
));
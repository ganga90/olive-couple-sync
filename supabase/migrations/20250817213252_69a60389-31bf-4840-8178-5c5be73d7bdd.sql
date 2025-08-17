-- First, drop all existing RLS policies that depend on the columns we're changing

-- Drop policies for profiles table
DROP POLICY IF EXISTS "Profiles are viewable by owner" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Drop policies for couples table
DROP POLICY IF EXISTS "Users can create couples" ON public.couples;
DROP POLICY IF EXISTS "Members can view their couples" ON public.couples;
DROP POLICY IF EXISTS "Members can update their couples" ON public.couples;
DROP POLICY IF EXISTS "Owners can delete their couples" ON public.couples;

-- Drop policies for couple_members table
DROP POLICY IF EXISTS "Users can view their memberships" ON public.couple_members;
DROP POLICY IF EXISTS "Owners can add members" ON public.couple_members;
DROP POLICY IF EXISTS "Owners can update members" ON public.couple_members;
DROP POLICY IF EXISTS "Owners can remove members" ON public.couple_members;

-- Drop policies for notes table
DROP POLICY IF EXISTS "Members can view notes in their couples" ON public.notes;
DROP POLICY IF EXISTS "Members can insert notes in their couples" ON public.notes;
DROP POLICY IF EXISTS "Members can update notes in their couples" ON public.notes;
DROP POLICY IF EXISTS "Members can delete notes in their couples" ON public.notes;

-- Drop policies for invites table
DROP POLICY IF EXISTS "Inviter can view invite" ON public.invites;
DROP POLICY IF EXISTS "Owners can manage invites" ON public.invites;

-- Now update the column types to support Clerk user IDs (text instead of UUID)
ALTER TABLE public.profiles ALTER COLUMN id TYPE text;
ALTER TABLE public.couples ALTER COLUMN created_by TYPE text;
ALTER TABLE public.couple_members ALTER COLUMN user_id TYPE text;
ALTER TABLE public.notes ALTER COLUMN author_id TYPE text;
ALTER TABLE public.invites ALTER COLUMN invited_by TYPE text;

-- Create a function to get the current Clerk user ID from JWT
CREATE OR REPLACE FUNCTION auth.clerk_user_id() RETURNS text AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::json->>'sub',
    current_setting('request.jwt.claims', true)::json->>'user_id'
  );
$$ LANGUAGE sql STABLE;
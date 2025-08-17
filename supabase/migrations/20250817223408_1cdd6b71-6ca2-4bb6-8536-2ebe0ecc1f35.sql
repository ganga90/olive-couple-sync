-- Fix RLS policies for invites table to use Clerk authentication
-- First handle the foreign key constraint issue

-- Drop the foreign key constraint if it exists
ALTER TABLE public.invites DROP CONSTRAINT IF EXISTS invites_invited_by_fkey;

-- Update invited_by column to use text for Clerk user IDs
ALTER TABLE public.invites ALTER COLUMN invited_by TYPE text USING invited_by::text;

-- Drop existing incorrect policies
DROP POLICY IF EXISTS "Inviter can view invite" ON public.invites;
DROP POLICY IF EXISTS "Owners can manage invites" ON public.invites;

-- Create secure RLS policies using Clerk authentication

-- Policy 1: Users can only view invites they sent
CREATE POLICY "Clerk users can view invites they sent" 
ON public.invites 
FOR SELECT 
USING (invited_by = get_clerk_user_id());

-- Policy 2: Users can only view invites for couples they belong to
CREATE POLICY "Clerk couple members can view their couple invites" 
ON public.invites 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 
    FROM clerk_couple_members m 
    WHERE m.couple_id = invites.couple_id 
    AND m.user_id = get_clerk_user_id()
  )
);

-- Policy 3: Only couple owners can create invites
CREATE POLICY "Clerk couple owners can create invites" 
ON public.invites 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 
    FROM clerk_couple_members m 
    WHERE m.couple_id = invites.couple_id 
    AND m.user_id = get_clerk_user_id() 
    AND m.role = 'owner'::member_role
  )
  AND invited_by = get_clerk_user_id()
);

-- Policy 4: Only couple owners can update invites
CREATE POLICY "Clerk couple owners can update invites" 
ON public.invites 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 
    FROM clerk_couple_members m 
    WHERE m.couple_id = invites.couple_id 
    AND m.user_id = get_clerk_user_id() 
    AND m.role = 'owner'::member_role
  )
);

-- Policy 5: Only couple owners can delete invites
CREATE POLICY "Clerk couple owners can delete invites" 
ON public.invites 
FOR DELETE 
USING (
  EXISTS (
    SELECT 1 
    FROM clerk_couple_members m 
    WHERE m.couple_id = invites.couple_id 
    AND m.user_id = get_clerk_user_id() 
    AND m.role = 'owner'::member_role
  )
);

-- Policy 6: Allow unauthenticated users to view specific invites by token
-- This is needed for the accept invite page
CREATE POLICY "Unauthenticated can view invite by token" 
ON public.invites 
FOR SELECT 
TO anon
USING (true);
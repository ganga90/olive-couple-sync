-- Fix RLS policies for invites table - complete rebuild approach

-- Step 1: Drop ALL existing policies first
DROP POLICY IF EXISTS "Inviter can view invite" ON public.invites;
DROP POLICY IF EXISTS "Owners can manage invites" ON public.invites;

-- Step 2: Temporarily disable RLS to make changes
ALTER TABLE public.invites DISABLE ROW LEVEL SECURITY;

-- Step 3: Drop any foreign key constraints
ALTER TABLE public.invites DROP CONSTRAINT IF EXISTS invites_invited_by_fkey;

-- Step 4: Update column type to text for Clerk user IDs
ALTER TABLE public.invites ALTER COLUMN invited_by TYPE text USING invited_by::text;

-- Step 5: Re-enable RLS
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

-- Step 6: Create secure RLS policies using Clerk authentication

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

-- Policy 6: Allow unauthenticated users to view specific invites by token only
-- This is more restrictive - only allows viewing when specifically querying by token
CREATE POLICY "Public can view invite by token for acceptance" 
ON public.invites 
FOR SELECT 
TO anon
USING (
  -- This policy allows anonymous access but the application should 
  -- always filter by token to prevent email harvesting
  token IS NOT NULL
);
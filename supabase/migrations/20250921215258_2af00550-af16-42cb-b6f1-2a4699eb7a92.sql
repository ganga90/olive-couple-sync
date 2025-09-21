-- Add unique constraint to clerk_couple_members table to prevent duplicate memberships
-- This is required for the ON CONFLICT clause in accept_invite function

ALTER TABLE public.clerk_couple_members 
ADD CONSTRAINT clerk_couple_members_couple_user_unique 
UNIQUE (couple_id, user_id);
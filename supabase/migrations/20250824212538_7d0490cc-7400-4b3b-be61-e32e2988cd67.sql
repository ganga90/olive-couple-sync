-- Fix foreign key constraint in invites table to point to clerk_couples instead of couples

-- First, drop the existing foreign key constraint
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_couple_id_fkey;

-- Add the correct foreign key constraint pointing to clerk_couples
ALTER TABLE invites ADD CONSTRAINT invites_couple_id_fkey 
  FOREIGN KEY (couple_id) REFERENCES clerk_couples(id) ON DELETE CASCADE;
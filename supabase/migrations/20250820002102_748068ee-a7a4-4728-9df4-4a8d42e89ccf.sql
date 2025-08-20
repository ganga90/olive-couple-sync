-- Step 3: Alter column types from UUID to TEXT for Clerk user IDs

-- Update clerk_profiles table
ALTER TABLE clerk_profiles ALTER COLUMN id TYPE text;

-- Update clerk_couple_members table  
ALTER TABLE clerk_couple_members ALTER COLUMN user_id TYPE text;

-- Update clerk_couples table
ALTER TABLE clerk_couples ALTER COLUMN created_by TYPE text;

-- Update clerk_notes table
ALTER TABLE clerk_notes ALTER COLUMN author_id TYPE text;
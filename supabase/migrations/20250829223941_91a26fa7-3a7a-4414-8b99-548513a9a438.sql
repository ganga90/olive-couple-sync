-- Add task_owner column to clerk_notes if it doesn't exist
ALTER TABLE public.clerk_notes ADD COLUMN IF NOT EXISTS task_owner text;
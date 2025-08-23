-- Add task_owner field to clerk_notes table
ALTER TABLE public.clerk_notes 
ADD COLUMN task_owner text;

-- Set default task_owner to be the same as author_id for existing notes
UPDATE public.clerk_notes 
SET task_owner = author_id 
WHERE task_owner IS NULL;
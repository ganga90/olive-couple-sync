-- Add reminder_time field to clerk_notes table
ALTER TABLE clerk_notes ADD COLUMN IF NOT EXISTS reminder_time timestamp with time zone;

-- Add index for efficient reminder queries
CREATE INDEX IF NOT EXISTS idx_clerk_notes_reminder_time ON clerk_notes(reminder_time) WHERE reminder_time IS NOT NULL AND completed = false;
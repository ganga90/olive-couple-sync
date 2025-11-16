-- Add field to track automatic due date reminders
ALTER TABLE clerk_notes 
ADD COLUMN IF NOT EXISTS auto_reminders_sent text[] DEFAULT '{}';

COMMENT ON COLUMN clerk_notes.auto_reminders_sent IS 'Tracks which automatic due date reminders have been sent (e.g., ["24h", "2h"])';
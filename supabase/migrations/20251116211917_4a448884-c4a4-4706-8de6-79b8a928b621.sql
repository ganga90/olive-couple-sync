-- Add recurring reminder fields to clerk_notes
ALTER TABLE clerk_notes
ADD COLUMN IF NOT EXISTS recurrence_frequency text CHECK (recurrence_frequency IN ('none', 'daily', 'weekly', 'monthly', 'yearly')),
ADD COLUMN IF NOT EXISTS recurrence_interval integer DEFAULT 1,
ADD COLUMN IF NOT EXISTS last_reminded_at timestamp with time zone;

-- Set default for existing rows
UPDATE clerk_notes
SET recurrence_frequency = 'none'
WHERE recurrence_frequency IS NULL;

-- Create index for efficient recurring reminder queries
CREATE INDEX IF NOT EXISTS idx_clerk_notes_recurring ON clerk_notes(reminder_time, recurrence_frequency) WHERE reminder_time IS NOT NULL AND completed = false;
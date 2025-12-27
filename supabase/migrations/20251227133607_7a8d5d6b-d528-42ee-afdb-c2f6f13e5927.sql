-- Add user preferences for calendar visibility and auto-add
ALTER TABLE calendar_connections
ADD COLUMN IF NOT EXISTS show_google_events boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS auto_add_to_calendar boolean DEFAULT true;
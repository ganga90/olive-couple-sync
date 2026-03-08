ALTER TABLE public.olive_user_preferences
ADD COLUMN IF NOT EXISTS reminder_advance_intervals text[] NOT NULL DEFAULT '{}'::text[];
-- Add missing time columns to olive_user_preferences for heartbeat scheduling
ALTER TABLE public.olive_user_preferences
  ADD COLUMN IF NOT EXISTS morning_briefing_time TEXT DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS evening_review_time TEXT DEFAULT '20:00',
  ADD COLUMN IF NOT EXISTS weekly_summary_time TEXT DEFAULT '10:00',
  ADD COLUMN IF NOT EXISTS weekly_summary_day INTEGER DEFAULT 0;

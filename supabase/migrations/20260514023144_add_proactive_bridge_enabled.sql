-- Add proactive_bridge_enabled to olive_user_preferences.
--
-- Per-user opt-in for the "proactive bridge on brain-dump confirmation"
-- feature: after a brain-dump CREATE that saved a task with NO due_date
-- and NO reminder_time, Olive appends a single bounded offer ("Want me
-- to set a date?") and waits for the next message. If it parses as a
-- date, she applies it. If not, the offer expires (5-min TTL) and the
-- message is processed normally.
--
-- Default `false` so existing users see ZERO behavior change until
-- they opt in. New users follow the same default — opt-in keeps the
-- core brand promise ("brain dump > automate") intact, only adding
-- dialogue when the user invites it.
--
-- Schema is additive — no existing query needs to change, no RLS
-- update required (RLS on olive_user_preferences already scopes to
-- user_id; the new column rides on the same policy).

ALTER TABLE public.olive_user_preferences
  ADD COLUMN IF NOT EXISTS proactive_bridge_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.olive_user_preferences.proactive_bridge_enabled IS
  'Opt-in: after a brain-dump CREATE with no date / reminder, Olive offers a single bounded date/reminder bridge. Default false.';

-- DOWN:
-- ALTER TABLE public.olive_user_preferences DROP COLUMN IF EXISTS proactive_bridge_enabled;

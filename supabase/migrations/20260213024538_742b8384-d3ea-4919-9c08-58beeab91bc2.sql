-- Fix olive_outbound_queue and olive_heartbeat_log schemas

-- 1. olive_outbound_queue fixes
DO $$ BEGIN
  ALTER TABLE public.olive_outbound_queue DROP CONSTRAINT IF EXISTS olive_outbound_queue_message_type_check;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '%', SQLERRM; END $$;

ALTER TABLE public.olive_outbound_queue
  ADD CONSTRAINT olive_outbound_queue_message_type_check
  CHECK (message_type IN (
    'proactive', 'reminder', 'notification', 'reply',
    'proactive_nudge', 'morning_briefing', 'evening_review',
    'weekly_summary', 'task_update', 'partner_notification', 'system_alert'
  ));

DO $$ BEGIN
  ALTER TABLE public.olive_outbound_queue ADD COLUMN IF NOT EXISTS content TEXT;
EXCEPTION WHEN duplicate_column THEN RAISE NOTICE 'content exists'; END $$;

DO $$ BEGIN
  ALTER TABLE public.olive_outbound_queue ALTER COLUMN message DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '%', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE public.olive_outbound_queue ALTER COLUMN phone_number DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '%', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE public.olive_outbound_queue DROP CONSTRAINT IF EXISTS olive_outbound_queue_priority_check;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '%', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE public.olive_outbound_queue ADD COLUMN IF NOT EXISTS media_url TEXT;
EXCEPTION WHEN duplicate_column THEN RAISE NOTICE 'media_url exists'; END $$;

DO $$ BEGIN
  ALTER TABLE public.olive_outbound_queue DROP CONSTRAINT IF EXISTS olive_outbound_queue_status_check;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '%', SQLERRM; END $$;

ALTER TABLE public.olive_outbound_queue
  ADD CONSTRAINT olive_outbound_queue_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'cancelled', 'rate_limited'));

-- 2. olive_heartbeat_log fixes
DO $$ BEGIN
  ALTER TABLE public.olive_heartbeat_log DROP CONSTRAINT IF EXISTS olive_heartbeat_log_status_check;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '%', SQLERRM; END $$;

ALTER TABLE public.olive_heartbeat_log
  ADD CONSTRAINT olive_heartbeat_log_status_check
  CHECK (status IN ('success', 'failed', 'skipped', 'sent'));

DO $$ BEGIN
  ALTER TABLE public.olive_heartbeat_log ADD COLUMN IF NOT EXISTS job_type TEXT;
EXCEPTION WHEN duplicate_column THEN RAISE NOTICE 'job_type exists'; END $$;

DO $$ BEGIN
  ALTER TABLE public.olive_heartbeat_log ADD COLUMN IF NOT EXISTS message_preview TEXT;
EXCEPTION WHEN duplicate_column THEN RAISE NOTICE 'message_preview exists'; END $$;

DO $$ BEGIN
  ALTER TABLE public.olive_heartbeat_log ADD COLUMN IF NOT EXISTS channel TEXT;
EXCEPTION WHEN duplicate_column THEN RAISE NOTICE 'channel exists'; END $$;

DO $$ BEGIN
  ALTER TABLE public.olive_heartbeat_log ALTER COLUMN job_id DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '%', SQLERRM; END $$;

DO $$ BEGIN
  ALTER TABLE public.olive_heartbeat_log DROP CONSTRAINT IF EXISTS olive_heartbeat_log_job_id_fkey;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '%', SQLERRM; END $$;

CREATE INDEX IF NOT EXISTS idx_heartbeat_log_user_status
  ON public.olive_heartbeat_log(user_id, status, created_at DESC);
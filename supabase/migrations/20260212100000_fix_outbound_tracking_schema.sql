-- Fix olive_outbound_queue and olive_heartbeat_log schemas
-- so that outbound message logging actually succeeds.
-- Without this, inserts silently fail due to constraint violations,
-- breaking the context-awareness feature (bare replies like "Done!" can't
-- find the recent outbound message they're responding to).

-- ============================================================
-- 1. olive_outbound_queue: relax message_type constraint,
--    add missing 'content' column, make phone_number nullable
-- ============================================================

-- Drop the old restrictive message_type CHECK constraint
DO $$
BEGIN
  -- Try to drop the constraint by common naming patterns
  ALTER TABLE public.olive_outbound_queue DROP CONSTRAINT IF EXISTS olive_outbound_queue_message_type_check;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not drop message_type check: %', SQLERRM;
END $$;

-- Re-add with all the types the gateway actually uses
ALTER TABLE public.olive_outbound_queue
  ADD CONSTRAINT olive_outbound_queue_message_type_check
  CHECK (message_type IN (
    'proactive', 'reminder', 'notification', 'reply',
    'proactive_nudge', 'morning_briefing', 'evening_review',
    'weekly_summary', 'task_update', 'partner_notification', 'system_alert'
  ));

-- Add 'content' column if it doesn't exist (original schema used 'message')
DO $$
BEGIN
  ALTER TABLE public.olive_outbound_queue ADD COLUMN content TEXT;
EXCEPTION WHEN duplicate_column THEN
  RAISE NOTICE 'content column already exists';
END $$;

-- Make 'message' column nullable (code uses 'content' instead)
DO $$
BEGIN
  ALTER TABLE public.olive_outbound_queue ALTER COLUMN message DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not alter message column: %', SQLERRM;
END $$;

-- Make phone_number nullable (gateway doesn't always have it)
DO $$
BEGIN
  ALTER TABLE public.olive_outbound_queue ALTER COLUMN phone_number DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not alter phone_number column: %', SQLERRM;
END $$;

-- Drop priority integer check constraint (code uses text values like 'normal', 'high')
DO $$
BEGIN
  ALTER TABLE public.olive_outbound_queue DROP CONSTRAINT IF EXISTS olive_outbound_queue_priority_check;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not drop priority check: %', SQLERRM;
END $$;

-- Add media_url column if it doesn't exist
DO $$
BEGIN
  ALTER TABLE public.olive_outbound_queue ADD COLUMN media_url TEXT;
EXCEPTION WHEN duplicate_column THEN
  RAISE NOTICE 'media_url column already exists';
END $$;

-- Drop status constraint and re-add with rate_limited
DO $$
BEGIN
  ALTER TABLE public.olive_outbound_queue DROP CONSTRAINT IF EXISTS olive_outbound_queue_status_check;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not drop status check: %', SQLERRM;
END $$;

ALTER TABLE public.olive_outbound_queue
  ADD CONSTRAINT olive_outbound_queue_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'cancelled', 'rate_limited'));

-- ============================================================
-- 2. olive_heartbeat_log: add missing columns, relax status
-- ============================================================

-- Drop the old restrictive status CHECK constraint
DO $$
BEGIN
  ALTER TABLE public.olive_heartbeat_log DROP CONSTRAINT IF EXISTS olive_heartbeat_log_status_check;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not drop status check: %', SQLERRM;
END $$;

-- Re-add with 'sent' included
ALTER TABLE public.olive_heartbeat_log
  ADD CONSTRAINT olive_heartbeat_log_status_check
  CHECK (status IN ('success', 'failed', 'skipped', 'sent'));

-- Add missing columns
DO $$
BEGIN
  ALTER TABLE public.olive_heartbeat_log ADD COLUMN job_type TEXT;
EXCEPTION WHEN duplicate_column THEN
  RAISE NOTICE 'job_type column already exists';
END $$;

DO $$
BEGIN
  ALTER TABLE public.olive_heartbeat_log ADD COLUMN message_preview TEXT;
EXCEPTION WHEN duplicate_column THEN
  RAISE NOTICE 'message_preview column already exists';
END $$;

DO $$
BEGIN
  ALTER TABLE public.olive_heartbeat_log ADD COLUMN channel TEXT;
EXCEPTION WHEN duplicate_column THEN
  RAISE NOTICE 'channel column already exists';
END $$;

-- Make job_id nullable (heartbeat inserts from edge functions don't always have a job_id)
ALTER TABLE public.olive_heartbeat_log ALTER COLUMN job_id DROP NOT NULL;

-- Drop foreign key on job_id if it exists (edge functions insert without a job)
DO $$
BEGIN
  ALTER TABLE public.olive_heartbeat_log DROP CONSTRAINT IF EXISTS olive_heartbeat_log_job_id_fkey;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not drop job_id foreign key: %', SQLERRM;
END $$;

-- Index for quick lookups of recent outbound by user
CREATE INDEX IF NOT EXISTS idx_heartbeat_log_user_status
  ON public.olive_heartbeat_log(user_id, status, created_at DESC);

-- ============================================================================
-- FEATURE 3: Daily Pulse - Database Schema
-- ============================================================================
-- Tables for:
-- - Wishlist with price tracking
-- - Important dates with reminder scheduling
-- - Centralized notifications system
-- - System logs for debugging and monitoring
-- ============================================================================

-- ============================================================================
-- WISHLIST TABLE
-- Tracks items users want to buy with price monitoring
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.wishlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  couple_id UUID REFERENCES public.clerk_couples(id) ON DELETE SET NULL,

  -- Item details
  item_name TEXT NOT NULL,
  item_url TEXT,
  source TEXT,  -- amazon, walmart, target, etc.

  -- Price tracking
  original_price NUMERIC(12, 2),  -- Price when first added
  current_price NUMERIC(12, 2),
  target_price NUMERIC(12, 2),  -- Alert when price drops below this
  currency TEXT DEFAULT 'USD',

  -- Price history (array of {date, price})
  price_history JSONB DEFAULT '[]',
  last_checked_at TIMESTAMPTZ,

  -- Status
  is_active BOOLEAN DEFAULT true,
  is_purchased BOOLEAN DEFAULT false,
  purchased_at TIMESTAMPTZ,
  purchased_price NUMERIC(12, 2),

  -- Additional info
  image_url TEXT,
  notes TEXT,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  category TEXT,

  -- Source tracking
  source_note_id UUID REFERENCES public.clerk_notes(id) ON DELETE SET NULL,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wishlist_user_id ON public.wishlist(user_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_couple_id ON public.wishlist(couple_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_active ON public.wishlist(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_wishlist_source ON public.wishlist(source);
CREATE INDEX IF NOT EXISTS idx_wishlist_has_target ON public.wishlist(user_id)
  WHERE is_active = true AND target_price IS NOT NULL;

-- ============================================================================
-- IMPORTANT_DATES TABLE
-- Tracks birthdays, anniversaries, holidays with smart reminders
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.important_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,  -- Owner of the date
  couple_id UUID REFERENCES public.clerk_couples(id) ON DELETE SET NULL,
  partner_user_id TEXT,  -- Partner to notify (for anniversary reminders)

  -- Event details
  event_name TEXT NOT NULL,
  event_date DATE NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'anniversary', 'birthday', 'holiday', 'memorial', 'custom'
  )),

  -- Recurrence
  recurrence TEXT DEFAULT 'yearly' CHECK (recurrence IN ('none', 'yearly')),

  -- Reminder settings (days before to remind)
  reminder_days INT[] DEFAULT '{14, 3}',  -- Default: 2 weeks and 3 days before
  last_reminded_at TIMESTAMPTZ,
  last_reminded_days INT,  -- Which reminder tier was last sent

  -- Additional info
  notes TEXT,
  gift_ideas TEXT[],
  related_person TEXT,  -- e.g., "Mom", "Partner", "Friend John"

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_important_dates_user_id ON public.important_dates(user_id);
CREATE INDEX IF NOT EXISTS idx_important_dates_couple_id ON public.important_dates(couple_id);
CREATE INDEX IF NOT EXISTS idx_important_dates_event_date ON public.important_dates(event_date);
CREATE INDEX IF NOT EXISTS idx_important_dates_type ON public.important_dates(event_type);
CREATE INDEX IF NOT EXISTS idx_important_dates_partner ON public.important_dates(partner_user_id)
  WHERE partner_user_id IS NOT NULL;

-- Composite index for recurring date lookup (month-day pattern)
CREATE INDEX IF NOT EXISTS idx_important_dates_month_day ON public.important_dates(
  EXTRACT(MONTH FROM event_date),
  EXTRACT(DAY FROM event_date)
) WHERE recurrence = 'yearly';

-- ============================================================================
-- NOTIFICATIONS TABLE
-- Centralized notification system for all app notifications
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  couple_id UUID REFERENCES public.clerk_couples(id) ON DELETE SET NULL,

  -- Notification content
  type TEXT NOT NULL,  -- price_drop, date_reminder, weather_suggestion, stale_task, budget_warning, etc.
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_url TEXT,  -- Deep link or external URL

  -- Priority and state
  priority INT DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),  -- 1=lowest, 10=highest
  is_read BOOLEAN DEFAULT false,
  is_dismissed BOOLEAN DEFAULT false,
  is_actioned BOOLEAN DEFAULT false,  -- User took the suggested action

  -- Delivery tracking
  delivered_via TEXT[],  -- ['app', 'whatsapp', 'email']
  delivered_at TIMESTAMPTZ,

  -- Reference to source
  source_type TEXT,  -- 'wishlist', 'important_date', 'task', 'budget', etc.
  source_id UUID,  -- ID of the source record

  -- Extended metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ  -- Optional expiration for time-sensitive notifications
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_couple_id ON public.notifications(couple_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON public.notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(user_id, is_read, created_at DESC)
  WHERE is_read = false AND is_dismissed = false;
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON public.notifications(user_id, priority DESC, created_at DESC)
  WHERE is_dismissed = false;
CREATE INDEX IF NOT EXISTS idx_notifications_source ON public.notifications(source_type, source_id);

-- ============================================================================
-- SYSTEM_LOGS TABLE
-- Logs for debugging cron jobs, edge functions, and system operations
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.system_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Job identification
  job_type TEXT NOT NULL,  -- 'daily-pulse', 'olive-heartbeat', 'process-receipt', etc.
  module TEXT NOT NULL,  -- 'wishlist_monitor', 'relationship_radar', 'weekend_planner', etc.
  execution_id UUID,  -- Groups logs from same execution

  -- Status
  status TEXT NOT NULL CHECK (status IN ('started', 'running', 'completed', 'failed', 'skipped')),
  error_message TEXT,
  error_stack TEXT,

  -- Details
  details JSONB DEFAULT '{}',  -- Flexible storage for job-specific data
  user_ids_affected TEXT[],  -- Which users were processed

  -- Performance
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_system_logs_job_type ON public.system_logs(job_type);
CREATE INDEX IF NOT EXISTS idx_system_logs_module ON public.system_logs(module);
CREATE INDEX IF NOT EXISTS idx_system_logs_execution_id ON public.system_logs(execution_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_status ON public.system_logs(status);
CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON public.system_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_failed ON public.system_logs(job_type, created_at DESC)
  WHERE status = 'failed';

-- ============================================================================
-- ROW LEVEL SECURITY - WISHLIST
-- ============================================================================
ALTER TABLE public.wishlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wishlist.select" ON public.wishlist
  FOR SELECT TO authenticated
  USING (
    user_id = auth.jwt()->>'sub'
    OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id))
  );

CREATE POLICY "wishlist.insert" ON public.wishlist
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.jwt()->>'sub');

CREATE POLICY "wishlist.update" ON public.wishlist
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.jwt()->>'sub'
    OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id))
  )
  WITH CHECK (
    user_id = auth.jwt()->>'sub'
    OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id))
  );

CREATE POLICY "wishlist.delete" ON public.wishlist
  FOR DELETE TO authenticated
  USING (user_id = auth.jwt()->>'sub');

-- ============================================================================
-- ROW LEVEL SECURITY - IMPORTANT_DATES
-- ============================================================================
ALTER TABLE public.important_dates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "important_dates.select" ON public.important_dates
  FOR SELECT TO authenticated
  USING (
    user_id = auth.jwt()->>'sub'
    OR partner_user_id = auth.jwt()->>'sub'
    OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id))
  );

CREATE POLICY "important_dates.insert" ON public.important_dates
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.jwt()->>'sub');

CREATE POLICY "important_dates.update" ON public.important_dates
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.jwt()->>'sub'
    OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id))
  )
  WITH CHECK (
    user_id = auth.jwt()->>'sub'
    OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id))
  );

CREATE POLICY "important_dates.delete" ON public.important_dates
  FOR DELETE TO authenticated
  USING (user_id = auth.jwt()->>'sub');

-- ============================================================================
-- ROW LEVEL SECURITY - NOTIFICATIONS
-- ============================================================================
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications.select" ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.jwt()->>'sub');

-- Notifications are only inserted by system/service role
CREATE POLICY "notifications.insert" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.jwt()->>'sub');

CREATE POLICY "notifications.update" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.jwt()->>'sub')
  WITH CHECK (user_id = auth.jwt()->>'sub');

CREATE POLICY "notifications.delete" ON public.notifications
  FOR DELETE TO authenticated
  USING (user_id = auth.jwt()->>'sub');

-- ============================================================================
-- SYSTEM_LOGS - No RLS (service role only)
-- ============================================================================
-- system_logs should only be accessed by service role for debugging
-- No RLS policies - only service role can read/write

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to get upcoming important dates
CREATE OR REPLACE FUNCTION public.get_upcoming_dates(
  p_user_id TEXT,
  p_days_ahead INT DEFAULT 30
)
RETURNS TABLE (
  id UUID,
  event_name TEXT,
  event_date DATE,
  event_type TEXT,
  days_until INT,
  related_person TEXT,
  reminder_days INT[],
  should_remind BOOLEAN
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.event_name,
    -- Calculate this year's occurrence for yearly events
    CASE
      WHEN d.recurrence = 'yearly' THEN
        CASE
          WHEN MAKE_DATE(EXTRACT(YEAR FROM v_today)::INT, EXTRACT(MONTH FROM d.event_date)::INT, EXTRACT(DAY FROM d.event_date)::INT) >= v_today
          THEN MAKE_DATE(EXTRACT(YEAR FROM v_today)::INT, EXTRACT(MONTH FROM d.event_date)::INT, EXTRACT(DAY FROM d.event_date)::INT)
          ELSE MAKE_DATE(EXTRACT(YEAR FROM v_today)::INT + 1, EXTRACT(MONTH FROM d.event_date)::INT, EXTRACT(DAY FROM d.event_date)::INT)
        END
      ELSE d.event_date
    END as event_date,
    d.event_type,
    -- Calculate days until event
    CASE
      WHEN d.recurrence = 'yearly' THEN
        CASE
          WHEN MAKE_DATE(EXTRACT(YEAR FROM v_today)::INT, EXTRACT(MONTH FROM d.event_date)::INT, EXTRACT(DAY FROM d.event_date)::INT) >= v_today
          THEN MAKE_DATE(EXTRACT(YEAR FROM v_today)::INT, EXTRACT(MONTH FROM d.event_date)::INT, EXTRACT(DAY FROM d.event_date)::INT) - v_today
          ELSE MAKE_DATE(EXTRACT(YEAR FROM v_today)::INT + 1, EXTRACT(MONTH FROM d.event_date)::INT, EXTRACT(DAY FROM d.event_date)::INT) - v_today
        END
      ELSE d.event_date - v_today
    END as days_until,
    d.related_person,
    d.reminder_days,
    -- Check if any reminder day matches current days_until
    (d.reminder_days && ARRAY[
      CASE
        WHEN d.recurrence = 'yearly' THEN
          CASE
            WHEN MAKE_DATE(EXTRACT(YEAR FROM v_today)::INT, EXTRACT(MONTH FROM d.event_date)::INT, EXTRACT(DAY FROM d.event_date)::INT) >= v_today
            THEN MAKE_DATE(EXTRACT(YEAR FROM v_today)::INT, EXTRACT(MONTH FROM d.event_date)::INT, EXTRACT(DAY FROM d.event_date)::INT) - v_today
            ELSE MAKE_DATE(EXTRACT(YEAR FROM v_today)::INT + 1, EXTRACT(MONTH FROM d.event_date)::INT, EXTRACT(DAY FROM d.event_date)::INT) - v_today
          END
        ELSE d.event_date - v_today
      END
    ]::INT[]) as should_remind
  FROM public.important_dates d
  WHERE (d.user_id = p_user_id OR d.partner_user_id = p_user_id)
    AND (
      -- Include if days_until is within range
      CASE
        WHEN d.recurrence = 'yearly' THEN
          CASE
            WHEN MAKE_DATE(EXTRACT(YEAR FROM v_today)::INT, EXTRACT(MONTH FROM d.event_date)::INT, EXTRACT(DAY FROM d.event_date)::INT) >= v_today
            THEN MAKE_DATE(EXTRACT(YEAR FROM v_today)::INT, EXTRACT(MONTH FROM d.event_date)::INT, EXTRACT(DAY FROM d.event_date)::INT) - v_today
            ELSE MAKE_DATE(EXTRACT(YEAR FROM v_today)::INT + 1, EXTRACT(MONTH FROM d.event_date)::INT, EXTRACT(DAY FROM d.event_date)::INT) - v_today
          END
        ELSE d.event_date - v_today
      END <= p_days_ahead
    )
  ORDER BY days_until ASC;
END;
$$;

-- Function to log system operation start
CREATE OR REPLACE FUNCTION public.log_operation_start(
  p_job_type TEXT,
  p_module TEXT,
  p_execution_id UUID DEFAULT gen_random_uuid()
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO public.system_logs (job_type, module, execution_id, status, started_at)
  VALUES (p_job_type, p_module, p_execution_id, 'started', NOW())
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- Function to log system operation completion
CREATE OR REPLACE FUNCTION public.log_operation_complete(
  p_log_id UUID,
  p_status TEXT DEFAULT 'completed',
  p_details JSONB DEFAULT '{}',
  p_user_ids TEXT[] DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.system_logs
  SET
    status = p_status,
    completed_at = NOW(),
    duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000,
    details = p_details,
    user_ids_affected = p_user_ids,
    error_message = p_error_message
  WHERE id = p_log_id;
END;
$$;

-- Function to get active wishlist items needing price check
CREATE OR REPLACE FUNCTION public.get_wishlist_for_price_check()
RETURNS TABLE (
  id UUID,
  user_id TEXT,
  couple_id UUID,
  item_name TEXT,
  item_url TEXT,
  source TEXT,
  current_price NUMERIC,
  target_price NUMERIC,
  last_checked_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    w.id,
    w.user_id,
    w.couple_id,
    w.item_name,
    w.item_url,
    w.source,
    w.current_price,
    w.target_price,
    w.last_checked_at
  FROM public.wishlist w
  WHERE w.is_active = true
    AND w.is_purchased = false
    AND w.item_url IS NOT NULL
    AND w.target_price IS NOT NULL
    -- Only check items that haven't been checked in last 6 hours
    AND (w.last_checked_at IS NULL OR w.last_checked_at < NOW() - INTERVAL '6 hours')
  ORDER BY w.last_checked_at ASC NULLS FIRST
  LIMIT 50;  -- Process in batches
END;
$$;

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================================================
DROP TRIGGER IF EXISTS trigger_wishlist_updated_at ON public.wishlist;
CREATE TRIGGER trigger_wishlist_updated_at
  BEFORE UPDATE ON public.wishlist
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_important_dates_updated_at ON public.important_dates;
CREATE TRIGGER trigger_important_dates_updated_at
  BEFORE UPDATE ON public.important_dates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_notifications_updated_at ON public.notifications;
CREATE TRIGGER trigger_notifications_updated_at
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE public.wishlist IS 'Tracks items users want to buy with price monitoring and alerts';
COMMENT ON TABLE public.important_dates IS 'Stores birthdays, anniversaries, and other important dates with smart reminders';
COMMENT ON TABLE public.notifications IS 'Centralized notification system for all app notifications';
COMMENT ON TABLE public.system_logs IS 'System operation logs for debugging cron jobs and edge functions';
COMMENT ON FUNCTION public.get_upcoming_dates IS 'Get upcoming important dates with calculated days until and reminder status';
COMMENT ON FUNCTION public.get_wishlist_for_price_check IS 'Get active wishlist items needing price check (batched)';
COMMENT ON FUNCTION public.log_operation_start IS 'Log the start of a system operation';
COMMENT ON FUNCTION public.log_operation_complete IS 'Log the completion of a system operation';

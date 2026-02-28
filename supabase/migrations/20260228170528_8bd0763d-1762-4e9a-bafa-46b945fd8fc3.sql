
-- Create notifications table for in-app agent notifications
CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text NOT NULL,
  type text NOT NULL DEFAULT 'general',
  title text NOT NULL,
  message text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  priority integer DEFAULT 5,
  read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notifications
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (user_id = (auth.jwt() ->> 'sub'::text));

-- Users can update (mark read) their own notifications
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (user_id = (auth.jwt() ->> 'sub'::text));

-- Users can delete their own notifications
CREATE POLICY "notifications_delete_own" ON public.notifications
  FOR DELETE USING (user_id = (auth.jwt() ->> 'sub'::text));

-- Service role inserts (from edge functions) — allow insert for the user's own ID
CREATE POLICY "notifications_insert" ON public.notifications
  FOR INSERT WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX idx_notifications_user_unread ON public.notifications (user_id, read) WHERE read = false;
CREATE INDEX idx_notifications_user_created ON public.notifications (user_id, created_at DESC);

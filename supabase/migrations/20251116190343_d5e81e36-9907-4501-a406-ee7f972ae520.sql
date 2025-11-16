-- Create user_sessions table for WhatsApp conversation state
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  conversation_state TEXT NOT NULL DEFAULT 'IDLE',
  context_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index for faster user lookups
CREATE INDEX idx_user_sessions_user_id ON public.user_sessions(user_id);

-- Enable RLS
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- RLS policies - users can only access their own sessions
CREATE POLICY "Users can view their own sessions"
  ON public.user_sessions
  FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert their own sessions"
  ON public.user_sessions
  FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Users can update their own sessions"
  ON public.user_sessions
  FOR UPDATE
  USING (auth.uid()::text = user_id);

-- Service role can manage all sessions (for webhook)
CREATE POLICY "Service role can manage all sessions"
  ON public.user_sessions
  FOR ALL
  USING (true)
  WITH CHECK (true);
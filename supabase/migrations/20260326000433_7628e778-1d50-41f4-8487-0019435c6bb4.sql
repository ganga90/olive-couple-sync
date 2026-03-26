-- Web chat session persistence table
CREATE TABLE IF NOT EXISTS public.olive_chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  couple_id uuid REFERENCES public.clerk_couples(id) ON DELETE SET NULL,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text,
  last_message_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.olive_chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "olive_chat_sessions_user" ON public.olive_chat_sessions
  FOR ALL TO public
  USING (user_id = (auth.jwt() ->> 'sub'::text));

CREATE INDEX idx_olive_chat_sessions_user_updated ON public.olive_chat_sessions(user_id, updated_at DESC);

CREATE TRIGGER set_updated_at_olive_chat_sessions
  BEFORE UPDATE ON public.olive_chat_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
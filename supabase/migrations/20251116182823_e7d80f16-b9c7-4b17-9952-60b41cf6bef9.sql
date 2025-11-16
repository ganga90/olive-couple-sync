-- Create linking_tokens table for WhatsApp account linking
CREATE TABLE IF NOT EXISTS public.linking_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  user_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.linking_tokens ENABLE ROW LEVEL SECURITY;

-- Users can view their own tokens
CREATE POLICY "Users can view their own linking tokens"
  ON public.linking_tokens
  FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub'));

-- Users can insert their own tokens
CREATE POLICY "Users can insert their own linking tokens"
  ON public.linking_tokens
  FOR INSERT
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

-- Create index for token lookups
CREATE INDEX idx_linking_tokens_token ON public.linking_tokens(token);
CREATE INDEX idx_linking_tokens_user_id ON public.linking_tokens(user_id);

-- Create function to clean up expired tokens
CREATE OR REPLACE FUNCTION public.cleanup_expired_linking_tokens()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.linking_tokens
  WHERE expires_at < now() - interval '1 hour';
END;
$$;
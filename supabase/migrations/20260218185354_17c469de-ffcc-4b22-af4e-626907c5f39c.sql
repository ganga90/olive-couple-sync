
-- Create oura_connections table for storing Oura OAuth tokens
CREATE TABLE public.oura_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text NOT NULL,
  oura_user_id text,
  oura_email text,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expiry timestamp with time zone,
  scopes text[] DEFAULT ARRAY['email', 'personal', 'daily', 'heartrate', 'workout', 'session', 'spo2', 'tag']::text[],
  is_active boolean DEFAULT true,
  last_sync_time timestamp with time zone,
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT oura_connections_user_id_key UNIQUE (user_id)
);

-- Enable RLS
ALTER TABLE public.oura_connections ENABLE ROW LEVEL SECURITY;

-- RLS policies (user can only manage their own connection)
CREATE POLICY "oura_connections_select_own"
  ON public.oura_connections FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub'::text));

CREATE POLICY "oura_connections_insert_own"
  ON public.oura_connections FOR INSERT
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'::text));

CREATE POLICY "oura_connections_update_own"
  ON public.oura_connections FOR UPDATE
  USING (user_id = (auth.jwt() ->> 'sub'::text));

CREATE POLICY "oura_connections_delete_own"
  ON public.oura_connections FOR DELETE
  USING (user_id = (auth.jwt() ->> 'sub'::text));

-- Trigger for updated_at
CREATE TRIGGER set_oura_connections_updated_at
  BEFORE UPDATE ON public.oura_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();


CREATE TABLE public.decryption_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  note_id uuid NOT NULL,
  function_name text NOT NULL,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups by user and note
CREATE INDEX idx_decryption_audit_user ON public.decryption_audit_log (user_id, created_at DESC);
CREATE INDEX idx_decryption_audit_note ON public.decryption_audit_log (note_id, created_at DESC);

-- RLS: users can read their own audit logs, only service role can insert
ALTER TABLE public.decryption_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own audit logs"
  ON public.decryption_audit_log
  FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub'::text));

CREATE POLICY "Service role inserts audit logs"
  ON public.decryption_audit_log
  FOR INSERT
  WITH CHECK (true);

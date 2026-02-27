
-- Add email triage preferences to olive_email_connections
ALTER TABLE public.olive_email_connections
ADD COLUMN IF NOT EXISTS triage_frequency text DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS triage_lookback_days integer DEFAULT 3,
ADD COLUMN IF NOT EXISTS auto_save_tasks boolean DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN public.olive_email_connections.triage_frequency IS 'How often to auto-triage: manual, 6h, 12h, 24h';
COMMENT ON COLUMN public.olive_email_connections.triage_lookback_days IS 'How many days back to scan emails (2 or 3)';
COMMENT ON COLUMN public.olive_email_connections.auto_save_tasks IS 'Whether to auto-save extracted tasks without review';

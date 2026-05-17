-- webhook_errors: persisted error log for whatsapp-webhook top-level catch.
-- Today's "Mark drop off alo package as done" failure produced a generic
-- "Sorry, something went wrong" reply with no surviving stack — only
-- stdout console.error inside the Edge Function isolate. This table gives
-- us a queryable trail of the next failure so we can pinpoint root cause
-- without re-running the request.
--
-- Scope: any edge function that wants a long-tail error log. Initially
-- written by whatsapp-webhook's top-level catch.

CREATE TABLE IF NOT EXISTS public.webhook_errors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name    text NOT NULL,
  user_id          text,
  phone_number     text,
  message_body     text,
  error_message    text NOT NULL,
  error_stack      text,
  metadata         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_errors_created_at
  ON public.webhook_errors (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_errors_user_id_created_at
  ON public.webhook_errors (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_errors_function_name_created_at
  ON public.webhook_errors (function_name, created_at DESC);

ALTER TABLE public.webhook_errors ENABLE ROW LEVEL SECURITY;

-- Edge functions write with the service_role key — they bypass RLS. The
-- policies here exist to govern any authenticated user that might read
-- their own error history (future: a debug surface in the app).
CREATE POLICY webhook_errors_owner_select
  ON public.webhook_errors
  FOR SELECT
  USING (auth.jwt() ->> 'sub' = user_id);

-- Service role inserts are unrestricted; PostgREST-anon writes are not.
-- No INSERT/UPDATE/DELETE policies for non-service callers.


-- Add RLS policies for olive_agent_runs
ALTER TABLE public.olive_agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "olive_agent_runs_select_own"
ON public.olive_agent_runs
FOR SELECT
USING (user_id = (auth.jwt() ->> 'sub'::text));

CREATE POLICY "olive_agent_runs_insert_own"
ON public.olive_agent_runs
FOR INSERT
WITH CHECK (user_id = (auth.jwt() ->> 'sub'::text));

CREATE POLICY "olive_agent_runs_update_own"
ON public.olive_agent_runs
FOR UPDATE
USING (user_id = (auth.jwt() ->> 'sub'::text));

CREATE POLICY "olive_agent_runs_delete_own"
ON public.olive_agent_runs
FOR DELETE
USING (user_id = (auth.jwt() ->> 'sub'::text));

-- Add RLS policies for olive_email_connections
ALTER TABLE public.olive_email_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "olive_email_connections_select_own"
ON public.olive_email_connections
FOR SELECT
USING (user_id = (auth.jwt() ->> 'sub'::text));

CREATE POLICY "olive_email_connections_insert_own"
ON public.olive_email_connections
FOR INSERT
WITH CHECK (user_id = (auth.jwt() ->> 'sub'::text));

CREATE POLICY "olive_email_connections_update_own"
ON public.olive_email_connections
FOR UPDATE
USING (user_id = (auth.jwt() ->> 'sub'::text));

CREATE POLICY "olive_email_connections_delete_own"
ON public.olive_email_connections
FOR DELETE
USING (user_id = (auth.jwt() ->> 'sub'::text));

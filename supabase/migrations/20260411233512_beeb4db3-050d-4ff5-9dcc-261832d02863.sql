
-- Drop the foreign key constraint first
ALTER TABLE public.olive_router_log DROP CONSTRAINT olive_router_log_user_id_fkey;

-- Drop old policies
DROP POLICY IF EXISTS "Service role inserts router logs" ON public.olive_router_log;
DROP POLICY IF EXISTS "Users see own router logs" ON public.olive_router_log;

-- Change user_id to text
ALTER TABLE public.olive_router_log ALTER COLUMN user_id TYPE text USING user_id::text;

-- Recreate with proper user-scoped checks
CREATE POLICY "olive_router_log_insert"
  ON public.olive_router_log FOR INSERT
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "olive_router_log_select"
  ON public.olive_router_log FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub'));

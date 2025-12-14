-- Fix calendar_connections RLS: restrict SELECT to only the token owner
-- OAuth tokens (access_token, refresh_token) should NEVER be exposed to other couple members

-- Drop the existing permissive SELECT policy that exposes tokens
DROP POLICY IF EXISTS "calendar_connections_select" ON public.calendar_connections;

-- Create new owner-only SELECT policy for tokens/credentials
-- Only the token owner can read the full row including OAuth tokens
CREATE POLICY "calendar_connections_select_own"
ON public.calendar_connections
FOR SELECT
USING (user_id = (auth.jwt() ->> 'sub'));

-- Note: Couple members can still see calendar EVENTS through calendar_events table
-- which properly restricts access without exposing tokens
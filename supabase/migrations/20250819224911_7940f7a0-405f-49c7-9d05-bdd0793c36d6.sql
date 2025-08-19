-- Debug and fix the get_clerk_user_id function
-- First, let's create a debug function to see what's in the JWT claims
CREATE OR REPLACE FUNCTION public.debug_jwt_claims()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::jsonb,
    '{}'::jsonb
  );
$function$;

-- Fix the get_clerk_user_id function to handle Clerk's JWT format
CREATE OR REPLACE FUNCTION public.get_clerk_user_id()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT COALESCE(
    -- Try different possible locations for the user ID in Clerk JWT
    current_setting('request.jwt.claims', true)::jsonb->>'sub',
    current_setting('request.jwt.claims', true)::jsonb->>'user_id',
    current_setting('request.jwt.claims', true)::jsonb->>'clerk_user_id',
    -- Also try the aud field which Clerk sometimes uses
    current_setting('request.jwt.claims', true)::jsonb->>'aud'
  );
$function$;
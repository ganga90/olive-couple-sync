-- Create a debug function to see what's actually in the JWT token
CREATE OR REPLACE FUNCTION public.debug_jwt_claims()
RETURNS jsonb AS $$
BEGIN
  RETURN auth.jwt();
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

-- Test if we can extract the sub claim
CREATE OR REPLACE FUNCTION public.debug_clerk_user_id()
RETURNS text AS $$
BEGIN
  RETURN COALESCE(
    auth.jwt()->>'sub',
    auth.jwt()->>'user_id',
    'NO_USER_ID_FOUND'
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';
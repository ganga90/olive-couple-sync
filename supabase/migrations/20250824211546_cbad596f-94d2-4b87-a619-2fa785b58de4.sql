-- Update debug function to use the correct method for Clerk JWT claims
CREATE OR REPLACE FUNCTION public.debug_clerk_jwt()
RETURNS text AS $$
BEGIN
  RETURN current_setting('request.jwt.claims', true);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

-- Test extracting user ID using the correct method
CREATE OR REPLACE FUNCTION public.debug_clerk_user_id_fixed()
RETURNS text AS $$
BEGIN
  RETURN current_setting('request.jwt.claims', true)::json->>'sub';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';
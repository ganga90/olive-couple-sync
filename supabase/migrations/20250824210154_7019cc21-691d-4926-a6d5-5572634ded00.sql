-- Fix the function search path security issue
CREATE OR REPLACE FUNCTION public.get_clerk_user_id()
RETURNS TEXT AS $$
BEGIN
  RETURN COALESCE(
    auth.jwt() ->> 'sub',
    current_setting('request.jwt.claims', true)::json ->> 'sub'
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';
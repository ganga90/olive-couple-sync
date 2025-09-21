-- Fix search_path for security on existing functions
ALTER FUNCTION public.debug_jwt_claims() SET search_path = public;
ALTER FUNCTION public.debug_clerk_user_id() SET search_path = public;
ALTER FUNCTION public.debug_clerk_user_id_fixed() SET search_path = public;
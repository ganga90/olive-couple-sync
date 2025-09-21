-- Fix search_path for remaining functions with security issues
ALTER FUNCTION public.debug_clerk_jwt() SET search_path = public;
ALTER FUNCTION public.jwt() SET search_path = public;
ALTER FUNCTION public.jwt_sub() SET search_path = public;
ALTER FUNCTION public.is_couple_member(uuid, text) SET search_path = public;
ALTER FUNCTION public.is_couple_owner(uuid, text) SET search_path = public;
ALTER FUNCTION public.set_updated_at() SET search_path = public;
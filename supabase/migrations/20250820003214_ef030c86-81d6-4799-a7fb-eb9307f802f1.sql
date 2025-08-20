-- Fix security definer functions to set search_path
CREATE OR REPLACE FUNCTION public.is_couple_owner(couple_uuid uuid, user_text text)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM clerk_couple_members 
    WHERE couple_id = couple_uuid 
    AND user_id = user_text 
    AND role = 'owner'::member_role
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_couple_member(couple_uuid uuid, user_text text)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM clerk_couple_members 
    WHERE couple_id = couple_uuid 
    AND user_id = user_text
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;
-- Fix security issues with function search paths

-- Update jwt() function with secure search path
CREATE OR REPLACE FUNCTION public.jwt() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

-- Update jwt_sub() function with secure search path
CREATE OR REPLACE FUNCTION public.jwt_sub() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.jwt()->>'sub'
$$;

-- Update create_couple function with secure search path
CREATE OR REPLACE FUNCTION public.create_couple(
  p_title         text,
  p_you_name      text,
  p_partner_name  text
)
RETURNS TABLE (couple_id uuid, invite_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_actor_id   text := public.jwt_sub();
  v_couple_id  uuid;
  v_token      text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.clerk_couples (title, you_name, partner_name, created_by)
  VALUES (p_title, p_you_name, p_partner_name, v_actor_id)
  RETURNING id INTO v_couple_id;

  INSERT INTO public.clerk_couple_members (couple_id, user_id, role)
  VALUES (v_couple_id, v_actor_id, 'owner'::public.member_role);

  INSERT INTO public.invites (couple_id, invited_by, token, status)
  VALUES (
    v_couple_id,
    v_actor_id,
    encode(gen_random_bytes(18), 'base64'),
    'pending'
  )
  RETURNING token INTO v_token;

  RETURN QUERY SELECT v_couple_id, v_token;
END
$$;
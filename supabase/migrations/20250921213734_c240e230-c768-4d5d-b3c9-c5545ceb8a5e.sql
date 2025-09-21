-- Add missing columns to clerk_invites
ALTER TABLE public.clerk_invites 
ADD COLUMN IF NOT EXISTS role public.member_role NOT NULL DEFAULT 'member',
ADD COLUMN IF NOT EXISTS accepted_by text,
ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
ADD COLUMN IF NOT EXISTS revoked boolean NOT NULL DEFAULT false;

-- Recreate the RPC functions with correct column names and enum values
DROP FUNCTION IF EXISTS public.is_member_of_couple(uuid, text);
CREATE OR REPLACE FUNCTION public.is_member_of_couple(p_couple_id uuid, p_user_id text DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clerk_couple_members m
    WHERE m.couple_id = p_couple_id
      AND m.user_id = p_user_id
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_member_of_couple(uuid, text) TO anon, authenticated;

-- Create invite function
DROP FUNCTION IF EXISTS public.create_invite(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.create_invite(
  p_couple_id uuid,
  p_invited_email text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
  v_invite_id uuid;
BEGIN
  -- Must be owner to create invites
  IF NOT EXISTS (
    SELECT 1 FROM public.clerk_couple_members m
    WHERE m.couple_id = p_couple_id
      AND m.user_id = auth.uid()
      AND m.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Generate token and insert invite
  v_token := gen_random_uuid()::text;
  
  INSERT INTO public.clerk_invites(token, couple_id, role, invited_email, created_by, expires_at)
  VALUES (
    v_token,
    p_couple_id,
    'member',
    p_invited_email,
    auth.uid(),
    now() + interval '7 days'
  )
  RETURNING id INTO v_invite_id;

  RETURN jsonb_build_object(
    'invite_id', v_invite_id,
    'token', v_token,
    'couple_id', p_couple_id
  );
END $$;
GRANT EXECUTE ON FUNCTION public.create_invite(uuid, text) TO authenticated;

-- Validate invite function  
DROP FUNCTION IF EXISTS public.validate_invite(text);
CREATE OR REPLACE FUNCTION public.validate_invite(p_token text)
RETURNS TABLE(
  couple_id uuid,
  role text,
  title text,
  you_name text,
  partner_name text,
  expires_at timestamptz,
  revoked boolean,
  accepted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    i.couple_id,
    i.role::text,
    c.title,
    c.you_name,
    c.partner_name,
    i.expires_at,
    COALESCE(i.revoked, false) as revoked,
    (i.accepted_at IS NOT NULL) as accepted
  FROM public.clerk_invites i
  JOIN public.clerk_couples c ON c.id = i.couple_id
  WHERE i.token = p_token;
END $$;
GRANT EXECUTE ON FUNCTION public.validate_invite(text) TO anon, authenticated;

-- Accept invite function
DROP FUNCTION IF EXISTS public.accept_invite(text);
CREATE OR REPLACE FUNCTION public.accept_invite(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite record;
BEGIN
  -- Get invite details
  SELECT * INTO v_invite
  FROM public.clerk_invites i
  WHERE i.token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITE_NOT_FOUND';
  END IF;

  IF v_invite.accepted_at IS NOT NULL THEN
    IF v_invite.accepted_by = auth.uid() THEN
      -- Already accepted by same user, return couple_id
      RETURN v_invite.couple_id;
    END IF;
    RAISE EXCEPTION 'INVITE_ALREADY_ACCEPTED';
  END IF;

  IF v_invite.expires_at <= NOW() THEN
    RAISE EXCEPTION 'INVITE_EXPIRED';
  END IF;

  IF COALESCE(v_invite.revoked, false) THEN
    RAISE EXCEPTION 'INVITE_REVOKED';
  END IF;

  -- Add user to couple
  INSERT INTO public.clerk_couple_members(couple_id, user_id, role)
  VALUES (v_invite.couple_id, auth.uid(), v_invite.role::public.member_role)
  ON CONFLICT (couple_id, user_id) DO NOTHING;

  -- Mark invite as accepted
  UPDATE public.clerk_invites
  SET accepted_at = NOW(), accepted_by = auth.uid()
  WHERE token = p_token;

  RETURN v_invite.couple_id;
END $$;
GRANT EXECUTE ON FUNCTION public.accept_invite(text) TO authenticated;
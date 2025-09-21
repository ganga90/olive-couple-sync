-- Fix type mismatch in RPC functions for Clerk authentication
-- Replace auth.uid() with auth.jwt() ->> 'sub' for text user_id fields

CREATE OR REPLACE FUNCTION public.create_invite(p_couple_id uuid, p_invited_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_token text;
  v_invite_id uuid;
BEGIN
  -- Must be owner to create invites
  IF NOT EXISTS (
    SELECT 1 FROM public.clerk_couple_members m
    WHERE m.couple_id = p_couple_id
      AND m.user_id = (auth.jwt() ->> 'sub')
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
    (auth.jwt() ->> 'sub'),
    now() + interval '7 days'
  )
  RETURNING id INTO v_invite_id;

  RETURN jsonb_build_object(
    'invite_id', v_invite_id,
    'token', v_token,
    'couple_id', p_couple_id
  );
END $function$;

-- Also fix is_member_of_couple function default parameter
CREATE OR REPLACE FUNCTION public.is_member_of_couple(p_couple_id uuid, p_user_id text DEFAULT (auth.jwt() ->> 'sub'))
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.clerk_couple_members m
    WHERE m.couple_id = p_couple_id
      AND m.user_id = p_user_id
  );
$function$;

-- Fix accept_invite function as well
CREATE OR REPLACE FUNCTION public.accept_invite(p_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    IF v_invite.accepted_by = (auth.jwt() ->> 'sub') THEN
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
  VALUES (v_invite.couple_id, (auth.jwt() ->> 'sub'), v_invite.role::public.member_role)
  ON CONFLICT (couple_id, user_id) DO NOTHING;

  -- Mark invite as accepted
  UPDATE public.clerk_invites
  SET accepted_at = NOW(), accepted_by = (auth.jwt() ->> 'sub')
  WHERE token = p_token;

  RETURN v_invite.couple_id;
END $function$;
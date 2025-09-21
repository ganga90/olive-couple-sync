-- 1) Drop existing problematic RLS policies 
DROP POLICY IF EXISTS "clerk_invites_select" ON public.clerk_invites;
DROP POLICY IF EXISTS "clerk_invites_insert" ON public.clerk_invites;

-- 2) Create deny-all policy for clerk_invites (we'll use RPCs only)
CREATE POLICY "deny_all_clerk_invites" ON public.clerk_invites 
FOR ALL USING (false) WITH CHECK (false);

-- 3) Helper function to check couple membership safely
CREATE OR REPLACE FUNCTION public.is_member_of_couple(p_couple_id uuid, p_user_id text DEFAULT (auth.jwt() ->> 'sub'))
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clerk_couple_members m
    WHERE m.couple_id = p_couple_id AND m.user_id = p_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_member_of_couple(uuid, text) TO anon, authenticated;

-- 4) Function to validate invite token (read-only)
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
  WHERE i.token::text = p_token;
END $$;

GRANT EXECUTE ON FUNCTION public.validate_invite(text) TO anon, authenticated;

-- 5) Function to accept invite 
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
  WHERE i.token::text = p_token
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

  -- Add user to couple
  INSERT INTO public.clerk_couple_members(couple_id, user_id, role)
  VALUES (v_invite.couple_id, (auth.jwt() ->> 'sub'), 'partner'::member_role)
  ON CONFLICT (couple_id, user_id) DO NOTHING;

  -- Mark invite as accepted
  UPDATE public.clerk_invites
  SET accepted_at = NOW(), accepted_by = (auth.jwt() ->> 'sub')
  WHERE token::text = p_token;

  RETURN v_invite.couple_id;
END $$;

GRANT EXECUTE ON FUNCTION public.accept_invite(text) TO authenticated;
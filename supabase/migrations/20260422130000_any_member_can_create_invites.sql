-- Loosen create_invite authorization: any space member can invite (was owner-only)
-- =============================================================================
-- Symptom: a non-owner member sees "Failed to create invite. Please try again."
-- when clicking Create Invite Link, because the RPC raised NOT_AUTHORIZED for
-- anyone whose role wasn't 'owner'.
--
-- Repro: Gi (owner) invited G v, who joined as 'member'. When G v then tried
-- to invite a third person, the RPC rejected them because only the owner was
-- allowed to create invites. The toast "Failed to create invite. Please try
-- again." came from the client-side catch of that NOT_AUTHORIZED exception.
--
-- Rationale: Olive Spaces target families / friend groups / small teams up to 10.
-- Gating invites to just the owner makes the most conscientious person (the one
-- who set it up) a bottleneck for every new member — the exact cognitive tax
-- Olive is supposed to remove. Any member should be able to generate an invite.
--
-- Safety: accept_invite still enforces the 10-member cap. Invite tokens still
-- expire in 7 days and are single-use. No spam vector — invites are bound to
-- the space, not the caller.

CREATE OR REPLACE FUNCTION public.create_invite(
  p_couple_id uuid,
  p_invited_email text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_token text;
  v_invite_id uuid;
BEGIN
  -- Must be a member of the space (was: owner-only — too restrictive).
  IF NOT EXISTS (
    SELECT 1 FROM public.clerk_couple_members m
    WHERE m.couple_id = p_couple_id
      AND m.user_id = (auth.jwt() ->> 'sub')
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
END
$function$;

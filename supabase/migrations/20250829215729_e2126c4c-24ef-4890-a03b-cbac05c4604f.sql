-- Ensure create_invite RPC exists with proper idempotent upsert
CREATE OR REPLACE FUNCTION public.create_invite(p_couple_id uuid, p_invited_email text)
RETURNS invites
LANGUAGE plpgsql
SECURITY definer
SET search_path = 'public'
AS $$
DECLARE v_row invites;
BEGIN
  IF NOT is_couple_member(p_couple_id) THEN
    RAISE EXCEPTION 'not a member of couple %', p_couple_id USING errcode = '42501';
  END IF;

  INSERT INTO invites (couple_id, invited_by, invited_email)
  VALUES (p_couple_id, auth.jwt()->>'sub', lower(p_invited_email))
  ON CONFLICT (couple_id, invited_email) DO UPDATE
    SET invited_by = EXCLUDED.invited_by,
        created_at = now(),
        token = encode(gen_random_bytes(16), 'hex'),
        status = 'pending'::invite_status
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;
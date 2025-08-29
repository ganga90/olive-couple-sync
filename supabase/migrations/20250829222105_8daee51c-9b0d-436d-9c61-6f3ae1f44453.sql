-- Idempotent invites setup and function
ALTER TABLE public.invites
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN token SET DEFAULT encode(gen_random_bytes(16), 'hex');

CREATE UNIQUE INDEX IF NOT EXISTS invites_couple_email_unique
  ON public.invites (couple_id, invited_email);

CREATE OR REPLACE FUNCTION public.create_invite(p_couple_id uuid, p_invited_email text)
RETURNS public.invites
LANGUAGE plpgsql 
SECURITY definer 
SET search_path = 'public'
AS $$
DECLARE v_row public.invites;
BEGIN
  IF NOT public.is_couple_member(p_couple_id) THEN
    RAISE EXCEPTION 'not a member of couple %', p_couple_id USING errcode = '42501';
  END IF;

  INSERT INTO public.invites (couple_id, invited_by, invited_email)
  VALUES (p_couple_id, auth.jwt()->>'sub', lower(p_invited_email))
  ON CONFLICT (couple_id, invited_email) DO UPDATE
    SET invited_by = EXCLUDED.invited_by,
        created_at = now(),
        token = encode(gen_random_bytes(16), 'hex'),
        status = 'pending'
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;
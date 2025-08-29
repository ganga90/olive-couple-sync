-- 3) Recreate policies without enum references
DROP POLICY IF EXISTS "couples.delete" ON public.clerk_couples;
CREATE POLICY "couples.delete"
ON public.clerk_couples
FOR DELETE TO authenticated
USING ( public.is_couple_owner(id) );

-- 4) Recreate RPCs without enum casts
CREATE OR REPLACE FUNCTION public.create_couple(
  p_title        text DEFAULT NULL,
  p_you_name     text DEFAULT NULL,
  p_partner_name text DEFAULT NULL
) RETURNS public.clerk_couples
LANGUAGE plpgsql 
SECURITY definer 
SET search_path = 'public'
AS $$
DECLARE c public.clerk_couples;
BEGIN
  INSERT INTO public.clerk_couples (title, you_name, partner_name, created_by)
  VALUES (
    nullif(p_title, ''), 
    nullif(p_you_name, ''), 
    nullif(p_partner_name, ''), 
    auth.jwt()->>'sub'
  )
  RETURNING * INTO c;

  INSERT INTO public.clerk_couple_members (couple_id, user_id, role)
  VALUES (c.id, auth.jwt()->>'sub', 'owner');  -- NOTE: plain text, no enum cast

  RETURN c;
END $$;

CREATE OR REPLACE FUNCTION public.create_invite(
  p_couple_id uuid,
  p_invited_email text
) RETURNS public.invites
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
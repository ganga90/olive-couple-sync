-- Create RPC functions for atomic operations
ALTER TABLE public.invites
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN token SET DEFAULT encode(gen_random_bytes(16), 'hex');

CREATE UNIQUE INDEX IF NOT EXISTS invites_couple_email_unique
  ON public.invites (couple_id, invited_email);

-- Create couple RPC with owner membership
CREATE OR REPLACE FUNCTION public.create_couple(
  p_title text DEFAULT NULL,
  p_you_name text DEFAULT NULL,
  p_partner_name text DEFAULT NULL
) RETURNS public.clerk_couples
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = 'public' 
AS $$
DECLARE c public.clerk_couples;
BEGIN
  INSERT INTO public.clerk_couples (title, you_name, partner_name, created_by)
  VALUES (nullif(p_title,''), nullif(p_you_name,''), nullif(p_partner_name,''), auth.jwt()->>'sub')
  RETURNING * INTO c;

  INSERT INTO public.clerk_couple_members (couple_id, user_id, role)
  VALUES (c.id, auth.jwt()->>'sub', 'owner');

  RETURN c;
END $$;

-- Create invite RPC with upsert logic
CREATE OR REPLACE FUNCTION public.create_invite(
  p_couple_id uuid,
  p_invited_email text
) RETURNS public.invites
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = 'public' 
AS $$
DECLARE v_row public.invites;
BEGIN
  IF NOT public.is_couple_member(p_couple_id) THEN
    RAISE EXCEPTION 'not a member of couple %', p_couple_id USING errcode='42501';
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

-- Debug helper function
CREATE OR REPLACE FUNCTION public.debug_claims()
RETURNS jsonb 
LANGUAGE sql 
STABLE 
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT jsonb_build_object(
    'sub',  auth.jwt()->>'sub',
    'role', auth.role(),
    'claims', current_setting('request.jwt.claims', true)
  );
$$;
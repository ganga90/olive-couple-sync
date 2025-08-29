-- Atomic couple creation + membership (role as TEXT)
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
  VALUES (c.id, auth.jwt()->>'sub', 'owner');   -- TEXT, no enum cast

  RETURN c;
END $$;
-- 3) Recreate helpers WITHOUT enum casts
CREATE OR REPLACE FUNCTION public.is_couple_member(c uuid)
RETURNS boolean 
LANGUAGE sql 
STABLE 
SECURITY definer
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clerk_couple_members m
    WHERE m.couple_id = c
      AND m.user_id = (auth.jwt()->>'sub')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_couple_owner(c uuid)
RETURNS boolean 
LANGUAGE sql 
STABLE 
SECURITY definer
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clerk_couple_members m
    WHERE m.couple_id = c
      AND m.user_id = (auth.jwt()->>'sub')
      AND m.role = 'owner'            -- NO enum cast
  );
$$;
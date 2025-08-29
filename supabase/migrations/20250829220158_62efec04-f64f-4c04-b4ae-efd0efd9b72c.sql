-- 1) Convert role column to text with safe defaults
ALTER TABLE public.clerk_couple_members
  ALTER COLUMN role TYPE text USING role::text,
  ALTER COLUMN role SET DEFAULT 'owner';

-- Add CHECK constraint for valid values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='clerk_couple_members' AND constraint_name='clerk_couple_members_role_check'
  ) THEN
    ALTER TABLE public.clerk_couple_members
      ADD CONSTRAINT clerk_couple_members_role_check
      CHECK (role IN ('owner','member'));
  END IF;
END $$;

-- 2) Recreate helper functions without enum casts
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
      AND m.role = 'owner'  -- NOTE: no ::member_role cast
  );
$$;
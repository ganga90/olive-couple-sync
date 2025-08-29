-- Fix enum dependency and create helper functions
ALTER TABLE public.clerk_couple_members
  ALTER COLUMN role TYPE text USING role::text,
  ALTER COLUMN role SET DEFAULT 'owner';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='clerk_couple_members'
      AND constraint_name='clerk_couple_members_role_check'
  ) THEN
    ALTER TABLE public.clerk_couple_members
      ADD CONSTRAINT clerk_couple_members_role_check
      CHECK (role IN ('owner','member'));
  END IF;
END $$;

-- Helper functions without enum casts
CREATE OR REPLACE FUNCTION public.is_couple_member(c uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clerk_couple_members m
    WHERE m.couple_id = c AND m.user_id = (auth.jwt()->>'sub')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_couple_owner(c uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clerk_couple_members m
    WHERE m.couple_id = c AND m.user_id = (auth.jwt()->>'sub') AND m.role = 'owner'
  );
$$;

-- Auto-fill created_by trigger
CREATE OR REPLACE FUNCTION public.set_created_by_from_jwt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.created_by IS NULL OR NEW.created_by = '' THEN
    NEW.created_by := auth.jwt()->>'sub';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_created_by ON public.clerk_couples;
CREATE TRIGGER trg_set_created_by
BEFORE INSERT ON public.clerk_couples
FOR EACH ROW EXECUTE FUNCTION public.set_created_by_from_jwt();
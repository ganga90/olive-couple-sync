-- 2) Force role to TEXT + safe default and CHECK
ALTER TABLE public.clerk_couple_members
  ALTER COLUMN role TYPE text USING role::text,
  ALTER COLUMN role SET DEFAULT 'owner';

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
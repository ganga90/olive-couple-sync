-- 1) Ensure invites table has proper defaults and unique constraint
ALTER TABLE invites 
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN token SET DEFAULT encode(gen_random_bytes(16), 'hex');

-- Add unique constraint for idempotent upserts
CREATE UNIQUE INDEX IF NOT EXISTS invites_couple_email_unique
  ON invites (couple_id, invited_email);

-- 2) Fix the create_couple RPC to use nullif (not COALESCE)
CREATE OR REPLACE FUNCTION public.create_couple(
  p_title text DEFAULT NULL,
  p_you_name text DEFAULT NULL, 
  p_partner_name text DEFAULT NULL
)
RETURNS clerk_couples
LANGUAGE plpgsql
SECURITY definer
SET search_path = 'public'
AS $$
DECLARE 
  c clerk_couples;
BEGIN
  INSERT INTO clerk_couples (title, you_name, partner_name, created_by)
  VALUES (
    nullif(p_title, ''), 
    nullif(p_you_name, ''), 
    nullif(p_partner_name, ''), 
    auth.jwt()->>'sub'
  )
  RETURNING * INTO c;

  -- Add creator as owner member
  INSERT INTO clerk_couple_members (couple_id, user_id, role)
  VALUES (c.id, auth.jwt()->>'sub', 'owner');

  RETURN c;
END $$;

-- 3) Check current policies on clerk_couples (this will show in logs)
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public' AND tablename='clerk_couples';
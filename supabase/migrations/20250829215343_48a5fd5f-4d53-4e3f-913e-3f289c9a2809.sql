-- 1) Create trigger to automatically set created_by from JWT
CREATE OR REPLACE FUNCTION public.set_created_by_from_jwt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY definer
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.created_by IS NULL OR NEW.created_by = '' THEN
    NEW.created_by := auth.jwt()->>'sub';
  END IF;
  RETURN NEW;
END $$;

-- Apply trigger to clerk_couples table
DROP TRIGGER IF EXISTS trg_set_created_by ON clerk_couples;
CREATE TRIGGER trg_set_created_by
BEFORE INSERT ON clerk_couples
FOR EACH ROW EXECUTE FUNCTION public.set_created_by_from_jwt();

-- 2) Relax insert policy to allow missing created_by
DROP POLICY IF EXISTS "couples.insert" ON clerk_couples;
CREATE POLICY "couples.insert"
ON clerk_couples FOR INSERT
TO authenticated
WITH CHECK (
  -- Allow client to omit created_by; trigger fills it
  (created_by IS NULL)
  OR (created_by = (auth.jwt()->>'sub'))
);

-- 3) Create atomic RPC function for couple creation
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
    COALESCE(p_title, 'Untitled'), 
    p_you_name, 
    p_partner_name, 
    auth.jwt()->>'sub'
  )
  RETURNING * INTO c;

  -- Add creator as owner member
  INSERT INTO clerk_couple_members (couple_id, user_id, role)
  VALUES (c.id, auth.jwt()->>'sub', 'owner');

  RETURN c;
END $$;
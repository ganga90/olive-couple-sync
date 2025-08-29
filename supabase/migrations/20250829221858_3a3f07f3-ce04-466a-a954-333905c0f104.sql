-- 4) Recreate RPCs WITHOUT enum casts
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

DROP TRIGGER IF EXISTS trg_set_created_by ON public.clerk_couples;
CREATE TRIGGER trg_set_created_by
BEFORE INSERT ON public.clerk_couples
FOR EACH ROW EXECUTE FUNCTION public.set_created_by_from_jwt();

-- Relaxed insert policy (allows client to omit created_by)
DROP POLICY IF EXISTS "couples.insert" ON public.clerk_couples;
CREATE POLICY "couples.insert"
ON public.clerk_couples FOR INSERT TO authenticated
WITH CHECK ( created_by IS NULL OR created_by = auth.jwt()->>'sub' );
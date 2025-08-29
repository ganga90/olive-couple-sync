-- Add debug function to check JWT claims
CREATE OR REPLACE FUNCTION public.debug_claims()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = 'public'
AS $$
  SELECT jsonb_build_object(
    'sub', auth.jwt()->>'sub',
    'role', auth.role(),
    'claims', current_setting('request.jwt.claims', true)
  );
$$;

-- Check column types for identity fields
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('clerk_couples','clerk_couple_members','invites','clerk_notes')
  AND column_name IN ('created_by','user_id','invited_by','author_id')
ORDER BY table_name, column_name;
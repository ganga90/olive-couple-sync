-- Fix the ambiguous user_id reference in is_couple_member_safe function
-- Need to use CASCADE since policies depend on this function
DROP FUNCTION IF EXISTS public.is_couple_member_safe(uuid, text) CASCADE;

CREATE OR REPLACE FUNCTION public.is_couple_member_safe(couple_uuid uuid, p_user_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.clerk_couple_members cm
    WHERE cm.couple_id = couple_uuid AND cm.user_id = p_user_id
  );
END;
$function$;

-- Recreate the RLS policies that were dropped with CASCADE
CREATE POLICY "clerk_notes_select" ON public.clerk_notes
FOR SELECT USING (
  ((author_id = (auth.jwt() ->> 'sub'::text)) AND (couple_id IS NULL)) 
  OR 
  ((couple_id IS NOT NULL) AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text)))
);

CREATE POLICY "clerk_notes_insert" ON public.clerk_notes
FOR INSERT WITH CHECK (
  (author_id = (auth.jwt() ->> 'sub'::text)) 
  AND 
  ((couple_id IS NULL) OR is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text)))
);

CREATE POLICY "clerk_notes_update" ON public.clerk_notes
FOR UPDATE USING (
  ((author_id = (auth.jwt() ->> 'sub'::text)) AND (couple_id IS NULL)) 
  OR 
  ((couple_id IS NOT NULL) AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text)))
);

CREATE POLICY "clerk_notes_delete" ON public.clerk_notes
FOR DELETE USING (
  ((author_id = (auth.jwt() ->> 'sub'::text)) AND (couple_id IS NULL)) 
  OR 
  ((couple_id IS NOT NULL) AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text)))
);
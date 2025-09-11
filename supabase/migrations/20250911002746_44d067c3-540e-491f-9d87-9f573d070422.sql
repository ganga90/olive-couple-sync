-- Fix the ambiguous user_id reference in is_couple_member_safe function
DROP FUNCTION IF EXISTS public.is_couple_member_safe(uuid, text);

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
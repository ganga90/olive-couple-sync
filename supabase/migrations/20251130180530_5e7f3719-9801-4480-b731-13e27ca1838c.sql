
-- First, fix orphan couples by adding owners who created them but don't have member records
INSERT INTO public.clerk_couple_members (couple_id, user_id, role)
SELECT c.id, c.created_by, 'owner'::member_role
FROM public.clerk_couples c
WHERE c.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.clerk_couple_members m 
    WHERE m.couple_id = c.id AND m.user_id = c.created_by
  )
ON CONFLICT (couple_id, user_id) DO NOTHING;

-- Update create_couple function to be idempotent and handle edge cases
CREATE OR REPLACE FUNCTION public.create_couple(p_you_name text, p_partner_name text, p_title text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id  text := (auth.jwt() ->> 'sub');
  v_couple_id uuid;
  v_existing_couple_id uuid;
begin
  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;

  -- Check if user already has a couple (as owner) without partner
  -- This handles cases where they're re-creating after incomplete setup
  SELECT c.id INTO v_existing_couple_id
  FROM public.clerk_couples c
  JOIN public.clerk_couple_members m ON m.couple_id = c.id
  WHERE m.user_id = v_user_id 
    AND m.role = 'owner'
  LIMIT 1;

  -- If they already have a couple, update it and return
  IF v_existing_couple_id IS NOT NULL THEN
    UPDATE public.clerk_couples 
    SET title = p_title, you_name = p_you_name, partner_name = p_partner_name, updated_at = now()
    WHERE id = v_existing_couple_id;
    RETURN v_existing_couple_id;
  END IF;

  -- Create new couple
  INSERT INTO public.clerk_couples (title, you_name, partner_name, created_by)
  VALUES (p_title, p_you_name, p_partner_name, v_user_id)
  RETURNING id INTO v_couple_id;

  -- Add owner membership (use ON CONFLICT for safety)
  INSERT INTO public.clerk_couple_members (couple_id, user_id, role)
  VALUES (v_couple_id, v_user_id, 'owner'::public.member_role)
  ON CONFLICT (couple_id, user_id) DO NOTHING;

  return v_couple_id;
end;
$function$;

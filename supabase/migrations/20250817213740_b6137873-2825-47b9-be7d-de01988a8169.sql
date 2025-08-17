-- Add RLS policies for clerk_couples
CREATE POLICY "Users can create clerk couples"
ON public.clerk_couples FOR INSERT
WITH CHECK (created_by = public.get_clerk_user_id());

CREATE POLICY "Members can view their clerk couples"
ON public.clerk_couples FOR SELECT
USING (EXISTS (
  SELECT 1 FROM clerk_couple_members m
  WHERE m.couple_id = clerk_couples.id AND m.user_id = public.get_clerk_user_id()
));

CREATE POLICY "Members can update their clerk couples"
ON public.clerk_couples FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM clerk_couple_members m
  WHERE m.couple_id = clerk_couples.id AND m.user_id = public.get_clerk_user_id()
));

CREATE POLICY "Owners can delete their clerk couples"
ON public.clerk_couples FOR DELETE
USING (EXISTS (
  SELECT 1 FROM clerk_couple_members m
  WHERE m.couple_id = clerk_couples.id AND m.user_id = public.get_clerk_user_id() AND m.role = 'owner'::member_role
));

-- Add RLS policies for clerk_couple_members
CREATE POLICY "Users can view their clerk memberships"
ON public.clerk_couple_members FOR SELECT
USING (user_id = public.get_clerk_user_id());

CREATE POLICY "Owners can add clerk members"
ON public.clerk_couple_members FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM clerk_couple_members m
  WHERE m.couple_id = clerk_couple_members.couple_id AND m.user_id = public.get_clerk_user_id() AND m.role = 'owner'::member_role
));

CREATE POLICY "Owners can update clerk members"
ON public.clerk_couple_members FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM clerk_couple_members m
  WHERE m.couple_id = clerk_couple_members.couple_id AND m.user_id = public.get_clerk_user_id() AND m.role = 'owner'::member_role
));

CREATE POLICY "Owners can remove clerk members"
ON public.clerk_couple_members FOR DELETE
USING (EXISTS (
  SELECT 1 FROM clerk_couple_members m
  WHERE m.couple_id = clerk_couple_members.couple_id AND m.user_id = public.get_clerk_user_id() AND m.role = 'owner'::member_role
));

-- Add RLS policies for clerk_notes
CREATE POLICY "Members can view clerk notes in their couples"
ON public.clerk_notes FOR SELECT
USING (EXISTS (
  SELECT 1 FROM clerk_couple_members m
  WHERE m.couple_id = clerk_notes.couple_id AND m.user_id = public.get_clerk_user_id()
));

CREATE POLICY "Members can insert clerk notes in their couples"
ON public.clerk_notes FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = clerk_notes.couple_id AND m.user_id = public.get_clerk_user_id()
  ) AND author_id = public.get_clerk_user_id()
);

CREATE POLICY "Members can update clerk notes in their couples"
ON public.clerk_notes FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM clerk_couple_members m
  WHERE m.couple_id = clerk_notes.couple_id AND m.user_id = public.get_clerk_user_id()
));

CREATE POLICY "Members can delete clerk notes in their couples"
ON public.clerk_notes FOR DELETE
USING (EXISTS (
  SELECT 1 FROM clerk_couple_members m
  WHERE m.couple_id = clerk_notes.couple_id AND m.user_id = public.get_clerk_user_id()
));

-- Fix the function search path issue by updating the function
CREATE OR REPLACE FUNCTION public.get_clerk_user_id() RETURNS text AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::json->>'sub',
    current_setting('request.jwt.claims', true)::json->>'user_id'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';

-- Create trigger to add creator as owner when creating a couple
CREATE OR REPLACE FUNCTION public.add_clerk_creator_as_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
begin
  if new.created_by is not null then
    insert into public.clerk_couple_members (couple_id, user_id, role)
    values (new.id, new.created_by, 'owner'::member_role)
    on conflict do nothing;
  end if;
  return new;
end;
$function$;

CREATE TRIGGER on_clerk_couple_created
  AFTER INSERT ON public.clerk_couples
  FOR EACH ROW EXECUTE FUNCTION public.add_clerk_creator_as_member();

-- Create update triggers
CREATE TRIGGER update_clerk_couples_updated_at
  BEFORE UPDATE ON public.clerk_couples
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER update_clerk_notes_updated_at
  BEFORE UPDATE ON public.clerk_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER update_clerk_profiles_updated_at
  BEFORE UPDATE ON public.clerk_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
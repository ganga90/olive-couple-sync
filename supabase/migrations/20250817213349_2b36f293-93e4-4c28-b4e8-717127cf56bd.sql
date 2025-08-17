-- Create new Clerk-compatible tables with text user IDs

-- Create new profiles table for Clerk users
CREATE TABLE IF NOT EXISTS public.clerk_profiles (
  id text PRIMARY KEY,
  display_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on the new profiles table
ALTER TABLE public.clerk_profiles ENABLE ROW LEVEL SECURITY;

-- Create a function to get the current Clerk user ID from JWT
CREATE OR REPLACE FUNCTION auth.clerk_user_id() RETURNS text AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::json->>'sub',
    current_setting('request.jwt.claims', true)::json->>'user_id'
  );
$$ LANGUAGE sql STABLE;

-- Create RLS policies for clerk_profiles
CREATE POLICY "Clerk profiles are viewable by owner"
ON public.clerk_profiles FOR SELECT
USING (id = auth.clerk_user_id());

CREATE POLICY "Users can insert own clerk profile"
ON public.clerk_profiles FOR INSERT
WITH CHECK (id = auth.clerk_user_id());

CREATE POLICY "Users can update own clerk profile"
ON public.clerk_profiles FOR UPDATE
USING (id = auth.clerk_user_id());

-- Create new couples table for Clerk users
CREATE TABLE IF NOT EXISTS public.clerk_couples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  you_name text,
  partner_name text,
  created_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on the new couples table
ALTER TABLE public.clerk_couples ENABLE ROW LEVEL SECURITY;

-- Create new couple_members table for Clerk users
CREATE TABLE IF NOT EXISTS public.clerk_couple_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid REFERENCES public.clerk_couples(id) ON DELETE CASCADE,
  user_id text,
  role member_role NOT NULL DEFAULT 'member'::member_role,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on the new couple_members table
ALTER TABLE public.clerk_couple_members ENABLE ROW LEVEL SECURITY;

-- Create new notes table for Clerk users
CREATE TABLE IF NOT EXISTS public.clerk_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid REFERENCES public.clerk_couples(id) ON DELETE CASCADE,
  author_id text,
  original_text text NOT NULL,
  summary text NOT NULL,
  category text NOT NULL,
  items text[],
  tags text[],
  due_date timestamp with time zone,
  completed boolean NOT NULL DEFAULT false,
  priority note_priority,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on the new notes table
ALTER TABLE public.clerk_notes ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for clerk_couples
CREATE POLICY "Users can create clerk couples"
ON public.clerk_couples FOR INSERT
WITH CHECK (created_by = auth.clerk_user_id());

CREATE POLICY "Members can view their clerk couples"
ON public.clerk_couples FOR SELECT
USING (EXISTS (
  SELECT 1 FROM clerk_couple_members m
  WHERE m.couple_id = clerk_couples.id AND m.user_id = auth.clerk_user_id()
));

CREATE POLICY "Members can update their clerk couples"
ON public.clerk_couples FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM clerk_couple_members m
  WHERE m.couple_id = clerk_couples.id AND m.user_id = auth.clerk_user_id()
));

CREATE POLICY "Owners can delete their clerk couples"
ON public.clerk_couples FOR DELETE
USING (EXISTS (
  SELECT 1 FROM clerk_couple_members m
  WHERE m.couple_id = clerk_couples.id AND m.user_id = auth.clerk_user_id() AND m.role = 'owner'::member_role
));

-- Create RLS policies for clerk_couple_members
CREATE POLICY "Users can view their clerk memberships"
ON public.clerk_couple_members FOR SELECT
USING (user_id = auth.clerk_user_id());

CREATE POLICY "Owners can add clerk members"
ON public.clerk_couple_members FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM clerk_couple_members m
  WHERE m.couple_id = clerk_couple_members.couple_id AND m.user_id = auth.clerk_user_id() AND m.role = 'owner'::member_role
));

CREATE POLICY "Owners can update clerk members"
ON public.clerk_couple_members FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM clerk_couple_members m
  WHERE m.couple_id = clerk_couple_members.couple_id AND m.user_id = auth.clerk_user_id() AND m.role = 'owner'::member_role
));

CREATE POLICY "Owners can remove clerk members"
ON public.clerk_couple_members FOR DELETE
USING (EXISTS (
  SELECT 1 FROM clerk_couple_members m
  WHERE m.couple_id = clerk_couple_members.couple_id AND m.user_id = auth.clerk_user_id() AND m.role = 'owner'::member_role
));

-- Create RLS policies for clerk_notes
CREATE POLICY "Members can view clerk notes in their couples"
ON public.clerk_notes FOR SELECT
USING (EXISTS (
  SELECT 1 FROM clerk_couple_members m
  WHERE m.couple_id = clerk_notes.couple_id AND m.user_id = auth.clerk_user_id()
));

CREATE POLICY "Members can insert clerk notes in their couples"
ON public.clerk_notes FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM clerk_couple_members m
    WHERE m.couple_id = clerk_notes.couple_id AND m.user_id = auth.clerk_user_id()
  ) AND author_id = auth.clerk_user_id()
);

CREATE POLICY "Members can update clerk notes in their couples"
ON public.clerk_notes FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM clerk_couple_members m
  WHERE m.couple_id = clerk_notes.couple_id AND m.user_id = auth.clerk_user_id()
));

CREATE POLICY "Members can delete clerk notes in their couples"
ON public.clerk_notes FOR DELETE
USING (EXISTS (
  SELECT 1 FROM clerk_couple_members m
  WHERE m.couple_id = clerk_notes.couple_id AND m.user_id = auth.clerk_user_id()
));

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

-- Create update trigger for couples
CREATE TRIGGER update_clerk_couples_updated_at
  BEFORE UPDATE ON public.clerk_couples
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Create update trigger for notes
CREATE TRIGGER update_clerk_notes_updated_at
  BEFORE UPDATE ON public.clerk_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Create update trigger for profiles
CREATE TRIGGER update_clerk_profiles_updated_at
  BEFORE UPDATE ON public.clerk_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
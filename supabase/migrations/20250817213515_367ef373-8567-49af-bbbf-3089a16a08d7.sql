-- Create a function in public schema to get the current Clerk user ID from JWT
CREATE OR REPLACE FUNCTION public.get_clerk_user_id() RETURNS text AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::json->>'sub',
    current_setting('request.jwt.claims', true)::json->>'user_id'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Create new profiles table for Clerk users
CREATE TABLE IF NOT EXISTS public.clerk_profiles (
  id text PRIMARY KEY,
  display_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on the new profiles table
ALTER TABLE public.clerk_profiles ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for clerk_profiles using the public function
CREATE POLICY "Clerk profiles are viewable by owner"
ON public.clerk_profiles FOR SELECT
USING (id = public.get_clerk_user_id());

CREATE POLICY "Users can insert own clerk profile"
ON public.clerk_profiles FOR INSERT
WITH CHECK (id = public.get_clerk_user_id());

CREATE POLICY "Users can update own clerk profile"
ON public.clerk_profiles FOR UPDATE
USING (id = public.get_clerk_user_id());

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
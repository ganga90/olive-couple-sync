
-- 1. Create app_role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- 2. Create user_roles table (text user_id for Clerk)
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- 3. Enable RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 4. Security definer function to check roles (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(p_user_id text, p_role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id AND role = p_role
  );
$$;

-- 5. RLS: users can only see their own roles
CREATE POLICY "users_read_own_roles" ON public.user_roles
  FOR SELECT USING (user_id = (auth.jwt() ->> 'sub'));

-- 6. No insert/update/delete for regular users (admin managed via service role)

-- 7. Seed Gianluca as admin
INSERT INTO public.user_roles (user_id, role)
VALUES ('user_35qkEgvbMI0SzIpvEsDW35drgLu', 'admin');

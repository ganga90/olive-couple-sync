-- Create enum if not exists
CREATE TYPE public.member_role AS ENUM ('owner','partner');

-- Recreate couples table with proper structure
DROP TABLE IF EXISTS public.clerk_couples CASCADE;
CREATE TABLE public.clerk_couples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  you_name text,
  partner_name text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Recreate members table with proper structure
DROP TABLE IF EXISTS public.clerk_couple_members CASCADE;
CREATE TABLE public.clerk_couple_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid REFERENCES public.clerk_couples(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role public.member_role NOT NULL DEFAULT 'partner',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(couple_id, user_id)
);

-- Recreate invites table with proper structure
DROP TABLE IF EXISTS public.clerk_invites CASCADE;
CREATE TABLE public.clerk_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  couple_id uuid NOT NULL REFERENCES public.clerk_couples(id) ON DELETE CASCADE,
  role public.member_role NOT NULL DEFAULT 'partner',
  invited_email text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_by text,
  accepted_at timestamptz,
  revoked boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending'
);

-- Enable RLS
ALTER TABLE public.clerk_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clerk_couples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clerk_couple_members ENABLE ROW LEVEL SECURITY;

-- Create deny-all policy for invites (RPCs will bypass via SECURITY DEFINER)
CREATE POLICY "deny_all_clerk_invites" ON public.clerk_invites FOR ALL USING (false) WITH CHECK (false);
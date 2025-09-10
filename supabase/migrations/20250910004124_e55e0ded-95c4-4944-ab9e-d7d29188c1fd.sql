-- Fix ambiguous user_id references in RLS policies and functions

-- First, let's check and fix any RLS policies that might have ambiguous user_id references
-- Drop and recreate policies with proper table prefixes

-- Drop existing policies for clerk_couple_members that might cause ambiguity
DROP POLICY IF EXISTS "clerk_couple_members_select" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "clerk_couple_members_insert" ON public.clerk_couple_members;

-- Recreate with explicit column references
CREATE POLICY "clerk_couple_members_select" ON public.clerk_couple_members
FOR SELECT TO authenticated
USING (clerk_couple_members.user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "clerk_couple_members_insert" ON public.clerk_couple_members
FOR INSERT TO authenticated
WITH CHECK (clerk_couple_members.user_id = (auth.jwt() ->> 'sub'));

-- Update the is_couple_member_safe function to be more explicit
CREATE OR REPLACE FUNCTION public.is_couple_member_safe(couple_uuid uuid, user_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.clerk_couple_members cm
    WHERE cm.couple_id = couple_uuid AND cm.user_id = user_id
  );
END;
$$;
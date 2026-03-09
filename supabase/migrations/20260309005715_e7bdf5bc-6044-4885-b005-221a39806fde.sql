
-- Fix infinite recursion in clerk_couple_members RLS policies
-- The issue: policies like members_see_space_members query clerk_couple_members
-- from within a policy ON clerk_couple_members, causing infinite recursion.

-- Step 1: Create a security definer function to check couple ownership safely
CREATE OR REPLACE FUNCTION public.is_couple_owner_safe(p_couple_id uuid, p_user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clerk_couple_members
    WHERE couple_id = p_couple_id
      AND user_id = p_user_id
      AND role = 'owner'::member_role
  );
$$;

-- Step 2: Drop the 3 recursive policies
DROP POLICY IF EXISTS "members_see_space_members" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "owners_can_delete_members" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "clerk_couple_members_update_own" ON public.clerk_couple_members;

-- Step 3: Recreate them using security definer functions (no recursion)

-- Members can see all members in their space (uses is_couple_member_safe)
CREATE POLICY "members_see_space_members"
ON public.clerk_couple_members
FOR SELECT
USING (
  public.is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text))
);

-- Owners can delete other members
CREATE POLICY "owners_can_delete_members"
ON public.clerk_couple_members
FOR DELETE
USING (
  public.is_couple_owner_safe(couple_id, (auth.jwt() ->> 'sub'::text))
);

-- Members can update own row OR owners can update any member in their space
CREATE POLICY "clerk_couple_members_update_own"
ON public.clerk_couple_members
FOR UPDATE
USING (
  (user_id = (auth.jwt() ->> 'sub'::text))
  OR public.is_couple_owner_safe(couple_id, (auth.jwt() ->> 'sub'::text))
);

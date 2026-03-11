-- Fix 1: Prevent couple members from self-promoting to owner role
-- Drop the existing policy and recreate with WITH CHECK
DROP POLICY IF EXISTS "clerk_couple_members_update_own" ON public.clerk_couple_members;

CREATE POLICY "clerk_couple_members_update_own"
ON public.clerk_couple_members
FOR UPDATE
TO public
USING (
  (user_id = (auth.jwt() ->> 'sub'::text))
  OR is_couple_owner_safe(couple_id, (auth.jwt() ->> 'sub'::text))
)
WITH CHECK (
  -- Non-owners cannot set role to 'owner'
  (role <> 'owner'::member_role)
  OR is_couple_owner_safe(couple_id, (auth.jwt() ->> 'sub'::text))
);

-- Fix 2: Restrict notifications INSERT to authenticated users inserting for themselves
DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;

CREATE POLICY "notifications_insert"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (user_id = (auth.jwt() ->> 'sub'::text));
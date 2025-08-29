-- Drop & recreate RLS for the 3 core tables
-- clerk_couples policies
DROP POLICY IF EXISTS "couples.delete" ON public.clerk_couples;
DROP POLICY IF EXISTS "couples.insert" ON public.clerk_couples;
DROP POLICY IF EXISTS "couples.select" ON public.clerk_couples;
DROP POLICY IF EXISTS "couples.update" ON public.clerk_couples;

alter table public.clerk_couples enable row level security;

create policy "couples.insert" on public.clerk_couples
for insert to authenticated
with check ( created_by is null or created_by = auth.jwt()->>'sub' );

create policy "couples.select" on public.clerk_couples
for select to authenticated
using ( public.is_couple_member(id) );

create policy "couples.update" on public.clerk_couples
for update to authenticated
using ( public.is_couple_member(id) )
with check ( public.is_couple_member(id) );

create policy "couples.delete" on public.clerk_couples
for delete to authenticated
using ( public.is_couple_owner(id) );

-- clerk_couple_members policies
DROP POLICY IF EXISTS "memberships.insert" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "memberships.select.mine" ON public.clerk_couple_members;
DROP POLICY IF EXISTS "memberships.manage" ON public.clerk_couple_members;

alter table public.clerk_couple_members enable row level security;

create policy "memberships.insert" on public.clerk_couple_members
for insert to authenticated
with check ( user_id = auth.jwt()->>'sub' );

create policy "memberships.select.mine" on public.clerk_couple_members
for select to authenticated
using ( user_id = auth.jwt()->>'sub' or public.is_couple_member(couple_id) );

create policy "memberships.manage" on public.clerk_couple_members
for all to authenticated
using ( public.is_couple_owner(couple_id) )
with check ( public.is_couple_owner(couple_id) );
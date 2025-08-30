-- Clean RLS policies for members table
alter table public.clerk_couple_members enable row level security;

-- Drop existing policies
drop policy if exists "memberships.insert" on public.clerk_couple_members;
drop policy if exists "memberships.select.mine" on public.clerk_couple_members;
drop policy if exists "memberships.manage" on public.clerk_couple_members;

-- Create new policies
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

-- Clean RLS policies for invites table
alter table public.invites enable row level security;

-- Drop existing policies
drop policy if exists "invites.insert" on public.invites;
drop policy if exists "invites.select" on public.invites;
drop policy if exists "invites.update" on public.invites;
drop policy if exists "invites.delete" on public.invites;
drop policy if exists "invites.by_token" on public.invites;

-- Create new policies
create policy "invites.insert" on public.invites
for insert to authenticated
with check ( invited_by = auth.jwt()->>'sub' and public.is_couple_member(couple_id) );

create policy "invites.select" on public.invites
for select to authenticated
using ( invited_by = auth.jwt()->>'sub' or public.is_couple_member(couple_id) );

create policy "invites.update" on public.invites
for update to authenticated
using ( public.is_couple_owner(couple_id) )
with check ( public.is_couple_owner(couple_id) );

create policy "invites.delete" on public.invites
for delete to authenticated
using ( public.is_couple_owner(couple_id) );

-- Optional public read when opening invitation landing page
create policy "invites.by_token" on public.invites
for select to anon, authenticated
using ( token is not null );
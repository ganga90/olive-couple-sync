-- Drop existing policies and create new ones for clerk_couples
drop policy if exists "couples.insert" on public.clerk_couples;
drop policy if exists "couples.select" on public.clerk_couples;
drop policy if exists "couples.update" on public.clerk_couples;
drop policy if exists "couples.delete" on public.clerk_couples;

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
-- Lists policies (secure)
alter table public.clerk_lists enable row level security;

-- Drop all existing list policies
drop policy if exists "lists.insert" on public.clerk_lists;
drop policy if exists "lists.select" on public.clerk_lists;
drop policy if exists "lists.update" on public.clerk_lists;
drop policy if exists "lists.delete" on public.clerk_lists;
drop policy if exists "Users can insert their own lists via Clerk" on public.clerk_lists;
drop policy if exists "Users can view their lists via Clerk" on public.clerk_lists;
drop policy if exists "Users can update their lists via Clerk" on public.clerk_lists;
drop policy if exists "Users can delete their lists via Clerk" on public.clerk_lists;

-- Create clean list policies
create policy "lists.insert" on public.clerk_lists
for insert to authenticated
with check (
  author_id = auth.jwt()->>'sub'
  and (couple_id is null or public.is_couple_member(couple_id))
);

create policy "lists.select" on public.clerk_lists
for select to authenticated
using (
  author_id = auth.jwt()->>'sub'
  or (couple_id is not null and public.is_couple_member(couple_id))
);

create policy "lists.update" on public.clerk_lists
for update to authenticated
using (
  author_id = auth.jwt()->>'sub'
  or (couple_id is not null and public.is_couple_member(couple_id))
)
with check (
  author_id = auth.jwt()->>'sub'
  or (couple_id is not null and public.is_couple_member(couple_id))
);

create policy "lists.delete" on public.clerk_lists
for delete to authenticated
using (
  author_id = auth.jwt()->>'sub'
  or (couple_id is not null and public.is_couple_member(couple_id))
);
-- Couples: members can read
drop policy if exists "couples_select" on public.clerk_couples;
create policy "couples_select" on public.clerk_couples
for select to authenticated
using (
  exists (
    select 1 from public.clerk_couple_members m
    where m.couple_id = clerk_couples.id
      and m.user_id = (auth.jwt() ->> 'sub')
  )
);

-- Couples: creator can insert
drop policy if exists "couples_insert" on public.clerk_couples;
create policy "couples_insert" on public.clerk_couples
for insert to authenticated
with check ( created_by = (auth.jwt() ->> 'sub') );

-- Couples: members can update
drop policy if exists "couples_update" on public.clerk_couples;
create policy "couples_update" on public.clerk_couples
for update to authenticated
using (
  exists (
    select 1 from public.clerk_couple_members m
    where m.couple_id = clerk_couples.id
      and m.user_id = (auth.jwt() ->> 'sub')
  )
)
with check (
  exists (
    select 1 from public.clerk_couple_members m
    where m.couple_id = clerk_couples.id
      and m.user_id = (auth.jwt() ->> 'sub')
  )
);

-- Members: show my rows or rows from my couples
drop policy if exists "couple_members_select" on public.clerk_couple_members;
create policy "couple_members_select" on public.clerk_couple_members
for select to authenticated
using (
  user_id = (auth.jwt() ->> 'sub')
  or exists (
    select 1 from public.clerk_couple_members m2
    where m2.couple_id = clerk_couple_members.couple_id
      and m2.user_id = (auth.jwt() ->> 'sub')
  )
);

-- Members: I can insert myself (used by create_couple)
drop policy if exists "couple_members_insert" on public.clerk_couple_members;
create policy "couple_members_insert" on public.clerk_couple_members
for insert to authenticated
with check ( user_id = (auth.jwt() ->> 'sub') );

-- Invites: members can read
drop policy if exists "invites_select" on public.clerk_invites;
create policy "invites_select" on public.clerk_invites
for select to authenticated
using (
  exists (
    select 1 from public.clerk_couple_members m
    where m.couple_id = clerk_invites.couple_id
      and m.user_id = (auth.jwt() ->> 'sub')
  )
);

-- Invites: only OWNER can create
drop policy if exists "invites_insert" on public.clerk_invites;
create policy "invites_insert" on public.clerk_invites
for insert to authenticated
with check (
  created_by = (auth.jwt() ->> 'sub')
  and exists (
    select 1 from public.clerk_couple_members m
    where m.couple_id = clerk_invites.couple_id
      and m.user_id = (auth.jwt() ->> 'sub')
      and m.role = 'owner'::public.member_role
  )
);
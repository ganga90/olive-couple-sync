-- Notes RLS for shared vs personal notes
alter table public.clerk_notes enable row level security;

drop policy if exists "notes_select" on public.clerk_notes;
create policy "notes_select" on public.clerk_notes
for select to authenticated
using (
  -- personal notes (no couple_id, I'm the author)
  (author_id = (auth.jwt() ->> 'sub') and couple_id is null)
  -- shared notes: any member of the couple can read
  or (couple_id is not null and exists (
    select 1 from public.clerk_couple_members m
    where m.couple_id = clerk_notes.couple_id
      and m.user_id = (auth.jwt() ->> 'sub')
  ))
);

drop policy if exists "notes_insert" on public.clerk_notes;
create policy "notes_insert" on public.clerk_notes
for insert to authenticated
with check (
  -- creating personal notes for myself
  (author_id = (auth.jwt() ->> 'sub') and couple_id is null)
  -- creating shared notes inside a couple where I'm a member
  or (couple_id is not null 
      and author_id = (auth.jwt() ->> 'sub')
      and exists (
        select 1 from public.clerk_couple_members m
        where m.couple_id = clerk_notes.couple_id
          and m.user_id = (auth.jwt() ->> 'sub')
      ))
);

drop policy if exists "notes_update" on public.clerk_notes;
create policy "notes_update" on public.clerk_notes
for update to authenticated
using (
  -- I can update personal notes I own…
  (author_id = (auth.jwt() ->> 'sub') and couple_id is null)
  -- …or any shared note in my couple space
  or (couple_id is not null and exists (
    select 1 from public.clerk_couple_members m
    where m.couple_id = clerk_notes.couple_id
      and m.user_id = (auth.jwt() ->> 'sub')
  ))
)
with check (
  -- same conditions for new values
  (author_id = (auth.jwt() ->> 'sub') and couple_id is null)
  or (couple_id is not null and exists (
    select 1 from public.clerk_couple_members m
    where m.couple_id = clerk_notes.couple_id
      and m.user_id = (auth.jwt() ->> 'sub')
  ))
);

drop policy if exists "notes_delete" on public.clerk_notes;
create policy "notes_delete" on public.clerk_notes
for delete to authenticated
using (
  -- I can delete personal notes I own…
  (author_id = (auth.jwt() ->> 'sub') and couple_id is null)
  -- …or any shared note in my couple space
  or (couple_id is not null and exists (
    select 1 from public.clerk_couple_members m
    where m.couple_id = clerk_notes.couple_id
      and m.user_id = (auth.jwt() ->> 'sub')
  ))
);
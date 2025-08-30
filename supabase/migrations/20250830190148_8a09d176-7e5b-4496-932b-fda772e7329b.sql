-- Ensure task_owner column exists in clerk_notes
alter table public.clerk_notes add column if not exists task_owner text;

-- === Lock down notes/lists policies ===
-- Notes policies (secure)
drop policy if exists "notes.insert" on public.clerk_notes;
drop policy if exists "notes.select" on public.clerk_notes;
drop policy if exists "notes.update" on public.clerk_notes;
drop policy if exists "notes.delete" on public.clerk_notes;
drop policy if exists "Users can insert their own notes via Clerk" on public.clerk_notes;
drop policy if exists "Users can view their notes via Clerk" on public.clerk_notes;
drop policy if exists "Users can update their notes via Clerk" on public.clerk_notes;
drop policy if exists "Users can delete their notes via Clerk" on public.clerk_notes;

alter table public.clerk_notes enable row level security;

create policy "notes.insert" on public.clerk_notes
for insert to authenticated
with check (
  author_id = auth.jwt()->>'sub'
  and (couple_id is null or public.is_couple_member(couple_id))
);

create policy "notes.select" on public.clerk_notes
for select to authenticated
using (
  author_id = auth.jwt()->>'sub'
  or (couple_id is not null and public.is_couple_member(couple_id))
);

create policy "notes.update" on public.clerk_notes
for update to authenticated
using (
  author_id = auth.jwt()->>'sub'
  or (couple_id is not null and public.is_couple_member(couple_id))
)
with check (
  author_id = auth.jwt()->>'sub'
  or (couple_id is not null and public.is_couple_member(couple_id))
);

create policy "notes.delete" on public.clerk_notes
for delete to authenticated
using (
  author_id = auth.jwt()->>'sub'
  or (couple_id is not null and public.is_couple_member(couple_id))
);
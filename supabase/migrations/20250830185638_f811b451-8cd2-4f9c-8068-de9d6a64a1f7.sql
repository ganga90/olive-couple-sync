-- Enable pgcrypto for gen_random_uuid/bytes if needed
create extension if not exists pgcrypto;

-- === Tables (create if missing) ===
create table if not exists public.clerk_couples (
  id uuid primary key default gen_random_uuid(),
  title text,
  you_name text,
  partner_name text,
  created_by text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.clerk_couple_members (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.clerk_couples(id) on delete cascade,
  user_id text not null,
  role text not null default 'owner',
  created_at timestamp with time zone default now()
);

-- enforce role values via CHECK (no enums anywhere)
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_name='clerk_couple_members'
      and constraint_name='clerk_couple_members_role_check'
  ) then
    alter table public.clerk_couple_members
      add constraint clerk_couple_members_role_check
      check (role in ('owner','member'));
  end if;
end $$;

create index if not exists idx_members_couple on public.clerk_couple_members(couple_id);
create index if not exists idx_members_user   on public.clerk_couple_members(user_id);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.clerk_couples(id) on delete cascade,
  invited_by text not null,
  invited_email text not null,
  token text unique,
  status text not null default 'pending',
  accepted_by text,
  created_at timestamp with time zone default now(),
  accepted_at timestamp with time zone
);

-- token + uniqueness
alter table public.invites
  alter column token set default encode(gen_random_bytes(16), 'hex');

create unique index if not exists invites_couple_email_unique
  on public.invites (couple_id, lower(invited_email));

-- Auto-fill created_by if client omits it
create or replace function public.set_created_by_from_jwt()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.created_by is null or new.created_by = '' then
    new.created_by := auth.jwt()->>'sub';
  end if;
  return new;
end $$;

drop trigger if exists trg_set_created_by on public.clerk_couples;
create trigger trg_set_created_by
before insert on public.clerk_couples
for each row execute function public.set_created_by_from_jwt();

-- === RLS helpers + policies (clean and minimal) ===
-- Helpers avoid any enum usage
create or replace function public.is_couple_member(c uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.clerk_couple_members m
    where m.couple_id = c and m.user_id = (auth.jwt()->>'sub')
  );
$$;

create or replace function public.is_couple_owner(c uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.clerk_couple_members m
    where m.couple_id = c and m.user_id = (auth.jwt()->>'sub') and m.role = 'owner'
  );
$$;

-- Debug helper (optional)
create or replace function public.debug_claims()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'role',  auth.role(),
    'sub',   auth.jwt()->>'sub',
    'claims', current_setting('request.jwt.claims', true)
  );
$$;

-- Reset policies (drop any existing and recreate)
do $$ begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='clerk_couples'
  loop execute format('drop policy if exists %I on public.clerk_couples', r.policyname); end loop;
end $$;
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

-- Members table
do $$ begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='clerk_couple_members'
  loop execute format('drop policy if exists %I on public.clerk_couple_members', r.policyname); end loop;
end $$;
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

-- Invites table
do $$ begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='invites'
  loop execute format('drop policy if exists %I on public.invites', r.policyname); end loop;
end $$;
alter table public.invites enable row level security;

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

-- === RPCs: create couple, invite partner, accept invite (atomic & safe) ===
-- Create a couple and owner membership in one transaction
create or replace function public.create_couple(
  p_title text default null,
  p_you_name text default null,
  p_partner_name text default null
) returns public.clerk_couples
language plpgsql security definer set search_path=public as $$
declare c public.clerk_couples;
begin
  insert into public.clerk_couples (title, you_name, partner_name, created_by)
  values (nullif(p_title,''), nullif(p_you_name,''), nullif(p_partner_name,''), auth.jwt()->>'sub')
  returning * into c;

  insert into public.clerk_couple_members (couple_id, user_id, role)
  values (c.id, auth.jwt()->>'sub', 'owner');

  return c;
end $$;

-- Create or refresh an invite for a partner (idempotent on couple+email)
create or replace function public.create_invite(
  p_couple_id uuid,
  p_invited_email text
) returns public.invites
language plpgsql security definer set search_path=public as $$
declare v public.invites;
begin
  if not public.is_couple_member(p_couple_id) then
    raise exception 'not a member of couple %', p_couple_id using errcode='42501';
  end if;

  insert into public.invites (couple_id, invited_by, invited_email)
  values (p_couple_id, auth.jwt()->>'sub', lower(p_invited_email))
  on conflict (couple_id, lower(invited_email))
  do update set invited_by = excluded.invited_by
  returning * into v;

  return v;
end $$;

-- Accept an invite by token and attach current user as 'member'
create or replace function public.accept_invite(
  p_token text
) returns public.clerk_couple_members
language plpgsql security definer set search_path=public as $$
declare i public.invites;
declare m public.clerk_couple_members;
begin
  select * into i from public.invites where token = p_token and status = 'pending';
  if not found then
    raise exception 'invalid or used invite token' using errcode='22023';
  end if;

  -- add membership (idempotent)
  insert into public.clerk_couple_members (couple_id, user_id, role)
  values (i.couple_id, auth.jwt()->>'sub', 'member')
  on conflict (couple_id, user_id) do update set role = 'member'
  returning * into m;

  update public.invites
    set status='accepted', accepted_by = auth.jwt()->>'sub', accepted_at = now()
  where id = i.id;

  return m;
end $$;

-- Ensure task_owner column exists in clerk_notes
alter table public.clerk_notes add column if not exists task_owner text;

-- === Lock down notes/lists/profiles policies ===
-- Notes policies (secure)
do $$ begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='clerk_notes'
  loop execute format('drop policy if exists %I on public.clerk_notes', r.policyname); end loop;
end $$;

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

-- Lists policies (secure)
do $$ begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='clerk_lists'
  loop execute format('drop policy if exists %I on public.clerk_lists', r.policyname); end loop;
end $$;

alter table public.clerk_lists enable row level security;

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
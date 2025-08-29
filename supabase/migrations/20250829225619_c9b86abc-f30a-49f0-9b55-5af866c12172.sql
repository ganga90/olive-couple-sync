-- Force role to TEXT and keep a CHECK (no enum anywhere)
alter table public.clerk_couple_members
  alter column role type text using role::text,
  alter column role set default 'owner';

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_name='clerk_couple_members' and constraint_name='clerk_couple_members_role_check'
  ) then
    alter table public.clerk_couple_members
      add constraint clerk_couple_members_role_check
      check (role in ('owner','member'));
  end if;
end $$;

-- Helpers WITHOUT enum casts
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

-- Trigger to auto-fill created_by from JWT
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

-- Drop & recreate RLS for the 3 core tables
-- clerk_couples
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

-- clerk_couple_members
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

-- invites
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

-- Optional: public read by token
create policy "invites.by_token" on public.invites
for select to anon, authenticated
using ( token is not null );

-- RPCs (SECURITY DEFINER) for atomic/clean writes
alter table public.invites
  alter column id set default gen_random_uuid(),
  alter column created_at set default now(),
  alter column token set default encode(gen_random_bytes(16), 'hex');
create unique index if not exists invites_couple_email_unique
  on public.invites (couple_id, invited_email);

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
  values (c.id, auth.jwt()->>'sub', 'owner');   -- TEXT, no enum cast

  return c;
end $$;

create or replace function public.create_invite(
  p_couple_id uuid,
  p_invited_email text
) returns public.invites
language plpgsql security definer set search_path=public as $$
declare v_row public.invites;
begin
  if not public.is_couple_member(p_couple_id) then
    raise exception 'not a member of couple %', p_couple_id using errcode='42501';
  end if;

  insert into public.invites (couple_id, invited_by, invited_email)
  values (p_couple_id, auth.jwt()->>'sub', lower(p_invited_email))
  on conflict (couple_id, invited_email) do update
    set invited_by = excluded.invited_by
  returning * into v_row;

  return v_row;
end $$;

-- Debug helper function
create or replace function public.debug_claims()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'sub',  auth.jwt()->>'sub',
    'role', auth.role(),
    'claims', current_setting('request.jwt.claims', true)
  );
$$;

-- Ensure task_owner column exists
alter table public.clerk_notes add column if not exists task_owner text;
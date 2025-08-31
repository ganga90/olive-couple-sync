-- Fix missing member_role enum by replacing with text constraints
-- and create proper RPCs for couple/invite creation

-- 1.1 Ensure required extensions exist (safe if already present)
create extension if not exists pgcrypto;

-- 1.2 Helper: who is the current Clerk user?
create or replace function public.current_user_id()
returns text
language sql
stable
as $$
  select auth.jwt()->>'sub'
$$;

-- 1.3 Replace helper functions (no enum casts, use text role)
create or replace function public.is_couple_member(couple_uuid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.clerk_couple_members m
    where m.couple_id = couple_uuid
      and m.user_id = auth.jwt()->>'sub'
  )
$$;

create or replace function public.is_couple_owner(couple_uuid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.clerk_couple_members m
    where m.couple_id = couple_uuid
      and m.user_id = auth.jwt()->>'sub'
      and m.role = 'owner'  -- TEXT, not enum
  )
$$;

-- 1.4 Make sure clerk_couple_members.role is TEXT and constrained (no enum)
-- If it's already TEXT, the USING cast is a no-op.
alter table if exists public.clerk_couple_members
  alter column role type text using role::text;

-- Add/replace a CHECK to allow only known roles
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clerk_couple_members_role_check'
  ) then
    alter table public.clerk_couple_members
      add constraint clerk_couple_members_role_check
      check (role in ('owner','partner','member'));
  end if;
end$$;

-- 1.5 Drop and recreate the create_couple RPC
-- Uses SECURITY DEFINER to do multi-row inserts and bypass table RLS,
-- but we validate the caller via auth.jwt().
create or replace function public.create_couple(
  p_title text,
  p_you_name text,
  p_partner_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  text := auth.jwt()->>'sub';
  v_couple_id uuid;
begin
  if v_user_id is null or v_user_id = '' then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  insert into public.clerk_couples (title, you_name, partner_name, created_by)
  values (p_title, p_you_name, p_partner_name, v_user_id)
  returning id into v_couple_id;

  insert into public.clerk_couple_members (couple_id, user_id, role)
  values (v_couple_id, v_user_id, 'owner');

  return v_couple_id;
end
$$;

grant execute on function public.create_couple(text,text,text) to anon, authenticated;

-- 1.6 Drop and recreate create_invite RPC
-- Returns the inserted invite row; validates that caller is a member.
create or replace function public.create_invite(
  p_couple_id uuid,
  p_expires_in_minutes int default 4320  -- 3 days
)
returns public.invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  text := auth.jwt()->>'sub';
  v_row public.invites;
begin
  if v_user_id is null or v_user_id = '' then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.clerk_couple_members
    where couple_id = p_couple_id and user_id = v_user_id
  ) then
    raise exception 'not a member of couple %', p_couple_id using errcode = '42501';
  end if;

  insert into public.invites (couple_id, invited_by, token, expires_at, status)
  values (
    p_couple_id,
    v_user_id,
    encode(gen_random_bytes(16), 'hex'),
    now() + make_interval(mins => p_expires_in_minutes),
    'pending'
  )
  returning * into v_row;

  return v_row;
end
$$;

grant execute on function public.create_invite(uuid,int) to anon, authenticated;

-- 1.7 Recreate RLS policies, removing any ::member_role casts
-- couples
alter table public.clerk_couples enable row level security;

drop policy if exists couples_select on public.clerk_couples;
drop policy if exists couples_insert on public.clerk_couples;
drop policy if exists couples_update on public.clerk_couples;
drop policy if exists couples_delete on public.clerk_couples;

create policy couples_select
  on public.clerk_couples for select
  to authenticated
  using (is_couple_member(id));

create policy couples_insert
  on public.clerk_couples for insert
  to authenticated
  with check (created_by = auth.jwt()->>'sub');

create policy couples_update
  on public.clerk_couples for update
  to authenticated
  using (is_couple_member(id))
  with check (is_couple_member(id));

create policy couples_delete
  on public.clerk_couples for delete
  to authenticated
  using (is_couple_owner(id));

-- couple_members
alter table public.clerk_couple_members enable row level security;

drop policy if exists couple_members_select on public.clerk_couple_members;
drop policy if exists couple_members_insert on public.clerk_couple_members;
drop policy if exists couple_members_update on public.clerk_couple_members;
drop policy if exists couple_members_delete on public.clerk_couple_members;

create policy couple_members_select
  on public.clerk_couple_members for select
  to authenticated
  using (
    user_id = auth.jwt()->>'sub'
    or is_couple_member(couple_id)
  );

create policy couple_members_insert
  on public.clerk_couple_members for insert
  to authenticated
  with check (user_id = auth.jwt()->>'sub');

create policy couple_members_update
  on public.clerk_couple_members for update
  to authenticated
  using (is_couple_owner(couple_id))
  with check (is_couple_owner(couple_id));

create policy couple_members_delete
  on public.clerk_couple_members for delete
  to authenticated
  using (is_couple_owner(couple_id));

-- invites
alter table public.invites enable row level security;

drop policy if exists invites_select on public.invites;
drop policy if exists invites_insert on public.invites;
drop policy if exists invites_update on public.invites;
drop policy if exists invites_delete on public.invites;

create policy invites_select
  on public.invites for select
  to authenticated
  using (
    invited_by = auth.jwt()->>'sub'
    or is_couple_member(couple_id)
  );

create policy invites_insert
  on public.invites for insert
  to authenticated
  with check (
    invited_by = auth.jwt()->>'sub'
    and is_couple_member(couple_id)
  );

create policy invites_update
  on public.invites for update
  to authenticated
  using (invited_by = auth.jwt()->>'sub' or is_couple_owner(couple_id))
  with check (invited_by = auth.jwt()->>'sub' or is_couple_owner(couple_id));

create policy invites_delete
  on public.invites for delete
  to authenticated
  using (invited_by = auth.jwt()->>'sub' or is_couple_owner(couple_id));
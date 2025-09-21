-- 1) Ensure 'member_role' enum exists (fixes "type member_role does not exist")
do $$ begin
  create type public.member_role as enum ('owner','partner');
exception when duplicate_object then null end $$;

-- 2) Ensure base couple tables exist (skip if you already have them)
create table if not exists public.clerk_couples (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  you_name text,
  partner_name text,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.clerk_couple_members (
  couple_id uuid references public.clerk_couples(id) on delete cascade,
  user_id text not null,
  role public.member_role not null default 'partner',
  primary key (couple_id, user_id)
);

-- 3) Invites table
create table if not exists public.clerk_invites (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  couple_id uuid not null references public.clerk_couples(id) on delete cascade,
  role public.member_role not null default 'partner',
  invited_email text,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by text,
  accepted_at timestamptz,
  revoked boolean not null default false
);

-- 4) RLS on but deny-by-default on invites (we'll only use RPC)
alter table public.clerk_invites enable row level security;

drop policy if exists "clerk_invites_select" on public.clerk_invites;
drop policy if exists "clerk_invites_insert" on public.clerk_invites;
drop policy if exists invites_nobody on public.clerk_invites;
create policy invites_nobody
on public.clerk_invites
for all using (false) with check (false);

-- Optional: allow creators to list their own invites in UI (not required for accept flow)
drop policy if exists invites_creator_select on public.clerk_invites;
create policy invites_creator_select
on public.clerk_invites
for select using (created_by = (auth.jwt() ->> 'sub'));

-- Helper: check if a user is member of a couple, but as SECURITY DEFINER
drop function if exists public.is_member_of_couple(uuid, text);
create or replace function public.is_member_of_couple(p_couple_id uuid, p_user_id text default (auth.jwt() ->> 'sub'))
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.clerk_couple_members m
    where m.couple_id = p_couple_id
      and m.user_id   = p_user_id
  );
$$;

grant execute on function public.is_member_of_couple(uuid, text) to anon, authenticated;

-- A) Create invite (owner only). Use this when generating the link in your UI.
drop function if exists public.create_invite(uuid, public.member_role, integer, text);
create or replace function public.create_invite(
  p_couple_id uuid,
  p_role public.member_role default 'partner',
  p_expires_in_seconds integer default 604800, -- 7 days
  p_invited_email text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
begin
  -- must be an OWNER of the couple to create invites
  if not exists (
    select 1
    from public.clerk_couple_members m
    where m.couple_id = p_couple_id
      and m.user_id   = (auth.jwt() ->> 'sub')
      and m.role      = 'owner'
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  insert into public.clerk_invites(token, couple_id, role, invited_email, created_by, expires_at)
  values (
    gen_random_uuid(),
    p_couple_id,
    coalesce(p_role, 'partner'),
    p_invited_email,
    (auth.jwt() ->> 'sub'),
    now() + make_interval(secs => greatest(60, least(coalesce(p_expires_in_seconds, 604800), 2592000)))
  )
  returning token into v_token;

  return v_token;
end $$;

grant execute on function public.create_invite(uuid, public.member_role, integer, text) to authenticated;

-- B) Validate an invite token (read-only data for landing page)
drop function if exists public.validate_invite(uuid);
create or replace function public.validate_invite(p_token uuid)
returns table(
  couple_id uuid,
  role public.member_role,
  title text,
  you_name text,
  partner_name text,
  expires_at timestamptz,
  revoked boolean,
  accepted boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select i.couple_id,
         i.role,
         c.title,
         c.you_name,
         c.partner_name,
         i.expires_at,
         i.revoked,
         (i.accepted_at is not null) as accepted
  from public.clerk_invites i
  join public.clerk_couples c on c.id = i.couple_id
  where i.token = p_token;
end $$;

grant execute on function public.validate_invite(uuid) to anon, authenticated;

-- C) Accept an invite (adds current user to couple)
drop function if exists public.accept_invite(uuid);
create or replace function public.accept_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
begin
  select * into v_invite
  from public.clerk_invites i
  where i.token = p_token
  for update;

  if not found then
    raise exception 'INVITE_NOT_FOUND';
  end if;

  if v_invite.revoked then
    raise exception 'INVITE_REVOKED';
  end if;

  if v_invite.accepted_at is not null then
    if v_invite.accepted_by = (auth.jwt() ->> 'sub') then
      -- idempotent if same user re-accepts
      return v_invite.couple_id;
    end if;
    raise exception 'INVITE_ALREADY_ACCEPTED';
  end if;

  if v_invite.expires_at <= now() then
    raise exception 'INVITE_EXPIRED';
  end if;

  -- insert membership for the current user
  insert into public.clerk_couple_members(couple_id, user_id, role)
  values (v_invite.couple_id, (auth.jwt() ->> 'sub'), v_invite.role)
  on conflict (couple_id, user_id) do nothing;

  -- mark invite as accepted
  update public.clerk_invites
  set accepted_at = now(), accepted_by = (auth.jwt() ->> 'sub')
  where token = p_token;

  return v_invite.couple_id;
end $$;

grant execute on function public.accept_invite(uuid) to authenticated;
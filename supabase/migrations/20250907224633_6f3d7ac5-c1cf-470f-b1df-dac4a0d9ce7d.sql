-- Extensions (safe if re-run)
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ENUM public.member_role ('owner','partner')
do $$
begin
  if not exists (select 1 from pg_type where typname = 'member_role') then
    create type public.member_role as enum ('owner','partner');
  end if;
end$$;

-- Couples
create table if not exists public.clerk_couples (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  you_name text,
  partner_name text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_clerk_couples_created_by on public.clerk_couples(created_by);

-- Members
create table if not exists public.clerk_couple_members (
  couple_id uuid not null references public.clerk_couples(id) on delete cascade,
  user_id text not null,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (couple_id, user_id)
);
create index if not exists idx_clerk_couple_members_user on public.clerk_couple_members(user_id);
create index if not exists idx_clerk_couple_members_couple on public.clerk_couple_members(couple_id);

-- Invites
create table if not exists public.clerk_invites (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.clerk_couples(id) on delete cascade,
  token text not null unique,
  invited_email text,
  status text not null default 'pending',
  created_by text not null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_clerk_couples_updated_at') then
    create trigger trg_clerk_couples_updated_at
    before update on public.clerk_couples
    for each row execute function public.set_updated_at();
  end if;
end$$;
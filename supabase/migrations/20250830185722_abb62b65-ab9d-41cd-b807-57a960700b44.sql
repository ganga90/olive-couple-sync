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
  created_at timestamp with time zone default now(),
  unique(couple_id, user_id)
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
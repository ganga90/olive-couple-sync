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
-- invites policies
DROP POLICY IF EXISTS "invites.insert" ON public.invites;
DROP POLICY IF EXISTS "invites.select" ON public.invites;
DROP POLICY IF EXISTS "invites.update" ON public.invites;
DROP POLICY IF EXISTS "invites.delete" ON public.invites;
DROP POLICY IF EXISTS "invites.by_token" ON public.invites;

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
returns jsonb language sql stable set search_path=public as $$
  select jsonb_build_object(
    'sub',  auth.jwt()->>'sub',
    'role', auth.role(),
    'claims', current_setting('request.jwt.claims', true)
  );
$$;

-- Ensure task_owner column exists
alter table public.clerk_notes add column if not exists task_owner text;
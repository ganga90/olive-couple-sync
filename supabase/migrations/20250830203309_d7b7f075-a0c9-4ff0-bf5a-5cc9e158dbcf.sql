-- First drop all RLS policies that depend on the functions
-- clerk_couples policies
drop policy if exists "couples.insert" on public.clerk_couples;
drop policy if exists "couples.select" on public.clerk_couples;
drop policy if exists "couples.update" on public.clerk_couples;
drop policy if exists "couples.delete" on public.clerk_couples;

-- clerk_couple_members policies  
drop policy if exists "memberships.insert" on public.clerk_couple_members;
drop policy if exists "memberships.select.mine" on public.clerk_couple_members;
drop policy if exists "memberships.manage" on public.clerk_couple_members;

-- invites policies
drop policy if exists "invites.insert" on public.invites;
drop policy if exists "invites.select.mine" on public.invites;
drop policy if exists "invites.select" on public.invites;
drop policy if exists "invites.update" on public.invites;
drop policy if exists "invites.delete" on public.invites;
drop policy if exists "Couple members can view couple invites" on public.invites;
drop policy if exists "invites.by_token" on public.invites;

-- notes policies
drop policy if exists "notes.insert" on public.clerk_notes;
drop policy if exists "notes.select" on public.clerk_notes;
drop policy if exists "notes.update" on public.clerk_notes;
drop policy if exists "notes.delete" on public.clerk_notes;

-- lists policies
drop policy if exists "lists.insert" on public.clerk_lists;
drop policy if exists "lists.select" on public.clerk_lists;
drop policy if exists "lists.update" on public.clerk_lists;
drop policy if exists "lists.delete" on public.clerk_lists;

-- Now drop all function variants
DROP FUNCTION IF EXISTS public.is_couple_member(uuid);
DROP FUNCTION IF EXISTS public.is_couple_member(uuid, text);
DROP FUNCTION IF EXISTS public.is_couple_owner(uuid);
DROP FUNCTION IF EXISTS public.is_couple_owner(uuid, text);
DROP FUNCTION IF EXISTS public.create_couple(text, text, text);
DROP FUNCTION IF EXISTS public.create_invite(uuid);
DROP FUNCTION IF EXISTS public.accept_invite(text);

-- Recreate functions with correct signatures
create function public.is_couple_member(couple_uuid uuid, user_id text)
returns boolean
language plpgsql
stable
as $$
begin
  return exists (
    select 1 from public.clerk_couple_members m
    where m.couple_id = couple_uuid and m.user_id = user_id
  );
end;
$$;

create function public.is_couple_owner(couple_uuid uuid, user_id text)
returns boolean
language plpgsql
stable
as $$
begin
  return exists (
    select 1 from public.clerk_couple_members m
    where m.couple_id = couple_uuid and m.user_id = user_id and m.role::text = 'owner'
  );
end;
$$;

-- Create couple and owner membership
create function public.create_couple(p_title text, p_you_name text, p_partner_name text)
returns public.clerk_couples
language plpgsql
as $$
declare
  uid text := auth.jwt()->>'sub';
  new_couple public.clerk_couples;
begin
  if uid is null then
    raise insufficient_privilege using message = 'unauthenticated';
  end if;

  insert into public.clerk_couples (title, you_name, partner_name, created_by)
  values (p_title, p_you_name, p_partner_name, uid)
  returning * into new_couple;

  -- add creator as owner
  insert into public.clerk_couple_members (couple_id, user_id, role)
  values (new_couple.id, uid, 'owner');

  return new_couple;
end;
$$;

-- Create invite for a couple you are a member of
create function public.create_invite(p_couple_id uuid)
returns public.invites
language plpgsql
as $$
declare
  uid text := auth.jwt()->>'sub';
  v_token text := encode(gen_random_bytes(16), 'hex');
  new_inv public.invites;
begin
  if uid is null then
    raise insufficient_privilege using message = 'unauthenticated';
  end if;

  if not is_couple_member(p_couple_id, uid) then
    raise insufficient_privilege using message = 'not a member of couple';
  end if;

  insert into public.invites (couple_id, invited_by, token)
  values (p_couple_id, uid, v_token)
  returning * into new_inv;

  return new_inv;
end;
$$;

-- Accept invite: add current user as 'partner' and return the couple
create function public.accept_invite(p_token text)
returns public.clerk_couples
language plpgsql
as $$
declare
  uid text := auth.jwt()->>'sub';
  v_couple uuid;
  couple_row public.clerk_couples;
begin
  if uid is null then
    raise insufficient_privilege using message = 'unauthenticated';
  end if;

  select couple_id into v_couple from public.invites where token = p_token;
  if v_couple is null then
    raise exception 'invalid token';
  end if;

  -- upsert membership
  insert into public.clerk_couple_members (couple_id, user_id, role)
  values (v_couple, uid, 'partner')
  on conflict (couple_id, user_id) do update set role = excluded.role;

  select * into couple_row from public.clerk_couples where id = v_couple;
  return couple_row;
end;
$$;

-- Recreate RLS policies using the new functions
-- clerk_couples
create policy "couples.insert"
on public.clerk_couples for insert
to authenticated
with check (created_by = auth.jwt()->>'sub');

create policy "couples.select"
on public.clerk_couples for select
to authenticated
using (is_couple_member(id, auth.jwt()->>'sub'));

create policy "couples.update"
on public.clerk_couples for update
to authenticated
using (is_couple_member(id, auth.jwt()->>'sub'))
with check (is_couple_member(id, auth.jwt()->>'sub'));

create policy "couples.delete"
on public.clerk_couples for delete
to authenticated
using (is_couple_owner(id, auth.jwt()->>'sub'));

-- clerk_couple_members
create policy "memberships.insert"
on public.clerk_couple_members for insert
to authenticated
with check (
  user_id = auth.jwt()->>'sub'
  and role::text in ('owner','partner')
);

create policy "memberships.select.mine"
on public.clerk_couple_members for select
to authenticated
using (
  user_id = auth.jwt()->>'sub'
  or is_couple_member(couple_id, auth.jwt()->>'sub')
);

create policy "memberships.manage"
on public.clerk_couple_members for all
to authenticated
using (is_couple_owner(couple_id, auth.jwt()->>'sub'))
with check (is_couple_owner(couple_id, auth.jwt()->>'sub'));

-- invites
create policy "invites.insert"
on public.invites for insert
to authenticated
with check (
  invited_by = auth.jwt()->>'sub'
  and is_couple_member(couple_id, auth.jwt()->>'sub')
);

create policy "invites.select.mine"
on public.invites for select
to authenticated
using (
  invited_by = auth.jwt()->>'sub'
  or is_couple_member(couple_id, auth.jwt()->>'sub')
);

create policy "invites.update"
on public.invites for update
to authenticated
using (is_couple_owner(couple_id, auth.jwt()->>'sub'))
with check (is_couple_owner(couple_id, auth.jwt()->>'sub'));

create policy "invites.delete"
on public.invites for delete
to authenticated
using (is_couple_owner(couple_id, auth.jwt()->>'sub'));

-- notes (change from public to authenticated)
create policy "notes.insert"
on public.clerk_notes for insert
to authenticated
with check (
  author_id = auth.jwt()->>'sub'
  and (couple_id is null or is_couple_member(couple_id, auth.jwt()->>'sub'))
);

create policy "notes.select"
on public.clerk_notes for select
to authenticated
using (
  author_id = auth.jwt()->>'sub'
  or (couple_id is not null and is_couple_member(couple_id, auth.jwt()->>'sub'))
);

create policy "notes.update"
on public.clerk_notes for update
to authenticated
using (
  author_id = auth.jwt()->>'sub'
  or (couple_id is not null and is_couple_member(couple_id, auth.jwt()->>'sub'))
);

create policy "notes.delete"
on public.clerk_notes for delete
to authenticated
using (
  author_id = auth.jwt()->>'sub'
  or (couple_id is not null and is_couple_member(couple_id, auth.jwt()->>'sub'))
);

-- lists (change from public to authenticated)
create policy "lists.insert"
on public.clerk_lists for insert
to authenticated
with check (
  author_id = auth.jwt()->>'sub'
  and (couple_id is null or is_couple_member(couple_id, auth.jwt()->>'sub'))
);

create policy "lists.select"
on public.clerk_lists for select
to authenticated
using (
  author_id = auth.jwt()->>'sub'
  or (couple_id is not null and is_couple_member(couple_id, auth.jwt()->>'sub'))
);

create policy "lists.update"
on public.clerk_lists for update
to authenticated
using (
  author_id = auth.jwt()->>'sub'
  or (couple_id is not null and is_couple_member(couple_id, auth.jwt()->>'sub'))
);

create policy "lists.delete"
on public.clerk_lists for delete
to authenticated
using (
  author_id = auth.jwt()->>'sub'
  or (couple_id is not null and is_couple_member(couple_id, auth.jwt()->>'sub'))
);
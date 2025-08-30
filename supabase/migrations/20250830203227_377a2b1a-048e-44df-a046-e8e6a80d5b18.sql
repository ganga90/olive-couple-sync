-- Drop ALL existing function variants first
DROP FUNCTION IF EXISTS public.is_couple_member(uuid);
DROP FUNCTION IF EXISTS public.is_couple_member(uuid, text);
DROP FUNCTION IF EXISTS public.is_couple_owner(uuid);
DROP FUNCTION IF EXISTS public.is_couple_owner(uuid, text);
DROP FUNCTION IF EXISTS public.create_couple(text, text, text);
DROP FUNCTION IF EXISTS public.create_invite(uuid);
DROP FUNCTION IF EXISTS public.accept_invite(text);

-- Now recreate with correct signatures
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
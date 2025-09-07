-- Create couple: insert couple + owner membership
create or replace function public.create_couple(
  p_you_name     text,
  p_partner_name text,
  p_title        text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  text := (auth.jwt() ->> 'sub');
  v_couple_id uuid;
begin
  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;

  insert into public.clerk_couples (title, you_name, partner_name, created_by)
  values (p_title, p_you_name, p_partner_name, v_user_id)
  returning id into v_couple_id;

  insert into public.clerk_couple_members (couple_id, user_id, role)
  values (v_couple_id, v_user_id, 'owner'::public.member_role);

  return v_couple_id;
end;
$$;

grant execute on function public.create_couple(text, text, text) to authenticated;

-- Create invite for a couple I own
create or replace function public.create_invite(
  p_couple_id uuid,
  p_invited_email text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  text := (auth.jwt() ->> 'sub');
  v_token    uuid := gen_random_uuid();
  v_row      jsonb;
begin
  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;

  -- must be owner
  if not exists (
    select 1
    from public.clerk_couple_members m
    where m.couple_id = p_couple_id
      and m.user_id    = v_user_id
      and m.role       = 'owner'::public.member_role
  ) then
    raise exception 'not_owner';
  end if;

  insert into public.clerk_invites (couple_id, token, invited_email, created_by)
  values (p_couple_id, v_token::text, p_invited_email, v_user_id)
  returning jsonb_build_object(
    'invite_id', id,
    'token', token,
    'couple_id', couple_id
  ) into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_invite(uuid, text) to authenticated;

-- Accept invite and join couple
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  text := (auth.jwt() ->> 'sub');
  v_couple_id uuid;
begin
  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;

  select couple_id into v_couple_id
  from public.clerk_invites
  where token = p_token
    and status = 'pending'
    and expires_at > now()
  limit 1;

  if v_couple_id is null then
    raise exception 'invalid_or_expired';
  end if;

  -- Add member if not already
  insert into public.clerk_couple_members (couple_id, user_id, role)
  values (v_couple_id, v_user_id, 'partner'::public.member_role)
  on conflict (couple_id, user_id) do nothing;

  update public.clerk_invites
  set status = 'accepted'
  where token = p_token;

  return v_couple_id;
end;
$$;

grant execute on function public.accept_invite(text) to authenticated;
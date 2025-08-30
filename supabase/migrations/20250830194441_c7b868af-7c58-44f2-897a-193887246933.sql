-- Drop existing functions first
DROP FUNCTION IF EXISTS create_couple(text, text, text);
DROP FUNCTION IF EXISTS create_invite(uuid, text);
DROP FUNCTION IF EXISTS accept_invite(text);

-- Create couple + owner membership in one transaction
create or replace function public.create_couple(
  p_title text,
  p_you_name text,
  p_partner_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid text := auth.jwt()->>'sub';
  c   clerk_couples;
  m   clerk_couple_members;
begin
  if uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  insert into clerk_couples (title, you_name, partner_name, created_by)
  values (p_title, p_you_name, p_partner_name, uid)
  returning * into c;

  insert into clerk_couple_members (couple_id, user_id, role)
  values (c.id, uid, 'owner')
  returning * into m;

  return jsonb_build_object('couple', to_jsonb(c), 'membership', to_jsonb(m));
end $$;

-- Create invite (only owner)
create or replace function public.create_invite(p_couple_id uuid)
returns invites
language plpgsql
security definer
set search_path = public
as $$
declare
  uid text := auth.jwt()->>'sub';
  rec invites;
begin
  if uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if not is_couple_owner(p_couple_id, uid) then
    raise exception 'not a member of couple %', p_couple_id using errcode = '42501';
  end if;

  insert into invites (couple_id, invited_by, token, expires_at)
  values (p_couple_id, uid, encode(gen_random_bytes(16),'hex'), now() + interval '7 days')
  returning * into rec;

  return rec;
end $$;

-- Accept invite (new member becomes 'partner')
create or replace function public.accept_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid text := auth.jwt()->>'sub';
  inv invites;
  m   clerk_couple_members;
begin
  if uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select * into inv from invites
  where token = p_token and (expires_at is null or expires_at > now());

  if inv is null then
    raise exception 'invalid or expired invite' using errcode = '22023';
  end if;

  -- If already a member, just return
  if is_couple_member(inv.couple_id, uid) then
    return jsonb_build_object('status', 'already_member');
  end if;

  insert into clerk_couple_members (couple_id, user_id, role)
  values (inv.couple_id, uid, 'partner')
  returning * into m;

  return jsonb_build_object('status', 'joined', 'membership', to_jsonb(m));
end $$;
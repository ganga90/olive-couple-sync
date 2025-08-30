-- === RPCs: create couple, invite partner, accept invite (atomic & safe) ===
-- Create a couple and owner membership in one transaction
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
  values (c.id, auth.jwt()->>'sub', 'owner');

  return c;
end $$;

-- Create or refresh an invite for a partner (idempotent on couple+email)
create or replace function public.create_invite(
  p_couple_id uuid,
  p_invited_email text
) returns public.invites
language plpgsql security definer set search_path=public as $$
declare v public.invites;
begin
  if not public.is_couple_member(p_couple_id) then
    raise exception 'not a member of couple %', p_couple_id using errcode='42501';
  end if;

  insert into public.invites (couple_id, invited_by, invited_email)
  values (p_couple_id, auth.jwt()->>'sub', lower(p_invited_email))
  on conflict (couple_id, lower(invited_email))
  do update set invited_by = excluded.invited_by
  returning * into v;

  return v;
end $$;

-- Accept an invite by token and attach current user as 'member'
create or replace function public.accept_invite(
  p_token text
) returns public.clerk_couple_members
language plpgsql security definer set search_path=public as $$
declare i public.invites;
declare m public.clerk_couple_members;
begin
  select * into i from public.invites where token = p_token and status = 'pending';
  if not found then
    raise exception 'invalid or used invite token' using errcode='22023';
  end if;

  -- add membership (idempotent)
  insert into public.clerk_couple_members (couple_id, user_id, role)
  values (i.couple_id, auth.jwt()->>'sub', 'member')
  on conflict (couple_id, user_id) do update set role = 'member'
  returning * into m;

  update public.invites
    set status='accepted', accepted_by = auth.jwt()->>'sub', accepted_at = now()
  where id = i.id;

  return m;
end $$;
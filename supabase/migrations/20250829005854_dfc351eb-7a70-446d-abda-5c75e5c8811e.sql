-- Fix Clerk-Supabase integration with proper RLS policies and invite RPC

-- Helper functions for RLS policies
create or replace function public.is_couple_member(c uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from clerk_couple_members m
    where m.couple_id = c and m.user_id = (auth.jwt()->>'sub')
  )
$$;

create or replace function public.is_couple_owner(c uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from clerk_couple_members m
    where m.couple_id = c and m.user_id = (auth.jwt()->>'sub') and m.role = 'owner'::member_role
  )
$$;

-- Enable RLS on all tables
alter table clerk_couples enable row level security;
alter table clerk_couple_members enable row level security;
alter table invites enable row level security;
alter table clerk_notes enable row level security;
alter table clerk_lists enable row level security;

-- clerk_couples policies
drop policy if exists "couples.insert" on clerk_couples;
create policy "couples.insert"
on clerk_couples for insert to authenticated
with check ( created_by = (auth.jwt()->>'sub') );

drop policy if exists "couples.select" on clerk_couples;
create policy "couples.select"
on clerk_couples for select to authenticated
using ( is_couple_member(id) );

drop policy if exists "couples.update" on clerk_couples;
create policy "couples.update"
on clerk_couples for update to authenticated
using ( is_couple_member(id) )
with check ( is_couple_member(id) );

drop policy if exists "couples.delete" on clerk_couples;
create policy "couples.delete"
on clerk_couples for delete to authenticated
using ( is_couple_owner(id) );

-- clerk_couple_members policies
drop policy if exists "memberships.insert" on clerk_couple_members;
create policy "memberships.insert"
on clerk_couple_members for insert to authenticated
with check ( user_id = (auth.jwt()->>'sub') );

drop policy if exists "memberships.select.mine" on clerk_couple_members;
create policy "memberships.select.mine"
on clerk_couple_members for select to authenticated
using ( user_id = (auth.jwt()->>'sub') or is_couple_member(couple_id) );

drop policy if exists "memberships.manage" on clerk_couple_members;
create policy "memberships.manage"
on clerk_couple_members for all to authenticated
using ( is_couple_owner(couple_id) )
with check ( is_couple_owner(couple_id) );

-- invites policies
drop policy if exists "invites.insert" on invites;
create policy "invites.insert"
on invites for insert to authenticated
with check (
  invited_by = (auth.jwt()->>'sub')
  and is_couple_member(couple_id)
);

drop policy if exists "invites.select.mine" on invites;
create policy "invites.select.mine"
on invites for select to authenticated
using ( invited_by = (auth.jwt()->>'sub') or is_couple_member(couple_id) );

drop policy if exists "invites.update" on invites;
create policy "invites.update"
on invites for update to authenticated
using ( is_couple_owner(couple_id) )
with check ( is_couple_owner(couple_id) );

drop policy if exists "invites.delete" on invites;
create policy "invites.delete"
on invites for delete to authenticated
using ( is_couple_owner(couple_id) );

-- Public read by token (only if row has no PII)
drop policy if exists "invites.by_token" on invites;
create policy "invites.by_token"
on invites for select to anon, authenticated
using ( token is not null );

-- clerk_notes policies
drop policy if exists "notes.insert" on clerk_notes;
create policy "notes.insert"
on clerk_notes for insert to authenticated
with check (
  author_id = (auth.jwt()->>'sub') and
  (couple_id is null or is_couple_member(couple_id))
);

drop policy if exists "notes.select" on clerk_notes;
create policy "notes.select"
on clerk_notes for select to authenticated
using (
  author_id = (auth.jwt()->>'sub') or
  (couple_id is not null and is_couple_member(couple_id))
);

drop policy if exists "notes.update" on clerk_notes;
create policy "notes.update"
on clerk_notes for update to authenticated
using (
  author_id = (auth.jwt()->>'sub') or
  (couple_id is not null and is_couple_member(couple_id))
);

drop policy if exists "notes.delete" on clerk_notes;
create policy "notes.delete"
on clerk_notes for delete to authenticated
using (
  author_id = (auth.jwt()->>'sub') or
  (couple_id is not null and is_couple_member(couple_id))
);

-- clerk_lists policies
drop policy if exists "lists.insert" on clerk_lists;
create policy "lists.insert"
on clerk_lists for insert to authenticated
with check (
  author_id = (auth.jwt()->>'sub') and
  (couple_id is null or is_couple_member(couple_id))
);

drop policy if exists "lists.select" on clerk_lists;
create policy "lists.select"
on clerk_lists for select to authenticated
using (
  author_id = (auth.jwt()->>'sub') or
  (couple_id is not null and is_couple_member(couple_id))
);

drop policy if exists "lists.update" on clerk_lists;
create policy "lists.update"
on clerk_lists for update to authenticated
using (
  author_id = (auth.jwt()->>'sub') or
  (couple_id is not null and is_couple_member(couple_id))
);

drop policy if exists "lists.delete" on clerk_lists;
create policy "lists.delete"
on clerk_lists for delete to authenticated
using (
  author_id = (auth.jwt()->>'sub') or
  (couple_id is not null and is_couple_member(couple_id))
);

-- Make invites idempotent with defaults and unique constraint
alter table invites
  alter column token set default encode(gen_random_bytes(16), 'hex');

-- Unique constraint for one invite per (couple, email)
create unique index if not exists invites_couple_email_unique
  on invites (couple_id, invited_email);

-- Create RPC function for idempotent invite creation
create or replace function public.create_invite(
  p_couple_id uuid,
  p_invited_email text
) returns invites
language plpgsql
security definer
set search_path = public
as $$
declare v_row invites;
begin
  if not is_couple_member(p_couple_id) then
    raise exception 'not a member of couple %', p_couple_id using errcode = '42501';
  end if;

  insert into invites (couple_id, invited_by, invited_email)
  values (p_couple_id, (auth.jwt()->>'sub'), p_invited_email)
  on conflict (couple_id, invited_email) do update
    set invited_by = excluded.invited_by,
        created_at = now(),
        token = encode(gen_random_bytes(16), 'hex'),
        status = 'pending'::invite_status
  returning * into v_row;

  return v_row;
end $$;
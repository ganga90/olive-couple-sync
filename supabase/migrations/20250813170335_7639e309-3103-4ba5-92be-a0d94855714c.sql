-- Enums
create type public.member_role as enum ('owner', 'member');
create type public.invite_status as enum ('pending', 'accepted', 'revoked');
create type public.note_priority as enum ('low','medium','high');

-- Profiles table (mapped to Supabase auth users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Couples (workspaces)
create table public.couples (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  title text,
  you_name text,
  partner_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Members of couples
create table public.couple_members (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (couple_id, user_id)
);

-- Invites to join couples
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  token text not null unique,
  invited_email text not null,
  invited_by uuid references auth.users(id) on delete set null,
  status public.invite_status not null default 'pending',
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- Notes linked to couples
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  original_text text not null,
  summary text not null,
  category text not null,
  due_date timestamptz,
  tags text[],
  items text[],
  completed boolean not null default false,
  priority public.note_priority,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Updated at trigger
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger set_couples_updated_at
before update on public.couples
for each row execute function public.set_updated_at();

create trigger set_notes_updated_at
before update on public.notes
for each row execute function public.set_updated_at();

-- Auto add creator as owner member
create or replace function public.add_creator_as_member()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.couple_members (couple_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (couple_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger add_creator_as_member
after insert on public.couples
for each row execute function public.add_creator_as_member();

-- Invite expiry validation trigger
create or replace function public.validate_invite_expiry()
returns trigger as $$
begin
  if new.expires_at is not null and new.expires_at <= now() then
    raise exception 'expires_at must be in the future';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger validate_invite_expiry
before insert or update on public.invites
for each row execute function public.validate_invite_expiry();

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.couples enable row level security;
alter table public.couple_members enable row level security;
alter table public.invites enable row level security;
alter table public.notes enable row level security;

-- RLS policies
-- profiles: users manage their own profile
create policy "Profiles are viewable by owner" on public.profiles
for select using (id = auth.uid());
create policy "Users can insert own profile" on public.profiles
for insert with check (id = auth.uid());
create policy "Users can update own profile" on public.profiles
for update using (id = auth.uid());

-- couples: members can view; creator can create; members can update; owners can delete
create policy "Members can view their couples" on public.couples
for select using (exists (
  select 1 from public.couple_members m
  where m.couple_id = couples.id and m.user_id = auth.uid()
));
create policy "Users can create couples" on public.couples
for insert with check (created_by = auth.uid());
create policy "Members can update their couples" on public.couples
for update using (exists (
  select 1 from public.couple_members m
  where m.couple_id = couples.id and m.user_id = auth.uid()
));
create policy "Owners can delete their couples" on public.couples
for delete using (exists (
  select 1 from public.couple_members m
  where m.couple_id = couples.id and m.user_id = auth.uid() and m.role = 'owner'
));

-- couple_members: users can see their membership; only owners can manage memberships in their couples
create policy "Users can view their memberships" on public.couple_members
for select using (user_id = auth.uid());
create policy "Owners can add members" on public.couple_members
for insert with check (exists (
  select 1 from public.couple_members m
  where m.couple_id = couple_members.couple_id and m.user_id = auth.uid() and m.role = 'owner'
));
create policy "Owners can update members" on public.couple_members
for update using (exists (
  select 1 from public.couple_members m
  where m.couple_id = couple_members.couple_id and m.user_id = auth.uid() and m.role = 'owner'
));
create policy "Owners can remove members" on public.couple_members
for delete using (exists (
  select 1 from public.couple_members m
  where m.couple_id = couple_members.couple_id and m.user_id = auth.uid() and m.role = 'owner'
));

-- invites: owners can manage, inviter can see
create policy "Owners can manage invites" on public.invites
for all using (exists (
  select 1 from public.couple_members m
  where m.couple_id = invites.couple_id and m.user_id = auth.uid() and m.role = 'owner'
)) with check (exists (
  select 1 from public.couple_members m
  where m.couple_id = invites.couple_id and m.user_id = auth.uid() and m.role = 'owner'
));
create policy "Inviter can view invite" on public.invites
for select using (invited_by = auth.uid());

-- notes: members can CRUD within their couple
create policy "Members can view notes in their couples" on public.notes
for select using (exists (
  select 1 from public.couple_members m
  where m.couple_id = notes.couple_id and m.user_id = auth.uid()
));
create policy "Members can insert notes in their couples" on public.notes
for insert with check (exists (
  select 1 from public.couple_members m
  where m.couple_id = notes.couple_id and m.user_id = auth.uid()
) and (author_id = auth.uid()));
create policy "Members can update notes in their couples" on public.notes
for update using (exists (
  select 1 from public.couple_members m
  where m.couple_id = notes.couple_id and m.user_id = auth.uid()
));
create policy "Members can delete notes in their couples" on public.notes
for delete using (exists (
  select 1 from public.couple_members m
  where m.couple_id = notes.couple_id and m.user_id = auth.uid()
));

-- Realtime configuration
alter table public.couples replica identity full;
alter table public.couple_members replica identity full;
alter table public.notes replica identity full;

-- Add tables to realtime publication (ignore if already added)
do $$ begin
  execute 'alter publication supabase_realtime add table public.couples';
  execute 'alter publication supabase_realtime add table public.couple_members';
  execute 'alter publication supabase_realtime add table public.notes';
exception when others then null; end $$;
-- Enable RLS on all new tables
alter table public.clerk_couples enable row level security;
alter table public.clerk_couple_members enable row level security;
alter table public.clerk_invites enable row level security;

-- Fix function search paths for security
create or replace function public.add_creator_as_member()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  if new.created_by is not null then
    insert into public.couple_members (couple_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (couple_id, user_id) do nothing;
  end if;
  return new;
end;
$function$;

create or replace function public.validate_invite_expiry()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  if new.expires_at is not null and new.expires_at <= now() then
    raise exception 'expires_at must be in the future';
  end if;
  return new;
end;
$function$;

create or replace function public.send_invite_email()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
DECLARE
  invite_url text;
BEGIN
  -- Only process new invites with pending status
  IF NEW.status = 'pending' AND OLD.status IS DISTINCT FROM 'pending' THEN
    -- Construct invite URL
    invite_url := 'https://lovable.dev/projects/olive-couple-shared-brain/accept-invite?token=' || NEW.token;
    
    -- Here we would normally call an edge function to send the email
    -- For now, we'll just log the invite URL
    RAISE NOTICE 'Invite URL for %: %', NEW.invited_email, invite_url;
  END IF;
  
  RETURN NEW;
END;
$function$;

create or replace function public.add_clerk_creator_as_member()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  if new.created_by is not null then
    insert into public.clerk_couple_members (couple_id, user_id, role)
    values (new.id, new.created_by, 'owner'::member_role)
    on conflict do nothing;
  end if;
  return new;
end;
$function$;
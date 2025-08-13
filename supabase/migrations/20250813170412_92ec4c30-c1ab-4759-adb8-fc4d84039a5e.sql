-- Fix function search paths for security
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.validate_invite_expiry()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.expires_at is not null and new.expires_at <= now() then
    raise exception 'expires_at must be in the future';
  end if;
  return new;
end;
$$;
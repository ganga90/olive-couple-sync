-- Fix search path security warnings for functions
create or replace function public.is_couple_member(c uuid)
returns boolean language sql stable 
security definer set search_path = public as $$
  select exists (
    select 1 from public.clerk_couple_members m
    where m.couple_id = c and m.user_id = (auth.jwt()->>'sub')
  );
$$;

create or replace function public.is_couple_owner(c uuid)
returns boolean language sql stable 
security definer set search_path = public as $$
  select exists (
    select 1 from public.clerk_couple_members m
    where m.couple_id = c and m.user_id = (auth.jwt()->>'sub') and m.role = 'owner'
  );
$$;
-- === RLS helpers + policies (clean and minimal) ===
-- Helpers avoid any enum usage
create or replace function public.is_couple_member(c uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.clerk_couple_members m
    where m.couple_id = c and m.user_id = (auth.jwt()->>'sub')
  );
$$;

create or replace function public.is_couple_owner(c uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.clerk_couple_members m
    where m.couple_id = c and m.user_id = (auth.jwt()->>'sub') and m.role = 'owner'
  );
$$;

-- Debug helper (optional)
create or replace function public.debug_claims()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'role',  auth.role(),
    'sub',   auth.jwt()->>'sub',
    'claims', current_setting('request.jwt.claims', true)
  );
$$;
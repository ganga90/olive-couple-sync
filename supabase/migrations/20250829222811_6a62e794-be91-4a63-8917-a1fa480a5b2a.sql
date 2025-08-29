-- === Step 3: Remove enum refs, normalize policies, add triggers & RPCs ===

-- Make role TEXT & constrain values (removes enum dependency)
ALTER TABLE public.clerk_couple_members
  ALTER COLUMN role TYPE text USING role::text,
  ALTER COLUMN role SET DEFAULT 'owner';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='clerk_couple_members'
      AND constraint_name='clerk_couple_members_role_check'
  ) THEN
    ALTER TABLE public.clerk_couple_members
      ADD CONSTRAINT clerk_couple_members_role_check
      CHECK (role IN ('owner','member'));
  END IF;
END $$;

-- === Helpers: NO enum casts anywhere ===
CREATE OR REPLACE FUNCTION public.is_couple_member(c uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clerk_couple_members m
    WHERE m.couple_id = c AND m.user_id = (auth.jwt()->>'sub')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_couple_owner(c uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clerk_couple_members m
    WHERE m.couple_id = c AND m.user_id = (auth.jwt()->>'sub') AND m.role = 'owner'
  );
$$;

-- === Trigger: fill created_by from JWT so client may omit it ===
CREATE OR REPLACE FUNCTION public.set_created_by_from_jwt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.created_by IS NULL OR NEW.created_by = '' THEN
    NEW.created_by := auth.jwt()->>'sub';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_created_by ON public.clerk_couples;
CREATE TRIGGER trg_set_created_by
BEFORE INSERT ON public.clerk_couples
FOR EACH ROW EXECUTE FUNCTION public.set_created_by_from_jwt();

-- === Reset RLS policies consistently ===
-- clerk_couples
DO $$ BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='clerk_couples'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.clerk_couples', r.policyname); END LOOP;
END $$;
ALTER TABLE public.clerk_couples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "couples.insert" ON public.clerk_couples
FOR INSERT TO authenticated
WITH CHECK ( created_by IS NULL OR created_by = auth.jwt()->>'sub' );

CREATE POLICY "couples.select" ON public.clerk_couples
FOR SELECT TO authenticated
USING ( public.is_couple_member(id) );

CREATE POLICY "couples.update" ON public.clerk_couples
FOR UPDATE TO authenticated
USING ( public.is_couple_member(id) )
WITH CHECK ( public.is_couple_member(id) );

CREATE POLICY "couples.delete" ON public.clerk_couples
FOR DELETE TO authenticated
USING ( public.is_couple_owner(id) );

-- clerk_couple_members
DO $$ BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='clerk_couple_members'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.clerk_couple_members', r.policyname); END LOOP;
END $$;
ALTER TABLE public.clerk_couple_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "memberships.insert" ON public.clerk_couple_members
FOR INSERT TO authenticated
WITH CHECK ( user_id = auth.jwt()->>'sub' );

CREATE POLICY "memberships.select.mine" ON public.clerk_couple_members
FOR SELECT TO authenticated
USING ( user_id = auth.jwt()->>'sub' OR public.is_couple_member(couple_id) );

CREATE POLICY "memberships.manage" ON public.clerk_couple_members
FOR ALL TO authenticated
USING ( public.is_couple_owner(couple_id) )
WITH CHECK ( public.is_couple_owner(couple_id) );

-- invites
DO $$ BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='invites'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.invites', r.policyname); END LOOP;
END $$;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invites.insert" ON public.invites
FOR INSERT TO authenticated
WITH CHECK ( invited_by = auth.jwt()->>'sub' AND public.is_couple_member(couple_id) );

CREATE POLICY "invites.select" ON public.invites
FOR SELECT TO authenticated
USING ( invited_by = auth.jwt()->>'sub' OR public.is_couple_member(couple_id) );

CREATE POLICY "invites.update" ON public.invites
FOR UPDATE TO authenticated
USING ( public.is_couple_owner(couple_id) )
WITH CHECK ( public.is_couple_owner(couple_id) );

CREATE POLICY "invites.delete" ON public.invites
FOR DELETE TO authenticated
USING ( public.is_couple_owner(couple_id) );

-- Optional public read by token
CREATE POLICY "invites.by_token" ON public.invites
FOR SELECT TO anon, authenticated
USING ( token IS NOT NULL );

-- === RPCs (SECURITY DEFINER) to avoid client races ===
ALTER TABLE public.invites
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN token SET DEFAULT encode(gen_random_bytes(16), 'hex');

CREATE UNIQUE INDEX IF NOT EXISTS invites_couple_email_unique
  ON public.invites (couple_id, invited_email);

CREATE OR REPLACE FUNCTION public.create_couple(
  p_title text DEFAULT NULL,
  p_you_name text DEFAULT NULL,
  p_partner_name text DEFAULT NULL
) RETURNS public.clerk_couples
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.clerk_couples;
BEGIN
  INSERT INTO public.clerk_couples (title, you_name, partner_name, created_by)
  VALUES (nullif(p_title,''), nullif(p_you_name,''), nullif(p_partner_name,''), auth.jwt()->>'sub')
  RETURNING * INTO c;

  INSERT INTO public.clerk_couple_members (couple_id, user_id, role)
  VALUES (c.id, auth.jwt()->>'sub', 'owner');

  RETURN c;
END $$;

CREATE OR REPLACE FUNCTION public.create_invite(
  p_couple_id uuid,
  p_invited_email text
) RETURNS public.invites
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row public.invites;
BEGIN
  IF NOT public.is_couple_member(p_couple_id) THEN
    RAISE EXCEPTION 'not a member of couple %', p_couple_id USING errcode='42501';
  END IF;

  INSERT INTO public.invites (couple_id, invited_by, invited_email)
  VALUES (p_couple_id, auth.jwt()->>'sub', lower(p_invited_email))
  ON CONFLICT (couple_id, invited_email) DO UPDATE
    SET invited_by = EXCLUDED.invited_by,
        created_at = now(),
        token = encode(gen_random_bytes(16), 'hex'),
        status = 'pending'
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;
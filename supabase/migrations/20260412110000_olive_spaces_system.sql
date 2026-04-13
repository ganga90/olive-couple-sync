-- Olive Spaces System — Phase A: Add, Don't Replace
-- ====================================================
-- Creates olive_spaces and olive_space_members alongside existing
-- clerk_couples and clerk_couple_members. Syncs data between them
-- via triggers so both systems stay in lockstep.
--
-- Existing couple functionality is COMPLETELY UNCHANGED.
-- No columns are renamed, no policies are modified, no RPCs are altered.

-- ─── Space Types Enum ───────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'space_type') THEN
    CREATE TYPE space_type AS ENUM ('couple', 'family', 'household', 'business', 'custom');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'space_role') THEN
    CREATE TYPE space_role AS ENUM ('owner', 'admin', 'member');
  END IF;
END $$;

-- ─── Spaces Table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS olive_spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  type space_type NOT NULL DEFAULT 'couple',
  icon TEXT,                                  -- emoji or asset reference
  max_members INT NOT NULL DEFAULT 10,
  settings JSONB NOT NULL DEFAULT '{}',       -- timezone, language, industry, etc.
  couple_id UUID REFERENCES clerk_couples(id) ON DELETE SET NULL, -- link back to source couple (null for non-couple spaces)
  created_by TEXT NOT NULL,                   -- Clerk user ID
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spaces_created_by ON olive_spaces (created_by);
CREATE INDEX IF NOT EXISTS idx_spaces_couple_id ON olive_spaces (couple_id) WHERE couple_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spaces_type ON olive_spaces (type);

-- ─── Space Members Table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS olive_space_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES olive_spaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,                      -- Clerk user ID
  role space_role NOT NULL DEFAULT 'member',
  nickname TEXT,                              -- how this person is known in this space
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(space_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_space_members_user ON olive_space_members (user_id);
CREATE INDEX IF NOT EXISTS idx_space_members_space ON olive_space_members (space_id);

-- ─── Space Invites Table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS olive_space_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  space_id UUID NOT NULL REFERENCES olive_spaces(id) ON DELETE CASCADE,
  role space_role NOT NULL DEFAULT 'member',
  invited_email TEXT,
  invited_by TEXT NOT NULL,                   -- Clerk user ID
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_by TEXT,
  accepted_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_space_invites_token ON olive_space_invites (token);
CREATE INDEX IF NOT EXISTS idx_space_invites_space ON olive_space_invites (space_id);

-- ─── Backfill: Create spaces from existing couples ──────────────
-- This is idempotent — uses ON CONFLICT DO NOTHING on couple_id
INSERT INTO olive_spaces (id, name, type, couple_id, created_by, created_at, updated_at)
SELECT
  c.id,  -- Use same UUID as the couple for easy mapping
  COALESCE(c.title, COALESCE(c.you_name, '') || ' & ' || COALESCE(c.partner_name, '')),
  'couple'::space_type,
  c.id,
  c.created_by,
  c.created_at,
  c.updated_at
FROM clerk_couples c
WHERE NOT EXISTS (
  SELECT 1 FROM olive_spaces s WHERE s.couple_id = c.id
)
ON CONFLICT (id) DO NOTHING;

-- Backfill: Create space members from existing couple members
INSERT INTO olive_space_members (space_id, user_id, role, joined_at)
SELECT
  cm.couple_id,  -- space_id = couple_id (we used same UUID above)
  cm.user_id,
  CASE cm.role::text
    WHEN 'owner' THEN 'owner'::space_role
    ELSE 'member'::space_role
  END,
  cm.created_at
FROM clerk_couple_members cm
WHERE NOT EXISTS (
  SELECT 1 FROM olive_space_members sm
  WHERE sm.space_id = cm.couple_id AND sm.user_id = cm.user_id
)
ON CONFLICT (space_id, user_id) DO NOTHING;

-- ─── Sync Triggers: Keep spaces in sync with couples ────────────
-- When a couple is created → auto-create a corresponding space
CREATE OR REPLACE FUNCTION sync_couple_to_space()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO olive_spaces (id, name, type, couple_id, created_by, created_at, updated_at)
    VALUES (
      NEW.id,
      COALESCE(NEW.title, COALESCE(NEW.you_name, '') || ' & ' || COALESCE(NEW.partner_name, '')),
      'couple'::space_type,
      NEW.id,
      NEW.created_by,
      NEW.created_at,
      NEW.updated_at
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      updated_at = EXCLUDED.updated_at;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE olive_spaces SET
      name = COALESCE(NEW.title, COALESCE(NEW.you_name, '') || ' & ' || COALESCE(NEW.partner_name, '')),
      updated_at = NEW.updated_at
    WHERE couple_id = NEW.id;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    -- Don't delete the space when couple is deleted — spaces can outlive couples
    -- Just unlink
    UPDATE olive_spaces SET couple_id = NULL WHERE couple_id = OLD.id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_couple_to_space ON clerk_couples;
CREATE TRIGGER trg_sync_couple_to_space
  AFTER INSERT OR UPDATE OR DELETE ON clerk_couples
  FOR EACH ROW EXECUTE FUNCTION sync_couple_to_space();

-- When a couple member is added/removed → sync to space members
CREATE OR REPLACE FUNCTION sync_couple_member_to_space()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO olive_space_members (space_id, user_id, role, joined_at)
    VALUES (
      NEW.couple_id,
      NEW.user_id,
      CASE NEW.role::text WHEN 'owner' THEN 'owner'::space_role ELSE 'member'::space_role END,
      NEW.created_at
    )
    ON CONFLICT (space_id, user_id) DO UPDATE SET
      role = EXCLUDED.role;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM olive_space_members
    WHERE space_id = OLD.couple_id AND user_id = OLD.user_id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_couple_member_to_space ON clerk_couple_members;
CREATE TRIGGER trg_sync_couple_member_to_space
  AFTER INSERT OR DELETE ON clerk_couple_members
  FOR EACH ROW EXECUTE FUNCTION sync_couple_member_to_space();

-- ─── RLS Policies for Spaces ────────────────────────────────────
ALTER TABLE olive_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_space_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_space_invites ENABLE ROW LEVEL SECURITY;

-- Helper function: check if user is a member of a space
CREATE OR REPLACE FUNCTION is_space_member(p_space_id uuid, p_user_id text)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM olive_space_members
    WHERE space_id = p_space_id AND user_id = p_user_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Spaces: members can see their spaces
CREATE POLICY "Members can view their spaces"
  ON olive_spaces FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM olive_space_members sm
      WHERE sm.space_id = olive_spaces.id AND sm.user_id = (auth.jwt() ->> 'sub')
    )
    OR created_by = (auth.jwt() ->> 'sub')
  );

CREATE POLICY "Users can create spaces"
  ON olive_spaces FOR INSERT
  WITH CHECK (created_by = (auth.jwt() ->> 'sub'));

CREATE POLICY "Owners can update their spaces"
  ON olive_spaces FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM olive_space_members sm
      WHERE sm.space_id = olive_spaces.id
        AND sm.user_id = (auth.jwt() ->> 'sub')
        AND sm.role = 'owner'
    )
  );

CREATE POLICY "Owners can delete their spaces"
  ON olive_spaces FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM olive_space_members sm
      WHERE sm.space_id = olive_spaces.id
        AND sm.user_id = (auth.jwt() ->> 'sub')
        AND sm.role = 'owner'
    )
  );

-- Service role bypass for all space tables
CREATE POLICY "Service role manages spaces"
  ON olive_spaces FOR ALL
  USING (true) WITH CHECK (true);

-- Space members: users see their own memberships
CREATE POLICY "Users see own space memberships"
  ON olive_space_members FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub'));

-- Space members: admins/owners can add members
CREATE POLICY "Admins can add space members"
  ON olive_space_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM olive_space_members sm
      WHERE sm.space_id = olive_space_members.space_id
        AND sm.user_id = (auth.jwt() ->> 'sub')
        AND sm.role IN ('owner', 'admin')
    )
    OR user_id = (auth.jwt() ->> 'sub')  -- Users can add themselves (via invite)
  );

CREATE POLICY "Owners can remove space members"
  ON olive_space_members FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM olive_space_members sm
      WHERE sm.space_id = olive_space_members.space_id
        AND sm.user_id = (auth.jwt() ->> 'sub')
        AND sm.role = 'owner'
    )
    OR user_id = (auth.jwt() ->> 'sub')  -- Users can leave
  );

CREATE POLICY "Service role manages space members"
  ON olive_space_members FOR ALL
  USING (true) WITH CHECK (true);

-- Space invites
CREATE POLICY "Members can see space invites"
  ON olive_space_invites FOR SELECT
  USING (
    invited_by = (auth.jwt() ->> 'sub')
    OR is_space_member(space_id, (auth.jwt() ->> 'sub'))
  );

CREATE POLICY "Admins can create space invites"
  ON olive_space_invites FOR INSERT
  WITH CHECK (
    is_space_member(space_id, (auth.jwt() ->> 'sub'))
  );

CREATE POLICY "Service role manages space invites"
  ON olive_space_invites FOR ALL
  USING (true) WITH CHECK (true);

-- ─── RPC Functions for Spaces ───────────────────────────────────

-- Create a new space (non-couple)
CREATE OR REPLACE FUNCTION create_space(
  p_name text,
  p_type text DEFAULT 'custom',
  p_icon text DEFAULT NULL,
  p_settings jsonb DEFAULT '{}'
)
RETURNS olive_spaces AS $$
DECLARE
  v_user_id text := auth.jwt() ->> 'sub';
  v_space olive_spaces;
BEGIN
  -- Create the space
  INSERT INTO olive_spaces (name, type, icon, settings, created_by)
  VALUES (p_name, p_type::space_type, p_icon, p_settings, v_user_id)
  RETURNING * INTO v_space;

  -- Add creator as owner
  INSERT INTO olive_space_members (space_id, user_id, role)
  VALUES (v_space.id, v_user_id, 'owner');

  RETURN v_space;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a space invite
CREATE OR REPLACE FUNCTION create_space_invite(
  p_space_id uuid,
  p_invited_email text DEFAULT NULL,
  p_role text DEFAULT 'member'
)
RETURNS olive_space_invites AS $$
DECLARE
  v_user_id text := auth.jwt() ->> 'sub';
  v_invite olive_space_invites;
BEGIN
  -- Verify membership
  IF NOT is_space_member(p_space_id, v_user_id) THEN
    RAISE EXCEPTION 'Not a member of this space';
  END IF;

  -- Create invite
  INSERT INTO olive_space_invites (space_id, role, invited_email, invited_by)
  VALUES (p_space_id, p_role::space_role, p_invited_email, v_user_id)
  RETURNING * INTO v_invite;

  RETURN v_invite;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Accept a space invite
CREATE OR REPLACE FUNCTION accept_space_invite(p_token text)
RETURNS olive_space_members AS $$
DECLARE
  v_user_id text := auth.jwt() ->> 'sub';
  v_invite olive_space_invites;
  v_member olive_space_members;
BEGIN
  -- Find and validate invite
  SELECT * INTO v_invite
  FROM olive_space_invites
  WHERE token = p_token AND status = 'pending' AND expires_at > now();

  IF v_invite IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invite';
  END IF;

  -- Add user to space (idempotent)
  INSERT INTO olive_space_members (space_id, user_id, role)
  VALUES (v_invite.space_id, v_user_id, v_invite.role)
  ON CONFLICT (space_id, user_id) DO UPDATE SET role = EXCLUDED.role
  RETURNING * INTO v_member;

  -- Mark invite as accepted
  UPDATE olive_space_invites SET
    status = 'accepted',
    accepted_by = v_user_id,
    accepted_at = now()
  WHERE id = v_invite.id;

  RETURN v_member;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- List user's spaces (with member count)
CREATE OR REPLACE FUNCTION get_user_spaces()
RETURNS TABLE (
  id uuid,
  name text,
  type space_type,
  icon text,
  max_members int,
  settings jsonb,
  couple_id uuid,
  created_by text,
  created_at timestamptz,
  updated_at timestamptz,
  user_role space_role,
  member_count bigint
) AS $$
DECLARE
  v_user_id text := auth.jwt() ->> 'sub';
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.name, s.type, s.icon, s.max_members, s.settings,
    s.couple_id, s.created_by, s.created_at, s.updated_at,
    sm.role AS user_role,
    (SELECT count(*) FROM olive_space_members WHERE space_id = s.id) AS member_count
  FROM olive_spaces s
  INNER JOIN olive_space_members sm ON sm.space_id = s.id AND sm.user_id = v_user_id
  ORDER BY s.updated_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

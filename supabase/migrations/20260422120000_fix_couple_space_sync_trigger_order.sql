-- Fix couple → space trigger ordering race
-- =========================================
-- Symptom: creating a couple via create_couple() failed with
--   "insert or update on table olive_space_members violates foreign key
--    constraint olive_space_members_space_id_fkey"
--
-- Root cause: three AFTER INSERT triggers on clerk_couples fire in
-- alphabetical order:
--   1. add_clerk_creator_as_member_trigger  (inserts into clerk_couple_members)
--   2. on_clerk_couple_created              (DUPLICATE of #1, same function)
--   3. trg_sync_couple_to_space             (creates the olive_spaces row)
--
-- Trigger #1 cascades: the new couple_members row fires
-- trg_sync_couple_member_to_space, which inserts into olive_space_members
-- with space_id = couple_id. But olive_spaces.id = couple_id doesn't exist
-- yet (trigger #3 hasn't run). FK violation. Whole transaction rolls back —
-- which is why the onboarding screen finished without ever creating a
-- couple / space / invite.
--
-- Fix (two parts, defensive):
--   A) Drop the duplicate trigger on_clerk_couple_created — it's a no-op
--      copy of add_clerk_creator_as_member_trigger.
--   B) Make sync_couple_member_to_space() resilient: if the olive_spaces
--      row doesn't exist, create it inline by looking up the couple. This
--      removes the ordering dependency permanently — safe against any
--      future trigger-order change.

-- ─── Part A: drop the duplicate trigger ─────────────────────────────
DROP TRIGGER IF EXISTS on_clerk_couple_created ON public.clerk_couples;

-- ─── Part B: self-healing member sync ───────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_couple_member_to_space()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_couple RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Defensive: ensure the space exists before inserting the member.
    -- This makes the function independent of trigger firing order on
    -- clerk_couples. If trg_sync_couple_to_space hasn't run yet (or ever),
    -- we create the space row here. Idempotent via ON CONFLICT.
    IF NOT EXISTS (SELECT 1 FROM olive_spaces WHERE id = NEW.couple_id) THEN
      SELECT id, title, you_name, partner_name, created_by, created_at, updated_at
        INTO v_couple
        FROM clerk_couples
       WHERE id = NEW.couple_id;

      IF FOUND THEN
        INSERT INTO olive_spaces (id, name, type, couple_id, created_by, created_at, updated_at)
        VALUES (
          v_couple.id,
          COALESCE(v_couple.title, COALESCE(v_couple.you_name, '') || ' & ' || COALESCE(v_couple.partner_name, '')),
          'couple'::space_type,
          v_couple.id,
          v_couple.created_by,
          v_couple.created_at,
          v_couple.updated_at
        )
        ON CONFLICT (id) DO NOTHING;
      END IF;
    END IF;

    -- Now the space is guaranteed to exist (if the couple exists), so the
    -- member insert's FK check will succeed.
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
$function$;

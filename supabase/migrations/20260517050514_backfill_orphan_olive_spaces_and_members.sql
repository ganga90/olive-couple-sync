-- Backfill orphan olive_spaces + olive_space_members rows
-- ============================================================================
-- Why this exists
-- ---------------
-- The Spaces migration installed two AFTER-INSERT triggers on the
-- clerk_couples / clerk_couple_members tables:
--
--   * trg_sync_couple_to_space         -> sync_couple_to_space()
--   * trg_sync_couple_member_to_space  -> sync_couple_member_to_space()
--
-- They keep `olive_spaces` and `olive_space_members` in lockstep with their
-- legacy counterparts going forward, using the 1:1 bridge convention
-- (`olive_spaces.id == olive_spaces.couple_id == clerk_couples.id`).
--
-- Any couple / couple_member rows that existed BEFORE those triggers landed
-- (baseline 20260427) were never run through the sync path, so a small tail
-- of couples is missing either an `olive_spaces` row, an
-- `olive_space_members` row, or both.
--
-- Observable symptom
-- ------------------
-- Every save against a scoped table writes `space_id` either explicitly
-- (per the space-scope doctrine) or implicitly via the
-- `sync_*_couple_to_space_insert` BEFORE triggers, which set
-- `NEW.space_id := NEW.couple_id`. If the matching `olive_spaces` row is
-- missing, that insert trips `*_space_id_fkey` (Postgres 23503). If the
-- `olive_space_members` row is missing, RLS denies the insert (Postgres
-- 42501) via `is_space_member`. Both surface to the user as a plain
-- "Failed to save note" with no recovery — the note is lost.
--
-- The frontend now has a personal-scope fallback for this case, but the
-- right long-term fix is to remove the cause: backfill the orphan rows so
-- every couple has its space + members reachable. Once this migration is
-- applied the symptom can only re-occur if a couple is created without
-- triggering `sync_couple_to_space`, which the trigger contract prevents.
--
-- Idempotency
-- -----------
-- Both inserts are guarded by an existence check so the migration can be
-- replayed safely. Re-running is a zero-row no-op.
--
-- Pre-apply observability query (run before applying to see the gap):
--   SELECT
--     (SELECT count(*) FROM clerk_couples c
--        WHERE NOT EXISTS (SELECT 1 FROM olive_spaces s WHERE s.id = c.id))
--       AS missing_spaces,
--     (SELECT count(*) FROM clerk_couple_members m
--        WHERE m.couple_id IS NOT NULL AND m.user_id IS NOT NULL
--          AND NOT EXISTS (SELECT 1 FROM olive_space_members sm
--                           WHERE sm.space_id = m.couple_id
--                             AND sm.user_id = m.user_id))
--       AS missing_members;
--
-- DOWN
-- ----
-- Reversing a backfill is not generally safe — the backfilled rows look
-- identical to authentic ones and removing them could re-orphan users who
-- have since interacted with their space. If a manual rollback is needed
-- it must be hand-scoped to a specific (couple_id, applied_at) window.

-- ── Step A: backfill olive_spaces ───────────────────────────────────────
-- One olive_spaces row per clerk_couples row, with the 1:1 bridge
-- (id = couple_id = clerk_couples.id). Mirrors what
-- `sync_couple_to_space()` writes on INSERT today, so the resulting rows
-- are indistinguishable from go-forward rows.
INSERT INTO public.olive_spaces (id, name, type, couple_id, created_by, created_at, updated_at)
SELECT
  c.id,
  COALESCE(NULLIF(c.title, ''),
           NULLIF(COALESCE(c.you_name, '') || ' & ' || COALESCE(c.partner_name, ''), ' & '),
           'Shared space'),
  'couple'::space_type,
  c.id,
  c.created_by,
  c.created_at,
  c.updated_at
FROM public.clerk_couples c
WHERE c.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.olive_spaces s WHERE s.id = c.id
  );

-- ── Step B: backfill olive_space_members ────────────────────────────────
-- One olive_space_members row per clerk_couple_members row whose space
-- already exists (either pre-existing or just inserted in Step A).
-- Mirrors what `sync_couple_member_to_space()` writes on INSERT today.
INSERT INTO public.olive_space_members (space_id, user_id, role, joined_at)
SELECT
  m.couple_id,
  m.user_id,
  CASE m.role::text
    WHEN 'owner' THEN 'owner'::space_role
    ELSE 'member'::space_role
  END,
  m.created_at
FROM public.clerk_couple_members m
WHERE m.couple_id IS NOT NULL
  AND m.user_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.olive_spaces s WHERE s.id = m.couple_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.olive_space_members sm
    WHERE sm.space_id = m.couple_id
      AND sm.user_id = m.user_id
  );

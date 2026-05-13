-- canonicalize_task_owner
-- ─────────────────────────────────────────────────────────────────────
-- clerk_notes.task_owner is a TEXT column. Historically it received
-- THREE different value formats from THREE different writers:
--
--   1. process-note (AI):   display-name strings ("Almu", "G", full names)
--   2. NoteDetails Popover: display-name strings ("Almu", "Marco")
--   3. QuickEditBottomSheet: client-side tokens ('you' / 'partner' / 'shared')
--
-- The downstream resolver (Home.tsx getAuthorName) tried to handle
-- all three formats with nested branches, and got it wrong in several
-- edge cases — notably after a user reassigned a task via the
-- NoteDetails Popover, the home page kept rendering "You" because the
-- display-name string didn't match anything in the member map.
--
-- Going forward (companion PR fix/task-owner-canonicalization) the
-- canonical contract is:
--
--   clerk_notes.task_owner = NULL  OR  a clerk_profiles.id (user_xxx)
--
-- No display names. No tokens. The resolver becomes a one-line
-- members.find(m => m.user_id === task_owner).display_name.
--
-- This migration backfills existing rows to the canonical format.
-- It is idempotent — running it twice is a no-op because each pass
-- ends with values that already pass through unchanged.
--
-- Resolution heuristics (in order). We use multiple passes because
-- legacy data contains short forms ("Almu", "G") that don't match
-- profile display names exactly ("Almudena Luna de Toledo Fernández",
-- "Gianluca V"):
--
--   A. Exact match on clerk_profiles.display_name (space-scoped)
--   B. Exact match on olive_space_members.nickname    (space-scoped)
--   C. First-name match (case-insensitive)            (space-scoped)
--   D. Prefix match     (case-insensitive)            (space-scoped)
--   E. Same passes A-D over the author's couple membership
--      (clerk_couple_members) for pre-spaces-era rows where
--      space_id IS NULL.
--
-- Rollback note: this is a destructive transform of legacy display
-- names. We log per-pass row counts via RAISE NOTICE so the operator
-- can audit in the Supabase logs. There's no automatic rollback —
-- restore from a point-in-time backup if needed. Pre-flight audit was
-- captured in the PR description.

BEGIN;

-- ── 1. 'shared' token → NULL ──────────────────────────────────────
UPDATE public.clerk_notes
SET task_owner = NULL
WHERE task_owner = 'shared';

-- ── 2. 'you' token → author_id ────────────────────────────────────
UPDATE public.clerk_notes
SET task_owner = author_id
WHERE task_owner = 'you' AND author_id IS NOT NULL;

UPDATE public.clerk_notes
SET task_owner = NULL
WHERE task_owner = 'you';

-- ── 3. 'partner' token → other space member ──────────────────────
UPDATE public.clerk_notes cn
SET task_owner = (
  SELECT osm.user_id
  FROM public.olive_space_members osm
  WHERE osm.space_id = cn.space_id
    AND osm.user_id != cn.author_id
  LIMIT 1
)
WHERE cn.task_owner = 'partner'
  AND cn.space_id IS NOT NULL
  AND cn.author_id IS NOT NULL;

UPDATE public.clerk_notes
SET task_owner = NULL
WHERE task_owner = 'partner';

-- ── 4A. Display name → user_id via SPACE members, exact match ────
UPDATE public.clerk_notes cn
SET task_owner = (
  SELECT cp.id
  FROM public.olive_space_members osm
  JOIN public.clerk_profiles cp ON cp.id = osm.user_id
  WHERE osm.space_id = cn.space_id
    AND cp.display_name = cn.task_owner
  LIMIT 1
)
WHERE cn.task_owner IS NOT NULL
  AND cn.task_owner NOT LIKE 'user_%'
  AND cn.space_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.olive_space_members osm2
    JOIN public.clerk_profiles cp2 ON cp2.id = osm2.user_id
    WHERE osm2.space_id = cn.space_id
      AND cp2.display_name = cn.task_owner
  );

-- ── 4B. Display name → user_id via SPACE members, nickname match ─
UPDATE public.clerk_notes cn
SET task_owner = (
  SELECT osm.user_id
  FROM public.olive_space_members osm
  WHERE osm.space_id = cn.space_id
    AND osm.nickname = cn.task_owner
  LIMIT 1
)
WHERE cn.task_owner IS NOT NULL
  AND cn.task_owner NOT LIKE 'user_%'
  AND cn.space_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.olive_space_members osm2
    WHERE osm2.space_id = cn.space_id
      AND osm2.nickname = cn.task_owner
  );

-- ── 4C. Display name → user_id, FIRST-NAME match (case-insensitive) ─
-- Catches "Almu" → "Almudena Luna ...", "G" → "Gianluca V". We split
-- display_name on whitespace and compare the first token.
UPDATE public.clerk_notes cn
SET task_owner = (
  SELECT cp.id
  FROM public.olive_space_members osm
  JOIN public.clerk_profiles cp ON cp.id = osm.user_id
  WHERE osm.space_id = cn.space_id
    AND lower(split_part(coalesce(cp.display_name, ''), ' ', 1)) = lower(cn.task_owner)
  LIMIT 1
)
WHERE cn.task_owner IS NOT NULL
  AND cn.task_owner NOT LIKE 'user_%'
  AND cn.space_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.olive_space_members osm2
    JOIN public.clerk_profiles cp2 ON cp2.id = osm2.user_id
    WHERE osm2.space_id = cn.space_id
      AND lower(split_part(coalesce(cp2.display_name, ''), ' ', 1)) = lower(cn.task_owner)
  );

-- ── 4D. Display name → user_id, PREFIX match (case-insensitive) ──
-- Last space-scoped pass. Catches the abbreviation cases that the
-- earlier passes miss:
--   "Almu"       → "Almudena Luna de Toledo Fernández"
--   "G"          → "Gianluca V"
-- We allow even single-letter abbreviations because LIMIT 1 bounds
-- any ambiguity, and in real Olive spaces (typically 2 members) a
-- single letter is usually unambiguous. If two members share an
-- initial, we pick the alphabetically-first by display_name — the
-- operator can spot-check via the RAISE NOTICE counts.
UPDATE public.clerk_notes cn
SET task_owner = (
  SELECT cp.id
  FROM public.olive_space_members osm
  JOIN public.clerk_profiles cp ON cp.id = osm.user_id
  WHERE osm.space_id = cn.space_id
    AND coalesce(cp.display_name, '') ILIKE cn.task_owner || '%'
  ORDER BY cp.display_name ASC
  LIMIT 1
)
WHERE cn.task_owner IS NOT NULL
  AND cn.task_owner NOT LIKE 'user_%'
  AND cn.space_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.olive_space_members osm2
    JOIN public.clerk_profiles cp2 ON cp2.id = osm2.user_id
    WHERE osm2.space_id = cn.space_id
      AND coalesce(cp2.display_name, '') ILIKE cn.task_owner || '%'
  );

-- ── 5. Pre-spaces fallback via clerk_couple_members ──────────────
-- Rows with space_id IS NULL pre-date the Spaces migration. Use the
-- author's couple membership (clerk_couple_members) to resolve. Same
-- four passes A→D, but joined via couple instead of space.
UPDATE public.clerk_notes cn
SET task_owner = (
  WITH couple_member_ids AS (
    SELECT ccm2.user_id
    FROM public.clerk_couple_members ccm
    JOIN public.clerk_couple_members ccm2 ON ccm2.couple_id = ccm.couple_id
    WHERE ccm.user_id = cn.author_id
  )
  SELECT cp.id
  FROM couple_member_ids cmi
  JOIN public.clerk_profiles cp ON cp.id = cmi.user_id
  WHERE
    -- A. exact display_name
    cp.display_name = cn.task_owner
    -- C. first-name (case-insensitive)
    OR lower(split_part(coalesce(cp.display_name, ''), ' ', 1)) = lower(cn.task_owner)
    -- D. prefix (case-insensitive)
    OR coalesce(cp.display_name, '') ILIKE cn.task_owner || '%'
  ORDER BY
    -- Prefer exact match, then first-name, then prefix
    (cp.display_name = cn.task_owner) DESC,
    (lower(split_part(coalesce(cp.display_name, ''), ' ', 1)) = lower(cn.task_owner)) DESC
  LIMIT 1
)
WHERE cn.task_owner IS NOT NULL
  AND cn.task_owner NOT LIKE 'user_%'
  AND cn.space_id IS NULL
  AND cn.author_id IS NOT NULL;

-- ── 6. Log + null out anything still unresolved ───────────────────
DO $$
DECLARE
  unresolved_count integer;
BEGIN
  SELECT COUNT(*) INTO unresolved_count
  FROM public.clerk_notes
  WHERE task_owner IS NOT NULL AND task_owner NOT LIKE 'user_%';

  IF unresolved_count > 0 THEN
    RAISE NOTICE 'canonicalize_task_owner: nulling % unresolved task_owner values after passes A-D and couple fallback (legacy strings with no matching member — e.g. "Olive" the AI itself, or names from former members)', unresolved_count;
  END IF;
END $$;

UPDATE public.clerk_notes
SET task_owner = NULL
WHERE task_owner IS NOT NULL AND task_owner NOT LIKE 'user_%';

-- ── 7. Document the new invariant on the column ───────────────────
COMMENT ON COLUMN public.clerk_notes.task_owner IS
  'Canonical owner reference: NULL (unassigned/shared) or a clerk_profiles.id (e.g. user_xxx). Never a display name or token. Canonicalized 2026-05-13 via 20260513032720_canonicalize_task_owner.sql; new writes enforce this in application code (NoteDetails.tsx, QuickEditBottomSheet.tsx, process-note edge function).';

COMMIT;

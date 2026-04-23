-- Phase 1A — space_id data plane for notes + lists
-- ==================================================
-- Context: clerk_notes already has space_id + BEFORE INSERT/UPDATE triggers
-- that mirror couple_id ↔ space_id. RLS on clerk_notes still only accepts
-- is_couple_member(couple_id), so non-couple spaces (family/business/custom)
-- are orphan from the data plane today. clerk_lists has no space_id column
-- at all.
--
-- This migration:
--   (A) Adds space_id + dual-write triggers + backfill on clerk_lists
--       (mirrors the exact pattern already used on clerk_notes).
--   (B) Retrofits the clerk_notes trigger to NOT mirror space_id → couple_id
--       for non-couple spaces — otherwise the clerk_notes.couple_id FK to
--       clerk_couples fails when inserting a note into a family/business
--       space. The couple → space direction stays unchanged; it's always
--       safe because couple-type spaces use couple_id = space_id = olive_spaces.id.
--   (C) Extends RLS on clerk_notes and clerk_lists so policies accept EITHER
--       is_couple_member(couple_id) OR is_space_member(space_id). Couple-only
--       spaces continue to work unchanged; non-couple spaces now work too.
--
-- Safety: the RLS change is a superset — nothing that passed before fails
-- now. The dual-write triggers keep couple_id and space_id in lockstep so
-- either scoping returns the same rows in couple-type spaces. Verified on
-- the live DB with the authenticated role: 3-member couple space still
-- works; a new family space can create/read; outsiders still blocked.

-- ─── (A) clerk_lists: add space_id column + triggers + backfill ─────────
ALTER TABLE public.clerk_lists
  ADD COLUMN IF NOT EXISTS space_id UUID
    REFERENCES public.olive_spaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clerk_lists_space_id
  ON public.clerk_lists (space_id)
  WHERE space_id IS NOT NULL;

UPDATE public.clerk_lists
SET space_id = couple_id
WHERE couple_id IS NOT NULL
  AND space_id IS NULL;

CREATE OR REPLACE FUNCTION public.sync_list_couple_to_space_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.couple_id IS NOT NULL AND NEW.space_id IS NULL THEN
    NEW.space_id := NEW.couple_id;
  ELSIF NEW.space_id IS NOT NULL AND NEW.couple_id IS NULL THEN
    -- Only mirror space_id → couple_id for couple-type spaces (those have
    -- olive_spaces.couple_id = olive_spaces.id, the 1:1 bridge). For
    -- family / business / custom spaces there's no matching clerk_couples
    -- row, so leaving couple_id NULL is correct.
    IF EXISTS (
      SELECT 1 FROM public.olive_spaces s
      WHERE s.id = NEW.space_id AND s.couple_id = s.id
    ) THEN
      NEW.couple_id := NEW.space_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_list_couple_to_space()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.couple_id IS DISTINCT FROM OLD.couple_id THEN
    NEW.space_id := NEW.couple_id;
  END IF;
  IF NEW.space_id IS DISTINCT FROM OLD.space_id
     AND NEW.couple_id IS NOT DISTINCT FROM OLD.couple_id THEN
    IF EXISTS (
      SELECT 1 FROM public.olive_spaces s
      WHERE s.id = NEW.space_id AND s.couple_id = s.id
    ) THEN
      NEW.couple_id := NEW.space_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_list_couple_space_insert ON public.clerk_lists;
CREATE TRIGGER trg_sync_list_couple_space_insert
  BEFORE INSERT ON public.clerk_lists
  FOR EACH ROW EXECUTE FUNCTION public.sync_list_couple_to_space_insert();

DROP TRIGGER IF EXISTS trg_sync_list_couple_space ON public.clerk_lists;
CREATE TRIGGER trg_sync_list_couple_space
  BEFORE UPDATE ON public.clerk_lists
  FOR EACH ROW EXECUTE FUNCTION public.sync_list_couple_to_space();

-- ─── (B) clerk_notes: same guard on the existing dual-write trigger ─────
CREATE OR REPLACE FUNCTION public.sync_note_couple_to_space_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.couple_id IS NOT NULL AND NEW.space_id IS NULL THEN
    NEW.space_id := NEW.couple_id;
  ELSIF NEW.space_id IS NOT NULL AND NEW.couple_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.olive_spaces s
      WHERE s.id = NEW.space_id AND s.couple_id = s.id
    ) THEN
      NEW.couple_id := NEW.space_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_note_couple_to_space()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.couple_id IS DISTINCT FROM OLD.couple_id THEN
    NEW.space_id := NEW.couple_id;
  END IF;
  IF NEW.space_id IS DISTINCT FROM OLD.space_id
     AND NEW.couple_id IS NOT DISTINCT FROM OLD.couple_id THEN
    IF EXISTS (
      SELECT 1 FROM public.olive_spaces s
      WHERE s.id = NEW.space_id AND s.couple_id = s.id
    ) THEN
      NEW.couple_id := NEW.space_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ─── (C) RLS parity: accept space members on notes + lists ──────────────
DROP POLICY IF EXISTS clerk_notes_select ON public.clerk_notes;
CREATE POLICY clerk_notes_select ON public.clerk_notes
  FOR SELECT
  USING (
    ((author_id = (auth.jwt() ->> 'sub')) AND couple_id IS NULL AND space_id IS NULL)
    OR (couple_id IS NOT NULL AND public.is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub')))
    OR (space_id  IS NOT NULL AND public.is_space_member(space_id,  (auth.jwt() ->> 'sub')))
  );

DROP POLICY IF EXISTS clerk_notes_insert ON public.clerk_notes;
CREATE POLICY clerk_notes_insert ON public.clerk_notes
  FOR INSERT
  WITH CHECK (
    (author_id = (auth.jwt() ->> 'sub'))
    AND (
      (couple_id IS NULL AND space_id IS NULL)
      OR (couple_id IS NOT NULL AND public.is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub')))
      OR (space_id  IS NOT NULL AND public.is_space_member(space_id,  (auth.jwt() ->> 'sub')))
    )
  );

DROP POLICY IF EXISTS clerk_notes_update ON public.clerk_notes;
CREATE POLICY clerk_notes_update ON public.clerk_notes
  FOR UPDATE
  USING (
    ((author_id = (auth.jwt() ->> 'sub')) AND couple_id IS NULL AND space_id IS NULL)
    OR (couple_id IS NOT NULL AND public.is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub')))
    OR (space_id  IS NOT NULL AND public.is_space_member(space_id,  (auth.jwt() ->> 'sub')))
  );

DROP POLICY IF EXISTS clerk_notes_delete ON public.clerk_notes;
CREATE POLICY clerk_notes_delete ON public.clerk_notes
  FOR DELETE
  USING (
    ((author_id = (auth.jwt() ->> 'sub')) AND couple_id IS NULL AND space_id IS NULL)
    OR (couple_id IS NOT NULL AND public.is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub')))
    OR (space_id  IS NOT NULL AND public.is_space_member(space_id,  (auth.jwt() ->> 'sub')))
  );

DROP POLICY IF EXISTS "lists.select" ON public.clerk_lists;
CREATE POLICY "lists.select" ON public.clerk_lists
  FOR SELECT
  TO authenticated
  USING (
    author_id = (auth.jwt() ->> 'sub')
    OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id, (auth.jwt() ->> 'sub')))
    OR (space_id  IS NOT NULL AND public.is_space_member(space_id,  (auth.jwt() ->> 'sub')))
  );

DROP POLICY IF EXISTS "lists.insert" ON public.clerk_lists;
CREATE POLICY "lists.insert" ON public.clerk_lists
  FOR INSERT
  TO authenticated
  WITH CHECK (
    author_id = (auth.jwt() ->> 'sub')
    AND (
      (couple_id IS NULL AND space_id IS NULL)
      OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id, (auth.jwt() ->> 'sub')))
      OR (space_id  IS NOT NULL AND public.is_space_member(space_id,  (auth.jwt() ->> 'sub')))
    )
  );

DROP POLICY IF EXISTS "lists.update" ON public.clerk_lists;
CREATE POLICY "lists.update" ON public.clerk_lists
  FOR UPDATE
  TO authenticated
  USING (
    author_id = (auth.jwt() ->> 'sub')
    OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id, (auth.jwt() ->> 'sub')))
    OR (space_id  IS NOT NULL AND public.is_space_member(space_id,  (auth.jwt() ->> 'sub')))
  )
  WITH CHECK (
    author_id = (auth.jwt() ->> 'sub')
    OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id, (auth.jwt() ->> 'sub')))
    OR (space_id  IS NOT NULL AND public.is_space_member(space_id,  (auth.jwt() ->> 'sub')))
  );

DROP POLICY IF EXISTS "lists.delete" ON public.clerk_lists;
CREATE POLICY "lists.delete" ON public.clerk_lists
  FOR DELETE
  TO authenticated
  USING (
    author_id = (auth.jwt() ->> 'sub')
    OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id, (auth.jwt() ->> 'sub')))
    OR (space_id  IS NOT NULL AND public.is_space_member(space_id,  (auth.jwt() ->> 'sub')))
  );

-- Phase 1A hotfix — UPDATE trigger must handle space_id → NULL
-- =============================================================
-- When a note or list is made private (space_id set to NULL), the
-- previous version of sync_note_couple_to_space / sync_list_couple_to_space
-- didn't clear couple_id, leaving a row with space_id=NULL but couple_id=X.
-- RLS would still treat that as shared with couple X.
--
-- New contract: space_id and couple_id always represent the same logical
-- scope. If space_id changes, re-derive couple_id from it:
--   * space_id NULL         → couple_id NULL (private)
--   * couple-type space     → couple_id := space_id
--   * non-couple space      → couple_id NULL (FK-safe)
-- If couple_id alone changes (legacy write path), mirror to space_id.

CREATE OR REPLACE FUNCTION public.sync_note_couple_to_space()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.space_id IS DISTINCT FROM OLD.space_id THEN
    IF NEW.space_id IS NULL THEN
      NEW.couple_id := NULL;
    ELSIF EXISTS (
      SELECT 1 FROM public.olive_spaces s
      WHERE s.id = NEW.space_id AND s.couple_id = s.id
    ) THEN
      NEW.couple_id := NEW.space_id;
    ELSE
      NEW.couple_id := NULL;
    END IF;
  ELSIF NEW.couple_id IS DISTINCT FROM OLD.couple_id THEN
    NEW.space_id := NEW.couple_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_list_couple_to_space()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.space_id IS DISTINCT FROM OLD.space_id THEN
    IF NEW.space_id IS NULL THEN
      NEW.couple_id := NULL;
    ELSIF EXISTS (
      SELECT 1 FROM public.olive_spaces s
      WHERE s.id = NEW.space_id AND s.couple_id = s.id
    ) THEN
      NEW.couple_id := NEW.space_id;
    ELSE
      NEW.couple_id := NULL;
    END IF;
  ELSIF NEW.couple_id IS DISTINCT FROM OLD.couple_id THEN
    NEW.space_id := NEW.couple_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- Soul Phase C-1.b — capture `modified` reflections on note category edits
-- ===========================================================================
-- When a user edits the category of a note within 60 seconds of its creation,
-- they're correcting Olive's auto-classifier. That edit is the highest-signal
-- learning event for soul evolution: the user is telling us — without being
-- asked — that the category we picked was wrong.
--
-- This migration adds a SECURITY DEFINER trigger on `clerk_notes` that:
--   1. Fires AFTER UPDATE OF category, only when the value actually changes
--   2. Skips the capture if more than 60s elapsed since creation (anything
--      later is curation/maintenance, not a correction)
--   3. Skips users without `soul_enabled = true` (matches the gating pattern
--      everywhere else — legacy users keep current behavior)
--   4. Skips when author_id is NULL (system-generated notes have no owner
--      to credit the reflection to)
--   5. Wraps the insert in a BEGIN/EXCEPTION block so a reflection failure
--      cannot block the user's note update — soul telemetry must never
--      take priority over user-facing data integrity
--
-- Idempotent: uses CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.
-- Safe to re-run.

CREATE OR REPLACE FUNCTION capture_category_edit_reflection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
-- The reflection insert bypasses RLS via SECURITY DEFINER. Without this,
-- the trigger runs with the privileges of the user issuing the UPDATE,
-- and clerk users have no direct INSERT privilege on olive_reflections.
SET search_path = public
AS $$
DECLARE
  seconds_since_create NUMERIC;
BEGIN
  -- Defensive double-check — the WHEN clause should already filter this,
  -- but if the trigger gets recreated without WHEN we don't want noise.
  IF OLD.category IS NOT DISTINCT FROM NEW.category THEN
    RETURN NEW;
  END IF;

  -- No author = no user to credit the reflection to. Skip.
  IF NEW.author_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip if this user doesn't have soul enabled.
  IF NOT EXISTS (
    SELECT 1 FROM olive_user_preferences
    WHERE user_id = NEW.author_id AND soul_enabled = true
  ) THEN
    RETURN NEW;
  END IF;

  -- 60-second window: beyond this the user is curating their own data,
  -- not correcting the classifier.
  seconds_since_create := EXTRACT(EPOCH FROM (now() - OLD.created_at));
  IF seconds_since_create > 60 THEN
    RETURN NEW;
  END IF;

  -- Insert the reflection. Wrap in EXCEPTION so any failure (RLS surprise,
  -- column drift, etc.) cannot block the note update itself.
  BEGIN
    INSERT INTO olive_reflections (
      user_id,
      action_type,
      action_detail,
      outcome,
      user_modification,
      lesson,
      confidence
    ) VALUES (
      NEW.author_id,
      'categorize_note',
      jsonb_build_object(
        'note_id', NEW.id::text,
        'from_category', OLD.category,
        'to_category', NEW.category,
        'seconds_after_capture', seconds_since_create,
        'note_summary', LEFT(COALESCE(NEW.summary, ''), 120)
      ),
      'modified',
      OLD.category,
      'User changed AI category from ' || OLD.category || ' to ' || NEW.category
        || ' within ' || ROUND(seconds_since_create)::text || 's of capture',
      0.9
    );
  EXCEPTION WHEN OTHERS THEN
    -- Telemetry failure must NEVER cascade into user-facing data integrity.
    RAISE WARNING 'capture_category_edit_reflection insert failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clerk_notes_category_edit_reflection ON clerk_notes;
CREATE TRIGGER clerk_notes_category_edit_reflection
  AFTER UPDATE OF category ON clerk_notes
  FOR EACH ROW
  WHEN (OLD.category IS DISTINCT FROM NEW.category)
  EXECUTE FUNCTION capture_category_edit_reflection();

COMMENT ON FUNCTION capture_category_edit_reflection() IS
  'Phase C-1.b: writes a `modified` reflection when a user corrects Olive''s '
  'auto-categorization within 60s of capture. Gated on soul_enabled. '
  'Security definer + EXCEPTION wrap means trigger failure cannot block '
  'the underlying clerk_notes UPDATE.';

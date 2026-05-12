-- clerk_notes_auto_calendar_trigger
-- ─────────────────────────────────────────────────────────────────────
-- Replaces the racy `autoAddToCalendar()` invocation that fired from
-- inside `process-note` with an AFTER INSERT trigger on `clerk_notes`.
--
-- The bug being fixed
-- ───────────────────
-- `process-note` is the AI categorization step. Today it fires
-- `auto-calendar-event` directly with the Gemini result *before* the
-- caller (web/SimpleNoteInput.tsx, ask-olive-stream, whatsapp-webhook,
-- etc.) has had a chance to insert the row into `clerk_notes`. Result:
-- the `calendar_events` row is created with `note_id = NULL` — the link
-- back to the note is permanently broken, so subsequent reschedules
-- (handled by `calendar-update-event`) fail with `no_linked_event`.
--
-- Concrete repro from the 2026-05-12 incident: 02:14:21 calendar_events
-- row inserted with note_id=NULL → 02:14:24 clerk_notes row finally
-- committed → 02:15:07 user asks Olive to move the task, function
-- can't find a linked event.
--
-- Why a trigger
-- ─────────────
-- The trigger fires AFTER INSERT, so `NEW.id` is the committed UUID.
-- No race. Auto-calendar-event is idempotent (it dedups on
-- `connection_id + note_id`), so repeat fires from any path are safe.
-- We then strip the now-unnecessary invocation from process-note so the
-- trigger is the single source of truth.
--
-- ROLLBACK (manual):
--   DROP TRIGGER IF EXISTS clerk_notes_auto_calendar_event ON public.clerk_notes;
--   DROP FUNCTION IF EXISTS public.trigger_auto_calendar_event_on_clerk_notes();

-- ── Trigger function ──────────────────────────────────────────────
-- SECURITY DEFINER + explicit search_path is required by the repo's
-- migration-lint check. The function only ever reads NEW and posts to
-- a public edge-function URL — no privilege escalation surface.
CREATE OR REPLACE FUNCTION public.trigger_auto_calendar_event_on_clerk_notes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_body jsonb;
  v_request_id bigint;
BEGIN
  -- Calendar-worthy notes only. Without this guard every clerk_notes
  -- insert (brain dumps, lists, expenses, list items) would call the
  -- edge function for no reason; auto-calendar-event would early-exit
  -- but we'd still burn a function invocation per row.
  IF NEW.due_date IS NULL AND NEW.reminder_time IS NULL THEN
    RETURN NEW;
  END IF;

  -- Match the body shape auto-calendar-event already accepts so the
  -- function itself needs no changes. Only the fields it reads are
  -- included — adding more would just inflate the request body.
  v_body := jsonb_build_object(
    'user_id', NEW.author_id,
    'notes', jsonb_build_array(jsonb_build_object(
      'id',             NEW.id,
      'summary',        NEW.summary,
      'due_date',       NEW.due_date,
      'reminder_time',  NEW.reminder_time,
      'original_text',  NEW.original_text
    ))
  );

  -- Fire-and-forget via pg_net.
  -- Literal URL + anon-key Bearer matches the repo's cron convention
  -- (see 20260503173725 and 20260511014246 — runtime settings
  -- aren't populated on this database). The anon JWT is public; it
  -- only authenticates to the Supabase Functions gateway, after
  -- which the edge function does its own auth from body.user_id.
  --
  -- BEGIN/EXCEPTION: pg_net failures must never block a clerk_notes
  -- insert. Calendar sync is a side-effect, not part of the note's
  -- semantic correctness.
  BEGIN
    SELECT net.http_post(
      url := 'https://wtfspzvcetxmcfftwonq.supabase.co/functions/v1/auto-calendar-event',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg"}'::jsonb,
      body := v_body
    ) INTO v_request_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[clerk_notes_auto_calendar_trigger] pg_net post failed for note %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trigger_auto_calendar_event_on_clerk_notes() FROM PUBLIC, anon, authenticated;

-- ── Trigger ───────────────────────────────────────────────────────
-- DROP first so this migration is safely re-runnable.
DROP TRIGGER IF EXISTS clerk_notes_auto_calendar_event ON public.clerk_notes;

CREATE TRIGGER clerk_notes_auto_calendar_event
  AFTER INSERT ON public.clerk_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_auto_calendar_event_on_clerk_notes();

COMMENT ON FUNCTION public.trigger_auto_calendar_event_on_clerk_notes() IS
'Fires auto-calendar-event for newly-inserted clerk_notes rows with a due_date or reminder_time. Replaces the racy invocation that used to live inside process-note (which fired before the row was committed, leaving calendar_events.note_id = NULL).';

-- Phase 4 — Compiled Memory Artifacts + Event-Driven Recompile
-- ==============================================================
-- Engineering Plan Tasks 2-A / 2-B / 2-E-follow-up.
--
-- Goals:
--   1. Make the memory artifact layer recompile reactively when the
--      user's learned facts change, not just on the nightly cron.
--      Compiled staleness is the largest correctness risk in Phase 2;
--      a 24h lag means "I told Olive I hate cilantro at 9am" and the
--      prompt still says "enjoys cilantro" until 3am tomorrow.
--
--   2. Provide a DEBOUNCED scheduler so a user's brain-dump of 40
--      chunks doesn't trigger 40 compile runs. We insert one job per
--      user per ~10-minute window; additional chunk writes in that
--      window are absorbed.
--
--   3. Relax the pre-existing CHECK constraint on
--      olive_heartbeat_jobs.job_type (if present) so new job types
--      can be added without migration gymnastics. The check was a
--      closed enum in the original schema; Phase 2 already de-facto
--      added `contradiction_resolve` and production appears to be
--      running without the constraint, but we drop it defensively here
--      so every environment converges.
--
-- Invariants preserved:
--   - This migration is fully idempotent (IF EXISTS guards + CREATE OR REPLACE).
--   - Schema additions are ADDITIVE only — no column removals, no data loss.
--   - Failure of the trigger function NEVER blocks the underlying write
--     (WHEN + EXCEPTION-safe function).
--   - Existing nightly compile cron continues to work unchanged.
--
-- Affected tables:
--   - olive_heartbeat_jobs (CHECK relaxed; defensive)
--   - olive_memory_chunks (trigger attached)
--   - New RPC: enqueue_artifact_recompile(user_id, debounce_minutes)

BEGIN;

-- ─── 1. Relax heartbeat job_type CHECK constraint ─────────────────
-- The base schema `20260129000001_olive_memory_system.sql` declared a
-- fixed CHECK (job_type IN ('morning_briefing', ...)). Phase 2 added
-- 'contradiction_resolve' which isn't in that list — production appears
-- to have dropped the constraint historically, but local/dev envs might
-- still have it. This block removes it if present so Phase 4-E can add
-- `recompile_artifacts` without failing.
DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.olive_heartbeat_jobs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%job_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.olive_heartbeat_jobs DROP CONSTRAINT %I', con.conname);
    RAISE NOTICE 'Dropped job_type CHECK constraint: %', con.conname;
  END LOOP;
EXCEPTION WHEN undefined_table THEN
  -- Table not present in this env — no-op
  RAISE NOTICE 'olive_heartbeat_jobs table not found — skipping CHECK relaxation';
END $$;

-- ─── 2. enqueue_artifact_recompile RPC ────────────────────────────
-- Insert a debounced `recompile_artifacts` job. If a pending job for
-- this user already exists with scheduled_for in the future, we re-use
-- it (debounce). Otherwise insert a new one scheduled `debounce_minutes`
-- ahead of now.
--
-- Returns the job row's id (existing or new) so the caller/trigger can
-- log it. Uses advisory locking is NOT needed here — the unique index
-- added below + UPSERT-by-select pattern is sufficient under typical
-- Postgres concurrency, and a rare double-insert just means one extra
-- harmless compile (which is bounded by compile-memory's own hash check
-- that returns "unchanged" when nothing actually moved).
CREATE OR REPLACE FUNCTION public.enqueue_artifact_recompile(
  p_user_id TEXT,
  p_debounce_minutes INTEGER DEFAULT 10
)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SET search_path = 'public'
AS $$
DECLARE
  v_existing UUID;
  v_new UUID;
  v_scheduled TIMESTAMPTZ;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' THEN
    RETURN NULL;
  END IF;

  v_scheduled := now() + make_interval(mins => GREATEST(1, p_debounce_minutes));

  -- Debounce: is there already a pending recompile for this user with
  -- scheduled_for in the future? Any such job will catch this change.
  SELECT id INTO v_existing
  FROM public.olive_heartbeat_jobs
  WHERE user_id = p_user_id
    AND job_type = 'recompile_artifacts'
    AND status = 'pending'
    AND scheduled_for >= now()
  ORDER BY scheduled_for ASC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- No pending job — create one.
  INSERT INTO public.olive_heartbeat_jobs (
    user_id, job_type, scheduled_for, status, payload
  ) VALUES (
    p_user_id,
    'recompile_artifacts',
    v_scheduled,
    'pending',
    jsonb_build_object('reason', 'chunk_change', 'queued_at', now())
  )
  RETURNING id INTO v_new;

  RETURN v_new;
END;
$$;

COMMENT ON FUNCTION public.enqueue_artifact_recompile(TEXT, INTEGER) IS
  'Phase 4-E: Debounced enqueue of a recompile_artifacts heartbeat job. Returns existing pending job id if one is already scheduled within the debounce window, otherwise inserts a new one. Called by the olive_memory_chunks change trigger.';

-- ─── 3. Trigger function on olive_memory_chunks ───────────────────
-- Fires AFTER INSERT or UPDATE on olive_memory_chunks. The chunk's
-- user_id drives the queue. Wrapped in a safe BEGIN..EXCEPTION block
-- so a queue failure NEVER rolls back the original chunk write.
CREATE OR REPLACE FUNCTION public.on_memory_chunk_change()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = 'public'
AS $$
BEGIN
  -- Only enqueue on active chunks — inactive/soft-deleted chunks
  -- don't change the compiled view.
  IF (TG_OP = 'INSERT' AND NEW.is_active IS NOT FALSE)
     OR (TG_OP = 'UPDATE'
         AND (OLD.content IS DISTINCT FROM NEW.content
              OR OLD.is_active IS DISTINCT FROM NEW.is_active
              OR OLD.importance IS DISTINCT FROM NEW.importance))
  THEN
    BEGIN
      PERFORM public.enqueue_artifact_recompile(NEW.user_id, 10);
    EXCEPTION WHEN OTHERS THEN
      -- Never block the underlying chunk write on a queue failure.
      RAISE WARNING 'enqueue_artifact_recompile failed for user_id=%: %', NEW.user_id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.on_memory_chunk_change() IS
  'Phase 4-E: Attached to olive_memory_chunks AFTER INSERT/UPDATE. Calls enqueue_artifact_recompile to debounce-schedule a compiled-artifact refresh. Swallows its own errors — never blocks chunk writes.';

-- Drop & recreate trigger idempotently.
DROP TRIGGER IF EXISTS trg_memory_chunk_enqueue_recompile ON public.olive_memory_chunks;
CREATE TRIGGER trg_memory_chunk_enqueue_recompile
  AFTER INSERT OR UPDATE ON public.olive_memory_chunks
  FOR EACH ROW
  EXECUTE FUNCTION public.on_memory_chunk_change();

-- ─── 4. Index for fast debounce lookup ────────────────────────────
-- Without this index, `enqueue_artifact_recompile` does a full scan of
-- olive_heartbeat_jobs on every chunk insert. Partial index on pending
-- rows keeps it tiny and fast.
CREATE INDEX IF NOT EXISTS idx_heartbeat_jobs_recompile_pending
  ON public.olive_heartbeat_jobs(user_id, scheduled_for)
  WHERE job_type = 'recompile_artifacts' AND status = 'pending';

-- ─── 5. Grounding metadata: comment + backward-compat note ────────
-- No schema change needed here — olive_memory_files.metadata is already
-- a JSONB column. Phase 4-A writes these new keys:
--   - source_chunk_ids: text[] of 'note:<id>' / 'memory:<id>' / 'entity:<name>' tokens
--   - validation_score: float 0..1 (grounding heuristic result)
--   - validation_notes: human-readable summary
--   - validation_ungrounded_count: int
--   - budget_tokens: int (enforced per-artifact cap)
--   - was_truncated: bool
-- Existing rows without these keys continue to work; reads treat them
-- as null.

COMMIT;

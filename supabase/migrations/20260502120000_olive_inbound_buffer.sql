-- ============================================================================
-- olive_inbound_buffer — debounced inbound clustering for WhatsApp 1:1
-- ============================================================================
-- PR8 / Phase 2 of the i18n + UX series.
--
-- Buffers inbound WhatsApp events for ~7 seconds so that a media drop
-- followed by descriptive text (or another media drop) within the
-- window can be processed as ONE capture with ONE reply, instead of
-- producing N notes and N confused replies for a single user intent.
--
-- See `_shared/inbound-cluster.ts` and the Phase 2 plan for the
-- "tail-leader" pattern: each cluster-triggering event waits the
-- window, the newest event becomes the leader, older events yield.
-- The leader atomically claims all unflushed events for the user
-- via `claim_inbound_cluster` and processes them as a single batch.
--
-- This table is server-side only — never queried from a client.
-- RLS is enabled and only the service role can touch it. The cluster
-- contains potentially sensitive media URLs and free-form text, so
-- the same posture as `clerk_notes` (encryption-at-rest + RLS).

CREATE TABLE IF NOT EXISTS public.olive_inbound_buffer (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES public.clerk_profiles(id) ON DELETE CASCADE,
  -- Identifies the source Meta WAMID. Indexed UNIQUE per user so that
  -- if Meta retries the webhook for the same message, we don't double-buffer.
  wa_message_id      text        NOT NULL,
  -- Event content — one or more of these will be set per row.
  message_body       text,
  media_urls         text[],
  media_types        text[],
  latitude           text,
  longitude          text,
  -- Quoted-message awareness (PR4): if the user replied-to / quoted a
  -- previous Olive message, this is the WAMID of that quoted message.
  -- If non-null on the LEADER event, the cluster routes to TASK_ACTION
  -- on the resolved task instead of CREATE.
  quoted_message_id  text,
  -- Meta's own timestamp for the message (Unix seconds × 1000 → ISO).
  -- Used as the ordering key for leader election. Trusting Meta's
  -- timestamp prevents per-server clock drift from mis-ordering events.
  received_at        timestamptz NOT NULL,
  -- Set when the leader claims this row. Used for diagnostics + telemetry.
  cluster_id         uuid,
  -- Set when the row has been processed (or evicted as orphan).
  -- A row with flushed_at IS NULL is "live" — counts toward leader
  -- election. The atomic claim sets flushed_at = now() before the
  -- cluster processor reads it, so a second concurrent leader sees
  -- nothing to claim.
  flushed_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: same WAMID for the same user can't be buffered twice.
-- Important because Meta retries webhooks if it doesn't see a 200 fast
-- enough, and our async-ack pattern means a retry could fire after
-- the original is already in flight.
CREATE UNIQUE INDEX IF NOT EXISTS olive_inbound_buffer_wamid_uniq
  ON public.olive_inbound_buffer (user_id, wa_message_id);

-- The hot lookup: "give me all unflushed events for user X, newest first".
-- Partial index keeps it tiny even as flushed history accumulates.
CREATE INDEX IF NOT EXISTS olive_inbound_buffer_active_idx
  ON public.olive_inbound_buffer (user_id, received_at DESC)
  WHERE flushed_at IS NULL;

-- Cleanup helper index — for the periodic prune below.
CREATE INDEX IF NOT EXISTS olive_inbound_buffer_flushed_idx
  ON public.olive_inbound_buffer (flushed_at)
  WHERE flushed_at IS NOT NULL;

-- ── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.olive_inbound_buffer ENABLE ROW LEVEL SECURITY;

-- Default-deny: no policy for anon / authenticated. The service role
-- bypasses RLS and is what edge functions use, so they can always
-- read/write. Explicit SELECT-deny for safety in case someone later
-- enables anon access by mistake.
CREATE POLICY "olive_inbound_buffer_deny_anon"
  ON public.olive_inbound_buffer FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- ── claim_inbound_cluster RPC ────────────────────────────────────────
-- The atomic claim. Two concurrent webhooks both passing the leader
-- check both call this function; `FOR UPDATE SKIP LOCKED` ensures
-- only one of them gets non-empty rows back. The other gets [].
--
-- Returns the events in `received_at ASC` order so the cluster
-- processor sees them chronologically (relevant for "first message
-- triggers the brief ack, last message decides quoted_message_id").
CREATE OR REPLACE FUNCTION public.claim_inbound_cluster(
  p_user_id          uuid,
  p_cluster_id       uuid,
  p_max_received_at  timestamptz
)
RETURNS SETOF public.olive_inbound_buffer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH locked AS (
    SELECT id
    FROM public.olive_inbound_buffer
    WHERE user_id = p_user_id
      AND flushed_at IS NULL
      AND received_at <= p_max_received_at
    ORDER BY received_at ASC
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.olive_inbound_buffer b
     SET flushed_at = NOW(),
         cluster_id = p_cluster_id
   WHERE b.id IN (SELECT id FROM locked)
   RETURNING b.*;
END;
$$;

-- The RPC is callable by the service role (which the edge functions use).
-- Anon/authenticated callers should never invoke it; revoke explicitly.
REVOKE ALL ON FUNCTION public.claim_inbound_cluster(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_inbound_cluster(uuid, uuid, timestamptz) TO service_role;

-- ── cleanup_inbound_buffer maintenance function ──────────────────────
-- Drops rows that are no longer useful:
--   * flushed > 24h ago: processed; kept briefly for telemetry
--   * unflushed > 6h ago: orphaned (function died mid-wait); safe to drop
--
-- 6h on orphans is generous; the typical wait is 7 seconds. The window
-- exists so that ad-hoc admin queries during an incident still see the
-- recent buffer state.
CREATE OR REPLACE FUNCTION public.cleanup_inbound_buffer()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_removed integer;
BEGIN
  WITH del AS (
    DELETE FROM public.olive_inbound_buffer
    WHERE (flushed_at IS NOT NULL AND flushed_at < NOW() - INTERVAL '24 hours')
       OR (flushed_at IS NULL     AND received_at < NOW() - INTERVAL '6 hours')
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_removed FROM del;
  RETURN v_removed;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_inbound_buffer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_inbound_buffer() TO service_role;

-- ── Schedule cleanup via pg_cron (every hour) ────────────────────────
-- Idempotent across re-runs: if pg_cron isn't installed (some
-- environments), skip; if the job already exists, unschedule then
-- re-schedule so any future change to the schedule expression takes
-- effect on the next migration apply.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'olive-inbound-buffer-cleanup') THEN
      PERFORM cron.unschedule('olive-inbound-buffer-cleanup');
    END IF;
    PERFORM cron.schedule(
      'olive-inbound-buffer-cleanup',
      '0 * * * *',  -- every hour on the hour
      $cron$ SELECT public.cleanup_inbound_buffer(); $cron$
    );
  END IF;
END
$$;

COMMENT ON TABLE public.olive_inbound_buffer IS
  'PR8: short-lived (≤6h orphan / ≤24h flushed) buffer of inbound WhatsApp events for debounced clustering. See _shared/inbound-cluster.ts for the leader-election protocol.';

COMMENT ON FUNCTION public.claim_inbound_cluster(uuid, uuid, timestamptz) IS
  'PR8: atomically claim all unflushed events for a user up to a given timestamp. Uses FOR UPDATE SKIP LOCKED so concurrent leaders don''t double-process.';

COMMENT ON FUNCTION public.cleanup_inbound_buffer() IS
  'PR8: prune the inbound buffer. Scheduled hourly via pg_cron.';

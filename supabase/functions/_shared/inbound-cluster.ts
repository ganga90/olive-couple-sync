/**
 * Inbound clustering primitives.
 * ==============================
 *
 * Phase 2 of the i18n+UX series. The "tail-leader" debounce protocol:
 *
 *   1. Every cluster-triggering event (image/voice/document/video/link or
 *      a plain-text follow-up while a cluster is live) writes itself to
 *      `olive_inbound_buffer`.
 *   2. The first event in a new cluster sends a brief ack so the user
 *      sees Olive received their drop. Subsequent events in the same
 *      cluster are silent.
 *   3. Each event waits the debounce window (default 7s) and then asks:
 *      "Is there a NEWER unflushed event from this user?"
 *        - Yes → I'm not the leader; the newer event will handle. Exit.
 *        - No  → I am the leader. Atomically claim every unflushed
 *                event for this user and process them as a single capture.
 *
 * The atomic claim happens server-side via the `claim_inbound_cluster`
 * RPC (defined in `20260502120000_olive_inbound_buffer.sql`). It uses
 * `FOR UPDATE SKIP LOCKED` so two concurrent leaders racing past their
 * `isStillLeader()` checks both call the RPC, but only one comes back
 * with rows. The other no-ops.
 *
 * Latency contract:
 *   solo media drop      → brief ack at +0, full reply at +7s
 *   media + text +Δs     → brief ack at +0, full reply at Δ+7s
 *   plain text, no link  → bypasses the buffer entirely (existing fast
 *                          path) — zero added latency
 *
 * This module is pure I/O against the buffer table; the actual cluster
 * processing (combining payloads, calling process-note, replying) lives
 * in `inbound-cluster-processor.ts` so each surface is independently
 * testable.
 */

// `any` for the supabase client — same justification as the
// quoted-message resolver: the @supabase/supabase-js generic varies
// across versions and we only touch the documented chain at runtime.
// deno-lint-ignore no-explicit-any
type SupabaseClientLike = any;

/**
 * Event payload buffered into `olive_inbound_buffer`.
 *
 * Mirrors the relevant fields from the WhatsApp inbound parser
 * (see `MetaMessageData` in whatsapp-webhook/index.ts) plus the
 * Meta timestamp the cluster needs for ordering.
 */
export interface BufferableEvent {
  user_id: string;
  wa_message_id: string;
  message_body: string | null;
  media_urls: string[];
  media_types: string[];
  latitude: string | null;
  longitude: string | null;
  quoted_message_id: string | null;
  /** ISO string. Comes from Meta's `message.timestamp` × 1000. */
  received_at: string;
}

/** What the buffer rows look like when read back. */
export interface BufferedEvent extends BufferableEvent {
  id: string;
  cluster_id: string | null;
  flushed_at: string | null;
  created_at: string;
}

/** The default debounce window. 7 seconds. */
export const CLUSTER_WINDOW_MS = 7000;

/**
 * Trigger detection: does this event start (or extend) a cluster?
 *
 * Cluster triggers:
 *   - Any media (image/video/audio/document) — a non-empty media_urls
 *     array is the canonical signal.
 *   - Plain text containing a URL (we treat link drops the same as
 *     media drops; users often share an article and add commentary).
 *
 * Plain text without a URL is NOT a trigger by itself. But if the
 * caller observes that there's already an active cluster for this
 * user (`hasActiveCluster` returned true), the text JOINS that cluster.
 * That logic is in the webhook dispatch, not here.
 */
export function isClusterTrigger(event: { message_body: string | null; media_urls: string[] }): boolean {
  if (event.media_urls && event.media_urls.length > 0) return true;
  if (event.message_body && /https?:\/\//i.test(event.message_body)) return true;
  return false;
}

/**
 * Insert an event into the buffer. Idempotent on (user_id, wa_message_id):
 * if Meta retries the webhook for the same message, the second insert
 * fails the unique constraint and we treat that as a no-op duplicate.
 *
 * Returns the row's `id` on success, or null if the insert was a
 * duplicate (caller should NOT proceed with leadership wait — the
 * original webhook is already handling).
 */
export async function bufferEvent(
  supabase: SupabaseClientLike,
  event: BufferableEvent,
): Promise<{ id: string; isDuplicate: false } | { id: null; isDuplicate: true } | null> {
  try {
    const { data, error } = await supabase
      .from("olive_inbound_buffer")
      .insert({
        user_id: event.user_id,
        wa_message_id: event.wa_message_id,
        message_body: event.message_body,
        media_urls: event.media_urls.length > 0 ? event.media_urls : null,
        media_types: event.media_types.length > 0 ? event.media_types : null,
        latitude: event.latitude,
        longitude: event.longitude,
        quoted_message_id: event.quoted_message_id,
        received_at: event.received_at,
      })
      .select("id")
      .single();

    if (error) {
      // Postgres error code 23505 = unique_violation. Meta retries
      // hit this path; we want the second webhook to bail.
      if (error.code === "23505") {
        return { id: null, isDuplicate: true };
      }
      console.error("[InboundCluster] bufferEvent insert failed:", error.message);
      return null;
    }
    return { id: data.id as string, isDuplicate: false };
  } catch (err) {
    console.error("[InboundCluster] bufferEvent exception:", err);
    return null;
  }
}

/**
 * Is there ALREADY an unflushed event in the buffer for this user
 * (not counting the row we just inserted)?
 *
 * Used to decide whether to send the brief ack ("first in cluster")
 * or stay silent ("joining an in-flight cluster").
 *
 * The current event's own row is excluded via the `excludeId` arg —
 * if the caller's bufferEvent succeeded, the row would otherwise
 * always come back as "active". Callers that haven't buffered yet
 * (theoretical, not used today) can pass `excludeId: null`.
 */
export async function hasActiveCluster(
  supabase: SupabaseClientLike,
  userId: string,
  excludeId: string | null,
): Promise<boolean> {
  try {
    let query = supabase
      .from("olive_inbound_buffer")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("flushed_at", null);
    if (excludeId) query = query.neq("id", excludeId);
    const { count, error } = await query;
    if (error) {
      console.error("[InboundCluster] hasActiveCluster query failed:", error.message);
      // Fail SAFE: pretend there's an active cluster so we DON'T send
      // a duplicate brief ack. Worse to spam acks than to skip one.
      return true;
    }
    return (count ?? 0) > 0;
  } catch (err) {
    console.error("[InboundCluster] hasActiveCluster exception:", err);
    return true;
  }
}

/**
 * Am I still the latest unflushed event for this user?
 *
 * Used after the debounce wait to decide whether to claim-and-flush
 * or yield. Returns true iff no event with `received_at > myReceivedAt`
 * is still unflushed for this user.
 *
 * Failures fail-CLOSED (return false → we yield). Better to drop a
 * cluster than to double-process. The orphan cleanup will pick up
 * the abandoned events at the next hourly run.
 */
export async function isStillLeader(
  supabase: SupabaseClientLike,
  userId: string,
  myReceivedAt: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("olive_inbound_buffer")
      .select("id")
      .eq("user_id", userId)
      .is("flushed_at", null)
      .gt("received_at", myReceivedAt)
      .limit(1);
    if (error) {
      console.error("[InboundCluster] isStillLeader query failed:", error.message);
      return false;
    }
    return !data || data.length === 0;
  } catch (err) {
    console.error("[InboundCluster] isStillLeader exception:", err);
    return false;
  }
}

/**
 * Atomic claim of the cluster. Only the winning leader gets non-empty
 * results; concurrent racers get an empty array.
 *
 * `clusterId` is generated by the caller (a fresh UUID) so it can be
 * threaded through downstream logging without an extra round-trip.
 *
 * `maxReceivedAt` defaults to "now" — we claim everything strictly
 * up to and including the caller's perception of time. Passing the
 * caller's own receivedAt would let a still-arriving newer event
 * survive the claim, which we don't want once the leader has decided
 * to flush.
 */
export async function claimCluster(
  supabase: SupabaseClientLike,
  userId: string,
  clusterId: string,
  maxReceivedAt: string = new Date().toISOString(),
): Promise<BufferedEvent[]> {
  try {
    const { data, error } = await supabase.rpc("claim_inbound_cluster", {
      p_user_id: userId,
      p_cluster_id: clusterId,
      p_max_received_at: maxReceivedAt,
    });
    if (error) {
      console.error("[InboundCluster] claimCluster RPC failed:", error.message);
      return [];
    }
    if (!Array.isArray(data)) return [];
    return data as BufferedEvent[];
  } catch (err) {
    console.error("[InboundCluster] claimCluster exception:", err);
    return [];
  }
}

/**
 * Sleep helper. Exposed so tests can monkey-patch via dependency
 * injection if we ever need to. Today it's just a setTimeout wrapper.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

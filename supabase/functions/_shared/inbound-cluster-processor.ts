/**
 * Inbound cluster processor.
 * ==========================
 *
 * Pure logic that turns a list of claimed `olive_inbound_buffer` rows
 * into a single payload the webhook can hand to `process-note` (for
 * the CREATE path) or `augment_existing_task` flow (when the leader
 * event quoted a previous Olive task — the user is supplementing an
 * existing note rather than starting a new one).
 *
 * Lives in `_shared` so it's importable by tests without pulling in
 * the entire 7,800-line webhook. The webhook owns the side effects
 * (DB inserts, Meta API calls, reply formatting) — this module owns
 * only the combine + intent-decision logic. Keeping the boundary
 * tight means we can refactor either side without touching the other.
 */

import type { BufferedEvent } from "./inbound-cluster.ts";

/**
 * The combined view of a cluster, ready for the webhook to act on.
 *
 * Notably, this is intent-AGNOSTIC: it carries `leader_quoted_message_id`
 * but doesn't itself decide CREATE vs TASK_ACTION. The webhook resolves
 * the WAMID to a task (via PR4's `resolveQuotedTask`) and dispatches.
 * That separation keeps this module pure-data and testable in isolation.
 */
export interface CombinedCluster {
  /**
   * All event message bodies joined with single newlines, with empties
   * dropped. Order matches `received_at` ascending — earliest first —
   * so AI context reads chronologically. Empty string if no event had
   * a message body.
   */
  text: string;
  /**
   * Concatenation of every event's media_urls, deduped (same URL
   * could appear in two events if Meta retries get past the unique
   * index — defense-in-depth).
   */
  media_urls: string[];
  /** Mirrors media_urls element-for-element. */
  media_types: string[];
  /**
   * Location is single-valued. We pick the FIRST non-null lat/long
   * pair we see in chronological order — typically the user shares
   * location once at the start of a cluster, not multiple times.
   */
  latitude: string | null;
  longitude: string | null;
  /**
   * If the LEADER event (the one whose 7s wait expired without a
   * newer event) carries a quoted-message reference, we surface it
   * here. The webhook resolves this WAMID via the recent_outbound
   * sliding window. If non-null AND it resolves to a task, the
   * cluster routes to TASK_ACTION instead of CREATE.
   *
   * We use the LEADER's quote (last event by received_at), not the
   * earliest, because the user's most recent intent is what they
   * want acted on. If they sent text (no quote), then quoted-image,
   * the quoted-image is the user's "currently pointing at".
   */
  leader_quoted_message_id: string | null;
  /** How many events fed into this cluster. ≥ 1. */
  source_event_count: number;
  /** WAMIDs of every source event (for telemetry / outbound context). */
  source_wamids: string[];
  /**
   * The earliest event's received_at — useful for "cluster duration"
   * telemetry (last - first = how long the user spent typing).
   */
  earliest_received_at: string;
  /** The latest event's received_at — useful for the same. */
  latest_received_at: string;
}

/**
 * Combine claimed cluster events into a single payload.
 *
 * Inputs:
 *   `events` — the rows returned by `claimCluster`, expected sorted
 *   by received_at ascending (the RPC guarantees this). We don't
 *   re-sort defensively; if a future caller passes unsorted input
 *   the leader-quote selection would be wrong, so we'd rather fail
 *   loudly via tests than silently re-order.
 *
 * Returns: a `CombinedCluster` representing the joined view.
 *
 * Throws: if `events` is empty. The webhook should never call
 * `combineCluster` with an empty array — if `claimCluster` returned
 * nothing (race-loss), the webhook bails before getting here.
 */
export function combineCluster(events: BufferedEvent[]): CombinedCluster {
  if (events.length === 0) {
    throw new Error("combineCluster: refusing to combine an empty cluster");
  }

  // Defensive: confirm sort order. The RPC is supposed to deliver
  // received_at ASC — log a warning if not, then sort. We don't want
  // a future RPC change to silently flip the leader-quote behavior.
  const sorted = [...events];
  let needsSort = false;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].received_at < sorted[i - 1].received_at) {
      needsSort = true;
      break;
    }
  }
  if (needsSort) {
    console.warn(
      "[ClusterProcessor] combineCluster received unsorted events; " +
        "sorting defensively. The claim_inbound_cluster RPC should " +
        "return ASC by received_at — investigate.",
    );
    sorted.sort((a, b) => a.received_at.localeCompare(b.received_at));
  }

  // Combine text bodies. Drop empty / whitespace-only entries so the
  // resulting `text` doesn't contain stray newlines around blanks.
  const textParts = sorted
    .map((e) => (e.message_body ?? "").trim())
    .filter((t) => t.length > 0);
  const text = textParts.join("\n");

  // Concatenate media, deduping by URL. The unique index on
  // (user_id, wa_message_id) prevents the most common dup source
  // (Meta retries), but a single user message CAN legitimately
  // attach the same URL twice via re-upload — in that case dedup
  // keeps the note tidy.
  const seenUrls = new Set<string>();
  const media_urls: string[] = [];
  const media_types: string[] = [];
  for (const e of sorted) {
    const urls = e.media_urls ?? [];
    const types = e.media_types ?? [];
    for (let i = 0; i < urls.length; i++) {
      if (seenUrls.has(urls[i])) continue;
      seenUrls.add(urls[i]);
      media_urls.push(urls[i]);
      media_types.push(types[i] ?? "application/octet-stream");
    }
  }

  // Location: first non-null pair in chronological order.
  let latitude: string | null = null;
  let longitude: string | null = null;
  for (const e of sorted) {
    if (e.latitude && e.longitude) {
      latitude = e.latitude;
      longitude = e.longitude;
      break;
    }
  }

  // Leader's quote: the LAST event's quoted_message_id (the user's
  // most recent reference, which is what their intent currently
  // points at).
  const leader = sorted[sorted.length - 1];
  const leader_quoted_message_id = leader.quoted_message_id ?? null;

  return {
    text,
    media_urls,
    media_types,
    latitude,
    longitude,
    leader_quoted_message_id,
    source_event_count: sorted.length,
    source_wamids: sorted.map((e) => e.wa_message_id),
    earliest_received_at: sorted[0].received_at,
    latest_received_at: leader.received_at,
  };
}

/**
 * The webhook's intent-dispatch decision, given a combined cluster
 * AND the result of resolving the leader's quoted WAMID. Pulled out
 * as a pure function so the dispatch logic is testable in isolation.
 *
 * Rules (matching the PR8 plan):
 *   - leader_quoted_message_id is null → CREATE
 *   - quoted message resolved to a task → TASK_ACTION on that task
 *   - quoted message did NOT resolve (e.g., older than the
 *     recent_outbound window, or non-task quote) → CREATE
 *
 * The "non-resolving quote → CREATE" rule is important: we don't
 * want a stale or irrelevant quote reference to suppress a legitimate
 * note creation. The user clearly wanted to capture something; we
 * just create normally and let the user use a regular TASK_ACTION
 * follow-up if they meant to augment.
 */
export type ClusterIntent =
  | { kind: "create" }
  | { kind: "task_action"; task_id: string; task_summary: string };

export function decideClusterIntent(
  cluster: CombinedCluster,
  resolvedQuotedTask: { task_id: string; task_summary: string } | null,
): ClusterIntent {
  if (cluster.leader_quoted_message_id && resolvedQuotedTask) {
    return {
      kind: "task_action",
      task_id: resolvedQuotedTask.task_id,
      task_summary: resolvedQuotedTask.task_summary,
    };
  }
  return { kind: "create" };
}

// Tests for the cluster combine + intent-decision pure logic. Each
// test pins one rule from the design spec so future refactors that
// change behavior break the right test (instead of mysteriously
// breaking an end-to-end test that's hard to debug).

import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { BufferedEvent } from "./inbound-cluster.ts";
import {
  type CombinedCluster,
  combineCluster,
  decideClusterIntent,
} from "./inbound-cluster-processor.ts";

function ev(overrides: Partial<BufferedEvent> = {}): BufferedEvent {
  return {
    id: "id-x",
    user_id: "user-A",
    wa_message_id: "wamid.X",
    message_body: null,
    media_urls: [],
    media_types: [],
    latitude: null,
    longitude: null,
    quoted_message_id: null,
    received_at: "2026-05-02T12:00:00.000Z",
    cluster_id: null,
    flushed_at: null,
    created_at: "2026-05-02T12:00:00.000Z",
    ...overrides,
  };
}

// ─── combineCluster: empty input ─────────────────────────────────────

Deno.test("combineCluster: throws on empty cluster (programmer error)", () => {
  assertThrows(
    () => combineCluster([]),
    Error,
    "refusing to combine an empty cluster",
  );
});

// ─── combineCluster: text concatenation ─────────────────────────────

Deno.test("combineCluster: single text event → text=that text", () => {
  const c = combineCluster([ev({ message_body: "buy milk", id: "e1", wa_message_id: "w1" })]);
  assertEquals(c.text, "buy milk");
  assertEquals(c.source_event_count, 1);
});

Deno.test("combineCluster: multi-event text joined by newline, ordered by received_at", () => {
  const c = combineCluster([
    ev({
      id: "e1",
      wa_message_id: "w1",
      message_body: "first",
      received_at: "2026-05-02T12:00:00Z",
    }),
    ev({
      id: "e2",
      wa_message_id: "w2",
      message_body: "second",
      received_at: "2026-05-02T12:00:03Z",
    }),
  ]);
  assertEquals(c.text, "first\nsecond");
});

Deno.test("combineCluster: empty / whitespace-only bodies dropped before join", () => {
  // Otherwise the joined `text` would contain stray "\n\n\n" runs.
  const c = combineCluster([
    ev({ id: "e1", wa_message_id: "w1", message_body: "hello", received_at: "2026-05-02T12:00:00Z" }),
    ev({ id: "e2", wa_message_id: "w2", message_body: "   ", received_at: "2026-05-02T12:00:01Z" }),
    ev({ id: "e3", wa_message_id: "w3", message_body: null, received_at: "2026-05-02T12:00:02Z" }),
    ev({ id: "e4", wa_message_id: "w4", message_body: "world", received_at: "2026-05-02T12:00:03Z" }),
  ]);
  assertEquals(c.text, "hello\nworld");
});

Deno.test("combineCluster: all-empty bodies → empty string text", () => {
  const c = combineCluster([
    ev({ id: "e1", wa_message_id: "w1", message_body: null }),
    ev({ id: "e2", wa_message_id: "w2", message_body: "" }),
  ]);
  assertEquals(c.text, "");
});

// ─── combineCluster: media concatenation + dedup ─────────────────────

Deno.test("combineCluster: media URLs concatenated across events", () => {
  const c = combineCluster([
    ev({
      id: "e1",
      wa_message_id: "w1",
      media_urls: ["https://x/a.jpg"],
      media_types: ["image/jpeg"],
      received_at: "2026-05-02T12:00:00Z",
    }),
    ev({
      id: "e2",
      wa_message_id: "w2",
      media_urls: ["https://x/b.ogg"],
      media_types: ["audio/ogg"],
      received_at: "2026-05-02T12:00:03Z",
    }),
  ]);
  assertEquals(c.media_urls, ["https://x/a.jpg", "https://x/b.ogg"]);
  assertEquals(c.media_types, ["image/jpeg", "audio/ogg"]);
});

Deno.test("combineCluster: duplicate URLs deduped (defense-in-depth vs Meta retries)", () => {
  // The unique index prevents most dups but a user CAN legitimately
  // re-upload the same URL twice across messages. Dedup keeps the
  // note tidy.
  const c = combineCluster([
    ev({
      id: "e1",
      wa_message_id: "w1",
      media_urls: ["https://x/a.jpg"],
      media_types: ["image/jpeg"],
      received_at: "2026-05-02T12:00:00Z",
    }),
    ev({
      id: "e2",
      wa_message_id: "w2",
      media_urls: ["https://x/a.jpg"],  // same URL
      media_types: ["image/jpeg"],
      received_at: "2026-05-02T12:00:03Z",
    }),
  ]);
  assertEquals(c.media_urls, ["https://x/a.jpg"]);
  assertEquals(c.media_types, ["image/jpeg"]);
});

Deno.test("combineCluster: missing media_types index falls back to octet-stream", () => {
  // If a future buffer row has more URLs than types (data corruption
  // or schema drift), we don't want to crash — pad with a safe default.
  const c = combineCluster([
    ev({
      media_urls: ["https://x/a.jpg", "https://x/b.jpg"],
      media_types: ["image/jpeg"],  // only one type for two URLs
    }),
  ]);
  assertEquals(c.media_urls.length, 2);
  assertEquals(c.media_types.length, 2);
  assertEquals(c.media_types[1], "application/octet-stream");
});

// ─── combineCluster: location ────────────────────────────────────────

Deno.test("combineCluster: location → first non-null pair (chronological)", () => {
  const c = combineCluster([
    ev({
      id: "e1",
      wa_message_id: "w1",
      latitude: "40.7",
      longitude: "-74.0",
      received_at: "2026-05-02T12:00:00Z",
    }),
    ev({
      id: "e2",
      wa_message_id: "w2",
      latitude: "41.9",
      longitude: "-87.6",
      received_at: "2026-05-02T12:00:03Z",
    }),
  ]);
  assertEquals(c.latitude, "40.7");
  assertEquals(c.longitude, "-74.0");
});

Deno.test("combineCluster: location → null when no event has lat/long", () => {
  const c = combineCluster([ev({ message_body: "no location" })]);
  assertEquals(c.latitude, null);
  assertEquals(c.longitude, null);
});

// ─── combineCluster: leader's quoted_message_id ──────────────────────

Deno.test("combineCluster: leader_quoted_message_id = LAST event's quote (not first)", () => {
  // The user's most recent intent is what matters. If they sent
  // text (no quote) then quoted-image, the quoted-image is what
  // they're "currently pointing at".
  const c = combineCluster([
    ev({
      id: "e1",
      wa_message_id: "w1",
      message_body: "text first",
      quoted_message_id: null,
      received_at: "2026-05-02T12:00:00Z",
    }),
    ev({
      id: "e2",
      wa_message_id: "w2",
      media_urls: ["https://x/a.jpg"],
      media_types: ["image/jpeg"],
      quoted_message_id: "wamid.QUOTED",
      received_at: "2026-05-02T12:00:03Z",
    }),
  ]);
  assertEquals(c.leader_quoted_message_id, "wamid.QUOTED");
});

Deno.test("combineCluster: leader_quoted_message_id = null when leader didn't quote", () => {
  // Even if an earlier event quoted, the leader's choice wins. The
  // leader is the user's last word; if they stopped quoting, they
  // moved on.
  const c = combineCluster([
    ev({
      id: "e1",
      wa_message_id: "w1",
      message_body: "first",
      quoted_message_id: "wamid.OLD",
      received_at: "2026-05-02T12:00:00Z",
    }),
    ev({
      id: "e2",
      wa_message_id: "w2",
      message_body: "second",
      quoted_message_id: null,
      received_at: "2026-05-02T12:00:03Z",
    }),
  ]);
  assertEquals(c.leader_quoted_message_id, null);
});

// ─── combineCluster: provenance / telemetry fields ──────────────────

Deno.test("combineCluster: source_wamids ordered chronologically", () => {
  const c = combineCluster([
    ev({ id: "e1", wa_message_id: "w1", received_at: "2026-05-02T12:00:00Z" }),
    ev({ id: "e2", wa_message_id: "w2", received_at: "2026-05-02T12:00:03Z" }),
    ev({ id: "e3", wa_message_id: "w3", received_at: "2026-05-02T12:00:05Z" }),
  ]);
  assertEquals(c.source_wamids, ["w1", "w2", "w3"]);
  assertEquals(c.source_event_count, 3);
});

Deno.test("combineCluster: earliest_received_at + latest_received_at give cluster duration window", () => {
  const c = combineCluster([
    ev({ id: "e1", wa_message_id: "w1", received_at: "2026-05-02T12:00:00.000Z" }),
    ev({ id: "e2", wa_message_id: "w2", received_at: "2026-05-02T12:00:04.500Z" }),
  ]);
  assertEquals(c.earliest_received_at, "2026-05-02T12:00:00.000Z");
  assertEquals(c.latest_received_at, "2026-05-02T12:00:04.500Z");
});

Deno.test("combineCluster: defensively re-sorts misordered input + warns", () => {
  // The RPC promises ASC ordering; if a future change breaks that
  // promise, we defensively sort rather than silently producing
  // wrong leader-quote selection. We tolerate the sort cost (O(n log n))
  // because cluster sizes are tiny (typically 1–4).
  const events = [
    ev({ id: "e2", wa_message_id: "w2", message_body: "second", received_at: "2026-05-02T12:00:03Z" }),
    ev({ id: "e1", wa_message_id: "w1", message_body: "first", received_at: "2026-05-02T12:00:00Z" }),
  ];
  const c = combineCluster(events);
  assertEquals(c.text, "first\nsecond");
  assertEquals(c.source_wamids, ["w1", "w2"]);
});

// ─── decideClusterIntent ─────────────────────────────────────────────

function makeCluster(overrides: Partial<CombinedCluster> = {}): CombinedCluster {
  return {
    text: "",
    media_urls: [],
    media_types: [],
    latitude: null,
    longitude: null,
    leader_quoted_message_id: null,
    source_event_count: 1,
    source_wamids: ["w1"],
    earliest_received_at: "2026-05-02T12:00:00Z",
    latest_received_at: "2026-05-02T12:00:00Z",
    ...overrides,
  };
}

Deno.test("decideClusterIntent: no leader quote → CREATE", () => {
  const intent = decideClusterIntent(makeCluster(), null);
  assertEquals(intent.kind, "create");
});

Deno.test("decideClusterIntent: leader quoted but didn't resolve → CREATE (don't suppress capture)", () => {
  // Critical: a stale/older quote reference must NOT block a
  // legitimate new note. Falling through to CREATE preserves the
  // user's intent; they can use a normal follow-up to augment.
  const intent = decideClusterIntent(
    makeCluster({ leader_quoted_message_id: "wamid.OLD" }),
    null, // didn't resolve
  );
  assertEquals(intent.kind, "create");
});

Deno.test("decideClusterIntent: leader quoted + resolved → TASK_ACTION carrying task ref", () => {
  const intent = decideClusterIntent(
    makeCluster({ leader_quoted_message_id: "wamid.X" }),
    { task_id: "task-7", task_summary: "Medical Analysis" },
  );
  assertEquals(intent.kind, "task_action");
  if (intent.kind === "task_action") {
    assertEquals(intent.task_id, "task-7");
    assertEquals(intent.task_summary, "Medical Analysis");
  }
});

Deno.test("decideClusterIntent: leader did NOT quote, but resolution somehow returned a task → CREATE", () => {
  // Defensive against a buggy caller: we only honor TASK_ACTION
  // when BOTH the leader quoted AND that quote resolved. Either
  // missing → CREATE.
  const intent = decideClusterIntent(
    makeCluster({ leader_quoted_message_id: null }),
    { task_id: "task-7", task_summary: "stale lookup" },
  );
  assertEquals(intent.kind, "create");
});

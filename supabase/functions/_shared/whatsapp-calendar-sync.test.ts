// Tests for _shared/whatsapp-calendar-sync.ts
//
// The invoke wrappers themselves are thin and run against the live
// Supabase functions API — not testable in isolation without mocking
// the full functions client. We focus on the pure copy helper, which is
// what users see, and which holds the i18n contract.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildWhatsAppCalendarSuffix } from "./whatsapp-calendar-sync.ts";

// ─── Localized suffix ─────────────────────────────────────────────────

Deno.test("buildWhatsAppCalendarSuffix: updated → mentions sync (en)", () => {
  const out = buildWhatsAppCalendarSuffix({ status: "updated" }, "en");
  assert(out.toLowerCase().includes("synced"));
});

Deno.test("buildWhatsAppCalendarSuffix: updated (es) → localized", () => {
  const out = buildWhatsAppCalendarSuffix({ status: "updated" }, "es");
  assert(out.toLowerCase().includes("sincronizado"));
});

Deno.test("buildWhatsAppCalendarSuffix: updated (it) → localized", () => {
  const out = buildWhatsAppCalendarSuffix({ status: "updated" }, "it");
  assert(out.toLowerCase().includes("sincronizzato"));
});

Deno.test("buildWhatsAppCalendarSuffix: BCP-47 locales normalize ('it-IT' → it)", () => {
  const out = buildWhatsAppCalendarSuffix({ status: "updated" }, "it-IT");
  assert(out.toLowerCase().includes("sincronizzato"));
});

Deno.test("buildWhatsAppCalendarSuffix: not_connected → empty (don't volunteer)", () => {
  assertEquals(buildWhatsAppCalendarSuffix({ status: "not_connected" }, "en"), "");
  assertEquals(buildWhatsAppCalendarSuffix({ status: "not_connected" }, "es"), "");
  assertEquals(buildWhatsAppCalendarSuffix({ status: "not_connected" }, "it"), "");
});

Deno.test("buildWhatsAppCalendarSuffix: no_linked_event → empty", () => {
  assertEquals(buildWhatsAppCalendarSuffix({ status: "no_linked_event" }, "en"), "");
});

Deno.test("buildWhatsAppCalendarSuffix: already_gone → empty (idempotent terminal)", () => {
  assertEquals(buildWhatsAppCalendarSuffix({ status: "already_gone" }, "en"), "");
});

Deno.test("buildWhatsAppCalendarSuffix: google_api_error → honest failure (en, PR 2B retired 'couldn't reach')", () => {
  // PR 2B: retired the dead-end "couldn't reach Google Calendar this
  // time" copy, mirroring the L4 change in offer-copy.ts. The new
  // honest copy is "Google didn't respond — I'll try again next time".
  const out = buildWhatsAppCalendarSuffix({ status: "google_api_error" }, "en");
  assert(
    out.toLowerCase().includes("didn't respond") || out.toLowerCase().includes("next time"),
    `unexpected copy: ${out}`,
  );
  assert(!out.toLowerCase().includes("couldn't reach"), `dead-end copy still present: ${out}`);
});

Deno.test("buildWhatsAppCalendarSuffix: google_api_error (es) → honest failure", () => {
  const out = buildWhatsAppCalendarSuffix({ status: "google_api_error" }, "es");
  assert(out.toLowerCase().includes("no respondió") || out.toLowerCase().includes("próxima vez"));
});

Deno.test("buildWhatsAppCalendarSuffix: invoke_failed (en) → same honest failure copy", () => {
  const updated = buildWhatsAppCalendarSuffix({ status: "updated" }, "en");
  const failed = buildWhatsAppCalendarSuffix({ status: "invoke_failed" }, "en");
  assert(updated !== failed);
  // PR 2B: "didn't respond" + "try again next time" replace the
  // retired "couldn't" copy.
  assert(failed.toLowerCase().includes("didn't respond") || failed.toLowerCase().includes("next time"));
});

Deno.test("buildWhatsAppCalendarSuffix: token_refresh_failed → same as google_api_error voice", () => {
  // Both are "the calendar didn't sync" from the user's POV; we group
  // them under one copy to keep the message direct.
  const a = buildWhatsAppCalendarSuffix({ status: "token_refresh_failed" }, "en");
  const b = buildWhatsAppCalendarSuffix({ status: "google_api_error" }, "en");
  assertEquals(a, b);
});

Deno.test("buildWhatsAppCalendarSuffix: deleted (en) → 'also removed'", () => {
  const out = buildWhatsAppCalendarSuffix({ status: "deleted" }, "en");
  assert(out.toLowerCase().includes("removed"));
});

Deno.test("buildWhatsAppCalendarSuffix: unknown lang falls back to en", () => {
  // 'fr' isn't in the supported set — should still produce a string,
  // and pick a sensible default rather than crashing.
  const out = buildWhatsAppCalendarSuffix({ status: "updated" }, "fr");
  assert(out.length > 0);
});

// Phase 2.1 — retry-aware failure copy.

Deno.test("buildWhatsAppCalendarSuffix: failure + retry_enqueued (en) → 'keep trying' copy", () => {
  const out = buildWhatsAppCalendarSuffix(
    { status: "google_api_error", retry_enqueued: true },
    "en",
  );
  assert(out.toLowerCase().includes("keep trying") || out.toLowerCase().includes("background"));
});

Deno.test("buildWhatsAppCalendarSuffix: failure + retry_enqueued (es)", () => {
  const out = buildWhatsAppCalendarSuffix(
    { status: "google_api_error", retry_enqueued: true },
    "es",
  );
  assert(out.toLowerCase().includes("intent"));
});

Deno.test("buildWhatsAppCalendarSuffix: failure + retry_enqueued (it)", () => {
  const out = buildWhatsAppCalendarSuffix(
    { status: "google_api_error", retry_enqueued: true },
    "it",
  );
  assert(out.toLowerCase().includes("riprov"));
});

Deno.test("buildWhatsAppCalendarSuffix: failure WITHOUT retry → permanent failure copy", () => {
  const a = buildWhatsAppCalendarSuffix({ status: "google_api_error" }, "en");
  const b = buildWhatsAppCalendarSuffix({ status: "google_api_error", retry_enqueued: true }, "en");
  // The two copies should be materially different — retry softens, no-retry is direct.
  assert(a !== b);
});

// Phase 2.3 — attendees notified clause.

Deno.test("buildWhatsAppCalendarSuffix: updated + 1 attendee (en) → 'the other person' (natural singular)", () => {
  // Natural English uses "the other person" for n=1 rather than the
  // mechanical "the 1 other person." Brand voice values warmth-without-
  // sloppiness; mechanical grammar would feel robotic.
  const out = buildWhatsAppCalendarSuffix(
    { status: "updated", attendees_notified: true, attendee_count: 1 },
    "en",
  );
  assert(out.toLowerCase().includes("the other person"));
  assert(out.toLowerCase().includes("moved"));
});

Deno.test("buildWhatsAppCalendarSuffix: updated + 3 attendees (en) → '3 other people'", () => {
  const out = buildWhatsAppCalendarSuffix(
    { status: "updated", attendees_notified: true, attendee_count: 3 },
    "en",
  );
  assert(out.includes("3 other people"));
});

Deno.test("buildWhatsAppCalendarSuffix: deleted + attendees (en) → 'cancelled' clause", () => {
  const out = buildWhatsAppCalendarSuffix(
    { status: "deleted", attendees_notified: true, attendee_count: 2 },
    "en",
  );
  assert(out.toLowerCase().includes("cancelled"));
  assert(out.includes("2"));
});

Deno.test("buildWhatsAppCalendarSuffix: attendees clause (es)", () => {
  const out = buildWhatsAppCalendarSuffix(
    { status: "updated", attendees_notified: true, attendee_count: 2 },
    "es",
  );
  assert(out.toLowerCase().includes("avis"));
});

Deno.test("buildWhatsAppCalendarSuffix: attendees clause (it)", () => {
  const out = buildWhatsAppCalendarSuffix(
    { status: "updated", attendees_notified: true, attendee_count: 2 },
    "it",
  );
  assert(out.toLowerCase().includes("avvis"));
});

Deno.test("buildWhatsAppCalendarSuffix: attendees_notified=false → no people clause", () => {
  const out = buildWhatsAppCalendarSuffix(
    { status: "updated", attendees_notified: false, attendee_count: 5 },
    "en",
  );
  assert(!out.toLowerCase().includes("other people"));
});

// ─── PR 2B: differentiated copy for new statuses ────────────────────
// Each new sync_status gets exercised in all three languages. Tests
// pin the substrings the copy must surface, not the exact wording —
// keeps the tests robust against minor brand-voice polish later.

Deno.test("buildWhatsAppCalendarSuffix: needs_reconnect (en) → reconnect directive", () => {
  const out = buildWhatsAppCalendarSuffix({ status: "needs_reconnect" }, "en");
  assert(out.toLowerCase().includes("reconnect"), `expected 'reconnect' in: ${out}`);
  // Critical — must NOT pretend a retry is queued.
  assert(!out.toLowerCase().includes("keep trying"));
  assert(!out.toLowerCase().includes("next time"));
});

Deno.test("buildWhatsAppCalendarSuffix: needs_reconnect (es)", () => {
  const out = buildWhatsAppCalendarSuffix({ status: "needs_reconnect" }, "es");
  assert(out.toLowerCase().includes("reconex") || out.toLowerCase().includes("reconect"));
});

Deno.test("buildWhatsAppCalendarSuffix: needs_reconnect (it)", () => {
  const out = buildWhatsAppCalendarSuffix({ status: "needs_reconnect" }, "it");
  assert(out.toLowerCase().includes("riconness"));
});

Deno.test("buildWhatsAppCalendarSuffix: rate_limited + readable retry hint (en) → quotes seconds", () => {
  const out = buildWhatsAppCalendarSuffix(
    { status: "rate_limited", retry_after_ms: 45_000, retry_enqueued: true },
    "en",
  );
  assert(out.toLowerCase().includes("rate-limit"));
  assert(out.includes("45s"), `expected '45s' in: ${out}`);
});

Deno.test("buildWhatsAppCalendarSuffix: rate_limited + retry hint < 10s → falls back to generic (en)", () => {
  const out = buildWhatsAppCalendarSuffix(
    { status: "rate_limited", retry_after_ms: 3_000, retry_enqueued: true },
    "en",
  );
  assert(!out.includes("3s"), `should not quote 3s: ${out}`);
  assert(out.toLowerCase().includes("keep trying") || out.toLowerCase().includes("background"));
});

Deno.test("buildWhatsAppCalendarSuffix: rate_limited (es) → quotes seconds with localized voice", () => {
  const out = buildWhatsAppCalendarSuffix(
    { status: "rate_limited", retry_after_ms: 60_000, retry_enqueued: true },
    "es",
  );
  assert(out.includes("60s"));
  assert(out.toLowerCase().includes("limit"));
});

Deno.test("buildWhatsAppCalendarSuffix: rate_limited (it) → quotes seconds with localized voice", () => {
  const out = buildWhatsAppCalendarSuffix(
    { status: "rate_limited", retry_after_ms: 30_000, retry_enqueued: true },
    "it",
  );
  assert(out.includes("30s"));
  assert(out.toLowerCase().includes("limit"));
});

Deno.test("buildWhatsAppCalendarSuffix: rate_limited + enqueue_failed → 'try again next time' (en)", () => {
  const out = buildWhatsAppCalendarSuffix(
    { status: "rate_limited", retry_enqueued: false, enqueue_failed: true },
    "en",
  );
  assert(out.toLowerCase().includes("next time"));
  assert(out.toLowerCase().includes("rate-limit"));
});

Deno.test("buildWhatsAppCalendarSuffix: google_unavailable (en) → 'having a moment' + 'keep trying'", () => {
  const out = buildWhatsAppCalendarSuffix(
    { status: "google_unavailable", retry_enqueued: true },
    "en",
  );
  assert(out.toLowerCase().includes("having a moment"));
});

Deno.test("buildWhatsAppCalendarSuffix: google_unavailable (es) → 'teniendo problemas'", () => {
  const out = buildWhatsAppCalendarSuffix(
    { status: "google_unavailable", retry_enqueued: true },
    "es",
  );
  assert(out.toLowerCase().includes("teniendo problemas"));
});

Deno.test("buildWhatsAppCalendarSuffix: google_unavailable (it) → 'momento difficile'", () => {
  const out = buildWhatsAppCalendarSuffix(
    { status: "google_unavailable", retry_enqueued: true },
    "it",
  );
  assert(out.toLowerCase().includes("momento difficile"));
});

Deno.test("buildWhatsAppCalendarSuffix: google_unavailable + enqueue_failed (en) → 'try again next time'", () => {
  const out = buildWhatsAppCalendarSuffix(
    { status: "google_unavailable", retry_enqueued: false, enqueue_failed: true },
    "en",
  );
  assert(out.toLowerCase().includes("having a moment"));
  assert(out.toLowerCase().includes("next time"));
});

Deno.test("buildWhatsAppCalendarSuffix: enqueue_failed (en) → 'couldn't queue' + 'next time'", () => {
  const out = buildWhatsAppCalendarSuffix({ status: "enqueue_failed" }, "en");
  assert(out.toLowerCase().includes("couldn't queue") || out.toLowerCase().includes("next time"));
});

Deno.test("buildWhatsAppCalendarSuffix: enqueue_failed (es)", () => {
  const out = buildWhatsAppCalendarSuffix({ status: "enqueue_failed" }, "es");
  assert(out.toLowerCase().includes("próxima vez") || out.toLowerCase().includes("no pude programar"));
});

Deno.test("buildWhatsAppCalendarSuffix: enqueue_failed (it)", () => {
  const out = buildWhatsAppCalendarSuffix({ status: "enqueue_failed" }, "it");
  assert(out.toLowerCase().includes("riprover") || out.toLowerCase().includes("programmare"));
});

Deno.test("buildWhatsAppCalendarSuffix: google_api_error + enqueue_failed (en) → 'try again next time' + 'couldn't queue a retry'", () => {
  const out = buildWhatsAppCalendarSuffix(
    { status: "google_api_error", retry_enqueued: false, enqueue_failed: true },
    "en",
  );
  assert(out.toLowerCase().includes("next time"));
  assert(out.toLowerCase().includes("couldn't queue"));
});

Deno.test("buildWhatsAppCalendarSuffix: retry_enqueued precedence — enqueue_failed flag is ignored when retry_enqueued is true", () => {
  // Defensive: shouldn't happen in practice, but if both flags are set
  // the "retry queued" path wins. Better to over-promise a queued
  // retry than to under-promise when there actually is one.
  const out = buildWhatsAppCalendarSuffix(
    { status: "google_api_error", retry_enqueued: true, enqueue_failed: true },
    "en",
  );
  assert(out.toLowerCase().includes("keep trying") || out.toLowerCase().includes("background"));
});

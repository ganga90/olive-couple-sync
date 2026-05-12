// Tests for _shared/google-calendar.ts
//
// The HTTP verbs (POST/PATCH/DELETE) are exercised by stubbing globalThis.fetch
// so the tests don't depend on network or live OAuth tokens. The pure helpers
// (`buildEventTiming`, `tokenNeedsRefresh`) are tested directly.
//
// Contracts pinned here:
//   1. tokenNeedsRefresh fires inside the 5-minute window — keeps parity with
//      the inline logic in calendar-create-event / auto-calendar-event before
//      they migrate.
//   2. buildEventTiming produces all-day events for date-only inputs and timed
//      events with a 60-minute default duration otherwise.
//   3. patchGoogleEvent surfaces 412 as etag_conflict, other non-2xx as
//      google_api_error, network failures as google_api_error with message.
//   4. deleteGoogleEvent treats 404 / 410 as success (alreadyGone=true).

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildEventTiming,
  classifyHttpError,
  deleteGoogleEvent,
  getGoogleEvent,
  listEventsIncremental,
  parseRetryAfter,
  patchGoogleEvent,
  stopCalendarChannel,
  tokenNeedsRefresh,
  watchCalendarChannel,
  type CalendarConnection,
} from "./google-calendar.ts";

// ─── tokenNeedsRefresh ─────────────────────────────────────────────────

Deno.test("tokenNeedsRefresh: token expiring in 1 minute → refresh", () => {
  const conn: CalendarConnection = {
    id: "c1",
    access_token: "a",
    refresh_token: "r",
    token_expiry: new Date(Date.now() + 60_000).toISOString(),
    primary_calendar_id: "primary",
  };
  assertEquals(tokenNeedsRefresh(conn), true);
});

Deno.test("tokenNeedsRefresh: token expiring in 30 minutes → no refresh", () => {
  const conn: CalendarConnection = {
    id: "c1",
    access_token: "a",
    refresh_token: "r",
    token_expiry: new Date(Date.now() + 30 * 60_000).toISOString(),
    primary_calendar_id: "primary",
  };
  assertEquals(tokenNeedsRefresh(conn), false);
});

Deno.test("tokenNeedsRefresh: invalid expiry → refresh (fail safe)", () => {
  const conn: CalendarConnection = {
    id: "c1",
    access_token: "a",
    refresh_token: "r",
    token_expiry: "not-a-date",
    primary_calendar_id: "primary",
  };
  assertEquals(tokenNeedsRefresh(conn), true);
});

Deno.test("tokenNeedsRefresh: token expiring in exactly 5 minutes → refresh (boundary)", () => {
  // Border condition — the threshold is "< 5min", so exactly 5min should
  // NOT refresh, and 4:59 should. We assert the just-under-window case.
  const conn: CalendarConnection = {
    id: "c1",
    access_token: "a",
    refresh_token: "r",
    token_expiry: new Date(Date.now() + 4 * 60_000 + 59_000).toISOString(),
    primary_calendar_id: "primary",
  };
  assertEquals(tokenNeedsRefresh(conn), true);
});

// ─── buildEventTiming ──────────────────────────────────────────────────

Deno.test("buildEventTiming: date-only string → all-day, next-day end", () => {
  const r = buildEventTiming("2026-05-14", { timeZone: "America/New_York" });
  assertEquals(r.isAllDay, true);
  assertEquals(r.start.date, "2026-05-14");
  assertEquals(r.end.date, "2026-05-15");
  assertEquals(r.start.dateTime, undefined);
});

Deno.test("buildEventTiming: full ISO with time → timed event, 60min default", () => {
  const r = buildEventTiming("2026-05-14T18:00:00.000Z", { timeZone: "America/New_York" });
  assertEquals(r.isAllDay, false);
  assertEquals(r.start.dateTime, "2026-05-14T18:00:00.000Z");
  assertEquals(r.start.timeZone, "America/New_York");
  assertEquals(r.end.dateTime, "2026-05-14T19:00:00.000Z");
});

Deno.test("buildEventTiming: explicit allDay=true overrides inferred", () => {
  const r = buildEventTiming("2026-05-14T18:00:00.000Z", {
    allDay: true,
    timeZone: "UTC",
  });
  assertEquals(r.isAllDay, true);
  assert(r.start.date !== undefined);
});

Deno.test("buildEventTiming: custom duration honored", () => {
  const r = buildEventTiming("2026-05-14T18:00:00.000Z", {
    timeZone: "UTC",
    durationMinutes: 30,
  });
  assertEquals(r.end.dateTime, "2026-05-14T18:30:00.000Z");
});

// ─── patchGoogleEvent ──────────────────────────────────────────────────

function withFetchStub<T>(stub: (req: Request) => Promise<Response>, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => stub(new Request(typeof input === "string" ? input : (input as Request | URL).toString(), init));
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

Deno.test("patchGoogleEvent: 200 → ok with parsed event", async () => {
  await withFetchStub(
    async () =>
      new Response(
        JSON.stringify({
          id: "evt-1",
          etag: "v2",
          htmlLink: "https://cal/x",
          start: { dateTime: "2026-05-14T18:00:00.000Z" },
          end: { dateTime: "2026-05-14T19:00:00.000Z" },
        }),
        { status: 200 },
      ),
    async () => {
      const r = await patchGoogleEvent("token", "primary", "evt-1", {
        summary: "new title",
      });
      assertEquals(r.ok, true);
      if (r.ok) {
        assertEquals(r.value.id, "evt-1");
        assertEquals(r.value.etag, "v2");
      }
    },
  );
});

Deno.test("patchGoogleEvent: 412 → etag_conflict (caller decides retry)", async () => {
  await withFetchStub(
    async () => new Response("Precondition failed", { status: 412 }),
    async () => {
      const r = await patchGoogleEvent("token", "primary", "evt-1", {
        summary: "new title",
      });
      assertEquals(r.ok, false);
      if (!r.ok) {
        assertEquals(r.reason, "etag_conflict");
        assertEquals(r.status, 412);
      }
    },
  );
});

Deno.test("patchGoogleEvent: 500 → google_unavailable with body (Layer 1: distinguishes 5xx from generic 4xx)", async () => {
  await withFetchStub(
    async () => new Response("Internal Server Error", { status: 500 }),
    async () => {
      const r = await patchGoogleEvent("token", "primary", "evt-1", {
        summary: "new title",
      });
      assertEquals(r.ok, false);
      if (!r.ok) {
        assertEquals(r.reason, "google_unavailable");
        assertEquals(r.status, 500);
        assert(r.message?.includes("Internal Server Error"));
      }
    },
  );
});

Deno.test("patchGoogleEvent: thrown fetch error → google_api_error with message", async () => {
  await withFetchStub(
    () => Promise.reject(new Error("network down")),
    async () => {
      const r = await patchGoogleEvent("token", "primary", "evt-1", {
        summary: "new title",
      });
      assertEquals(r.ok, false);
      if (!r.ok) {
        assertEquals(r.reason, "google_api_error");
        assertEquals(r.message, "network down");
      }
    },
  );
});

Deno.test("patchGoogleEvent: etag option sets If-Match header", async () => {
  let observedIfMatch: string | null = null;
  await withFetchStub(
    async (req) => {
      observedIfMatch = req.headers.get("If-Match");
      return new Response(
        JSON.stringify({
          id: "evt-1",
          etag: "v3",
          start: { dateTime: "2026-05-14T18:00:00.000Z" },
          end: { dateTime: "2026-05-14T19:00:00.000Z" },
        }),
        { status: 200 },
      );
    },
    async () => {
      await patchGoogleEvent(
        "token",
        "primary",
        "evt-1",
        { summary: "x" },
        { etag: "v2" },
      );
    },
  );
  assertEquals(observedIfMatch, "v2");
});

// Phase 2.3 — sendUpdates query param support.

Deno.test("patchGoogleEvent: sendUpdates='all' is appended to URL", async () => {
  let observedUrl = "";
  await withFetchStub(
    async (req) => {
      observedUrl = req.url;
      return new Response(
        JSON.stringify({
          id: "evt-1",
          etag: "v2",
          start: { dateTime: "2026-05-14T18:00:00.000Z" },
          end: { dateTime: "2026-05-14T19:00:00.000Z" },
        }),
        { status: 200 },
      );
    },
    async () => {
      await patchGoogleEvent(
        "token",
        "primary",
        "evt-1",
        { summary: "x" },
        { sendUpdates: "all" },
      );
    },
  );
  assert(observedUrl.includes("sendUpdates=all"), `URL missing sendUpdates: ${observedUrl}`);
});

Deno.test("patchGoogleEvent: sendUpdates omitted → no query param", async () => {
  let observedUrl = "";
  await withFetchStub(
    async (req) => {
      observedUrl = req.url;
      return new Response(
        JSON.stringify({
          id: "evt-1",
          etag: "v2",
          start: { dateTime: "2026-05-14T18:00:00.000Z" },
          end: { dateTime: "2026-05-14T19:00:00.000Z" },
        }),
        { status: 200 },
      );
    },
    async () => {
      await patchGoogleEvent("token", "primary", "evt-1", { summary: "x" });
    },
  );
  assert(!observedUrl.includes("sendUpdates"), `URL should NOT include sendUpdates: ${observedUrl}`);
});

Deno.test("deleteGoogleEvent: sendUpdates='all' is appended to URL", async () => {
  let observedUrl = "";
  await withFetchStub(
    async (req) => {
      observedUrl = req.url;
      return new Response(null, { status: 204 });
    },
    async () => {
      await deleteGoogleEvent("token", "primary", "evt-1", { sendUpdates: "all" });
    },
  );
  assert(observedUrl.includes("sendUpdates=all"), `URL missing sendUpdates: ${observedUrl}`);
});

// Phase 2.2 — push channel helpers.

Deno.test("watchCalendarChannel: POSTs to events/watch with channel id + token + address", async () => {
  let observedUrl = "";
  const captured: { body?: Record<string, unknown> } = {};
  await withFetchStub(
    async (req) => {
      observedUrl = req.url;
      captured.body = (await req.json()) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          id: "chan-1",
          resourceId: "res-abc",
          expiration: String(Date.now() + 7 * 86400000),
        }),
        { status: 200 },
      );
    },
    async () => {
      const r = await watchCalendarChannel("tok", "primary", {
        channelId: "chan-1",
        token: "secret",
        address: "https://example.com/cb",
      });
      assertEquals(r.ok, true);
      if (r.ok) {
        assertEquals(r.value.id, "chan-1");
        assertEquals(r.value.resourceId, "res-abc");
        assert(r.value.expiration > Date.now());
      }
    },
  );
  assert(observedUrl.includes("/events/watch"));
  assertEquals(captured.body?.id, "chan-1");
  assertEquals(captured.body?.token, "secret");
  assertEquals(captured.body?.type, "web_hook");
  assertEquals(captured.body?.address, "https://example.com/cb");
});

Deno.test("watchCalendarChannel: missing expiration in response → falls back to +7d", async () => {
  const before = Date.now();
  await withFetchStub(
    async () =>
      new Response(
        JSON.stringify({ id: "c", resourceId: "r" /* no expiration */ }),
        { status: 200 },
      ),
    async () => {
      const r = await watchCalendarChannel("tok", "primary", {
        channelId: "c",
        token: "t",
        address: "https://example.com/cb",
      });
      assertEquals(r.ok, true);
      if (r.ok) {
        const diff = r.value.expiration - before;
        // ~7 days, within a generous tolerance
        assert(diff >= 7 * 86400000 - 1000 && diff <= 7 * 86400000 + 1000);
      }
    },
  );
});

Deno.test("watchCalendarChannel: 4xx → google_api_error", async () => {
  await withFetchStub(
    async () => new Response("address must be HTTPS", { status: 400 }),
    async () => {
      const r = await watchCalendarChannel("tok", "primary", {
        channelId: "c",
        token: "t",
        address: "http://insecure.example.com/cb",
      });
      assertEquals(r.ok, false);
      if (!r.ok) {
        assertEquals(r.reason, "google_api_error");
        assertEquals(r.status, 400);
      }
    },
  );
});

Deno.test("stopCalendarChannel: 204 → ok, alreadyGone=false", async () => {
  await withFetchStub(
    async () => new Response(null, { status: 204 }),
    async () => {
      const r = await stopCalendarChannel("tok", { channelId: "c", resourceId: "r" });
      assertEquals(r.ok, true);
      if (r.ok) assertEquals(r.value.alreadyGone, false);
    },
  );
});

Deno.test("stopCalendarChannel: 404 → ok, alreadyGone=true (idempotent)", async () => {
  await withFetchStub(
    async () => new Response("Not found", { status: 404 }),
    async () => {
      const r = await stopCalendarChannel("tok", { channelId: "c", resourceId: "r" });
      assertEquals(r.ok, true);
      if (r.ok) assertEquals(r.value.alreadyGone, true);
    },
  );
});

// Phase 2.2 — incremental list with syncToken.

Deno.test("listEventsIncremental: passes syncToken in query string when provided", async () => {
  let observedUrl = "";
  await withFetchStub(
    async (req) => {
      observedUrl = req.url;
      return new Response(
        JSON.stringify({ items: [], nextSyncToken: "fresh-token" }),
        { status: 200 },
      );
    },
    async () => {
      await listEventsIncremental("tok", "primary", { syncToken: "abc123" });
    },
  );
  assert(observedUrl.includes("syncToken=abc123"));
  // singleEvents=true and showDeleted=true are required for our
  // reconciler contract — pin both.
  assert(observedUrl.includes("singleEvents=true"));
  assert(observedUrl.includes("showDeleted=true"));
});

Deno.test("listEventsIncremental: 410 Gone → needsFullResync=true (caller restarts)", async () => {
  await withFetchStub(
    async () => new Response("Sync token expired", { status: 410 }),
    async () => {
      const r = await listEventsIncremental("tok", "primary", { syncToken: "old" });
      assertEquals(r.ok, true);
      if (r.ok) {
        assertEquals(r.value.needsFullResync, true);
        assertEquals(r.value.events.length, 0);
      }
    },
  );
});

Deno.test("listEventsIncremental: returns events + nextSyncToken on success", async () => {
  await withFetchStub(
    async () =>
      new Response(
        JSON.stringify({
          items: [
            { id: "e1", status: "confirmed", summary: "Meeting" },
            { id: "e2", status: "cancelled" },
          ],
          nextSyncToken: "next-tok",
        }),
        { status: 200 },
      ),
    async () => {
      const r = await listEventsIncremental("tok", "primary", { syncToken: "current" });
      assertEquals(r.ok, true);
      if (r.ok) {
        assertEquals(r.value.events.length, 2);
        assertEquals(r.value.events[1].status, "cancelled");
        assertEquals(r.value.nextSyncToken, "next-tok");
        assertEquals(r.value.needsFullResync, false);
      }
    },
  );
});

Deno.test("listEventsIncremental: returns nextPageToken when paginated", async () => {
  await withFetchStub(
    async () =>
      new Response(
        JSON.stringify({
          items: [{ id: "e1" }],
          nextPageToken: "page-2",
          // No nextSyncToken on intermediate pages
        }),
        { status: 200 },
      ),
    async () => {
      const r = await listEventsIncremental("tok", "primary", { syncToken: "x" });
      assertEquals(r.ok, true);
      if (r.ok) {
        assertEquals(r.value.nextPageToken, "page-2");
        assertEquals(r.value.nextSyncToken, null);
      }
    },
  );
});

// ─── deleteGoogleEvent ─────────────────────────────────────────────────

Deno.test("deleteGoogleEvent: 204 → ok, alreadyGone=false", async () => {
  await withFetchStub(
    async () => new Response(null, { status: 204 }),
    async () => {
      const r = await deleteGoogleEvent("token", "primary", "evt-1");
      assertEquals(r.ok, true);
      if (r.ok) assertEquals(r.value.alreadyGone, false);
    },
  );
});

Deno.test("deleteGoogleEvent: 404 → ok, alreadyGone=true (idempotent)", async () => {
  await withFetchStub(
    async () => new Response("Not found", { status: 404 }),
    async () => {
      const r = await deleteGoogleEvent("token", "primary", "evt-1");
      assertEquals(r.ok, true);
      if (r.ok) assertEquals(r.value.alreadyGone, true);
    },
  );
});

Deno.test("deleteGoogleEvent: 410 → ok, alreadyGone=true (resource gone)", async () => {
  await withFetchStub(
    async () => new Response("Gone", { status: 410 }),
    async () => {
      const r = await deleteGoogleEvent("token", "primary", "evt-1");
      assertEquals(r.ok, true);
      if (r.ok) assertEquals(r.value.alreadyGone, true);
    },
  );
});

Deno.test("deleteGoogleEvent: 500 → google_unavailable (Layer 1: distinguishes 5xx from generic 4xx)", async () => {
  await withFetchStub(
    async () => new Response("ISE", { status: 500 }),
    async () => {
      const r = await deleteGoogleEvent("token", "primary", "evt-1");
      assertEquals(r.ok, false);
      if (!r.ok) {
        assertEquals(r.reason, "google_unavailable");
        assertEquals(r.status, 500);
      }
    },
  );
});

// ─── classifyHttpError ─────────────────────────────────────────────────
// Pure function — no fetch stub needed. The point of this test block is
// to pin the mapping per status code so a future change can't quietly
// re-collapse them into google_api_error (which is what Phase 1.5
// originally did, and what made the 2026-05-12 incident invisible).

Deno.test("classifyHttpError: 401 → auth_expired", () => {
  assertEquals(classifyHttpError(401), "auth_expired");
});

Deno.test("classifyHttpError: 403 → scope_insufficient", () => {
  assertEquals(classifyHttpError(403), "scope_insufficient");
});

Deno.test("classifyHttpError: 404 → event_not_found", () => {
  assertEquals(classifyHttpError(404), "event_not_found");
});

Deno.test("classifyHttpError: 410 → event_not_found (Gone == same caller action as 404)", () => {
  assertEquals(classifyHttpError(410), "event_not_found");
});

Deno.test("classifyHttpError: 429 → rate_limited", () => {
  assertEquals(classifyHttpError(429), "rate_limited");
});

Deno.test("classifyHttpError: 500/502/503/504 → google_unavailable", () => {
  assertEquals(classifyHttpError(500), "google_unavailable");
  assertEquals(classifyHttpError(502), "google_unavailable");
  assertEquals(classifyHttpError(503), "google_unavailable");
  assertEquals(classifyHttpError(504), "google_unavailable");
});

Deno.test("classifyHttpError: 400/418/451 → google_api_error (unclassified 4xx)", () => {
  // These don't have a recovery path of their own. Generic bucket so the
  // caller still retries (Layer 3 treats google_api_error as transient)
  // but doesn't pretend it has structured information about them.
  assertEquals(classifyHttpError(400), "google_api_error");
  assertEquals(classifyHttpError(418), "google_api_error");
  assertEquals(classifyHttpError(451), "google_api_error");
});

Deno.test("classifyHttpError: 412 is NOT classified here — it's special-cased at the call site", () => {
  // 412 only arises when the caller sent If-Match. We treat etag_conflict
  // as caller-controlled, not a server condition — see the comment in
  // patchGoogleEvent for the reasoning.
  assertEquals(classifyHttpError(412), "google_api_error");
});

// ─── parseRetryAfter ───────────────────────────────────────────────────
// Google's Retry-After can arrive as either delta-seconds or HTTP-date.
// Parser is conservative: anything malformed or in the past returns
// undefined so the caller falls back to the default backoff schedule.

Deno.test("parseRetryAfter: delta-seconds '30' → 30000 ms", () => {
  assertEquals(parseRetryAfter("30"), 30_000);
});

Deno.test("parseRetryAfter: delta-seconds '0' → 0 ms (Google is asking us to retry now)", () => {
  assertEquals(parseRetryAfter("0"), 0);
});

Deno.test("parseRetryAfter: whitespace around delta-seconds is trimmed", () => {
  assertEquals(parseRetryAfter("  45  "), 45_000);
});

Deno.test("parseRetryAfter: HTTP-date in the future → delta ms from now", () => {
  const now = Date.parse("2026-05-12T12:00:00Z");
  const future = "Tue, 12 May 2026 12:00:30 GMT"; // 30s after now
  const got = parseRetryAfter(future, now);
  assert(got !== undefined);
  assertEquals(got, 30_000);
});

Deno.test("parseRetryAfter: HTTP-date in the past → undefined (we don't time-travel)", () => {
  const now = Date.parse("2026-05-12T12:00:00Z");
  const past = "Tue, 12 May 2026 11:59:00 GMT"; // 60s before now
  assertEquals(parseRetryAfter(past, now), undefined);
});

Deno.test("parseRetryAfter: null/empty/garbage → undefined", () => {
  assertEquals(parseRetryAfter(null), undefined);
  assertEquals(parseRetryAfter(undefined), undefined);
  assertEquals(parseRetryAfter(""), undefined);
  assertEquals(parseRetryAfter("   "), undefined);
  assertEquals(parseRetryAfter("not a date"), undefined);
});

Deno.test("parseRetryAfter: negative delta-seconds → undefined (RFC violators ignored)", () => {
  // Not a real-world case but pin behavior anyway — the regex rejects
  // anything that isn't pure digits, so '-5' is treated as garbage.
  assertEquals(parseRetryAfter("-5"), undefined);
});

// ─── patchGoogleEvent: classified failure paths ────────────────────────
// One test per HTTP class. The point of having all of these on patchGoogleEvent
// (rather than spreading across patch/delete/get) is to pin the
// classifier integration in one verb's tests — they all share the same
// !res.ok branch logic.

Deno.test("patchGoogleEvent: 401 → auth_expired (user needs reconnect)", async () => {
  await withFetchStub(
    async () => new Response("Token expired", { status: 401 }),
    async () => {
      const r = await patchGoogleEvent("token", "primary", "evt-1", { summary: "x" });
      assertEquals(r.ok, false);
      if (!r.ok) {
        assertEquals(r.reason, "auth_expired");
        assertEquals(r.status, 401);
      }
    },
  );
});

Deno.test("patchGoogleEvent: 403 → scope_insufficient (OAuth scope doesn't cover this)", async () => {
  await withFetchStub(
    async () => new Response("Insufficient scope", { status: 403 }),
    async () => {
      const r = await patchGoogleEvent("token", "primary", "evt-1", { summary: "x" });
      assertEquals(r.ok, false);
      if (!r.ok) {
        assertEquals(r.reason, "scope_insufficient");
        assertEquals(r.status, 403);
      }
    },
  );
});

Deno.test("patchGoogleEvent: 404 → event_not_found (target event vanished on Google side)", async () => {
  await withFetchStub(
    async () => new Response("Not Found", { status: 404 }),
    async () => {
      const r = await patchGoogleEvent("token", "primary", "evt-1", { summary: "x" });
      assertEquals(r.ok, false);
      if (!r.ok) {
        assertEquals(r.reason, "event_not_found");
        assertEquals(r.status, 404);
      }
    },
  );
});

Deno.test("patchGoogleEvent: 410 → event_not_found (Gone has the same semantics as 404)", async () => {
  await withFetchStub(
    async () => new Response("Gone", { status: 410 }),
    async () => {
      const r = await patchGoogleEvent("token", "primary", "evt-1", { summary: "x" });
      assertEquals(r.ok, false);
      if (!r.ok) {
        assertEquals(r.reason, "event_not_found");
        assertEquals(r.status, 410);
      }
    },
  );
});

Deno.test("patchGoogleEvent: 429 with Retry-After: '90' → rate_limited + retry_after_ms=90000", async () => {
  await withFetchStub(
    async () =>
      new Response("Rate limited", {
        status: 429,
        headers: { "Retry-After": "90" },
      }),
    async () => {
      const r = await patchGoogleEvent("token", "primary", "evt-1", { summary: "x" });
      assertEquals(r.ok, false);
      if (!r.ok) {
        assertEquals(r.reason, "rate_limited");
        assertEquals(r.status, 429);
        assertEquals(r.retry_after_ms, 90_000);
      }
    },
  );
});

Deno.test("patchGoogleEvent: 429 with no Retry-After → rate_limited + retry_after_ms undefined", async () => {
  await withFetchStub(
    async () => new Response("Rate limited", { status: 429 }),
    async () => {
      const r = await patchGoogleEvent("token", "primary", "evt-1", { summary: "x" });
      assertEquals(r.ok, false);
      if (!r.ok) {
        assertEquals(r.reason, "rate_limited");
        assertEquals(r.retry_after_ms, undefined);
      }
    },
  );
});

Deno.test("patchGoogleEvent: retry_after_ms is only set on 429 (other statuses don't carry it)", async () => {
  // A Retry-After header on a 500 is unusual but allowed by RFC.
  // Confirm we don't accidentally parse it for non-429 statuses —
  // doing so would change the queue's next_attempt_at semantics for
  // statuses that aren't governed by Google's hint.
  await withFetchStub(
    async () =>
      new Response("ISE", {
        status: 500,
        headers: { "Retry-After": "120" },
      }),
    async () => {
      const r = await patchGoogleEvent("token", "primary", "evt-1", { summary: "x" });
      assertEquals(r.ok, false);
      if (!r.ok) {
        assertEquals(r.reason, "google_unavailable");
        assertEquals(r.retry_after_ms, undefined);
      }
    },
  );
});

// ─── deleteGoogleEvent: classified failure paths ───────────────────────
// 404/410 still map to ok+alreadyGone — see the comment on deleteGoogleEvent.
// The 401/403/429 paths walk through the classifier just like PATCH.

Deno.test("deleteGoogleEvent: 401 → auth_expired (not alreadyGone)", async () => {
  await withFetchStub(
    async () => new Response("Token expired", { status: 401 }),
    async () => {
      const r = await deleteGoogleEvent("token", "primary", "evt-1");
      assertEquals(r.ok, false);
      if (!r.ok) {
        assertEquals(r.reason, "auth_expired");
        assertEquals(r.status, 401);
      }
    },
  );
});

Deno.test("deleteGoogleEvent: 429 with Retry-After → rate_limited + retry_after_ms", async () => {
  await withFetchStub(
    async () =>
      new Response("Slow down", {
        status: 429,
        headers: { "Retry-After": "60" },
      }),
    async () => {
      const r = await deleteGoogleEvent("token", "primary", "evt-1");
      assertEquals(r.ok, false);
      if (!r.ok) {
        assertEquals(r.reason, "rate_limited");
        assertEquals(r.retry_after_ms, 60_000);
      }
    },
  );
});

// ─── getGoogleEvent: classified failure paths ──────────────────────────
// getGoogleEvent is called pre-mutation (attendee check). A 404 here
// used to be coerced to a generic error message — now it's properly
// classified, which lets calendar-update-event detect "event already
// gone on Google" before issuing the PATCH.

Deno.test("getGoogleEvent: 404 → event_not_found (was generic google_api_error before Layer 1)", async () => {
  await withFetchStub(
    async () => new Response("Not Found", { status: 404 }),
    async () => {
      const r = await getGoogleEvent("token", "primary", "evt-1");
      assertEquals(r.ok, false);
      if (!r.ok) {
        assertEquals(r.reason, "event_not_found");
        assertEquals(r.status, 404);
      }
    },
  );
});

Deno.test("getGoogleEvent: 401 → auth_expired", async () => {
  await withFetchStub(
    async () => new Response("Unauthorized", { status: 401 }),
    async () => {
      const r = await getGoogleEvent("token", "primary", "evt-1");
      assertEquals(r.ok, false);
      if (!r.ok) {
        assertEquals(r.reason, "auth_expired");
      }
    },
  );
});

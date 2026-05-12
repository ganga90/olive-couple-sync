// _shared/google-calendar.ts
//
// One place that talks to Google Calendar. Previously the token-refresh
// dance and the API contract were copy-pasted across calendar-create-event
// and auto-calendar-event, and a third path (calendar-update-event) was
// missing entirely — so chat "rescheduling" silently lied. This module is
// the single source of truth for: looking up the active connection,
// keeping the OAuth token fresh, and issuing the three event verbs we
// support today (POST / PATCH / DELETE).
//
// Everything here is intentionally pure-ish: helpers take a Supabase
// client + a CalendarConnection, never reach into request scope, never
// throw on "expected" Google statuses (404 on delete, 412 on stale etag),
// and return discriminated results so callers can report sync state
// honestly to the user instead of pretending success.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ─── Types ─────────────────────────────────────────────────────────────

export interface CalendarConnection {
  id: string;
  user_id?: string;
  access_token: string;
  refresh_token: string;
  token_expiry: string;
  primary_calendar_id: string;
  is_active?: boolean;
  auto_add_to_calendar?: boolean;
}

export interface LinkedCalendarEvent {
  id: string;
  connection_id: string;
  google_event_id: string;
  etag: string | null;
  title: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  timezone: string | null;
  note_id: string | null;
}

export interface GoogleEventTime {
  date?: string;        // YYYY-MM-DD for all-day
  dateTime?: string;    // RFC3339 for timed
  timeZone?: string;
}

export interface GoogleEventPatch {
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{ method: "popup" | "email"; minutes: number }>;
  };
}

export interface GoogleEventResponse {
  id: string;
  etag?: string;
  htmlLink?: string;
  start: GoogleEventTime;
  end: GoogleEventTime;
  summary?: string;
  description?: string;
  location?: string;
  // Phase 2.3 — surfaced from Google so callers can decide whether to
  // pass sendUpdates on subsequent mutations. Only populated when the
  // event actually has attendees; absent or [] otherwise.
  attendees?: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: string;
    organizer?: boolean;
    self?: boolean;
  }>;
}

// Phase 2.3 — Google's notification policy on a write. Per their API:
//   - "all": email all attendees (Calendar's UI default for moves)
//   - "externalOnly": only attendees outside the user's domain
//   - "none": no email at all
// Default we want when an event has attendees is "all" — moving a
// meeting silently on people is bad form.
export type SendUpdatesPolicy = "all" | "externalOnly" | "none";

// Failure reasons returned by the Google Calendar helpers. The original
// (Phase 1.5) set collapsed every non-2xx response into "google_api_error",
// which meant callers couldn't distinguish "user needs to reconnect"
// (401/403 — permanent until the user does something) from "Google's
// rate-limiting us right now" (429 — transient with a Retry-After header)
// from "Google is down" (5xx — transient but unbounded) from "the event
// you're trying to update doesn't exist anymore" (404/410 — terminal
// success for delete, terminal already-gone for update). Layer 2 of the
// 2026-05-12 fix walks the reasons through each edge function to do the
// right thing per class.
export type CalendarFailureReason =
  | "not_connected"
  | "no_linked_event"
  | "token_refresh_failed"
  | "etag_conflict"
  | "event_not_found"        // 404/410 — event gone from Google's side
  | "auth_expired"           // 401 — access token rejected by Google
  | "scope_insufficient"     // 403 — OAuth scope doesn't cover this action
  | "rate_limited"           // 429 — retry per Retry-After header
  | "google_unavailable"     // 5xx — retry with backoff
  | "google_api_error"       // anything else (4xx without a more specific class)
  | "missing_input";

export interface CalendarOk<T> {
  ok: true;
  value: T;
}
export interface CalendarErr {
  ok: false;
  reason: CalendarFailureReason;
  status?: number;
  message?: string;
  // When `reason === "rate_limited"` and Google sent a Retry-After header,
  // this carries the parsed milliseconds. Callers should pass this through
  // to `enqueueRetry` so the next-attempt time honors Google's hint
  // instead of using our generic 30s backoff (which would just trip the
  // same rate limit again).
  retry_after_ms?: number;
}
export type CalendarResult<T> = CalendarOk<T> | CalendarErr;

// Map an HTTP status code from a Google Calendar API response to the
// CalendarFailureReason that best describes what the caller should do
// about it. The intent here is *prescriptive* — each reason maps to a
// distinct recovery path in calendar-update-event / calendar-delete-event.
//
// Not in this map: 412 (etag_conflict). That's handled separately at the
// call site because etag presence on the request is what makes the 412
// possible — it's a caller-controlled outcome, not a server condition.
export function classifyHttpError(status: number): CalendarFailureReason {
  if (status === 401) return "auth_expired";
  if (status === 403) return "scope_insufficient";
  if (status === 404 || status === 410) return "event_not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500 && status < 600) return "google_unavailable";
  return "google_api_error";
}

// Parse a Retry-After header value (either a delta-seconds integer or an
// HTTP-date) into milliseconds-from-now. Returns undefined if the header
// is absent, malformed, or in the past. Google occasionally sends both
// forms — we accept either to be conservative.
export function parseRetryAfter(header: string | null | undefined, nowMs: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed) return undefined;
  // Delta-seconds — RFC 7231 §7.1.3 says non-negative integer.
  if (/^\d+$/.test(trimmed)) {
    const sec = parseInt(trimmed, 10);
    if (!Number.isFinite(sec) || sec < 0) return undefined;
    return sec * 1000;
  }
  // HTTP-date.
  const targetMs = Date.parse(trimmed);
  if (!Number.isFinite(targetMs)) return undefined;
  const deltaMs = targetMs - nowMs;
  return deltaMs > 0 ? deltaMs : undefined;
}

// ─── Connection lookup ────────────────────────────────────────────────

export async function getActiveCalendarConnection(
  supabase: SupabaseClient,
  userId: string,
): Promise<CalendarConnection | null> {
  const { data, error } = await supabase
    .from("calendar_connections")
    .select(
      "id, user_id, access_token, refresh_token, token_expiry, primary_calendar_id, is_active, auto_add_to_calendar",
    )
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return null;
  return data as CalendarConnection;
}

// Look up the local mirror row for a Google event linked to a clerk_notes
// row. Returns null when the note was never auto-added (user had auto-add
// off, or never connected the calendar at the time of capture).
export async function findLinkedEventByNoteId(
  supabase: SupabaseClient,
  noteId: string,
  connectionId: string,
): Promise<LinkedCalendarEvent | null> {
  const { data, error } = await supabase
    .from("calendar_events")
    .select(
      "id, connection_id, google_event_id, etag, title, start_time, end_time, all_day, timezone, note_id",
    )
    .eq("connection_id", connectionId)
    .eq("note_id", noteId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as LinkedCalendarEvent;
}

// ─── Connection health ────────────────────────────────────────────────
//
// The two reasons calendar-update-event and calendar-delete-event can't
// recover from on their own — auth_expired (401) and scope_insufficient
// (403) — get persisted to `calendar_connections.health_status` so the
// UI can render a reconnect banner. The user has to take an action to
// fix this; no amount of retrying with the same OAuth tokens will help.
//
// `markConnectionHealthy` is the inverse: when a write actually
// succeeds, clear stale flags so the banner goes away. The .neq() guard
// keeps this from churning `last_health_change_at` on every successful
// write — the timestamp only moves when the status actually transitions.

export type ConnectionHealthStatus =
  | "healthy"
  | "auth_expired"
  | "scope_insufficient"
  | "persistently_failing";

// Truncate health_message to match the column's documented contract
// (free-form operator diagnosis text; not user-facing). Same MAX_ERR_LEN
// as calendar-sync-logger.ts for consistency.
const MAX_HEALTH_MESSAGE_LEN = 500;

export async function markConnectionUnhealthy(
  supabase: SupabaseClient,
  connectionId: string,
  reason: Exclude<ConnectionHealthStatus, "healthy">,
  message?: string,
): Promise<void> {
  const trimmed = message ? message.slice(0, MAX_HEALTH_MESSAGE_LEN) : null;
  const { error } = await supabase
    .from("calendar_connections")
    .update({
      health_status: reason,
      last_health_change_at: new Date().toISOString(),
      health_message: trimmed,
    })
    .eq("id", connectionId);
  if (error) {
    console.warn(
      "[google-calendar] markConnectionUnhealthy failed (non-fatal):",
      error.message,
    );
  }
}

export async function markConnectionHealthy(
  supabase: SupabaseClient,
  connectionId: string,
): Promise<void> {
  // `.neq("health_status", "healthy")` guarantees we only write — and
  // therefore only bump `last_health_change_at` — when the row's status
  // actually transitions. Without this, every successful PATCH would
  // refresh the timestamp on a healthy connection, making the column
  // useless for "when did this user last have a problem" queries.
  const { error } = await supabase
    .from("calendar_connections")
    .update({
      health_status: "healthy",
      last_health_change_at: new Date().toISOString(),
      health_message: null,
    })
    .eq("id", connectionId)
    .neq("health_status", "healthy");
  if (error) {
    console.warn(
      "[google-calendar] markConnectionHealthy failed (non-fatal):",
      error.message,
    );
  }
}

// ─── Token refresh ────────────────────────────────────────────────────

// Refresh threshold: if the token expires within 5 minutes, refresh.
// Matches the original behavior in calendar-create-event and
// auto-calendar-event so semantics don't drift when those functions
// migrate to this helper.
const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;

export function tokenNeedsRefresh(connection: CalendarConnection, nowMs: number = Date.now()): boolean {
  const expiry = new Date(connection.token_expiry).getTime();
  if (!Number.isFinite(expiry)) return true;
  return expiry - nowMs < TOKEN_REFRESH_WINDOW_MS;
}

// Ensure the connection has a fresh access token. Persists the refreshed
// token back to calendar_connections so subsequent invocations in the
// same request reuse it. On failure, marks the connection inactive so the
// app can prompt the user to reconnect — same recovery semantics as
// auto-calendar-event today.
export async function ensureFreshAccessToken(
  supabase: SupabaseClient,
  connection: CalendarConnection,
): Promise<CalendarResult<string>> {
  if (!tokenNeedsRefresh(connection)) {
    return { ok: true, value: connection.access_token };
  }

  const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      reason: "token_refresh_failed",
      message: "Missing GOOGLE_CALENDAR_CLIENT_ID / GOOGLE_CALENDAR_CLIENT_SECRET",
    };
  }

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: connection.refresh_token,
        grant_type: "refresh_token",
      }),
    });
  } catch (err) {
    return {
      ok: false,
      reason: "token_refresh_failed",
      message: err instanceof Error ? err.message : "fetch failed",
    };
  }

  if (!tokenResponse.ok) {
    const body = await safeReadBody(tokenResponse);
    await supabase
      .from("calendar_connections")
      .update({ is_active: false, error_message: "Token refresh failed" })
      .eq("id", connection.id);
    return { ok: false, reason: "token_refresh_failed", status: tokenResponse.status, message: body };
  }

  const newTokens = await tokenResponse.json();
  const accessToken: string = newTokens.access_token;
  const expiresInSec: number = newTokens.expires_in ?? 3600;

  await supabase
    .from("calendar_connections")
    .update({
      access_token: accessToken,
      token_expiry: new Date(Date.now() + expiresInSec * 1000).toISOString(),
      error_message: null,
    })
    .eq("id", connection.id);

  return { ok: true, value: accessToken };
}

// ─── Timing helpers ────────────────────────────────────────────────────

// Build the start/end fields of a Google event from a clerk_notes-style
// payload. Olive stores either:
//   - reminder_time (full ISO timestamp) → timed event
//   - due_date only (YYYY-MM-DD) → all-day event
// Callers should prefer reminder_time over due_date and pass `allDay`
// explicitly when known. Default event length is 60 minutes — matches
// the existing behavior in calendar-create-event.
export function buildEventTiming(
  startIso: string,
  options: { allDay?: boolean; timeZone: string; durationMinutes?: number } = {
    timeZone: "UTC",
  },
): { start: GoogleEventTime; end: GoogleEventTime; isAllDay: boolean } {
  const { allDay, timeZone, durationMinutes = 60 } = options;
  const isAllDayInferred =
    allDay ?? (startIso.length <= 10 || startIso.endsWith("T00:00:00.000Z"));
  const startDate = new Date(startIso);

  if (isAllDayInferred) {
    const dayStr = startIso.length <= 10 ? startIso : startDate.toISOString().split("T")[0];
    const nextDay = new Date(`${dayStr}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    return {
      start: { date: dayStr },
      end: { date: nextDay.toISOString().split("T")[0] },
      isAllDay: true,
    };
  }

  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
  return {
    start: { dateTime: startDate.toISOString(), timeZone },
    end: { dateTime: endDate.toISOString(), timeZone },
    isAllDay: false,
  };
}

// ─── Google Calendar API verbs ────────────────────────────────────────

const GOOGLE_CAL_BASE = "https://www.googleapis.com/calendar/v3/calendars";

// POST /calendars/{calId}/events
export async function createGoogleEvent(
  accessToken: string,
  calendarId: string,
  event: GoogleEventPatch,
): Promise<CalendarResult<GoogleEventResponse>> {
  let res: Response;
  try {
    res = await fetch(`${GOOGLE_CAL_BASE}/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });
  } catch (err) {
    return {
      ok: false,
      reason: "google_api_error",
      message: err instanceof Error ? err.message : "fetch failed",
    };
  }

  if (!res.ok) {
    const body = await safeReadBody(res);
    const reason = classifyHttpError(res.status);
    const retry_after_ms = reason === "rate_limited"
      ? parseRetryAfter(res.headers.get("Retry-After"))
      : undefined;
    return { ok: false, reason, status: res.status, message: body, retry_after_ms };
  }

  const data = (await res.json()) as GoogleEventResponse;
  return { ok: true, value: data };
}

// GET /calendars/{calId}/events/{eventId}
//
// Used pre-mutation to check whether the event has attendees, so the
// caller can pick the right `sendUpdates` policy. Cheap one-shot read;
// alternative would be storing attendee count in the local
// calendar_events mirror, but that drifts whenever the user adds
// attendees via Google's UI without our seeing it.
export async function getGoogleEvent(
  accessToken: string,
  calendarId: string,
  googleEventId: string,
): Promise<CalendarResult<GoogleEventResponse>> {
  let res: Response;
  try {
    res = await fetch(
      `${GOOGLE_CAL_BASE}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
      { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
    );
  } catch (err) {
    return {
      ok: false,
      reason: "google_api_error",
      message: err instanceof Error ? err.message : "fetch failed",
    };
  }
  if (!res.ok) {
    const body = await safeReadBody(res);
    const reason = classifyHttpError(res.status);
    const retry_after_ms = reason === "rate_limited"
      ? parseRetryAfter(res.headers.get("Retry-After"))
      : undefined;
    return { ok: false, reason, status: res.status, message: body, retry_after_ms };
  }
  const data = (await res.json()) as GoogleEventResponse;
  return { ok: true, value: data };
}

// PATCH /calendars/{calId}/events/{eventId}
//
// `etag` enables optimistic concurrency — Google returns 412 if the
// remote event was modified since we last fetched it. Callers can either
// surface the conflict to the user or retry with `etag` omitted (last-
// write-wins). We default to last-write-wins because Olive's source of
// truth for events created from notes is clerk_notes — if the user
// edited the event externally and then edits the task in Olive, the
// user's most recent intent should win.
//
// `sendUpdates` is forwarded as a query param. When the event has
// attendees, callers should pass 'all' so the meeting move actually
// notifies the people on it. Defaults to undefined (Google's default,
// which is 'none' on PATCH per their API docs).
export async function patchGoogleEvent(
  accessToken: string,
  calendarId: string,
  googleEventId: string,
  patch: GoogleEventPatch,
  options: { etag?: string; sendUpdates?: SendUpdatesPolicy } = {},
): Promise<CalendarResult<GoogleEventResponse>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  if (options.etag) headers["If-Match"] = options.etag;

  const url = options.sendUpdates
    ? `${GOOGLE_CAL_BASE}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}?sendUpdates=${options.sendUpdates}`
    : `${GOOGLE_CAL_BASE}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`;

  let res: Response;
  try {
    res = await fetch(url, { method: "PATCH", headers, body: JSON.stringify(patch) });
  } catch (err) {
    return {
      ok: false,
      reason: "google_api_error",
      message: err instanceof Error ? err.message : "fetch failed",
    };
  }

  // 412 stays special-cased here (not in classifyHttpError) because it's
  // only meaningful when the caller sent an If-Match header — it's
  // caller-controlled, not a server condition. Without that header the
  // server can't return 412 in the first place.
  if (res.status === 412) {
    return { ok: false, reason: "etag_conflict", status: 412 };
  }

  if (!res.ok) {
    const body = await safeReadBody(res);
    const reason = classifyHttpError(res.status);
    const retry_after_ms = reason === "rate_limited"
      ? parseRetryAfter(res.headers.get("Retry-After"))
      : undefined;
    return { ok: false, reason, status: res.status, message: body, retry_after_ms };
  }

  const data = (await res.json()) as GoogleEventResponse;
  return { ok: true, value: data };
}

// DELETE /calendars/{calId}/events/{eventId}
//
// 404 is treated as success: the event is already gone (user deleted it
// from the Google UI, or a previous request half-completed). Either way
// the desired terminal state is reached.
//
// `sendUpdates` follows the same policy as PATCH — when the event has
// attendees, passing 'all' notifies them of the cancellation.
export async function deleteGoogleEvent(
  accessToken: string,
  calendarId: string,
  googleEventId: string,
  options: { sendUpdates?: SendUpdatesPolicy } = {},
): Promise<CalendarResult<{ alreadyGone: boolean }>> {
  const url = options.sendUpdates
    ? `${GOOGLE_CAL_BASE}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}?sendUpdates=${options.sendUpdates}`
    : `${GOOGLE_CAL_BASE}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    return {
      ok: false,
      reason: "google_api_error",
      message: err instanceof Error ? err.message : "fetch failed",
    };
  }

  // DELETE 404/410 stays a terminal-success: the event we wanted to
  // delete is already gone, so the desired state is reached. This is
  // unlike PATCH 404, where event-not-found means the *change* the user
  // asked for couldn't land.
  if (res.status === 404 || res.status === 410) {
    return { ok: true, value: { alreadyGone: true } };
  }

  if (!res.ok && res.status !== 204) {
    const body = await safeReadBody(res);
    const reason = classifyHttpError(res.status);
    const retry_after_ms = reason === "rate_limited"
      ? parseRetryAfter(res.headers.get("Retry-After"))
      : undefined;
    return { ok: false, reason, status: res.status, message: body, retry_after_ms };
  }

  return { ok: true, value: { alreadyGone: false } };
}

// ─── Watch channels (Phase 2.2) ──────────────────────────────────────

// Register a push notification channel on a calendar. Google will POST
// to `address` whenever an event on that calendar changes. The id +
// token we send back become the credentials we authenticate inbound
// callbacks with — token is verified via the `X-Goog-Channel-Token`
// header.
//
// `address` MUST be HTTPS and publicly reachable; the Supabase edge
// function URL (with verify_jwt=false in config.toml) satisfies both.
//
// Returns the channel record with the Google-assigned `resourceId`
// (the opaque handle we'll use to stop or refresh the channel) and
// expiration timestamp in milliseconds-since-epoch.
export interface WatchChannelRegistration {
  id: string;
  resourceId: string;
  expiration: number; // ms since epoch
}

export async function watchCalendarChannel(
  accessToken: string,
  calendarId: string,
  args: {
    channelId: string;      // we generate (UUID v4)
    token: string;          // we generate (random secret)
    address: string;        // our callback URL
    // Optional expiration override (ms since epoch). Google caps at
    // 30 days; omit to use Google's default (~7 days at time of
    // writing). Callers can shorten for testing or extend for
    // long-lived channels.
    expirationMs?: number;
  },
): Promise<CalendarResult<WatchChannelRegistration>> {
  const body: Record<string, unknown> = {
    id: args.channelId,
    type: "web_hook",
    address: args.address,
    token: args.token,
  };
  if (args.expirationMs) body.expiration = String(args.expirationMs);

  let res: Response;
  try {
    res = await fetch(
      `${GOOGLE_CAL_BASE}/${encodeURIComponent(calendarId)}/events/watch`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
  } catch (err) {
    return {
      ok: false,
      reason: "google_api_error",
      message: err instanceof Error ? err.message : "fetch failed",
    };
  }

  if (!res.ok) {
    const text = await safeReadBody(res);
    return { ok: false, reason: "google_api_error", status: res.status, message: text };
  }

  const data = (await res.json()) as {
    id: string;
    resourceId: string;
    expiration?: string;
  };
  return {
    ok: true,
    value: {
      id: data.id,
      resourceId: data.resourceId,
      // Google returns expiration as a string milliseconds-since-epoch.
      // Fallback for the corner case where Google omits it (shouldn't
      // happen for web_hook but defensive): default to +7 days.
      expiration: data.expiration
        ? parseInt(data.expiration, 10)
        : Date.now() + 7 * 24 * 60 * 60 * 1000,
    },
  };
}

// Stop a previously-registered channel. Required when:
//   - User disconnects calendar
//   - We re-register on renewal (stop old, then register new)
//
// 404 is treated as success (channel already gone — the desired
// terminal state is reached). Same idempotency posture as
// deleteGoogleEvent.
export async function stopCalendarChannel(
  accessToken: string,
  args: { channelId: string; resourceId: string },
): Promise<CalendarResult<{ alreadyGone: boolean }>> {
  let res: Response;
  try {
    res = await fetch(
      "https://www.googleapis.com/calendar/v3/channels/stop",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: args.channelId, resourceId: args.resourceId }),
      },
    );
  } catch (err) {
    return {
      ok: false,
      reason: "google_api_error",
      message: err instanceof Error ? err.message : "fetch failed",
    };
  }

  if (res.status === 404 || res.status === 410) {
    return { ok: true, value: { alreadyGone: true } };
  }

  if (!res.ok && res.status !== 204) {
    const text = await safeReadBody(res);
    return { ok: false, reason: "google_api_error", status: res.status, message: text };
  }
  return { ok: true, value: { alreadyGone: false } };
}

// Incremental events.list — fetches changes since `syncToken`. Used
// from the push callback to pick up exactly what changed.
//
// Google's contract:
//   - First call has no syncToken; returns the full window + a
//     nextSyncToken.
//   - Subsequent calls pass syncToken; return only changed events +
//     a fresh nextSyncToken.
//   - If the token is too old (>30 days), Google returns 410 Gone —
//     callers fall back to a full sync.
//   - Pagination via nextPageToken when there are >250 changes.
//
// Returns the full event list + the new sync token. Caller stores the
// token in calendar_sync_state.sync_token for the next call.
export interface IncrementalEventsPage {
  events: Array<{
    id: string;
    status?: "confirmed" | "tentative" | "cancelled";
    etag?: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: GoogleEventTime;
    end?: GoogleEventTime;
    attendees?: Array<{ email?: string; responseStatus?: string }>;
    updated?: string;
  }>;
  nextSyncToken: string | null;
  nextPageToken: string | null;
  // True when Google returned 410 Gone — caller must restart with a
  // full sync (omit syncToken).
  needsFullResync: boolean;
}

export async function listEventsIncremental(
  accessToken: string,
  calendarId: string,
  args: { syncToken?: string; pageToken?: string; maxResults?: number },
): Promise<CalendarResult<IncrementalEventsPage>> {
  const params = new URLSearchParams();
  if (args.syncToken) params.set("syncToken", args.syncToken);
  if (args.pageToken) params.set("pageToken", args.pageToken);
  params.set("maxResults", String(args.maxResults ?? 250));
  // Show cancelled events so we can mirror deletions, not just edits.
  params.set("showDeleted", "true");
  // singleEvents=true expands recurring series into their instances —
  // matches the contract our calendar_events table assumes (one row
  // per instance, not per series).
  params.set("singleEvents", "true");

  let res: Response;
  try {
    res = await fetch(
      `${GOOGLE_CAL_BASE}/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
    );
  } catch (err) {
    return {
      ok: false,
      reason: "google_api_error",
      message: err instanceof Error ? err.message : "fetch failed",
    };
  }

  // 410 Gone — syncToken expired. Signal to the caller to fall back
  // to a full sync (drop the token, refetch from scratch).
  if (res.status === 410) {
    return {
      ok: true,
      value: { events: [], nextSyncToken: null, nextPageToken: null, needsFullResync: true },
    };
  }

  if (!res.ok) {
    const text = await safeReadBody(res);
    return { ok: false, reason: "google_api_error", status: res.status, message: text };
  }

  const data = await res.json() as {
    items?: IncrementalEventsPage["events"];
    nextSyncToken?: string;
    nextPageToken?: string;
  };
  return {
    ok: true,
    value: {
      events: data.items ?? [],
      nextSyncToken: data.nextSyncToken ?? null,
      nextPageToken: data.nextPageToken ?? null,
      needsFullResync: false,
    },
  };
}

// ─── Utility ──────────────────────────────────────────────────────────

async function safeReadBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

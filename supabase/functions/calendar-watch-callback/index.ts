// calendar-watch-callback
// ─────────────────────────────────────────────────────────────────────
// Phase 2.2 — receives Google Calendar push notifications. Google
// sends an empty POST when something on the watched calendar changes;
// we then fetch the actual changes via incremental sync token.
//
// Inbound shape (per Google's docs):
//   POST <our address>
//   Headers:
//     X-Goog-Channel-ID:     <our channel id>
//     X-Goog-Channel-Token:  <our random secret — verify this>
//     X-Goog-Resource-State: sync | exists | not_exists
//     X-Goog-Resource-ID:    <Google's tag for the watched resource>
//     X-Goog-Message-Number: <monotonic per-channel counter>
//   Body: empty
//
// Resource-state semantics:
//   - "sync"      — initial confirmation that the channel is live.
//                   We ack with 200 and do nothing else.
//   - "exists"    — something changed. Reconcile.
//   - "not_exists" — the resource was deleted at Google. Mark the
//                    channel stopped; the next renewal will re-register.
//
// MUST respond 200 quickly — Google retries on non-2xx. We do the
// reconciliation inline (it's bounded by the sync window) but kick
// out a 200 if anything looks malformed so retries don't pile up on
// malformed payloads.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { CalendarConnection } from "../_shared/google-calendar.ts";
import { reconcileFromGoogle } from "../_shared/calendar-reconciler.ts";
import { logCalendarSync } from "../_shared/calendar-sync-logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // Google's push doesn't preflight, but allowlist their headers in
  // case dev tools / proxies inject them during testing.
  "Access-Control-Allow-Headers":
    "x-goog-channel-id, x-goog-channel-token, x-goog-resource-state, x-goog-resource-id, x-goog-message-number, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Headers Google sends on every push.
  const channelId = req.headers.get("x-goog-channel-id");
  const channelToken = req.headers.get("x-goog-channel-token");
  const resourceState = req.headers.get("x-goog-resource-state");
  const resourceId = req.headers.get("x-goog-resource-id");
  const messageNumber = req.headers.get("x-goog-message-number");

  // Always log the inbound so we have a paper trail for the SLO —
  // even if we end up rejecting the request, the log row shows we
  // received it.
  console.log(
    "[calendar-watch-callback] inbound",
    JSON.stringify({
      channelId,
      resourceState,
      resourceId,
      messageNumber,
      hasToken: !!channelToken,
    }),
  );

  if (!channelId || !channelToken) {
    // Malformed: missing required headers. Respond 200 so Google
    // doesn't retry indefinitely (the retry won't have the headers
    // either), but flag in logs.
    console.warn("[calendar-watch-callback] missing required headers");
    return ack();
  }

  // Look up the connection by channel_id and verify the token. Failing
  // either check returns 200 (so Google stops retrying on what looks
  // like a stale or unknown channel) but logs the issue.
  const { data: connRow } = await supabase
    .from("calendar_connections")
    .select(
      "id, user_id, access_token, refresh_token, token_expiry, primary_calendar_id, is_active, auto_add_to_calendar, watch_channel_id, watch_resource_id, watch_token, watch_state",
    )
    .eq("watch_channel_id", channelId)
    .maybeSingle();

  if (!connRow) {
    console.warn("[calendar-watch-callback] unknown channel_id:", channelId);
    return ack();
  }

  // Token verification — channel id alone isn't enough; an attacker
  // who guessed our edge function URL could fire the right channel
  // id with no token. Compare with timing-safe equality.
  if (!timingSafeEqual(channelToken, (connRow.watch_token as string) ?? "")) {
    console.warn("[calendar-watch-callback] token mismatch for channel:", channelId);
    await logCalendarSync(supabase, {
      user_id: (connRow.user_id as string) ?? "",
      action: "update",
      sync_status: "google_api_error",
      connection_id: connRow.id as string,
      invoked_from: "calendar-watch-callback",
      error_message: "token_mismatch",
    });
    return ack();
  }

  // Sync confirmation — channel is alive. Google sends this once
  // shortly after we register. No work to do; ack and move on.
  if (resourceState === "sync") {
    return ack();
  }

  // Resource gone — Google says the calendar resource is no longer
  // available. Mark the channel stopped so renewal cron re-registers
  // next cycle.
  if (resourceState === "not_exists") {
    await supabase
      .from("calendar_connections")
      .update({
        watch_state: "stopped",
        watch_channel_id: null,
        watch_resource_id: null,
        watch_token: null,
        watch_expiry_at: null,
      })
      .eq("id", connRow.id as string);
    return ack();
  }

  // "exists" — actual change. Reconcile inline. If reconciliation
  // takes >1s (unusual but possible on large sync windows) Google
  // will retry; that's fine because our reconciler is idempotent on
  // sync tokens.
  if (resourceState === "exists") {
    try {
      await reconcileFromGoogle(
        supabase,
        connRow as unknown as CalendarConnection,
        "calendar-watch-callback",
      );
    } catch (err) {
      console.error("[calendar-watch-callback] reconcile failed:", err);
      // Still ack — retrying won't help if the failure is a code bug.
      // The renewal cron's sync-on-renew is the safety net.
    }
    return ack();
  }

  // Unknown state — log and ack so Google stops retrying.
  console.warn("[calendar-watch-callback] unknown resource_state:", resourceState);
  return ack();
});

// Quick acknowledgment. Google reads any 2xx as "got it"; 200 with
// empty body is the canonical choice.
function ack(): Response {
  return new Response(null, { status: 200, headers: corsHeaders });
}

// Constant-time string comparison. Without this, an attacker could
// time-side-channel the watch_token a character at a time by
// measuring response times.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

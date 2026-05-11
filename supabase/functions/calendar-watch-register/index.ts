// calendar-watch-register
// ─────────────────────────────────────────────────────────────────────
// Phase 2.2 — registers (or re-registers) a Google Calendar push
// channel for a user's connection. Two call paths:
//
//   1. From `calendar-callback` right after OAuth completes — wires
//      push notifications on every fresh connection.
//   2. From `calendar-watch-renew` (cron) — re-registers channels
//      whose `watch_expiry_at` is within 24h of now.
//
// Idempotency: if a connection already has a non-stopped channel, we
// STOP it first before registering a fresh one. Google rejects
// duplicate channel ids and would also keep delivering callbacks to
// the abandoned id otherwise.
//
// The channel id is a UUID v4 we mint per registration; the token is
// a random secret echoed by Google on every callback so we can
// authenticate inbound requests.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  ensureFreshAccessToken,
  stopCalendarChannel,
  watchCalendarChannel,
  type CalendarConnection,
} from "../_shared/google-calendar.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RegisterRequest {
  // Either user_id (we'll resolve the active connection) or
  // connection_id directly. The renewal cron uses connection_id;
  // calendar-callback uses user_id since the connection was just
  // upserted there.
  user_id?: string;
  connection_id?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // The callback URL is the public Supabase edge URL for our receiver
  // function. SUPABASE_URL is what edge functions invoke each other
  // through; the public URL is the same host. Google requires HTTPS,
  // which Supabase provides by default.
  const callbackUrl = `${supabaseUrl}/functions/v1/calendar-watch-callback`;

  try {
    const body = (await req.json()) as RegisterRequest;
    const conn = await loadConnection(supabase, body);
    if (!conn) {
      return json({ success: false, error: "connection_not_found" }, 404);
    }

    const tokenResult = await ensureFreshAccessToken(supabase, conn);
    if (!tokenResult.ok) {
      return json({
        success: false,
        error: "token_refresh_failed",
        detail: tokenResult.message,
      }, 200);
    }
    const accessToken = tokenResult.value;

    // If we already have an active channel, stop it before
    // registering a new one. Idempotent: 404 from Google is OK
    // (channel already expired/gone).
    if (conn.watch_channel_id && conn.watch_resource_id && conn.watch_state === "active") {
      const stopResult = await stopCalendarChannel(accessToken, {
        channelId: conn.watch_channel_id,
        resourceId: conn.watch_resource_id,
      });
      if (!stopResult.ok) {
        console.warn(
          "[calendar-watch-register] stop-old failed (non-fatal):",
          stopResult.status,
          stopResult.message,
        );
      }
    }

    // Mint fresh channel id + token. UUID v4 for the id (Google
    // requires it to be unique); crypto-strong random for the token
    // so it can't be guessed by anyone hitting the callback URL.
    const channelId = crypto.randomUUID();
    const channelToken = randomToken(48);

    const watchResult = await watchCalendarChannel(accessToken, conn.primary_calendar_id, {
      channelId,
      token: channelToken,
      address: callbackUrl,
    });
    if (!watchResult.ok) {
      // Mark the connection's watch_state so the renewal cron picks
      // it up next cycle, AND so the connection still works for
      // outbound writes — bidirectional sync degrades gracefully to
      // on-demand polling.
      await supabase
        .from("calendar_connections")
        .update({
          watch_state: "failed",
          watch_channel_id: null,
          watch_resource_id: null,
          watch_token: null,
          watch_expiry_at: null,
        })
        .eq("id", conn.id);
      console.error(
        "[calendar-watch-register] watch failed:",
        watchResult.status,
        watchResult.message,
      );
      return json({
        success: false,
        error: "watch_failed",
        detail: watchResult.message,
        status: watchResult.status,
      }, 200);
    }

    const reg = watchResult.value;
    await supabase
      .from("calendar_connections")
      .update({
        watch_channel_id: reg.id,
        watch_resource_id: reg.resourceId,
        watch_token: channelToken,
        watch_expiry_at: new Date(reg.expiration).toISOString(),
        watch_state: "active",
      })
      .eq("id", conn.id);

    return json({
      success: true,
      channel_id: reg.id,
      resource_id: reg.resourceId,
      expires_at: new Date(reg.expiration).toISOString(),
    });
  } catch (err) {
    console.error("[calendar-watch-register] unhandled:", err);
    return json(
      { success: false, error: err instanceof Error ? err.message : "Unknown error" },
      500,
    );
  }
});

async function loadConnection(
  supabase: SupabaseClient,
  body: RegisterRequest,
): Promise<(CalendarConnection & { watch_channel_id?: string; watch_resource_id?: string; watch_state?: string }) | null> {
  if (body.connection_id) {
    const { data } = await supabase
      .from("calendar_connections")
      .select(
        "id, user_id, access_token, refresh_token, token_expiry, primary_calendar_id, is_active, auto_add_to_calendar, watch_channel_id, watch_resource_id, watch_token, watch_state",
      )
      .eq("id", body.connection_id)
      .eq("is_active", true)
      .maybeSingle();
    return (data as never) ?? null;
  }
  if (body.user_id) {
    const { data } = await supabase
      .from("calendar_connections")
      .select(
        "id, user_id, access_token, refresh_token, token_expiry, primary_calendar_id, is_active, auto_add_to_calendar, watch_channel_id, watch_resource_id, watch_token, watch_state",
      )
      .eq("user_id", body.user_id)
      .eq("is_active", true)
      .maybeSingle();
    return (data as never) ?? null;
  }
  return null;
}

// Strong random token — 48 bytes → 64 base64url chars. Echoed by
// Google on every push callback as X-Goog-Channel-Token; we compare
// it against the per-connection stored value to authenticate the
// request.
function randomToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  // base64url for header-safe encoding
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

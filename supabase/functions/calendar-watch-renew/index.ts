// calendar-watch-renew
// ─────────────────────────────────────────────────────────────────────
// Phase 2.2 — cron-driven channel renewal. Runs hourly. For each
// connection whose `watch_expiry_at` is within the next 24 hours,
// re-register a fresh watch channel via calendar-watch-register.
//
// Also picks up:
//   - watch_state='failed' connections (registration failed on
//     initial setup; we retry on every cron tick)
//   - watch_state='stopped' connections that came from a "not_exists"
//     callback (channel was killed at Google's end; re-register to
//     resume push)
//
// Why an hourly cadence: channels expire at most every 7 days (Google's
// default for web_hook channels), so an hourly walk has ~168 retry
// opportunities before any single channel falls off the cliff. With
// our 24-hour pre-renewal threshold, the first renewal kicks in ≥23
// hours before expiry, giving 23 retries before a channel actually
// goes dark.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { reconcileFromGoogle } from "../_shared/calendar-reconciler.ts";
import type { CalendarConnection } from "../_shared/google-calendar.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

// Renew anything expiring within this window. Slack of 24h means a
// single missed cron run (e.g. cron downtime) still leaves plenty of
// margin to recover before the actual expiry.
const RENEWAL_WINDOW_HOURS = 24;
// Process up to this many connections per tick. Bounded so a single
// run can't exceed the function timeout if every connection's
// channel happens to expire simultaneously.
const BATCH_SIZE = 50;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const renewBy = new Date(Date.now() + RENEWAL_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  // Pull candidates: active connections whose watch expires soon, OR
  // whose watch state is 'failed' (previous registration attempt
  // failed; retry), OR 'stopped' (channel was killed; re-register).
  const { data: candidates, error } = await supabase
    .from("calendar_connections")
    .select(
      "id, user_id, access_token, refresh_token, token_expiry, primary_calendar_id, is_active, auto_add_to_calendar, watch_channel_id, watch_resource_id, watch_token, watch_state, watch_expiry_at",
    )
    .eq("is_active", true)
    .or(`watch_state.in.(failed,stopped),watch_expiry_at.lte.${renewBy}`)
    .limit(BATCH_SIZE);

  if (error) {
    console.error("[calendar-watch-renew] query failed:", error);
    return json({ success: false, error: error.message }, 500);
  }
  if (!candidates || candidates.length === 0) {
    return json({ success: true, candidates: 0, renewed: 0 });
  }

  let renewed = 0;
  let failed = 0;

  for (const conn of candidates as Array<Record<string, unknown>>) {
    // Re-registration goes through calendar-watch-register so all the
    // "stop old + start new" logic stays in one place. Errors are
    // logged but don't abort the loop — one stuck connection
    // shouldn't block the others.
    try {
      const { data, error: regErr } = await supabase.functions.invoke("calendar-watch-register", {
        body: { connection_id: conn.id },
      });
      if (regErr || !data?.success) {
        failed++;
        console.warn(
          "[calendar-watch-renew] register failed for connection",
          conn.id,
          regErr?.message || data?.error,
        );
        continue;
      }
      renewed++;

      // After renewing, kick off a small reconciliation. The brief
      // window between stop-old and start-new can have missed events;
      // doing a sync-on-renew closes that gap. Skip if we never had
      // a sync token (cold start handled elsewhere).
      try {
        await reconcileFromGoogle(
          supabase,
          conn as unknown as CalendarConnection,
          "calendar-watch-renew",
        );
      } catch (recErr) {
        // Non-fatal — the next push notification will reconcile.
        console.warn(
          "[calendar-watch-renew] post-renew reconcile failed (non-fatal):",
          recErr,
        );
      }
    } catch (err) {
      failed++;
      console.warn(
        "[calendar-watch-renew] invoke threw for connection",
        conn.id,
        err,
      );
    }
  }

  return json({
    success: true,
    candidates: candidates.length,
    renewed,
    failed,
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

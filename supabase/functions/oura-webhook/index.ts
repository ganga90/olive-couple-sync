/**
 * Oura Webhook Listener Edge Function
 *
 * Receives push notifications from Oura when a user syncs their ring.
 * This eliminates the need for polling and ensures data is always fresh.
 *
 * Oura webhook payload format:
 * {
 *   "event_type": "create" | "update" | "delete",
 *   "data_type": "daily_sleep" | "daily_readiness" | "daily_activity" | "workout" | "sleep" | ...,
 *   "user_id": "<oura_user_id>",
 *   "event_timestamp": "2026-02-19T00:00:00Z"
 * }
 *
 * Setup: Register this URL in the Oura Developer Portal → Webhooks:
 *   https://wtfspzvcetxmcfftwonq.supabase.co/functions/v1/oura-webhook
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Data types we care about for the health dashboard
const RELEVANT_DATA_TYPES = new Set([
  "daily_sleep",
  "daily_readiness",
  "daily_activity",
  "workout",
  "sleep",
]);

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Oura sends a GET for webhook verification
  if (req.method === "GET") {
    const url = new URL(req.url);
    const verificationToken = url.searchParams.get("verification_token");
    if (verificationToken) {
      console.log("[oura-webhook] Verification request received");
      return new Response(verificationToken, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/plain" },
      });
    }
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  // Only accept POST from here
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    console.log("[oura-webhook] Received:", JSON.stringify(payload));

    const { event_type, data_type, user_id: ouraUserId } = payload;

    // Ignore irrelevant data types
    if (!RELEVANT_DATA_TYPES.has(data_type)) {
      console.log(`[oura-webhook] Ignoring data_type: ${data_type}`);
      return json({ received: true, action: "ignored" });
    }

    // Ignore delete events
    if (event_type === "delete") {
      console.log("[oura-webhook] Ignoring delete event");
      return json({ received: true, action: "ignored" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Find the Olive user linked to this Oura user_id
    const { data: connection, error: connErr } = await supabase
      .from("oura_connections")
      .select("id, user_id, last_sync_time")
      .eq("oura_user_id", ouraUserId)
      .eq("is_active", true)
      .single();

    if (connErr || !connection) {
      console.log(`[oura-webhook] No active connection for oura_user_id: ${ouraUserId}`);
      return json({ received: true, action: "no_connection" });
    }

    // Clear the cache by resetting last_sync_time so the next fetch hits the API
    const { error: updateErr } = await supabase
      .from("oura_connections")
      .update({
        last_sync_time: null,
        error_message: null,
      })
      .eq("id", connection.id);

    if (updateErr) {
      console.error("[oura-webhook] Failed to reset sync time:", updateErr);
    }

    console.log(
      `[oura-webhook] Cache cleared for user ${connection.user_id} (${data_type} ${event_type})`
    );

    return json({
      received: true,
      action: "cache_cleared",
      user_id: connection.user_id,
      data_type,
    });
  } catch (error: unknown) {
    console.error("[oura-webhook] Error:", error);
    return json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

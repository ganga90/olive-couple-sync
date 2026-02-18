/**
 * Oura Data Edge Function
 * 
 * Fetches health data from the Oura API for a given user.
 * Handles token refresh automatically.
 * 
 * Actions:
 * - status: Check connection status
 * - daily_summary: Get today's sleep, readiness, activity
 * - weekly_summary: Get last 7 days of data
 * - workouts: Get recent workouts
 * - disconnect: Remove Oura connection
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OURA_API = "https://api.ouraring.com/v2/usercollection";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { user_id, action } = await req.json();

    if (!user_id) {
      throw new Error('Missing user_id');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get connection
    const { data: connection, error: connErr } = await supabase
      .from('oura_connections')
      .select('*')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .single();

    if (connErr || !connection) {
      return json({ success: false, connected: false, error: 'No Oura connection found' });
    }

    // Handle disconnect
    if (action === 'disconnect') {
      await supabase.from('oura_connections').delete().eq('id', connection.id);
      return json({ success: true, disconnected: true });
    }

    // Handle status check
    if (action === 'status') {
      return json({
        success: true,
        connected: true,
        email: connection.oura_email,
        last_sync: connection.last_sync_time,
      });
    }

    // Ensure valid token (refresh if needed)
    let accessToken = connection.access_token;
    if (connection.token_expiry && new Date(connection.token_expiry) < new Date()) {
      console.log('[oura-data] Token expired, refreshing...');
      accessToken = await refreshToken(supabase, connection);
      if (!accessToken) {
        return json({ success: false, error: 'Token refresh failed. Please reconnect Oura.' });
      }
    }

    const headers = { Authorization: `Bearer ${accessToken}` };

    switch (action) {
      case 'daily_summary': {
        const today = formatDate(new Date());
        const yesterday = formatDate(new Date(Date.now() - 86400000));

        const [sleep, readiness, activity, stress] = await Promise.all([
          ouraFetch(`${OURA_API}/daily_sleep?start_date=${yesterday}&end_date=${today}`, headers),
          ouraFetch(`${OURA_API}/daily_readiness?start_date=${yesterday}&end_date=${today}`, headers),
          ouraFetch(`${OURA_API}/daily_activity?start_date=${yesterday}&end_date=${today}`, headers),
          ouraFetch(`${OURA_API}/daily_stress?start_date=${yesterday}&end_date=${today}`, headers),
        ]);

        // Update last sync time
        await supabase.from('oura_connections')
          .update({ last_sync_time: new Date().toISOString(), error_message: null })
          .eq('id', connection.id);

        return json({
          success: true,
          data: {
            sleep: getLatest(sleep?.data),
            readiness: getLatest(readiness?.data),
            activity: getLatest(activity?.data),
            stress: getLatest(stress?.data),
          },
        });
      }

      case 'weekly_summary': {
        const today = formatDate(new Date());
        const weekAgo = formatDate(new Date(Date.now() - 7 * 86400000));

        const [sleep, readiness, activity, workouts] = await Promise.all([
          ouraFetch(`${OURA_API}/daily_sleep?start_date=${weekAgo}&end_date=${today}`, headers),
          ouraFetch(`${OURA_API}/daily_readiness?start_date=${weekAgo}&end_date=${today}`, headers),
          ouraFetch(`${OURA_API}/daily_activity?start_date=${weekAgo}&end_date=${today}`, headers),
          ouraFetch(`${OURA_API}/workout?start_date=${weekAgo}&end_date=${today}`, headers),
        ]);

        await supabase.from('oura_connections')
          .update({ last_sync_time: new Date().toISOString(), error_message: null })
          .eq('id', connection.id);

        return json({
          success: true,
          data: {
            sleep: sleep?.data || [],
            readiness: readiness?.data || [],
            activity: activity?.data || [],
            workouts: workouts?.data || [],
          },
        });
      }

      case 'workouts': {
        const today = formatDate(new Date());
        const weekAgo = formatDate(new Date(Date.now() - 7 * 86400000));

        const workouts = await ouraFetch(
          `${OURA_API}/workout?start_date=${weekAgo}&end_date=${today}`,
          headers
        );

        return json({
          success: true,
          data: { workouts: workouts?.data || [] },
        });
      }

      default:
        return json({ success: false, error: `Unknown action: ${action}` });
    }
  } catch (error: unknown) {
    console.error('[oura-data] Error:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ouraFetch(url: string, headers: Record<string, string>) {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[oura-data] API error ${res.status} for ${url}:`, text);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[oura-data] Fetch error for ${url}:`, err);
    return null;
  }
}

async function refreshToken(supabase: any, connection: any): Promise<string | null> {
  const clientId = Deno.env.get("OURA_CLIENT_ID");
  const clientSecret = Deno.env.get("OURA_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    console.error('[oura-data] Missing OURA credentials for refresh');
    return null;
  }

  try {
    const res = await fetch("https://api.ouraring.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: connection.refresh_token,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[oura-data] Token refresh failed:', errText);
      await supabase.from('oura_connections')
        .update({ error_message: 'Token refresh failed', is_active: false })
        .eq('id', connection.id);
      return null;
    }

    const tokens = await res.json();
    const tokenExpiry = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    await supabase.from('oura_connections')
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || connection.refresh_token,
        token_expiry: tokenExpiry,
        error_message: null,
      })
      .eq('id', connection.id);

    console.log('[oura-data] Token refreshed successfully');
    return tokens.access_token;
  } catch (err) {
    console.error('[oura-data] Token refresh exception:', err);
    return null;
  }
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function getLatest(arr: any[] | undefined): any | null {
  if (!arr || arr.length === 0) return null;
  return arr[arr.length - 1];
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

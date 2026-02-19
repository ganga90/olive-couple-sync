import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Fetch the Oura connection for this user
    const { data: connection, error: connError } = await supabase
      .from('oura_connections')
      .select('*')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .maybeSingle();

    // ========================================================================
    // STATUS
    // ========================================================================
    if (action === 'status') {
      if (!connection || connError) {
        return json({ success: true, connected: false });
      }

      return json({
        success: true,
        connected: true,
        sync_enabled: connection.sync_enabled,
        last_sync: connection.last_sync_time,
      });
    }

    // ========================================================================
    // DISCONNECT
    // ========================================================================
    if (action === 'disconnect') {
      if (!connection) {
        return json({ success: true, message: 'No connection to disconnect' });
      }

      // Delete the connection (cascades to oura_daily_data)
      await supabase
        .from('oura_connections')
        .delete()
        .eq('id', connection.id);

      console.log('[oura-sync] Disconnected user:', user_id);
      return json({ success: true });
    }

    // ========================================================================
    // FETCH DATA
    // ========================================================================
    if (action === 'fetch_data') {
      if (!connection) {
        throw new Error('No active Oura connection');
      }

      // Refresh token if expired (or expiring within 5 minutes)
      let accessToken = connection.access_token;
      const tokenExpiry = new Date(connection.token_expiry).getTime();
      const fiveMinFromNow = Date.now() + 5 * 60 * 1000;

      if (tokenExpiry < fiveMinFromNow) {
        console.log('[oura-sync] Token expired or expiring soon, refreshing...');
        accessToken = await refreshOuraToken(supabase, connection);
        if (!accessToken) {
          throw new Error('Failed to refresh Oura token');
        }
      }

      // Fetch last 7 days of data from Oura API v2
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      console.log('[oura-sync] Fetching data from', startDate, 'to', endDate);

      const headers = { Authorization: `Bearer ${accessToken}` };

      const [sleepRes, readinessRes, activityRes, stressRes, resilienceRes] = await Promise.all([
        fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${startDate}&end_date=${endDate}`, { headers }),
        fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${startDate}&end_date=${endDate}`, { headers }),
        fetch(`https://api.ouraring.com/v2/usercollection/daily_activity?start_date=${startDate}&end_date=${endDate}`, { headers }),
        fetch(`https://api.ouraring.com/v2/usercollection/daily_stress?start_date=${startDate}&end_date=${endDate}`, { headers }),
        fetch(`https://api.ouraring.com/v2/usercollection/daily_resilience?start_date=${startDate}&end_date=${endDate}`, { headers }),
      ]);

      // Check for auth errors on core endpoints (stress/resilience may 403 on older rings — non-fatal)
      if (sleepRes.status === 401 || readinessRes.status === 401 || activityRes.status === 401) {
        console.error('[oura-sync] Oura API returned 401, marking connection as errored');
        await supabase
          .from('oura_connections')
          .update({ error_message: 'Authentication failed. Please reconnect.', is_active: false })
          .eq('id', connection.id);
        throw new Error('Oura authentication failed. Please reconnect your ring.');
      }

      const sleepData = sleepRes.ok ? await sleepRes.json() : { data: [] };
      const readinessData = readinessRes.ok ? await readinessRes.json() : { data: [] };
      const activityData = activityRes.ok ? await activityRes.json() : { data: [] };
      // Stress and resilience may not be available on all ring generations — graceful fallback
      const stressData = stressRes.ok ? await stressRes.json() : { data: [] };
      const resilienceData = resilienceRes.ok ? await resilienceRes.json() : { data: [] };

      console.log('[oura-sync] Received:', sleepData.data?.length || 0, 'sleep,', readinessData.data?.length || 0, 'readiness,', activityData.data?.length || 0, 'activity,', stressData.data?.length || 0, 'stress,', resilienceData.data?.length || 0, 'resilience records');

      // Build a map of day → merged data
      const dayMap: Record<string, any> = {};

      for (const item of (sleepData.data || [])) {
        const day = item.day;
        if (!dayMap[day]) dayMap[day] = {};
        dayMap[day].sleep_score = item.score ?? null;
        dayMap[day].sleep_duration_seconds = item.total_sleep_duration ?? null;
        dayMap[day].sleep_efficiency = item.efficiency ?? null;
        dayMap[day].deep_sleep_seconds = item.deep_sleep_duration ?? null;
        dayMap[day].rem_sleep_seconds = item.rem_sleep_duration ?? null;
        dayMap[day].light_sleep_seconds = item.light_sleep_duration ?? null;
        dayMap[day].awake_seconds = item.awake_time ?? null;
        dayMap[day].sleep_latency_seconds = item.latency ?? null;
        dayMap[day].bedtime_start = item.bedtime_start ?? null;
        dayMap[day].bedtime_end = item.bedtime_end ?? null;
        dayMap[day].raw_sleep = item;
      }

      for (const item of (readinessData.data || [])) {
        const day = item.day;
        if (!dayMap[day]) dayMap[day] = {};
        dayMap[day].readiness_score = item.score ?? null;
        dayMap[day].readiness_temperature_deviation = item.temperature_deviation ?? null;
        dayMap[day].readiness_hrv_balance = item.contributors?.hrv_balance ?? null;
        dayMap[day].readiness_resting_heart_rate = item.contributors?.resting_heart_rate ?? null;
        dayMap[day].raw_readiness = item;
      }

      for (const item of (activityData.data || [])) {
        const day = item.day;
        if (!dayMap[day]) dayMap[day] = {};
        dayMap[day].activity_score = item.score ?? null;
        dayMap[day].steps = item.steps ?? null;
        dayMap[day].active_calories = item.active_calories ?? null;
        dayMap[day].total_calories = item.total_calories ?? null;
        dayMap[day].active_minutes = item.high_activity_time != null ? Math.round(item.high_activity_time / 60) : null;
        dayMap[day].sedentary_minutes = item.sedentary_time != null ? Math.round(item.sedentary_time / 60) : null;
        dayMap[day].raw_activity = item;
      }

      // Stress data (may be empty on older ring generations)
      for (const item of (stressData.data || [])) {
        const day = item.day;
        if (!dayMap[day]) dayMap[day] = {};
        dayMap[day].stress_high_minutes = item.stress_high != null ? Math.round(item.stress_high / 60) : null;
        dayMap[day].recovery_high_minutes = item.recovery_high != null ? Math.round(item.recovery_high / 60) : null;
        dayMap[day].stress_day_summary = item.day_summary ?? null;
        dayMap[day].raw_stress = item;
      }

      // Resilience data (requires Gen3+ ring)
      for (const item of (resilienceData.data || [])) {
        const day = item.day;
        if (!dayMap[day]) dayMap[day] = {};
        dayMap[day].resilience_level = item.level ?? null;
        dayMap[day].resilience_sleep_recovery = item.contributors?.sleep_recovery ?? null;
        dayMap[day].resilience_daytime_recovery = item.contributors?.daytime_recovery ?? null;
        dayMap[day].raw_resilience = item;
      }

      // Upsert into oura_daily_data
      const rows = Object.entries(dayMap).map(([day, data]) => ({
        connection_id: connection.id,
        user_id,
        day,
        sleep_score: data.sleep_score,
        sleep_duration_seconds: data.sleep_duration_seconds,
        sleep_efficiency: data.sleep_efficiency,
        deep_sleep_seconds: data.deep_sleep_seconds,
        rem_sleep_seconds: data.rem_sleep_seconds,
        light_sleep_seconds: data.light_sleep_seconds,
        awake_seconds: data.awake_seconds,
        sleep_latency_seconds: data.sleep_latency_seconds,
        bedtime_start: data.bedtime_start,
        bedtime_end: data.bedtime_end,
        readiness_score: data.readiness_score,
        readiness_temperature_deviation: data.readiness_temperature_deviation,
        readiness_hrv_balance: data.readiness_hrv_balance,
        readiness_resting_heart_rate: data.readiness_resting_heart_rate,
        activity_score: data.activity_score,
        steps: data.steps,
        active_calories: data.active_calories,
        total_calories: data.total_calories,
        active_minutes: data.active_minutes,
        sedentary_minutes: data.sedentary_minutes,
        stress_high_minutes: data.stress_high_minutes ?? null,
        recovery_high_minutes: data.recovery_high_minutes ?? null,
        stress_day_summary: data.stress_day_summary ?? null,
        resilience_level: data.resilience_level ?? null,
        resilience_sleep_recovery: data.resilience_sleep_recovery ?? null,
        resilience_daytime_recovery: data.resilience_daytime_recovery ?? null,
        raw_data: { sleep: data.raw_sleep, readiness: data.raw_readiness, activity: data.raw_activity, stress: data.raw_stress, resilience: data.raw_resilience },
        synced_at: new Date().toISOString(),
      }));

      if (rows.length > 0) {
        const { error: upsertError } = await supabase
          .from('oura_daily_data')
          .upsert(rows, { onConflict: 'user_id,day' });

        if (upsertError) {
          console.error('[oura-sync] Upsert error:', upsertError);
          throw new Error('Failed to save Oura data');
        }
      }

      // Update last sync time
      await supabase
        .from('oura_connections')
        .update({ last_sync_time: new Date().toISOString(), error_message: null })
        .eq('id', connection.id);

      console.log('[oura-sync] Synced', rows.length, 'days of data for user:', user_id);

      return json({
        success: true,
        synced_count: rows.length,
        date_range: { start: startDate, end: endDate },
      });
    }

    throw new Error(`Unknown action: ${action}`);

  } catch (error: unknown) {
    console.error('[oura-sync] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// Helper: Refresh Oura OAuth token
async function refreshOuraToken(supabase: any, connection: any): Promise<string | null> {
  const clientId = Deno.env.get("OURA_CLIENT_ID");
  const clientSecret = Deno.env.get("OURA_CLIENT_SECRET");

  try {
    const response = await fetch("https://api.ouraring.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId!,
        client_secret: clientSecret!,
        refresh_token: connection.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[oura-sync] Token refresh failed:', errorText);
      return null;
    }

    const tokens = await response.json();
    console.log('[oura-sync] Token refreshed successfully');

    // Update stored tokens
    await supabase
      .from('oura_connections')
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || connection.refresh_token,
        token_expiry: new Date(Date.now() + (tokens.expires_in || 86400) * 1000).toISOString(),
        error_message: null,
      })
      .eq('id', connection.id);

    return tokens.access_token;
  } catch (error) {
    console.error('[oura-sync] Token refresh error:', error);
    return null;
  }
}

// Helper: JSON response with CORS headers
function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

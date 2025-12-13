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

    // Get user's calendar connection
    const { data: connection, error: connError } = await supabase
      .from("calendar_connections")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .maybeSingle();

    if (connError) {
      throw new Error('Failed to fetch calendar connection');
    }

    if (!connection) {
      return new Response(
        JSON.stringify({ success: false, error: 'No calendar connected' }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if token needs refresh
    const tokenExpiry = new Date(connection.token_expiry).getTime();
    const now = Date.now();
    let accessToken = connection.access_token;

    if (tokenExpiry - now < 5 * 60 * 1000) {
      // Token expires in less than 5 minutes, refresh it
      console.log('[calendar-sync] Refreshing token...');
      
      const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
      const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");

      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId!,
          client_secret: clientSecret!,
          refresh_token: connection.refresh_token,
          grant_type: "refresh_token",
        }),
      });

      if (!tokenResponse.ok) {
        console.error('[calendar-sync] Token refresh failed');
        await supabase
          .from("calendar_connections")
          .update({ is_active: false, error_message: "Token refresh failed" })
          .eq("id", connection.id);
        throw new Error('Token refresh failed - please reconnect your calendar');
      }

      const newTokens = await tokenResponse.json();
      accessToken = newTokens.access_token;

      // Update token in database
      await supabase
        .from("calendar_connections")
        .update({
          access_token: accessToken,
          token_expiry: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
          error_message: null,
        })
        .eq("id", connection.id);
      
      console.log('[calendar-sync] Token refreshed successfully');
    }

    // Handle different actions
    if (action === 'status') {
      return new Response(
        JSON.stringify({
          success: true,
          connected: true,
          email: connection.google_email,
          calendar_name: connection.calendar_name,
          sync_enabled: connection.sync_enabled,
          last_sync: connection.last_sync_time,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === 'disconnect') {
      // Revoke token
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${accessToken}`, {
          method: 'POST',
        });
      } catch (e) {
        console.warn('[calendar-sync] Token revoke failed (may already be revoked)');
      }

      // Delete connection
      await supabase
        .from("calendar_connections")
        .delete()
        .eq("id", connection.id);

      return new Response(
        JSON.stringify({ success: true, message: 'Calendar disconnected' }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === 'fetch_events') {
      // Fetch events from Google Calendar
      const now = new Date();
      const timeMin = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
      const timeMax = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days ahead

      const eventsUrl = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.primary_calendar_id)}/events`
      );
      eventsUrl.searchParams.set("maxResults", "250");
      eventsUrl.searchParams.set("singleEvents", "true");
      eventsUrl.searchParams.set("orderBy", "startTime");
      eventsUrl.searchParams.set("timeMin", timeMin);
      eventsUrl.searchParams.set("timeMax", timeMax);

      const eventsResponse = await fetch(eventsUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!eventsResponse.ok) {
        const errorText = await eventsResponse.text();
        console.error('[calendar-sync] Failed to fetch events:', errorText);
        throw new Error('Failed to fetch calendar events');
      }

      const eventsData = await eventsResponse.json();
      const events = eventsData.items || [];

      console.log('[calendar-sync] Fetched', events.length, 'events from Google Calendar');

      // Sync events to database
      for (const event of events) {
        if (!event.start || !event.end) continue;

        const startTime = event.start.dateTime || event.start.date;
        const endTime = event.end.dateTime || event.end.date;

        await supabase
          .from("calendar_events")
          .upsert({
            connection_id: connection.id,
            google_event_id: event.id,
            title: event.summary || 'Untitled Event',
            description: event.description,
            location: event.location,
            start_time: startTime,
            end_time: endTime,
            all_day: !event.start.dateTime,
            timezone: event.start.timeZone || 'UTC',
            event_type: 'from_calendar',
            etag: event.etag,
            last_synced_at: new Date().toISOString(),
          }, { onConflict: 'google_event_id' });
      }

      // Update sync state
      await supabase
        .from("calendar_connections")
        .update({ last_sync_time: new Date().toISOString() })
        .eq("id", connection.id);

      return new Response(
        JSON.stringify({
          success: true,
          synced_count: events.length,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Default: return connection info
    return new Response(
      JSON.stringify({
        success: true,
        connection: {
          id: connection.id,
          email: connection.google_email,
          calendar_name: connection.calendar_name,
          sync_enabled: connection.sync_enabled,
          last_sync: connection.last_sync_time,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error('[calendar-sync] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

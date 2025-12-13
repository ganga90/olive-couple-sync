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
    const { user_id, note_id, title, description, start_time, end_time, all_day, location } = await req.json();

    if (!user_id || !title || !start_time) {
      throw new Error('Missing required fields: user_id, title, start_time');
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

    if (connError || !connection) {
      return new Response(
        JSON.stringify({ success: false, error: 'No calendar connected' }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if token needs refresh
    let accessToken = connection.access_token;
    const tokenExpiry = new Date(connection.token_expiry).getTime();
    
    if (tokenExpiry - Date.now() < 5 * 60 * 1000) {
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
        throw new Error('Token refresh failed');
      }

      const newTokens = await tokenResponse.json();
      accessToken = newTokens.access_token;

      await supabase
        .from("calendar_connections")
        .update({
          access_token: accessToken,
          token_expiry: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
        })
        .eq("id", connection.id);
    }

    // Build Google Calendar event
    const event: any = {
      summary: title,
      description: description || '',
    };

    if (location) {
      event.location = location;
    }

    // Parse dates
    const startDate = new Date(start_time);
    
    if (all_day) {
      event.start = { date: startDate.toISOString().split('T')[0] };
      if (end_time) {
        event.end = { date: new Date(end_time).toISOString().split('T')[0] };
      } else {
        const nextDay = new Date(startDate);
        nextDay.setDate(nextDay.getDate() + 1);
        event.end = { date: nextDay.toISOString().split('T')[0] };
      }
    } else {
      event.start = { dateTime: startDate.toISOString(), timeZone: 'UTC' };
      if (end_time) {
        event.end = { dateTime: new Date(end_time).toISOString(), timeZone: 'UTC' };
      } else {
        const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour default
        event.end = { dateTime: endDate.toISOString(), timeZone: 'UTC' };
      }
    }

    // Add reminders
    event.reminders = {
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 30 },
        { method: "email", minutes: 1440 }, // 24 hours
      ],
    };

    console.log('[calendar-create-event] Creating event:', event.summary);

    // Create event in Google Calendar
    const createResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.primary_calendar_id)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('[calendar-create-event] Failed:', errorText);
      throw new Error('Failed to create calendar event');
    }

    const googleEvent = await createResponse.json();
    console.log('[calendar-create-event] Created Google event:', googleEvent.id);

    // Store in Olive database
    const { data: savedEvent, error: saveError } = await supabase
      .from("calendar_events")
      .insert({
        connection_id: connection.id,
        google_event_id: googleEvent.id,
        title,
        description,
        location,
        start_time: googleEvent.start.dateTime || googleEvent.start.date,
        end_time: googleEvent.end.dateTime || googleEvent.end.date,
        all_day: !googleEvent.start.dateTime,
        event_type: note_id ? 'from_note' : 'manual',
        note_id,
        etag: googleEvent.etag,
      })
      .select()
      .single();

    if (saveError) {
      console.warn('[calendar-create-event] Failed to save to local DB:', saveError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        event: {
          id: savedEvent?.id || googleEvent.id,
          google_event_id: googleEvent.id,
          title,
          start_time: googleEvent.start.dateTime || googleEvent.start.date,
          end_time: googleEvent.end.dateTime || googleEvent.end.date,
          html_link: googleEvent.htmlLink,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error('[calendar-create-event] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { user_id, notes } = await req.json();

    if (!user_id || !notes || !Array.isArray(notes)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing user_id or notes array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter to notes that have a due_date or reminder_time
    const calendarWorthy = notes.filter((n: any) => n.due_date || n.reminder_time);
    if (calendarWorthy.length === 0) {
      return new Response(
        JSON.stringify({ success: true, created: 0, message: 'No calendar-worthy notes' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if user has auto_add_to_calendar enabled
    const { data: connection, error: connError } = await supabase
      .from('calendar_connections')
      .select('id, auto_add_to_calendar, is_active, access_token, refresh_token, token_expiry, primary_calendar_id')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .maybeSingle();

    if (connError || !connection || !connection.auto_add_to_calendar) {
      return new Response(
        JSON.stringify({ success: true, created: 0, message: 'Auto-add disabled or no connection' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user's timezone from profile
    let userTimezone = 'UTC';
    try {
      const { data: profile } = await supabase
        .from('clerk_profiles')
        .select('timezone')
        .eq('id', user_id)
        .single();
      userTimezone = profile?.timezone || 'UTC';
    } catch { /* use UTC */ }

    console.log('[auto-calendar-event] Creating', calendarWorthy.length, 'events for user', user_id, 'tz:', userTimezone);

    // Refresh token if needed
    let accessToken = connection.access_token;
    const tokenExpiry = new Date(connection.token_expiry).getTime();

    if (tokenExpiry - Date.now() < 5 * 60 * 1000) {
      const clientId = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID');
      const clientSecret = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET');

      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId!,
          client_secret: clientSecret!,
          refresh_token: connection.refresh_token,
          grant_type: 'refresh_token',
        }),
      });

      if (!tokenResponse.ok) {
        console.error('[auto-calendar-event] Token refresh failed');
        await supabase
          .from('calendar_connections')
          .update({ is_active: false, error_message: 'Token refresh failed' })
          .eq('id', connection.id);
        return new Response(
          JSON.stringify({ success: false, error: 'Token refresh failed' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const newTokens = await tokenResponse.json();
      accessToken = newTokens.access_token;

      await supabase
        .from('calendar_connections')
        .update({
          access_token: accessToken,
          token_expiry: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
          error_message: null,
        })
        .eq('id', connection.id);
    }

    let createdCount = 0;
    let skippedCount = 0;

    for (const note of calendarWorthy) {
      try {
        const startTime = note.due_date || note.reminder_time;
        const startDate = new Date(startTime);
        const isAllDay = startTime.length <= 10 || (startDate.getHours() === 12 && startDate.getMinutes() === 0);

        // DUPLICATE PREVENTION: Check if a calendar event already exists for this note
        if (note.id) {
          const { data: existing } = await supabase
            .from('calendar_events')
            .select('id')
            .eq('connection_id', connection.id)
            .eq('note_id', note.id)
            .limit(1);

          if (existing && existing.length > 0) {
            console.log('[auto-calendar-event] ⏭️ Skipped (already exists):', note.summary);
            skippedCount++;
            continue;
          }
        }

        const event: any = {
          summary: note.summary || 'Olive reminder',
          description: note.original_text || '',
        };

        if (isAllDay) {
          event.start = { date: startDate.toISOString().split('T')[0] };
          const nextDay = new Date(startDate);
          nextDay.setDate(nextDay.getDate() + 1);
          event.end = { date: nextDay.toISOString().split('T')[0] };
        } else {
          event.start = { dateTime: startDate.toISOString(), timeZone: userTimezone };
          const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
          event.end = { dateTime: endDate.toISOString(), timeZone: userTimezone };
        }

        event.reminders = {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 30 },
            { method: 'popup', minutes: 1440 },
          ],
        };

        const createRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.primary_calendar_id)}/events`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(event),
          }
        );

        if (!createRes.ok) {
          const errText = await createRes.text();
          console.error('[auto-calendar-event] Failed:', errText);
          continue;
        }

        const googleEvent = await createRes.json();
        console.log('[auto-calendar-event] ✅ Created:', googleEvent.id, '-', note.summary);
        createdCount++;

        await supabase
          .from('calendar_events')
          .insert({
            connection_id: connection.id,
            google_event_id: googleEvent.id,
            title: note.summary || 'Olive reminder',
            description: note.original_text || '',
            start_time: googleEvent.start.dateTime || googleEvent.start.date,
            end_time: googleEvent.end.dateTime || googleEvent.end.date,
            all_day: !googleEvent.start.dateTime,
            event_type: 'from_note',
            note_id: note.id || null,
            etag: googleEvent.etag,
            timezone: userTimezone,
          });
      } catch (err) {
        console.error('[auto-calendar-event] Error for:', note.summary, err);
      }
    }

    return new Response(
      JSON.stringify({ success: true, created: createdCount, skipped: skippedCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('[auto-calendar-event] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

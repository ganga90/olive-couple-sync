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
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    console.log('[calendar-callback] Received callback with code:', !!code, 'state:', !!stateParam, 'error:', error);

    if (error) {
      console.error('[calendar-callback] OAuth error:', error);
      return errorRedirect(error, url.searchParams.get("error_description") || '');
    }

    if (!code || !stateParam) {
      return errorRedirect("Missing code or state parameter");
    }

    // Decode state (supports both standard and URL-safe base64)
    let state: { user_id: string; origin: string };
    try {
      let b64 = stateParam.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4 !== 0) b64 += '=';
      state = JSON.parse(atob(b64));
    } catch (e) {
      console.error('[calendar-callback] Failed to decode state:', stateParam, e);
      return errorRedirect("Invalid state parameter");
    }

    const { user_id, origin } = state;

    // Use the same redirect_uri that was used in the authorize request
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const redirectUri = `${supabaseUrl}/functions/v1/calendar-callback`;

    console.log('[calendar-callback] Processing for user:', user_id, 'redirect_uri:', redirectUri);

    // Initialize Supabase
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Exchange code for tokens
    const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      return errorRedirect("Google OAuth credentials not configured", undefined, origin);
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[calendar-callback] Token exchange failed:', tokenResponse.status, errorText);
      return errorRedirect("Token exchange failed", undefined, origin);
    }

    const tokens = await tokenResponse.json();
    console.log('[calendar-callback] Token exchange successful, expires_in:', tokens.expires_in);

    // Get user info
    const userInfoResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );

    if (!userInfoResponse.ok) {
      return errorRedirect("Failed to get user info", undefined, origin);
    }

    const userInfo = await userInfoResponse.json();
    console.log('[calendar-callback] Got user info:', userInfo.email);

    // Resolve the primary calendar identifier.
    //
    // Historical note: this used to GET /users/me/calendarList to find
    // the entry with `primary: true`. That endpoint requires the
    // calendar.calendarlist.readonly scope (or the broader `calendar`
    // scope). To pass Google's verification review, calendar-auth-url
    // was narrowed to request only `calendar.events` — which is the
    // smallest scope that lets Olive read AND write events. With that
    // narrow scope, the /calendarList GET returns 403 and the OAuth
    // flow ends in "Failed to get calendar list" right after the
    // user successfully grants permission. That's the bug we're
    // fixing here.
    //
    // The fix: don't call /calendarList. Google's Calendar API treats
    // the literal string "primary" as a reserved alias for the
    // authenticated user's primary calendar in every event-related
    // endpoint (events.list, events.insert, events.patch, channels/watch,
    // etc.). So we can store `"primary"` as the calendar id, hand it
    // to the same /calendars/{id}/events URLs we already build
    // downstream (calendar-create-event, calendar-update-event,
    // calendar-watch-register, etc.), and everything keeps working
    // with no scope change. The user-visible calendar_name falls back
    // to their email — which is what most users would recognize
    // anyway, and what Google shows for the primary calendar by
    // default when no override has been set.
    //
    // Backwards compatibility: existing connections that already
    // stored an email-based primary_calendar_id (from before the scope
    // narrowing) keep working — Google's API accepts the email form
    // too. So we DON'T migrate existing rows; we just stop creating
    // broken ones.
    const PRIMARY_CALENDAR_ID = "primary";
    const calendarDisplayName = userInfo.email || "Primary";
    console.log('[calendar-callback] Using primary calendar alias for', userInfo.email);

    // Check if Tasks scope was granted
    let tasksEnabled = false;
    try {
      const tasksCheck = await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=1", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      tasksEnabled = tasksCheck.ok;
      console.log('[calendar-callback] Tasks scope enabled:', tasksEnabled);
    } catch {
      console.log('[calendar-callback] Tasks scope not available');
    }

    // Store connection
    const { data: connection, error: insertError } = await supabase
      .from("calendar_connections")
      .upsert(
        {
          user_id,
          google_user_id: userInfo.id,
          google_email: userInfo.email,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          primary_calendar_id: PRIMARY_CALENDAR_ID,
          calendar_name: calendarDisplayName,
          calendar_type: "individual",
          sync_enabled: true,
          is_active: true,
          error_message: null,
          tasks_enabled: tasksEnabled,
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (insertError) {
      console.error('[calendar-callback] Insert error:', insertError);
      return errorRedirect("Failed to save calendar connection", undefined, origin);
    }

    console.log('[calendar-callback] Calendar connection saved:', connection.id);

    // Initialize sync state
    await supabase.from("calendar_sync_state").upsert(
      {
        connection_id: connection.id,
        sync_status: "idle",
      },
      { onConflict: "connection_id" }
    );

    // Phase 2.2 — register a Google Calendar push channel so Olive
    // gets real-time notifications when the user edits an event in
    // Google's UI. Lenient: registration failure shouldn't block the
    // OAuth completion (the user is mid-redirect waiting on us). The
    // hourly renewal cron picks up watch_state='failed' connections
    // and retries, so this gets self-healed.
    try {
      await supabase.functions.invoke("calendar-watch-register", {
        body: { connection_id: connection.id },
      });
    } catch (watchErr) {
      console.warn("[calendar-callback] watch registration failed (non-fatal):", watchErr);
    }

    // Redirect to home page after successful connection
    const redirectOrigin = origin || 'https://witholive.app';
    return new Response(null, {
      status: 303,
      headers: {
        Location: `${redirectOrigin}/home?calendar=connected`,
      },
    });
  } catch (error: unknown) {
    console.error("[calendar-callback] Error:", error);
    return errorRedirect(error instanceof Error ? error.message : 'Unknown error');
  }
});

function errorRedirect(message: string, details?: string, origin?: string) {
  const errorMessage = encodeURIComponent(message + (details ? `: ${details}` : ''));
  const redirectOrigin = origin || 'https://witholive.app';
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${redirectOrigin}/profile?calendar=error&message=${errorMessage}`,
    },
  });
}

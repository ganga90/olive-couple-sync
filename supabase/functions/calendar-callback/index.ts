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

    console.log('[calendar-callback] Received callback with code:', !!code, 'state:', !!stateParam);

    if (error) {
      console.error('[calendar-callback] OAuth error:', error);
      return errorRedirect(error, url.searchParams.get("error_description") || '');
    }

    if (!code || !stateParam) {
      return errorRedirect("Missing code or state parameter");
    }

    // Decode state
    let state: { user_id: string; origin: string };
    try {
      state = JSON.parse(atob(stateParam));
    } catch {
      return errorRedirect("Invalid state parameter");
    }

    const { user_id, origin } = state;
    const redirectUri = `${origin}/auth/google/callback`;

    console.log('[calendar-callback] Processing for user:', user_id);

    // Initialize Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Exchange code for tokens
    const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId!,
        client_secret: clientSecret!,
        redirect_uri: redirectUri,
        code,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[calendar-callback] Token exchange failed:', errorText);
      return errorRedirect("Token exchange failed");
    }

    const tokens = await tokenResponse.json();
    console.log('[calendar-callback] Token exchange successful');

    // Get user info
    const userInfoResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }
    );

    if (!userInfoResponse.ok) {
      return errorRedirect("Failed to get user info");
    }

    const userInfo = await userInfoResponse.json();
    console.log('[calendar-callback] Got user info:', userInfo.email);

    // Get user's calendars
    const calendarsResponse = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList",
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }
    );

    if (!calendarsResponse.ok) {
      return errorRedirect("Failed to get calendar list");
    }

    const calendars = await calendarsResponse.json();
    const primaryCalendar = calendars.items?.find(
      (cal: any) => cal.primary === true
    );

    if (!primaryCalendar) {
      return errorRedirect("No primary calendar found");
    }

    console.log('[calendar-callback] Found primary calendar:', primaryCalendar.summary);

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
          primary_calendar_id: primaryCalendar.id,
          calendar_name: primaryCalendar.summary,
          calendar_type: "individual",
          sync_enabled: true,
          is_active: true,
          error_message: null,
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (insertError) {
      console.error('[calendar-callback] Insert error:', insertError);
      return errorRedirect("Failed to save calendar connection");
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

    // Redirect to success page
    return new Response(null, {
      status: 303,
      headers: {
        Location: `${origin}/profile?calendar=connected`,
      },
    });
  } catch (error) {
    console.error("[calendar-callback] Error:", error);
    return errorRedirect(error.message);
  }
});

function errorRedirect(message: string, details?: string) {
  const errorMessage = encodeURIComponent(message + (details ? `: ${details}` : ''));
  return new Response(null, {
    status: 303,
    headers: {
      Location: `https://witholive.app/profile?calendar=error&message=${errorMessage}`,
    },
  });
}

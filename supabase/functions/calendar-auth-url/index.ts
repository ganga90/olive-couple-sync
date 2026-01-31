import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { user_id, redirect_origin } = await req.json();

    if (!user_id) {
      throw new Error('Missing user_id');
    }

    const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
    if (!clientId) {
      throw new Error('GOOGLE_CALENDAR_CLIENT_ID not configured');
    }

    // Use the provided redirect origin or default
    const origin = redirect_origin || 'https://witholive.app';
    const redirectUri = `${origin}/auth/google/callback`;

    const scopes = [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ];

    // Encode state with user_id and redirect origin
    const state = JSON.stringify({ user_id, origin });
    const encodedState = btoa(state);

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes.join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", encodedState);

    console.log('[calendar-auth-url] Generated auth URL for user:', user_id);

    return new Response(
      JSON.stringify({ 
        success: true,
        auth_url: authUrl.toString() 
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  } catch (error: unknown) {
    console.error('[calendar-auth-url] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

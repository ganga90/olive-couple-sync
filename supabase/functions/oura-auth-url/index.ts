import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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

    const clientId = Deno.env.get("OURA_CLIENT_ID");
    if (!clientId) {
      throw new Error('OURA_CLIENT_ID not configured');
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL not configured');
    }

    // CRITICAL FIX: Use the edge function URL as redirect_uri, NOT the frontend URL.
    // This ensures the redirect_uri is always consistent regardless of browser,
    // www vs non-www, or preview vs production environments.
    const redirectUri = `${supabaseUrl}/functions/v1/oura-callback`;

    // Store the frontend origin in the state so the callback can redirect back
    const origin = redirect_origin || 'https://witholive.app';

    const scopes = [
      "email",
      "personal",
      "daily",
      "heartrate",
      "workout",
      "session",
      "spo2",
      "tag",
    ];

    // Encode state with user_id and frontend origin using URL-safe base64
    const state = JSON.stringify({ user_id, origin });
    const encodedState = btoa(state)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const authUrl = new URL("https://cloud.ouraring.com/oauth/authorize");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes.join(" "));
    authUrl.searchParams.set("state", encodedState);

    console.log('[oura-auth-url] Generated auth URL for user:', user_id, 'redirect_uri:', redirectUri);

    return new Response(
      JSON.stringify({ success: true, auth_url: authUrl.toString() }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error('[oura-auth-url] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Email Auth URL Generator
 *
 * Generates a Google OAuth2 authorization URL for Gmail access.
 * Uses the same Google Cloud project as Calendar integration.
 * Scopes: gmail.readonly + gmail.labels (read-only, no send permission).
 *
 * Pattern: identical to oura-auth-url/index.ts
 */

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

    // Reuse same Google Cloud project as Calendar (or use dedicated Gmail creds)
    const clientId = Deno.env.get("GOOGLE_GMAIL_CLIENT_ID") || Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
    if (!clientId) {
      throw new Error('Google OAuth client ID not configured');
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL not configured');
    }

    // CRITICAL: Use the edge function URL as redirect_uri, NOT the frontend URL.
    // This ensures the redirect_uri is always consistent regardless of browser,
    // www vs non-www, or preview vs production environments.
    const redirectUri = `${supabaseUrl}/functions/v1/email-oauth-callback`;

    // Store the frontend origin in the state so the callback can redirect back
    const origin = redirect_origin || 'https://witholive.app';

    // Gmail read-only scopes — never request send permission
    const scopes = [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.labels",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ];

    // Encode state with user_id and frontend origin using URL-safe base64
    const state = JSON.stringify({ user_id, origin });
    const encodedState = btoa(state)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes.join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", encodedState);

    console.log('[email-auth-url] Generated auth URL for user:', user_id, 'redirect_uri:', redirectUri);

    return new Response(
      JSON.stringify({ success: true, auth_url: authUrl.toString() }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error('[email-auth-url] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

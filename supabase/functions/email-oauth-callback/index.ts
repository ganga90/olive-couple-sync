/**
 * Email OAuth Callback Handler
 *
 * Handles the Google OAuth2 callback for Gmail integration.
 * Exchanges authorization code for tokens, fetches user info,
 * and stores the connection in olive_email_connections.
 *
 * Pattern: identical to oura-callback/index.ts
 */

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

    console.log('[email-callback] Received callback with code:', !!code, 'state:', !!stateParam, 'error:', error);

    if (error) {
      console.error('[email-callback] OAuth error:', error);
      return errorRedirect(error);
    }

    if (!code || !stateParam) {
      console.error('[email-callback] Missing params. code:', !!code, 'state:', !!stateParam);
      return errorRedirect("Missing code or state parameter");
    }

    // Decode state (supports both standard and URL-safe base64)
    let state: { user_id: string; origin: string };
    try {
      let b64 = stateParam.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4 !== 0) b64 += '=';
      state = JSON.parse(atob(b64));
    } catch (e) {
      console.error('[email-callback] Failed to decode state:', stateParam, e);
      return errorRedirect("Invalid state parameter");
    }

    const { user_id, origin } = state;

    // Use the same redirect_uri that was used in the authorize request
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const redirectUri = `${supabaseUrl}/functions/v1/email-oauth-callback`;

    console.log('[email-callback] Processing for user:', user_id, 'redirect_uri:', redirectUri);

    // Initialize Supabase with service role
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const clientId = Deno.env.get("GOOGLE_GMAIL_CLIENT_ID") || Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_GMAIL_CLIENT_SECRET") || Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      return errorRedirect("Google OAuth credentials not configured", origin);
    }

    // Exchange code for tokens
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
      console.error('[email-callback] Token exchange failed:', tokenResponse.status, errorText);
      return errorRedirect("Token exchange failed", origin);
    }

    const tokens = await tokenResponse.json();
    console.log('[email-callback] Token exchange successful, expires_in:', tokens.expires_in);

    // Get user info from Google
    const userInfoRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );

    let emailAddress: string | null = null;

    if (userInfoRes.ok) {
      const userInfo = await userInfoRes.json();
      emailAddress = userInfo.email || null;
      console.log('[email-callback] Got user info, email:', emailAddress);
    } else {
      console.warn('[email-callback] Could not fetch user info, continuing without');
    }

    // Calculate token expiry
    const tokenExpiry = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    // Store connection (upsert by user_id unique constraint)
    const { data: connection, error: insertError } = await supabase
      .from("olive_email_connections")
      .upsert(
        {
          user_id,
          provider: 'gmail',
          email_address: emailAddress,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expiry: tokenExpiry,
          scopes: ['gmail.readonly', 'gmail.labels', 'userinfo.email', 'userinfo.profile'],
          is_active: true,
          error_message: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (insertError) {
      console.error('[email-callback] Insert error:', insertError);
      return errorRedirect("Failed to save email connection", origin);
    }

    console.log('[email-callback] Email connection saved:', connection.id);

    // Redirect back to the frontend profile page with success
    const redirectOrigin = origin || 'https://witholive.app';
    return new Response(null, {
      status: 303,
      headers: { Location: `${redirectOrigin}/profile?email=connected` },
    });
  } catch (error: unknown) {
    console.error("[email-callback] Error:", error);
    return errorRedirect(error instanceof Error ? error.message : 'Unknown error');
  }
});

function errorRedirect(message: string, origin?: string) {
  const errorMessage = encodeURIComponent(message);
  const redirectOrigin = origin || 'https://witholive.app';
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${redirectOrigin}/profile?email=error&message=${errorMessage}`,
    },
  });
}

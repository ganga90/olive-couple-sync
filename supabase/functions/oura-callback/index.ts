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

    console.log('[oura-callback] Received callback with code:', !!code, 'state:', !!stateParam);

    if (error) {
      console.error('[oura-callback] OAuth error:', error);
      return errorRedirect(error);
    }

    if (!code || !stateParam) {
      return errorRedirect("Missing code or state parameter");
    }

    // Decode state (supports both standard and URL-safe base64)
    let state: { user_id: string; origin: string };
    try {
      // Restore URL-safe base64 to standard base64
      let b64 = stateParam.replace(/-/g, '+').replace(/_/g, '/');
      // Re-add padding
      while (b64.length % 4 !== 0) b64 += '=';
      state = JSON.parse(atob(b64));
    } catch (e) {
      console.error('[oura-callback] Failed to decode state:', stateParam, e);
      return errorRedirect("Invalid state parameter");
    }

    const { user_id, origin } = state;
    const redirectUri = `${origin}/auth/oura/callback`;

    console.log('[oura-callback] Processing for user:', user_id);

    // Initialize Supabase with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const clientId = Deno.env.get("OURA_CLIENT_ID");
    const clientSecret = Deno.env.get("OURA_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      return errorRedirect("Oura credentials not configured", origin);
    }

    // Exchange code for tokens
    const tokenResponse = await fetch("https://api.ouraring.com/oauth/token", {
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
      console.error('[oura-callback] Token exchange failed:', errorText);
      return errorRedirect("Token exchange failed", origin);
    }

    const tokens = await tokenResponse.json();
    console.log('[oura-callback] Token exchange successful, expires_in:', tokens.expires_in);

    // Get user personal info from Oura
    const personalInfoRes = await fetch(
      "https://api.ouraring.com/v2/usercollection/personal_info",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );

    let ouraEmail: string | null = null;
    let ouraUserId: string | null = null;

    if (personalInfoRes.ok) {
      const personalInfo = await personalInfoRes.json();
      ouraEmail = personalInfo.email || null;
      ouraUserId = personalInfo.id || null;
      console.log('[oura-callback] Got personal info, email:', ouraEmail);
    } else {
      console.warn('[oura-callback] Could not fetch personal info, continuing without');
    }

    // Calculate token expiry
    const tokenExpiry = tokens.expires_in 
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    // Store connection (upsert by user_id unique constraint)
    const { data: connection, error: insertError } = await supabase
      .from("oura_connections")
      .upsert(
        {
          user_id,
          oura_user_id: ouraUserId,
          oura_email: ouraEmail,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expiry: tokenExpiry,
          is_active: true,
          error_message: null,
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (insertError) {
      console.error('[oura-callback] Insert error:', insertError);
      return errorRedirect("Failed to save Oura connection", origin);
    }

    console.log('[oura-callback] Oura connection saved:', connection.id);

    // Redirect back to profile with success
    return new Response(null, {
      status: 303,
      headers: { Location: `${origin}/profile?oura=connected` },
    });
  } catch (error: unknown) {
    console.error("[oura-callback] Error:", error);
    return errorRedirect(error instanceof Error ? error.message : 'Unknown error');
  }
});

function errorRedirect(message: string, origin?: string) {
  const errorMessage = encodeURIComponent(message);
  const redirectOrigin = origin || 'https://witholive.app';
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${redirectOrigin}/profile?oura=error&message=${errorMessage}`,
    },
  });
}

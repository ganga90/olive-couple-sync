import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature',
};

interface ClerkUser {
  id: string;
  first_name?: string;
  last_name?: string;
  email_addresses: Array<{
    email_address: string;
    id: string;
  }>;
  created_at: number;
  updated_at: number;
}

// Verify Clerk/Svix webhook signature
async function verifyWebhookSignature(
  payload: string,
  headers: { svixId: string; svixTimestamp: string; svixSignature: string },
  secret: string
): Promise<boolean> {
  try {
    // Decode the base64 secret (Clerk secrets are prefixed with "whsec_")
    const secretKey = secret.replace('whsec_', '');
    const secretBytes = Uint8Array.from(atob(secretKey), c => c.charCodeAt(0));

    // Construct the signed payload
    const signedPayload = `${headers.svixId}.${headers.svixTimestamp}.${payload}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(signedPayload);

    // Import the key for HMAC
    const key = await crypto.subtle.importKey(
      'raw',
      secretBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // Sign the payload
    const signature = await crypto.subtle.sign('HMAC', key, data);
    const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));

    // Clerk sends multiple signatures separated by spaces, check against all of them
    const signatures = headers.svixSignature.split(' ');
    for (const sig of signatures) {
      // Format is "v1,<base64-signature>"
      const [version, sigValue] = sig.split(',');
      if (version === 'v1' && sigValue === expectedSignature) {
        return true;
      }
    }

    // Check timestamp is within 5 minutes
    const timestamp = parseInt(headers.svixTimestamp);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > 300) {
      console.error('Webhook timestamp too old:', { timestamp, now, diff: Math.abs(now - timestamp) });
      return false;
    }

    return false;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get webhook secret from environment
    const CLERK_WEBHOOK_SECRET = Deno.env.get('CLERK_WEBHOOK_SECRET');
    
    if (!CLERK_WEBHOOK_SECRET) {
      console.error('CLERK_WEBHOOK_SECRET not configured');
      return new Response(
        JSON.stringify({ error: 'Webhook secret not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract Svix headers for signature verification
    const svixId = req.headers.get('svix-id');
    const svixTimestamp = req.headers.get('svix-timestamp');
    const svixSignature = req.headers.get('svix-signature');

    if (!svixId || !svixTimestamp || !svixSignature) {
      console.error('Missing Svix headers:', { svixId: !!svixId, svixTimestamp: !!svixTimestamp, svixSignature: !!svixSignature });
      return new Response(
        JSON.stringify({ error: 'Missing webhook signature headers' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the raw payload for signature verification
    const payload = await req.text();

    // Verify the webhook signature
    const isValid = await verifyWebhookSignature(
      payload,
      { svixId, svixTimestamp, svixSignature },
      CLERK_WEBHOOK_SECRET
    );

    if (!isValid) {
      console.error('Invalid webhook signature');
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse the verified payload
    const body = JSON.parse(payload);
    const { type, data: webhookData } = body;

    console.log('Received verified Clerk webhook:', type);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    if (type === 'user.created' || type === 'user.updated') {
      const clerkUser = webhookData as ClerkUser;
      
      // Upsert user profile
      const { error: profileError } = await supabaseClient
        .from('profiles')
        .upsert({
          id: clerkUser.id,
          display_name: clerkUser.first_name ? 
            `${clerkUser.first_name} ${clerkUser.last_name || ''}`.trim() : 
            clerkUser.email_addresses[0]?.email_address.split('@')[0] || 'User',
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'id'
        });

      if (profileError) {
        console.error('Profile upsert error:', profileError);
        return new Response(
          JSON.stringify({ error: 'Failed to sync profile' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      console.log('Successfully synced Clerk user:', clerkUser.id);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Clerk sync error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

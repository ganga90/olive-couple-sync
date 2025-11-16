import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get JWT from Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER')!;

    // Create Supabase client with user's JWT
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    // Get user from JWT
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate a unique token
    const linkToken = `LINK_${Array.from({ length: 12 }, () => 
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]
    ).join('')}`;

    // Store token in database (expires in 10 minutes)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    
    const { error: insertError } = await supabase
      .from('linking_tokens')
      .insert({
        token: linkToken,
        user_id: user.id,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error('Error creating linking token:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to create linking token' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate WhatsApp deep link
    const message = encodeURIComponent(`My Olive Token is ${linkToken}`);
    const whatsappNumber = TWILIO_PHONE_NUMBER.replace(/\D/g, ''); // Remove non-digits
    const whatsappLink = `https://wa.me/${whatsappNumber}?text=${message}`;

    return new Response(
      JSON.stringify({ 
        token: linkToken,
        whatsappLink,
        expiresAt,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Generate WhatsApp link error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

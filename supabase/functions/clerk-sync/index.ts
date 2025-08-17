import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: { user } } = await supabaseClient.auth.getUser(
      req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    );

    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { type, data: webhookData } = body;

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
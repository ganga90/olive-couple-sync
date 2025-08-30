import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,content-type,x-client-info,apikey",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    const DG_KEY = Deno.env.get("DEEPGRAM_OLIVEAI");
    if (!DG_KEY) {
      console.error("Missing DEEPGRAM_OLIVEAI environment variable");
      return new Response(JSON.stringify({ error: "Missing Deepgram key" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Default TTL of 5 minutes, allow customization
    let ttl = 300;
    try {
      const body = await req.json();
      if (body?.ttl && Number.isFinite(body.ttl)) {
        ttl = Math.max(60, Math.min(900, body.ttl)); // Between 1-15 minutes
      }
    } catch (_) {
      // If no body or invalid JSON, use default TTL
    }

    console.log(`Requesting Deepgram token with TTL: ${ttl}s`);

    // Request ephemeral token from Deepgram
    const response = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        "Authorization": `Token ${DG_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl }),
    });

    const responseData = await response.json();
    
    if (!response.ok) {
      console.error("Deepgram token request failed:", responseData);
      return new Response(JSON.stringify({ 
        error: "Failed to generate token",
        details: responseData 
      }), {
        status: response.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    console.log("Deepgram token generated successfully");

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });

  } catch (error: any) {
    console.error("Error in dg-token function:", error);
    return new Response(JSON.stringify({ 
      error: "Internal server error",
      message: error.message 
    }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
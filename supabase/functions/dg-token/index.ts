import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const ALLOWED_ORIGINS = [
  "https://fe28fe11-6f80-433f-aa49-de1399a1110c.sandbox.lovable.dev",
  "http://localhost:5173",
];

function cors(origin: string | null) {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin ?? "")
    ? origin!
    : "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors(req.headers.get("origin")) });
  }

  try {
    const DG_KEY = Deno.env.get("DEEPGRAM_OLIVEAI");
    if (!DG_KEY) {
      console.error("Missing DEEPGRAM_OLIVEAI environment variable");
      return new Response(JSON.stringify({ 
        error: "Missing Deepgram key", 
        message: "Voice input requires a valid Deepgram API key. Please configure DEEPGRAM_OLIVEAI secret." 
      }), {
        status: 500,
        headers: { "content-type": "application/json", ...cors(req.headers.get("origin")) },
      });
    }

    console.log("Deepgram key found, length:", DG_KEY.length);

    // Optional: TTL can be passed from client; default to 300s
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

    // Deepgram token grant
    const dgRes = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${DG_KEY}`, // Deepgram requires Token, not Bearer
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl }),
    });

    console.log("Deepgram response status:", dgRes.status);

    if (!dgRes.ok) {
      const txt = await dgRes.text();
      console.error("Deepgram grant failed - Status:", dgRes.status, "Response:", txt);
      
      // Parse the error to provide better feedback
      let errorMessage = "Deepgram API error";
      try {
        const errorData = JSON.parse(txt);
        if (errorData.err_code === "FORBIDDEN") {
          errorMessage = "Invalid or insufficient Deepgram API key permissions. Please check your Deepgram API key.";
        }
      } catch (_) {
        // Use generic message if can't parse error
      }
      
      return new Response(JSON.stringify({ 
        error: errorMessage, 
        details: txt,
        status: dgRes.status 
      }), {
        status: 502,
        headers: { "content-type": "application/json", ...cors(req.headers.get("origin")) },
      });
    }

    const token = await dgRes.json(); // { access_token, expires_in }
    console.log("Deepgram token generated successfully");

    return new Response(JSON.stringify(token), {
      status: 200,
      headers: { "content-type": "application/json", ...cors(req.headers.get("origin")) },
    });
  } catch (e) {
    console.error("Error in dg-token function:", e);
    return new Response(JSON.stringify({ 
      error: "Unexpected error", 
      details: String(e),
      message: "An unexpected error occurred while requesting Deepgram token"
    }), {
      status: 500,
      headers: { "content-type": "application/json", ...cors(req.headers.get("origin")) },
    });
  }
});
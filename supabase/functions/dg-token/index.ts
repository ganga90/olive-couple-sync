// supabase/functions/dg-token/index.ts
// Public endpoint: returns a short-lived Deepgram token.
// Requires the secret "DEEPGRAM_OLIVEAI" in Supabase.

const ALLOWED_ORIGINS = new Set<string>([
  "http://localhost:3000",
  "http://localhost:5173",
  "https://preview--olive-couple-sync.lovable.app",
  "https://olive-couple-sync.lovable.app",
  "https://id-preview--fe28fe11-6f80-433f-aa49-de1399a1110c.lovable.app", // Current preview URL
]);

const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://preview--olive-couple-sync.lovable.app",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin",
  "Content-Type": "application/json",
});

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors(origin) });
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
        headers: cors(origin),
      });
    }

    console.log("Deepgram key found, attempting to create temporary token");

    // Optional: TTL can be passed from client; default to 60s
    let ttl = 60;
    try {
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (body.ttl && typeof body.ttl === 'number' && body.ttl > 0 && body.ttl <= 3600) {
          ttl = body.ttl;
        }
      }
    } catch {
      // Use default TTL if no body or invalid
    }

    // Create a temporary Deepgram key with a short TTL and limited scope.
    // Deepgram recommends this pattern to protect your main key.
    const dgRes = await fetch("https://api.deepgram.com/v1/keys", {
      method: "POST",
      headers: {
        "Authorization": `Token ${DG_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        comment: "olive-browser-temp",
        time_to_live_in_seconds: ttl,
        // Minimal scope to connect to Live listen:
        scopes: ["usage:write"],
      }),
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
        headers: cors(origin),
      });
    }

    const json = await dgRes.json();
    console.log("Successfully created temporary Deepgram token");
    
    // Deepgram returns { key: "dg_temp_xxx", ... }
    return new Response(JSON.stringify({ token: json.key, expires_in: ttl }), {
      status: 200,
      headers: cors(origin),
    });
  } catch (e) {
    console.error("Error in dg-token function:", e);
    return new Response(JSON.stringify({ 
      error: "Unexpected error", 
      details: String(e),
      message: "An unexpected error occurred while requesting Deepgram token"
    }), {
      status: 500,
      headers: cors(origin),
    });
  }
});
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "https://preview--olive-couple-sync.lovable.app",
  "https://olive-couple-sync.lovable.app",
  "https://fe28fe11-6f80-433f-aa49-de1399a1110c.sandbox.lovable.dev",
]);

function cors(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://preview--olive-couple-sync.lovable.app";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors(origin) });
  }

  try {
    const DG_KEY = Deno.env.get("DEEPGRAM_OLIVE_AI");
    if (!DG_KEY) {
      return new Response(JSON.stringify({
        error: "Missing Deepgram key",
        message: "Set DEEPGRAM_OLIVE_AI function secret in Supabase.",
      }), { status: 500, headers: cors(origin) });
    }

    // Optional TTL; default 60s
    let ttl = 60;
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.ttl === "number" && body.ttl > 0 && body.ttl <= 3600) ttl = body.ttl;
    }

    // Correct endpoint for token-based auth:
    const dgRes = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        "Authorization": `Token ${DG_KEY}`,   // IMPORTANT: 'Token ' prefix
        "Content-Type": "application/json",
      },
      // Omit scopes to inherit from API key; fewer 4xx surprises.
      body: JSON.stringify({ time_to_live_in_seconds: ttl }),
    });

    const txt = await dgRes.text();
    if (!dgRes.ok) {
      return new Response(JSON.stringify({
        error: "Deepgram API error",
        details: txt,
        status: dgRes.status,
      }), { status: 502, headers: cors(origin) });
    }

    const { access_token } = JSON.parse(txt);
    if (!access_token) {
      return new Response(JSON.stringify({
        error: "Deepgram API error",
        details: "No access_token in response",
      }), { status: 502, headers: cors(origin) });
    }

    return new Response(JSON.stringify({ access_token, expires_in: ttl }), {
      status: 200,
      headers: cors(origin),
    });
  } catch (e) {
    return new Response(JSON.stringify({
      error: "Unexpected error",
      details: String(e),
    }), { status: 500, headers: cors(origin) });
  }
});
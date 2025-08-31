// supabase/functions/dg-token/index.ts
// Public endpoint: returns a short-lived Deepgram token.
// Requires Supabase Edge Function Secret: DEEPGRAM_OLIVE_AI (new name).
// Backward-compat: also accepts DEEPGRAM_OLIVEAI if present.

const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "https://preview--olive-couple-sync.lovable.app",
  "https://olive-couple-sync.lovable.app",
]);

const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Vary": "Origin",
  "Content-Type": "application/json"
});

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors(origin) });
  }

  try {
    // NEW: read the renamed secret; fallback to old name if present
    const DG_KEY =
      Deno.env.get("DEEPGRAM_OLIVE_AI") ?? // ✅ new name
      Deno.env.get("DEEPGRAM_OLIVEAI");    // legacy, if still set

    if (!DG_KEY) {
      // Use 401 to make the problem clear (not server error)
      return new Response(
        JSON.stringify({
          error: "Missing Deepgram key",
          message:
            "Set the Edge Function secret DEEPGRAM_OLIVE_AI in Supabase (Edge Functions → dg-token → Secrets).",
        }),
        { status: 401, headers: cors(origin) }
      );
    }

    // Optional: quick health probe
    if (req.method === "GET" && new URL(req.url).searchParams.get("health") === "1") {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors(origin) });
    }

    // TTL input (default 60s, keep it short for browser tokens)
    let ttl = 60;
    if (req.method === "POST") {
      try {
        const body = await req.json().catch(() => ({}));
        if (typeof body.ttl === "number") {
          ttl = Math.max(30, Math.min(body.ttl, 600));
        }
      } catch {
        // ignore and use default
      }
    }

    // Create temporary access token for browser use via grant endpoint
    const dgRes = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        // Deepgram expects "Token <API_KEY>" (not Bearer) for this call
        Authorization: `Token ${DG_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl }),
    });

    if (!dgRes.ok) {
      const txt = await dgRes.text();
      return new Response(
        JSON.stringify({
          error: "Deepgram API error",
          details: txt,
          status: dgRes.status,
        }),
        { status: 502, headers: cors(origin) }
      );
    }

    const { access_token, expires_in } = await dgRes.json();

    return new Response(
      JSON.stringify({
        token: access_token,     // IMPORTANT: access_token, not key
        expires_in: expires_in ?? ttl,
      }),
      { status: 200, headers: cors(origin) }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: "Unexpected error",
        details: String(e),
        message: "An unexpected error occurred while requesting Deepgram token",
      }),
      { status: 500, headers: cors(origin) }
    );
  }
});
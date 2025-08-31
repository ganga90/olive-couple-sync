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
  "Access-Control-Allow-Origin":
    origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://preview--olive-couple-sync.lovable.app",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers":
    // allow Supabase gateway + fetch() defaults
    "Content-Type, Authorization, apikey, x-client-info, x-supabase-authorization",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
  "Content-Type": "application/json",
});

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors(origin) });
  }

  try {
    // NEW: read the renamed secret; fallback to old name if present
    const DG_KEY =
      Deno.env.get("DEEPGRAM_OLIVE_AI") || // ✅ new name
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

    // TTL input (default 120s)
    let ttl = 120;
    if (req.method === "POST") {
      try {
        const body = await req.json().catch(() => ({}));
        if (body.ttl && typeof body.ttl === "number" && body.ttl > 0 && body.ttl <= 3600) {
          ttl = body.ttl;
        }
      } catch {
        // ignore and use default
      }
    }

    // Create ephemeral Deepgram key with listen permissions
    // Some accounts expect "listen:stream", others "listen".
    // Try ":stream" first; if 403, fall back to plain "listen".
    const attemptCreateKey = async (scopes: string[]) => {
      return fetch("https://api.deepgram.com/v1/keys", {
        method: "POST",
        headers: {
          Authorization: `Token ${DG_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          comment: "olive-browser-temp",
          time_to_live_in_seconds: ttl,
          scopes,
        }),
      });
    };

    let dgRes = await attemptCreateKey(["usage:write", "listen:stream"]);
    if (dgRes.status === 403) {
      // fallback for accounts that use "listen"
      dgRes = await attemptCreateKey(["usage:write", "listen"]);
    }

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

    const json = await dgRes.json(); // { key: "dg_temp_..." , ... }

    return new Response(
      JSON.stringify({
        token: json.key,
        expires_in: ttl,
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
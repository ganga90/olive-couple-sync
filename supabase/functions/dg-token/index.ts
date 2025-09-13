const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:5173',
  'https://preview--olive-couple-sync.lovable.app',
  'https://olive-couple-sync.lovable.app',
  'https://fe28fe11-6f80-433f-aa49-de1399a1110c.sandbox.lovable.dev',
]);

const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : 'https://preview--olive-couple-sync.lovable.app',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Vary': 'Origin',
  'Content-Type': 'application/json'
});

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });

  const DG_KEY = Deno.env.get('DEEPGRAM_OLIVE_AI');
  if (!DG_KEY) {
    return new Response(JSON.stringify({
      error: 'Missing Deepgram key',
      message: 'Set DEEPGRAM_OLIVE_AI in Supabase Edge Function secrets.'
    }), { status: 500, headers: cors(origin) });
  }

  let ttl = 300;
  try {
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (typeof body.ttl === 'number' && body.ttl > 0 && body.ttl <= 3600) ttl = body.ttl;
    }
  } catch { /* ignore */ }

  const res = await fetch('https://api.deepgram.com/v1/keys', {
    method: 'POST',
    headers: {
      // IMPORTANT: Deepgram expects "Token <key>" format
      'Authorization': `Token ${DG_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      comment: 'olive-browser-ephemeral',
      time_to_live_in_seconds: ttl,
      scopes: [
        'listen:stream',  // ✅ REQUIRED for Live WS
        'usage:write'     // good to keep
      ]
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return new Response(JSON.stringify({
      error: 'Deepgram API error',
      details: text,
      status: res.status
    }), { status: 502, headers: cors(origin) });
  }

  const json = await res.json(); // { key, ... } from /v1/keys endpoint
  return new Response(JSON.stringify({ token: json.key }), { status: 200, headers: cors(origin) });
});
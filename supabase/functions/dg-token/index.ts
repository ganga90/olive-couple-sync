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

  const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST',
    headers: {
      // IMPORTANT: Deepgram expects "Token <key>" format
      'Authorization': `Token ${DG_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return new Response(JSON.stringify({
      error: 'Deepgram API error',
      details: text,
      status: res.status
    }), { status: 502, headers: cors(origin) });
  }

  const json = await res.json(); // { access_token, expires_in }
  return new Response(JSON.stringify({ token: json.access_token }), { status: 200, headers: cors(origin) });
});
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:5173',
  'https://preview--olive-couple-sync.lovable.app',
  'https://olive-couple-sync.lovable.app'
]);

function cors(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://preview--olive-couple-sync.lovable.app',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Vary': 'Origin',
    'Content-Type': 'application/json'
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors(origin) });
  }

  const DG_KEY = Deno.env.get('DEEPGRAM_OLIVE_AI');
  if (!DG_KEY) {
    return new Response(JSON.stringify({ error: 'Missing Deepgram key' }), { status: 500, headers: cors(origin) });
  }

  // TTL can be tuned; 60s is fine for a single recording UX
  const ttl = 60;

  // IMPORTANT: do NOT over-specify scopes unless you must.
  // Tokens inherit privileges of your API key; overly strict scopes often cause 1006 handshakes.
  const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST',
    headers: { 'Authorization': `Token ${DG_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ time_to_live_in_seconds: ttl })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return new Response(JSON.stringify({ error: 'Deepgram API error', details: txt, status: res.status }), {
      status: 502,
      headers: cors(origin)
    });
  }

  const json = await res.json();
  // Normalize the field name so the client code is dead simple:
  const access_token = json?.token || json?.access_token || json?.key;
  if (!access_token) {
    return new Response(JSON.stringify({ error: 'Deepgram did not return a token', raw: json }), {
      status: 502,
      headers: cors(origin)
    });
  }

  return new Response(JSON.stringify({ access_token, expires_in: ttl }), {
    status: 200,
    headers: cors(origin)
  });
});
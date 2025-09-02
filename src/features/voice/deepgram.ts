export async function fetchDeepgramAccessToken(ttl = 300): Promise<string> {
  const url = `https://wtfspzvcetxmcfftwonq.supabase.co/functions/v1/dg-token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ ttl }),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Failed to fetch Deepgram token (${res.status}): ${txt}`);

  let json: any = {};
  try { json = JSON.parse(txt); } catch { throw new Error(`Bad JSON from dg-token: ${txt}`); }

  const token = json.access_token || json.token || json.key;
  if (!token) throw new Error(`No token field in dg-token response: ${txt}`);

  return token;
}

function getSupportedMime(): string | null {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/webm'
  ];
  for (const m of candidates) {
    if ((window as any).MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

function buildDeepgramWsUrl(token: string, opts?: {pcm?: boolean; sampleRate?: number}) {
  const base = 'wss://api.deepgram.com/v1/listen';
  const params = new URLSearchParams({
    model: 'nova-2',
    smart_format: 'true',
    interim_results: 'true',
    punctuate: 'true',
  });

  if (opts?.pcm) {
    params.set('encoding', 'linear16');
    params.set('sample_rate', String(opts.sampleRate ?? 16000));
  }

  // IMPORTANT: token via query param (browser-safe)
  params.set('token', token);

  return `${base}?${params.toString()}`;
}

// OPUS sender (Chrome/Edge/Firefox)
async function startOpusSender(stream: MediaStream, ws: WebSocket) {
  const mime = getSupportedMime();
  if (!mime) throw new Error('No OPUS mime supported');

  const rec = new MediaRecorder(stream, { mimeType: mime });
  rec.ondataavailable = async (e) => {
    if (e.data && e.data.size > 0 && ws.readyState === ws.OPEN) {
      const buf = await e.data.arrayBuffer();
      ws.send(buf);
    }
  };
  rec.start(250); // 250ms chunks
  return () => rec.state !== 'inactive' && rec.stop();
}

// PCM sender (Safari fallback)
async function startPcmSender(stream: MediaStream, ws: WebSocket, sampleRate = 16000) {
  const ctx = new AudioContext({ sampleRate });
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  
  proc.onaudioprocess = (e) => {
    if (ws.readyState !== ws.OPEN) return;
    const input = e.inputBuffer.getChannelData(0);
    // Float32 [-1,1] -> Int16 PCM
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    ws.send(pcm.buffer);
  };
  
  src.connect(proc);
  proc.connect(ctx.destination);
  
  return () => { 
    proc.disconnect(); 
    src.disconnect(); 
    ctx.close(); 
  };
}

export async function startDeepgramLive(
  onTranscript: (text: string, isFinal: boolean) => void
): Promise<{ stop: () => void }> {
  const token = await fetchDeepgramAccessToken(300);
  
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const opusOk = !!getSupportedMime();
  const wsUrl = buildDeepgramWsUrl(token, { pcm: !opusOk, sampleRate: opusOk ? undefined : 16000 });
  
  console.log('[Deepgram] Connecting to:', wsUrl.replace(/token=[^&]+/, 'token=***'));
  
  const ws = new WebSocket(wsUrl);
  let stopSender: (() => void) | null = null;
  let sending = false;

  return new Promise((resolve, reject) => {
    const hardStop = () => {
      console.log('[Deepgram] Hard stop called');
      stopSender?.();
      stream.getTracks().forEach(t => t.stop());
      if (ws.readyState === ws.OPEN) ws.close();
    };

    ws.onopen = async () => {
      try {
        stopSender = opusOk
          ? await startOpusSender(stream, ws)
          : await startPcmSender(stream, ws, 16000);
        sending = true;
        console.log('[Deepgram] Streaming started:', opusOk ? 'OPUS' : 'PCM');
        resolve({ stop: hardStop });
      } catch (e) {
        console.error('[Deepgram] Start sender failed:', e);
        hardStop();
        reject(e);
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        // Deepgram's shape: msg.channel.alternatives[0].transcript, msg.is_final
        const alt = msg?.channel?.alternatives?.[0];
        const transcript = alt?.transcript ?? '';
        if (!transcript) return;

        console.log('[Deepgram] Transcript:', transcript, 'Final:', msg.is_final);
        
        onTranscript(transcript, !!msg.is_final);
      } catch (e) {
        // Some frames (e.g., metadata) aren't results; ignore
        console.log('[Deepgram] Non-transcript message:', ev.data);
      }
    };

    ws.onerror = (e) => {
      console.error('[Deepgram] WS error:', e);
      reject(new Error('WebSocket connection failed'));
    };

    ws.onclose = (e) => {
      console.log('[Deepgram] Closed:', e.code, e.reason);
      sending = false;
      stopSender?.();
      stream.getTracks().forEach(t => t.stop());
    };

    // Timeout to prevent hanging
    setTimeout(() => {
      if (!sending) {
        console.error('[Deepgram] Connection timeout');
        hardStop();
        reject(new Error('Connection timeout'));
      }
    }, 10000);
  });
}
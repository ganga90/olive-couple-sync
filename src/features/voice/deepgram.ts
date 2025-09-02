// We now use WebSocket relay instead of direct token fetching

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

function buildDeepgramRelayUrl() {
  // Connect to our Supabase Edge Function WebSocket relay
  return 'wss://wtfspzvcetxmcfftwonq.supabase.co/functions/v1/deepgram-relay';
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
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const opusOk = !!getSupportedMime();
  const wsUrl = buildDeepgramRelayUrl();
  
  console.log('[Deepgram] Connecting to relay:', wsUrl);
  
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
      console.log('[Deepgram] WebSocket opened, waiting for relay connection...');
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        
        // Handle relay connection confirmation
        if (msg.type === 'connected') {
          console.log('[Deepgram] Relay connected, starting audio stream');
          startAudioStream();
          return;
        }

        // Handle relay errors
        if (msg.type === 'error') {
          console.error('[Deepgram] Relay error:', msg.message);
          hardStop();
          reject(new Error(msg.message));
          return;
        }

        // Handle transcript messages from Deepgram
        const alt = msg?.channel?.alternatives?.[0];
        const transcript = alt?.transcript ?? '';
        if (!transcript) return;

        console.log('[Deepgram] Transcript:', transcript, 'Final:', msg.is_final);
        onTranscript(transcript, !!msg.is_final);
      } catch (e) {
        // Some frames might not be JSON; ignore
        console.log('[Deepgram] Non-JSON message:', ev.data);
      }
    };

    const startAudioStream = async () => {
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

    // onmessage handler moved above

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
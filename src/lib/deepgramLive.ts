// src/lib/deepgramLive.ts
type DGHandlers = {
  onOpen?: () => void;
  onError?: (err: unknown) => void;
  onClose?: (code: number, reason: string) => void;
  
  // transcription
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
};

export type DGConnection = {
  start: () => Promise<void>;
  stop: () => void;
  isOpen: () => boolean;
};

async function getSampleRate(): Promise<number> {
  // Get the input device sample rate (fallback to 48000)
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const rate = ctx.sampleRate || 48000;
    await ctx.close();
    return rate;
  } catch {
    return 48000;
  }
}

function pickMimeType(): string {
  // Prefer webm/opus; fallback to ogg/opus if needed
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
    return 'audio/webm;codecs=opus';
  }
  if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
    return 'audio/ogg;codecs=opus';
  }
  // As last resort, let browser pick (may not work everywhere)
  return '';
}

/**
 * Opens a Deepgram WebSocket with token as subprotocol: ['token', token]
 * Streams Opus chunks from MediaRecorder and emits transcripts via handlers.
 */
export function createDeepgramLive(opts: DGHandlers = {}): DGConnection {
  let ws: WebSocket | null = null;
  let rec: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let stopped = false;

  const {
    onOpen, onError, onClose,
    onInterim, onFinal
  } = opts;

  const start = async () => {
    stopped = false;

    // 1) Get ephemeral token
    const tokenRes = await fetch('https://wtfspzvcetxmcfftwonq.functions.supabase.co/dg-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // optional TTL override if you like
      body: JSON.stringify({ ttl: 300 })
    });
    if (!tokenRes.ok) {
      const txt = await tokenRes.text();
      throw new Error(`Failed to fetch Deepgram token (${tokenRes.status}): ${txt}`);
    }
    const { token } = await tokenRes.json();
    if (!token) throw new Error('Deepgram token missing from response');

    // 2) Build WS URL with params matching our recording
    const sampleRate = await getSampleRate();
    const params = new URLSearchParams({
      model: 'nova-2',
      smart_format: 'true',
      interim_results: 'true',
      vad_events: 'false',
      encoding: 'opus',
      sample_rate: String(sampleRate),
      // optional:
      punctuate: 'true',
      diarize: 'false'
    });

    // 3) Open WS with token as subprotocol
    ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, ['token', token]);

    ws.onopen = async () => {
      console.log('[Deepgram] WebSocket connected');
      onOpen?.();

      // 4) Start microphone -> MediaRecorder (Opus)
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true
        }
      });

      const mimeType = pickMimeType();
      rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      rec.ondataavailable = async (e) => {
        if (stopped || !ws || ws.readyState !== WebSocket.OPEN) return;
        if (!e.data || e.data.size === 0) return;
        const buf = await e.data.arrayBuffer();
        ws.send(buf);
      };

      rec.start(250); // ~4 chunks/sec
      console.log('[Deepgram] MediaRecorder started');
    };

    ws.onmessage = (e) => {
      // Deepgram sends JSON messages with results
      try {
        const data = JSON.parse(e.data);
        // Handle various shapes: 'type' may be 'Results', etc.
        // Current Live API: data.channel.alternatives[0].transcript, data.is_final
        const alt = data?.channel?.alternatives?.[0];
        const text = alt?.transcript?.trim();
        if (text) {
          const isFinal = !!data.is_final || data.speech_final === true;
          console.log(`[Deepgram] ${isFinal ? 'Final' : 'Interim'}:`, text);
          if (isFinal) onFinal?.(text);
          else onInterim?.(text);
        }
      } catch {
        // ignore non-JSON (keep-alives etc.)
      }
    };

    ws.onerror = (err) => {
      console.error('[Deepgram] WebSocket error:', err);
      onError?.(err);
    };

    ws.onclose = (ev) => {
      console.log('[Deepgram] WebSocket closed:', ev.code, ev.reason);
      onClose?.(ev.code, ev.reason);
      cleanup();
    };
  };

  const cleanup = () => {
    if (rec && rec.state !== 'inactive') {
      try { rec.stop(); } catch {}
    }
    rec = null;

    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'CloseStream' })); } catch {}
    }
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      try { ws.close(); } catch {}
    }
    ws = null;
  };

  const stop = () => {
    stopped = true;
    cleanup();
  };

  const isOpen = () => !!ws && ws.readyState === WebSocket.OPEN;

  return { start, stop, isOpen };
}

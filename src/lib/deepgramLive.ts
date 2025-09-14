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

    let token: string;
    
    try {
      console.log('[Deepgram] Fetching token from dg-token endpoint...');
      // 1) Get ephemeral token
      const tokenRes = await fetch('https://wtfspzvcetxmcfftwonq.supabase.co/functions/v1/dg-token', {
        method: 'GET'
      });
      
      console.log('[Deepgram] Token response status:', tokenRes.status);
      
      if (!tokenRes.ok) {
        const txt = await tokenRes.text();
        console.error('[Deepgram] Token fetch failed:', txt);
        throw new Error(`Failed to fetch Deepgram token (${tokenRes.status}): ${txt}`);
      }
      
      const tokenData = await tokenRes.json();
      console.log('[Deepgram] Token data received:', tokenData);
      
      token = tokenData.access_token;
      if (!token || typeof token !== 'string') {
        console.error('[Deepgram] No valid access_token in response:', tokenData);
        throw new Error('Deepgram access_token missing from response');
      }
      
      console.log('[Deepgram] Token received, length:', token.length);
      console.log('[Deepgram] Using temp token (first 12):', token.slice(0, 12));
      console.log('[Deepgram] Token type:', typeof token);
    } catch (error) {
      console.error('[Deepgram] Error during token fetch:', error);
      throw error;
    }

    // 2) Detect browser capabilities for audio encoding
    const sampleRate = await getSampleRate();
    const supportsOpus = typeof window.MediaRecorder !== 'undefined' && 
                        MediaRecorder.isTypeSupported('audio/webm;codecs=opus');
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    
    console.log('[Deepgram] Browser capabilities - supportsOpus:', supportsOpus, 'isSafari:', isSafari);
    
    // Use Opus for supported browsers (not Safari), PCM for Safari
    const useOpus = supportsOpus && !isSafari;
    const params = new URLSearchParams({
      model: 'nova-2',
      smart_format: 'true',
      interim_results: 'true',
      encoding: useOpus ? 'opus' : 'linear16',
      sample_rate: String(sampleRate),
      punctuate: 'true'
    });

    console.log('[Deepgram] WebSocket URL params:', params.toString());
    console.log('[Deepgram] Protocol check - token type:', typeof token, 'length:', token.length);

    // 3) Open WS with token as subprotocol (ensure raw string, not stringified)
    ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, ['token', token]);

    ws.onopen = async () => {
      console.log('[Deepgram] WebSocket connected successfully');
      onOpen?.();

      // 4) Start microphone with proper encoding path
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true
        }
      });

      if (useOpus) {
        // OPUS path (Chrome/Edge/Firefox)
        console.log('[Deepgram] Using Opus encoding path');
        const mimeType = pickMimeType();
        console.log('[Deepgram] Using MIME type:', mimeType);
        rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

        rec.ondataavailable = async (e) => {
          if (stopped || !ws || ws.readyState !== WebSocket.OPEN) return;
          if (!e.data || e.data.size === 0) return;
          const buf = await e.data.arrayBuffer();
          console.log('[Deepgram] Sending Opus audio chunk, size:', buf.byteLength);
          ws.send(buf);
        };

        rec.start(250); // ~4 chunks/sec
        console.log('[Deepgram] MediaRecorder started');
      } else {
        // PCM path (Safari)
        console.log('[Deepgram] Using PCM encoding path for Safari');
        const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext);
        const audioCtx = new AudioCtx({ sampleRate: 48000 });
        const src = audioCtx.createMediaStreamSource(stream);
        const proc = audioCtx.createScriptProcessor(4096, 1, 1);
        
        proc.onaudioprocess = (e) => {
          if (stopped || !ws || ws.readyState !== WebSocket.OPEN) return;
          const input = e.inputBuffer.getChannelData(0); // Float32 [-1..1]
          const buf = new ArrayBuffer(input.length * 2);
          const view = new DataView(buf);
          for (let i = 0; i < input.length; i++) {
            let s = Math.max(-1, Math.min(1, input[i]));
            view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
          }
          ws.send(buf);
        };
        
        src.connect(proc);
        proc.connect(audioCtx.destination);
        console.log('[Deepgram] PCM processor started');
      }
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
      console.log('[Deepgram] WebSocket closed:', ev.code, ev.reason || 'No reason provided');
      if (ev.code === 1006) {
        console.error('[Deepgram] WebSocket closed abnormally (1006) - usually authentication or protocol issue');
      }
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

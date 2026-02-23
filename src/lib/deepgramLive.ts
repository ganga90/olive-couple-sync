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
      // 1) Get ephemeral token
      const tokenRes = await fetch('https://wtfspzvcetxmcfftwonq.supabase.co/functions/v1/dg-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      
      if (!tokenRes.ok) {
        const txt = await tokenRes.text();
        console.error('[Deepgram] Token fetch failed:', txt);
        throw new Error(`Failed to fetch Deepgram token (${tokenRes.status}): ${txt}`);
      }
      
      const tokenData = await tokenRes.json();
      
      // MUST be a string like "eyJ..."
      token = tokenData.access_token as string;
      if (!token || typeof token !== 'string') {
        console.error('[Deepgram] No valid access_token in response:', tokenData);
        throw new Error('Deepgram access_token missing from response');
      }
      
    } catch (error) {
      console.error('[Deepgram] Error during token fetch:', error);
      throw error;
    }

    // 2) Detect browser capabilities for audio encoding
    const sampleRate = await getSampleRate();
    const supportsOpus = typeof window.MediaRecorder !== 'undefined' && 
                        MediaRecorder.isTypeSupported('audio/webm;codecs=opus');
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    
    
    // Use Opus for supported browsers (not Safari), PCM for Safari
    const useOpus = supportsOpus && !isSafari;
    
    function buildWsUrl() {
      const base = 'wss://api.deepgram.com/v1/listen';
      const qp = new URLSearchParams({
        model: 'nova-2',
        smart_format: 'true',
        interim_results: 'true',
        punctuate: 'true',
        // Encoding & rate depend on browser:
        encoding: useOpus ? 'opus' : 'linear16',
        sample_rate: '48000'
      });
      return `${base}?${qp.toString()}`;
    }


    // 3) Open WS with token as subprotocol (ensure raw string, not stringified)
    ws = new WebSocket(buildWsUrl(), ['token', token]); // <- raw string token
    ws.binaryType = 'arraybuffer';

    ws.onopen = async () => {
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
        const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        
        rec.ondataavailable = async (e) => {
          if (stopped || !ws || ws.readyState !== WebSocket.OPEN) return;
          if (!e.data || e.data.size === 0) return;
          const buf = await e.data.arrayBuffer();
          ws.send(buf);
        };

        rec.start(250); // ~4 chunks/sec
        
        // Store cleanup function
        (window as any).__dg_stop = () => { 
          try { rec.stop(); } catch {} 
          ws.close(); 
          stream.getTracks().forEach(t => t.stop()); 
        };
      } else {
        // PCM path (Safari)
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
        
        // Store cleanup function
        (window as any).__dg_stop = () => { 
          proc.disconnect(); 
          src.disconnect(); 
          audioCtx.close(); 
          ws.close(); 
          stream.getTracks().forEach(t => t.stop()); 
        };
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        const alt = msg?.channel?.alternatives?.[0];
        if (!alt?.transcript) return;
        
        const text = alt.transcript.trim();
        const isFinal = !!msg?.is_final;
        
        if (isFinal) onFinal?.(text);
        else onInterim?.(text);
      } catch {
        // ignore non-JSON (keep-alives etc.)
      }
    };

    ws.onerror = (e) => {
      console.error('[Deepgram] WebSocket error:', e);
      onError?.(e);
    };

    ws.onclose = (e) => {
      if (e.code === 1006) {
        console.error('[Deepgram] WebSocket closed abnormally (1006) - usually authentication or protocol issue');
      }
      onClose?.(e.code, e.reason);
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

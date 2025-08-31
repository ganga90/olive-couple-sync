import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';

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

export function browserSupportsOpus(): boolean {
  const mr = (window as any).MediaRecorder;
  if (!mr) return false;
  return mr.isTypeSupported?.('audio/webm;codecs=opus') ?? false;
}

export function floatTo16BitPCM(float32Array: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

export async function startDeepgramLive(
  onTranscript: (text: string, isFinal: boolean) => void
) {
  const accessToken = await fetchDeepgramAccessToken(300);
  const dg = createClient({ accessToken });

  // Detect format per browser
  const useOpus = browserSupportsOpus();

  const connection = await dg.listen.live({
    model: 'nova-2',
    smart_format: true,
    // Tell Deepgram what we will send
    encoding: useOpus ? 'opus' : 'linear16',
    sample_rate: useOpus ? 48000 : 16000, // 48k for Opus; use 16k for PCM fallback
    punctuate: true,
    interim_results: true,
  });

  connection.on(LiveTranscriptionEvents.Open, () => {
    console.log('[Deepgram] Connected');
  });
  connection.on(LiveTranscriptionEvents.Close, (c) => {
    console.log('[Deepgram] closed', c);
  });
  connection.on(LiveTranscriptionEvents.Error, (e) => {
    console.error('[Deepgram] error', e);
  });
  connection.on(LiveTranscriptionEvents.Transcript, (t) => {
    const alts = t.channel?.alternatives?.[0];
    if (!alts) return;
    const text = alts.transcript ?? '';
    if (!text) return;
    const isFinal = !!t.is_final;
    onTranscript(text, isFinal);
  });

  // Capture microphone
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  // OPUS (MediaRecorder) path — Chrome/Edge/Firefox
  if (useOpus) {
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000 });
    rec.addEventListener('dataavailable', async (evt) => {
      if (evt.data && evt.data.size > 0) {
        const buf = await evt.data.arrayBuffer();
        connection.send(buf);
      }
    });
    rec.start(250); // 250ms chunks
    return {
      stop: () => { rec.stop(); stream.getTracks().forEach(t => t.stop()); connection.finish(); }
    };
  }

  // LINEAR16 fallback — Safari
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
  const source = audioCtx.createMediaStreamSource(stream);

  // ScriptProcessor is widely supported; Worklet is nicer but more boilerplate
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);
  source.connect(processor);
  processor.connect(audioCtx.destination);

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0); // Float32 [-1, 1]
    const pcm = floatTo16BitPCM(input);
    connection.send(pcm);
  };

  return {
    stop: () => {
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach(t => t.stop());
      audioCtx.close();
      connection.finish();
    }
  };
}
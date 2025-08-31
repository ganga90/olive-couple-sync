// src/lib/deepgram-live.ts
export type DGConnection = {
  ws: WebSocket | null;
  stop: () => void;
};

export async function fetchDeepgramToken(): Promise<string> {
  const res = await fetch(`https://wtfspzvcetxmcfftwonq.supabase.co/functions/v1/dg-token`, {
    method: "GET",
    credentials: "omit",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Failed to fetch Deepgram token (${res.status}): ${detail}`);
  }
  const { token } = await res.json();
  return token as string;
}

/**
 * Connect to Deepgram Live and stream the user's mic.
 * Calls onPartial(text) for interim and onFinal(text) for punctuated final chunks.
 */
export async function startDeepgramLive(
  opts: {
    onPartial: (text: string) => void;
    onFinal: (text: string) => void;
    onError?: (err: unknown) => void;
  }
): Promise<DGConnection> {
  const token = await fetchDeepgramToken();

  // Choose model + params. `smart_format` adds punctuation/casing.
  const url = new URL("wss://api.deepgram.com/v1/listen");
  url.searchParams.set("model", "nova-2");
  url.searchParams.set("smart_format", "true");
  // For PCM fallback we'll also tell Deepgram the encoding + rate:
  // (Sending Opus via MediaRecorder requires no extra params; Deepgram auto-detects.)
  // We'll add encoding/rate only when we actually stream PCM.

  // WebSocket subprotocol "token" is how you pass the auth in browsers.
  const ws = new WebSocket(url.toString(), ["token", token]);

  const cleanup = () => {
    try { ws.close(); } catch {}
    try { mediaStream?.getTracks().forEach(t => t.stop()); } catch {}
    try { processor?.disconnect(); source?.disconnect(); audioCtx?.close(); } catch {}
    try { recorder?.stop(); } catch {}
  };

  ws.addEventListener("error", (e) => {
    console.error("[Deepgram] WebSocket error:", e);
    opts.onError?.(e);
  });
  ws.addEventListener("close", (e) => {
    console.log("[Deepgram] WebSocket closed:", e.code, e.reason);
    cleanup();
  });

  // --- Microphone setup ---
  const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  let recorder: MediaRecorder | null = null;
  let audioCtx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let usingPCM = false;

  ws.addEventListener("open", async () => {
    console.log("[Deepgram] WebSocket connected");
    
    // Strategy:
    // 1) If Opus in WebM is supported -> use MediaRecorder and stream chunks.
    // 2) Otherwise (Safari) -> send 16k PCM via WebAudio ScriptProcessor.

    const supportsWebmOpus =
      "MediaRecorder" in window &&
      MediaRecorder.isTypeSupported?.("audio/webm;codecs=opus");

    if (supportsWebmOpus) {
      console.log("[Deepgram] Using WebM/Opus encoding");
      recorder = new MediaRecorder(mediaStream, { mimeType: "audio/webm;codecs=opus" });
      recorder.addEventListener("dataavailable", (evt) => {
        if (evt.data && evt.data.size > 0 && ws.readyState === ws.OPEN) {
          ws.send(evt.data);
        }
      });
      recorder.start(250); // ~4 chunks/sec is fine
    } else {
      // Safari / PCM fallback
      console.log("[Deepgram] Using PCM fallback for Safari");
      usingPCM = true;

      // Tell server we're sending linear16 @ 16k:
      // Must reopen parameters by sending a config message first:
      // Deepgram supports a JSON "configure" frame right after connect:
      ws.send(JSON.stringify({ type: "configure", encoding: "linear16", sample_rate: 16000 }));

      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      source = audioCtx.createMediaStreamSource(mediaStream);
      processor = audioCtx.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== ws.OPEN) return;
        const input = e.inputBuffer.getChannelData(0); // Float32 [-1,1]
        const pcm16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        ws.send(pcm16.buffer);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
    }
  });

  // --- Receive transcripts ---
  ws.addEventListener("message", (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      // Deepgram live messages commonly have this shape:
      // { type: "Results", channel: { alternatives: [{ transcript, words: [...] }] }, is_final: boolean }
      if (!msg || !msg.channel) return;
      const alt = msg.channel.alternatives?.[0];
      if (!alt || !alt.transcript) return;

      if (msg.is_final) {
        console.log("[Deepgram] Final transcript:", alt.transcript);
        opts.onFinal(alt.transcript);
      } else {
        console.log("[Deepgram] Partial transcript:", alt.transcript);
        opts.onPartial(alt.transcript);
      }
    } catch (error) {
      console.error("[Deepgram] Error parsing message:", error);
    }
  });

  return {
    ws,
    stop: cleanup,
  };
}
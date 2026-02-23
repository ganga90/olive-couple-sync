import { createClient } from '@deepgram/sdk';

export type DeepgramLive = {
  connect: (opts?: {
    onTranscript?: (text: string, isFinal: boolean) => void
  }) => Promise<{ stop: () => void }>;
};

export function makeDeepgramLive(getTokenEndpoint: string): DeepgramLive {
  async function connect(opts?: { onTranscript?: (text: string, isFinal: boolean) => void }) {
    // 1) Short-lived token
    const res = await fetch(getTokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: 60 })
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch Deepgram token (${res.status}): ${await res.text()}`);
    }
    const { token } = await res.json();

    // 2) Deepgram client
    const dg = createClient(token);

    // 3) Live connection (Opus)
    const live = await dg.listen.live({
      model: 'nova-2',
      smart_format: true,
      interim_results: true,
      encoding: 'opus',
      sample_rate: 48000,
      vad_events: true
    });

    live.addListener('error', (e) => console.error('[Deepgram] live error', e));
    live.addListener('transcriptReceived', (evt: any) => {
      const transcript = evt?.channel?.alternatives?.[0]?.transcript ?? '';
      if (!transcript) return;
      const isFinal = !!evt?.is_final || !!evt?.speech_final;
      opts?.onTranscript?.(transcript, isFinal);
    });

    // 4) Mic → MediaRecorder → chunks → Deepgram
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Prefer Opus; Safari fallback is handled later
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    const mr = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128000 });

    mr.addEventListener('dataavailable', (e) => {
      if (e.data?.size > 0 && live.getReadyState() === 1) {
        live.send(e.data);
      }
    });

    mr.start(250); // send every 250ms

    // Cleanup on close
    live.addListener('close', () => {
      try { mr.state !== 'inactive' && mr.stop(); } catch {}
      stream.getTracks().forEach(t => t.stop());
    });

    return {
      stop: () => {
        try { mr.state !== 'inactive' && mr.stop(); } catch {}
        stream.getTracks().forEach(t => t.stop());
        live.finish();
      }
    };
  }

  return { connect };
}
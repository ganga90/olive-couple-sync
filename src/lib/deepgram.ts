import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { supabase } from "@/integrations/supabase/client";

export async function getDeepgramClient() {
  const { data, error } = await supabase.functions.invoke('dg-token', {
    body: { ttl: 120 }
  });

  if (error || !data?.token) {
    throw new Error(`Failed to fetch Deepgram token${error ? `: ${error.message}` : ''}`);
  }

  // IMPORTANT: pass as accessToken (Bearer), not key
  return createClient({ accessToken: data.token });
}

export async function startLiveTranscription({
  onPartial,
  onFinal,
  onError
}: {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (error: any) => void;
}) {
  const dg = await getDeepgramClient();

  // Request mic permission after a user gesture (click)
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  // Open a live transcription connection
  const conn = dg.listen.live({
    model: "nova-2",
    smart_format: true,
    interim_results: true,
    punctuate: true,
    encoding: "opus",      // MediaRecorder produces opus in webm in most browsers
    sample_rate: 48000
  });

  let mediaRecorder: MediaRecorder | null = null;

  conn.on(LiveTranscriptionEvents.Open, () => {
    console.log("[Deepgram] Connection opened");
    
    try {
      mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorder.addEventListener("dataavailable", (e) => {
        if (e.data.size > 0 && conn.getReadyState() === 1) {
          conn.send(e.data);
        }
      });
      mediaRecorder.start(250); // send chunks every 250ms
    } catch (error) {
      // Fallback for Safari - let it pick defaults
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.addEventListener("dataavailable", (e) => {
        if (e.data.size > 0 && conn.getReadyState() === 1) {
          conn.send(e.data);
        }
      });
      mediaRecorder.start(250);
    }
  });

  conn.on(LiveTranscriptionEvents.Transcript, (evt) => {
    // evt contains alternatives; pick the top transcript
    const alt = evt.channel?.alternatives?.[0];
    if (!alt) return;
    const text = alt.transcript ?? "";
    // Deepgram marks "is_final" on message level
    if (evt.is_final) {
      onFinal(text);
    } else {
      onPartial(text);
    }
  });

  conn.on(LiveTranscriptionEvents.Close, () => {
    console.log("[Deepgram] Connection closed");
    mediaRecorder?.stop();
  });

  conn.on(LiveTranscriptionEvents.Error, (err) => {
    console.error("[Deepgram] Error:", err);
    onError?.(err);
  });

  return () => {
    try { conn.finish(); } catch {}
    try { mediaRecorder?.stop(); } catch {}
    try { stream.getTracks().forEach(t => t.stop()); } catch {}
  };
}
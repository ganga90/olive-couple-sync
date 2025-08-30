import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";

const SUPABASE_URL = "https://wtfspzvcetxmcfftwonq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg";

async function fetchDeepgramToken(ttl = 300): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/dg-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // The gateway needs this Authorization header even with verify_jwt=false
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      // apikey is not strictly required for functions, but harmless:
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ ttl }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Edge Function returned ${res.status}: ${t}`);
  }
  return res.json();
}

export type DeepgramLive = {
  open: () => Promise<void>;
  close: () => void;
  isOpen: () => boolean;
};

export interface DeepgramOptions {
  model?: string;
  interimResults?: boolean;
  smartFormat?: boolean;
  punctuate?: boolean;
}

export async function createDeepgramLive(
  onTranscript: (text: string, isFinal: boolean) => void,
  onError?: (error: any) => void,
  opts?: DeepgramOptions
): Promise<DeepgramLive> {
  try {
    // 1) Get ephemeral token from our edge function
    const tokenData = await fetchDeepgramToken(300);
    
    if (!tokenData?.access_token) {
      throw new Error('No access token received from Deepgram');
    }

    const token: string = tokenData.access_token;

    // 2) Request microphone access
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      } 
    });

    // 3) Create Deepgram client with ephemeral token
    const deepgram = createClient(token);

    // 4) Create live transcription connection
    const connection = deepgram.listen.live({
      model: opts?.model ?? "nova-2",
      smart_format: opts?.smartFormat ?? true,
      interim_results: opts?.interimResults ?? true,
      punctuate: opts?.punctuate ?? true,
      diarize: false,
      language: "en-US",
      encoding: "linear16",
      sample_rate: 16000,
    });

    let isOpen = false;

    // 5) Set up event handlers
    connection.on(LiveTranscriptionEvents.Open, async () => {
      console.log("[Deepgram] Connection opened");
      isOpen = true;
      
      // Start streaming audio to Deepgram
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      mediaRecorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0 && isOpen) {
          connection.send(event.data);
        }
      });

      mediaRecorder.start(100); // Send data every 100ms
      
      // Store recorder reference for cleanup
      (connection as any)._mediaRecorder = mediaRecorder;
    });

    connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
      const transcript = data?.channel?.alternatives?.[0];
      if (transcript && transcript.transcript) {
        const text = transcript.transcript.trim();
        const isFinal = data.is_final === true;
        
        if (text) {
          onTranscript(text, isFinal);
        }
      }
    });

    connection.on(LiveTranscriptionEvents.Error, (error: any) => {
      console.error("[Deepgram] Error:", error);
      onError?.(error);
    });

    connection.on(LiveTranscriptionEvents.Close, () => {
      console.log("[Deepgram] Connection closed");
      isOpen = false;
    });

    return {
      open: async () => {
        if (isOpen) return;
        console.log("[Deepgram] Opening connection...");
        // Connection opens automatically when created
      },
      
      close: () => {
        try {
          // Stop media recorder if it exists
          const mediaRecorder = (connection as any)._mediaRecorder;
          if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
          }
          
          // Finish the connection
          connection.finish();
          
          // Stop all audio tracks
          stream.getTracks().forEach(track => track.stop());
          
          isOpen = false;
        } catch (error) {
          console.error("[Deepgram] Error during cleanup:", error);
        }
      },
      
      isOpen: () => isOpen,
    };

  } catch (error: any) {
    console.error("[Deepgram] Setup error:", error);
    throw new Error(`Voice input setup failed: ${error.message}`);
  }
}
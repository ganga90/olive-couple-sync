// src/components/voice/VoiceInput.tsx
import React, { useRef, useState, useEffect } from "react";
import { makeDeepgramLive } from "@/integrations/voice/deepgram-live";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useMicrophonePermission } from "@/hooks/useMicrophonePermission";
import { Alert, AlertDescription } from "@/components/ui/alert";

const DG_TOKEN_ENDPOINT = 
  (import.meta as any).env?.VITE_DEEPGRAM_TOKEN_ENDPOINT 
  ?? 'https://wtfspzvcetxmcfftwonq.functions.supabase.co/dg-token';

const deepgram = makeDeepgramLive(DG_TOKEN_ENDPOINT);

type Props = {
  // The parent passes and controls the note text value + setter
  text: string;
  setText: (s: string) => void;
  // Add interim text handling
  interim?: string;
  setInterim?: (s: string) => void;
  disabled?: boolean;
};

export default function VoiceInput({ text, setText, interim, setInterim, disabled }: Props) {
  const [recording, setRecording] = useState(false);
  const [localInterim, setLocalInterim] = useState("");
  const [session, setSession] = useState<{ stop: () => void } | null>(null);
  const { permission, isLoading, error, hasPermission, isPermissionDenied, canRequestPermission } = useMicrophonePermission();

  // Use parent interim state if provided, otherwise use local
  const currentInterim = setInterim ? interim || "" : localInterim;
  const updateInterim = setInterim || setLocalInterim;

  // Handlers for transcript processing
  const commitText = (transcription: string) => {
    // Append final text to the input (with a space if needed)
    const needsSpace = text && !text.endsWith(" ") && !text.endsWith("\n");
    const newText = needsSpace ? `${text} ${transcription}` : `${text}${transcription}`;
    setText(newText);
  };

  const onStart = async () => {
    if (session) return;
    try {
      console.log("[VoiceInput] Starting Deepgram connection...");
      setRecording(true);
      updateInterim("");
      
      const s = await deepgram.connect({
        onTranscript: (transcription, isFinal) => {
          console.log(`[VoiceInput] ${isFinal ? 'Final' : 'Interim'}:`, transcription);
          if (isFinal) {
            commitText(transcription);
            updateInterim("");
          } else {
            updateInterim(transcription);
          }
        }
      });
      setSession(s);
      toast.success("Voice recording started");
    } catch (e) {
      console.error("[VoiceInput] Failed to start:", e);
      setRecording(false);
      updateInterim("");
      
      // Parse error message for better user feedback
      let errorMessage = "Couldn't start voice input. Check your microphone and try again.";
      if (e instanceof Error) {
        if (e.message.includes("Permission denied") || e.message.includes("NotAllowedError")) {
          errorMessage = "Microphone access denied. Please allow microphone permissions and try again.";
        } else if (e.message.includes("502") || e.message.includes("FORBIDDEN")) {
          errorMessage = "Voice service unavailable. Please check your Deepgram API key configuration.";
        } else if (e.message.includes("timeout")) {
          errorMessage = "Connection timeout. Please try again.";
        }
      }
      
      toast.error(errorMessage);
    }
  };

  const onStop = () => {
    console.log("[VoiceInput] Stopping voice input");
    try { session?.stop(); } catch {}
    setSession(null);
    setRecording(false);
    updateInterim("");
    toast.success("Voice recording stopped");
  };

  // IMPORTANT: cleanup if component unmounts
  useEffect(() => () => { try { session?.stop(); } catch {} }, [session]);

  return (
    <div className="flex flex-col gap-2">
      {/* Permission warning */}
      {isPermissionDenied && (
        <Alert variant="destructive" className="text-sm">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Microphone access denied. Please enable microphone permissions in your browser or device settings to use voice input.
          </AlertDescription>
        </Alert>
      )}
      
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={recording ? "destructive" : "outline"}
          onClick={recording ? onStop : onStart}
          disabled={disabled || isLoading || isPermissionDenied}
          className={`${recording ? 'animate-pulse bg-red-500 hover:bg-red-600' : 'border-olive/30 hover:bg-olive/10'}`}
          title={
            isPermissionDenied 
              ? "Microphone access denied" 
              : isLoading 
                ? "Checking microphone..." 
                : recording 
                  ? "Stop voice input" 
                  : "Start voice input"
          }
          aria-pressed={recording}
        >
          {isLoading ? (
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent" />
          ) : recording ? (
            <MicOff className="h-4 w-4" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </Button>

        {/* Show live interim transcripts as a subtle hint */}
        {currentInterim && (
          <span className="text-sm text-muted-foreground italic truncate max-w-[240px]">
            {currentInterim}...
          </span>
        )}
      </div>
    </div>
  );
}
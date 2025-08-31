// src/components/voice/VoiceInput.tsx
import React, { useRef, useState } from "react";
import { startLiveTranscription } from "@/lib/deepgram";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useMicrophonePermission } from "@/hooks/useMicrophonePermission";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Props = {
  // The parent passes and controls the note text value + setter
  text: string;
  setText: (s: string) => void;
  disabled?: boolean;
};

export default function VoiceInput({ text, setText, disabled }: Props) {
  const [recording, setRecording] = useState(false);
  const [partial, setPartial] = useState("");
  const stopFnRef = useRef<(() => void) | null>(null);
  const { permission, isLoading, error, hasPermission, isPermissionDenied, canRequestPermission } = useMicrophonePermission();

  const onStart = async () => {
    try {
      console.log("[VoiceInput] Starting Deepgram connection...");
      const stopFn = await startLiveTranscription({
        onPartial: (p) => {
          console.log("[VoiceInput] Partial:", p);
          setPartial(p);
        },
        onFinal: (f) => {
          console.log("[VoiceInput] Final:", f);
          // Append final text to the input (with a space if needed)
          const needsSpace = text && !text.endsWith(" ") && !text.endsWith("\n");
          const newText = needsSpace ? `${text} ${f}` : `${text}${f}`;
          setText(newText);
          setPartial("");
        },
        onError: (e) => {
          console.error("[VoiceInput] Deepgram error:", e);
          toast.error("Voice input error. Please try again.");
          setRecording(false);
          setPartial("");
        },
      });
      stopFnRef.current = stopFn;
      setRecording(true);
      toast.success("Voice recording started");
    } catch (e) {
      console.error("[VoiceInput] Failed to start:", e);
      setRecording(false);
      setPartial("");
      
      // Parse error message for better user feedback
      let errorMessage = "Couldn't start voice input. Check your microphone and try again.";
      if (e instanceof Error) {
        if (e.message.includes("Permission denied") || e.message.includes("NotAllowedError")) {
          errorMessage = "Microphone access denied. Please allow microphone permissions and try again.";
        } else if (e.message.includes("502") || e.message.includes("FORBIDDEN")) {
          errorMessage = "Voice service unavailable. Please check your Deepgram API key configuration.";
        }
      }
      
      toast.error(errorMessage);
    }
  };

  const onStop = () => {
    console.log("[VoiceInput] Stopping voice input");
    stopFnRef.current?.();
    stopFnRef.current = null;
    setRecording(false);
    setPartial("");
    toast.success("Voice recording stopped");
  };

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

        {/* Show live partials as a subtle hint */}
        {partial && (
          <span className="text-sm text-muted-foreground italic truncate max-w-[240px]">
            {partial}...
          </span>
        )}
      </div>
    </div>
  );
}
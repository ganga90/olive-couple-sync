// src/components/voice/VoiceInput.tsx
import React, { useRef, useState, useEffect } from "react";
import { createDeepgramLive, type DGConnection } from "@/lib/deepgramLive";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useMicrophonePermission } from "@/hooks/useMicrophonePermission";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

type Props = {
  text: string;
  setText: (s: string) => void;
  interim?: string;
  setInterim?: (s: string) => void;
  disabled?: boolean;
};

export default function VoiceInput({ text, setText, interim, setInterim, disabled }: Props) {
  const dgRef = useRef<DGConnection | null>(null);
  const [recording, setRecording] = useState(false);
  const [localInterim, setLocalInterim] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);
  const { isLoading, isPermissionDenied } = useMicrophonePermission();

  const currentInterim = setInterim ? interim || "" : localInterim;
  const updateInterim = setInterim || setLocalInterim;

  // Audio level visualization
  const updateAudioLevel = () => {
    if (analyzerRef.current && recording) {
      const dataArray = new Uint8Array(analyzerRef.current.frequencyBinCount);
      analyzerRef.current.getByteFrequencyData(dataArray);
      
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      const normalizedLevel = Math.min(average / 128, 1);
      setAudioLevel(normalizedLevel);
      
      animationRef.current = requestAnimationFrame(updateAudioLevel);
    }
  };

  const commitText = (transcription: string) => {
    const needsSpace = text && !text.endsWith(" ") && !text.endsWith("\n");
    const newText = needsSpace ? `${text} ${transcription}` : `${text}${transcription}`;
    setText(newText);
  };

  const onStart = async () => {
    if (recording || dgRef.current) return;
    
    try {
      setRecording(true);
      updateInterim("");
      
      // Set up audio analyzer for visual feedback
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      const analyzer = audioContextRef.current.createAnalyser();
      analyzer.fftSize = 256;
      source.connect(analyzer);
      analyzerRef.current = analyzer;
      
      animationRef.current = requestAnimationFrame(updateAudioLevel);
      
      dgRef.current = createDeepgramLive({
        onOpen() {
          toast.success("Voice recording started");
        },
        onInterim(text) {
          updateInterim(text);
        },
        onFinal(text) {
          commitText(text);
          updateInterim('');
        },
        onError(err) {
          console.error('[VoiceInput] Deepgram error:', err);
          cleanupRecording();
          
          let errorMessage = "Voice input error. Please try again.";
          if (err instanceof Error) {
            if (err.message.includes("Permission denied") || err.message.includes("NotAllowedError")) {
              errorMessage = "Microphone access denied. Please allow microphone permissions and try again.";
            } else if (err.message.includes("Failed to fetch Deepgram token")) {
              errorMessage = "Voice service unavailable. Please check your Deepgram API key configuration.";
            }
          }
          
          toast.error(errorMessage);
        },
        onClose(code, reason) {
          cleanupRecording();
          if (code !== 1000) {
            toast.error("Voice connection closed unexpectedly");
          }
        }
      });

      await dgRef.current.start();
    } catch (e) {
      console.error("[VoiceInput] Failed to start:", e);
      cleanupRecording();
      updateInterim("");
      dgRef.current = null;
      
      let errorMessage = "Couldn't start voice input. Check your microphone and try again.";
      if (e instanceof Error) {
        if (e.message.includes("Permission denied") || e.message.includes("NotAllowedError")) {
          errorMessage = "Microphone access denied. Please allow microphone permissions and try again.";
        } else if (e.message.includes("Failed to fetch Deepgram token")) {
          errorMessage = "Voice service unavailable. Please check your Deepgram API key configuration.";
        } else if (e.message.includes("timeout")) {
          errorMessage = "Connection timeout. Please try again.";
        }
      }
      
      toast.error(errorMessage);
    }
  };

  const cleanupRecording = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyzerRef.current = null;
    setAudioLevel(0);
    setRecording(false);
  };

  const onStop = () => {
    cleanupRecording();
    
    try { 
      dgRef.current?.stop();
    } catch {}
    dgRef.current = null;
    updateInterim("");
    toast.success("Voice recording stopped");
  };

  useEffect(() => () => { 
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
    }
    try { 
      dgRef.current?.stop();
    } catch {} 
  }, []);

  // Calculate ring sizes based on audio level
  const ringScale1 = 1 + audioLevel * 0.4;
  const ringScale2 = 1 + audioLevel * 0.7;
  const ringScale3 = 1 + audioLevel * 1.0;

  return (
    <div className="flex flex-col gap-2">
      {/* Permission warning */}
      {isPermissionDenied && (
        <Alert variant="destructive" className="text-sm animate-fade-in">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Microphone access denied. Please enable microphone permissions in your browser settings.
          </AlertDescription>
        </Alert>
      )}
      
      <div className="flex items-center gap-2">
        {/* Voice button with animated rings */}
        <div className="relative flex items-center justify-center">
          {/* Animated rings when recording */}
          {recording && (
            <>
              <div 
                className="absolute w-9 h-9 rounded-full bg-destructive/15 pointer-events-none"
                style={{ 
                  transform: `scale(${ringScale3})`,
                  transition: 'transform 75ms ease-out'
                }}
              />
              <div 
                className="absolute w-9 h-9 rounded-full bg-destructive/25 pointer-events-none"
                style={{ 
                  transform: `scale(${ringScale2})`,
                  transition: 'transform 75ms ease-out'
                }}
              />
              <div 
                className="absolute w-9 h-9 rounded-full bg-destructive/35 pointer-events-none"
                style={{ 
                  transform: `scale(${ringScale1})`,
                  transition: 'transform 75ms ease-out'
                }}
              />
            </>
          )}
          
          <Button
            type="button"
            size="icon"
            variant={recording ? "destructive" : "ghost"}
            onClick={recording ? onStop : onStart}
            disabled={disabled || isLoading || isPermissionDenied}
            className={cn(
              "relative h-9 w-9 rounded-full transition-all duration-300 z-10",
              recording 
                ? "bg-destructive text-destructive-foreground shadow-lg hover:bg-destructive/90" 
                : "text-muted-foreground hover:text-primary hover:bg-primary/10",
              isLoading && "opacity-50"
            )}
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
        </div>

        {/* Recording indicator with audio level bars */}
        {recording && (
          <div className="flex items-center gap-2 animate-fade-in">
            <div className="flex gap-0.5 items-center h-4">
              {[0, 1, 2, 3, 4].map((i) => {
                const barHeight = Math.max(3, 3 + audioLevel * 13 * Math.abs(Math.sin((i + 1) * 0.8)));
                return (
                  <div
                    key={i}
                    className="w-0.5 bg-destructive rounded-full"
                    style={{
                      height: `${barHeight}px`,
                      transition: 'height 75ms ease-out'
                    }}
                  />
                );
              })}
            </div>
            <span className="text-xs font-medium text-destructive">
              Listening...
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
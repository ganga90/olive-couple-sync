import { useRef, useState, useCallback, useEffect } from "react";
import { createDeepgramLive, type DeepgramLive } from "@/integrations/deepgram";
import { toast } from "sonner";

export interface UseVoiceInputOptions {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (error: any) => void;
}

export function useVoiceInput(options?: UseVoiceInputOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const liveRef = useRef<DeepgramLive | null>(null);
  const finalBufferRef = useRef<string>("");

  const startRecording = useCallback(async () => {
    if (isRecording) return;

    try {
      setIsRecording(true);
      setTranscript("");
      setInterimTranscript("");
      finalBufferRef.current = "";

      // Create Deepgram live connection
      liveRef.current = await createDeepgramLive(
        (text, isFinal) => {
          if (!isFinal) {
            // Show interim results
            const display = `${finalBufferRef.current} ${text}`.trim();
            setInterimTranscript(text);
            setTranscript(display);
            options?.onTranscript?.(display, false);
          } else {
            // Final result - append to buffer
            finalBufferRef.current = `${finalBufferRef.current} ${text}`.trim();
            setInterimTranscript("");
            setTranscript(finalBufferRef.current);
            options?.onTranscript?.(finalBufferRef.current, true);
          }
        },
        (error) => {
          console.error("[VoiceInput] Deepgram error:", error);
          options?.onError?.(error);
          toast.error("Voice input error occurred");
          stopRecording();
        }
      );

      await liveRef.current.open();
      toast.success("Voice input started - speak now!");

    } catch (error: any) {
      console.error("[VoiceInput] Failed to start recording:", error);
      setIsRecording(false);
      
      if (error.message?.includes("Permission denied") || error.message?.includes("NotAllowedError")) {
        toast.error("Microphone permission denied. Please allow microphone access and try again.");
      } else if (error.message?.includes("token")) {
        toast.error("Voice input authentication failed. Please try again.");
      } else {
        toast.error("Couldn't start voice input. Please check your microphone and try again.");
      }
      
      options?.onError?.(error);
    }
  }, [isRecording, options]);

  const stopRecording = useCallback(() => {
    if (!isRecording) return;

    try {
      liveRef.current?.close();
      liveRef.current = null;
      setIsRecording(false);
      setInterimTranscript("");
      
      if (finalBufferRef.current.trim()) {
        toast.success("Voice input complete!");
      }
    } catch (error) {
      console.error("[VoiceInput] Error stopping recording:", error);
    }
  }, [isRecording]);

  const clearTranscript = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    finalBufferRef.current = "";
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (liveRef.current) {
        liveRef.current.close();
      }
    };
  }, []);

  return {
    isRecording,
    transcript,
    interimTranscript,
    startRecording,
    stopRecording,
    clearTranscript,
    isSupported: typeof navigator !== 'undefined' && 'mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices,
  };
}
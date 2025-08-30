import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Send, Sparkles, Mic, MicOff } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { NoteRecap } from "./NoteRecap";
import { useVoiceInput } from "@/hooks/useVoiceInput";

interface NoteInputProps {
  onNoteAdded?: () => void;
}

export const NoteInput: React.FC<NoteInputProps> = ({ onNoteAdded }) => {
  const [text, setText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedNote, setProcessedNote] = useState<any>(null);
  const { user, loading, isAuthenticated } = useAuth();
  const { currentCouple, createCouple } = useSupabaseCouple();
  const { addNote } = useSupabaseNotesContext();
  
  // Voice input hook
  const { 
    isRecording, 
    transcript, 
    interimTranscript,
    startRecording, 
    stopRecording, 
    clearTranscript,
    isSupported: voiceSupported
  } = useVoiceInput({
    onTranscript: (text) => setText(text),
  });
  

  // Debug authentication state in NoteInput
  console.log('[NoteInput] Auth State:', { 
    user: !!user, 
    userId: user?.id,
    loading,
    isAuthenticated,
    currentCouple: !!currentCouple,
    coupleId: currentCouple?.id
  });

  // Don't allow note submission while loading or if not authenticated
  if (loading) {
    return (
      <Card className="bg-gradient-soft border-olive/20 shadow-soft">
        <div className="p-6 text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-olive mx-auto mb-2"></div>
          <p className="text-sm text-muted-foreground">Loading your notes space...</p>
        </div>
      </Card>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Comprehensive auth debugging
    console.log('[NoteInput] === SUBMISSION DEBUG ===');
    console.log('[NoteInput] Text:', text.trim());
    console.log('[NoteInput] Auth state:', { 
      user: !!user, 
      userId: user?.id,
      loading,
      isAuthenticated,
      userObject: user
    });
    
    if (!text.trim()) {
      toast.error("Please enter a note");
      return;
    }

    if (!isAuthenticated || !user) {
      console.log('[NoteInput] FAILED: Not authenticated or no user', { isAuthenticated, user: !!user });
      toast.error("Please sign in to add notes", {
        action: {
          label: "Sign In",
          onClick: () => window.location.href = "/sign-in"
        }
      });
      return;
    }

    console.log('[NoteInput] ✅ Auth checks passed, proceeding with note creation');

    setIsProcessing(true);
    
    try {
      // Double-check auth state before AI processing
      if (!user) {
        throw new Error('User authentication lost during processing');
      }

      console.log('[NoteInput] Processing note with AI for user:', user.id);
      
      // Process the note with Gemini AI
      const { data: aiProcessedNote, error } = await supabase.functions.invoke('process-note', {
        body: { 
          text: text.trim(),
          user_id: user.id,
          couple_id: currentCouple?.id || null
        }
      });

      if (error) {
        console.error('[NoteInput] AI processing error:', error);
        throw new Error(`Failed to process note with AI: ${error.message || error}`);
      }
      
      if (!aiProcessedNote) {
        console.error('[NoteInput] No data returned from AI processing');
        throw new Error('No data returned from AI processing');
      }

      console.log('[NoteInput] AI processed note:', aiProcessedNote);
      
      // Triple-check auth state before saving to Supabase
      if (!user) {
        throw new Error('User authentication lost before saving note');
      }

      console.log('[NoteInput] Saving note to Supabase for user:', user.id);
      
      // Prepare note data
      const noteData = {
        originalText: text.trim(),
        summary: aiProcessedNote.summary,
        category: aiProcessedNote.category,
        dueDate: aiProcessedNote.due_date,
        completed: false,
        priority: aiProcessedNote.priority,
        tags: aiProcessedNote.tags,
        items: aiProcessedNote.items,
      };
      
      console.log('[NoteInput] Note data to save:', noteData);
      
      // Add the note to Supabase
      const savedNote = await addNote(noteData);
      
      console.log('[NoteInput] Saved note result:', savedNote);

      if (savedNote) {
        // Show the recap
        setProcessedNote({
          id: savedNote.id,
          summary: aiProcessedNote.summary,
          category: aiProcessedNote.category,
          dueDate: aiProcessedNote.due_date,
          priority: aiProcessedNote.priority,
          tags: aiProcessedNote.tags,
          items: aiProcessedNote.items,
          originalText: text.trim(),
          author: user.firstName || user.fullName || "You",
          createdAt: savedNote.createdAt
        });

        setText("");
        onNoteAdded?.();
        toast.success("Note added and organized!");
      }
    } catch (error) {
      console.error("Error processing note:", error);
      toast.error("Failed to process note. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCloseRecap = () => {
    setProcessedNote(null);
    clearTranscript(); // Clear voice transcript when closing recap
  };

  const handleNoteUpdated = (updatedNote: any) => {
    setProcessedNote(prev => prev ? { ...prev, ...updatedNote } : null);
    onNoteAdded?.(); // Refresh the notes list
  };

  // If we have a processed note, show the recap
  if (processedNote) {
    return (
      <div className="space-y-4">
        <NoteRecap 
          note={processedNote} 
          onClose={handleCloseRecap} 
          onNoteUpdated={handleNoteUpdated}
        />
        <Button 
          onClick={handleCloseRecap}
          variant="outline" 
          className="w-full border-olive/30 text-olive hover:bg-olive/10"
        >
          Add Another Note
        </Button>
      </div>
    );
  }


  return (
    <Card className="bg-gradient-soft border-olive/20 shadow-soft">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="text-center mb-4">
          <h2 className="text-lg font-semibold text-foreground mb-1">
            Drop a note here
          </h2>
          <p className="text-sm text-muted-foreground">
            I'll organize it for you with AI
          </p>
        </div>
        
        <div className="relative">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={isRecording ? "Listening... speak now!" : "Type a note or use the mic button..."}
            className={`min-h-[120px] border-olive/30 focus:border-olive resize-none text-base pr-20 ${
              isRecording ? 'border-red-300 bg-red-50/50' : ''
            }`}
            disabled={isProcessing}
          />
          
          {/* Voice input controls */}
          <div className="absolute top-3 right-3 flex items-center gap-2">
            {voiceSupported && (
              <Button
                type="button"
                size="sm"
                variant={isRecording ? "destructive" : "outline"}
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isProcessing}
                className={`${isRecording ? 'animate-pulse bg-red-500 hover:bg-red-600' : 'border-olive/30 hover:bg-olive/10'}`}
                title={isRecording ? "Stop voice input" : "Start voice input"}
              >
                {isRecording ? (
                  <MicOff className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
          
          {/* Send button */}
          {text.trim() && (
            <div className="absolute bottom-3 right-3">
              <Button
                type="submit"
                size="sm"
                disabled={isProcessing || !text.trim()}
                className="bg-gradient-olive hover:bg-olive text-white shadow-olive"
              >
                {isProcessing ? (
                  <Sparkles className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}
        </div>
        
        {/* Voice input status */}
        {isRecording && (
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 text-red-600">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
              <span className="text-sm font-medium">Recording... {interimTranscript && "(processing speech)"}</span>
            </div>
          </div>
        )}
        
        <p className="text-xs text-center text-muted-foreground">
          {isProcessing ? "AI is organizing your note..." : 
           isRecording ? "Speak clearly, I'm listening!" :
           "I'll automatically categorize, summarize, and organize your note"}
        </p>
      </form>
    </Card>
  );
};
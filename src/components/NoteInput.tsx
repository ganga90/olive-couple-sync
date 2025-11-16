import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Send, Sparkles } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { NoteRecap } from "./NoteRecap";
import { MultipleNotesRecap } from "./MultipleNotesRecap";
import VoiceInput from "./voice/VoiceInput";
import { LoginPromptDialog } from "./LoginPromptDialog";

interface NoteInputProps {
  onNoteAdded?: () => void;
  listId?: string | null;
}

export const NoteInput: React.FC<NoteInputProps> = ({ onNoteAdded, listId }) => {
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedNote, setProcessedNote] = useState<any>(null);
  const [multipleNotes, setMultipleNotes] = useState<any>(null);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const { user, loading, isAuthenticated } = useAuth();
  const { currentCouple, createCouple } = useSupabaseCouple();
  const { addNote, refetch: refetchNotes } = useSupabaseNotesContext();
  

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
      setShowLoginPrompt(true);
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
          couple_id: currentCouple?.id || null,
          list_id: listId || null
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
      
      // Check if we got multiple notes
      if (aiProcessedNote.multiple && aiProcessedNote.notes) {
        console.log('[NoteInput] Got multiple notes:', aiProcessedNote.notes.length);
        
        // Show multiple notes recap for user review before saving
        setMultipleNotes({
          notes: aiProcessedNote.notes.map((note: any) => ({
            summary: note.summary,
            category: note.category,
            dueDate: note.due_date,
            priority: note.priority,
            tags: note.tags,
            items: note.items,
            originalText: text.trim(),
            task_owner: note.task_owner,
            list_id: note.list_id
          })),
          originalText: text.trim()
        });

        setText("");
        toast.success(`AI identified ${aiProcessedNote.notes.length} separate tasks!`);
        return;
      }
      
      // Handle single note - show recap BEFORE saving to database
      console.log('[NoteInput] Single note case, showing recap for review');
      
      // Store the AI-processed data for review (NOT saved to DB yet)
      setProcessedNote({
        originalText: text.trim(),
        summary: aiProcessedNote.summary,
        category: aiProcessedNote.category,
        dueDate: aiProcessedNote.due_date,
        priority: aiProcessedNote.priority,
        tags: aiProcessedNote.tags || [],
        items: aiProcessedNote.items || [],
        taskOwner: aiProcessedNote.task_owner || null,
        listId: aiProcessedNote.list_id || listId || null,
        completed: false
      });

      // Success feedback
      toast.success("Note processed! Review and save below ✨");
      
      // Clear the input
      setText("");
      setInterim("");
      
      // Don't call onNoteAdded yet - wait for user to accept
    } catch (error) {
      console.error("Error processing note:", error);
      toast.error("Failed to process note. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCloseRecap = () => {
    setProcessedNote(null);
    setMultipleNotes(null);
  };

  const handleNoteUpdated = (updatedNote: any) => {
    // Update the local state with edited values
    setProcessedNote(prev => prev ? { ...prev, ...updatedNote } : null);
  };

  const handleSaveNote = async () => {
    if (!processedNote || !user) return;
    
    try {
      console.log('[NoteInput] Saving accepted note to database:', processedNote);
      
      // Prepare note data in the correct format for addNote
      const noteData = {
        originalText: processedNote.originalText,
        summary: processedNote.summary,
        category: processedNote.category,
        dueDate: processedNote.dueDate,
        completed: processedNote.completed || false,
        priority: processedNote.priority,
        tags: processedNote.tags || [],
        items: processedNote.items || [],
        listId: processedNote.listId,
        taskOwner: processedNote.taskOwner
      };
      
      const newNote = await addNote(noteData);
      
      if (!newNote) {
        throw new Error('Failed to save note to database');
      }
      
      toast.success("Note saved successfully! 🎉");
      
      // Refetch and close
      await refetchNotes();
      handleCloseRecap();
      onNoteAdded?.(); // Notify parent to close dialog/refresh
    } catch (error) {
      console.error('[NoteInput] Error saving note:', error);
      toast.error("Failed to save note");
    }
  };

  const handleMultipleNotesAdded = () => {
    onNoteAdded?.();
    refetchNotes();
  };

  // Dynamic placeholder based on day/time
  const getDynamicPlaceholder = () => {
    const hour = new Date().getHours();
    const day = new Date().getDay();
    
    // Weekend suggestions
    if (day === 0 || day === 6) {
      return "Weekend plans, errands, or fun activities...";
    }
    
    // Morning suggestions
    if (hour < 12) {
      return "Morning tasks, groceries, or today's priorities...";
    }
    
    // Afternoon suggestions
    if (hour < 18) {
      return "Afternoon goals, errands, or evening plans...";
    }
    
    // Evening suggestions
    return "Tomorrow's prep, shopping lists, or date ideas...";
  };

  // If we have multiple notes, show the multiple notes recap
  if (multipleNotes) {
    return (
      <MultipleNotesRecap
        notes={multipleNotes.notes}
        originalText={multipleNotes.originalText}
        onClose={handleCloseRecap}
        onNotesAdded={handleMultipleNotesAdded}
      />
    );
  }

  // If we have a single processed note, show the single recap
  if (processedNote) {
    return (
      <div className="space-y-4">
        <NoteRecap 
          note={processedNote} 
          onClose={handleCloseRecap} 
          onNoteUpdated={handleNoteUpdated}
        />
        <div className="space-y-3">
          <Button 
            onClick={handleSaveNote}
            className="w-full bg-olive hover:bg-olive/90 text-white"
          >
            Accept & Save Note
          </Button>
          <Button 
            onClick={handleCloseRecap}
            variant="outline" 
            className="w-full border-olive/30 text-olive hover:bg-olive/10"
          >
            Cancel & Start Over
          </Button>
        </div>
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
            placeholder={getDynamicPlaceholder()}
            className="min-h-[120px] border-olive/30 focus:border-olive resize-none text-base pr-20 bg-background/50 shadow-[var(--shadow-inset)]"
            disabled={isProcessing}
          />
          
          {/* Show interim transcript */}
          {interim && (
            <div className="absolute top-2 left-3 text-sm text-muted-foreground italic pointer-events-none">
              {interim}...
            </div>
          )}
          
          {/* Voice input controls */}
          <div className="absolute top-3 right-3 flex items-center gap-2">
            <VoiceInput 
              text={text} 
              setText={setText}
              interim={interim}
              setInterim={setInterim}
              disabled={isProcessing}
            />
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
        
        <p className="text-xs text-center text-muted-foreground">
          {isProcessing ? "AI is organizing your note..." : 
           "I'll automatically categorize, summarize, and organize your note"}
        </p>
      </form>
      
      <LoginPromptDialog 
        open={showLoginPrompt}
        onOpenChange={setShowLoginPrompt}
      />
    </Card>
  );
};
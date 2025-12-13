import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Send, Sparkles, Image, X, Mic } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { NoteRecap } from "./NoteRecap";
import { MultipleNotesRecap } from "./MultipleNotesRecap";
import VoiceInput from "./voice/VoiceInput";
import { LoginPromptDialog } from "./LoginPromptDialog";
import { useNoteStyle } from "@/hooks/useNoteStyle";

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
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [mediaPreviews, setMediaPreviews] = useState<string[]>([]);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { user, loading, isAuthenticated } = useAuth();
  const { currentCouple, createCouple } = useSupabaseCouple();
  const { addNote, refetch: refetchNotes } = useSupabaseNotesContext();
  const { style: noteStyle } = useNoteStyle();

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    
    const newFiles: File[] = [];
    const newPreviews: string[] = [];
    
    for (let i = 0; i < files.length && mediaFiles.length + newFiles.length < 5; i++) {
      const file = files[i];
      // Accept images and audio
      if (file.type.startsWith('image/') || file.type.startsWith('audio/')) {
        newFiles.push(file);
        if (file.type.startsWith('image/')) {
          newPreviews.push(URL.createObjectURL(file));
        } else {
          newPreviews.push('audio');
        }
      }
    }
    
    setMediaFiles(prev => [...prev, ...newFiles]);
    setMediaPreviews(prev => [...prev, ...newPreviews]);
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeMedia = (index: number) => {
    setMediaFiles(prev => prev.filter((_, i) => i !== index));
    setMediaPreviews(prev => {
      const preview = prev[index];
      if (preview && preview !== 'audio') {
        URL.revokeObjectURL(preview);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const uploadMediaFiles = async (): Promise<string[]> => {
    if (mediaFiles.length === 0) return [];
    
    setIsUploadingMedia(true);
    const uploadedUrls: string[] = [];
    
    try {
      for (const file of mediaFiles) {
        const ext = file.name.split('.').pop() || 'bin';
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(7);
        const filename = `${user?.id}/${timestamp}_${randomStr}.${ext}`;
        
        const { data, error } = await supabase.storage
          .from('note-media')
          .upload(filename, file, {
            contentType: file.type,
            upsert: false
          });
        
        if (error) {
          console.error('[NoteInput] Failed to upload media:', error);
          continue;
        }
        
        const { data: { publicUrl } } = supabase.storage
          .from('note-media')
          .getPublicUrl(filename);
        
        uploadedUrls.push(publicUrl);
      }
      
      return uploadedUrls;
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Comprehensive auth debugging
    console.log('[NoteInput] === SUBMISSION DEBUG ===');
    console.log('[NoteInput] Text:', text.trim());
    console.log('[NoteInput] Media files:', mediaFiles.length);
    console.log('[NoteInput] Auth state:', { 
      user: !!user, 
      userId: user?.id,
      loading,
      isAuthenticated,
      userObject: user
    });
    
    if (!text.trim() && mediaFiles.length === 0) {
      toast.error("Please enter a note or attach media");
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

      // Upload media files first if any
      let mediaUrls: string[] = [];
      if (mediaFiles.length > 0) {
        console.log('[NoteInput] Uploading', mediaFiles.length, 'media files...');
        mediaUrls = await uploadMediaFiles();
        console.log('[NoteInput] Uploaded media URLs:', mediaUrls);
      }

      console.log('[NoteInput] Processing note with AI for user:', user.id);
      
      // Process the note with Gemini AI (including media and style)
      const { data: aiProcessedNote, error } = await supabase.functions.invoke('process-note', {
        body: { 
          text: text.trim() || 'Process attached media',
          user_id: user.id,
          couple_id: currentCouple?.id || null,
          list_id: listId || null,
          media: mediaUrls.length > 0 ? mediaUrls : undefined,
          style: noteStyle
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
            list_id: note.list_id,
            media_urls: note.media_urls || mediaUrls
          })),
          originalText: text.trim()
        });

        setText("");
        clearMediaFiles();
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
        completed: false,
        mediaUrls: aiProcessedNote.media_urls || mediaUrls
      });

      // Success feedback
      toast.success("Note processed! Review and save below ✨");
      
      // Clear the input
      setText("");
      setInterim("");
      clearMediaFiles();
      
      // Don't call onNoteAdded yet - wait for user to accept
    } catch (error) {
      console.error("Error processing note:", error);
      toast.error("Failed to process note. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const clearMediaFiles = () => {
    mediaPreviews.forEach(preview => {
      if (preview && preview !== 'audio') {
        URL.revokeObjectURL(preview);
      }
    });
    setMediaFiles([]);
    setMediaPreviews([]);
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
        taskOwner: processedNote.taskOwner,
        mediaUrls: processedNote.mediaUrls || []
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
        
        {/* Media previews */}
        {mediaPreviews.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {mediaPreviews.map((preview, index) => (
              <div key={index} className="relative group">
                {preview === 'audio' ? (
                  <div className="w-16 h-16 rounded-lg bg-olive/10 flex items-center justify-center border border-olive/20">
                    <Mic className="w-6 h-6 text-olive" />
                  </div>
                ) : (
                  <img 
                    src={preview} 
                    alt={`Attached ${index + 1}`}
                    className="w-16 h-16 object-cover rounded-lg border border-olive/20"
                  />
                )}
                <button
                  type="button"
                  onClick={() => removeMedia(index)}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        
        <div className="relative">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={getDynamicPlaceholder()}
            className="min-h-[120px] border-olive/30 focus:border-olive resize-none text-base pr-20 bg-background/50 shadow-[var(--shadow-inset)]"
            disabled={isProcessing || isUploadingMedia}
          />
          
          {/* Show interim transcript */}
          {interim && (
            <div className="absolute top-2 left-3 text-sm text-muted-foreground italic pointer-events-none">
              {interim}...
            </div>
          )}
          
          {/* Voice and media input controls */}
          <div className="absolute top-3 right-3 flex items-center gap-2">
            {/* Hidden file input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept="image/*,audio/*"
              multiple
              className="hidden"
            />
            
            {/* Media upload button */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing || isUploadingMedia || mediaFiles.length >= 5}
              className="h-8 w-8 text-muted-foreground hover:text-olive"
            >
              <Image className="h-4 w-4" />
            </Button>
            
            <VoiceInput 
              text={text} 
              setText={setText}
              interim={interim}
              setInterim={setInterim}
              disabled={isProcessing || isUploadingMedia}
            />
          </div>
          
          {/* Send button */}
          {(text.trim() || mediaFiles.length > 0) && (
            <div className="absolute bottom-3 right-3">
              <Button
                type="submit"
                size="sm"
                disabled={isProcessing || isUploadingMedia || (!text.trim() && mediaFiles.length === 0)}
                className="bg-gradient-olive hover:bg-olive text-white shadow-olive"
              >
                {isProcessing || isUploadingMedia ? (
                  <Sparkles className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}
        </div>
        
        <p className="text-xs text-center text-muted-foreground">
          {isUploadingMedia ? "Uploading media..." :
           isProcessing ? "AI is organizing your note..." : 
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
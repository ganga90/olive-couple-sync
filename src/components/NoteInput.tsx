import React, { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Send, Sparkles, Image, X, Mic, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
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
  const { t } = useTranslation('home');
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedNote, setProcessedNote] = useState<any>(null);
  const [multipleNotes, setMultipleNotes] = useState<any>(null);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [mediaPreviews, setMediaPreviews] = useState<string[]>([]);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  
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
      <Card className="overflow-hidden border-border/50 bg-card/80 backdrop-blur-sm shadow-soft">
        <div className="p-8 text-center">
          <div className="relative mx-auto mb-4 w-12 h-12">
            <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
            <div className="relative flex items-center justify-center w-12 h-12 rounded-full bg-primary/10">
              <Brain className="w-6 h-6 text-primary animate-pulse" />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        </div>
      </Card>
    );
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    
    const newFiles: File[] = [];
    const newPreviews: string[] = [];
    
    // Supported file types: images, audio, PDFs
    const supportedTypes = ['image/', 'audio/', 'application/pdf'];
    
    for (let i = 0; i < files.length && mediaFiles.length + newFiles.length < 5; i++) {
      const file = files[i];
      const isSupported = supportedTypes.some(type => file.type.startsWith(type));
      
      if (isSupported) {
        newFiles.push(file);
        if (file.type.startsWith('image/')) {
          newPreviews.push(URL.createObjectURL(file));
        } else if (file.type === 'application/pdf') {
          newPreviews.push('pdf');
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

  // Handle paste event for images
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const newFiles: File[] = [];
    const newPreviews: string[] = [];

    for (let i = 0; i < items.length && mediaFiles.length + newFiles.length < 5; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          newFiles.push(file);
          newPreviews.push(URL.createObjectURL(file));
        }
      }
    }

    if (newFiles.length > 0) {
      e.preventDefault(); // Prevent pasting image URL as text
      setMediaFiles(prev => [...prev, ...newFiles]);
      setMediaPreviews(prev => [...prev, ...newPreviews]);
      toast.success(t('brainDump.imagePasted') || 'Image added');
    }
  };

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragging to false if we're leaving the drop zone entirely
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (!files) return;

    const newFiles: File[] = [];
    const newPreviews: string[] = [];

    // Supported file types: images, audio, PDFs
    const supportedTypes = ['image/', 'audio/', 'application/pdf'];

    for (let i = 0; i < files.length && mediaFiles.length + newFiles.length < 5; i++) {
      const file = files[i];
      const isSupported = supportedTypes.some(type => file.type.startsWith(type));
      
      if (isSupported) {
        newFiles.push(file);
        if (file.type.startsWith('image/')) {
          newPreviews.push(URL.createObjectURL(file));
        } else if (file.type === 'application/pdf') {
          newPreviews.push('pdf');
        } else {
          newPreviews.push('audio');
        }
      }
    }

    if (newFiles.length > 0) {
      setMediaFiles(prev => [...prev, ...newFiles]);
      setMediaPreviews(prev => [...prev, ...newPreviews]);
      toast.success(
        newFiles.length === 1 
          ? t('brainDump.fileAdded') || 'File added' 
          : t('brainDump.filesAdded', { count: newFiles.length }) || `${newFiles.length} files added`
      );
    }
  }, [mediaFiles.length, t]);

  const removeMedia = (index: number) => {
    setMediaFiles(prev => prev.filter((_, i) => i !== index));
    setMediaPreviews(prev => {
      const preview = prev[index];
      if (preview && preview !== 'audio' && preview !== 'pdf') {
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
        
        // Use signed URL for private bucket access
        const { data: signedData, error: signedError } = await supabase.storage
          .from('note-media')
          .createSignedUrl(filename, 60 * 60 * 24 * 365); // 1 year expiry for stored URLs
        
        if (signedError || !signedData?.signedUrl) {
          console.error('[NoteInput] Failed to create signed URL:', signedError);
          continue;
        }
        
        uploadedUrls.push(signedData.signedUrl);
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
      toast.error(t('toast.enterNoteOrMedia'));
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
      // Send empty string for media-only notes - process-note will derive content from media
      const { data: aiProcessedNote, error } = await supabase.functions.invoke('process-note', {
        body: { 
          text: text.trim(),
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
        toast.success(t('toast.multipleTasksIdentified', { count: aiProcessedNote.notes.length }));
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
      toast.success(t('toast.noteProcessed'));
      
      // Clear the input
      setText("");
      setInterim("");
      clearMediaFiles();
      
      // Don't call onNoteAdded yet - wait for user to accept
    } catch (error) {
      console.error("Error processing note:", error);
      toast.error(t('toast.failedToProcess'));
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
    // Update the local state with edited values, merging both formats
    console.log('[NoteInput] Updating processed note with:', updatedNote);
    setProcessedNote(prev => {
      if (!prev) return null;
      return {
        ...prev,
        summary: updatedNote.summary ?? prev.summary,
        category: updatedNote.category ?? prev.category,
        priority: updatedNote.priority ?? prev.priority,
        tags: updatedNote.tags ?? prev.tags,
        items: updatedNote.items ?? prev.items,
        dueDate: updatedNote.dueDate ?? updatedNote.due_date ?? prev.dueDate,
        taskOwner: updatedNote.taskOwner ?? updatedNote.task_owner ?? prev.taskOwner,
        listId: updatedNote.listId ?? updatedNote.list_id ?? prev.listId
      };
    });
  };

  const handleSaveNote = async () => {
    if (!processedNote || !user) return;
    
    try {
      console.log('[NoteInput] Saving accepted note to database:', processedNote);
      
      // Prepare note data in the correct format for SupabaseNotesProvider (Note shape)
      const noteData = {
        originalText: processedNote.originalText,
        summary: processedNote.summary,
        category: processedNote.category,
        dueDate: processedNote.dueDate,
        completed: processedNote.completed || false,
        priority: processedNote.priority,
        tags: processedNote.tags || [],
        items: processedNote.items || [],
        list_id: processedNote.listId || null,
        task_owner: processedNote.taskOwner || null,
        media_urls: processedNote.mediaUrls || [],
      };

      
      const newNote = await addNote(noteData);
      
      if (!newNote) {
        throw new Error('Failed to save note to database');
      }
      
      toast.success(t('toast.noteSaved'));
      
      // Refetch and close
      await refetchNotes();
      handleCloseRecap();
      onNoteAdded?.(); // Notify parent to close dialog/refresh
    } catch (error) {
      console.error('[NoteInput] Error saving note:', error);
      toast.error(t('toast.failedToSave'));
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
      return t('brainDump.placeholder.weekend');
    }
    
    // Morning suggestions
    if (hour < 12) {
      return t('brainDump.placeholder.morning');
    }
    
    // Afternoon suggestions
    if (hour < 18) {
      return t('brainDump.placeholder.afternoon');
    }
    
    // Evening suggestions
    return t('brainDump.placeholder.evening');
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
      <div className="space-y-4 animate-fade-in">
        <NoteRecap 
          note={processedNote} 
          onClose={handleCloseRecap} 
          onNoteUpdated={handleNoteUpdated}
        />
        <div className="flex gap-3">
          <Button 
            onClick={handleCloseRecap}
            variant="outline" 
            className="flex-1 border-border hover:bg-muted transition-all duration-200"
          >
            {t('brainDump.startOver')}
          </Button>
          <Button 
            onClick={handleSaveNote}
            variant="accent"
            className="flex-1 shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-[1.02]"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {t('brainDump.saveNote')}
          </Button>
        </div>
      </div>
    );
  }


  const hasContent = text.trim() || mediaFiles.length > 0;

  return (
    <div 
      ref={dropZoneRef}
      className={cn(
        // HERO INPUT: No card background on desktop - sits directly on paper
        // Mobile keeps the elevated look
        "overflow-hidden transition-all duration-300 ease-out relative",
        "bg-white rounded-[2rem] shadow-lg md:bg-transparent md:shadow-none md:rounded-none",
        hasContent && "md:bg-white/50",
        isProcessing && "ring-2 ring-primary/20",
        isDragging && "ring-2 ring-primary/40 bg-primary/5"
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drop overlay indicator */}
      {isDragging && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/10 backdrop-blur-sm rounded-2xl border-2 border-dashed border-primary/50 pointer-events-none animate-fade-in">
          <div className="text-center">
            <Image className="w-12 h-12 mx-auto mb-3 text-primary animate-bounce" />
            <p className="text-base md:text-lg font-medium text-primary">
              {t('brainDump.dropHere') || 'Drop images here'}
            </p>
          </div>
        </div>
      )}
      
      {/* Content - HERO STYLE on desktop */}
      <form onSubmit={handleSubmit} className="p-6 md:p-0 space-y-5 md:space-y-8">
        {/* AI Icon in Gutter Position (desktop only) */}
        <div className="hidden md:flex items-start gap-6">
          {/* Prominent AI Stars icon - 32x32 */}
          <div className={cn(
            "flex-shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300",
            isProcessing 
              ? "bg-[hsl(var(--olive-magic))]/30 animate-pulse" 
              : hasContent 
                ? "bg-primary/10" 
                : "bg-stone-100"
          )}>
            <Sparkles className={cn(
              "w-7 h-7 transition-colors duration-300",
              isProcessing ? "text-[hsl(130_22%_29%)]" : hasContent ? "text-primary" : "text-stone-400"
            )} />
          </div>
          
          {/* Desktop Input Column - Full border on focus */}
          <div className={cn(
            "flex-1 space-y-4 p-4 rounded-2xl transition-all duration-300 relative",
            "focus-within:bg-white/60",
            "after:absolute after:inset-0 after:rounded-2xl after:border-2 after:border-primary after:pointer-events-none after:opacity-0 after:transition-opacity after:duration-300 after:z-10",
            "focus-within:after:opacity-100"
          )}>
            {/* Textarea - HERO TYPOGRAPHY: text-4xl font-serif */}
            <div className="relative">
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onPaste={handlePaste}
                placeholder={t('brainDump.heroPlaceholder', "What's on your mind?")}
                className={cn(
                  // HERO: 180px min-height, text-4xl SERIF - looks like document title
                  "min-h-[180px] resize-none pr-16 pb-20 transition-all duration-300 ease-out",
                  "text-2xl md:text-3xl lg:text-4xl font-serif leading-relaxed",
                  "bg-transparent border-0 rounded-none",
                  // Disable shadcn Textarea's focus-visible ring so our wrapper border is the only focus affordance
                  "focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none",
                  // Placeholder: Better contrast - stone-400 instead of stone-300
                  "placeholder:text-stone-400 placeholder:font-light placeholder:text-3xl lg:placeholder:text-4xl"
                )}
                disabled={isProcessing || isUploadingMedia}
              />
              
              {/* Controls - Right side */}
              <div className="absolute top-2 right-2 flex items-center gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept="image/*,audio/*,application/pdf"
                  multiple
                  className="hidden"
                />
                
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing || isUploadingMedia || mediaFiles.length >= 5}
                  className={cn(
                    "h-10 w-10 rounded-full transition-all duration-300",
                    "text-stone-400 hover:text-primary hover:bg-primary/10",
                    mediaFiles.length > 0 && "text-primary bg-primary/10"
                  )}
                >
                  <Image className="h-5 w-5" />
                </Button>
                
                <VoiceInput 
                  text={text} 
                  setText={setText}
                  interim={interim}
                  setInterim={setInterim}
                  disabled={isProcessing || isUploadingMedia}
                />
              </div>
            </div>
            
            {/* Media previews */}
            {mediaPreviews.length > 0 && (
              <div className="flex flex-wrap gap-3 p-4 bg-stone-50 rounded-2xl animate-fade-in">
                {mediaPreviews.map((preview, index) => (
                  <div 
                    key={index} 
                    className="relative group animate-scale-in"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    {preview === 'audio' ? (
                      <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                        <Mic className="w-6 h-6 text-primary" />
                      </div>
                    ) : preview === 'pdf' ? (
                      <div className="w-16 h-16 rounded-xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
                        <svg className="w-6 h-6 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                    ) : (
                      <img 
                        src={preview} 
                        alt={`Attached ${index + 1}`}
                        className="w-16 h-16 object-cover rounded-xl"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => removeMedia(index)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110 shadow-md"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            {/* Submit row - Floating pill button inside input area */}
            <div className="flex items-center justify-between mt-4">
              <p className={cn(
                "text-sm transition-all duration-300",
                isProcessing || isUploadingMedia 
                  ? "text-primary font-medium" 
                  : "text-stone-500"
              )}>
                {isUploadingMedia ? "Uploading..." : isProcessing ? "AI is organizing..." : "AI will organize your note"}
              </p>
              
              <Button
                type="submit"
                disabled={isProcessing || isUploadingMedia || !hasContent}
                className={cn(
                  // PILL BUTTON: Floating on the writing paper
                  "h-11 px-6 rounded-full font-semibold",
                  "bg-stone-800 hover:bg-black text-white",
                  "shadow-lg transition-all duration-300 ease-out",
                  "hover:shadow-xl hover:scale-105",
                  !hasContent && "opacity-50",
                  isProcessing && "animate-pulse"
                )}
              >
                {isProcessing || isUploadingMedia ? (
                  <Sparkles className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    {t('brainDump.submit', 'Capture')}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
        
        {/* Mobile Layout - Enhanced for native feel */}
        <div className="md:hidden">
          {/* Header with animated brain icon */}
          <div className="text-center mb-5">
            <div className="inline-flex items-center gap-3 mb-2">
              <div className={cn(
                "w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300",
                isProcessing 
                  ? "bg-[hsl(var(--olive-magic))]/30 animate-pulse" 
                  : hasContent 
                    ? "bg-primary/15" 
                    : "bg-muted"
              )}>
                <Brain className={cn(
                  "w-5 h-5 transition-colors duration-300",
                  isProcessing ? "text-[hsl(130_22%_29%)]" : hasContent ? "text-primary" : "text-muted-foreground"
                )} />
              </div>
              <h2 className="font-serif font-semibold text-xl text-foreground">
                {t('brainDump.title')}
              </h2>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('brainDump.subtitle')}
            </p>
          </div>
          
          {/* Media previews */}
          {mediaPreviews.length > 0 && (
            <div className="flex flex-wrap gap-3 p-3 bg-muted/30 rounded-xl animate-fade-in">
              {mediaPreviews.map((preview, index) => (
                <div 
                  key={index} 
                  className="relative group animate-scale-in"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  {preview === 'audio' ? (
                    <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                      <Mic className="w-6 h-6 text-primary" />
                    </div>
                  ) : preview === 'pdf' ? (
                    <div className="w-16 h-16 rounded-xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
                      <svg className="w-6 h-6 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                  ) : (
                    <img 
                      src={preview} 
                      alt={`Attached ${index + 1}`}
                      className="w-16 h-16 object-cover rounded-xl"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removeMedia(index)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110 shadow-md"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <span className="text-xs text-muted-foreground self-end pb-1">
                {t('brainDump.moreAllowed', { count: 5 - mediaFiles.length })}
              </span>
            </div>
          )}
          
          {/* Textarea - Mobile version - Enhanced with larger placeholder */}
          <div className="relative group">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={handlePaste}
              placeholder={getDynamicPlaceholder()}
              className={cn(
                "min-h-[160px] resize-none pb-16 transition-all duration-300 ease-out",
                // Larger placeholder text (18px = text-lg, font-medium)
                "text-lg leading-relaxed font-medium",
                "bg-muted/30 border-0 rounded-2xl shadow-inner",
                "focus:ring-2 focus:ring-primary/30 focus:bg-white focus:shadow-lg",
                // Better placeholder legibility with slightly darker color
                "placeholder:text-stone-400 placeholder:text-lg placeholder:font-normal"
              )}
              disabled={isProcessing || isUploadingMedia}
            />
            
            {/* Interim transcript */}
            {interim && (
              <div className="absolute top-4 left-5 right-28 text-base text-primary/70 italic pointer-events-none animate-pulse">
                {interim}...
              </div>
            )}
            
            {/* Voice and media input controls - anchored bottom-right */}
            <div className="absolute bottom-3 right-14 flex items-center gap-2">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept="image/*,audio/*,application/pdf"
                multiple
                className="hidden"
              />
              
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing || isUploadingMedia || mediaFiles.length >= 5}
                className={cn(
                  "h-10 w-10 rounded-full transition-all duration-300",
                  "text-stone-400 hover:text-primary hover:bg-primary/10",
                  mediaFiles.length > 0 && "text-primary bg-primary/10"
                )}
              >
                <Image className="h-5 w-5" />
              </Button>
              
              <VoiceInput 
                text={text} 
                setText={setText}
                interim={interim}
                setInterim={setInterim}
                disabled={isProcessing || isUploadingMedia}
              />
            </div>
            
            {/* Send button - circular, bottom-right */}
            <div className={cn(
              "absolute bottom-3 right-3 transition-all duration-300 ease-out",
              hasContent ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"
            )}>
              <Button
                type="submit"
                size="icon"
                disabled={isProcessing || isUploadingMedia || !hasContent}
                className={cn(
                  "h-10 w-10 rounded-full bg-primary hover:bg-primary-dark text-primary-foreground",
                  "shadow-lg transition-all duration-300 ease-out",
                  "hover:shadow-xl hover:scale-105",
                  isProcessing && "animate-pulse"
                )}
              >
                {isProcessing || isUploadingMedia ? (
                  <Sparkles className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          
          {/* Status text - as a subtle pill tag */}
          <div className="flex items-center justify-center mt-3">
            <div className={cn(
              "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs transition-all duration-300",
              isProcessing || isUploadingMedia 
                ? "bg-primary/10 text-primary font-medium" 
                : "bg-muted/50 text-muted-foreground"
            )}>
              {isUploadingMedia ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" />
                  Uploading media...
                </>
              ) : isProcessing ? (
                <>
                  <Sparkles className="w-3 h-3 animate-spin" />
                  AI is organizing your note...
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3" />
                  AI will organize your note
                </>
              )}
            </div>
          </div>
        </div>
      </form>
      
      <LoginPromptDialog 
        open={showLoginPrompt}
        onOpenChange={setShowLoginPrompt}
      />
    </div>
  );
};
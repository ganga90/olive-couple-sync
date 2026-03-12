import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Send, Sparkles, CheckCircle, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";

interface SimpleNoteInputProps {
  onNoteAdded?: () => void;
}

interface ProcessedNote {
  summary: string;
  category: string;
  priority: string;
  tags: string[];
  items: string[];
  due_date?: string;
}

export const SimpleNoteInput: React.FC<SimpleNoteInputProps> = ({ onNoteAdded }) => {
  const { t } = useTranslation('notes');
  const [text, setText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedNote, setProcessedNote] = useState<ProcessedNote | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [isSensitive, setIsSensitive] = useState(false);

  const { user } = useAuth();
  const { currentCouple } = useSupabaseCouple();
  const { refetch: refetchNotes } = useSupabaseNotesContext();

  const processNoteWithAI = async (noteText: string): Promise<ProcessedNote> => {
    const userId = user?.id;
    if (!userId) throw new Error('Not authenticated');

    const payload: any = {
      text: noteText,
      user_id: userId,
      couple_id: currentCouple?.id || null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      source: 'web',
    };

    if (isSensitive) {
      payload.is_sensitive = true;
    }

    const { data, error } = await supabase.functions.invoke('process-note', {
      body: payload,
    });

    if (error) throw error;

    // Insert the note into the database
    const noteData = {
      author_id: userId,
      couple_id: currentCouple?.id || null,
      original_text: noteText,
      summary: data.summary || noteText,
      category: data.category || 'task',
      priority: data.priority || 'medium',
      tags: data.tags || [],
      items: data.items || [],
      due_date: data.due_date || null,
      reminder_time: data.reminder_time || null,
      is_sensitive: isSensitive,
      completed: false,
      source: 'web',
    };

    const { error: insertError } = await supabase
      .from('clerk_notes')
      .insert(noteData);

    if (insertError) throw insertError;

    return {
      summary: data.summary || noteText,
      category: data.category || 'task',
      priority: data.priority || 'medium',
      tags: data.tags || [],
      items: data.items || [],
      due_date: data.due_date,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!text.trim()) {
      toast.error(t('brainDump.emptyNote', 'Please enter a note'));
      return;
    }

    setIsProcessing(true);
    setShowResult(false);
    
    try {
      const processed = await processNoteWithAI(text.trim());
      setProcessedNote(processed);
      setShowResult(true);
      refetchNotes?.();
      onNoteAdded?.();
      toast.success(t('brainDump.noteOrganized', 'Note organized by AI!'));
    } catch (error) {
      console.error("Error processing note:", error);
      toast.error(t('brainDump.processingError', 'Failed to process note. Please try again.'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddAnother = () => {
    setText("");
    setProcessedNote(null);
    setShowResult(false);
    setIsSensitive(false);
  };

  const getDynamicPlaceholder = () => {
    const hour = new Date().getHours();
    const day = new Date().getDay();
    
    if (day === 0 || day === 6) {
      return t('brainDump.placeholderWeekend', 'Weekend plans, errands, or fun activities...');
    }
    if (hour < 12) {
      return t('brainDump.placeholderMorning', 'Morning tasks, groceries, or today\'s priorities...');
    }
    if (hour < 18) {
      return t('brainDump.placeholderAfternoon', 'Afternoon goals, errands, or evening plans...');
    }
    return t('brainDump.placeholderEvening', 'Tomorrow\'s prep, shopping lists, or date ideas...');
  };

  if (showResult && processedNote) {
    return (
      <div className="space-y-4">
        <Card className="bg-gradient-soft border-olive/20 shadow-soft">
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2 text-olive">
              <CheckCircle className="h-5 w-5" />
              <span className="font-medium">{t('brainDump.noteOrganized', 'Note organized!')}</span>
            </div>
            
            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-medium text-muted-foreground">{t('brainDump.originalNote', 'Original Note')}:</h4>
                <p className="text-foreground bg-background/50 p-3 rounded-lg mt-1">{text}</p>
              </div>
              
              <div>
                <h4 className="text-sm font-medium text-muted-foreground">{t('brainDump.aiSummary', 'AI Summary')}:</h4>
                <p className="text-foreground mt-1">{processedNote.summary}</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">{t('brainDump.category', 'Category')}:</h4>
                  <span className="inline-flex items-center px-2 py-1 rounded-md bg-olive/10 text-olive text-sm mt-1">
                    {processedNote.category.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                  </span>
                </div>
                
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">{t('brainDump.priority', 'Priority')}:</h4>
                  <span className={`inline-flex items-center px-2 py-1 rounded-md text-sm mt-1 ${
                    processedNote.priority === 'high' ? 'bg-destructive/10 text-destructive' :
                    processedNote.priority === 'medium' ? 'bg-accent/10 text-accent-foreground' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    {processedNote.priority}
                  </span>
                </div>
              </div>
              
              {processedNote.tags.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">{t('brainDump.tags', 'Tags')}:</h4>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {processedNote.tags.map((tag, index) => (
                      <span key={index} className="inline-flex items-center px-2 py-1 rounded-md bg-background text-foreground text-xs">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {processedNote.items.length > 1 && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">{t('brainDump.itemsDetected', 'Items Detected')}:</h4>
                  <ul className="mt-1 space-y-1">
                    {processedNote.items.map((item, index) => (
                      <li key={index} className="text-sm text-foreground flex items-center gap-2">
                        <span className="w-1 h-1 bg-olive rounded-full"></span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </Card>
        
        <Button 
          onClick={handleAddAnother}
          className="w-full bg-gradient-olive text-white shadow-olive"
        >
          {t('brainDump.addAnother', 'Add Another Note')}
        </Button>
      </div>
    );
  }

  return (
    <Card className="bg-gradient-soft border-olive/20 shadow-soft">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="text-center mb-4">
          <h2 className="text-lg font-semibold text-foreground mb-1">
            {t('brainDump.title', 'Drop task or thought here')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('brainDump.subtitle', "I'll organize it for you with AI")}
          </p>
        </div>
        
        <div className="relative">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={getDynamicPlaceholder()}
            className="min-h-[120px] border-olive/30 focus:border-olive resize-none text-base"
            disabled={isProcessing}
          />
          
          {text.trim() && (
            <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant={isSensitive ? "default" : "ghost"}
                      onClick={() => setIsSensitive(!isSensitive)}
                      className={isSensitive 
                        ? "bg-primary/10 text-primary hover:bg-primary/20 h-8 w-8 p-0" 
                        : "text-muted-foreground hover:text-foreground h-8 w-8 p-0"
                      }
                    >
                      {isSensitive ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs max-w-[200px]">{t('sensitive.tooltip', 'Mark as sensitive — content will be encrypted at rest')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
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
          {isProcessing 
            ? t('brainDump.processing', 'AI is organizing your note...') 
            : t('brainDump.hint', "I'll automatically categorize, summarize, and organize your note")}
        </p>
      </form>
    </Card>
  );
};

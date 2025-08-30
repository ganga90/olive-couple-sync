import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Send, Sparkles } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";

export const FloatingNoteButton: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const { user } = useAuth();
  const { currentCouple, you } = useSupabaseCouple();
  const { addNote } = useSupabaseNotesContext();
  

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!text.trim() || !user || !currentCouple) {
      toast.error("Please enter a note and make sure you're signed in");
      return;
    }

    setIsProcessing(true);
    
    try {
      // Process the note with Gemini AI
      const { data: processedNote, error } = await supabase.functions.invoke('process-note', {
        body: { 
          text: text.trim(),
          user_id: user.id,
          couple_id: currentCouple?.id || null
        }
      });

      if (error) {
        console.error('AI processing error:', error);
        throw new Error('Failed to process note with AI');
      }
      
      await addNote({
        originalText: text.trim(),
        summary: processedNote.summary,
        category: processedNote.category,
        dueDate: processedNote.due_date,
        completed: false,
        priority: processedNote.priority,
        tags: processedNote.tags,
        items: processedNote.items,
      });

      setText("");
      setIsOpen(false);
      toast.success("Note added and organized!");
    } catch (error) {
      console.error("Error processing note:", error);
      toast.error("Failed to process note. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Only show if user is authenticated and onboarded
  if (!user || !currentCouple) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full bg-gradient-olive hover:bg-olive text-white shadow-olive shadow-lg z-50"
          size="icon"
        >
          <Plus className="h-6 w-6" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center">
            Quick Note, {you || "there"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What's on your mind? I'll organize it for you both..."
              className="min-h-[120px] border-olive/30 focus:border-olive resize-none"
              disabled={isProcessing}
              autoFocus
            />
            
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
            I'll automatically categorize, summarize, and organize your note
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
};
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Send, Sparkles } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useClerkSupabaseClient } from "@/integrations/supabase/clerk-adapter";
import { toast } from "sonner";

interface NoteInputProps {
  onNoteAdded?: () => void;
}

export const NoteInput: React.FC<NoteInputProps> = ({ onNoteAdded }) => {
  const [text, setText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const { user } = useAuth();
  const { currentCouple, you } = useSupabaseCouple();
  const { addNote } = useSupabaseNotesContext();
  const supabase = useClerkSupabaseClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!text.trim() || !user) {
      toast.error("Please enter a note and make sure you're signed in");
      return;
    }

    // If no couple exists, create a default one for the user
    let coupleToUse = currentCouple;
    if (!coupleToUse) {
      console.log('[NoteInput] No couple found, creating default couple for user');
      // Create a simple local couple for single-user notes
      coupleToUse = {
        id: `local-${user.id}`,
        title: "My Notes",
        you_name: "You",
        partner_name: "Partner",
        created_by: user.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    setIsProcessing(true);
    
    try {
      // Process the note with Gemini AI
      const { data: processedNote, error } = await supabase.functions.invoke('process-note', {
        body: { 
          text: text.trim(),
          user_id: user.id
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
      onNoteAdded?.();
      toast.success("Note added and organized!");
    } catch (error) {
      console.error("Error processing note:", error);
      toast.error("Failed to process note. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };


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
            placeholder="Grocery shopping this weekend, need to plan date night, fix the kitchen sink..."
            className="min-h-[120px] border-olive/30 focus:border-olive resize-none text-base"
            disabled={isProcessing}
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
    </Card>
  );
};
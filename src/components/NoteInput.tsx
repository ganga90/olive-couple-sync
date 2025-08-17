import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Send, Sparkles } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!text.trim() || !user || !currentCouple) {
      toast.error("Please enter a note and make sure you're signed in");
      return;
    }

    setIsProcessing(true);
    
    try {
      // Process the note with AI (we'll implement this next)
      const processedNote = await processNoteWithAI(text.trim());
      
      await addNote({
        originalText: text.trim(),
        summary: processedNote.summary,
        category: processedNote.category,
        dueDate: processedNote.dueDate,
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

  // Temporary AI processing - we'll replace this with actual AI later
  const processNoteWithAI = async (text: string) => {
    // Simple categorization based on keywords for now
    const lowercaseText = text.toLowerCase();
    let category = "general";
    
    if (lowercaseText.includes("grocery") || lowercaseText.includes("food") || lowercaseText.includes("buy")) {
      category = "groceries";
    } else if (lowercaseText.includes("task") || lowercaseText.includes("todo") || lowercaseText.includes("need to")) {
      category = "tasks";
    } else if (lowercaseText.includes("travel") || lowercaseText.includes("trip") || lowercaseText.includes("vacation")) {
      category = "travel";
    } else if (lowercaseText.includes("date") || lowercaseText.includes("dinner") || lowercaseText.includes("romantic")) {
      category = "date ideas";
    } else if (lowercaseText.includes("home") || lowercaseText.includes("house") || lowercaseText.includes("repair")) {
      category = "home improvement";
    }

    return {
      summary: text.length > 50 ? text.substring(0, 50) + "..." : text,
      category,
      dueDate: null,
      priority: "medium" as const,
      tags: [],
      items: text.includes(",") ? text.split(",").map(item => item.trim()) : [],
    };
  };

  return (
    <Card className="bg-gradient-soft border-olive/20 shadow-soft">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="text-center mb-4">
          <h2 className="text-lg font-semibold text-foreground mb-1">
            Drop a note, {you || "there"}
          </h2>
          <p className="text-sm text-muted-foreground">
            I'll organize it for you both
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
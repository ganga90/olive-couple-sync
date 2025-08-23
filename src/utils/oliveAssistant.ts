import { Note } from "@/types/note";
import { supabase } from "@/integrations/supabase/client";

// Enhanced assistant using Gemini AI for better responses
export async function assistWithNote(
  note: Note,
  userMessage: string
): Promise<{ reply: string; updates?: Partial<Note> }> {
  try {
    // Call the ask-olive-individual edge function for focused assistance
    const { data, error } = await supabase.functions.invoke('ask-olive-individual', {
      body: { 
        noteContent: `Summary: ${note.summary}\nOriginal: ${note.originalText}\nItems: ${note.items?.join(', ') || 'None'}`,
        userMessage: userMessage,
        noteCategory: note.category,
        noteTitle: note.summary
      }
    });

    if (error) {
      console.error('Ask Olive error:', error);
      throw new Error('Failed to get response from Olive assistant');
    }

    return { 
      reply: data.reply || "I'm here to help! Could you please rephrase your question?",
      updates: undefined // For now, we'll focus on providing helpful responses rather than automatic updates
    };
  } catch (error) {
    console.error("Error in assistWithNote:", error);
    
    // Fallback to basic responses if AI fails
    const category = note.category.toLowerCase();
    let fallbackReply = "I'm here to help with your note! ";

    if (category.includes('grocery') || category.includes('shopping')) {
      fallbackReply += "For shopping lists, I can help you organize items by store section, suggest quantities, or find recipes that use these ingredients.";
    } else if (category.includes('task')) {
      fallbackReply += "For tasks, I can help break them down into smaller steps, suggest deadlines, or find resources to help you complete them.";
    } else if (category.includes('travel')) {
      fallbackReply += "For travel planning, I can help with itineraries, packing lists, or finding activities at your destination.";
    } else if (category.includes('date')) {
      fallbackReply += "For date ideas, I can suggest activities based on your interests, budget, or the season.";
    } else {
      fallbackReply += "What specific help do you need with this note?";
    }

    return { reply: fallbackReply };
  }
}

// Backward-compatible wrapper used elsewhere
export async function generateOliveReply(note: Note, userMessage: string): Promise<string> {
  const { reply } = await assistWithNote(note, userMessage);
  return reply;
}
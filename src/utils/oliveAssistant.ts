import { Note } from "@/types/note";
import type { SupabaseClient } from "@supabase/supabase-js";

// Store interaction IDs for conversation continuity per note
const interactionCache = new Map<string, string>();

export interface OliveAssistantResponse {
  reply: string;
  interactionId?: string | null;
  updates?: Partial<Note>;
}

// Enhanced assistant using Gemini AI Interactions API for stateful multi-turn conversations
export async function assistWithNote(
  note: Note,
  userMessage: string,
  supabaseClient: SupabaseClient<any>
): Promise<OliveAssistantResponse> {
  try {
    // Get previous interaction ID for this note (enables conversation continuity)
    const previousInteractionId = interactionCache.get(note.id);

    // Call the ask-olive-individual edge function with Interactions API support
    const { data, error } = await supabaseClient.functions.invoke('ask-olive-individual', {
      body: { 
        noteContent: `Summary: ${note.summary}\nOriginal: ${note.originalText}\nItems: ${note.items?.join(', ') || 'None'}`,
        userMessage: userMessage,
        noteCategory: note.category,
        noteTitle: note.summary,
        previousInteractionId: previousInteractionId || null
      }
    });

    if (error) {
      console.error('Ask Olive error:', error);
      throw new Error('Failed to get response from Olive assistant');
    }

    // Store the new interaction ID for future turns in this conversation
    if (data.interactionId) {
      interactionCache.set(note.id, data.interactionId);
      console.log('[Olive Assistant] Stored interaction ID for note:', note.id);
    }

    return { 
      reply: data.reply || "I'm here to help! Could you please rephrase your question?",
      interactionId: data.interactionId,
      updates: undefined
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

// Clear the interaction cache for a specific note (e.g., when starting a new conversation)
export function clearNoteConversation(noteId: string): void {
  interactionCache.delete(noteId);
  console.log('[Olive Assistant] Cleared conversation for note:', noteId);
}

// Clear all interaction caches (e.g., on logout)
export function clearAllConversations(): void {
  interactionCache.clear();
  console.log('[Olive Assistant] Cleared all conversations');
}

// Backward-compatible wrapper used elsewhere
export async function generateOliveReply(
  note: Note, 
  userMessage: string, 
  supabaseClient: SupabaseClient<any>
): Promise<string> {
  const { reply } = await assistWithNote(note, userMessage, supabaseClient);
  return reply;
}

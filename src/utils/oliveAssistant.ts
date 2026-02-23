import { Note } from "@/types/note";
import type { SupabaseClient } from "@supabase/supabase-js";

// In-memory cache for interaction IDs (faster than DB lookups)
const interactionCache = new Map<string, string>();

export interface OliveAssistantResponse {
  reply: string;
  interactionId?: string | null;
  updates?: Partial<Note>;
}

// Fetch interaction ID from database (for session persistence)
async function getStoredInteractionId(
  noteId: string,
  supabaseClient: SupabaseClient<any>
): Promise<string | null> {
  try {
    // First check memory cache
    const cached = interactionCache.get(noteId);
    if (cached) return cached;

    // Then check database
    const { data, error } = await supabaseClient
      .from('olive_conversations')
      .select('interaction_id')
      .eq('note_id', noteId)
      .maybeSingle();

    if (error) {
      console.warn('[Olive Assistant] Error fetching stored interaction:', error);
      return null;
    }

    if (data?.interaction_id) {
      // Cache it for future use
      interactionCache.set(noteId, data.interaction_id);
      return data.interaction_id;
    }

    return null;
  } catch (e) {
    console.error('[Olive Assistant] Error in getStoredInteractionId:', e);
    return null;
  }
}

// Save interaction ID to database for persistence
async function saveInteractionId(
  noteId: string,
  interactionId: string,
  supabaseClient: SupabaseClient<any>
): Promise<void> {
  try {
    // Update memory cache immediately
    interactionCache.set(noteId, interactionId);

    // Get user ID from session
    const { data: { session } } = await supabaseClient.auth.getSession();
    const userId = session?.user?.id;
    
    if (!userId) {
      console.warn('[Olive Assistant] No user session, skipping DB persistence');
      return;
    }

    // Upsert to database
    const { error } = await supabaseClient
      .from('olive_conversations')
      .upsert({
        user_id: userId,
        note_id: noteId,
        interaction_id: interactionId,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,note_id'
      });

    if (error) {
      console.warn('[Olive Assistant] Error saving interaction:', error);
    } else {
    }
  } catch (e) {
    console.error('[Olive Assistant] Error in saveInteractionId:', e);
  }
}

// Enhanced assistant using Gemini AI Interactions API for stateful multi-turn conversations
export async function assistWithNote(
  note: Note,
  userMessage: string,
  supabaseClient: SupabaseClient<any>,
  userId?: string
): Promise<OliveAssistantResponse> {
  try {
    // Get previous interaction ID (from cache or database)
    const previousInteractionId = await getStoredInteractionId(note.id, supabaseClient);

    // Call the ask-olive-individual edge function with Interactions API support
    const { data, error } = await supabaseClient.functions.invoke('ask-olive-individual', {
      body: { 
        noteContent: `Summary: ${note.summary}\nOriginal: ${note.originalText}\nItems: ${note.items?.join(', ') || 'None'}`,
        userMessage: userMessage,
        noteCategory: note.category,
        noteTitle: note.summary,
        previousInteractionId: previousInteractionId || null,
        user_id: userId || null
      }
    });

    if (error) {
      console.error('Ask Olive error:', error);
      throw new Error('Failed to get response from Olive assistant');
    }

    // Store the new interaction ID for future turns (both cache and DB)
    if (data.interactionId) {
      await saveInteractionId(note.id, data.interactionId, supabaseClient);
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

// Clear the conversation for a specific note (both cache and DB)
export async function clearNoteConversation(
  noteId: string,
  supabaseClient?: SupabaseClient<any>
): Promise<void> {
  // Clear from memory cache
  interactionCache.delete(noteId);

  // Clear from database if client provided
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('olive_conversations')
        .delete()
        .eq('note_id', noteId);

      if (error) {
        console.warn('[Olive Assistant] Error clearing conversation from DB:', error);
      } else {
      }
    } catch (e) {
      console.error('[Olive Assistant] Error in clearNoteConversation:', e);
    }
  }
}

// Clear all conversations (e.g., on logout)
export function clearAllConversations(): void {
  interactionCache.clear();
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

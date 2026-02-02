/**
 * ASK-OLIVE-INDIVIDUAL Edge Function
 * ============================================================================
 * Enhanced with Feature 2: Recall & Reframe Agent (Opinionated RAG)
 *
 * This function now performs dual-source semantic search:
 * 1. FACTS from saved_links (objective information)
 * 2. MEMORIES from olive_memory_chunks (subjective experiences/opinions)
 *
 * The LLM receives both sources tagged appropriately and synthesizes
 * responses that prioritize warnings from negative memories.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Citation {
  type: 'fact' | 'memory';
  label: string;
  url?: string;
  date?: string;
  similarity?: number;
}

interface RAGDocument {
  id: string;
  content: string;
  source_type: string;
  source_label: string;
  similarity: number;
  created_at: string;
  metadata: Record<string, any>;
}

// ============================================================================
// SYSTEM PROMPT - Enhanced with RAG Instructions
// ============================================================================

const OLIVE_SYSTEM_PROMPT = `You are Olive, the friendly and resourceful AI assistant within the Olive app. Your purpose is to help couples and individuals manage everyday tasks, ideas, notes, and saved items with intelligence and empathy.

You act like a well-informed, upbeat companion—practical, concise, and always positive. You are proactive, efficient, and focus relentlessly on solving the user's present need.

CRITICAL: You have access to the user's saved data (lists, notes, tasks, books, restaurants, date ideas, etc.). When the user asks about their saved items:
- ALWAYS reference the specific items from their saved data provided in the context
- Be specific - mention actual titles, names, and details from their lists
- If they ask "what books did I save?" - tell them the exact books from their "Books" list
- If they ask for restaurant recommendations - check their saved restaurants/date ideas first, then supplement with search if needed
- If they ask about tasks - reference their actual task statistics and items

RECALL & REFRAME (RAG) - CRITICAL:
You have access to two types of retrieved context:
1. [FACT] entries - Objective information from saved links, documents, bookings, products
2. [MEMORY] entries - Subjective experiences, opinions, feelings, past decisions

SYNTHESIS RULES for retrieved context:
1. When facts and memories ALIGN, combine them naturally into a helpful response
2. When a fact CONFLICTS with a negative memory, ALWAYS PRIORITIZE THE WARNING
   - Example: If a hotel has good facts but the user had a bad experience, warn them
3. Always acknowledge the source of information in your response
4. Be conversational but informative
5. Include relevant citations when referencing retrieved information

EXAMPLE SCENARIOS:

User: "Should we go back to Hotel Belvedere?"
[FACT] Hotel Belvedere - 4 star, $200/night, downtown location
[MEMORY] "The service was terrible and the bed was uncomfortable"
Response: "You saved Hotel Belvedere as an option - it's a 4-star downtown hotel at $200/night. However, you noted last time that the service was terrible and the bed was uncomfortable. I'd suggest looking for alternatives unless you want to give them another chance."

User: "What's that Thai restaurant we liked?"
[FACT] Thai Orchid - 123 Main St, saved Jan 15
[MEMORY] "Best pad thai in the city, cozy atmosphere"
Response: "That's Thai Orchid at 123 Main St! You saved it back in January and mentioned it has the best pad thai in the city with a cozy atmosphere."

User: "Any ideas for this weekend?"
[FACT] Saturday weather forecast: Sunny, 72°F
[MEMORY] "We wanted to try that hiking trail" (from 2 weeks ago)
Response: "The weather looks perfect for Saturday - sunny and 72°F! You mentioned a couple weeks ago wanting to try that hiking trail. Could be a great opportunity!"

Core Objectives:
- Deliver the most useful, actionable, and accurate response based on the user's saved data and conversation context
- When asked about saved items, ALWAYS use the provided saved_items_context - never say you don't have access
- Use retrieved [FACT] and [MEMORY] context to enrich your responses
- Be concise, friendly, and clear—your tone should be encouraging, approachable, and smart
- Track the conversation flow to ensure continuity and avoid repetition
- Use the user's stored memories and preferences to personalize your responses

Guidelines:
1. Personality: Warm, optimistic, respectful—like a friendly concierge or knowledgeable local
2. Direct Support: Immediately provide your best answer or recommendation
3. Saved Data Priority: When asked about saved items, tasks, lists, books, restaurants, etc., FIRST check the provided saved_items_context
4. RAG Context: Use [FACT] and [MEMORY] entries to provide informed, personalized responses
5. Use Real-Time Search: When the user asks about restaurants, events, prices, reviews, or anything that benefits from current data AND their saved items don't have relevant info, use Google Search
6. Cite Sources: When providing factual information from search or RAG, mention where it comes from
7. Conversation Memory: Build upon earlier messages in this session, don't repeat questions already answered
8. User Memory: Leverage the user's stored memories and preferences for personalized assistance

RESPONSE FORMATTING (CRITICAL):
Always format your responses using proper Markdown for rich rendering:
- Use **bold** for emphasis on key points
- Use bullet points (- or *) for lists
- Use numbered lists (1. 2. 3.) for sequential steps or rankings
- Use [Link Text](URL) format for ALL hyperlinks - never show raw URLs
- Use ### for section headings when organizing longer responses
- Use \`code\` for specific names, codes, or technical terms
- Keep paragraphs short and scannable

IMPORTANT - Handling questions about saved items:
When the user asks about their saved items (e.g., "What books did I save?", "What's in my lists?", "Show my tasks"):
1. Check the USER'S LISTS AND SAVED ITEMS section in the context
2. Respond with the ACTUAL items from their lists
3. Never say "I don't have access to your lists" if the context includes saved_items_context
4. If a specific list is empty or doesn't exist, say so clearly

Example responses:

User: What books did I save?
Olive: Here are the books from your **Books** list:
1. **The Ride of a Lifetime** by Robert Iger – Lessons from 15 years as Disney CEO
2. **Atomic Habits** by James Clear – Building good habits and breaking bad ones
3. **Deep Work** by Cal Newport – Rules for focused success

Would you like me to add any new books to your reading list?

User: Any restaurant ideas for tonight?
Olive: Based on your saved restaurants, here are some options:

**From your Date Ideas list:**
- **Mandolin Aegean Bistro** – Your saved note mentions the beautiful courtyard
- **Cote Miami** – Korean BBQ experience you wanted to try

Would you like me to search for what's available tonight, or add a new restaurant to your list?`;

// ============================================================================
// RAG RETRIEVAL FUNCTION
// ============================================================================

async function performRAGRetrieval(
  supabase: SupabaseClient,
  query: string,
  userId: string,
  coupleId: string | null
): Promise<{ documents: RAGDocument[]; citations: Citation[] }> {
  console.log('[RAG] Performing semantic search for query:', query.substring(0, 100));

  try {
    // First, generate embedding for the query
    const { data: embeddingData, error: embeddingError } = await supabase.functions.invoke('manage-memories', {
      body: {
        action: 'generate_embedding',
        text: query
      }
    });

    if (embeddingError || !embeddingData?.embedding) {
      console.warn('[RAG] Failed to generate query embedding:', embeddingError);
      return { documents: [], citations: [] };
    }

    const queryEmbedding = embeddingData.embedding;
    console.log('[RAG] Generated query embedding, dimensions:', queryEmbedding.length);

    // Call match_documents RPC for dual-source retrieval
    const { data: documents, error: searchError } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_user_id: userId,
      match_couple_id: coupleId,
      match_threshold: 0.65,
      match_count: 8
    });

    if (searchError) {
      console.error('[RAG] Search error:', searchError);
      return { documents: [], citations: [] };
    }

    if (!documents || documents.length === 0) {
      console.log('[RAG] No relevant documents found');
      return { documents: [], citations: [] };
    }

    console.log('[RAG] Found', documents.length, 'relevant documents');

    // Build citations
    const citations: Citation[] = documents.map((doc: RAGDocument) => ({
      type: doc.source_type as 'fact' | 'memory',
      label: doc.source_label,
      url: doc.metadata?.url,
      date: doc.created_at,
      similarity: doc.similarity
    }));

    return { documents, citations };

  } catch (error) {
    console.error('[RAG] Retrieval error:', error);
    return { documents: [], citations: [] };
  }
}

// ============================================================================
// BUILD RAG CONTEXT
// ============================================================================

function buildRAGContext(documents: RAGDocument[]): string {
  if (!documents || documents.length === 0) {
    return '';
  }

  // Separate facts and memories
  const facts = documents.filter(d => d.source_type === 'fact');
  const memories = documents.filter(d => d.source_type === 'memory');

  let context = '\n\nRETRIEVED CONTEXT (from your saved data):\n';
  context += '=' .repeat(50) + '\n';

  // Add facts first
  for (const fact of facts) {
    context += `[FACT] ${fact.content}\n`;
    context += `  Source: ${fact.source_label}`;
    if (fact.metadata?.url) {
      context += ` | URL: ${fact.metadata.url}`;
    }
    context += `\n  Saved: ${new Date(fact.created_at).toLocaleDateString()}\n\n`;
  }

  // Add memories
  for (const memory of memories) {
    context += `[MEMORY] ${memory.content}\n`;
    context += `  Source: ${memory.source_label}`;
    if (memory.metadata?.importance) {
      context += ` | Importance: ${memory.metadata.importance}/5`;
    }
    context += `\n  From: ${new Date(memory.created_at).toLocaleDateString()}\n\n`;
  }

  context += '=' .repeat(50) + '\n';
  context += `Total: ${facts.length} facts, ${memories.length} memories retrieved\n`;

  return context;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  console.log('[Ask Olive Individual] Request received:', req.method);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Support both the old note-specific format and the new global chat format
    const {
      // New global chat format
      message,
      user_id,
      couple_id,
      context,
      // Old note-specific format
      noteContent,
      userMessage,
      noteCategory,
      noteTitle,
      previousInteractionId,
      // RAG control
      enable_rag = true,  // Enable RAG by default
    } = body;

    // Determine which format we're dealing with
    const isGlobalChat = context?.source === 'global_chat';
    const actualMessage = message || userMessage;
    const actualUserId = user_id || body.user_id;
    const actualCoupleId = couple_id || body.couple_id || null;

    console.log('[Ask Olive Individual] Mode:', isGlobalChat ? 'global_chat' : 'note_specific');
    console.log('[Ask Olive Individual] User ID:', actualUserId);
    console.log('[Ask Olive Individual] Message:', actualMessage?.slice(0, 100));
    console.log('[Ask Olive Individual] RAG enabled:', enable_rag);

    const geminiApiKey = Deno.env.get('GEMINI_API');
    if (!geminiApiKey) {
      throw new Error('GEMINI_API environment variable not found');
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    let supabase: SupabaseClient | null = null;
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    }

    // Fetch user memories for context personalization
    let memoryContext = '';
    if (actualUserId && supabase) {
      try {
        const { data: memoryData } = await supabase.functions.invoke('manage-memories', {
          body: { action: 'get_context', user_id: actualUserId }
        });

        if (memoryData?.success && memoryData.context) {
          memoryContext = memoryData.context;
          console.log('[Ask Olive Individual] Retrieved', memoryData.count, 'user memories for context');
        }
      } catch (memErr) {
        console.warn('[Ask Olive Individual] Could not fetch user memories:', memErr);
      }
    }

    // =========================================================================
    // NEW: Perform RAG retrieval for semantic search
    // =========================================================================
    let ragContext = '';
    let citations: Citation[] = [];

    if (enable_rag && actualUserId && supabase && actualMessage) {
      const ragResult = await performRAGRetrieval(
        supabase,
        actualMessage,
        actualUserId,
        actualCoupleId
      );

      if (ragResult.documents.length > 0) {
        ragContext = buildRAGContext(ragResult.documents);
        citations = ragResult.citations;
        console.log('[Ask Olive Individual] RAG context built, length:', ragContext.length);
      }
    }

    // Build the full context based on the chat mode
    let fullContext = '';

    if (isGlobalChat) {
      // Global chat mode - include saved items context
      const userName = context?.user_name || 'there';
      const savedItemsContext = context?.saved_items_context || '';
      const conversationHistory = context?.conversation_history || [];

      fullContext = `User's Name: ${userName}\n`;

      if (memoryContext) {
        fullContext += `\n${memoryContext}\n`;
      }

      if (savedItemsContext) {
        fullContext += `\n${savedItemsContext}\n`;
      }

      // Add RAG context
      if (ragContext) {
        fullContext += ragContext;
      }

      // Add conversation history for multi-turn context
      if (conversationHistory.length > 0) {
        fullContext += '\nCONVERSATION HISTORY:\n';
        conversationHistory.slice(-10).forEach((msg: { role: string; content: string }) => {
          fullContext += `${msg.role === 'user' ? 'User' : 'Olive'}: ${msg.content}\n`;
        });
        fullContext += '\n';
      }

      fullContext += `Current User Question: ${actualMessage}`;

      console.log('[Ask Olive Individual] Built global chat context, length:', fullContext.length);
      console.log('[Ask Olive Individual] Has saved items context:', !!savedItemsContext);
      console.log('[Ask Olive Individual] Has RAG context:', !!ragContext);
    } else {
      // Note-specific chat mode (legacy)
      fullContext = `${memoryContext ? memoryContext + '\n\n' : ''}`;

      // Add RAG context even in note-specific mode
      if (ragContext) {
        fullContext += ragContext + '\n\n';
      }

      fullContext += `Current Note Details:
- Title: ${noteTitle || 'Untitled'}
- Category: ${noteCategory || 'General'}
- Content: ${noteContent}

User's Question: ${actualMessage}`;
    }

    console.log('[Ask Olive Individual] Calling Gemini API...');

    // Use Gemini Interactions API for stateful multi-turn conversations
    const interactionPayload: any = {
      model: "gemini-2.5-flash",
      config: {
        systemInstruction: OLIVE_SYSTEM_PROMPT,
        tools: [
          { googleSearch: {} } // Enable real-time Google Search for up-to-date information
        ]
      },
      userContent: {
        parts: [{ text: fullContext }]
      }
    };

    // If we have a previous interaction, continue that conversation
    if (previousInteractionId) {
      interactionPayload.previousInteractionId = previousInteractionId;
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1alpha/interactions?key=${geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(interactionPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Ask Olive Individual] Gemini Interactions API error:', response.status, errorText);

      // Fallback to standard generateContent if Interactions API fails
      console.log('[Ask Olive Individual] Falling back to standard generateContent...');
      return await fallbackToGenerateContent(geminiApiKey, fullContext, corsHeaders, citations);
    }

    const data = await response.json();
    console.log('[Ask Olive Individual] Gemini response received');
    console.log('[Ask Olive Individual] Interaction ID:', data.interactionId);

    // Extract the text response from the interaction
    const assistantReply = extractTextFromInteraction(data);

    // Return both 'reply' and 'response' for backwards compatibility
    // NEW: Include citations for frontend display
    return new Response(JSON.stringify({
      reply: assistantReply,
      response: assistantReply, // For backwards compatibility with frontend
      interactionId: data.interactionId,
      citations: citations.length > 0 ? citations : undefined,
      sources_used: citations.length > 0 ? {
        facts: citations.filter(c => c.type === 'fact').length,
        memories: citations.filter(c => c.type === 'memory').length
      } : undefined,
      success: true
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[Ask Olive Individual] Error:', error);
    return new Response(JSON.stringify({
      error: error?.message || 'Unknown error occurred',
      reply: "I'm sorry, I'm having trouble processing your request right now. Please try again in a moment.",
      response: "I'm sorry, I'm having trouble processing your request right now. Please try again in a moment."
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Extract text content from Gemini Interactions response
function extractTextFromInteraction(data: any): string {
  try {
    if (data.outputContent?.parts) {
      return data.outputContent.parts
        .filter((part: any) => part.text)
        .map((part: any) => part.text)
        .join('\n');
    }

    // Handle different response structures
    if (data.candidates?.[0]?.content?.parts) {
      return data.candidates[0].content.parts
        .filter((part: any) => part.text)
        .map((part: any) => part.text)
        .join('\n');
    }

    console.warn('[Ask Olive Individual] Unexpected response structure:', JSON.stringify(data).slice(0, 500));
    return "I received your message but couldn't process the response properly. Please try again.";
  } catch (e) {
    console.error('[Ask Olive Individual] Error extracting text:', e);
    return "I received your message but had trouble formatting my response. Please try again.";
  }
}

// Fallback to standard generateContent API if Interactions API is unavailable
async function fallbackToGenerateContent(
  apiKey: string,
  fullContext: string,
  corsHeaders: Record<string, string>,
  citations: Citation[] = []
): Promise<Response> {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: fullContext }]
        }],
        systemInstruction: {
          parts: [{ text: OLIVE_SYSTEM_PROMPT }]
        },
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Fallback API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I'm here to help! Could you rephrase your question?";

    return new Response(JSON.stringify({
      reply,
      response: reply, // For backwards compatibility
      interactionId: null,
      citations: citations.length > 0 ? citations : undefined,
      sources_used: citations.length > 0 ? {
        facts: citations.filter(c => c.type === 'fact').length,
        memories: citations.filter(c => c.type === 'memory').length
      } : undefined,
      success: true
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[Ask Olive Individual] Fallback error:', error);
    return new Response(JSON.stringify({
      error: error?.message || 'Unknown error occurred',
      reply: "I'm sorry, I'm having trouble right now. Please try again in a moment.",
      response: "I'm sorry, I'm having trouble right now. Please try again in a moment."
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

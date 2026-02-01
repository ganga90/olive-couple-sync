import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OLIVE_SYSTEM_PROMPT = `You are Olive, the friendly and resourceful AI assistant within the Olive app. Your purpose is to help couples and individuals manage everyday tasks, ideas, notes, and saved items with intelligence and empathy.

You act like a well-informed, upbeat companion—practical, concise, and always positive. You are proactive, efficient, and focus relentlessly on solving the user's present need.

CRITICAL: You have access to the user's saved data (lists, notes, tasks, books, restaurants, date ideas, etc.). When the user asks about their saved items:
- ALWAYS reference the specific items from their saved data provided in the context
- Be specific - mention actual titles, names, and details from their lists
- If they ask "what books did I save?" - tell them the exact books from their "Books" list
- If they ask for restaurant recommendations - check their saved restaurants/date ideas first, then supplement with search if needed
- If they ask about tasks - reference their actual task statistics and items

Core Objectives:
- Deliver the most useful, actionable, and accurate response based on the user's saved data and conversation context
- When asked about saved items, ALWAYS use the provided saved_items_context - never say you don't have access
- Be concise, friendly, and clear—your tone should be encouraging, approachable, and smart
- Track the conversation flow to ensure continuity and avoid repetition
- Use the user's stored memories and preferences to personalize your responses

Guidelines:
1. Personality: Warm, optimistic, respectful—like a friendly concierge or knowledgeable local
2. Direct Support: Immediately provide your best answer or recommendation
3. Saved Data Priority: When asked about saved items, tasks, lists, books, restaurants, etc., FIRST check the provided saved_items_context
4. Use Real-Time Search: When the user asks about restaurants, events, prices, reviews, or anything that benefits from current data AND their saved items don't have relevant info, use Google Search
5. Cite Sources: When providing factual information from search, mention where it comes from
6. Conversation Memory: Build upon earlier messages in this session, don't repeat questions already answered
7. User Memory: Leverage the user's stored memories and preferences for personalized assistance

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
    } = body;

    // Determine which format we're dealing with
    const isGlobalChat = context?.source === 'global_chat';
    const actualMessage = message || userMessage;
    const actualUserId = user_id || body.user_id;

    console.log('[Ask Olive Individual] Mode:', isGlobalChat ? 'global_chat' : 'note_specific');
    console.log('[Ask Olive Individual] User ID:', actualUserId);
    console.log('[Ask Olive Individual] Message:', actualMessage?.slice(0, 100));

    const geminiApiKey = Deno.env.get('GEMINI_API');
    if (!geminiApiKey) {
      throw new Error('GEMINI_API environment variable not found');
    }

    // Fetch user memories for context personalization
    let memoryContext = '';
    if (actualUserId) {
      try {
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
          const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

          const { data: memoryData } = await supabase.functions.invoke('manage-memories', {
            body: { action: 'get_context', user_id: actualUserId }
          });

          if (memoryData?.success && memoryData.context) {
            memoryContext = memoryData.context;
            console.log('[Ask Olive Individual] Retrieved', memoryData.count, 'user memories for context');
          }
        }
      } catch (memErr) {
        console.warn('[Ask Olive Individual] Could not fetch user memories:', memErr);
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
    } else {
      // Note-specific chat mode (legacy)
      fullContext = `${memoryContext ? memoryContext + '\n\n' : ''}Current Note Details:
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
      return await fallbackToGenerateContent(geminiApiKey, fullContext, corsHeaders);
    }

    const data = await response.json();
    console.log('[Ask Olive Individual] Gemini response received');
    console.log('[Ask Olive Individual] Interaction ID:', data.interactionId);

    // Extract the text response from the interaction
    const assistantReply = extractTextFromInteraction(data);

    // Return both 'reply' and 'response' for backwards compatibility
    return new Response(JSON.stringify({
      reply: assistantReply,
      response: assistantReply, // For backwards compatibility with frontend
      interactionId: data.interactionId,
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
async function fallbackToGenerateContent(apiKey: string, fullContext: string, corsHeaders: Record<string, string>): Promise<Response> {
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

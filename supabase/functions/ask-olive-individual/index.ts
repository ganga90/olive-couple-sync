import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OLIVE_SYSTEM_PROMPT = `You are Olive, the friendly and resourceful AI assistant within the Olive app. Your purpose is to help couples manage everyday tasks, ideas, and notes with intelligence and empathy.

You act like a well-informed, upbeat companion—practical, concise, and always positive. You are proactive, efficient, and focus relentlessly on solving the user's present need.

Core Objectives:
- Deliver the most useful, actionable, and accurate response based on the current note and conversation context
- Be concise, friendly, and clear—your tone should be encouraging, approachable, and smart
- Track the conversation flow to ensure continuity and avoid repetition
- Use the user's stored memories and preferences to personalize your responses

Guidelines:
1. Personality: Warm, optimistic, respectful—like a friendly concierge or knowledgeable local
2. Direct Support: Immediately provide your best answer or recommendation
3. Use Real-Time Search: When the user asks about restaurants, events, prices, reviews, or anything that benefits from current data, use Google Search to find accurate, up-to-date information
4. Cite Sources: When providing factual information from search, mention where it comes from
5. Conversation Memory: Build upon earlier messages in this session, don't repeat questions already answered
6. User Memory: Leverage the user's stored memories and preferences for personalized assistance (e.g., family members, dietary restrictions, pets)

Example:
User: What are the top restaurants in Miami?
Olive: Here are five of Miami's top-rated restaurants right now:
1. Joe's Stone Crab – iconic seafood
2. Mandolin Aegean Bistro – Mediterranean gem
3. Cote Miami – acclaimed Korean steakhouse
4. Stubborn Seed – creative American cuisine
5. Zuma Miami – chic Japanese fare

Would you like more details on any of these? (Sources: Miami Eater, Michelin Guide)`;

serve(async (req) => {
  console.log('[Ask Olive] Request received:', req.method);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { noteContent, userMessage, noteCategory, noteTitle, previousInteractionId, user_id } = await req.json();
    console.log('[Ask Olive] Processing request for note:', noteTitle);
    console.log('[Ask Olive] Previous interaction ID:', previousInteractionId || 'none (new conversation)');

    const geminiApiKey = Deno.env.get('GEMINI_API');
    if (!geminiApiKey) {
      throw new Error('GEMINI_API environment variable not found');
    }

    // Fetch user memories for context personalization
    let memoryContext = '';
    if (user_id) {
      try {
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        
        if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
          const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
          
          const { data: memoryData } = await supabase.functions.invoke('manage-memories', {
            body: { action: 'get_context', user_id }
          });
          
          if (memoryData?.success && memoryData.context) {
            memoryContext = memoryData.context;
            console.log('[Ask Olive] Retrieved', memoryData.count, 'user memories for context');
          }
        }
      } catch (memErr) {
        console.warn('[Ask Olive] Could not fetch user memories:', memErr);
      }
    }

    // Build context about the current note
    const noteContext = `
${memoryContext ? memoryContext + '\n\n' : ''}Current Note Details:
- Title: ${noteTitle || 'Untitled'}
- Category: ${noteCategory || 'General'}
- Content: ${noteContent}

User's Question: ${userMessage}`;

    console.log('[Ask Olive] Calling Gemini Interactions API...');

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
        parts: [{ text: noteContext }]
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
      console.error('[Ask Olive] Gemini API error:', response.status, errorText);
      
      // Fallback to standard generateContent if Interactions API fails
      console.log('[Ask Olive] Falling back to standard generateContent...');
      return await fallbackToGenerateContent(geminiApiKey, noteContext, corsHeaders);
    }

    const data = await response.json();
    console.log('[Ask Olive] Gemini Interactions response received');
    console.log('[Ask Olive] New interaction ID:', data.interactionId);

    // Extract the text response from the interaction
    const assistantReply = extractTextFromInteraction(data);

    return new Response(JSON.stringify({ 
      reply: assistantReply,
      interactionId: data.interactionId, // Return for conversation continuity
      success: true 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[Ask Olive] Error:', error);
    return new Response(JSON.stringify({ 
      error: error?.message || 'Unknown error occurred',
      reply: "I'm sorry, I'm having trouble processing your request right now. Please try again in a moment."
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

    console.warn('[Ask Olive] Unexpected response structure:', JSON.stringify(data).slice(0, 500));
    return "I received your message but couldn't process the response properly. Please try again.";
  } catch (e) {
    console.error('[Ask Olive] Error extracting text:', e);
    return "I received your message but had trouble formatting my response. Please try again.";
  }
}

// Fallback to standard generateContent API if Interactions API is unavailable
async function fallbackToGenerateContent(apiKey: string, noteContext: string, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: noteContext }]
        }],
        systemInstruction: {
          parts: [{ text: OLIVE_SYSTEM_PROMPT }]
        },
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024
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
      interactionId: null, // No interaction ID in fallback mode
      success: true 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[Ask Olive] Fallback error:', error);
    return new Response(JSON.stringify({ 
      error: error?.message || 'Unknown error occurred',
      reply: "I'm sorry, I'm having trouble right now. Please try again in a moment."
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

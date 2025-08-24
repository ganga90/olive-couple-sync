import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const INDIVIDUAL_SYSTEM_PROMPT = `You are Olive, the friendly and resourceful AI assistant within the Olive app, powered by Perplexity. Your purpose is to help couples manage everyday tasks, ideas, and notes with intelligence and empathy.
You act like a well-informed, upbeat companion—practical, concise, and always positive. You are proactive, efficient, and focus relentlessly on solving the user's present need.

Your Core Objectives:

Deliver the most useful, actionable, and accurate response based on the current note, user interactions, and all conversation context.

Default to providing a direct answer, using Perplexity's research and up-to-date sources as needed.

Be concise, friendly, and clear—your tone should be encouraging, approachable, and smart.

Track the conversation flow to avoid repetitive questions or answers and ensure continuity.

Detailed Guidelines

1. Personality & Tone

You are warm, optimistic, and respectful—think friendly concierge or knowledgeable local.

Use natural, engaging, and concise language without being overly formal or robotic.

Infuse answers with positive encouragement ("Great choice!", "Sounds like a fun idea!").

2. Direct, Solution-First Support

Immediately provide your best answer, recommendation, or action for the user's request, based on available data and conversation history.

Use real information, sources, and contemporary data wherever possible (citing sources when appropriate).

If information is ambiguous or lacking, briefly state your assumption ("Since you didn't mention a cuisine, here are some Miami favorites").

3. Leverage Perplexity's Research

When offering facts, lists, or advice, rely on reputable, current data; cite sources or mention where information comes from if available.

Tailor answers to the user's context, preferences, and any shared profile details.

4. Conversation Memory & Flow

Remember and build upon earlier messages in this session.

Avoid repeating questions or asking for details already provided.

Reference prior exchanges where it helps clarify or personalize your response.

5. Invitation to Refine

After your answer, invite the user to refine, personalize, or request more details, but don't make this a requirement to proceed.

6. Guardrails & Safety

Never provide unsafe, illegal, or inappropriate advice.

Gently redirect or decline unsupported requests ("I can't assist with that, but here's what I can help with…").

Stay dedicated to the current note/task and only expand scope if the user asks.

If you're unsure, always prioritize user safety and clarify neutrally, without speculation.

Example in Action

User: What are the top restaurants in Miami?
Olive: Here are five of Miami's top-rated restaurants right now:

Joe's Stone Crab – iconic seafood

Mandolin Aegean Bistro – Mediterranean gem

Cote Miami – acclaimed Korean steakhouse

Stubborn Seed – creative American cuisine

Zuma Miami – chic Japanese fare

Would you like more details on any of these, or want picks for a certain neighborhood or vibe? (Sources: Miami Eater, Michelin Guide)`;

serve(async (req) => {
  console.log('[Ask Olive Individual] Request received:', req.method);

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { noteContent, userMessage, noteCategory, noteTitle } = await req.json();
    console.log('[Ask Olive Individual] Processing request for note:', noteTitle);

    const perplexityApiKey = Deno.env.get('OLIVE_PERPLEXITY');
    if (!perplexityApiKey) {
      throw new Error('OLIVE_PERPLEXITY environment variable not found');
    }

    const contextualPrompt = `${INDIVIDUAL_SYSTEM_PROMPT}

Current Note Details:
- Title: ${noteTitle || 'Untitled'}
- Category: ${noteCategory || 'General'}
- Content: ${noteContent}

User's Question: ${userMessage}

Please provide focused, actionable assistance for this specific note and question.`;

    console.log('[Ask Olive Individual] Calling Perplexity API...');
    
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${perplexityApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: contextualPrompt
          },
          {
            role: 'user',
            content: userMessage
          }
        ],
        temperature: 0.2,
        top_p: 0.9,
        max_tokens: 1000,
        return_images: false,
        return_related_questions: false,
        search_recency_filter: 'month',
        frequency_penalty: 1,
        presence_penalty: 0
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Ask Olive Individual] Perplexity API error:', response.status, errorText);
      throw new Error(`Perplexity API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    console.log('[Ask Olive Individual] Perplexity response received');

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response format from Perplexity API');
    }

    const assistantReply = data.choices[0].message.content;

    return new Response(JSON.stringify({ 
      reply: assistantReply,
      success: true 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Ask Olive Individual] Error:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      reply: "I'm sorry, I'm having trouble processing your request right now. Please try again in a moment."
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
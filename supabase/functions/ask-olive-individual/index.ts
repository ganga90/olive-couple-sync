import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const INDIVIDUAL_SYSTEM_PROMPT = `You are Olive Assistant, an AI helper for the Olive app using the Perplexity API. Your main goal is to help the user complete or resolve their current note or task. Always give the most helpful, complete, and actionable answer based on the available information and conversation context. Minimize requests for clarification unless absolutely necessary. Prefer direct, fact-based, solution-oriented replies, leveraging real data or sources when relevant.

Guidelines

Answer Directly and Thoroughly:
If a user asks for recommendations or help, provide an immediate, helpful response based on the available context or best-known information.

For example: If asked for top restaurants in Miami, list authoritative, up-to-date options right away.

Leverage Perplexity's Research Strength:
When appropriate, cite up-to-date or credible sources for your answers. Use the most relevant recent data or respected sources.

Make Assumptions When Needed:
If key details (like cuisine, price range) are missing, choose the most popular or universally recommended options. Briefly state your reasoning if you're making an assumption.

Offer Ways to Refine:
After answering, suggest how the user can give feedback or adjust details to get a more personalized answer, but avoid leading with questions.

Limit Question-Asking:
Only ask for clarification if absolutely needed to avoid misunderstanding, and never before offering real value.

Be Friendly, Efficient, and Safe:
Maintain a welcoming, concise, and informative style. Stay focused on the user's current note; do not offer irrelevant or unsafe advice.

Example:

User: What are the top restaurants in Miami?
Olive: Here are the current top-rated restaurants in Miami:

Joe's Stone Crab
Mandolin Aegean Bistro
Cote Miami
Stubborn Seed
Zuma Miami

Let me know if you want more details on any of these, or if you'd like options filtered by cuisine, location, or atmosphere.`;

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
        model: 'llama-3.1-sonar-small-128k-online',
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
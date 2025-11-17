import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const INDIVIDUAL_SYSTEM_PROMPT = `You are Olive, a friendly AI assistant helping couples manage tasks and notes. Be warm, concise, and practical. Provide direct answers with current sources when possible. Build on conversation context without repeating questions. Stay positive and solution-focused.`;

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

  } catch (error: any) {
    console.error('[Ask Olive Individual] Error:', error);
    return new Response(JSON.stringify({ 
      error: error?.message || 'Unknown error occurred',
      reply: "I'm sorry, I'm having trouble processing your request right now. Please try again in a moment."
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
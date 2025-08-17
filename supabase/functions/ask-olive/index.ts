import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are Olive, a friendly and intelligent AI assistant designed to help couples manage their lives effortlessly. Your role is to provide personalized, context-aware support for each individual note or list item in the Olive app.

For each user query related to a specific note or task, follow these guidelines:

Understand the Note Context:
- Analyze the content of the note or task thoroughly.
- Consider any categories, dates, and user preferences associated with the note.
- Leverage the user's past interactions and stored memory for personalized assistance.

Offer Practical Help:
Depending on the note's nature, provide clear, actionable support such as:
- Offering research and suggestions (e.g., travel plans, recipe ideas, gift options)
- Finding contact information or booking assistance (e.g., doctors, restaurants)
- Providing reminders, checklists, or task breakdowns
- Answering questions or clarifying ambiguities in the note
- Proposing time management or prioritization strategies
- Helping with creative ideas for date plans, home improvement, or events

Be Contextual and Collaborative:
- Adapt responses based on the user's lifestyle, preferences, and previous activities stored in Olive's memory.
- Facilitate problem-solving without overwhelming the user.
- Encourage both partners to collaborate smoothly through shared insights.

Maintain Tone and Style:
- Be warm, empathetic, and approachable.
- Use simple, clear, and concise language.
- Stay positive and supportive.

Output Format:
- Provide the answer or suggestions as a natural conversational response.
- Include any relevant actionable items or next steps the user can take.

This prompt empowers Olive's AI to be a practical, personalized helper that enriches each note with valuable support while enhancing the shared experience for couples.`;

serve(async (req) => {
  console.log('[Ask Olive] Request received:', req.method);

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { noteContent, userMessage, noteCategory } = await req.json();
    console.log('[Ask Olive] Processing request with note:', noteContent);

    const geminiApiKey = Deno.env.get('GEMINI_API');
    if (!geminiApiKey) {
      throw new Error('GEMINI_API environment variable not found');
    }

    const contextualPrompt = `${SYSTEM_PROMPT}

Current Note Details:
- Category: ${noteCategory || 'General'}
- Content: ${noteContent}

User's Question: ${userMessage}

Please provide helpful, contextual assistance based on this specific note and the user's question.`;

    console.log('[Ask Olive] Calling Gemini API...');
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: contextualPrompt
          }]
        }],
        generationConfig: {
          temperature: 0.8,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Ask Olive] Gemini API error:', response.status, errorText);
      throw new Error(`Gemini API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    console.log('[Ask Olive] Gemini response received');

    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      throw new Error('Invalid response format from Gemini API');
    }

    const assistantReply = data.candidates[0].content.parts[0].text;

    return new Response(JSON.stringify({ 
      reply: assistantReply,
      success: true 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Ask Olive] Error:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      reply: "I'm sorry, I'm having trouble processing your request right now. Please try again in a moment."
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
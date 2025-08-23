import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const INDIVIDUAL_SYSTEM_PROMPT = `You are Olive Assistant, powered by Gemini. Your job is to assist the user in resolving or advancing a specific note or list item in the Olive app, using conversational intelligence and context awareness. Track and remember all prior exchanges in this session to ensure natural, flowing support.

Guidelines for Gemini:

Keep Track of Conversation History
Continuously use previous user messages and assistant replies to inform your current response, maintaining conversational coherence and building on prior information.

Contextual, Proactive, and Helpful
Start each reply by referencing the user's latest question and the note's context. Offer useful information, suggestions, or a next step, responding to both explicit and implicit needs.

Informative and Natural Tone
Provide short, friendly, and insightful responses that feel genuinely conversational—not scripted or transactional. For opinion-based or evaluative questions, briefly explain key points, options, or relevant comparisons.

Action-Oriented Support
Propose or assist with the next logical action (e.g., adding items to lists, offering insights, summarizing pros/cons), only when it fits naturally in the flow—never force actions.

Clarify Smoothly When Needed
If essential details are missing, ask for clarification in a direct, conversational manner that fits the ongoing dialogue.

Safety and Scope Guardrails
Remain focused on supporting the user's current note/task. Decline inappropriate, unsafe, or off-topic requests with a gentle, clear explanation.

Output Structure for Gemini:

First sentence: Respond contextually to the most recent message referencing session history.

Next: Concisely offer helpful information or insights.

Final sentence: Suggest a next step, offer assistance, or ask for more details if needed—always staying on topic.`;

serve(async (req) => {
  console.log('[Ask Olive Individual] Request received:', req.method);

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { noteContent, userMessage, noteCategory, noteTitle } = await req.json();
    console.log('[Ask Olive Individual] Processing request for note:', noteTitle);

    const geminiApiKey = Deno.env.get('GEMINI_API');
    if (!geminiApiKey) {
      throw new Error('GEMINI_API environment variable not found');
    }

    const contextualPrompt = `${INDIVIDUAL_SYSTEM_PROMPT}

Current Note Details:
- Title: ${noteTitle || 'Untitled'}
- Category: ${noteCategory || 'General'}
- Content: ${noteContent}

User's Question: ${userMessage}

Please provide focused, actionable assistance for this specific note and question.`;

    console.log('[Ask Olive Individual] Calling Gemini API...');
    
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
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 512,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Ask Olive Individual] Gemini API error:', response.status, errorText);
      throw new Error(`Gemini API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    console.log('[Ask Olive Individual] Gemini response received');

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
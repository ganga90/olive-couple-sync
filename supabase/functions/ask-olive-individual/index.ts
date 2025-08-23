import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const INDIVIDUAL_SYSTEM_PROMPT = `You are Olive Assistant, the smart AI helper within the Olive app. Your role is to provide concise, relevant, and helpful support for a user's specific note or task. You actively track and remember the conversation history, utilizing prior exchanges, user profile data, and the note's context to offer the most effective assistance.

Guidelines

Conversation Tracking:
Maintain and use conversation history, remembering the user's previous questions, clarifications, and your responses in this session. Ensure answers connect logically to prior messages for a natural, supportive flow.

Proactive and Contextual:
Begin with a concise, proactive suggestion or action based on the note's title, content, assigned category, and relevant user data. Guide users toward completing the task or next steps.

Brevity and Usefulness:
Keep replies short, direct, and practical (usually 1–2 sentences). Focus on information that genuinely moves the user forward.

Missing or Ambiguous Context:
If your understanding is limited or important information is missing, ask a brief, specific follow-up question for clarification before answering, while referencing relevant past exchanges for continuity.

Task Focus with Guardrails:
Stay strictly within the scope of the current note or task. Don't digress into unrelated topics or offer advice that isn't relevant to the user's current context or conversation flow.

Safety & Misuse Prevention:
Politely decline requests that are inappropriate, unsafe, or outside the scope of permissible support. Proactively clarify ambiguous requests to avoid misunderstandings.

Output Structure

Respond with a short, friendly, and proactive suggestion directly related to the note and conversation so far.

If additional context is needed, ask for it without unnecessary verbosity.

Always tie your answer into the ongoing conversation, aiming for a seamless, human-like dialogue experience.`;

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
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `System Prompt: Olive Assistant – "Ask Olive" Feature (Individual Note)

You are Olive Assistant, an AI built to help users within the Olive app as they manage individual notes or list items. Your objectives are to provide focused, concise, and helpful responses—always maintaining the context of the specific note, the user's data and past interactions, and the intent of the Olive Assistant feature. Strictly avoid straying from the specific task, enforce safety, and ensure clear communication.

Instructions:

Start Proactively:
Begin your reply with an action or suggestion directly tied to the title and content of the note, anticipating the user's underlying need or next step.

Context Awareness:
Use the note content, its title, assigned category, detected date, and user's profile and prior context.
If context is missing or unclear, ask a simple, direct question for clarification before proceeding.

Keep it Brief and Useful:
Make responses direct and actionable; do not be verbose. Aim for one or two sentences per reply unless a slightly longer answer is needed for clarity.

Stay on Task:
Only address the specific note or request the user selected.
Do not offer unrelated suggestions, opinions, or information not directly relevant to solving or progressing that particular note.

Safety and Guardrails:
Never provide guidance on unsafe, illegal, or harmful activities.
If a request is inappropriate, express that you cannot assist.
Politely clarify ambiguities to avoid misunderstanding.

Output Format:

Begin with a short, proactive suggestion or action (maximum two sentences).
If more information is needed, ask for it concisely.
At all times, keep the conversation safe, relevant, and focused on the current note.`;

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
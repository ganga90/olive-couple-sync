import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// System prompt for intent classification
const INTENT_CLASSIFIER_PROMPT = `You are an intent classifier for Olive, a personal organization assistant.

Analyze the user's message and classify it into ONE of these categories:

1. ORGANIZATION - User is providing tasks, to-dos, shopping items, or scheduling information that needs to be organized
   Examples: "buy salmon tonight", "remind me to call mom tomorrow", "add milk to grocery list"

2. CONSULTATION - User is asking about their existing data, tasks, or schedule
   Examples: "what's on my grocery list?", "what are my top 5 tasks?", "what's due today?"

3. CONVERSATION - General chat, thanks, or unrelated comments
   Examples: "thanks!", "you're awesome", "how are you?"

Respond ONLY with valid JSON in this format:
{
  "intent": "ORGANIZATION" | "CONSULTATION" | "CONVERSATION",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

// Helper to standardize phone numbers
function standardizePhoneNumber(rawNumber: string): string {
  // Remove "whatsapp:" prefix if present
  let cleaned = rawNumber.replace(/^whatsapp:/, '');
  // Remove all non-digit characters except +
  cleaned = cleaned.replace(/[^\d+]/g, '');
  return cleaned;
}

// Helper to call Gemini API
async function callGemini(systemPrompt: string, userMessage: string, temperature = 0.2): Promise<any> {
  const GEMINI_API_KEY = Deno.env.get('GEMINI_API');
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API key not configured');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: `${systemPrompt}\n\nUser message: ${userMessage}` }]
        }],
        generationConfig: {
          temperature,
          maxOutputTokens: 2048,
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Gemini API error:', errorText);
    throw new Error(`Gemini API failed: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Generate TwiML response
function generateTwiML(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${message}</Message>
</Response>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('WhatsApp webhook received');

    // Parse form data from Twilio
    const formData = await req.formData();
    const fromNumber = formData.get('From')?.toString() || '';
    const messageBody = formData.get('Body')?.toString() || '';

    console.log('From:', fromNumber, 'Message:', messageBody);

    if (!fromNumber || !messageBody) {
      return new Response(generateTwiML('Invalid request format'), {
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
      });
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // PHASE 1: Authentication - Match phone number to user
    const standardizedPhone = standardizePhoneNumber(fromNumber);
    console.log('Standardized phone:', standardizedPhone);

    const { data: profile, error: profileError } = await supabase
      .from('clerk_profiles')
      .select('id, display_name')
      .eq('phone_number', standardizedPhone)
      .single();

    if (profileError || !profile) {
      console.log('User not found for phone:', standardizedPhone);
      return new Response(
        generateTwiML(
          "Welcome to Olive! 🫒 I couldn't find your account. Please sign in to the Olive app and link your WhatsApp number in Profile Settings."
        ),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    const userId = profile.id;
    const userName = profile.display_name || 'there';
    console.log('Authenticated user:', userId, userName);

    // Get user's couple_id if they're part of a couple
    const { data: membership } = await supabase
      .from('clerk_couple_members')
      .select('couple_id')
      .eq('user_id', userId)
      .single();

    const coupleId = membership?.couple_id || null;

    // PHASE 2: Intent Classification
    console.log('Classifying intent...');
    const intentResponse = await callGemini(INTENT_CLASSIFIER_PROMPT, messageBody, 0.1);
    
    let intent;
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = intentResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        intent = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (e) {
      console.error('Failed to parse intent:', e, intentResponse);
      intent = { intent: 'CONVERSATION', confidence: 0.5 };
    }

    console.log('Intent classified:', intent);

    // PHASE 3: Route based on intent
    let responseMessage = '';

    if (intent.intent === 'ORGANIZATION') {
      // Path A: Process and organize the brain dump
      console.log('Processing organization request...');

      try {
        // Call the existing process-note function
        const { data: processedNote, error: processError } = await supabase.functions.invoke(
          'process-note',
          {
            body: {
              text: messageBody,
              user_id: userId,
              couple_id: coupleId,
            }
          }
        );

        if (processError) throw processError;

        console.log('Note processed:', processedNote);

        // Generate confirmation message
        if (processedNote.notes && Array.isArray(processedNote.notes)) {
          const taskCount = processedNote.notes.length;
          const categories = processedNote.notes.map((n: any) => n.category).filter((v: any, i: number, a: any[]) => a.indexOf(v) === i);
          responseMessage = `✅ Got it! I've organized ${taskCount} item${taskCount > 1 ? 's' : ''} into: ${categories.join(', ')}. Check your Olive app!`;
        } else {
          responseMessage = `✅ Task organized and added to "${processedNote.category}"! Check your Olive app.`;
        }
      } catch (error) {
        console.error('Error processing note:', error);
        responseMessage = "I'm having trouble organizing that right now. Please try again in a moment.";
      }

    } else if (intent.intent === 'CONSULTATION') {
      // Path B: Query and retrieve user data
      console.log('Processing consultation request...');

      try {
        // Fetch relevant user data
        const { data: notes, error: notesError } = await supabase
          .from('clerk_notes')
          .select('*')
          .or(`and(author_id.eq.${userId},couple_id.is.null),and(couple_id.eq.${coupleId},couple_id.not.is.null)`)
          .order('created_at', { ascending: false })
          .limit(50);

        if (notesError) throw notesError;

        // Prepare context for AI
        const notesContext = notes.map((note: any) => ({
          summary: note.summary,
          category: note.category,
          dueDate: note.due_date,
          completed: note.completed,
          priority: note.priority,
          items: note.items,
        }));

        // Ask AI to answer the query based on the data
        const consultationPrompt = `You are Olive, a personal organization assistant. The user has asked: "${messageBody}"

Here is their current data:
${JSON.stringify(notesContext, null, 2)}

Provide a helpful, concise answer to their question based on this data. Keep it conversational and friendly. If they're asking about tasks, prioritize by due date and priority. Format your response for WhatsApp (plain text, use emojis sparingly).`;

        responseMessage = await callGemini(consultationPrompt, '', 0.7);
        
        // Clean up any markdown formatting
        responseMessage = responseMessage.replace(/```[\s\S]*?```/g, '').trim();
        
      } catch (error) {
        console.error('Error in consultation:', error);
        responseMessage = "I'm having trouble accessing your data right now. Please try again in a moment.";
      }

    } else {
      // Path C: General conversation
      console.log('Processing conversation...');

      const conversationPrompt = `You are Olive, a friendly personal organization assistant. The user said: "${messageBody}"

Respond in a warm, helpful way. Keep it brief (1-2 sentences). If they're thanking you, acknowledge it. If they're chatting, engage briefly and remind them you're here to help organize their tasks and answer questions about their lists.`;

      try {
        responseMessage = await callGemini(conversationPrompt, '', 0.8);
        responseMessage = responseMessage.replace(/```[\s\S]*?```/g, '').trim();
      } catch (error) {
        console.error('Error in conversation:', error);
        responseMessage = "You're welcome! Let me know if you have any tasks or questions about your lists! 🫒";
      }
    }

    console.log('Sending response:', responseMessage);

    return new Response(generateTwiML(responseMessage), {
      headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
    });

  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    return new Response(
      generateTwiML("Sorry, I encountered an error. Please try again later."),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
      }
    );
  }
});

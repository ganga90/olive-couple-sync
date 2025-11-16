import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const INTENT_CLASSIFIER_PROMPT = `You are an intent classifier for a task management app. Analyze the user's message and classify it into ONE of these categories:

ORGANIZATION: User wants to create a task, add a todo, organize something, or set a reminder
CONSULTATION: User wants to retrieve information, check their tasks, or ask about existing data
CONVERSATION: Casual chat, greetings, or off-topic messages

Respond ONLY with valid JSON in this format:
{
  "intent": "ORGANIZATION" | "CONSULTATION" | "CONVERSATION",
  "confidence": 0.0-1.0
}`;

// Standardize phone number format
function standardizePhoneNumber(rawNumber: string): string {
  let cleaned = rawNumber.replace(/^whatsapp:/, '').replace(/\D/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

// Call Gemini API
async function callGemini(systemPrompt: string, userMessage: string, temperature = 0.7): Promise<any> {
  const GEMINI_API_KEY = Deno.env.get('GEMINI_API');
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API key not configured');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt + '\n\nUser message: ' + userMessage }] }],
        generationConfig: { temperature, maxOutputTokens: 1000 }
      })
    }
  );

  if (!response.ok) {
    console.error('Gemini API error:', await response.text());
    throw new Error('Gemini API call failed');
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No response from Gemini');
  return text;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse Twilio webhook body
    const formData = await req.formData();
    const fromNumber = standardizePhoneNumber(formData.get('From') as string);
    const messageBody = (formData.get('Body') as string)?.trim();
    
    console.log('Incoming WhatsApp message:', { fromNumber, messageBody });

    if (!messageBody) {
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Please send a message.</Message></Response>',
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // Check for linking token (supports both formats: "My Olive Token is LINK_XXX" or just "LINK_XXX")
    const tokenMatch = messageBody.match(/(?:My Olive Token is )?(LINK_[A-Z0-9]+)/i);
    if (tokenMatch) {
      const token = tokenMatch[1].toUpperCase();
      console.log('Processing linking token:', token);
      
      const { data: tokenData, error: tokenError } = await supabase
        .from('linking_tokens')
        .select('user_id')
        .eq('token', token)
        .gt('expires_at', new Date().toISOString())
        .is('used_at', null)
        .single();

      if (tokenError || !tokenData) {
        console.error('Token lookup error:', tokenError);
        return new Response(
          '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Invalid or expired token. Please generate a new one from the Olive app.</Message></Response>',
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      // Update user profile with phone number
      const { error: updateError } = await supabase
        .from('clerk_profiles')
        .update({ phone_number: fromNumber })
        .eq('id', tokenData.user_id);

      if (updateError) {
        console.error('Error linking WhatsApp:', updateError);
        return new Response(
          '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Failed to link your account. Please try again.</Message></Response>',
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      // Mark token as used
      await supabase
        .from('linking_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('token', token);

      console.log('WhatsApp account linked successfully for user:', tokenData.user_id);

      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Message>✅ Your Olive account is successfully linked! You can now send me your brain dumps and I\'ll organize them for you.</Message></Response>',
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // Authenticate user by WhatsApp number
    const { data: profile, error: profileError } = await supabase
      .from('clerk_profiles')
      .select('id, display_name')
      .eq('whatsapp_id', fromNumber)
      .single();

    if (profileError || !profile) {
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Message>👋 Hi! To use Olive via WhatsApp, please link your account first:\n\n1. Open the Olive app\n2. Go to Profile/Settings\n3. Tap "Link WhatsApp"\n4. Send the token here\n\nThen I can help organize your tasks!</Message></Response>',
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    const userId = profile.id;

    // Get or create session
    let { data: session } = await supabase
      .from('user_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (!session) {
      const { data: newSession, error: sessionError } = await supabase
        .from('user_sessions')
        .insert({ user_id: userId, conversation_state: 'IDLE' })
        .select()
        .single();

      if (sessionError) {
        console.error('Error creating session:', sessionError);
        return new Response(
          '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Sorry, there was an error. Please try again.</Message></Response>',
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }
      session = newSession;
    }

    // Handle AWAITING_DETAIL state
    if (session.conversation_state === 'AWAITING_DETAIL') {
      const contextData = session.context_data as any;
      
      await supabase
        .from('clerk_notes')
        .update({ summary: `${contextData.summary} - ${messageBody}`, updated_at: new Date().toISOString() })
        .eq('id', contextData.task_id);

      await supabase
        .from('user_sessions')
        .update({ conversation_state: 'IDLE', context_data: null, updated_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Message>✅ Got it! Task updated successfully.</Message></Response>',
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // IDLE state: Classify intent
    const intentResponse = await callGemini(INTENT_CLASSIFIER_PROMPT, messageBody, 0.3);
    let intent: any;
    
    try {
      const jsonMatch = intentResponse.match(/\{[\s\S]*\}/);
      intent = JSON.parse(jsonMatch ? jsonMatch[0] : intentResponse);
    } catch (e) {
      console.error('Failed to parse intent:', e);
      intent = { intent: 'CONVERSATION', confidence: 0.5 };
    }

    console.log('Classified intent:', intent);

    if (intent.intent === 'ORGANIZATION') {
      const { data: processData, error: processError } = await supabase.functions.invoke('process-note', {
        body: { text: messageBody, user_id: userId }
      });

      if (processError) {
        console.error('Error processing note:', processError);
        return new Response(
          '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Sorry, I had trouble processing that. Please try again.</Message></Response>',
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      const taskSummary = processData.summary || 'Task';
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>✅ Got it! I've added "${taskSummary}" to your tasks.</Message></Response>`,
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );

    } else if (intent.intent === 'CONSULTATION') {
      const { data: tasks } = await supabase
        .from('clerk_notes')
        .select('summary, due_date, completed, priority, category')
        .eq('author_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);

      const tasksContext = tasks?.length 
        ? `User's recent tasks:\n${tasks.map(t => `- ${t.summary} (${t.category}, ${t.completed ? 'Done' : 'Pending'})`).join('\n')}`
        : 'User has no tasks yet.';

      const consultPrompt = `You are Olive, a helpful task assistant. Based on the user's tasks, answer their question concisely (max 2-3 sentences).\n\n${tasksContext}\n\nUser question: ${messageBody}`;
      const answer = await callGemini(consultPrompt, '', 0.7);
      
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${answer}</Message></Response>`,
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );

    } else {
      const chatPrompt = `You are Olive, a friendly task assistant. Respond to the user's message warmly and briefly (1-2 sentences). Encourage them to share tasks or ask questions.`;
      const reply = await callGemini(chatPrompt, messageBody, 0.8);

      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply}</Message></Response>`,
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Sorry, something went wrong. Please try again later.</Message></Response>',
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
    );
  }
});

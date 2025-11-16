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
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
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

// Helper to create TwiML response with media
function createTwimlResponse(messageText: string, mediaUrl?: string): string {
  if (mediaUrl) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Message><Body>${messageText}</Body><Media>${mediaUrl}</Media></Message></Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${messageText}</Message></Response>`;
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
    
    // Extract location data if shared
    const latitude = formData.get('Latitude') as string | null;
    const longitude = formData.get('Longitude') as string | null;
    
    // Extract media information
    const numMedia = parseInt(formData.get('NumMedia') as string || '0');
    const mediaUrls: string[] = [];
    const mediaTypes: string[] = [];
    
    for (let i = 0; i < numMedia; i++) {
      const mediaUrl = formData.get(`MediaUrl${i}`) as string;
      const mediaType = formData.get(`MediaContentType${i}`) as string;
      if (mediaUrl) {
        mediaUrls.push(mediaUrl);
        mediaTypes.push(mediaType || 'unknown');
      }
    }
    
    console.log('Incoming WhatsApp message:', { 
      fromNumber, 
      messageBody, 
      location: latitude && longitude ? { latitude, longitude } : null,
      media: mediaUrls.length > 0 ? { count: mediaUrls.length, types: mediaTypes } : null
    });

    // Handle location sharing
    if (latitude && longitude && !messageBody && mediaUrls.length === 0) {
      return new Response(
        createTwimlResponse(`📍 Thanks for sharing your location! (${latitude}, ${longitude})\n\nYou can add a task with this location by sending a message like:\n"Buy groceries at this location"`),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // Handle media messages
    if (mediaUrls.length > 0 && !messageBody) {
      const mediaTypeDesc = mediaTypes.includes('image') ? '🖼️ image' : 
                           mediaTypes.includes('audio') ? '🎵 audio' : 
                           mediaTypes.includes('video') ? '🎥 video' : '📄 file';
      return new Response(
        createTwimlResponse(`Received your ${mediaTypeDesc}! You can add a caption to create a task, or just send text to organize it.`),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    if (!messageBody && mediaUrls.length === 0) {
      return new Response(
        createTwimlResponse('Please send a message, share your location 📍, or attach media 📎'),
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

      const successImage = 'https://images.unsplash.com/photo-1606326608606-aa0b62935f2b?w=400&q=80'; // Checkmark/success image
      return new Response(
        createTwimlResponse(
          '✅ Your Olive account is successfully linked!\n\nYou can now:\n• Send brain dumps to organize\n• Share locations 📍 with tasks\n• Ask about your tasks\n• Send images 📸 or voice notes 🎤',
          successImage
        ),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // Authenticate user by WhatsApp number
    const { data: profile, error: profileError } = await supabase
      .from('clerk_profiles')
      .select('id, display_name')
      .eq('phone_number', fromNumber)
      .single();

    if (profileError || !profile) {
      console.error('Profile lookup error:', profileError);
      return new Response(
        createTwimlResponse(
          '👋 Hi! To use Olive via WhatsApp, please link your account first:\n\n' +
          '1️⃣ Open the Olive app\n' +
          '2️⃣ Go to Profile/Settings\n' +
          '3️⃣ Tap "Link WhatsApp"\n' +
          '4️⃣ Send the token here\n\n' +
          'Then I can help organize your tasks, locations, and more!'
        ),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    console.log('Authenticated user:', profile.id, profile.display_name);
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
      // Get user's couple_id for shared notes
      const { data: coupleMember } = await supabase
        .from('clerk_couple_members')
        .select('couple_id')
        .eq('user_id', userId)
        .limit(1)
        .single();

      const coupleId = coupleMember?.couple_id || null;

      // Prepare note data with location and media if available
      const notePayload: any = { 
        text: messageBody, 
        user_id: userId,
        couple_id: coupleId
      };
      
      // Add location context if provided
      if (latitude && longitude) {
        notePayload.location = { latitude, longitude };
        notePayload.text = `${messageBody} (Location: ${latitude}, ${longitude})`;
      }
      
      // Add media URLs if provided
      if (mediaUrls.length > 0) {
        notePayload.media = mediaUrls;
        notePayload.text = `${messageBody} [Media: ${mediaUrls.length} file(s)]`;
      }

      const { data: processData, error: processError } = await supabase.functions.invoke('process-note', {
        body: notePayload
      });

      if (processError) {
        console.error('Error processing note:', processError);
        return new Response(
          createTwimlResponse('Sorry, I had trouble processing that. Please try again.'),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      // Insert the processed note(s) into the database
      try {
        if (processData.multiple && Array.isArray(processData.notes)) {
          // Insert multiple notes
          const notesToInsert = processData.notes.map((note: any) => ({
            author_id: userId,
            couple_id: coupleId,
            original_text: messageBody,
            summary: note.summary,
            category: note.category || 'task',
            due_date: note.due_date,
            priority: note.priority || 'medium',
            tags: note.tags || [],
            items: note.items || [],
            task_owner: note.task_owner,
            list_id: note.list_id,
            location: latitude && longitude ? { latitude, longitude } : null,
            media_urls: mediaUrls.length > 0 ? mediaUrls : null,
            completed: false
          }));

          const { error: insertError } = await supabase
            .from('clerk_notes')
            .insert(notesToInsert);

          if (insertError) {
            console.error('Error inserting multiple notes:', insertError);
            throw insertError;
          }

          const count = notesToInsert.length;
          return new Response(
            createTwimlResponse(
              `✅ Saved ${count} tasks! Check your Olive app to see them.\n\n💡 Try: "Show my tasks" or "What's urgent?"`
            ),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        } else {
          // Insert single note
          const { error: insertError } = await supabase
            .from('clerk_notes')
            .insert([{
              author_id: userId,
              couple_id: coupleId,
              original_text: messageBody,
              summary: processData.summary,
              category: processData.category || 'task',
              due_date: processData.due_date,
              priority: processData.priority || 'medium',
              tags: processData.tags || [],
              items: processData.items || [],
              task_owner: processData.task_owner,
              list_id: processData.list_id,
              location: latitude && longitude ? { latitude, longitude } : null,
              media_urls: mediaUrls.length > 0 ? mediaUrls : null,
              completed: false
            }]);

          if (insertError) {
            console.error('Error inserting note:', insertError);
            throw insertError;
          }

          const taskSummary = processData.summary || 'your task';
          const taskCategory = processData.category ? ` in ${processData.category}` : '';
          const locationNote = latitude && longitude ? ' 📍' : '';
          const mediaNote = mediaUrls.length > 0 ? ` 📎(${mediaUrls.length})` : '';
          
          // Quick reply options
          const quickReply = '\n\n💡 Try:\n• "Make it urgent"\n• "Show my tasks"\n• Send more tasks!';
          
          return new Response(
            createTwimlResponse(
              `✅ Saved! "${taskSummary}"${taskCategory}${locationNote}${mediaNote}${quickReply}`
            ),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }
      } catch (insertError) {
        console.error('Database insertion error:', insertError);
        return new Response(
          createTwimlResponse('I understood your task but had trouble saving it. Please try again.'),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

    } else if (intent.intent === 'CONSULTATION') {
      // Fetch user's tasks and couple info
      const { data: tasks } = await supabase
        .from('clerk_notes')
        .select('summary, due_date, completed, priority, category, list_id, task_owner')
        .eq('author_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);

      const { data: lists } = await supabase
        .from('clerk_lists')
        .select('id, name')
        .eq('author_id', userId);

      const { data: coupleMembers } = await supabase
        .from('clerk_couple_members')
        .select('couple_id')
        .eq('user_id', userId)
        .limit(1)
        .single();

      let tasksContext = 'User has no tasks yet.';
      if (tasks?.length) {
        const urgentTasks = tasks.filter(t => t.priority === 'high' && !t.completed);
        const recentTasks = tasks.slice(0, 5);
        const listMap = new Map(lists?.map(l => [l.id, l.name]) || []);
        
        tasksContext = `
User's tasks:
- Total tasks: ${tasks.length}
- Urgent (high priority): ${urgentTasks.length}
- Completed: ${tasks.filter(t => t.completed).length}

Recent tasks:
${recentTasks.map(t => {
  const listName = t.list_id ? listMap.get(t.list_id) : 'General';
  return `- ${t.summary} [${t.category}${listName ? ', ' + listName : ''}] ${t.completed ? '✓' : t.priority === 'high' ? '⚡' : ''}`;
}).join('\n')}
`.trim();
      }

      const consultPrompt = `You are Olive, a helpful task management assistant. Answer the user's question about their tasks concisely and naturally (2-3 sentences max). If they ask about urgent tasks, focus on high priority items. If they ask about lists, mention the list names.

${tasksContext}

User question: ${messageBody}`;
      
      const answer = await callGemini(consultPrompt, '', 0.7);
      
      // Add quick action suggestions
      const quickActions = '\n\n💡 Try:\n• "What\'s urgent?"\n• "Show recent tasks"\n• Send 📍 location for location-based tasks';
      
      return new Response(
        createTwimlResponse(`${answer}${quickActions}`),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );

    } else {
      // CONVERSATION - casual chat or ambiguous intent
      const chatPrompt = `You are Olive, a friendly task management assistant. The user sent: "${messageBody}"

If this seems like it might be a task or reminder (even if unclear), respond warmly and ask for clarification like "Would you like me to save this as a task?" or "Should I add this to your list?"

Otherwise, respond warmly and briefly (1-2 sentences), and gently remind them you can help organize tasks or answer questions about their to-do list.`;
      
      const reply = await callGemini(chatPrompt, messageBody, 0.8);
      
      const helpHint = '\n\n💬 You can also:\n• Share 📍 location\n• Send 📸 images\n• Voice note 🎤';

      return new Response(
        createTwimlResponse(`${reply}${helpHint}`),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    return new Response(
      createTwimlResponse('Sorry, something went wrong. Please try again later. 🔄'),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
    );
  }
});

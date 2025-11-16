import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const INTENT_CLASSIFIER_PROMPT = `You are an intent classifier for a task management app. Analyze the user's message and classify it into ONE of these categories:

ORGANIZATION: User wants to CREATE A NEW task, add a new todo, or organize something new
MODIFICATION: User wants to EDIT/UPDATE/CHANGE/DELETE an EXISTING task (e.g., "make it urgent", "mark as done", "delete last task", "change priority")
CONSULTATION: User wants to retrieve information, check their tasks, see what's in a list, or ask about existing data
CONVERSATION: Casual chat, greetings, or off-topic messages

IMPORTANT: Commands like "make it urgent", "mark as done", "complete it", "delete it", "change to high priority" are MODIFICATION, not ORGANIZATION.

Respond ONLY with valid JSON in this format:
{
  "intent": "ORGANIZATION" | "MODIFICATION" | "CONSULTATION" | "CONVERSATION",
  "confidence": 0.0-1.0
}`;

// Standardize phone number format
function standardizePhoneNumber(rawNumber: string): string {
  let cleaned = rawNumber.replace(/^whatsapp:/, '').replace(/\D/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

// Call Lovable AI
async function callAI(systemPrompt: string, userMessage: string, temperature = 0.7): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature,
      max_tokens: 1000
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Lovable AI error:', response.status, errorText);
    throw new Error(`AI call failed: ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('No response from AI');
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
    const intentResponse = await callAI(INTENT_CLASSIFIER_PROMPT, messageBody, 0.3);
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
            reminder_time: note.reminder_time,
            recurrence_frequency: note.recurrence_frequency,
            recurrence_interval: note.recurrence_interval,
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
              reminder_time: processData.reminder_time,
              recurrence_frequency: processData.recurrence_frequency,
              recurrence_interval: processData.recurrence_interval,
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

    } else if (intent.intent === 'MODIFICATION') {
      // Handle modification of existing tasks
      const { data: recentTask } = await supabase
        .from('clerk_notes')
        .select('id, summary, priority, completed')
        .eq('author_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!recentTask) {
        return new Response(
          createTwimlResponse('You don\'t have any tasks yet. Create one first by sending a brain dump!'),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      // Analyze the modification request
      const modPrompt = `The user wants to modify their most recent task: "${recentTask.summary}"

Current status:
- Priority: ${recentTask.priority || 'medium'}
- Completed: ${recentTask.completed ? 'Yes' : 'No'}

User request: "${messageBody}"

Determine what modification they want and respond ONLY with valid JSON:
{
  "action": "update_priority" | "mark_complete" | "mark_incomplete" | "delete" | "unknown",
  "priority": "low" | "medium" | "high" (only if action is update_priority),
  "response": "A brief confirmation message"
}`;

      const modResponse = await callAI(modPrompt, '', 0.3);
      let modification: any;
      
      try {
        const jsonMatch = modResponse.match(/\{[\s\S]*\}/);
        modification = JSON.parse(jsonMatch ? jsonMatch[0] : modResponse);
      } catch (e) {
        console.error('Failed to parse modification:', e);
        return new Response(
          createTwimlResponse('I\'m not sure what you want to change. Try "make it urgent" or "mark as done"'),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      // Execute the modification
      if (modification.action === 'update_priority' && modification.priority) {
        await supabase
          .from('clerk_notes')
          .update({ priority: modification.priority, updated_at: new Date().toISOString() })
          .eq('id', recentTask.id);
        
        return new Response(
          createTwimlResponse(`✅ Updated "${recentTask.summary}" to ${modification.priority} priority!`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      } else if (modification.action === 'mark_complete') {
        await supabase
          .from('clerk_notes')
          .update({ completed: true, updated_at: new Date().toISOString() })
          .eq('id', recentTask.id);
        
        return new Response(
          createTwimlResponse(`✅ Marked "${recentTask.summary}" as complete! 🎉`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      } else if (modification.action === 'mark_incomplete') {
        await supabase
          .from('clerk_notes')
          .update({ completed: false, updated_at: new Date().toISOString() })
          .eq('id', recentTask.id);
        
        return new Response(
          createTwimlResponse(`✅ Reopened "${recentTask.summary}"`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      } else if (modification.action === 'delete') {
        await supabase
          .from('clerk_notes')
          .delete()
          .eq('id', recentTask.id);
        
        return new Response(
          createTwimlResponse(`🗑️ Deleted "${recentTask.summary}"`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      } else {
        return new Response(
          createTwimlResponse('I\'m not sure what you want to change. Try "make it urgent" or "mark as done"'),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

    } else if (intent.intent === 'CONSULTATION') {
      // Fetch user's tasks and lists
      const { data: tasks } = await supabase
        .from('clerk_notes')
        .select('id, summary, due_date, completed, priority, category, list_id, items, task_owner')
        .eq('author_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      const { data: lists } = await supabase
        .from('clerk_lists')
        .select('id, name, description')
        .eq('author_id', userId);

      const listMap = new Map(lists?.map(l => [l.id, l.name.toLowerCase()]) || []);
      const listIdToName = new Map(lists?.map(l => [l.id, l.name]) || []);

      // Check if asking about a specific list
      const listNameMatch = messageBody.toLowerCase().match(/(?:what'?s in|show me|list)\s+(?:my\s+)?(\w+(?:\s+\w+)?)\s+(?:list|tasks?)/i);
      let specificList: string | null = null;
      
      if (listNameMatch) {
        const requestedList = listNameMatch[1].toLowerCase();
        for (const [listId, listName] of listMap) {
          if (listName.includes(requestedList) || requestedList.includes(listName)) {
            specificList = listId;
            break;
          }
        }
      }

      let tasksContext = 'User has no tasks yet.';
      if (tasks?.length) {
        let relevantTasks = tasks;
        
        // Filter by specific list if requested
        if (specificList) {
          relevantTasks = tasks.filter(t => t.list_id === specificList && !t.completed);
          
          if (relevantTasks.length === 0) {
            return new Response(
              createTwimlResponse(`Your ${listIdToName.get(specificList)} list is empty! 🎉`),
              { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
            );
          }
          
          // Return the actual list items
          const listName = listIdToName.get(specificList);
          const itemsList = relevantTasks.map((t, i) => {
            const items = t.items && t.items.length > 0 ? `\n  ${t.items.join('\n  ')}` : '';
            return `${i + 1}. ${t.summary}${items}`;
          }).join('\n\n');
          
          return new Response(
            createTwimlResponse(`📋 ${listName}:\n\n${itemsList}\n\n💡 Say "mark as done" to complete the last item`),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }
        
        const urgentTasks = tasks.filter(t => t.priority === 'high' && !t.completed);
        const activeTasks = tasks.filter(t => !t.completed);
        
        tasksContext = `
User's tasks:
- Total tasks: ${tasks.length}
- Active (not completed): ${activeTasks.length}
- Urgent (high priority): ${urgentTasks.length}
- Completed: ${tasks.filter(t => t.completed).length}

Recent active tasks:
${activeTasks.slice(0, 10).map(t => {
  const listName = t.list_id ? listIdToName.get(t.list_id) : 'General';
  const itemsInfo = t.items && t.items.length > 0 ? ` (${t.items.length} items)` : '';
  return `- ${t.summary}${itemsInfo} [${listName}] ${t.priority === 'high' ? '⚡ URGENT' : ''}`;
}).join('\n')}

Available lists: ${lists?.map(l => l.name).join(', ') || 'None'}
`.trim();
      }

      const consultPrompt = `You are Olive, a helpful task management assistant. Answer the user's question about their tasks naturally and concisely.

${tasksContext}

User question: ${messageBody}

Provide a helpful answer based on the user's tasks.`;
      
      const answer = await callAI(consultPrompt, '', 0.7);
      
      return new Response(
        createTwimlResponse(answer),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );

    } else {
      // CONVERSATION - casual chat or ambiguous intent
      const chatPrompt = `You are Olive, a friendly task management assistant. The user sent: "${messageBody}"

If this seems like it might be a task or reminder (even if unclear), respond warmly and ask for clarification like "Would you like me to save this as a task?" or "Should I add this to your list?"

Otherwise, respond warmly and briefly (1-2 sentences), and gently remind them you can help organize tasks or answer questions about their to-do list.`;
      
      const reply = await callAI(chatPrompt, messageBody, 0.8);
      
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

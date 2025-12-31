import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const INTENT_CLASSIFIER_PROMPT = `You are an intent classifier for a task management app. Analyze the user's message and classify it into ONE of these categories:

ORGANIZATION: User wants to CREATE A NEW task, add a new todo, organize something new, or is sharing information they want saved (especially with media/images)
MODIFICATION: User wants to EDIT/UPDATE/CHANGE/DELETE/ASSIGN an EXISTING task (e.g., "make it urgent", "mark as done", "delete last task", "change priority", "assign it to X", "assign to my partner")
CONFIRMATION: User is responding YES/NO to a previous question (e.g., "yes", "no", "yeah", "nope", "confirm", "cancel", "ok", "sure")
CONSULTATION: User wants to retrieve information, check their tasks, see what's in a list, or ask about existing data
CONVERSATION: Casual chat, greetings, or off-topic messages

CRITICAL RULES:
- If the message includes media (image/audio/video) with descriptive text, it's almost always ORGANIZATION
- Commands like "check out X", "look at X", "see X" WITH media are ORGANIZATION (user wants to save it)
- Only use CONSULTATION when asking about existing tasks without adding new content
- Commands like "make it urgent", "mark as done", "complete it", "delete it", "assign it to X", "assign to partner" are MODIFICATION, not ORGANIZATION
- Simple responses like "yes", "no", "yeah", "sure", "ok", "nope", "cancel", "confirm" should be CONFIRMATION

Respond ONLY with valid JSON in this format:
{
  "intent": "ORGANIZATION" | "MODIFICATION" | "CONFIRMATION" | "CONSULTATION" | "CONVERSATION",
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

// Helper to download and upload media to Supabase Storage
async function downloadAndUploadMedia(
  twilioMediaUrl: string,
  mediaType: string,
  supabase: any
): Promise<string | null> {
  try {
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
    
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      console.error('Twilio credentials not configured');
      return null;
    }

    // Download media from Twilio with authentication
    const authHeader = `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`;
    const mediaResponse = await fetch(twilioMediaUrl, {
      headers: { 'Authorization': authHeader }
    });

    if (!mediaResponse.ok) {
      console.error('Failed to download media from Twilio:', mediaResponse.status);
      return null;
    }

    const mediaBlob = await mediaResponse.blob();
    const arrayBuffer = await mediaBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Generate unique filename with proper extension
    const ext = mediaType.split('/')[1] || 'bin';
    const timestamp = new Date().getTime();
    const randomStr = Math.random().toString(36).substring(7);
    const filename = `${timestamp}_${randomStr}.${ext}`;
    const filePath = `${filename}`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('whatsapp-media')
      .upload(filePath, uint8Array, {
        contentType: mediaType,
        upsert: false
      });

    if (error) {
      console.error('Failed to upload media to Supabase:', error);
      return null;
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('whatsapp-media')
      .getPublicUrl(filePath);

    console.log('Successfully uploaded media:', publicUrl);
    return publicUrl;
  } catch (error) {
    console.error('Error downloading/uploading media:', error);
    return null;
  }
}

// Constants for input validation
const MAX_MESSAGE_LENGTH = 10000;
const MAX_MEDIA_COUNT = 10;
const TWILIO_MEDIA_DOMAIN = 'api.twilio.com';

// Validate Twilio media URL
function isValidTwilioMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith(TWILIO_MEDIA_DOMAIN) || parsed.hostname.includes('twilio');
  } catch {
    return false;
  }
}

// Validate coordinates
function isValidCoordinates(lat: string | null, lon: string | null): boolean {
  if (!lat || !lon) return true; // null is valid (no location)
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lon);
  return !isNaN(latitude) && !isNaN(longitude) && 
         latitude >= -90 && latitude <= 90 && 
         longitude >= -180 && longitude <= 180;
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
    const rawMessageBody = formData.get('Body') as string;
    
    // INPUT VALIDATION: Message length
    if (rawMessageBody && rawMessageBody.length > MAX_MESSAGE_LENGTH) {
      console.warn('[Validation] Message too long:', rawMessageBody.length, 'chars');
      return new Response(
        createTwimlResponse('Your message is too long. Please keep messages under 10,000 characters.'),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }
    
    const messageBody = rawMessageBody?.trim();
    
    // Extract location data if shared
    const latitude = formData.get('Latitude') as string | null;
    const longitude = formData.get('Longitude') as string | null;
    
    // INPUT VALIDATION: Coordinates
    if (!isValidCoordinates(latitude, longitude)) {
      console.warn('[Validation] Invalid coordinates:', { latitude, longitude });
      return new Response(
        createTwimlResponse('Invalid location data received. Please try sharing your location again.'),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }
    
    // Extract media information and download/upload to Supabase Storage
    const numMedia = parseInt(formData.get('NumMedia') as string || '0');
    
    // INPUT VALIDATION: Media count
    if (numMedia > MAX_MEDIA_COUNT) {
      console.warn('[Validation] Too many media attachments:', numMedia);
      return new Response(
        createTwimlResponse(`Too many attachments (${numMedia}). Please send up to ${MAX_MEDIA_COUNT} files at a time.`),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }
    
    const hadIncomingMedia = numMedia > 0; // Track if Twilio reported media
    const mediaUrls: string[] = [];
    const mediaTypes: string[] = [];
    let mediaDownloadFailed = false;
    
    for (let i = 0; i < numMedia; i++) {
      const twilioMediaUrl = formData.get(`MediaUrl${i}`) as string;
      const mediaType = formData.get(`MediaContentType${i}`) as string;
      
      // INPUT VALIDATION: Verify Twilio domain
      if (twilioMediaUrl && !isValidTwilioMediaUrl(twilioMediaUrl)) {
        console.warn('[Validation] Invalid media URL domain:', twilioMediaUrl);
        continue; // Skip non-Twilio URLs
      }
      
      if (twilioMediaUrl) {
        // Download from Twilio and upload to Supabase Storage
        const supabaseUrl = await downloadAndUploadMedia(twilioMediaUrl, mediaType, supabase);
        if (supabaseUrl) {
          mediaUrls.push(supabaseUrl);
          mediaTypes.push(mediaType || 'unknown');
        } else {
          console.warn('Failed to process media, skipping:', twilioMediaUrl);
          mediaDownloadFailed = true;
        }
      }
    }
    
    console.log('Incoming WhatsApp message:', { 
      fromNumber, 
      messageBody: messageBody?.substring(0, 100), // Log truncated for privacy
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

    // Handle media-only messages - now process them with AI instead of asking for caption
    // This allows users to send images of products, receipts, etc. and have them automatically processed
    if (mediaUrls.length > 0 && !messageBody) {
      const mediaTypeDesc = mediaTypes.some(t => t.startsWith('image')) ? '🖼️ image' : 
                           mediaTypes.some(t => t.startsWith('audio')) ? '🎵 audio' : 
                           mediaTypes.some(t => t.startsWith('video')) ? '🎥 video' : '📄 file';
      console.log('[WhatsApp] Processing media-only message:', mediaTypeDesc);
      // Don't return early - let it fall through to ORGANIZATION intent for AI processing
    }

    if (!messageBody && mediaUrls.length === 0) {
      // Check if Twilio reported media but we failed to download it
      if (hadIncomingMedia && mediaDownloadFailed) {
        console.warn('[WhatsApp] User attached media but download failed');
        return new Response(
          createTwimlResponse(
            "I see you attached a photo or file, but I couldn't download it from WhatsApp. " +
            "Please try sending it again, or add a short caption describing what you want to save."
          ),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }
      
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

    // Authenticate user by WhatsApp number (handle multiple profiles with same number)
    const { data: profiles, error: profileError } = await supabase
      .from('clerk_profiles')
      .select('id, display_name, timezone')
      .eq('phone_number', fromNumber)
      .limit(1);

    const profile = profiles?.[0];

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

    // Handle AWAITING_CONFIRMATION state - user is responding to a confirmation prompt
    if (session.conversation_state === 'AWAITING_CONFIRMATION') {
      const contextData = session.context_data as any;
      const isAffirmative = /^(yes|yeah|yep|sure|ok|okay|confirm|si|sí|do it|go ahead|please|y)$/i.test(messageBody.trim());
      const isNegative = /^(no|nope|nah|cancel|nevermind|never mind|n)$/i.test(messageBody.trim());

      // Reset session state first
      await supabase
        .from('user_sessions')
        .update({ conversation_state: 'IDLE', context_data: null, updated_at: new Date().toISOString() })
        .eq('id', session.id);

      if (isNegative) {
        return new Response(
          createTwimlResponse('👍 No problem, I cancelled that action.'),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      if (!isAffirmative) {
        return new Response(
          createTwimlResponse('I didn\'t understand. Please reply "yes" to confirm or "no" to cancel.'),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      // Execute the pending action
      const pendingAction = contextData?.pending_action;
      
      if (pendingAction?.type === 'assign') {
        const { error: updateError } = await supabase
          .from('clerk_notes')
          .update({ 
            task_owner: pendingAction.target_user_id, 
            updated_at: new Date().toISOString() 
          })
          .eq('id', pendingAction.task_id);

        if (updateError) {
          console.error('Error assigning task:', updateError);
          return new Response(
            createTwimlResponse('Sorry, I couldn\'t assign that task. Please try again.'),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }

        return new Response(
          createTwimlResponse(`✅ Done! I assigned "${pendingAction.task_summary}" to ${pendingAction.target_name}. 🎯`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      } else if (pendingAction?.type === 'update_priority') {
        await supabase
          .from('clerk_notes')
          .update({ priority: pendingAction.priority, updated_at: new Date().toISOString() })
          .eq('id', pendingAction.task_id);

        return new Response(
          createTwimlResponse(`✅ Done! "${pendingAction.task_summary}" is now ${pendingAction.priority} priority.`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      } else if (pendingAction?.type === 'mark_complete') {
        await supabase
          .from('clerk_notes')
          .update({ completed: true, updated_at: new Date().toISOString() })
          .eq('id', pendingAction.task_id);

        return new Response(
          createTwimlResponse(`✅ Done! "${pendingAction.task_summary}" is marked complete. 🎉`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      } else if (pendingAction?.type === 'mark_incomplete') {
        await supabase
          .from('clerk_notes')
          .update({ completed: false, updated_at: new Date().toISOString() })
          .eq('id', pendingAction.task_id);

        return new Response(
          createTwimlResponse(`✅ Done! "${pendingAction.task_summary}" has been reopened.`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      } else if (pendingAction?.type === 'delete') {
        await supabase
          .from('clerk_notes')
          .delete()
          .eq('id', pendingAction.task_id);

        return new Response(
          createTwimlResponse(`🗑️ Done! "${pendingAction.task_summary}" has been deleted.`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      return new Response(
        createTwimlResponse('Something went wrong with the confirmation. Please try again.'),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // IDLE state: Check if message is a URL, or classify intent
    // Detect if message is primarily a URL/link
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const urls = messageBody.match(urlRegex);
    const isOnlyUrl = urls && urls.length > 0 && messageBody.replace(urlRegex, '').trim().length < 20;

    let intent: any;
    
    if (isOnlyUrl) {
      // Treat plain URLs as organization tasks automatically
      console.log('Detected URL, treating as organization task:', urls);
      intent = { intent: 'ORGANIZATION', confidence: 1.0 };
    } else if (mediaUrls.length > 0 && messageBody) {
      // If there's media with text description, treat as organization
      console.log('Detected media with text, treating as organization task');
      intent = { intent: 'ORGANIZATION', confidence: 1.0 };
    } else {
      // Classify intent using AI, with context about media
      const contextInfo = mediaUrls.length > 0 ? ` [User attached ${mediaUrls.length} media file(s)]` : '';
      const intentResponse = await callAI(INTENT_CLASSIFIER_PROMPT, messageBody + contextInfo, 0.3);
      
      try {
        const jsonMatch = intentResponse.match(/\{[\s\S]*\}/);
        intent = JSON.parse(jsonMatch ? jsonMatch[0] : intentResponse);
      } catch (e) {
        console.error('Failed to parse intent:', e);
        intent = { intent: 'CONVERSATION', confidence: 0.5 };
      }
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

      // Prepare note data with location, media, and timezone if available
      // process-note now handles multimodal processing (images via Gemini Vision, audio via ElevenLabs)
      // Use empty string for media-only messages so process-note knows to derive content from media
      const notePayload: any = { 
        text: messageBody || '', 
        user_id: userId,
        couple_id: coupleId,
        timezone: profile.timezone || 'America/New_York' // Default to EST if not set
      };
      
      // Add location context if provided (append to text for context)
      if (latitude && longitude) {
        notePayload.location = { latitude, longitude };
        if (notePayload.text) {
          notePayload.text = `${notePayload.text} (Location: ${latitude}, ${longitude})`;
        }
      }
      
      // Add media URLs for multimodal AI processing
      // process-note will analyze images with Gemini Vision and transcribe audio with ElevenLabs
      if (mediaUrls.length > 0) {
        notePayload.media = mediaUrls;
        console.log('[WhatsApp] Sending', mediaUrls.length, 'media file(s) for AI processing (text:', messageBody ? 'present' : 'empty', ')');
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
              `✅ Saved ${count} tasks!\n\n📱 Manage on: https://witholive.app\n\n💡 Try: "Show my tasks" or "What's urgent?"`
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
          const taskCategory = processData.category ? ` in ${processData.category.replace(/_/g, ' ')}` : '';
          const locationNote = latitude && longitude ? ' 📍' : '';
          
          // Build media note with processing indication
          let mediaNote = '';
          if (mediaUrls.length > 0) {
            const hasImage = mediaTypes.some(t => t.startsWith('image'));
            const hasAudio = mediaTypes.some(t => t.startsWith('audio'));
            if (hasImage && hasAudio) {
              mediaNote = ' 🖼️🎤';
            } else if (hasImage) {
              mediaNote = ' 🖼️';
            } else if (hasAudio) {
              mediaNote = ' 🎤';
            } else {
              mediaNote = ' 📎';
            }
          }
          
          // Check if the original message was primarily a URL
          const isUrlTask = urls && urls.length > 0;
          const hasMediaOnly = mediaUrls.length > 0 && (!messageBody || messageBody.trim() === '');
          
          let confirmationMessage: string;
          if (hasMediaOnly) {
            confirmationMessage = `✅ Processed your media${mediaNote} and saved as "${taskSummary}"${taskCategory}`;
          } else if (isUrlTask) {
            confirmationMessage = `✅ I saved the link as "${taskSummary}"${taskCategory}${locationNote}${mediaNote}`;
          } else {
            confirmationMessage = `✅ Saved! "${taskSummary}"${taskCategory}${locationNote}${mediaNote}`;
          }
          
          // Quick reply options with website link
          const quickReply = '\n\n📱 Manage on: https://witholive.app\n\n💡 Try:\n• "Make it urgent"\n• "Show my tasks"\n• Send more tasks!';
          
          return new Response(
            createTwimlResponse(
              `${confirmationMessage}${quickReply}`
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
      // Get user's couple info for partner assignment
      const { data: coupleMember } = await supabase
        .from('clerk_couple_members')
        .select('couple_id')
        .eq('user_id', userId)
        .limit(1)
        .single();

      const coupleId = coupleMember?.couple_id || null;

      // Get partner info if in a couple
      let partnerInfo: { id: string; name: string } | null = null;
      if (coupleId) {
        const { data: partnerMember } = await supabase
          .from('clerk_couple_members')
          .select('user_id')
          .eq('couple_id', coupleId)
          .neq('user_id', userId)
          .limit(1)
          .single();

        if (partnerMember) {
          const { data: partnerProfile } = await supabase
            .from('clerk_profiles')
            .select('id, display_name')
            .eq('id', partnerMember.user_id)
            .single();

          if (partnerProfile) {
            partnerInfo = { id: partnerProfile.id, name: partnerProfile.display_name || 'your partner' };
          }
        }
      }

      // Get couple names from the couple record for matching
      let coupleNames: { you_name: string | null; partner_name: string | null } | null = null;
      if (coupleId) {
        const { data: coupleData } = await supabase
          .from('clerk_couples')
          .select('you_name, partner_name')
          .eq('id', coupleId)
          .single();
        coupleNames = coupleData;
      }

      // Get the most recent task - prioritize shared tasks (with couple_id) for modifications
      let recentTask: any = null;
      
      if (coupleId) {
        // First try to get most recent shared task
        const { data: sharedTask } = await supabase
          .from('clerk_notes')
          .select('id, summary, priority, completed, task_owner, author_id, couple_id')
          .eq('couple_id', coupleId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        
        recentTask = sharedTask;
      }

      if (!recentTask) {
        // Fall back to user's personal tasks
        const { data: personalTask } = await supabase
          .from('clerk_notes')
          .select('id, summary, priority, completed, task_owner, author_id, couple_id')
          .eq('author_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        
        recentTask = personalTask;
      }

      if (!recentTask) {
        return new Response(
          createTwimlResponse('You don\'t have any tasks yet. Create one first by sending a brain dump!'),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      // Analyze the modification request with enhanced prompt for assignment
      const partnerContext = partnerInfo 
        ? `Partner info: ${partnerInfo.name} (can be assigned tasks)` 
        : 'User is not in a couple (cannot assign to partner)';
      
      const coupleNamesContext = coupleNames 
        ? `Couple nicknames: User is "${coupleNames.you_name || 'unknown'}", partner is "${coupleNames.partner_name || 'unknown'}"`
        : '';

      const modPrompt = `The user wants to modify their most recent task: "${recentTask.summary}"

Current status:
- Priority: ${recentTask.priority || 'medium'}
- Completed: ${recentTask.completed ? 'Yes' : 'No'}
- Currently assigned to: ${recentTask.task_owner === userId ? 'User' : recentTask.task_owner === partnerInfo?.id ? partnerInfo.name : 'Nobody'}
- Is shared task: ${recentTask.couple_id ? 'Yes' : 'No (personal task)'}

${partnerContext}
${coupleNamesContext}

User request: "${messageBody}"

Determine what modification they want and respond ONLY with valid JSON:
{
  "action": "update_priority" | "mark_complete" | "mark_incomplete" | "delete" | "assign_to_partner" | "assign_to_self" | "unknown",
  "priority": "low" | "medium" | "high" (only if action is update_priority),
  "target_name": "extracted name the user mentioned for assignment, if any",
  "response": "A brief confirmation message"
}

IMPORTANT: 
- If user says "assign to X" or "give it to X" where X matches the partner name/nickname, use "assign_to_partner"
- If user says "assign to me" or "I'll do it", use "assign_to_self"
- Only use assign actions if the task is a shared task (has couple_id)`;

      const modResponse = await callAI(modPrompt, messageBody, 0.3);
      let modification: any;
      
      try {
        const jsonMatch = modResponse.match(/\{[\s\S]*\}/);
        modification = JSON.parse(jsonMatch ? jsonMatch[0] : modResponse);
      } catch (e) {
        console.error('Failed to parse modification:', e);
        return new Response(
          createTwimlResponse('I\'m not sure what you want to change. Try "make it urgent", "mark as done", or "assign to [name]"'),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      console.log('Parsed modification:', modification);

      // Handle assignment with confirmation
      if (modification.action === 'assign_to_partner') {
        if (!partnerInfo) {
          return new Response(
            createTwimlResponse('You need to be in a couple to assign tasks to a partner. Invite your partner first! 💑'),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }

        if (!recentTask.couple_id) {
          return new Response(
            createTwimlResponse('This task is private. Only shared tasks can be assigned to your partner. Create a shared task first!'),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }

        // Set pending action and ask for confirmation
        await supabase
          .from('user_sessions')
          .update({ 
            conversation_state: 'AWAITING_CONFIRMATION', 
            context_data: {
              pending_action: {
                type: 'assign',
                task_id: recentTask.id,
                task_summary: recentTask.summary,
                target_user_id: partnerInfo.id,
                target_name: partnerInfo.name
              }
            },
            updated_at: new Date().toISOString() 
          })
          .eq('id', session.id);

        return new Response(
          createTwimlResponse(`🤔 You want me to assign "${recentTask.summary}" to ${partnerInfo.name}?\n\nReply "yes" to confirm or "no" to cancel.`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      if (modification.action === 'assign_to_self') {
        if (!recentTask.couple_id) {
          return new Response(
            createTwimlResponse('This is already your personal task!'),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }

        // Set pending action and ask for confirmation
        await supabase
          .from('user_sessions')
          .update({ 
            conversation_state: 'AWAITING_CONFIRMATION', 
            context_data: {
              pending_action: {
                type: 'assign',
                task_id: recentTask.id,
                task_summary: recentTask.summary,
                target_user_id: userId,
                target_name: 'yourself'
              }
            },
            updated_at: new Date().toISOString() 
          })
          .eq('id', session.id);

        return new Response(
          createTwimlResponse(`🤔 You want to assign "${recentTask.summary}" to yourself?\n\nReply "yes" to confirm or "no" to cancel.`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      // Execute other modifications with confirmation for destructive actions
      if (modification.action === 'update_priority' && modification.priority) {
        // Priority changes can be immediate (non-destructive)
        await supabase
          .from('clerk_notes')
          .update({ priority: modification.priority, updated_at: new Date().toISOString() })
          .eq('id', recentTask.id);
        
        return new Response(
          createTwimlResponse(`✅ Updated "${recentTask.summary}" to ${modification.priority} priority!`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      } else if (modification.action === 'mark_complete') {
        // Completing can be immediate
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
        // Delete needs confirmation
        await supabase
          .from('user_sessions')
          .update({ 
            conversation_state: 'AWAITING_CONFIRMATION', 
            context_data: {
              pending_action: {
                type: 'delete',
                task_id: recentTask.id,
                task_summary: recentTask.summary
              }
            },
            updated_at: new Date().toISOString() 
          })
          .eq('id', session.id);

        return new Response(
          createTwimlResponse(`⚠️ Are you sure you want to delete "${recentTask.summary}"?\n\nReply "yes" to confirm or "no" to cancel.`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      } else {
        return new Response(
          createTwimlResponse('I\'m not sure what you want to change. Try:\n• "make it urgent"\n• "mark as done"\n• "assign to [name]"\n• "delete it"'),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

    } else if (intent.intent === 'CONFIRMATION') {
      // User sent a confirmation-like message but we're not waiting for one
      return new Response(
        createTwimlResponse('I\'m not waiting for a confirmation. What would you like to do? Send me a task or ask me something!'),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );

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

If you can't find what they're looking for, suggest they might want to CREATE it as a new task instead of searching for it. Be helpful and brief.`;
      
      const answer = await callAI(consultPrompt, '', 0.7);
      
      // Add helpful tips if the answer seems like the user's query wasn't found
      const helpfulTips = '\n\n💡 Quick tips:\n• Send tasks: "Buy groceries"\n• With images: Send photo + caption\n• Check tasks: "What\'s urgent?"\n• Update: "Mark as done"\n\n📱 Full app: witholive.app';
      
      return new Response(
        createTwimlResponse(`${answer}${helpfulTips}`),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );

    } else {
      // CONVERSATION - casual chat or ambiguous intent
      const chatPrompt = `You are Olive, a friendly task management assistant. The user sent: "${messageBody}"

If this seems like it might be a task or reminder (even if unclear), respond warmly and ask for clarification like "Would you like me to save this as a task?" or "Should I add this to your list?"

Otherwise, respond warmly and briefly (1-2 sentences), and gently remind them you can help organize tasks or answer questions about their to-do list.`;
      
      const reply = await callAI(chatPrompt, messageBody, 0.8);
      
      const helpHint = '\n\n💬 How to use Olive:\n• Create tasks: "Buy groceries tomorrow"\n• With media: Send 📸 photo + caption\n• Check tasks: "What\'s urgent?"\n• Update: "Mark as done"\n\n📱 Full features: witholive.app';

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

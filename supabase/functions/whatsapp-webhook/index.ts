import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// DETERMINISTIC ROUTING - "Strict Gatekeeper"
// ============================================================================
// SEARCH: starts with Show, Find, List, Search, Get, ?, or contains "my tasks/list/reminders"
// MERGE: message is exactly "merge" (case-insensitive)  
// CREATE: Everything else (default)
// ============================================================================

type IntentResult = { intent: 'SEARCH' | 'MERGE' | 'CREATE'; isUrgent?: boolean; cleanMessage?: string };

function determineIntent(message: string, hasMedia: boolean): IntentResult {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();
  
  // ============================================================================
  // QUICK-SEARCH SYNTAX - Power user shortcuts
  // ? message -> Forces SEARCH
  // ! message -> Forces URGENT CREATE
  // / message -> Forces CREATE (explicit)
  // ============================================================================
  
  // ? prefix -> Force SEARCH
  if (trimmed.startsWith('?')) {
    return { intent: 'SEARCH', cleanMessage: trimmed.slice(1).trim() };
  }
  
  // ! prefix -> Force URGENT CREATE
  if (trimmed.startsWith('!')) {
    return { intent: 'CREATE', isUrgent: true, cleanMessage: trimmed.slice(1).trim() };
  }
  
  // / prefix -> Force CREATE (explicit)
  if (trimmed.startsWith('/')) {
    return { intent: 'CREATE', cleanMessage: trimmed.slice(1).trim() };
  }
  
  // MERGE: exact match only
  if (lower === 'merge') {
    return { intent: 'MERGE' };
  }
  
  // SEARCH: specific patterns
  const searchStarters = ['show', 'find', 'list', 'search', 'get', 'what'];
  if (searchStarters.some(s => lower.startsWith(s))) {
    // "what's in my" or "what do i have" patterns
    if (lower.startsWith('what')) {
      if (/what'?s\s+(in|on|due|urgent|pending)/i.test(lower) || 
          /what\s+(do\s+i|tasks?|items?)/i.test(lower)) {
        return { intent: 'SEARCH' };
      }
    } else {
      return { intent: 'SEARCH' };
    }
  }
  
  // SEARCH: contains "my tasks", "my list", "my reminders" etc.
  if (/\bmy\s+(tasks?|list|lists?|reminders?|items?|to-?do)\b/i.test(lower)) {
    return { intent: 'SEARCH' };
  }
  
  // SEARCH: asking questions about existing content
  if (/^(how many|do i have|check my|see my)/i.test(lower)) {
    return { intent: 'SEARCH' };
  }
  
  // CREATE: default for everything else
  // This includes ambiguous verbs like "check", "review", "look at", etc.
  return { intent: 'CREATE' };
}

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

// Generate embedding for similarity search
async function generateEmbedding(text: string): Promise<number[] | null> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    console.error('LOVABLE_API_KEY not configured for embeddings');
    return null;
  }

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text
      })
    });

    if (!response.ok) {
      console.error('Embedding API error:', response.status);
      return null;
    }

    const data = await response.json();
    return data.data?.[0]?.embedding || null;
  } catch (error) {
    console.error('Error generating embedding:', error);
    return null;
  }
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

    const ext = mediaType.split('/')[1] || 'bin';
    const timestamp = new Date().getTime();
    const randomStr = Math.random().toString(36).substring(7);
    const filename = `${timestamp}_${randomStr}.${ext}`;
    const filePath = `${filename}`;

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

function isValidTwilioMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith(TWILIO_MEDIA_DOMAIN) || parsed.hostname.includes('twilio');
  } catch {
    return false;
  }
}

function isValidCoordinates(lat: string | null, lon: string | null): boolean {
  if (!lat || !lon) return true;
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lon);
  return !isNaN(latitude) && !isNaN(longitude) && 
         latitude >= -90 && latitude <= 90 && 
         longitude >= -180 && longitude <= 180;
}

// Parse natural language date/time expressions
function parseNaturalDate(expression: string, timezone: string = 'America/New_York'): { date: string | null; time: string | null; readable: string } {
  const now = new Date();
  const lowerExpr = expression.toLowerCase().trim();
  
  const formatDate = (d: Date): string => d.toISOString();
  
  const monthNames: Record<string, number> = {
    'january': 0, 'jan': 0, 'february': 1, 'feb': 1, 'march': 2, 'mar': 2,
    'april': 3, 'apr': 3, 'may': 4, 'june': 5, 'jun': 5, 'july': 6, 'jul': 6,
    'august': 7, 'aug': 7, 'september': 8, 'sep': 8, 'sept': 8,
    'october': 9, 'oct': 9, 'november': 10, 'nov': 10, 'december': 11, 'dec': 11
  };
  
  const getNextDayOfWeek = (dayName: string): Date => {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = days.indexOf(dayName.toLowerCase());
    if (targetDay === -1) return now;
    
    const result = new Date(now);
    const currentDay = result.getDay();
    let daysToAdd = targetDay - currentDay;
    if (daysToAdd <= 0) daysToAdd += 7;
    result.setDate(result.getDate() + daysToAdd);
    result.setHours(9, 0, 0, 0);
    return result;
  };
  
  let hours: number | null = null;
  let minutes: number = 0;
  
  const timeMatch = lowerExpr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    const potentialHour = parseInt(timeMatch[1]);
    const meridiem = timeMatch[3]?.toLowerCase();
    
    if (meridiem || potentialHour <= 12) {
      hours = potentialHour;
      minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;
    }
  }
  
  if (lowerExpr.includes('morning')) { hours = hours ?? 9; }
  else if (lowerExpr.includes('noon') || lowerExpr.includes('midday')) { hours = hours ?? 12; }
  else if (lowerExpr.includes('afternoon')) { hours = hours ?? 14; }
  else if (lowerExpr.includes('evening')) { hours = hours ?? 18; }
  else if (lowerExpr.includes('night')) { hours = hours ?? 20; }
  
  let targetDate: Date | null = null;
  let readable = '';
  
  if (lowerExpr.includes('today')) {
    targetDate = new Date(now);
    readable = 'today';
  } else if (lowerExpr.includes('tomorrow')) {
    targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + 1);
    readable = 'tomorrow';
  } else if (lowerExpr.includes('day after tomorrow')) {
    targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + 2);
    readable = 'day after tomorrow';
  } else if (lowerExpr.includes('next week')) {
    targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + 7);
    readable = 'next week';
  } else if (lowerExpr.includes('in a week') || lowerExpr.includes('in 1 week')) {
    targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + 7);
    readable = 'in a week';
  }
  
  const inMinutesMatch = lowerExpr.match(/in\s+(\d+)\s*(?:min(?:ute)?s?)/i);
  const inHoursMatch = lowerExpr.match(/in\s+(\d+)\s*(?:hour?s?|hr?s?)/i);
  const inDaysMatch = lowerExpr.match(/in\s+(\d+)\s*days?/i);
  
  if (inMinutesMatch) {
    targetDate = new Date(now);
    targetDate.setMinutes(targetDate.getMinutes() + parseInt(inMinutesMatch[1]));
    readable = `in ${inMinutesMatch[1]} minutes`;
  } else if (inHoursMatch) {
    targetDate = new Date(now);
    targetDate.setHours(targetDate.getHours() + parseInt(inHoursMatch[1]));
    readable = `in ${inHoursMatch[1]} hour(s)`;
  } else if (inDaysMatch) {
    targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + parseInt(inDaysMatch[1]));
    readable = `in ${inDaysMatch[1]} day(s)`;
  }
  
  if (!targetDate) {
    const monthFirstMatch = lowerExpr.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
    const dayFirstMatch = lowerExpr.match(/\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+of\s+|\s*-?\s*)(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i);
    
    let monthNum: number | undefined;
    let dayNum: number | undefined;
    
    if (monthFirstMatch) {
      monthNum = monthNames[monthFirstMatch[1].toLowerCase()];
      dayNum = parseInt(monthFirstMatch[2]);
    } else if (dayFirstMatch) {
      dayNum = parseInt(dayFirstMatch[1]);
      monthNum = monthNames[dayFirstMatch[2].toLowerCase()];
    }
    
    if (monthNum !== undefined && dayNum !== undefined && dayNum >= 1 && dayNum <= 31) {
      targetDate = new Date(now);
      targetDate.setMonth(monthNum, dayNum);
      
      if (targetDate < now) {
        targetDate.setFullYear(targetDate.getFullYear() + 1);
      }
      
      const monthDisplayNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                                  'July', 'August', 'September', 'October', 'November', 'December'];
      readable = `${monthDisplayNames[monthNum]} ${dayNum}`;
    }
  }
  
  if (!targetDate) {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (const day of dayNames) {
      if (lowerExpr.includes(day) || lowerExpr.includes(day.substring(0, 3))) {
        targetDate = getNextDayOfWeek(day);
        readable = `next ${day.charAt(0).toUpperCase() + day.slice(1)}`;
        break;
      }
    }
  }
  
  if (targetDate && hours !== null) {
    targetDate.setHours(hours, minutes, 0, 0);
    readable += ` at ${hours > 12 ? hours - 12 : hours === 0 ? 12 : hours}:${minutes.toString().padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
  } else if (targetDate && hours === null) {
    targetDate.setHours(9, 0, 0, 0);
    readable += ' at 9:00 AM';
  }
  
  if (!targetDate) {
    return { date: null, time: null, readable: 'unknown' };
  }
  
  return {
    date: formatDate(targetDate),
    time: formatDate(targetDate),
    readable
  };
}

// Search for a task by keywords in summary
async function searchTaskByKeywords(
  supabase: any, 
  userId: string, 
  coupleId: string | null, 
  keywords: string[]
): Promise<any | null> {
  let query = supabase
    .from('clerk_notes')
    .select('id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time')
    .eq('completed', false)
    .order('created_at', { ascending: false })
    .limit(50);
  
  if (coupleId) {
    query = query.eq('couple_id', coupleId);
  } else {
    query = query.eq('author_id', userId);
  }
  
  const { data: tasks, error } = await query;
  
  if (error || !tasks || tasks.length === 0) {
    return null;
  }
  
  const scoredTasks = tasks.map((task: any) => {
    const summaryLower = task.summary.toLowerCase();
    let score = 0;
    
    for (const keyword of keywords) {
      const keywordLower = keyword.toLowerCase();
      if (keywordLower.length < 2) continue;
      
      if (summaryLower.includes(keywordLower)) {
        if (summaryLower.split(/\s+/).some((word: string) => word === keywordLower)) {
          score += 10;
        } else {
          score += 5;
        }
      }
    }
    
    return { ...task, score };
  });
  
  scoredTasks.sort((a: any, b: any) => b.score - a.score);
  
  if (scoredTasks[0]?.score > 0) {
    return scoredTasks[0];
  }
  
  return null;
}

// Find similar notes using embedding similarity
async function findSimilarNotes(
  supabase: any,
  userId: string,
  coupleId: string | null,
  embedding: number[],
  excludeId: string
): Promise<{ id: string; summary: string; similarity: number } | null> {
  try {
    // Use the database function for similarity search
    const { data, error } = await supabase.rpc('find_similar_notes', {
      p_user_id: userId,
      p_couple_id: coupleId,
      p_query_embedding: JSON.stringify(embedding),
      p_threshold: 0.85,
      p_limit: 5
    });

    if (error) {
      console.error('Error finding similar notes:', error);
      return null;
    }

    // Filter out the just-created note
    const matches = (data || []).filter((n: any) => n.id !== excludeId);
    
    if (matches.length > 0) {
      return {
        id: matches[0].id,
        summary: matches[0].summary,
        similarity: matches[0].similarity
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error in findSimilarNotes:', error);
    return null;
  }
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
    
    if (rawMessageBody && rawMessageBody.length > MAX_MESSAGE_LENGTH) {
      console.warn('[Validation] Message too long:', rawMessageBody.length, 'chars');
      return new Response(
        createTwimlResponse('Your message is too long. Please keep messages under 10,000 characters.'),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }
    
    const messageBody = rawMessageBody?.trim();
    
    const latitude = formData.get('Latitude') as string | null;
    const longitude = formData.get('Longitude') as string | null;
    
    if (!isValidCoordinates(latitude, longitude)) {
      console.warn('[Validation] Invalid coordinates:', { latitude, longitude });
      return new Response(
        createTwimlResponse('Invalid location data received. Please try sharing your location again.'),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }
    
    const numMedia = parseInt(formData.get('NumMedia') as string || '0');
    
    if (numMedia > MAX_MEDIA_COUNT) {
      console.warn('[Validation] Too many media attachments:', numMedia);
      return new Response(
        createTwimlResponse(`Too many attachments (${numMedia}). Please send up to ${MAX_MEDIA_COUNT} files at a time.`),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }
    
    const hadIncomingMedia = numMedia > 0;
    const mediaUrls: string[] = [];
    const mediaTypes: string[] = [];
    let mediaDownloadFailed = false;

    for (let i = 0; i < numMedia; i++) {
      const mediaUrl = formData.get(`MediaUrl${i}`) as string;
      const mediaType = formData.get(`MediaContentType${i}`) as string || 'application/octet-stream';
      
      if (mediaUrl) {
        if (!isValidTwilioMediaUrl(mediaUrl)) {
          console.warn('[Validation] Invalid media URL:', mediaUrl);
          mediaDownloadFailed = true;
          continue;
        }
        
        const publicUrl = await downloadAndUploadMedia(mediaUrl, mediaType, supabase);
        if (publicUrl) {
          mediaUrls.push(publicUrl);
          mediaTypes.push(mediaType);
        } else {
          mediaDownloadFailed = true;
        }
      }
    }

    console.log('Incoming WhatsApp message:', { 
      fromNumber, 
      messageBody: messageBody?.substring(0, 100),
      numMedia,
      uploadedMedia: mediaUrls.length
    });

    // Handle location sharing
    if (latitude && longitude && !messageBody && mediaUrls.length === 0) {
      return new Response(
        createTwimlResponse(`📍 Thanks for sharing your location! (${latitude}, ${longitude})\n\nYou can add a task with this location by sending a message like:\n"Buy groceries at this location"`),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // Handle media-only messages - process them
    if (mediaUrls.length > 0 && !messageBody) {
      console.log('[WhatsApp] Processing media-only message');
    }

    if (!messageBody && mediaUrls.length === 0) {
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

    // Check for linking token
    const tokenMatch = messageBody?.match(/(?:My Olive Token is )?(LINK_[A-Z0-9]+)/i);
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

      await supabase
        .from('linking_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('token', token);

      console.log('WhatsApp account linked successfully for user:', tokenData.user_id);

      const successImage = 'https://images.unsplash.com/photo-1606326608606-aa0b62935f2b?w=400&q=80';
      return new Response(
        createTwimlResponse(
          '✅ Your Olive account is successfully linked!\n\nYou can now:\n• Send brain dumps to organize\n• Share locations 📍 with tasks\n• Ask about your tasks\n• Send images 📸 or voice notes 🎤',
          successImage
        ),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // Authenticate user by WhatsApp number
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

    // Get user's couple_id for shared notes
    const { data: coupleMember } = await supabase
      .from('clerk_couple_members')
      .select('couple_id')
      .eq('user_id', userId)
      .limit(1)
      .single();

    const coupleId = coupleMember?.couple_id || null;

    // ========================================================================
    // HANDLE AWAITING_CONFIRMATION STATE
    // ========================================================================
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
      } else if (pendingAction?.type === 'set_due_date') {
        await supabase
          .from('clerk_notes')
          .update({ 
            due_date: pendingAction.date, 
            updated_at: new Date().toISOString() 
          })
          .eq('id', pendingAction.task_id);

        return new Response(
          createTwimlResponse(`✅ Done! "${pendingAction.task_summary}" is now due ${pendingAction.readable}. 📅`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      } else if (pendingAction?.type === 'set_reminder') {
        const updateData: any = { 
          reminder_time: pendingAction.time, 
          updated_at: new Date().toISOString() 
        };
        
        if (!pendingAction.has_due_date) {
          updateData.due_date = pendingAction.time;
        }
        
        await supabase
          .from('clerk_notes')
          .update(updateData)
          .eq('id', pendingAction.task_id);

        return new Response(
          createTwimlResponse(`✅ Done! I'll remind you about "${pendingAction.task_summary}" ${pendingAction.readable}. ⏰`),
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
      } else if (pendingAction?.type === 'merge') {
        // Execute merge using the database function
        const { data: mergeResult, error: mergeError } = await supabase.rpc('merge_notes', {
          p_source_id: pendingAction.source_id,
          p_target_id: pendingAction.target_id
        });

        if (mergeError) {
          console.error('Error merging notes:', mergeError);
          return new Response(
            createTwimlResponse('Sorry, I couldn\'t merge those notes. Please try again.'),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }

        return new Response(
          createTwimlResponse(`✅ Merged! Combined your note into: "${pendingAction.target_summary}"\n\n🔗 Manage: https://witholive.app`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      return new Response(
        createTwimlResponse('Something went wrong with the confirmation. Please try again.'),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // ========================================================================
    // DETERMINISTIC ROUTING - "Strict Gatekeeper"
    // ========================================================================
    const intentResult = determineIntent(messageBody || '', mediaUrls.length > 0);
    const { intent, isUrgent, cleanMessage } = intentResult;
    // Use cleanMessage if prefix was stripped, otherwise use original
    const effectiveMessage = cleanMessage ?? messageBody;
    console.log('Deterministic intent:', intent, 'isUrgent:', isUrgent, 'for message:', effectiveMessage?.substring(0, 50));

    // ========================================================================
    // MERGE COMMAND HANDLER
    // ========================================================================
    if (intent === 'MERGE') {
      // Find the most recently created note by this user (within last 5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      
      const { data: recentNotes, error: recentError } = await supabase
        .from('clerk_notes')
        .select('id, summary, embedding, created_at')
        .eq('author_id', userId)
        .eq('completed', false)
        .gte('created_at', fiveMinutesAgo)
        .order('created_at', { ascending: false })
        .limit(1);

      if (recentError || !recentNotes || recentNotes.length === 0) {
        return new Response(
          createTwimlResponse('I don\'t see any recent tasks to merge. The Merge command works within 5 minutes of creating a task.'),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      const sourceNote = recentNotes[0];

      // If we have an embedding, find similar notes
      let targetNote: { id: string; summary: string } | null = null;

      if (sourceNote.embedding) {
        const similar = await findSimilarNotes(supabase, userId, coupleId, sourceNote.embedding, sourceNote.id);
        if (similar) {
          targetNote = { id: similar.id, summary: similar.summary };
        }
      }

      // Fallback: generate embedding from summary if we don't have one stored
      if (!targetNote) {
        const embedding = await generateEmbedding(sourceNote.summary);
        if (embedding) {
          const similar = await findSimilarNotes(supabase, userId, coupleId, embedding, sourceNote.id);
          if (similar) {
            targetNote = { id: similar.id, summary: similar.summary };
          }
        }
      }

      if (!targetNote) {
        return new Response(
          createTwimlResponse(`I couldn't find a similar task to merge "${sourceNote.summary}" with. The task remains as-is.`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      // Ask for confirmation before merging
      await supabase
        .from('user_sessions')
        .update({ 
          conversation_state: 'AWAITING_CONFIRMATION', 
          context_data: {
            pending_action: {
              type: 'merge',
              source_id: sourceNote.id,
              source_summary: sourceNote.summary,
              target_id: targetNote.id,
              target_summary: targetNote.summary
            }
          },
          updated_at: new Date().toISOString() 
        })
        .eq('id', session.id);

      return new Response(
        createTwimlResponse(`🔀 Merge "${sourceNote.summary}" into "${targetNote.summary}"?\n\nReply "yes" to confirm or "no" to cancel.`),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // ========================================================================
    // SEARCH INTENT - Consultation
    // ========================================================================
    if (intent === 'SEARCH') {
      // Fetch user's tasks and lists
      const { data: tasks } = await supabase
        .from('clerk_notes')
        .select('id, summary, due_date, completed, priority, category, list_id, items, task_owner')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
        .order('created_at', { ascending: false })
        .limit(50);

      const { data: lists } = await supabase
        .from('clerk_lists')
        .select('id, name, description')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`);

      const listIdToName = new Map(lists?.map(l => [l.id, l.name]) || []);

      // Check if asking about a specific list
      const listNameMatch = effectiveMessage?.toLowerCase().match(/(?:what'?s in|show me|list)\s+(?:my\s+)?(\w+(?:\s+\w+)?)\s+(?:list|tasks?)/i);
      let specificList: string | null = null;
      
      if (listNameMatch) {
        const requestedList = listNameMatch[1].toLowerCase();
        for (const [listId, listName] of listIdToName) {
          if ((listName as string).toLowerCase().includes(requestedList) || requestedList.includes((listName as string).toLowerCase())) {
            specificList = listId;
            break;
          }
        }
      }

      if (specificList && tasks) {
        const relevantTasks = tasks.filter(t => t.list_id === specificList && !t.completed);
        
        if (relevantTasks.length === 0) {
          return new Response(
            createTwimlResponse(`Your ${listIdToName.get(specificList)} list is empty! 🎉`),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }
        
        const listName = listIdToName.get(specificList);
        const itemsList = relevantTasks.map((t, i) => {
          const items = t.items && t.items.length > 0 ? `\n  ${t.items.join('\n  ')}` : '';
          return `${i + 1}. ${t.summary}${items}`;
        }).join('\n\n');
        
        return new Response(
          createTwimlResponse(`📋 ${listName}:\n\n${itemsList}\n\n💡 Say "mark as done" to complete items`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      // General task summary
      if (!tasks || tasks.length === 0) {
        return new Response(
          createTwimlResponse('You don\'t have any tasks yet! Send me something to save like "Buy groceries tomorrow" 🛒'),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      const urgentTasks = tasks.filter(t => t.priority === 'high' && !t.completed);
      const activeTasks = tasks.filter(t => !t.completed);
      const dueTodayTasks = activeTasks.filter(t => {
        if (!t.due_date) return false;
        const dueDate = new Date(t.due_date);
        const today = new Date();
        return dueDate.toDateString() === today.toDateString();
      });

      let summary = `📊 Your Tasks:\n`;
      summary += `• Active: ${activeTasks.length}\n`;
      if (urgentTasks.length > 0) summary += `• Urgent: ${urgentTasks.length} 🔥\n`;
      if (dueTodayTasks.length > 0) summary += `• Due today: ${dueTodayTasks.length}\n`;

      if (urgentTasks.length > 0) {
        summary += `\n⚡ Urgent:\n`;
        summary += urgentTasks.slice(0, 3).map((t, i) => `${i + 1}. ${t.summary}`).join('\n');
      } else if (activeTasks.length > 0) {
        summary += `\n📝 Recent:\n`;
        summary += activeTasks.slice(0, 5).map((t, i) => `${i + 1}. ${t.summary}`).join('\n');
      }

      summary += '\n\n💡 Try: "Show my groceries list" or send a new task!';

      return new Response(
        createTwimlResponse(summary),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // ========================================================================
    // CREATE INTENT (Default) - Capture First
    // ========================================================================
    // Prepare note data - use effectiveMessage (stripped of prefix if any)
    const notePayload: any = { 
      text: effectiveMessage || '', 
      user_id: userId,
      couple_id: coupleId,
      timezone: profile.timezone || 'America/New_York',
      // Pass urgency flag from ! prefix
      force_priority: isUrgent ? 'high' : undefined
    };
    
    if (latitude && longitude) {
      notePayload.location = { latitude, longitude };
      if (notePayload.text) {
        notePayload.text = `${notePayload.text} (Location: ${latitude}, ${longitude})`;
      }
    }
    
    if (mediaUrls.length > 0) {
      notePayload.media = mediaUrls;
      console.log('[WhatsApp] Sending', mediaUrls.length, 'media file(s) for AI processing');
    }

    // Process the note with AI
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
      let insertedNoteId: string | null = null;
      let insertedNoteSummary: string = '';
      let insertedListId: string | null = null;
      
      // Random tips for unique notes
      const randomTips = [
        "Reply 'Make it urgent' to change priority",
        "Reply 'Show my tasks' to see your list",
        "You can send voice notes too! 🎤",
        "Reply 'Move to Work' to switch lists",
        "Use ! prefix for urgent tasks (e.g., !call mom)"
      ];
      const getRandomTip = () => randomTips[Math.floor(Math.random() * randomTips.length)];
      
      // Helper to get list name from list_id
      async function getListName(listId: string | null): Promise<string> {
        if (!listId) return 'Tasks';
        
        const { data: list } = await supabase
          .from('clerk_lists')
          .select('name')
          .eq('id', listId)
          .single();
        
        return list?.name || 'Tasks';
      }
      
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
          priority: isUrgent ? 'high' : (note.priority || 'medium'),
          tags: note.tags || [],
          items: note.items || [],
          task_owner: note.task_owner,
          list_id: note.list_id,
          location: latitude && longitude ? { latitude, longitude } : null,
          media_urls: mediaUrls.length > 0 ? mediaUrls : null,
          completed: false
        }));

        const { data: insertedNotes, error: insertError } = await supabase
          .from('clerk_notes')
          .insert(notesToInsert)
          .select('id, summary, list_id');

        if (insertError) throw insertError;

        // Get list name for the first item (they likely share the same list)
        const primaryListId = insertedNotes?.[0]?.list_id;
        const listName = await getListName(primaryListId);
        
        const count = processData.notes.length;
        const itemsList = insertedNotes?.slice(0, 3).map(n => `• ${n.summary}`).join('\n') || '';
        const moreText = count > 3 ? `\n...and ${count - 3} more` : '';
        
        return new Response(
          createTwimlResponse(`✅ Saved ${count} items!\n${itemsList}${moreText}\n\n📂 Added to: ${listName}\n\n🔗 Manage: https://witholive.app\n\n💡 ${getRandomTip()}`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      } else {
        // Single note
        const noteData = {
          author_id: userId,
          couple_id: coupleId,
          original_text: messageBody,
          summary: processData.summary,
          category: processData.category || 'task',
          due_date: processData.due_date,
          reminder_time: processData.reminder_time,
          recurrence_frequency: processData.recurrence_frequency,
          recurrence_interval: processData.recurrence_interval,
          priority: isUrgent ? 'high' : (processData.priority || 'medium'),
          tags: processData.tags || [],
          items: processData.items || [],
          task_owner: processData.task_owner,
          list_id: processData.list_id,
          location: latitude && longitude ? { latitude, longitude } : null,
          media_urls: mediaUrls.length > 0 ? mediaUrls : null,
          completed: false
        };

        const { data: insertedNote, error: insertError } = await supabase
          .from('clerk_notes')
          .insert(noteData)
          .select('id, summary, list_id')
          .single();

        if (insertError) throw insertError;

        insertedNoteId = insertedNote.id;
        insertedNoteSummary = insertedNote.summary;
        insertedListId = insertedNote.list_id;

        // Get the list name for rich feedback
        const listName = await getListName(insertedListId);

        // ================================================================
        // POST-INSERTION: Background Duplicate Detection
        // ================================================================
        let duplicateWarning: { found: boolean; targetId: string; targetTitle: string } | null = null;

        try {
          // Generate embedding for the new note
          const embedding = await generateEmbedding(insertedNoteSummary);
          
          if (embedding) {
            // Store the embedding for future similarity searches
            await supabase
              .from('clerk_notes')
              .update({ embedding: JSON.stringify(embedding) })
              .eq('id', insertedNoteId);

            // Search for similar existing notes
            const similarNote = await findSimilarNotes(supabase, userId, coupleId, embedding, insertedNoteId);
            
            if (similarNote) {
              duplicateWarning = {
                found: true,
                targetId: similarNote.id,
                targetTitle: similarNote.summary
              };
              console.log('[Duplicate Detection] Found similar note:', similarNote.summary, 'similarity:', similarNote.similarity);
            }
          }
        } catch (dupError) {
          console.error('Duplicate detection error (non-blocking):', dupError);
          // Non-blocking - continue with the response even if duplicate detection fails
        }

        // ================================================================
        // RICH RESPONSE BUILDER
        // ================================================================
        let confirmationMessage: string;
        
        if (duplicateWarning?.found) {
          // Scenario B: Duplicate detected - no tip to avoid clutter
          confirmationMessage = [
            `✅ Saved: ${insertedNoteSummary}`,
            `📂 Added to: ${listName}`,
            ``,
            `⚠️ Similar task found: "${duplicateWarning.targetTitle}"`,
            `Reply "Merge" to combine them.`
          ].join('\n');
        } else {
          // Scenario A: Unique note - include tip
          confirmationMessage = [
            `✅ Saved: ${insertedNoteSummary}`,
            `📂 Added to: ${listName}`,
            ``,
            `🔗 Manage: https://witholive.app`,
            ``,
            `💡 ${getRandomTip()}`
          ].join('\n');
        }
        
        return new Response(
          createTwimlResponse(confirmationMessage),
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

  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    return new Response(
      createTwimlResponse('Sorry, something went wrong. Please try again later. 🔄'),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
    );
  }
});

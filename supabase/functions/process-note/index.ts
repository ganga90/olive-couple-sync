import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai@1.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
};

// Define the JSON schema for structured output
const singleNoteSchema = {
  type: Type.OBJECT,
  properties: {
    summary: { 
      type: Type.STRING, 
      description: "Concise title (max 100 chars). Groceries: item name only. Actions: keep verb." 
    },
    category: { 
      type: Type.STRING, 
      description: "Category using lowercase with underscores: entertainment, date_ideas, home_improvement, travel, groceries, shopping, personal, task" 
    },
    due_date: { 
      type: Type.STRING, 
      nullable: true,
      description: "ISO 8601 format YYYY-MM-DDTHH:mm:ss.sssZ. Set when deadline mentioned." 
    },
    reminder_time: { 
      type: Type.STRING, 
      nullable: true,
      description: "ISO 8601 format. Set SAME as due_date when 'remind me' mentioned." 
    },
    priority: { 
      type: Type.STRING, 
      enum: ["high", "medium", "low"],
      description: "high for urgent/bills, medium for regular, low for ideas" 
    },
    tags: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      description: "Extract themes like urgent, financial, health" 
    },
    items: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      nullable: true,
      description: "Only for multi-part tasks like 'plan vacation: book flights, reserve hotel'. Never for grocery lists." 
    },
    task_owner: { 
      type: Type.STRING, 
      nullable: true,
      description: "Person's name from 'tell [name]' or '[name] should'" 
    },
    recurrence_frequency: { 
      type: Type.STRING, 
      nullable: true,
      enum: ["daily", "weekly", "monthly", "yearly"],
      description: "For recurring reminders" 
    },
    recurrence_interval: { 
      type: Type.NUMBER, 
      nullable: true,
      description: "Interval for recurrence, e.g., 2 for 'every 2 weeks'" 
    }
  },
  required: ["summary", "category", "priority", "tags"]
};

const multiNoteSchema = {
  type: Type.OBJECT,
  properties: {
    multiple: { type: Type.BOOLEAN },
    notes: {
      type: Type.ARRAY,
      items: singleNoteSchema
    }
  },
  required: ["multiple", "notes"]
};

// Schema for auto-extracting user memories from brain-dumps
const memoryExtractionSchema = {
  type: Type.OBJECT,
  properties: {
    memories: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "Short title for the memory (max 50 chars)" },
          content: { type: Type.STRING, description: "The factual content to remember" },
          category: { 
            type: Type.STRING, 
            enum: ["personal", "preference", "goal", "health", "other"],
            description: "Category of the memory"
          },
          importance: { 
            type: Type.NUMBER, 
            description: "Importance 1-5, where 5 is very important" 
          },
          confidence: { 
            type: Type.NUMBER, 
            description: "Confidence level 0-1 that this is a real fact about the user" 
          }
        },
        required: ["title", "content", "category", "importance", "confidence"]
      }
    }
  },
  required: ["memories"]
};

// Detect input style from text characteristics
function detectInputStyle(text: string): 'succinct' | 'conversational' {
  const wordCount = text.split(/\s+/).length;
  const hasGreetings = /^(hey|hi|hello|yo|so|ok|okay|well)/i.test(text.trim());
  const hasFillerWords = /(i think|maybe|probably|might|was thinking|need to|have to|gotta|gonna)/i.test(text);
  const hasConversationalMarkers = /(and also|by the way|oh and|btw|also|actually)/i.test(text);
  const sentenceCount = (text.match(/[.!?]+/g) || []).length;
  const hasComplexSentences = sentenceCount > 1 || wordCount > 20;
  
  // Score conversational indicators
  let conversationalScore = 0;
  if (hasGreetings) conversationalScore += 2;
  if (hasFillerWords) conversationalScore += 2;
  if (hasConversationalMarkers) conversationalScore += 1;
  if (hasComplexSentences) conversationalScore += 1;
  if (wordCount > 30) conversationalScore += 1;
  
  return conversationalScore >= 2 ? 'conversational' : 'succinct';
}

// Preprocess conversational text to extract key information (keeps token usage low)
function extractKeyInfoFromConversational(text: string): string {
  // Remove common filler phrases while preserving key information
  let cleaned = text
    .replace(/^(hey|hi|hello|yo|so|ok|okay|well)[,\s]*/i, '')
    .replace(/i (think|guess|suppose|believe)\s+/gi, '')
    .replace(/(maybe|probably|might)\s+/gi, '')
    .replace(/was (thinking|wondering)\s+(about\s+)?/gi, '')
    .replace(/need to|have to|gotta|gonna/gi, 'should')
    .replace(/\s+/g, ' ')
    .trim();
  
  return cleaned || text;
}

// Dynamic system prompt with media context, style awareness, and user memory
const createSystemPrompt = (
  userTimezone: string = 'UTC', 
  hasMedia: boolean = false, 
  mediaDescriptions: string[] = [],
  inputStyle: 'succinct' | 'conversational' = 'succinct',
  memoryContext: string = ''
) => {
  const now = new Date();
  const utcTime = now.toISOString();
  
  let mediaContext = '';
  if (hasMedia && mediaDescriptions.length > 0) {
    mediaContext = `

MEDIA CONTEXT - CRITICAL: The user has attached media with extracted content:
${mediaDescriptions.map((d, i) => `Media ${i + 1}: ${d}`).join('\n')}

MEDIA EXTRACTION RULES:
1. **Use media data as the PRIMARY source** - If the image contains specific data (codes, dates, names), use them in the summary and items.
2. **Promo codes/Coupons**: 
   - Summary: "[Brand] promo code: [CODE] - [DISCOUNT]"
   - Items: ["Code: [CODE]", "Discount: [DISCOUNT]", "Expires: [DATE]", "Conditions: [if any]"]
   - Set due_date to expiration date (if found) at 09:00
   - Category: "shopping"
   - Tags: ["promo", "discount", brand name if known]
3. **Appointments**: 
   - Summary: "[Type] appointment at [Place]"
   - Set due_date to appointment date and time
   - Set reminder_time to 24 hours before
   - Items: ["Location: [ADDRESS]", "Time: [TIME]", "Provider: [NAME]"]
   - Category: "personal"
   - Tags: ["appointment", type like "doctor", "dentist"]
4. **Events/Tickets**: 
   - Summary: "[Event name] at [Venue]"
   - Set due_date to event date and time
   - Items: ["Venue: [VENUE]", "Date: [DATE]", "Time: [TIME]", "Tickets: [info]"]
   - Category: "entertainment"
5. **Receipts**: Extract key items, store name, and date
6. **Generic context**: If user text is vague (like "save this" or "remember"), use the media content to create a meaningful summary`;
  }
  
  // Style-specific guidance
  const styleGuidance = inputStyle === 'conversational' 
    ? `
INPUT STYLE: CONVERSATIONAL
The user writes in a casual, chatty style. They may include:
- Greetings and filler words ("Hey, I was thinking...")
- Uncertainty language ("maybe", "might", "probably")
- Multiple ideas in one message
- Context and reasoning for tasks

YOUR JOB: Extract the ACTIONABLE items from the conversational text. Ignore pleasantries and focus on what needs to be done.
Example: "Hey, so I think we need to pick up kids on Tuesday and maybe book a table for Friday" → Extract: pickup kids Tuesday + book table Friday`
    : `
INPUT STYLE: SUCCINCT/BRAIN-DUMP
The user writes quick, efficient notes with minimal words. They use:
- Comma-separated lists
- Action keywords
- Minimal context

YOUR JOB: Parse each item directly as a task.
Example: "buy milk, call doctor tomorrow, book restaurant Friday" → 3 separate tasks`;
  
  // Build memory context section if available
  const memorySection = memoryContext 
    ? `\n\n${memoryContext}\n\n**CRITICAL: PERSONALIZE THE SUMMARY USING THIS CONTEXT**
You MUST use the user's memories to enrich and personalize the task summary. Examples:
- User says "buy dog food" + memory says "I have a dog named Milka who eats Royal Canine" → Summary: "Buy Royal Canine food for Milka"
- User says "bring Milka to the vet" + memory says "Milka is my dog" → Summary: "Bring Milka (dog) to the vet"
- User says "book dinner" + memory says "we have 2 kids" → Summary: "Book dinner for 4"
- User says "buy medicine" + memory says "My dog Milka takes Denamarin" → Summary: "Buy Denamarin for Milka"

The summary should include SPECIFIC details from memories (brand names, pet names, quantities, preferences).
Do NOT just use the raw input - ENHANCE it with known context.`
    : '';

  return `You're Olive, an AI assistant organizing tasks for couples. Process raw text into structured notes.

USER TIMEZONE: ${userTimezone}
Current UTC time: ${utcTime}
${styleGuidance}
${memorySection}

IMPORTANT: When calculating times, use the user's timezone (${userTimezone}), not UTC.
- "tomorrow at 10am" means 10am in ${userTimezone}, convert to UTC ISO format for storage
${mediaContext}

SPLIT CRITERIA: Create multiple notes when input contains lists of items or distinct tasks.
Examples: 
- "buy milk and call doctor" → 2 notes (different actions)
- "buy milk, eggs, bread" → 3 notes (separate items)
- "groceries: milk, eggs, bread" → 3 notes (separate items)
- "fix the sink" → 1 note (single task)

CRITICAL: For grocery lists or item lists, ALWAYS create separate notes for EACH item.

CORE FIELD RULES:
1. summary: Concise title (max 100 chars)
   - Groceries: item name only ("milk" not "buy milk")
   - Actions: keep verb ("fix sink")
   - For media with promo codes: "[Brand] promo code: [CODE] - [DISCOUNT]"
   - For appointments: "[Type] at [Place] - [Date/Time]"

2. category: Use lowercase with underscores
   - concerts/events/shows → "entertainment"
   - restaurants/dinner plans → "date_ideas"
   - repairs/fix/maintenance → "home_improvement"
   - vacation/flights/hotels → "travel"
   - groceries/supermarket → "groceries"
   - clothes/electronics/promo codes → "shopping"
   - appointments/bills/rent → "personal"

3. due_date/reminder_time: ISO format
   - "remind me" → set BOTH reminder_time AND due_date to same datetime
   - Time references: "tomorrow" (next day 09:00), "tonight" (same day 23:59)
   - Weekday references: next occurrence at 09:00
   - Promo expiration dates → set as due_date
   - Appointment dates → set as due_date AND reminder_time (24h before)
   - IMPORTANT: When setting reminder_time, ALWAYS also set due_date to match

4. priority: high (urgent/bills/expiring soon), medium (regular), low (ideas)

5. items: Use for structured data from media (promo details, appointment info). Include:
   - For promo codes: ["Code: XXX", "Discount: X%", "Expires: Date", "Store: Brand"]
   - For appointments: ["Location: Address", "Time: HH:MM", "Provider: Name"]
   - For events: ["Venue: Place", "Date: Date", "Time: Time"]
   - NEVER for grocery lists.

6. recurrence_frequency/recurrence_interval: For recurring reminders
   - "every day" → frequency: "daily", interval: 1
   - "every 2 weeks" → frequency: "weekly", interval: 2

Return multiple:true with notes array if multiple items detected.
Return multiple:false with single note fields if just one task.`;
};

// Transcribe audio using ElevenLabs Speech-to-Text
async function transcribeAudioWithElevenLabs(audioUrl: string): Promise<string> {
  const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
  
  if (!ELEVENLABS_API_KEY) {
    console.warn('[ElevenLabs] API key not configured, skipping transcription');
    return '';
  }

  try {
    console.log('[ElevenLabs] Downloading audio from:', audioUrl);
    
    // Download the audio file
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      console.error('[ElevenLabs] Failed to download audio:', audioResponse.status);
      return '';
    }
    
    const audioBlob = await audioResponse.blob();
    console.log('[ElevenLabs] Audio downloaded, size:', audioBlob.size, 'type:', audioBlob.type);
    
    // Prepare form data for ElevenLabs
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model_id', 'scribe_v1');
    formData.append('language_code', 'eng');
    
    console.log('[ElevenLabs] Sending to transcription API...');
    
    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: formData,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ElevenLabs] Transcription failed:', response.status, errorText);
      return '';
    }
    
    const result = await response.json();
    const transcription = result.text || '';
    console.log('[ElevenLabs] Transcription result:', transcription);
    
    return transcription;
  } catch (error) {
    console.error('[ElevenLabs] Error transcribing audio:', error);
    return '';
  }
}

// Convert ArrayBuffer to base64 without stack overflow
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

// Analyze image using Gemini Vision with enhanced extraction
async function analyzeImageWithGemini(genai: GoogleGenAI, imageUrl: string): Promise<string> {
  try {
    console.log('[Gemini Vision] Analyzing image:', imageUrl);
    
    // Download the image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      console.error('[Gemini Vision] Failed to download image:', imageResponse.status);
      return '';
    }
    
    const imageBlob = await imageResponse.blob();
    const arrayBuffer = await imageBlob.arrayBuffer();
    const base64Image = arrayBufferToBase64(arrayBuffer);
    const mimeType = imageBlob.type || 'image/jpeg';
    
    console.log('[Gemini Vision] Image downloaded, type:', mimeType, 'size:', imageBlob.size);
    
    // Enhanced prompt for structured data extraction
    const extractionPrompt = `Analyze this image and extract ALL useful information for task management. Be thorough and specific.

EXTRACT THE FOLLOWING (if present):
1. **Brand/Company/Service name**: Look for logos, headers, or business names
2. **Promo codes/Coupon codes**: Any alphanumeric codes for discounts
3. **Discounts/Offers**: Percentage off, dollar amounts, special deals (e.g., "15% OFF", "$20 off")
4. **Expiration dates**: When offers expire, appointment dates, due dates (format: Month Day, Year)
5. **Appointment details**: Doctor/dentist/service names, date, time, location, address
6. **Event information**: Event name, venue, date, time, ticket info
7. **Receipt details**: Store name, items purchased, amounts, date
8. **Contact information**: Phone numbers, emails, websites
9. **Key action items**: What the user should remember or do

FORMAT YOUR RESPONSE as a structured summary:
- If it's a PROMO/COUPON: "Promo code [CODE] for [BRAND]: [DISCOUNT]% off, expires [DATE]. [Any conditions]"
- If it's an APPOINTMENT: "Appointment at [PLACE] on [DATE] at [TIME]. Address: [ADDRESS]. [Other details]"
- If it's a RECEIPT: "Receipt from [STORE] on [DATE]: [KEY ITEMS]. Total: [AMOUNT]"
- If it's an EVENT: "Event: [NAME] at [VENUE] on [DATE] at [TIME]. [Ticket/pricing info]"
- Otherwise: Provide a clear, actionable summary with all extracted details.

Be concise but include ALL extracted data. Max 150 words.`;

    // Use Gemini with vision capability
    const response = await genai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: extractionPrompt
            },
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Image
              }
            }
          ]
        }
      ],
      config: {
        temperature: 0.1,
        maxOutputTokens: 300
      }
    });
    
    const description = response.text || '';
    console.log('[Gemini Vision] Image analysis result:', description);
    
    return description;
  } catch (error) {
    console.error('[Gemini Vision] Error analyzing image:', error);
    return '';
  }
}

// Determine media type from URL or content type
function getMediaType(url: string, contentType?: string): 'image' | 'audio' | 'video' | 'unknown' {
  const urlLower = url.toLowerCase();
  
  if (contentType) {
    if (contentType.startsWith('image/')) return 'image';
    if (contentType.startsWith('audio/')) return 'audio';
    if (contentType.startsWith('video/')) return 'video';
  }
  
  // Check URL extension
  if (/\.(jpg|jpeg|png|gif|webp|heic|heif)(\?|$)/i.test(urlLower)) return 'image';
  if (/\.(mp3|wav|ogg|webm|m4a|aac|opus)(\?|$)/i.test(urlLower)) return 'audio';
  if (/\.(mp4|mov|avi|mkv)(\?|$)/i.test(urlLower)) return 'video';
  
  return 'unknown';
}

// Auto-extract potential memories from brain-dump text
async function extractMemoriesFromDump(
  genai: GoogleGenAI, 
  supabase: any, 
  text: string, 
  userId: string
): Promise<void> {
  try {
    console.log('[Memory Extraction] Analyzing brain-dump for potential memories...');
    
    // Skip very short texts
    if (text.length < 20) {
      console.log('[Memory Extraction] Text too short, skipping');
      return;
    }
    
    const extractionPrompt = `Analyze this brain-dump text and extract ONLY personal facts about the user that should be remembered for future context.

Brain-dump text: "${text}"

EXTRACT ONLY:
- Personal information (names of pets, family members, partner)
- Preferences (food brands, restaurants, stores they like)
- Habits and routines
- Health information (allergies, medications, conditions)
- Goals and aspirations
- Important facts about their life (where they live, work, hobbies)

DO NOT EXTRACT:
- Tasks or to-dos
- One-time events
- Generic information
- Things that aren't facts about the user

For each memory, rate confidence 0-1 (only extract if >0.7 confident it's a real fact).
Return empty array if no personal facts found.`;

    const response = await genai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: extractionPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: memoryExtractionSchema,
        temperature: 0.1,
        maxOutputTokens: 500
      }
    });

    const responseText = response.text;
    const parsed = JSON.parse(responseText);
    
    if (!parsed.memories || parsed.memories.length === 0) {
      console.log('[Memory Extraction] No memories extracted');
      return;
    }
    
    // Filter only high-confidence memories
    const highConfidenceMemories = parsed.memories.filter(
      (m: any) => m.confidence >= 0.75
    );
    
    if (highConfidenceMemories.length === 0) {
      console.log('[Memory Extraction] No high-confidence memories found');
      return;
    }
    
    console.log('[Memory Extraction] Found', highConfidenceMemories.length, 'high-confidence memories');
    
    // Fetch existing memories to avoid duplicates
    const { data: existingMemories } = await supabase
      .from('user_memories')
      .select('title, content')
      .eq('user_id', userId)
      .eq('is_active', true);
    
    const existingContents = new Set(
      (existingMemories || []).map((m: any) => m.content.toLowerCase())
    );
    
    // Filter out duplicates
    const newMemories = highConfidenceMemories.filter(
      (m: any) => !existingContents.has(m.content.toLowerCase())
    );
    
    if (newMemories.length === 0) {
      console.log('[Memory Extraction] All memories already exist');
      return;
    }
    
    // Store new memories via manage-memories function
    for (const memory of newMemories) {
      try {
        await supabase.functions.invoke('manage-memories', {
          body: {
            action: 'add',
            user_id: userId,
            title: memory.title,
            content: memory.content,
            category: memory.category,
            importance: memory.importance,
            metadata: { auto_extracted: true, confidence: memory.confidence }
          }
        });
        console.log('[Memory Extraction] Stored memory:', memory.title);
      } catch (err) {
        console.warn('[Memory Extraction] Failed to store memory:', memory.title, err);
      }
    }
    
    console.log('[Memory Extraction] Successfully stored', newMemories.length, 'new memories');
  } catch (error) {
    console.error('[Memory Extraction] Error:', error);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API key is not configured');
    }
    
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase configuration is missing');
    }

    const { text, user_id, couple_id, timezone, media, style } = await req.json();
    
    if (!text || !user_id) {
      throw new Error('Missing required fields: text and user_id');
    }

    console.log('[process-note] Received style preference:', style || 'not specified');

    // Initialize clients
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // Process media if provided
    const mediaDescriptions: string[] = [];
    const mediaUrls: string[] = media || [];
    
    if (mediaUrls.length > 0) {
      console.log('[process-note] Processing', mediaUrls.length, 'media files');
      
      for (const mediaUrl of mediaUrls) {
        const mediaType = getMediaType(mediaUrl);
        console.log('[process-note] Media type:', mediaType, 'URL:', mediaUrl);
        
        if (mediaType === 'image') {
          const description = await analyzeImageWithGemini(genai, mediaUrl);
          if (description) {
            mediaDescriptions.push(`[Image] ${description}`);
          }
        } else if (mediaType === 'audio') {
          const transcription = await transcribeAudioWithElevenLabs(mediaUrl);
          if (transcription) {
            mediaDescriptions.push(`[Audio transcription] ${transcription}`);
          }
        } else if (mediaType === 'video') {
          // For videos, try to transcribe audio track
          const transcription = await transcribeAudioWithElevenLabs(mediaUrl);
          if (transcription) {
            mediaDescriptions.push(`[Video audio transcription] ${transcription}`);
          }
        }
      }
      
      console.log('[process-note] Media descriptions:', mediaDescriptions);
    }

    // Fetch user memories for context personalization
    let memoryContext = '';
    try {
      const { data: memoryData } = await supabase.functions.invoke('manage-memories', {
        body: { action: 'get_context', user_id }
      });
      
      if (memoryData?.success && memoryData.context) {
        memoryContext = memoryData.context;
        console.log('[process-note] Retrieved', memoryData.count, 'user memories for context');
      }
    } catch (memErr) {
      console.warn('[process-note] Could not fetch user memories:', memErr);
    }

    // Fetch existing lists for context
    let existingListsQuery = supabase
      .from('clerk_lists')
      .select('id, name, description, is_manual')
      .eq('author_id', user_id);

    if (couple_id) {
      existingListsQuery = supabase
        .from('clerk_lists')
        .select('id, name, description, is_manual')
        .or(`and(author_id.eq.${user_id},couple_id.is.null),couple_id.eq.${couple_id}`);
    } else {
      existingListsQuery = existingListsQuery.is('couple_id', null);
    }

    const { data: existingLists, error: listsError } = await existingListsQuery;
    
    if (listsError) {
      console.error('Error fetching existing lists:', listsError);
    }

    // Prepare context
    const listsContext = existingLists && existingLists.length > 0 
      ? `\n\nExisting lists: ${existingLists.map(list => list.name).join(', ')}`
      : '';

    const userTimezone = timezone || 'UTC';
    const hasMedia = mediaDescriptions.length > 0;
    
    // Determine input style
    const userStyle: 'auto' | 'succinct' | 'conversational' = style || 'auto';
    let detectedStyle: 'succinct' | 'conversational';
    
    if (userStyle === 'auto') {
      detectedStyle = detectInputStyle(text);
      console.log('[process-note] Auto-detected style:', detectedStyle);
    } else {
      detectedStyle = userStyle;
      console.log('[process-note] Using user-specified style:', detectedStyle);
    }
    
    // Combine text with media transcriptions for enhanced processing
    let enhancedText = text;
    
    // For conversational input, preprocess to extract key info (reduces tokens)
    if (detectedStyle === 'conversational') {
      enhancedText = extractKeyInfoFromConversational(text);
      console.log('[process-note] Preprocessed conversational text:', enhancedText.substring(0, 100) + '...');
    }
    
    // Detect if user text is vague/generic (needs media content to be primary)
    const vagueTextPatterns = [
      /^(save|remember|keep|store|note|add)\s*(this|it)?$/i,
      /^process\s*(attached\s*)?(media|image|photo|file)?$/i,
      /^(look|check|see)\s*(at\s*)?(this)?$/i,
      /^(this|it|here)$/i,
      /^$/
    ];
    const isVagueText = vagueTextPatterns.some(pattern => pattern.test(text.trim()));
    
    if (hasMedia) {
      // Extract all media content
      const imageDescriptions = mediaDescriptions
        .filter(d => d.startsWith('[Image]'))
        .map(d => d.replace(/^\[Image\]\s*/, ''))
        .join('\n');
      
      const audioTranscriptions = mediaDescriptions
        .filter(d => d.startsWith('[Audio') || d.startsWith('[Video'))
        .map(d => d.replace(/^\[.*?\]\s*/, ''))
        .join(' ');
      
      if (isVagueText && (imageDescriptions || audioTranscriptions)) {
        // When text is vague, media content becomes the PRIMARY source
        console.log('[process-note] Vague text detected with media - using media content as primary source');
        
        if (imageDescriptions) {
          enhancedText = `[User wants to save/remember the following from an image]\n\n${imageDescriptions}`;
        }
        if (audioTranscriptions) {
          enhancedText = enhancedText === text 
            ? `[User wants to save/remember the following from audio]\n\n${audioTranscriptions}`
            : `${enhancedText}\n\n[Audio content]: ${audioTranscriptions}`;
        }
      } else {
        // Normal case: append audio transcriptions to user text
        if (audioTranscriptions) {
          enhancedText = `${enhancedText}\n\nAudio content: ${audioTranscriptions}`;
        }
        // Also add image descriptions to the text if not vague
        if (imageDescriptions) {
          enhancedText = `${enhancedText}\n\n[Attached image context]: ${imageDescriptions}`;
        }
      }
      
      console.log('[process-note] Enhanced text with media:', enhancedText.substring(0, 200) + '...');
    }
    
    const systemPrompt = createSystemPrompt(userTimezone, hasMedia, mediaDescriptions, detectedStyle, memoryContext);
    
    // Build user prompt with explicit media-first instruction when text is vague
    let userPrompt: string;
    if (isVagueText && hasMedia) {
      userPrompt = `${systemPrompt}${listsContext}

CRITICAL: The user's text ("${text}") is vague/generic. You MUST derive the task summary and details ENTIRELY from the media content provided above. 
Do NOT use the user's text as the summary. Create a meaningful, specific summary based on what was extracted from the media.

Process this note:
"${enhancedText}"`;
    } else {
      userPrompt = `${systemPrompt}${listsContext}\n\nProcess this note:\n"${enhancedText}"`;
    }

    console.log('[GenAI SDK] Processing note with structured output...');
    console.log('[GenAI SDK] Style:', detectedStyle, 'Has media:', hasMedia, 'Media descriptions count:', mediaDescriptions.length, 'Is vague text:', isVagueText);

    let processedResponse: any;

    try {
      // Use Google GenAI SDK with structured output
      const response = await genai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: userPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: multiNoteSchema,
          temperature: 0.1,
          maxOutputTokens: 1200
        }
      });

      const responseText = response.text;
      console.log('[GenAI SDK] Raw response:', responseText);

      try {
        processedResponse = JSON.parse(responseText);
        console.log('[GenAI SDK] Parsed response:', processedResponse);
      } catch (parseError) {
        console.error('[GenAI SDK] Parse error, using fallback:', parseError);
        processedResponse = {
          multiple: false,
          notes: [{
            summary: text.length > 100 ? text.substring(0, 97) + "..." : text,
            category: "task",
            due_date: null,
            priority: "medium",
            tags: [],
            items: []
          }]
        };
      }
    } catch (genAiError: any) {
      console.error('[GenAI SDK] Error during structured generation:', genAiError);
      const message = genAiError?.message || String(genAiError);

      if (
        message.includes('RESOURCE_EXHAUSTED') ||
        message.includes('quota') ||
        message.includes('Too Many Requests') ||
        (genAiError as any)?.status === 429
      ) {
        console.warn('[GenAI SDK] Quota exceeded, falling back to simple note creation');
        processedResponse = {
          multiple: false,
          notes: [{
            summary: text.length > 100 ? text.substring(0, 97) + "..." : text,
            category: "task",
            due_date: null,
            priority: "medium",
            tags: [],
            items: []
          }]
        };
      } else {
        throw genAiError;
      }
    }

    // Smart list pattern detection
    const categoryMap: Record<string, string[]> = {
      'groceries': ['grocery', 'food', 'supermarket', 'shopping list'],
      'travel': ['travel idea', 'trip', 'vacation', 'flight', 'hotel'],
      'home improvement': ['home', 'repair', 'fix', 'maintenance', 'renovation'],
      'entertainment': ['date idea', 'movie', 'show', 'concert', 'event'],
      'personal': ['task', 'personal', 'appointment', 'errand'],
      'shopping': ['shopping', 'buy', 'purchase', 'store'],
      'health': ['health', 'fitness', 'exercise', 'doctor', 'medical'],
      'finance': ['finance', 'bill', 'payment', 'budget', 'money']
    };

    const findOrCreateList = async (category: string, tags: string[] = []) => {
      if (!category) return null;

      // Find best matching existing list
      let bestMatch = null;
      let highestScore = 0;
      
      if (existingLists && existingLists.length > 0) {
        for (const list of existingLists) {
          let score = 0;
          const listNameLower = list.name.toLowerCase();
          const categoryLower = category.toLowerCase().replace(/_/g, ' ');
          
          if (listNameLower === categoryLower) score += 10;
          
          Object.entries(categoryMap).forEach(([canonical, synonyms]) => {
            if (synonyms.includes(categoryLower) && synonyms.some(s => listNameLower.includes(s))) {
              score += 8;
            }
          });
          
          if (listNameLower.includes(categoryLower) || categoryLower.includes(listNameLower)) {
            score += 5;
          }
          
          if (score > highestScore) {
            highestScore = score;
            bestMatch = list;
          }
        }
      }
      
      if (bestMatch && highestScore >= 5) {
        console.log('Found matching list:', bestMatch.name);
        return bestMatch.id;
      }
      
      // Create new list
      const listName = category
        .replace(/_/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      
      console.log('Creating new list:', listName);
      
      try {
        const { data: newList, error: createError } = await supabase
          .from('clerk_lists')
          .insert([{
            name: listName,
            description: `Auto-generated for ${listName.toLowerCase()}`,
            is_manual: false,
            author_id: user_id,
            couple_id: couple_id || null,
          }])
          .select()
          .single();
          
        if (createError) {
          console.error('Error creating list:', createError);
          return null;
        }
        
        return newList.id;
      } catch (error) {
        console.error('Exception during list creation:', error);
        return null;
      }
    };

    // Process notes (handle both single and multiple)
    const notes = processedResponse.multiple && processedResponse.notes 
      ? processedResponse.notes 
      : [processedResponse.notes?.[0] || processedResponse];

    const processedNotes = await Promise.all(
      notes.map(async (note: any) => {
        const listId = note.category ? await findOrCreateList(note.category, note.tags || []) : null;
        
        return {
          summary: note.summary || text,
          category: note.category || "task",
          due_date: note.due_date || null,
          reminder_time: note.reminder_time || null,
          recurrence_frequency: note.recurrence_frequency || null,
          recurrence_interval: note.recurrence_interval || null,
          priority: note.priority || "medium",
          tags: note.tags || [],
          items: note.items || [],
          task_owner: note.task_owner || null,
          list_id: listId,
          original_text: text,
          media_urls: mediaUrls.length > 0 ? mediaUrls : null
        };
      })
    );

    const isMultiple = processedResponse.multiple === true || notes.length > 1;

    const result = isMultiple
      ? { multiple: true, notes: processedNotes, original_text: text, media_urls: mediaUrls.length > 0 ? mediaUrls : null }
      : { ...processedNotes[0], original_text: text };

    console.log('[GenAI SDK] Final result:', result);
    
    // Auto-extract memories from brain-dump (async, non-blocking)
    extractMemoriesFromDump(genai, supabase, text, user_id).catch(err => {
      console.warn('[Memory Extraction] Non-blocking error:', err);
    });
    
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[GenAI SDK] Error:', error);
    return new Response(JSON.stringify({ 
      error: error?.message || 'Unknown error occurred',
      summary: 'Note processing failed',
      category: 'task',
      due_date: null,
      priority: 'medium',
      tags: [],
      items: [],
      list_id: null,
      original_text: ''
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

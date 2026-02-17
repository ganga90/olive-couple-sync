import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai@1.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
};

// ============================================================================
// URL EXTRACTION & LINK SAVING
// ============================================================================

// URL regex that matches common URL patterns
const URL_REGEX = /https?:\/\/[^\s<>\[\]{}'"(),;]+[^\s<>\[\]{}'"(),;.!?]/gi;

// Extract URLs from text
function extractUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(URL_REGEX);
  if (!matches) return [];

  // Deduplicate and return
  return [...new Set(matches)];
}

// Save extracted links via save-link function (non-blocking)
async function saveExtractedLinks(
  supabase: SupabaseClient,
  urls: string[],
  userId: string,
  coupleId?: string,
  sourceNoteId?: string
): Promise<void> {
  if (urls.length === 0) return;

  console.log('[process-note] Saving', urls.length, 'extracted links');

  // Process links in parallel (non-blocking)
  const promises = urls.slice(0, 5).map(async (url) => {  // Limit to 5 links per note
    try {
      const { data, error } = await supabase.functions.invoke('save-link', {
        body: {
          url,
          user_id: userId,
          couple_id: coupleId,
          source_note_id: sourceNoteId
        }
      });

      if (error) {
        console.warn('[process-note] Failed to save link:', url, error);
      } else if (data?.duplicate) {
        console.log('[process-note] Link already saved:', url);
      } else {
        console.log('[process-note] Link saved successfully:', data?.link?.id);
      }
    } catch (err) {
      console.warn('[process-note] Error saving link:', url, err);
    }
  });

  // Don't await - let links save in background
  Promise.all(promises).catch(err => {
    console.warn('[process-note] Background link saving error:', err);
  });
}

// Define the JSON schema for structured output
const singleNoteSchema = {
  type: Type.OBJECT,
  properties: {
    summary: { 
      type: Type.STRING, 
      description: "Concise title (max 100 chars). Extract the MAIN entity name. Examples: 'Restaurant Name', 'Doctor Appointment', 'Book Title'. For links, extract the business/entity name from URL or context." 
    },
    category: { 
      type: Type.STRING, 
      description: "Category using lowercase with underscores: entertainment, date_ideas, home_improvement, travel, groceries, shopping, personal, task, books, movies_tv, health" 
    },
    target_list: {
      type: Type.STRING,
      nullable: true,
      description: "CRITICAL: The exact name of an existing user list where this note should be saved. Use when user has preferences or when content clearly matches a list name."
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
      description: "Extract themes like urgent, financial, health, book, movie, tv_show, restaurant, vegan, appointment" 
    },
    items: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      nullable: true,
      description: "CRITICAL: Extract ALL sub-details as 'Label: Value' pairs. For BUSINESSES: 'Phone: [number]', 'Website: [URL]', 'Address: [location]', 'Hours: [times]', 'Rating: [stars]', 'Price: [level]', 'Cuisine: [type]'. For APPOINTMENTS: 'Provider: [name]', 'Phone: [number]', 'Time: [time]'. For PROMOS: 'Code: [code]', 'Discount: [%]', 'Expires: [date]'. Include ALL available details." 
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

// Helper: Patterns that indicate a generic/vague summary that should be replaced
const GENERIC_SUMMARY_PATTERNS = [
  /^save\s*(this|it)?$/i,
  /^remember\s*(this|it)?$/i,
  /^process\s*(attached\s*)?(media|image|photo|file)?$/i,
  /^keep\s*(this|it)?$/i,
  /^store\s*(this|it)?$/i,
  /^note\s*(this|it)?$/i,
  /^add\s*(this|it)?$/i,
  /^this$/i,
  /^it$/i,
  /^here$/i,
  /^$/
];

// Check if a summary is too generic and should be replaced with media content
function isGenericSummary(summary: string): boolean {
  const s = (summary || '').trim();
  return GENERIC_SUMMARY_PATTERNS.some(p => p.test(s));
}

// Derive a meaningful summary from media descriptions
function deriveSummaryFromMedia(mediaDescriptions: string[]): string {
  if (!mediaDescriptions || mediaDescriptions.length === 0) {
    return 'Saved media';
  }
  
  // Get the first media description and clean it up
  const raw = mediaDescriptions[0] || '';
  // Strip leading "[Image]", "[Audio transcription]" etc.
  const cleaned = raw.replace(/^\[.*?\]\s*/, '').trim();
  
  if (!cleaned) {
    return 'Saved media';
  }
  
  // Extract key info: look for promo codes, appointments, event names, etc.
  // Try to get a concise first sentence or phrase
  const firstSentence = cleaned.split(/[.!?\n]/)[0]?.trim();
  
  if (firstSentence && firstSentence.length <= 100) {
    return firstSentence;
  }
  
  // Truncate if too long
  return cleaned.length > 97 ? cleaned.substring(0, 97) + '...' : cleaned;
}

// Dynamic system prompt with media context, style awareness, user memory, and existing lists
const createSystemPrompt = (
  userTimezone: string = 'UTC', 
  hasMedia: boolean = false, 
  mediaDescriptions: string[] = [],
  inputStyle: 'succinct' | 'conversational' = 'succinct',
  memoryContext: string = '',
  existingListNames: string[] = []
) => {
  const now = new Date();
  const utcTime = now.toISOString();
  
  let mediaContext = '';
  if (hasMedia && mediaDescriptions.length > 0) {
    mediaContext = `

MEDIA CONTEXT - CRITICAL: The user has attached media with extracted content:
${mediaDescriptions.map((d, i) => `Media ${i + 1}: ${d}`).join('\n')}

MEDIA EXTRACTION RULES - ALWAYS extract ALL details into items array:

1. **BUSINESS/RESTAURANT/LOCATION (Google Maps, Yelp, etc.)**:
   - Summary: "[Business Name]" (just the name, clean and simple)
   - Category: "date_ideas" for restaurants, "personal" for services, "health" for medical
   - Items: Extract EVERY detail as "Label: Value":
     * "Phone: [number]"
     * "Website: [URL]"
     * "Address: [full address]"
     * "Hours: [business hours]"
     * "Rating: [X.X stars]"
     * "Reviews: [number]"
     * "Price: [$ level]"
     * "Cuisine: [type]" (for restaurants)
     * "Features: [amenities]"
   - Tags: [type, cuisine, "restaurant"/"business", location]

2. **Promo codes/Coupons**: 
   - Summary: "[Brand] promo code: [CODE] - [DISCOUNT]"
   - Items: ["Code: [CODE]", "Discount: [DISCOUNT]", "Expires: [DATE]", "Conditions: [if any]"]
   - Set due_date to expiration date (if found) at 09:00
   - Category: "shopping"

3. **Appointments**: 
   - Summary: "[Type] appointment at [Place]"
   - Items: ["Provider: [NAME]", "Phone: [NUMBER]", "Address: [LOCATION]", "Time: [TIME]", "Purpose: [REASON]"]
   - Set due_date and reminder_time (24h before)
   - Category: "health" or "personal"

4. **Events/Tickets**: 
   - Summary: "[Event name] at [Venue]"
   - Items: ["Venue: [VENUE]", "Date: [DATE]", "Time: [TIME]", "Tickets: [info]", "Price: [COST]"]
   - Category: "entertainment"

5. **Books**:
   - Summary: "[Book Title]" or "[Book Title] by [Author]"
   - Items: ["Author: [NAME]", "ISBN: [NUMBER]", "Publisher: [NAME]"]
   - Category: "books"
   - target_list: match to Books list if exists

CRITICAL: If user text is vague ("save this", "remember"), use ALL media content to create summary AND populate items with extracted details.`;
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
  
  // Build memory context section with list routing instructions
  let memorySection = '';
  if (memoryContext) {
    memorySection = `\n\n${memoryContext}\n\n**CRITICAL: USE MEMORIES FOR PERSONALIZATION AND LIST ROUTING**
You MUST use the user's memories to:
1. **Personalize summaries** with specific details (pet names, brands, quantities)
2. **Route to correct lists** - If memories mention saving specific content types to specific lists, output that exact list name in target_list
3. **Match note text against list names** - If ANY word or phrase in the note text exactly matches an existing list name, set target_list to that list name

Examples:
- Memory: "I save books to Books list" + Image of a book → target_list: "Books"
- Memory: "Movies go to Tv shows and Movies list" + Movie screenshot → target_list: "Tv shows and Movies"
- Memory: "I have an LLC" + Note text contains "LLC" + User has a list called "LLC" → target_list: "LLC"
- User says "buy dog food" + memory "dog named Milka eats Royal Canine" → Summary: "Buy Royal Canine for Milka"`;
  }

  // Build existing lists section for intelligent routing
  let listsSection = '';
  if (existingListNames.length > 0) {
    listsSection = `\n\n**USER'S EXISTING LISTS**: ${existingListNames.join(', ')}

**LIST ROUTING RULES (CRITICAL - FOLLOW IN THIS EXACT ORDER)**:
1. **DIRECT NAME MATCH**: If any word or phrase in the note text EXACTLY matches an existing list name (case-insensitive), output that list name in target_list. Example: Note "LLC check business account" + list "LLC" exists → target_list: "LLC"
2. **Memory-based routing**: If user memories specify routing preferences, ALWAYS follow them
3. **Content matching**: When content clearly matches a list name, output that exact list name in target_list
4. Only leave target_list null if content doesn't match any list`;
  }

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
1. summary: Concise title (max 100 chars) - EXTRACT THE MAIN ENTITY NAME
   - Groceries: item name only ("milk" not "buy milk")
   - Actions: keep verb ("fix sink")
   - **Links/URLs**: Extract the business/entity name from the URL or context (e.g., "Nobu Restaurant" not "restaurant link")
   - **Appointments**: Type + provider if known ("Doctor Appointment" or "Dr. Smith Appointment")
   - For media with promo codes: "[Brand] promo code: [CODE] - [DISCOUNT]"

2. category: Use lowercase with underscores
   - concerts/events/shows → "entertainment"
   - restaurants/dinner plans → "date_ideas"
   - repairs/fix/maintenance → "home_improvement"
   - vacation/flights/hotels → "travel"
   - groceries/supermarket → "groceries"
   - clothes/electronics/promo codes → "shopping"
   - appointments/bills/rent → "personal"
   - books/reading → "books"
   - movies/tv shows/series → "movies_tv"
   - medical/doctor/dentist → "health"

3. target_list: If user has existing lists and content matches one, output the EXACT list name
   - Books/reading material → match "Books" list if exists
   - Movies/TV → match "Movies" or "Tv shows" list if exists
   - ALWAYS check user memories for routing preferences

4. due_date/reminder_time: ISO format
   - "remind me" → set BOTH reminder_time AND due_date to same datetime
   - Time references: "tomorrow" (next day 09:00), "tonight" (same day 23:59)
   - Weekday references: next occurrence at 09:00
   - Promo expiration dates → set as due_date
   - Appointment dates → set as due_date AND reminder_time (24h before)
   - IMPORTANT: When setting reminder_time, ALWAYS also set due_date to match

5. priority: high (urgent/bills/expiring soon), medium (regular), low (ideas)

6. **items: CRITICAL - Extract ALL relevant sub-details and additional information**
   Format each item as "Label: Value" for clarity.
   
   **For LINKS/URLs:**
   - "Website: [full URL]"
   - "Cuisine: [type]" for restaurants
   - "Dietary: vegan, gluten-free" if mentioned
   - "Price: $$$" if known
   - "Hours: [opening hours]" if known
   - "Address: [location]" if known
   
   **For APPOINTMENTS:**
   - "Provider: Dr. [Name]" or "[Clinic Name]"
   - "Phone: [number]"
   - "Address: [location]"
   - "Time: [appointment time]"
   - "Purpose: [reason for visit]"
   - "Notes: [any prep instructions]"
   
   **For EVENTS/ENTERTAINMENT:**
   - "Venue: [place]"
   - "Date: [date]"
   - "Time: [time]"
   - "Tickets: [link or info]"
   - "Price: [cost]"
   
   **For PROMO CODES:**
   - "Code: [CODE]"
   - "Discount: [amount]"
   - "Expires: [date]"
   - "Store: [brand]"
   - "Conditions: [restrictions]"
   
   **For TASKS with multiple steps:**
   - Each sub-task or action item
   
   **NEVER use items for:**
   - Grocery lists (create separate notes instead)
   - Simple single-action tasks with no additional details

7. recurrence_frequency/recurrence_interval: For recurring reminders
   - "every day" → frequency: "daily", interval: 1
   - "every 2 weeks" → frequency: "weekly", interval: 2
${listsSection}

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

// ============================================================================
// RECEIPT DETECTION
// ============================================================================

interface ReceiptDetectionResult {
  isReceipt: boolean;
  confidence: number;
  receiptType?: 'retail' | 'restaurant' | 'service' | 'other';
}

// Detect if an image is a receipt
async function detectReceipt(genai: GoogleGenAI, base64Image: string, mimeType: string): Promise<ReceiptDetectionResult> {
  try {
    const detectionPrompt = `Analyze this image and determine if it is a receipt, invoice, or bill.

Return JSON with:
{
  "isReceipt": true/false,
  "confidence": 0.0-1.0,
  "receiptType": "retail" | "restaurant" | "service" | "other" | null
}

Signs of a receipt:
- Contains store/merchant name
- Shows line items with prices
- Has a total amount
- Contains date/time
- May have payment method info
- May have tax breakdown

If NOT a receipt (e.g., screenshot of social media, book cover, photo), return isReceipt: false.`;

    const response = await genai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: detectionPrompt },
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
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: 200
      }
    });

    const responseText = response.text || '';
    const parsed = JSON.parse(responseText);

    return {
      isReceipt: parsed.isReceipt === true,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      receiptType: parsed.receiptType
    };
  } catch (error) {
    console.error('[Receipt Detection] Error:', error);
    return { isReceipt: false, confidence: 0 };
  }
}

// Process receipt using the dedicated receipt processor
async function processReceiptImage(
  supabase: any,
  base64Image: string,
  userId: string,
  coupleId?: string
): Promise<{ success: boolean; transaction?: any; alert?: boolean; message?: string }> {
  try {
    console.log('[process-note] Invoking process-receipt for receipt image...');

    const { data, error } = await supabase.functions.invoke('process-receipt', {
      body: {
        base64_image: base64Image,
        user_id: userId,
        couple_id: coupleId
      }
    });

    if (error) {
      console.error('[process-note] Receipt processing error:', error);
      return { success: false, message: error.message };
    }

    console.log('[process-note] Receipt processed successfully:', data?.transaction?.id);
    return {
      success: data?.success || false,
      transaction: data?.transaction,
      alert: data?.alert,
      message: data?.budget_message
    };
  } catch (error: any) {
    console.error('[process-note] Receipt processing exception:', error);
    return { success: false, message: error?.message };
  }
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
    
    // Enhanced prompt for structured data extraction - especially for business/location pages
    const extractionPrompt = `Analyze this image and extract ALL useful information with MAXIMUM detail. Be thorough and specific.

**STOCK/FINANCIAL SCREENSHOTS - CRITICAL:**
- Stock Ticker Symbol (e.g., "$RACE", "$AAPL", "$AMZN")
- Company Name (e.g., "Ferrari N.V.", "Apple Inc.")
- Current Price (exact number)
- Price Change (amount and percentage)
- Market Cap, P/E Ratio, Volume if visible
- Chart timeframe and trend direction
- Any analyst ratings or price targets
- News headlines about the stock
FORMAT: "[TICKER] - [COMPANY NAME]" as primary identification

**SOCIAL MEDIA POSTS (Twitter/X, Instagram, Reddit, etc.):**
- Username/Handle of poster
- Main text content (VERBATIM if important)
- Any stock tickers mentioned (extract ALL $SYMBOLS)
- Links or URLs mentioned
- Date/time if visible
- Key claims or recommendations
FORMAT: Extract the ACTUAL content being shared, not "social media post"

**BUSINESS/LOCATION PAGES (Google Maps, Yelp, etc.) - EXTRACT ALL:**
- Business Name (exact name as shown)
- Phone Number (with area code)
- Website URL (full URL if visible)
- Full Address (street, city, state, zip)
- Hours of Operation (e.g., "Mon-Fri: 9am-5pm")
- Rating (e.g., "4.5 stars")
- Number of Reviews (e.g., "1,234 reviews")
- Price Level (e.g., "$$" or "Moderate")
- Category/Type (e.g., "Italian Restaurant", "Dentist Office")
- Cuisine Type (for restaurants)
- Amenities (e.g., "Outdoor seating", "Wheelchair accessible", "Delivery available")
- Popular Dishes/Services (if shown)
- Any special notes (e.g., "Temporarily closed", "By appointment only")

**BOOKS/MEDIA:**
- Title, Author, ISBN, Publisher - format as "Book: [TITLE] by [AUTHOR]"

**PRODUCTS:**
- Product name, brand, model, price - format as "[BRAND] [PRODUCT NAME]"

**PROMO CODES/COUPONS:**
- Code, discount amount, expiration date, conditions

**APPOINTMENTS:**
- Provider name, specialty, date, time, location, phone

**EVENTS:**
- Event name, venue, date, time, ticket info, price

**RECEIPTS:**
- Store name, items, amounts, date

**CONTACT INFO:**
- Phone numbers, emails, websites, social media handles

FORMAT YOUR RESPONSE AS STRUCTURED DATA with the PRIMARY SUBJECT clearly identified first.
For STOCKS: Start with "[TICKER] [COMPANY] - [PRICE]"
For SOCIAL MEDIA about stocks: Start with the stock ticker(s) and company name(s)
For other content types, start with the MAIN SUBJECT clearly identified.

CRITICAL: Extract EVERY piece of visible information. Be specific and complete. Never return generic text like "social media post" - extract the ACTUAL content.
Max 400 words.`;


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
        maxOutputTokens: 600
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
function getMediaType(url: string, contentType?: string): 'image' | 'audio' | 'video' | 'pdf' | 'unknown' {
  const urlLower = url.toLowerCase();
  
  if (contentType) {
    if (contentType.startsWith('image/')) return 'image';
    if (contentType.startsWith('audio/')) return 'audio';
    if (contentType.startsWith('video/')) return 'video';
    if (contentType === 'application/pdf') return 'pdf';
  }
  
  // Check URL extension
  if (/\.(jpg|jpeg|png|gif|webp|heic|heif)(\?|$)/i.test(urlLower)) return 'image';
  if (/\.(mp3|wav|ogg|webm|m4a|aac|opus)(\?|$)/i.test(urlLower)) return 'audio';
  if (/\.(mp4|mov|avi|mkv)(\?|$)/i.test(urlLower)) return 'video';
  if (/\.pdf(\?|$)/i.test(urlLower)) return 'pdf';
  
  return 'unknown';
}

// Analyze PDF with Gemini
async function analyzePdfWithGemini(genai: GoogleGenAI, pdfUrl: string): Promise<string> {
  try {
    console.log('[Gemini PDF] Analyzing PDF:', pdfUrl);
    
    // Download the PDF
    const pdfResponse = await fetch(pdfUrl);
    if (!pdfResponse.ok) {
      console.error('[Gemini PDF] Failed to download PDF:', pdfResponse.status);
      return '';
    }
    
    const pdfBlob = await pdfResponse.blob();
    const arrayBuffer = await pdfBlob.arrayBuffer();
    // Use the safe chunked base64 conversion to avoid stack overflow on large PDFs
    const base64Pdf = arrayBufferToBase64(arrayBuffer);
    
    console.log('[Gemini PDF] PDF downloaded, size:', pdfBlob.size);
    
    const extractionPrompt = `Analyze this PDF document and extract ALL relevant information. Be thorough and specific.

**RECEIPTS/INVOICES:**
- Store/Vendor name, Date, Total amount
- Individual line items with prices
- Payment method, transaction ID

**MEDICAL RECORDS:**
- Provider name, Date of service
- Patient information (if visible)
- Diagnoses, Treatments, Medications
- Follow-up instructions

**CONTRACTS/LEGAL DOCUMENTS:**
- Document type, Parties involved
- Key terms, Dates, Amounts
- Important clauses

**PET/VETERINARY RECORDS:**
- Pet name, Species, Breed
- Veterinarian/Clinic name
- Vaccinations, Treatments, Medications
- Next appointment dates

**GENERAL DOCUMENTS:**
- Document title and type
- Key dates and amounts
- Important information and action items

Extract ALL useful information. Max 500 words.`;

    const response = await genai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: extractionPrompt },
            {
              inlineData: {
                mimeType: "application/pdf",
                data: base64Pdf
              }
            }
          ]
        }
      ],
      config: {
        temperature: 0.1,
        maxOutputTokens: 800
      }
    });
    
    const description = response.text || '';
    console.log('[Gemini PDF] Analysis result:', description.substring(0, 200));
    
    return description;
  } catch (error) {
    console.error('[Gemini PDF] Error analyzing PDF:', error);
    return '';
  }
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

    const responseText = response.text || '';
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

    const { text, user_id, couple_id, timezone, media, mediaTypes, style } = await req.json();
    
    // Validate required fields - allow empty text if media is present
    if (!user_id) {
      throw new Error('Missing required field: user_id');
    }
    
    const hasText = typeof text === 'string' && text.trim().length > 0;
    const hasMediaInput = Array.isArray(media) && media.length > 0;
    
    // Store content types for media detection (from WhatsApp webhook)
    const contentTypes: string[] = Array.isArray(mediaTypes) ? mediaTypes : [];
    
    if (!hasText && !hasMediaInput) {
      throw new Error('Missing required content: provide text or media');
    }
    
    // Use empty string if text is null/undefined but media exists
    const safeText = text || '';

    console.log('[process-note] Received style preference:', style || 'not specified');

    // Initialize clients
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // Process media if provided
    const mediaDescriptions: string[] = [];
    const mediaUrls: string[] = media || [];
    let receiptProcessingResult: { success: boolean; transaction?: any; alert?: boolean; message?: string } | null = null;

    if (mediaUrls.length > 0) {
      console.log('[process-note] Processing', mediaUrls.length, 'media files, content types:', contentTypes);

      for (let i = 0; i < mediaUrls.length; i++) {
        const mediaUrl = mediaUrls[i];
        // Use content type from WhatsApp if available, fallback to URL detection
        const contentType = contentTypes[i] || undefined;
        const mediaType = getMediaType(mediaUrl, contentType);
        console.log('[process-note] Media type:', mediaType, 'Content-Type:', contentType, 'URL:', mediaUrl);

        if (mediaType === 'image') {
          // Download image for receipt detection
          try {
            const imageResponse = await fetch(mediaUrl);
            if (imageResponse.ok) {
              const imageBlob = await imageResponse.blob();
              const arrayBuffer = await imageBlob.arrayBuffer();
              const base64Image = arrayBufferToBase64(arrayBuffer);
              const mimeType = imageBlob.type || 'image/jpeg';

              // Check if this image is a receipt
              console.log('[process-note] Checking if image is a receipt...');
              const receiptCheck = await detectReceipt(genai, base64Image, mimeType);
              console.log('[process-note] Receipt detection result:', receiptCheck);

              if (receiptCheck.isReceipt && receiptCheck.confidence >= 0.7) {
                // Process as receipt with specialized handler
                console.log('[process-note] High-confidence receipt detected, processing with receipt handler');
                receiptProcessingResult = await processReceiptImage(supabase, base64Image, user_id, couple_id);

                if (receiptProcessingResult.success && receiptProcessingResult.transaction) {
                  // Add receipt info to media descriptions
                  const txn = receiptProcessingResult.transaction;
                  mediaDescriptions.push(`[Receipt] ${txn.merchant} - $${txn.amount} (${txn.category}) on ${txn.date}`);

                  // If there's a budget alert, add it to the description
                  if (receiptProcessingResult.alert && receiptProcessingResult.message) {
                    mediaDescriptions.push(`[Budget Alert] ${receiptProcessingResult.message}`);
                  }
                } else {
                  // Fallback to normal image analysis if receipt processing fails
                  console.log('[process-note] Receipt processing failed, falling back to normal image analysis');
                  const description = await analyzeImageWithGemini(genai, mediaUrl);
                  if (description) {
                    mediaDescriptions.push(`[Image] ${description}`);
                  }
                }
              } else {
                // Not a receipt - use normal image analysis
                const description = await analyzeImageWithGemini(genai, mediaUrl);
                if (description) {
                  mediaDescriptions.push(`[Image] ${description}`);
                }
              }
            } else {
              // Couldn't download image, try normal analysis
              const description = await analyzeImageWithGemini(genai, mediaUrl);
              if (description) {
                mediaDescriptions.push(`[Image] ${description}`);
              }
            }
          } catch (imgError) {
            console.error('[process-note] Image processing error:', imgError);
            // Fallback to normal analysis
            const description = await analyzeImageWithGemini(genai, mediaUrl);
            if (description) {
              mediaDescriptions.push(`[Image] ${description}`);
            }
          }
        } else if (mediaType === 'pdf') {
          const description = await analyzePdfWithGemini(genai, mediaUrl);
          if (description) {
            mediaDescriptions.push(`[PDF Document] ${description}`);
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

    // Fetch RELEVANT user memories using semantic search
    let memoryContext = '';
    try {
      // Build a search query from text and media descriptions
      const searchQuery = [
        safeText,
        ...mediaDescriptions.map(d => d.replace(/^\[.*?\]\s*/, '').substring(0, 200))
      ].filter(Boolean).join(' ');
      
      console.log('[process-note] Searching relevant memories for query:', searchQuery.substring(0, 100));
      
      const { data: memoryData } = await supabase.functions.invoke('manage-memories', {
        body: { action: 'search_relevant', user_id, query: searchQuery }
      });
      
      if (memoryData?.success && memoryData.context) {
        memoryContext = memoryData.context;
        console.log('[process-note] Retrieved', memoryData.count, 'relevant user memories via semantic search');
      } else {
        console.log('[process-note] No relevant memories found, using fallback');
        // Fallback to get_context if search fails
        const { data: fallbackData } = await supabase.functions.invoke('manage-memories', {
          body: { action: 'get_context', user_id }
        });
        if (fallbackData?.success && fallbackData.context) {
          memoryContext = fallbackData.context;
          console.log('[process-note] Fallback: Retrieved', fallbackData.count, 'memories');
        }
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
      detectedStyle = detectInputStyle(safeText);
      console.log('[process-note] Auto-detected style:', detectedStyle);
    } else {
      detectedStyle = userStyle;
      console.log('[process-note] Using user-specified style:', detectedStyle);
    }
    
    // Combine text with media transcriptions for enhanced processing
    let enhancedText = safeText;
    
    // For conversational input, preprocess to extract key info (reduces tokens)
    if (detectedStyle === 'conversational' && safeText) {
      enhancedText = extractKeyInfoFromConversational(safeText);
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
    const isVagueText = vagueTextPatterns.some(pattern => pattern.test(safeText.trim()));
    
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
          enhancedText = enhancedText === safeText 
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
    
    // Extract list names for AI context
    const existingListNames = (existingLists || []).map((l: any) => l.name);
    
    const systemPrompt = createSystemPrompt(userTimezone, hasMedia, mediaDescriptions, detectedStyle, memoryContext, existingListNames);
    
    // Build user prompt with explicit media-first instruction when text is vague
    let userPrompt: string;
    if (isVagueText && hasMedia) {
      userPrompt = `${systemPrompt}${listsContext}

CRITICAL: The user's text ("${safeText}") is vague/generic. You MUST derive the task summary and details ENTIRELY from the media content provided above. 
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

      const responseText = response.text || '';
      console.log('[GenAI SDK] Raw response:', responseText);

      try {
        processedResponse = JSON.parse(responseText);
        console.log('[GenAI SDK] Parsed response:', processedResponse);
      } catch (parseError) {
        console.error('[GenAI SDK] Parse error, using fallback:', parseError);
        // Use media description as fallback summary if available
        const fallbackSummary = mediaDescriptions.length > 0 
          ? deriveSummaryFromMedia(mediaDescriptions)
          : (safeText.length > 100 ? safeText.substring(0, 97) + "..." : safeText || 'Saved note');
        processedResponse = {
          multiple: false,
          notes: [{
            summary: fallbackSummary,
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
        // Use media description as fallback summary if available
        const fallbackSummary = mediaDescriptions.length > 0 
          ? deriveSummaryFromMedia(mediaDescriptions)
          : (safeText.length > 100 ? safeText.substring(0, 97) + "..." : safeText || 'Saved note');
        processedResponse = {
          multiple: false,
          notes: [{
            summary: fallbackSummary,
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

    // Smart list pattern detection - expanded with media types
    const categoryMap: Record<string, string[]> = {
      'groceries': ['grocery', 'groceries', 'food', 'supermarket', 'shopping list'],
      'travel': ['travel idea', 'travel', 'trip', 'vacation', 'flight', 'hotel'],
      'home improvement': ['home', 'repair', 'fix', 'maintenance', 'renovation', 'home_improvement'],
      'entertainment': ['date idea', 'date_ideas', 'concert', 'event', 'entertainment'],
      'personal': ['task', 'personal', 'appointment', 'errand'],
      'shopping': ['shopping', 'buy', 'purchase', 'store'],
      'health': ['health', 'fitness', 'exercise', 'doctor', 'medical'],
      'finance': ['finance', 'bill', 'payment', 'budget', 'money'],
      'books': ['books', 'book', 'reading', 'novel', 'author', 'literature'],
      'movies_tv': ['movies_tv', 'movie', 'movies', 'tv', 'tv show', 'tv shows', 'series', 'film', 'watch', 'streaming']
    };

    // Content-based keywords for smart matching
    const contentKeywords: Record<string, string[]> = {
      'books': ['book', 'author', 'novel', 'reading', 'chapter', 'isbn', 'publisher', 'paperback', 'hardcover', 'ebook', 'kindle'],
      'movies': ['movie', 'film', 'tv show', 'series', 'watch', 'streaming', 'netflix', 'hulu', 'disney', 'hbo', 'prime video', 'actor', 'director'],
      'recipes': ['recipe', 'cook', 'bake', 'ingredients', 'cuisine', 'dish', 'meal'],
      'music': ['song', 'album', 'artist', 'band', 'playlist', 'spotify', 'music'],
      'stocks': ['stock', 'ticker', '$', 'share', 'shares', 'invest', 'portfolio', 'market', 'trading', 'dividend', 'earnings', 'nasdaq', 'nyse', 'price target', 'buy rating', 'sell rating', 'analyst', 'ferrari', 'apple', 'amazon', 'tesla', 'nvidia', 'microsoft', 'google', 'meta'],
      'finance': ['finance', 'investment', 'crypto', 'bitcoin', 'ethereum', 'currency', 'forex', 'bond', 'etf', 'mutual fund'],
      'groceries': ['milk', 'eggs', 'bread', 'butter', 'cheese', 'chicken', 'beef', 'pork', 'fish', 'rice', 'pasta', 'flour', 'sugar', 'salt', 'pepper', 'oil', 'vinegar', 'tomato', 'potato', 'onion', 'garlic', 'lemon', 'lime', 'orange', 'apple', 'banana', 'avocado', 'lettuce', 'spinach', 'carrot', 'broccoli', 'cucumber', 'yogurt', 'cream', 'cereal', 'coffee', 'tea', 'juice', 'water', 'soda', 'beer', 'wine', 'snack', 'chips', 'crackers', 'cookies', 'fruit', 'vegetable', 'meat', 'produce', 'dairy', 'frozen', 'canned', 'sauce', 'condiment', 'spice', 'herb', 'nut', 'seed', 'grain', 'bean', 'tofu', 'soy', 'almond', 'oat']
    };

    const findOrCreateList = async (category: string, tags: string[] = [], targetList?: string, summary?: string) => {
      console.log('[findOrCreateList] Input - category:', category, 'targetList:', targetList, 'summary:', summary?.substring(0, 50));
      
      // Helper to normalize list names for comparison
      const normalizeName = (name: string): string => {
        return name.toLowerCase().trim().replace(/[_\-\s]+/g, ' ');
      };
      
      // ================================================================
      // PRIORITY 0: Direct text-to-list-name match
      // Check if any word/phrase in the original note text or summary matches a list name exactly
      // This catches cases like "LLC check account" when a list "LLC" exists
      // ================================================================
      if (existingLists && existingLists.length > 0) {
        const textToCheck = [safeText, summary, targetList].filter(Boolean).join(' ').toLowerCase();
        
        // Sort lists by name length descending so longer names are matched first
        // (prevents "Home" matching before "Home Improvement")
        const sortedLists = [...existingLists].sort((a: any, b: any) => b.name.length - a.name.length);
        
        for (const list of sortedLists) {
          const listNameLower = list.name.toLowerCase().trim();
          // Skip very generic list names that would match too broadly
          const genericNames = ['task', 'tasks', 'personal', 'general', 'other', 'misc'];
          if (genericNames.includes(listNameLower)) continue;
          
          // Check if the list name appears as a word/phrase in the text (word boundary match)
          const escapedName = listNameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const wordBoundaryRegex = new RegExp(`\\b${escapedName}\\b`, 'i');
          
          if (wordBoundaryRegex.test(textToCheck)) {
            console.log('[findOrCreateList] PRIORITY 0: Direct text-to-list match! Text contains "' + list.name + '"');
            return list.id;
          }
        }
      }
      
      // ================================================================
      // PRIORITY 1: Exact or near-exact match by category name
      // This handles "books" -> "Books" case
      // ================================================================
      if (existingLists && existingLists.length > 0) {
        const categoryNorm = normalizeName(category);
        
        // First check: exact match (case-insensitive)
        const exactMatch = existingLists.find((l: any) => normalizeName(l.name) === categoryNorm);
        if (exactMatch) {
          console.log('[findOrCreateList] Exact category match found:', exactMatch.name);
          return exactMatch.id;
        }
        
        // Second check: singular/plural variations (books/book, movies/movie)
        const singularCategory = categoryNorm.replace(/s$/, '');
        const pluralCategory = categoryNorm + 's';
        
        const singularPluralMatch = existingLists.find((l: any) => {
          const listNorm = normalizeName(l.name);
          const listSingular = listNorm.replace(/s$/, '');
          return listNorm === singularCategory || 
                 listNorm === pluralCategory || 
                 listSingular === singularCategory;
        });
        
        if (singularPluralMatch) {
          console.log('[findOrCreateList] Singular/plural match found:', singularPluralMatch.name);
          return singularPluralMatch.id;
        }
      }
      
      // ================================================================
      // PRIORITY 2: Use AI-suggested target_list if it matches an existing list
      // ================================================================
      if (targetList && existingLists && existingLists.length > 0) {
        const targetNorm = normalizeName(targetList);
        
        // Exact match first
        const exactMatch = existingLists.find((l: any) => normalizeName(l.name) === targetNorm);
        if (exactMatch) {
          console.log('[findOrCreateList] AI target_list exact match:', exactMatch.name);
          return exactMatch.id;
        }
        
        // Partial match
        const partialMatch = existingLists.find((l: any) => {
          const listNorm = normalizeName(l.name);
          return listNorm.includes(targetNorm) || targetNorm.includes(listNorm);
        });
        if (partialMatch) {
          console.log('[findOrCreateList] AI target_list partial match:', partialMatch.name);
          return partialMatch.id;
        }
      }

      // ================================================================
      // PRIORITY 3: Content-based matching - check if summary contains keywords that match a list
      // ================================================================
      if (summary && existingLists && existingLists.length > 0) {
        const summaryLower = summary.toLowerCase();
        
        for (const list of existingLists) {
          const listNameLower = normalizeName(list.name);
          
          // Check if list name is a content keyword category
          for (const [keywordCategory, keywords] of Object.entries(contentKeywords)) {
            // If the list name relates to this category
            const listMatchesCategory = keywords.some(k => listNameLower.includes(k)) || 
                                        listNameLower.includes(keywordCategory);
            
            // And the summary contains keywords from this category
            const summaryMatchesCategory = keywords.some(k => summaryLower.includes(k));
            
            if (listMatchesCategory && summaryMatchesCategory) {
              console.log('[findOrCreateList] Content-based match! Summary contains', keywordCategory, 'keywords, matched to list:', list.name);
              return list.id;
            }
          }
        }
      }

      if (!category) return null;

      // ================================================================
      // PRIORITY 4: Category-based scoring with synonym matching
      // ================================================================
      let bestMatch = null;
      let highestScore = 0;
      
      if (existingLists && existingLists.length > 0) {
        const categoryNorm = normalizeName(category);
        
        for (const list of existingLists) {
          let score = 0;
          const listNameNorm = normalizeName(list.name);
          
          // Exact match gets highest score (should already be caught above, but safety check)
          if (listNameNorm === categoryNorm) score += 15;
          
          // Check categoryMap synonyms
          Object.entries(categoryMap).forEach(([canonical, synonyms]) => {
            const normalizedSynonyms = synonyms.map(s => normalizeName(s));
            const categoryMatchesSynonyms = normalizedSynonyms.includes(categoryNorm) || 
                                            normalizedSynonyms.some(s => categoryNorm.includes(s));
            const listMatchesSynonyms = normalizedSynonyms.some(s => listNameNorm.includes(s) || s.includes(listNameNorm));
            
            if (categoryMatchesSynonyms && listMatchesSynonyms) {
              score += 10;
            }
          });
          
          // Partial match - one contains the other
          if (listNameNorm.includes(categoryNorm) || categoryNorm.includes(listNameNorm)) {
            score += 6;
          }

          // Tag-based bonus
          if (tags && tags.length > 0) {
            for (const tag of tags) {
              const tagNorm = normalizeName(tag);
              if (listNameNorm.includes(tagNorm)) {
                score += 4;
              }
            }
          }
          
          if (score > highestScore) {
            highestScore = score;
            bestMatch = list;
          }
        }
      }
      
      // Lower threshold for matching (3 instead of 5) to catch more cases
      if (bestMatch && highestScore >= 3) {
        console.log('[findOrCreateList] Category match found:', bestMatch.name, 'score:', highestScore);
        return bestMatch.id;
      }
      
      // ================================================================
      // PRIORITY 4.5: Content-based category override for new list creation
      // If the summary/text contains common grocery items but AI said "personal",
      // override to "groceries" so the right list gets created
      // ================================================================
      const textForOverride = [safeText, summary].filter(Boolean).join(' ').toLowerCase();
      const groceryKeywords = contentKeywords['groceries'] || [];
      const groceryMatchCount = groceryKeywords.filter(kw => {
        const regex = new RegExp(`\\b${kw}\\b`, 'i');
        return regex.test(textForOverride);
      }).length;
      
      let effectiveCategory = category;
      if (groceryMatchCount >= 1 && normalizeName(category) !== 'groceries') {
        console.log('[findOrCreateList] Content override: detected', groceryMatchCount, 'grocery keywords, overriding category from', category, 'to groceries');
        effectiveCategory = 'groceries';
      }

      // ================================================================
      // PRIORITY 5: Create new list only if no match found
      // ================================================================
      const listName = effectiveCategory
        .replace(/_/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      
      // FINAL SAFETY CHECK: Double-check we're not creating a duplicate
      if (existingLists && existingLists.length > 0) {
        const finalCheck = existingLists.find((l: any) => 
          normalizeName(l.name) === normalizeName(listName)
        );
        if (finalCheck) {
          console.log('[findOrCreateList] Final safety check caught duplicate, using:', finalCheck.name);
          return finalCheck.id;
        }
      }
      
      console.log('[findOrCreateList] No match found, creating new list:', listName);
      
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
        
        // Add to existingLists cache so subsequent notes in the same batch don't create duplicates
        if (existingLists) {
          existingLists.push(newList);
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
        // Get the summary first, with fallback to text or media
        let summary = note.summary || safeText;
        
        // Normalize generic summaries - replace with media content if available
        if (isGenericSummary(summary) && mediaDescriptions.length > 0) {
          console.log('[process-note] Replacing generic summary:', summary, '-> deriving from media');
          summary = deriveSummaryFromMedia(mediaDescriptions);
        } else if (!summary || summary.trim() === '') {
          summary = mediaDescriptions.length > 0 
            ? deriveSummaryFromMedia(mediaDescriptions) 
            : 'Saved note';
        }

        // Now find/create list with all context: category, tags, AI's target_list, and the summary for content matching
        const listId = note.category 
          ? await findOrCreateList(note.category, note.tags || [], note.target_list, summary) 
          : null;
        
        return {
          summary,
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
          original_text: safeText,
          media_urls: mediaUrls.length > 0 ? mediaUrls : null
        };
      })
    );

    const isMultiple = processedResponse.multiple === true || notes.length > 1;

    // Build the base result
    let result: any = isMultiple
      ? { multiple: true, notes: processedNotes, original_text: safeText, media_urls: mediaUrls.length > 0 ? mediaUrls : null }
      : { ...processedNotes[0], original_text: safeText };

    // Include receipt processing results if a receipt was detected and processed
    if (receiptProcessingResult && receiptProcessingResult.success) {
      result.receipt_processed = true;
      result.receipt = {
        transaction_id: receiptProcessingResult.transaction?.id,
        merchant: receiptProcessingResult.transaction?.merchant,
        amount: receiptProcessingResult.transaction?.amount,
        category: receiptProcessingResult.transaction?.category,
        date: receiptProcessingResult.transaction?.date,
      };
      if (receiptProcessingResult.alert) {
        result.budget_alert = {
          triggered: true,
          message: receiptProcessingResult.message,
        };
      }
    }

    console.log('[GenAI SDK] Final result:', result);

    // Auto-extract memories from brain-dump (async, non-blocking) - only if there's actual text
    if (safeText.trim()) {
      extractMemoriesFromDump(genai, supabase, safeText, user_id).catch(err => {
        console.warn('[Memory Extraction] Non-blocking error:', err);
      });
    }

    // Auto-save any URLs found in the note text (async, non-blocking)
    const extractedUrls = extractUrls(safeText);
    if (extractedUrls.length > 0) {
      console.log('[process-note] Found', extractedUrls.length, 'URLs in note text');
      saveExtractedLinks(supabase, extractedUrls, user_id, couple_id).catch(err => {
        console.warn('[Link Extraction] Non-blocking error:', err);
      });
    }

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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai@1.0.0";
import { encryptNoteFields, isEncryptionAvailable } from "../_shared/encryption.ts";
import { resilientGenerateContent } from "../_shared/resilient-genai.ts";
import { detectAndCreateExpense, detectCurrency, extractAmount, mapCategoryToExpenseCategory } from "../_shared/expense-detector.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// resilientGenerateContent is now imported from _shared/resilient-genai.ts

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

// ============================================================================
// AUTO-ADD TO GOOGLE CALENDAR (delegates to separate edge function)
// ============================================================================

async function autoAddToCalendar(
  supabase: SupabaseClient,
  result: any,
  userId: string
): Promise<void> {
  const notes = result.multiple && result.notes ? result.notes : [result];
  const calendarWorthy = notes.filter((n: any) => n.due_date || n.reminder_time);
  if (calendarWorthy.length === 0) return;

  console.log('[Auto Calendar] Delegating', calendarWorthy.length, 'notes to auto-calendar-event');
  
  const { error } = await supabase.functions.invoke('auto-calendar-event', {
    body: { user_id: userId, notes: calendarWorthy }
  });

  if (error) {
    console.warn('[Auto Calendar] Invocation error:', error);
  }
}

// ============================================================================
// EXPENSE DETECTION & AUTO-CREATION
// ============================================================================

// Expense detection functions (detectCurrency, extractAmount, mapCategoryToExpenseCategory,
// detectAndCreateExpense) are imported from _shared/expense-detector.ts

// Define the JSON schema for structured output
const singleNoteSchema = {
  type: Type.OBJECT,
  properties: {
    summary: { 
      type: Type.STRING, 
      description: "Concise title (max 100 chars). Extract the MAIN entity name. For PRODUCTS: use exact brand + model (e.g., 'Apple Watch Ultra 2', 'Sony WH-1000XM5'). For restaurants: 'Restaurant Name'. For appointments: 'Doctor Appointment'. For books: 'Book Title'. For links: extract the business/entity name. NEVER use generic category prefixes like 'PRODUCTS:' or 'SHOPPING:' as the summary." 
    },
    category: { 
      type: Type.STRING, 
      description: "Category using lowercase with underscores. Choose the MOST SPECIFIC domain category. COMMON categories: health, entertainment, date_ideas, home_improvement, travel, groceries, shopping, personal, books, movies_tv, finance, work, recipes, gift_ideas. BUT you are NOT limited to these — if the content fits a domain not listed (e.g., real_estate, networking, childcare, pets, automotive, education, legal, photography, gardening, spirituality, volunteering, sports, music, art, technology, gaming, parenting), CREATE a new category using lowercase_underscore format. 'task' is ONLY for truly generic to-do items with no domain. NEVER default to 'task' when a specific domain exists." 
    },
    target_list: {
      type: Type.STRING,
      nullable: true,
      description: "CRITICAL: Match to an existing user list name. ALWAYS check the provided list names and set this to the EXACT name of the best-matching list. For example: health content → 'Health' list, travel content → 'Travel' list, book → 'Books' list. Only leave null if absolutely no list matches."
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
      description: "Person's name the task is assigned to. Look for patterns like '[name] check/do/buy...', 'tell [name] to...', '[name] should...'. If both partner names appear, the FIRST name mentioned is usually the person who should DO the task. Use the exact name as provided in the couple context." 
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
  // CRITICAL: Use word-boundary (\b) to prevent matching partial words
  // e.g., "Sofa" must NOT match "so", "Oklahoma" must NOT match "ok"
  const hasGreetings = /^(hey|hi|hello|yo|so|ok|okay|well)\b/i.test(text.trim());
  const hasFillerWords = /\b(i think|maybe|probably|might|was thinking|need to|have to|gotta|gonna)\b/i.test(text);
  const hasConversationalMarkers = /\b(and also|by the way|oh and|btw|also|actually)\b/i.test(text);
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
  // CRITICAL: Use word-boundary (\b) to prevent stripping partial words
  // e.g., "Sofa" must NOT have "So" stripped, "Hello world" → "world" is OK
  let cleaned = text
    .replace(/^(hey|hi|hello|yo|so|ok|okay|well)\b[,\s]*/i, '')
    .replace(/\bi (think|guess|suppose|believe)\s+/gi, '')
    .replace(/\b(maybe|probably|might)\s+/gi, '')
    .replace(/\bwas (thinking|wondering)\s+(about\s+)?/gi, '')
    .replace(/\b(need to|have to|gotta|gonna)\b/gi, 'should')
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
  let cleaned = raw.replace(/^\[.*?\]\s*/, '').trim();
  
  if (!cleaned) {
    return 'Saved media';
  }
  
  // Strip category label prefixes that Gemini sometimes produces
  // e.g., "PRODUCTS:", "APPOINTMENT:", "BUSINESS:", "BOOK:", "EVENT:"
  cleaned = cleaned.replace(/^(PRODUCTS?|APPOINTMENTS?|BUSINESS|BOOKS?|EVENTS?|CONTACTS?|RECEIPTS?|PROMO\s*CODES?|HANDWRITTEN)\s*[:—–-]\s*/i, '').trim();
  
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

0. **HANDWRITTEN TEXT / STICKY NOTES / WHITEBOARDS / MEETING NOTES — HIGHEST PRIORITY**:
   If media content starts with "HANDWRITTEN:" or contains transcribed handwritten text:
   
   a. **APPOINTMENTS** (contains words like "appt", "appointment", "doctor", "dentist", "meeting at"):
      - Summary: "[Type] Appointment" (e.g., "Doctor Appointment")
      - Category: "health" for medical, "personal" for others
      - **CRITICAL**: Extract date/time references ("tomorrow", "4 PM", "March 6") and compute due_date + reminder_time
      - Items: ["Time: [extracted time]", "Date: [extracted date]", "Location: [if any]", "Notes: [additional details]"]
      - Priority: "high" for medical/urgent, "medium" otherwise
   
   b. **MEETING NOTES / BRAINSTORMING** (contains bullet points, arrows, multiple ideas):
      - If user caption provides context (e.g., "Oura notes for interview"), use it for the summary
      - Summary: Use the caption context or a descriptive title (NOT "whiteboard notes")
      - Items: Extract EACH distinct point, bullet, or idea as a separate item
      - For content with arrows (→), preserve as "Label → Value" format in items
      - Category: "task" or match to user's lists based on caption context
      - If caption mentions a company/project name, use that for list routing via target_list
   
   c. **TO-DO LISTS** (contains checkboxes, numbered items, "buy", "do", "call"):
      - Create MULTIPLE separate notes (set multiple:true) — one per item
      - Each note gets its own summary, category, and appropriate due_date
   
   d. **GENERAL HANDWRITTEN NOTES**:
      - Summary: First meaningful phrase or sentence from the handwriting
      - Items: All additional lines/points as separate items
      - Category: Infer from content or use "personal"

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

4. **Events/Tickets/Nightlife/Shows**: 
    - Summary: "[Event name] at [Venue]" or "[Event name]"
    - Items: ["Venue: [VENUE]", "Date: [DATE]", "Time: [TIME]", "Tickets: [info]", "Price: [COST]", "DJ: [name]", "Happy Hour: [details]"]
    - Category: "entertainment" — this includes karaoke nights, DJ events, happy hours, concerts, comedy shows, festivals, sports events, trivia nights, live music, themed nights, club events, bar promotions
    - NEVER categorize entertainment/events as "task" — if it's something fun to attend or an event/promotion at a venue, it's "entertainment"

4b. **TRAVEL DOCUMENTS (Flight itineraries, boarding passes, train tickets, hotel bookings)**:
    - Summary: "[Airline/Carrier] [Origin] → [Destination]" (e.g., "Air Nostrum Madrid → Bologna")
    - Items: ["Flight: [number]", "Date: [date]", "Departure: [time] from [airport/terminal]", "Arrival: [time] at [airport]", "Passenger: [name]", "Cabin: [class]", "Seat: [if assigned]", "Booking Ref: [PNR]"]
    - Category: ALWAYS "travel" — flight itineraries, boarding passes, train tickets, hotel confirmations, car rental confirmations are ALWAYS travel
    - NEVER categorize travel documents as "task" or "personal" — they are travel planning/reference items
    - Set due_date to the travel date
    - Priority: "high" if travel date is within 7 days, "medium" otherwise

5. **Books**:
    - Summary: "[Book Title]" or "[Book Title] by [Author]"
   - Items: ["Author: [NAME]", "ISBN: [NUMBER]", "Publisher: [NAME]"]
   - Category: "books"
   - target_list: match to Books list if exists

CRITICAL RULES:
- If user text is vague ("save this", "remember"), use ALL media content to create summary AND populate items with extracted details.
- If user caption provides CONTEXT (e.g., "Oura notes for interview", "meeting notes from standup"), the summary MUST incorporate the user's exact keywords/phrases. The caption IS the user's intent — the extracted content provides supporting details for items/sub-items only.
- NEVER produce generic summaries like "WHITEBOARD NOTES" or "APPOINTMENTS:" — always include the SPECIFIC content from the handwriting.
- When a caption says "X for Y" (e.g., "notes for Oura interview"), the summary should be something like "Oura Interview Notes", NOT a description of the document contents.`;
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

  // Build existing lists section with rich context for intelligent routing
  let listsSection = '';
  if (existingListNames.length > 0) {
    listsSection = `\n\n**USER'S EXISTING LISTS**: ${existingListNames.join(', ')}

**LIST ROUTING RULES (CRITICAL - FOLLOW IN THIS EXACT ORDER)**:
1. **DIRECT NAME MATCH**: If any word or phrase in the note text EXACTLY matches an existing list name (case-insensitive), set target_list to that list name. Example: Note "LLC check business account" + list "LLC" exists → target_list: "LLC"
2. **SEMANTIC MATCH**: If the note's content is semantically related to an existing list name, ALWAYS route to that list via target_list. Examples:
   - Note about supplements/vitamins + list "Health" exists → target_list: "Health"
   - Note about a flight + list "Travel" exists → target_list: "Travel"  
   - Note about a book + list "Books" exists → target_list: "Books"
   - Note about a recipe + list "Recipes" exists → target_list: "Recipes"
3. **Memory-based routing**: If user memories specify routing preferences, ALWAYS follow them
4. **NEW DOMAIN CATEGORY**: If no existing list matches AND the content clearly belongs to a specific domain, use a descriptive lowercase_underscore category (e.g., "real_estate", "childcare", "pets", "automotive", "gardening"). The system will auto-create a new list. You are NOT limited to predefined categories — Olive adapts to each user's unique life.
5. **"task" is LAST RESORT**: Only use category "task" for truly generic to-do items that don't fit ANY domain category. If in doubt, choose or invent a domain category.

**ANTI-PATTERN**: Do NOT classify domain-specific content as "task". A supplement schedule is "health". A movie recommendation is "movies_tv". A restaurant is "date_ideas". A property listing is "real_estate". A babysitter contact is "childcare". "task" means ONLY "a generic action item with no domain."`;
  }

  return `You're Olive, an AI assistant organizing tasks for couples. Process raw text into structured notes.

USER TIMEZONE: ${userTimezone}
Current UTC time: ${utcTime}
${styleGuidance}
${memorySection}

IMPORTANT: When calculating times, use the user's timezone (${userTimezone}), not UTC.
- "tomorrow at 10am" means 10am in ${userTimezone}, convert to UTC ISO format for storage
${mediaContext}

SPLIT CRITERIA — CRITICAL: You MUST create SEPARATE notes when input contains:
- **Numbered lists**: "1. Buy milk 2. Call doctor 3. Book restaurant" → 3 notes
- **Bullet points or dashes**: "- buy milk\n- call doctor" → 2 notes  
- **Comma-separated distinct tasks**: "buy milk, call doctor, book restaurant" → 3 notes
- **"and" joining distinct tasks**: "buy milk and call doctor" → 2 notes (different actions)
- **"and" joining distinct recipients/targets**: "reply to RoasterCup and to Meze Labs" → 2 notes (one per recipient, each gets the SAME action verb with their specific target as the summary)
- **Each grocery item**: "groceries: milk, eggs, bread" → 3 separate notes (one per item)
- **Multi-line tasks**: Each line with a distinct task → separate note per line

DO NOT MERGE distinct tasks into one note with items array. Each task gets its OWN note.
The items array is for SUB-DETAILS of a SINGLE task (e.g., phone, address, time), NOT for separate tasks.

SINGLE NOTE cases (do NOT split):
- "fix the sink" → 1 note (single task)
- "doctor appointment at 3pm tomorrow" → 1 note (single task with details)
- "Sofa measures: 118 width, 60 long" → 1 note (measurements are details, not separate tasks)

SUMMARY CLEANING RULES — CRITICAL:
- NEVER start summary with a generic category prefix (e.g., "Work reply on..." → just "Reply to [recipient] on LinkedIn")
- Keep summaries ACTIONABLE and CLEAN: verb + target (e.g., "Reply to RoasterCup on LinkedIn")
- Remove filler words like "work", "personal" from the beginning of summaries — let the category field handle classification

CORE FIELD RULES:
1. summary: Concise title (max 100 chars) - EXTRACT THE MAIN ENTITY NAME
   - Groceries: item name only ("milk" not "buy milk")
   - Actions: keep verb ("fix sink")
   - **Links/URLs**: Extract the business/entity name from the URL or context (e.g., "Nobu Restaurant" not "restaurant link")
   - **Appointments**: Type + provider if known ("Doctor Appointment" or "Dr. Smith Appointment")
   - For media with promo codes: "[Brand] promo code: [CODE] - [DISCOUNT]"

 2. category: Use lowercase with underscores
    
    **INTENT-FIRST RULE (HIGHEST PRIORITY)**:
    When the user's primary intent is an ACTION verb (cancel, return, call, schedule, book, reschedule, pay, refund, exchange, fix, repair, renew, update, check, follow up, confirm, remind), the category MUST be "task" or "personal" — NOT the domain category of the noun.
    Examples:
    - "cancel restaurant booking" → "task" (NOT "date_ideas" — the intent is to CANCEL, not to plan a date)
    - "return Amazon package" → "task" (NOT "shopping" — the intent is a to-do action)
    - "call dentist to reschedule" → "task" (NOT "health" — it's an action item)
    - "pay electricity bill" → "personal" (action: pay a bill)
    - "book flight to Rome" → "travel" (exception: booking travel IS travel planning)
    - "fix leaking faucet" → "home_improvement" (exception: fixing IS the domain action)
    
    **DOCUMENT-TYPE OVERRIDE (applies BEFORE intent-first rule for media/images)**:
    - If the attached media is a FLIGHT ITINERARY, BOARDING PASS, TRAIN TICKET, HOTEL CONFIRMATION, or any travel booking document → ALWAYS "travel", regardless of any action verbs
    - If the media shows a TRAVEL DOCUMENT with airline names, flight numbers, airport codes, departure/arrival times → ALWAYS "travel"
    
    **DOMAIN RULES (apply only when intent is NOT an action/to-do)**:
    - concerts/events/shows/karaoke/DJ nights/happy hours/festivals/live music/comedy/sports events/trivia/nightlife/themed nights/bar promotions → "entertainment"
    - restaurants/dinner plans (SAVING a restaurant, NOT canceling/calling one) → "date_ideas"
    - repairs/fix/maintenance → "home_improvement"
    - vacation/flights/hotels/booking travel/flight itineraries/boarding passes/train tickets → "travel"
    - groceries/supermarket → "groceries"
    - clothes/electronics/promo codes → "shopping"
    - appointments/bills/rent → "personal"
    - books/reading → "books"
    - movies/tv shows/series → "movies_tv"
    - medical/doctor/dentist (saving info, not calling to cancel), supplements, vitamins, medication schedules, dosage plans, wellness routines, fitness logs, nutrition → "health"
    - **SUPPLEMENT/VITAMIN SCHEDULES**: Notes listing which supplements to take on which days (e.g., "Sunday = lion's mane, Monday = vit C") are ALWAYS "health", NEVER "task"
    
    **DISAMBIGUATION RULE**: When an image/media shows an event poster, flyer, bar sign, or venue promotion → ALWAYS "entertainment", NEVER "task". Event flyers with drink specials, DJ names, or event schedules are entertainment content.

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

// ============================================================================
// DETERMINISTIC MULTI-ITEM DETECTION
// ============================================================================

/**
 * Detects clearly structured multi-item input (numbered lists, bullet points,
 * newline-separated tasks) and returns individual items for separate processing.
 * Returns null if the input doesn't contain a clear multi-item structure.
 */
function detectMultiItemInput(text: string): string[] | null {
  if (!text || text.length < 10) return null;
  
  const trimmed = text.trim();
  
  // Pattern 1: Numbered lists — "1. Buy milk 2. Call doctor 3. Book restaurant"
  // Also handles "1) Buy milk 2) Call doctor"
  const numberedPattern = /(?:^|\n)\s*\d+[\.\)]\s+/;
  if (numberedPattern.test(trimmed)) {
    const items = trimmed
      .split(/(?:^|\n)\s*\d+[\.\)]\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    if (items.length >= 2) {
      console.log('[MultiItemDetect] Numbered list detected:', items.length, 'items');
      return items;
    }
  }
  
  // Pattern 2: Bullet points — "- Buy milk\n- Call doctor" or "• Buy milk\n• Call doctor"
  const bulletPattern = /(?:^|\n)\s*[-•*]\s+/;
  if (bulletPattern.test(trimmed)) {
    const items = trimmed
      .split(/(?:^|\n)\s*[-•*]\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    if (items.length >= 2) {
      console.log('[MultiItemDetect] Bullet list detected:', items.length, 'items');
      return items;
    }
  }
  
  // Pattern 3: Newline-separated distinct tasks (each line is a separate task)
  // Only trigger if 2+ lines, each reasonably short (to avoid splitting paragraphs)
  const lines = trimmed.split(/\n+/).map(s => s.trim()).filter(s => s.length > 0);
  if (lines.length >= 2 && lines.every(l => l.length < 120)) {
    const avgLen = lines.reduce((sum, l) => sum + l.length, 0) / lines.length;
    if (avgLen < 80) {
      console.log('[MultiItemDetect] Multi-line tasks detected:', lines.length, 'items');
      return lines;
    }
  }
  
  // Pattern 4: Comma-separated distinct tasks — "buy milk, call doctor, book restaurant"
  // Only split if 3+ segments and they look like distinct actions (contain verbs or are short phrases)
  if (trimmed.includes(',') && !trimmed.includes('\n')) {
    const segments = trimmed.split(/,\s*/).map(s => s.trim()).filter(s => s.length > 2);
    if (segments.length >= 3 && segments.every(s => s.length < 80)) {
      // Verify they look like distinct tasks, not a single sentence with commas
      // Check if most segments start with a verb or are short noun phrases
      const actionVerbs = /^(buy|get|call|book|pick|fix|send|pay|check|schedule|cancel|return|order|clean|wash|remind|update|find|research|plan|make|cook|prepare|organize|sort|arrange|set up|follow up|renew|register|sign up|drop off|pick up)/i;
      const verbCount = segments.filter(s => actionVerbs.test(s)).length;
      // If at least half start with verbs, or all are short (<30 chars each), treat as multi-item
      if (verbCount >= segments.length * 0.5 || segments.every(s => s.length < 30)) {
        console.log('[MultiItemDetect] Comma-separated tasks detected:', segments.length, 'items');
        return segments;
      }
    }
  }
  
  // Pattern 5: "and"-conjunction splitting for distinct actions
  // "buy milk and call doctor and book restaurant"
  // Only when "and" joins clearly different action phrases
  if (/\band\b/i.test(trimmed) && !trimmed.includes(',') && !trimmed.includes('\n')) {
    const andSegments = trimmed.split(/\s+and\s+/i).map(s => s.trim()).filter(s => s.length > 2);
    if (andSegments.length >= 2 && andSegments.length <= 5) {
      const actionVerbs = /^(buy|get|call|book|pick|fix|send|pay|check|schedule|cancel|return|order|clean|wash|remind|update|find|research|plan|make|cook|prepare)/i;
      const verbCount = andSegments.filter(s => actionVerbs.test(s)).length;
      // Only split if most segments start with action verbs (indicates distinct tasks)
      if (verbCount >= andSegments.length * 0.7) {
        console.log('[MultiItemDetect] And-conjunction tasks detected:', andSegments.length, 'items');
        return andSegments;
      }
    }
  }
  
  return null;
}


async function transcribeAudioWithElevenLabs(audioUrl: string): Promise<string> {
  const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
  
  if (!ELEVENLABS_API_KEY) {
    console.warn('[ElevenLabs] API key not configured, skipping transcription');
    return '';
  }

  try {
    console.log('[ElevenLabs] Downloading audio from:', audioUrl);
    
    // Download with 30s timeout to prevent hanging
    const downloadCtrl = new AbortController();
    const downloadTimeout = setTimeout(() => downloadCtrl.abort(), 30000);
    const audioResponse = await fetch(audioUrl, { signal: downloadCtrl.signal });
    clearTimeout(downloadTimeout);
    if (!audioResponse.ok) {
      console.error('[ElevenLabs] Failed to download audio:', audioResponse.status);
      return '';
    }
    
    const audioBlob = await audioResponse.blob();
    console.log('[ElevenLabs] Audio downloaded, size:', audioBlob.size, 'type:', audioBlob.type);
    
    // Prepare form data for ElevenLabs
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model_id', 'scribe_v2');
    // Don't hardcode language — let ElevenLabs auto-detect for multilingual support
    
    console.log('[ElevenLabs] Sending to transcription API...');
    
    const transcribeCtrl = new AbortController();
    const transcribeTimeout = setTimeout(() => transcribeCtrl.abort(), 30000);
    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: formData,
      signal: transcribeCtrl.signal,
    });
    clearTimeout(transcribeTimeout);
    
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
      model: "gemini-2.5-flash-lite", // Lite: simple binary receipt detection
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
    
    // Download the image with 30s timeout
    const imgCtrl = new AbortController();
    const imgTimeout = setTimeout(() => imgCtrl.abort(), 30000);
    const imageResponse = await fetch(imageUrl, { signal: imgCtrl.signal });
    clearTimeout(imgTimeout);
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
    const extractionPrompt = `Analyze this image and extract ALL useful information with MAXIMUM detail. Be thorough and specific.

**HANDWRITTEN TEXT / STICKY NOTES / WHITEBOARDS / MEETING NOTES — TOP PRIORITY:**
- Perform careful OCR on ALL handwritten text, even if messy or partial
- Preserve the EXACT words written, do not paraphrase
- If dates or times are written (e.g., "tomorrow", "4 PM", "March 6"), extract them explicitly as "Date: ..." and "Time: ..."
- If it looks like an appointment or event (e.g., "Doctor appt tomorrow 4pm"), format as:
  "APPOINTMENT: [Type] | Date: [date] | Time: [time] | Location: [if any]"
- If it contains bullet points or multiple items (meeting notes, to-do list), extract EACH item on a separate line prefixed with "• "
- If it contains action items or next steps, prefix each with "ACTION: "
- For whiteboard/brainstorm content, preserve the structure: headings, arrows (→), groupings
- Format: Start with "HANDWRITTEN:" followed by the full transcribed content
- NEVER summarize handwritten text generically as "whiteboard notes" or "sticky note" — always transcribe the ACTUAL content

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

**PRODUCTS / ELECTRONICS / PHYSICAL OBJECTS — CRITICAL:**
- This is a PHOTO of a real-world product or object. Identify the SPECIFIC product.
- Product Name: Use the exact brand + model name (e.g., "Apple Watch Series 10", "Sony WH-1000XM5", "Nike Air Max 90")
- If the brand/logo is visible, ALWAYS include it
- If the model/version is visible or identifiable, ALWAYS include it
- Price: Include if visible on a tag or screen
- Color/variant: Note the specific color or variant shown
- Format: Start with the specific product name as the PRIMARY subject, e.g., "Apple Watch Ultra 2"
- NEVER use generic labels like "PRODUCTS:" or "a smartwatch" when the brand is clearly identifiable
- NEVER start with "PRODUCTS:" as a prefix — just state the product name directly

**PROMO CODES/COUPONS:**
- Code, discount amount, expiration date, conditions

**APPOINTMENTS:**
- Provider name, specialty, date, time, location, phone

**EVENTS:**
- Event name, venue, date, time, ticket info, price

**TRAVEL DOCUMENTS / FLIGHT ITINERARIES / BOARDING PASSES / TRAIN TICKETS — CRITICAL:**
- This is a TRAVEL DOCUMENT. Start with "TRAVEL:" prefix.
- Airline/Carrier name (e.g., "Air Nostrum", "Ryanair", "Iberia")
- Flight number (e.g., "IB1237")
- Departure: Airport code + City + Terminal (e.g., "MAD - Madrid, Terminal 4")
- Arrival: Airport code + City (e.g., "BLQ - Bologna")
- Date and Time of departure and arrival
- Passenger name
- Booking reference / PNR
- Seat, Cabin class
- Connection details if multi-leg
- For train tickets: Train number, station names, platform
- Format: "TRAVEL: [Airline/Carrier] [Flight/Train #] [Origin] → [Destination] on [Date]"

**RECEIPTS:**
- Store name, items, amounts, date

**CONTACT INFO:**
- Phone numbers, emails, websites, social media handles

FORMAT YOUR RESPONSE AS STRUCTURED DATA with the PRIMARY SUBJECT clearly identified first.
For HANDWRITTEN content: Start with "HANDWRITTEN:" and transcribe ALL text verbatim
For STOCKS: Start with "[TICKER] [COMPANY] - [PRICE]"
For SOCIAL MEDIA about stocks: Start with the stock ticker(s) and company name(s)
For PRODUCTS: Start with the EXACT product name (e.g., "Apple Watch Ultra 2" or "Sony WH-1000XM5"). NEVER prefix with "PRODUCTS:" — just state the name directly.
For TRAVEL documents: Start with "TRAVEL:" followed by carrier and route (e.g., "TRAVEL: Air Nostrum IB1237 Madrid → Bologna on 7 March 2026")
For other content types, start with the MAIN SUBJECT clearly identified.

CRITICAL: Extract EVERY piece of visible information. Be specific and complete. Never return generic labels like "whiteboard notes", "sticky note", or "PRODUCTS:" - extract the ACTUAL content, brand, model, or product name.
Max 500 words.`;


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
        maxOutputTokens: 800
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

// Analyze image using pre-downloaded base64 data (avoids re-downloading)
async function analyzeImageWithGeminiFromBase64(genai: GoogleGenAI, base64Image: string, mimeType: string): Promise<string> {
  try {
    console.log('[Gemini Vision] Analyzing image from base64, type:', mimeType);
    
    const extractionPrompt = `Analyze this image and extract ALL useful information with MAXIMUM detail. Be thorough and specific.

**HANDWRITTEN TEXT / STICKY NOTES / WHITEBOARDS / MEETING NOTES — TOP PRIORITY:**
- Perform careful OCR on ALL handwritten text, even if messy or partial
- Preserve the EXACT words written, do not paraphrase
- Format: Start with "HANDWRITTEN:" followed by the full transcribed content

**BUSINESS/LOCATION PAGES**: Extract name, phone, website, address, hours, rating, reviews, price level, cuisine, amenities.
**PRODUCTS**: Use exact brand + model name. NEVER prefix with "PRODUCTS:".
**TRAVEL DOCUMENTS**: Start with "TRAVEL:" prefix. Extract carrier, flight number, route, dates, passenger.
**RECEIPTS**: Store name, items, amounts, date.
**PROMO CODES**: Code, discount, expiration, conditions.
**EVENTS**: Name, venue, date, time, tickets, price.

CRITICAL: Extract EVERY piece of visible information. Be specific and complete.
Max 500 words.`;

    const response = await genai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: extractionPrompt },
            { inlineData: { mimeType, data: base64Image } }
          ]
        }
      ],
      config: {
        temperature: 0.1,
        maxOutputTokens: 800
      }
    });
    
    const description = response.text || '';
    console.log('[Gemini Vision] Base64 analysis result:', description.substring(0, 200));
    return description;
  } catch (error) {
    console.error('[Gemini Vision] Error analyzing base64 image:', error);
    return '';
  }
}

// Analyze video using Gemini's native multimodal video understanding
async function analyzeVideoWithGemini(genai: GoogleGenAI, videoUrl: string): Promise<string> {
  try {
    console.log('[Gemini Video] Analyzing video:', videoUrl);

    // Download the video file with 45s timeout (videos are larger)
    const vidCtrl = new AbortController();
    const vidTimeout = setTimeout(() => vidCtrl.abort(), 45000);
    const videoResponse = await fetch(videoUrl, { signal: vidCtrl.signal });
    clearTimeout(vidTimeout);
    if (!videoResponse.ok) {
      console.error('[Gemini Video] Failed to download video:', videoResponse.status);
      return '';
    }

    const videoBlob = await videoResponse.blob();
    const videoSizeBytes = videoBlob.size;
    const videoSizeMB = videoSizeBytes / (1024 * 1024);
    console.log('[Gemini Video] Video downloaded, size:', videoSizeMB.toFixed(1), 'MB, type:', videoBlob.type);

    // Gemini inline data limit is ~20MB. Skip huge files.
    if (videoSizeMB > 18) {
      console.warn('[Gemini Video] Video too large for inline analysis:', videoSizeMB.toFixed(1), 'MB');
      return '';
    }

    const arrayBuffer = await videoBlob.arrayBuffer();
    const base64Video = arrayBufferToBase64(arrayBuffer);
    const mimeType = videoBlob.type || 'video/mp4';

    const extractionPrompt = `Analyze this video thoroughly and extract ALL useful information. Consider BOTH visual content and any spoken audio/narration.

**VISUAL CONTENT:**
- Describe what is shown: scenes, objects, text overlays, UI screenshots, products, locations
- If there are text overlays, titles, or captions — transcribe them VERBATIM
- If it shows a product, brand, app, or website — identify it specifically
- If it shows a recipe, tutorial, or how-to — extract the steps
- If it shows a place, restaurant, or event — identify name, location, details

**AUDIO/SPEECH:**
- If there is narration or dialogue, transcribe the key points
- If there is a song or music, identify it if possible
- If someone gives instructions or recommendations, capture them

**SOCIAL MEDIA / REEL / STORY:**
- If this is a social media clip (Instagram Reel, TikTok, YouTube Short):
  - What is the main topic or recommendation?
  - Any products, places, books, movies mentioned?
  - Any links, handles, or references?

**ACTIONABLE ITEMS:**
- If the video contains recommendations, tips, or to-dos, list them as actionable items
- If it mentions dates, events, or appointments, extract them with "Date:" and "Time:" prefixes

Start with the PRIMARY subject clearly identified. Be specific and extract actual content, not generic descriptions.
Max 500 words.`;

    const response = await genai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: extractionPrompt },
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Video
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
    console.log('[Gemini Video] Analysis result:', description.substring(0, 300));

    return description;
  } catch (error) {
    console.error('[Gemini Video] Error analyzing video:', error);
    return '';
  }
}

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
    
    // Download the PDF with 30s timeout
    const pdfCtrl = new AbortController();
    const pdfTimeout = setTimeout(() => pdfCtrl.abort(), 30000);
    const pdfResponse = await fetch(pdfUrl, { signal: pdfCtrl.signal });
    clearTimeout(pdfTimeout);
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

    const response = await resilientGenerateContent(
      genai,
      {
        model: "gemini-2.5-flash-lite",  // Lite: simple fact extraction doesn't need full model
        contents: extractionPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: memoryExtractionSchema,
          temperature: 0.1,
          maxOutputTokens: 500
        }
      },
      { maxRetries: 1, fallbackModels: [] }  // 1 retry, no fallback — this is non-critical
    );

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

// ============================================================================
// OLIVE-MEMORY FLUSH: Persist facts to the compiled knowledge system
// ============================================================================
async function flushToOliveMemory(
  supabase: any,
  originalText: string,
  processedResult: any,
  userId: string,
) {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');

    // Build a compact representation of what was captured
    const summary = processedResult.summary || originalText.slice(0, 200);
    const category = processedResult.category || 'personal';
    const items = (processedResult.items || []).map((i: any) =>
      typeof i === 'string' ? i : i.text || i.content || JSON.stringify(i)
    );

    const conversationText = [
      `Note captured (${category}): ${summary}`,
      items.length > 0 ? `Items: ${items.join('; ')}` : '',
      processedResult.tags?.length > 0 ? `Tags: ${processedResult.tags.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    // Call olive-memory edge function with flush_context action
    const response = await fetch(`${SUPABASE_URL}/functions/v1/olive-memory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({
        action: 'flush_context',
        user_id: userId,
        conversation: conversationText,
        source: 'process-note',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn('[Olive Memory Flush] Response not OK:', response.status, text);
      return;
    }

    const data = await response.json();
    if (data.success && data.extracted > 0) {
      console.log(`[Olive Memory Flush] Extracted ${data.extracted} facts from note`);
    }
  } catch (error) {
    console.error('[Olive Memory Flush] Error:', error);
  }
}

// ============================================================================
// KNOWLEDGE EXTRACTION: Extract entities and relationships for the knowledge graph
// Calls olive-knowledge-extract edge function (Phase 1)
// ============================================================================
async function extractKnowledge(
  supabase: any,
  processedResult: any,
  originalText: string,
  userId: string,
  coupleId?: string,
) {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');

    // Only call if the edge function exists (deployed)
    const response = await fetch(`${SUPABASE_URL}/functions/v1/olive-knowledge-extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({
        user_id: userId,
        couple_id: coupleId || null,
        original_text: originalText,
        summary: processedResult.summary || null,
        category: processedResult.category || null,
        items: processedResult.items || [],
        tags: processedResult.tags || [],
        note_id: processedResult.id || null,
      }),
    });

    if (response.status === 404) {
      // Edge function not deployed yet — silently skip
      return;
    }

    if (!response.ok) {
      const text = await response.text();
      console.warn('[Knowledge Extract] Response not OK:', response.status, text);
      return;
    }

    const data = await response.json();
    if (data.success) {
      console.log(`[Knowledge Extract] Extracted ${data.entities_count || 0} entities, ${data.relationships_count || 0} relationships`);
      
      // Trigger community detection asynchronously if we have enough entities
      if ((data.entities_count || 0) >= 3) {
        fetch(`${SUPABASE_URL}/functions/v1/olive-community-detect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({ user_id: userId, couple_id: coupleId || null }),
        }).catch(e => console.warn('[Community Detect] Fire-and-forget error:', e));
      }
    }
  } catch (error) {
    // Gracefully handle — this is a non-blocking enhancement
    if (error instanceof TypeError && error.message.includes('fetch')) {
      // Network error — function likely not deployed
      return;
    }
    console.error('[Knowledge Extract] Error:', error);
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

    const { text, user_id, couple_id, timezone, media, mediaTypes, style, partner_names, is_sensitive, source, list_id: explicit_list_id } = await req.json();
    
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
      console.log('[process-note] Processing', mediaUrls.length, 'media files in PARALLEL');

      // Process all media files in parallel
      const mediaProcessors = mediaUrls.map(async (mediaUrl, i) => {
        const contentType = contentTypes[i] || undefined;
        const mediaType = getMediaType(mediaUrl, contentType);
        console.log('[process-note] Media type:', mediaType, 'URL:', mediaUrl.substring(0, 80));
        const results: string[] = [];
        let localReceiptResult: typeof receiptProcessingResult = null;

        if (mediaType === 'image') {
          try {
            // Download image ONCE with 30s timeout, reuse buffer for both receipt detection and vision analysis
            const imgDlCtrl = new AbortController();
            const imgDlTimeout = setTimeout(() => imgDlCtrl.abort(), 30000);
            const imageResponse = await fetch(mediaUrl, { signal: imgDlCtrl.signal });
            clearTimeout(imgDlTimeout);
            if (!imageResponse.ok) return { descriptions: [], receiptResult: null };

            const imageBlob = await imageResponse.blob();
            const arrayBuffer = await imageBlob.arrayBuffer();
            const base64Image = arrayBufferToBase64(arrayBuffer);
            const mimeType = imageBlob.type || 'image/jpeg';

            // Check if receipt
            const receiptCheck = await detectReceipt(genai, base64Image, mimeType);

            if (receiptCheck.isReceipt && receiptCheck.confidence >= 0.7) {
              localReceiptResult = await processReceiptImage(supabase, base64Image, user_id, couple_id);
              if (localReceiptResult.success && localReceiptResult.transaction) {
                const txn = localReceiptResult.transaction;
                results.push(`[Receipt] ${txn.merchant} - $${txn.amount} (${txn.category}) on ${txn.date}`);
                if (localReceiptResult.alert && localReceiptResult.message) {
                  results.push(`[Budget Alert] ${localReceiptResult.message}`);
                }
              } else {
                // Receipt processing failed — analyze with vision using EXISTING base64 (no re-download)
                const description = await analyzeImageWithGeminiFromBase64(genai, base64Image, mimeType);
                if (description) results.push(`[Image] ${description}`);
              }
            } else {
              // Not a receipt — analyze with vision using EXISTING base64 (no re-download)
              const description = await analyzeImageWithGeminiFromBase64(genai, base64Image, mimeType);
              if (description) results.push(`[Image] ${description}`);
            }
          } catch (imgError) {
            console.error('[process-note] Image processing error:', imgError);
          }
        } else if (mediaType === 'pdf') {
          const description = await analyzePdfWithGemini(genai, mediaUrl);
          if (description) results.push(`[PDF Document] ${description}`);
        } else if (mediaType === 'audio') {
          const transcription = await transcribeAudioWithElevenLabs(mediaUrl);
          if (transcription) results.push(`[Audio transcription] ${transcription}`);
        } else if (mediaType === 'video') {
          const videoAnalysis = await analyzeVideoWithGemini(genai, mediaUrl);
          if (videoAnalysis) {
            results.push(`[Video] ${videoAnalysis}`);
          } else {
            const transcription = await transcribeAudioWithElevenLabs(mediaUrl);
            if (transcription) results.push(`[Video audio transcription] ${transcription}`);
            else results.push(`[Video] Video attachment (analysis unavailable)`);
          }
        }
        return { descriptions: results, receiptResult: localReceiptResult };
      });

      const mediaResults = await Promise.all(mediaProcessors);
      for (const mr of mediaResults) {
        mediaDescriptions.push(...mr.descriptions);
        if (mr.receiptResult && mr.receiptResult.success) {
          receiptProcessingResult = mr.receiptResult;
        }
      }

      console.log('[process-note] Media descriptions:', mediaDescriptions);
    }

    // ======================================================================
    // PARALLEL CONTEXT FETCHING: memory, lists, and recent patterns at once
    // ======================================================================
    let memoryContext = '';
    let existingLists: any[] | null = null;
    let recentNotePatterns: Record<string, string> = {};

    const searchQuery = [
      safeText,
      ...mediaDescriptions.map(d => d.replace(/^\[.*?\]\s*/, '').substring(0, 200))
    ].filter(Boolean).join(' ');

    // Build lists query
    let listsQueryBuilder = couple_id
      ? supabase.from('clerk_lists').select('id, name, description, is_manual')
          .or(`and(author_id.eq.${user_id},couple_id.is.null),couple_id.eq.${couple_id}`)
      : supabase.from('clerk_lists').select('id, name, description, is_manual')
          .eq('author_id', user_id).is('couple_id', null);

    // Run all three in parallel
    const [memoryResult, listsResult, patternsResult] = await Promise.all([
      // 1. Memory search
      supabase.functions.invoke('manage-memories', {
        body: { action: 'search_relevant', user_id, query: searchQuery.substring(0, 300) }
      }).catch((err: any) => { console.warn('[process-note] Memory fetch error:', err); return { data: null }; }),

      // 2. Lists fetch
      listsQueryBuilder.then((res: any) => res).catch((err: any) => { 
        console.warn('[process-note] Lists fetch error:', err); return { data: null, error: err }; 
      }),

      // 3. Recent note patterns
      supabase.from('clerk_notes').select('summary, category, list_id')
        .eq('author_id', user_id).eq('completed', false)
        .not('list_id', 'is', null)
        .order('created_at', { ascending: false }).limit(30)
        .then((res: any) => res)
        .catch((err: any) => { console.warn('[process-note] Patterns fetch error:', err); return { data: null }; })
    ]);

    // Process memory result
    if (memoryResult?.data?.success && memoryResult.data.context) {
      memoryContext = memoryResult.data.context;
      console.log('[process-note] Retrieved', memoryResult.data.count, 'relevant memories');
    } else {
      // Fallback to get_context
      try {
        const { data: fallbackData } = await supabase.functions.invoke('manage-memories', {
          body: { action: 'get_context', user_id }
        });
        if (fallbackData?.success && fallbackData.context) {
          memoryContext = fallbackData.context;
          console.log('[process-note] Fallback: Retrieved', fallbackData.count, 'memories');
        }
      } catch (memErr) {
        console.warn('[process-note] Memory fallback error:', memErr);
      }
    }

    // Process lists result
    existingLists = listsResult?.data || [];
    if (listsResult?.error) {
      console.error('Error fetching lists:', listsResult.error);
    }

    // Process patterns result
    if (patternsResult?.data && existingLists) {
      for (const note of patternsResult.data) {
        const matchedList = existingLists.find((l: any) => l.id === note.list_id);
        if (matchedList) {
          const catKey = note.category?.toLowerCase();
          if (catKey && !recentNotePatterns[catKey]) {
            recentNotePatterns[catKey] = matchedList.name;
          }
        }
      }
      if (Object.keys(recentNotePatterns).length > 0) {
        console.log('[process-note] Learned routing patterns:', recentNotePatterns);
      }
    }

    // Prepare context - include list descriptions for richer AI matching
    const listsContext = existingLists && existingLists.length > 0 
      ? `\n\nExisting lists: ${existingLists.map((list: any) => 
          list.description ? `${list.name} (${list.description})` : list.name
        ).join(', ')}`
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
      // Extract all media content (images AND PDFs - both are visual/document content)
      const visualMediaDescriptions = mediaDescriptions
        .filter(d => d.startsWith('[Image]') || d.startsWith('[PDF Document]'))
        .map(d => d.replace(/^\[(Image|PDF Document)\]\s*/, ''))
        .join('\n');
      
      const audioTranscriptions = mediaDescriptions
        .filter(d => d.startsWith('[Audio') || d.startsWith('[Video'))
        .map(d => d.replace(/^\[.*?\]\s*/, ''))
        .join(' ');
      
      // Detect if text is a "caption" providing context for the media (not vague, but not the main content)
      // Examples: "Oura notes for interview", "meeting notes from standup", "doctor note"
      const isCaptionContext = !isVagueText && safeText.length > 0 && safeText.length < 80 
        && visualMediaDescriptions.length > safeText.length * 2;
      
      if (isVagueText && (visualMediaDescriptions || audioTranscriptions)) {
        // When text is vague, media content becomes the PRIMARY source
        console.log('[process-note] Vague text detected with media - using media content as primary source');
        
        if (visualMediaDescriptions) {
          enhancedText = `[User wants to save/remember the following from an attachment]\n\n${visualMediaDescriptions}`;
        }
        if (audioTranscriptions) {
          enhancedText = enhancedText === safeText 
            ? `[User wants to save/remember the following from audio]\n\n${audioTranscriptions}`
            : `${enhancedText}\n\n[Audio content]: ${audioTranscriptions}`;
        }
      } else if (isCaptionContext && visualMediaDescriptions) {
        // Caption provides CONTEXT for the media — media is the primary content, caption guides categorization
        console.log('[process-note] Caption-as-context detected: "' + safeText + '" — media is primary content');
        enhancedText = `[USER CAPTION/CONTEXT: "${safeText}" — CRITICAL: The summary/title MUST incorporate the user's keywords from this caption. Do NOT ignore the caption in favor of document content.]\n\n[EXTRACTED CONTENT FROM ATTACHMENT — use for items/details but the SUMMARY must reflect the user's caption keywords]:\n${visualMediaDescriptions}`;
        if (audioTranscriptions) {
          enhancedText += `\n\n[Audio content]: ${audioTranscriptions}`;
        }
      } else {
        // Normal case: append audio transcriptions to user text
        if (audioTranscriptions) {
          enhancedText = `${enhancedText}\n\nAudio content: ${audioTranscriptions}`;
        }
        // Also add visual media descriptions to the text if not vague
        if (visualMediaDescriptions) {
          enhancedText = `${enhancedText}\n\n[Attached document context]: ${visualMediaDescriptions}`;
        }
      }
      
      console.log('[process-note] Enhanced text with media:', enhancedText.substring(0, 200) + '...');
    }
    
    // Extract list names for AI context
    const existingListNames = (existingLists || []).map((l: any) => l.name);
    
    // Build couple/partner names context for task_owner assignment
    let coupleNamesContext = '';
    if (partner_names && Array.isArray(partner_names) && partner_names.length > 0) {
      coupleNamesContext = `\n\n**COUPLE/PARTNER NAMES**: ${partner_names.join(', ')}
When the note text mentions any of these names, use the EXACT name for task_owner assignment.
- If the note starts with a name (e.g., "${partner_names[0]} check 401k"), assign task_owner to "${partner_names[0]}"
- If the note says "tell ${partner_names[0]} to...", assign task_owner to "${partner_names[0]}"
- The first name mentioned as the actor/doer is the task_owner`;
    } else if (couple_id) {
      // Fetch member names from the members table (supports multi-member spaces)
      try {
        const { data: membersData } = await supabase
          .from('clerk_couple_members')
          .select('display_name')
          .eq('couple_id', couple_id);
        
        if (membersData && membersData.length > 0) {
          const names = membersData.map((m: any) => m.display_name).filter(Boolean);
          if (names.length > 0) {
            coupleNamesContext = `\n\n**SPACE MEMBER NAMES**: ${names.join(', ')}
When the note text mentions any of these names, use the EXACT name for task_owner assignment.
- If the note starts with a name (e.g., "${names[0]} check 401k"), assign task_owner to "${names[0]}"
- If the note says "tell ${names[0]} to...", assign task_owner to "${names[0]}"
- The first name mentioned as the actor/doer is the task_owner`;
          }
        } else {
          // Final fallback: legacy couple fields
          const { data: coupleData } = await supabase
            .from('clerk_couples')
            .select('you_name, partner_name')
            .eq('id', couple_id)
            .maybeSingle();
          if (coupleData) {
            const names = [coupleData.you_name, coupleData.partner_name].filter(Boolean);
            if (names.length > 0) {
              coupleNamesContext = `\n\n**COUPLE/PARTNER NAMES**: ${names.join(', ')}
When the note text mentions any of these names, use the EXACT name for task_owner assignment.`;
            }
          }
        }
      } catch (err) {
        console.warn('[process-note] Could not fetch member names:', err);
      }
    }

    const systemPrompt = createSystemPrompt(userTimezone, hasMedia, mediaDescriptions, detectedStyle, memoryContext + coupleNamesContext, existingListNames);
    
    // Build user prompt with explicit media-first instruction when text is vague
    let userPrompt: string;
    if (isVagueText && hasMedia) {
      userPrompt = `${systemPrompt}${listsContext}

CRITICAL: The user's text ("${safeText}") is vague/generic. You MUST derive the task summary and details ENTIRELY from the media content provided above. 
Do NOT use the user's text as the summary. Create a meaningful, specific summary based on what was extracted from the media.

Process this note:
"${enhancedText}"`;
    } else if (hasMedia && !isVagueText && safeText.length > 0 && safeText.length < 80) {
      // Caption + media: emphasize that the caption keywords MUST appear in the summary
      userPrompt = `${systemPrompt}${listsContext}

CRITICAL: The user provided a SHORT CAPTION with their attachment: "${safeText}". 
The summary/title MUST incorporate the user's keywords from this caption. The attachment content should populate the items/details, NOT override the user's chosen title/keywords.

Process this note:
"${enhancedText}"`;
    } else {
      userPrompt = `${systemPrompt}${listsContext}\n\nProcess this note:\n"${enhancedText}"`;
    }

    let processedResponse: any;
    //
    // DETERMINISTIC PRE-SPLIT: Detect clearly structured multi-item input
    // before sending to AI, to guarantee splitting for numbered/bulleted lists
    // ======================================================================
    const preDetectedItems = detectMultiItemInput(enhancedText);
    if (preDetectedItems && preDetectedItems.length > 1 && !hasMedia) {
      console.log('[process-note] Pre-split detected', preDetectedItems.length, 'items — processing in PARALLEL');
      
      // Process ALL items in parallel for maximum speed
      const itemPromises = preDetectedItems.map(async (item) => {
        const itemPrompt = `${systemPrompt}${listsContext}\n\nProcess this single note (this is ONE item from a multi-item brain dump):\n"${item}"`;
        
        try {
          const itemResponse = await genai.models.generateContent({
            model: "gemini-2.5-flash-lite",  // Use lite model for simple single items — 3x faster
            contents: itemPrompt,
            config: {
              responseMimeType: "application/json",
              responseSchema: singleNoteSchema,  // Use single schema — less tokens, faster
              temperature: 0.1,
              maxOutputTokens: 400
            }
          });
          
          return JSON.parse(itemResponse.text || '{}');
        } catch (itemErr) {
          console.warn('[process-note] Pre-split item failed:', item.substring(0, 50), itemErr);
          return {
            summary: item.length > 100 ? item.substring(0, 97) + '...' : item,
            category: 'task',
            priority: 'medium',
            tags: [],
            items: []
          };
        }
      });
      
      const allProcessedNotes = await Promise.all(itemPromises);
      
      // Skip the main AI call — we already have results
      processedResponse = { multiple: true, notes: allProcessedNotes };
    } else {
    // Standard AI processing path (single item or AI-detected multi)
    console.log('[GenAI SDK] Processing note with structured output...');
    console.log('[GenAI SDK] Style:', detectedStyle, 'Has media:', hasMedia, 'Media descriptions count:', mediaDescriptions.length, 'Is vague text:', isVagueText);

    let processedResponse_inner: any;

    try {
      const response = await resilientGenerateContent(
        genai,
        {
          model: "gemini-2.5-flash",
          contents: userPrompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: multiNoteSchema,
            temperature: 0.1,
            maxOutputTokens: 2400
          }
        },
        { maxRetries: 2, fallbackModels: ["gemini-2.5-flash-lite"] }
      );

      const responseText = response.text || '';
      console.log('[GenAI SDK] Raw response:', responseText);

      try {
        processedResponse_inner = JSON.parse(responseText);
        console.log('[GenAI SDK] Parsed response:', processedResponse_inner);
      } catch (parseError) {
        console.error('[GenAI SDK] Parse error, using fallback:', parseError);
        const fallbackSummary = mediaDescriptions.length > 0 
          ? deriveSummaryFromMedia(mediaDescriptions)
          : (safeText.length > 100 ? safeText.substring(0, 97) + "..." : safeText || 'Saved note');
        processedResponse_inner = {
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
        message.includes('503') ||
        message.includes('UNAVAILABLE') ||
        message.includes('Service Unavailable') ||
        message.includes('overloaded') ||
        (genAiError as any)?.status === 429 ||
        (genAiError as any)?.status === 503
      ) {
        console.warn('[GenAI SDK] Quota exceeded, falling back to keyword-based categorization');
        const fallbackSummary = mediaDescriptions.length > 0 
          ? deriveSummaryFromMedia(mediaDescriptions)
          : (safeText.length > 100 ? safeText.substring(0, 97) + "..." : safeText || 'Saved note');
        
        // ================================================================
        // ADAPTIVE KEYWORD-BASED CATEGORIZATION (Fallback when AI is unavailable)
        // 1. First try to match against user's existing list names (adaptive)
        // 2. Then fall back to expanded keyword detection (25+ domains)
        // ================================================================
        let fallbackCategory = 'task';
        const fallbackContent = [safeText, ...mediaDescriptions].join(' ').toLowerCase();

        // LAYER 1: Adaptive — match against user's actual list names
        // This makes the fallback personalized to each user's organization
        let adaptiveMatch = false;
        if (existingLists && existingLists.length > 0) {
          const sortedLists = [...existingLists].sort((a: any, b: any) => b.name.length - a.name.length);
          for (const list of sortedLists) {
            const listName = (list.name || '').toLowerCase();
            if (listName.length < 2) continue;
            // Check if list name appears as a word boundary in the content
            const listRegex = new RegExp(`\\b${listName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            if (listRegex.test(fallbackContent)) {
              fallbackCategory = list.name; // Use exact list name casing
              adaptiveMatch = true;
              console.log(`[Fallback] Adaptive match: "${list.name}" found in content`);
              break;
            }
          }
        }

        // LAYER 2: Expanded keyword detection across 25+ domains
        if (!adaptiveMatch) {
          const categoryKeywordPairs: [string, RegExp][] = [
            // Food & Kitchen
            ['groceries', /\b(milk|eggs|bread|butter|cheese|chicken|fruit|vegetable|veggies|grocery|groceries|supermarket|produce|yogurt|rice|pasta|cereal|snack|meat|fish|salmon|shrimp|organic|tofu|oat|almond)\b/i],
            ['recipes', /\b(recipe|cook|bake|baking|ingredient|cuisine|dish|meal|prep|marinade|sauce|roast|grill|stir.?fry|slow.?cook|instant.?pot|air.?fryer)\b/i],
            ['restaurants', /\b(restaurant|dine|dining|brunch|lunch.?spot|dinner.?spot|cafe|bistro|pizzeria|sushi|ramen|reservation|yelp|michelin|takeout|delivery)\b/i],
            // Health & Wellness
            ['health', /\b(doctor|dentist|appointment|vitamin|supplement|medicine|medical|wellness|therapy|therapist|prescription|pharmacy|checkup|vaccine|blood.?test|x.?ray|physical|dermatologist|optometrist|chiropractor|mental.?health|gym|workout|exercise|yoga|pilates|run|jog|marathon|meditation|mindfulness|sleep|skincare)\b/i],
            // Travel & Transportation
            ['travel', /\b(flight|airline|hotel|trip|vacation|boarding|airport|itinerary|passport|visa|hostel|airbnb|luggage|packing|road.?trip|cruise|resort|backpack|travel|destination|sightseeing|tourist|layover)\b/i],
            // Shopping & Commerce
            ['shopping', /\b(buy|purchase|store|amazon|promo|coupon|discount|order|cart|wishlist|sale|deal|clearance|refund|return|exchange|warranty|unboxing|mall|outlet|clothing|shoes|accessories|gadget)\b/i],
            // Entertainment & Media
            ['entertainment', /\b(concert|movie|show|event|ticket|festival|theater|theatre|karaoke|comedy|netflix|streaming|series|episode|season|premiere|trailer|gaming|game|playstation|xbox|nintendo|spotify|playlist|podcast|album|vinyl)\b/i],
            ['movies_to_watch', /\b(watch|film|cinema|documentary|blockbuster|horror|thriller|rom.?com|sci.?fi|animated|oscar|imdb)\b/i],
            ['books_to_read', /\b(book|author|novel|reading|isbn|publisher|kindle|audiobook|goodreads|bestseller|fiction|non.?fiction|memoir|biography|chapter|library|bookshop|paperback|hardcover)\b/i],
            // Finance & Money
            ['finance', /\b(bill|payment|budget|investment|bank|tax|insurance|mortgage|loan|debt|credit|savings|retirement|401k|ira|stock|crypto|interest|invoice|expense|refund|paycheck|salary|rent|tuition)\b/i],
            // Home & Living
            ['home_improvement', /\b(repair|fix|plumber|paint|renovation|furniture|sofa|ikea|shelf|cabinet|tile|flooring|wall|roof|garden|yard|lawn|landscaping|fence|deck|patio|garage|basement|attic|closet|organize|declutter|clean|deep.?clean|mop|vacuum)\b/i],
            // Work & Career
            ['work', /\b(meeting|deadline|project|client|report|presentation|email|colleague|manager|boss|promotion|interview|resume|cv|portfolio|contract|invoice|quarter|KPI|standup|sprint|agile|slack|zoom)\b/i],
            // Education & Learning
            ['education', /\b(class|course|lesson|study|exam|test|homework|assignment|lecture|professor|tutor|school|university|college|degree|certificate|scholarship|thesis|dissertation|research|seminar|workshop|tutorial|learn|skill)\b/i],
            // Kids & Family
            ['family', /\b(kid|child|children|baby|toddler|daycare|school.?pick|pediatrician|playdate|birthday.?party|babysitter|nanny|parent|family|diaper|formula|stroller|car.?seat|bedtime|homework.?help)\b/i],
            // Pets
            ['pets', /\b(dog|cat|puppy|kitten|vet|veterinarian|pet.?food|grooming|walk.?the|litter|aquarium|fish.?tank|hamster|bird|leash|collar|pet.?store|treats)\b/i],
            // Auto & Vehicle
            ['auto', /\b(car|vehicle|oil.?change|mechanic|tire|brake|inspection|registration|insurance|gas|fuel|carwash|detailing|lease|dealership|test.?drive|parking|garage)\b/i],
            // Technology
            ['technology', /\b(laptop|computer|phone|tablet|app|software|update|upgrade|wifi|router|password|backup|cloud|storage|SSD|monitor|keyboard|mouse|charger|cable|bluetooth|printer|setup|install|uninstall)\b/i],
            // Gift Ideas
            ['gift_ideas', /\b(gift|present|surprise|anniversary|birthday|wedding|christmas|valentine|mother.?s.?day|father.?s.?day|graduation|baby.?shower|housewarming|registry|wish.?list|wrapping)\b/i],
            // Date Ideas & Romance
            ['date_ideas', /\b(date|romantic|couple|anniversary|surprise|picnic|stargazing|sunset|wine.?tasting|spa|weekend.?getaway|love|relationship)\b/i],
            // Real Estate & Housing
            ['real_estate', /\b(apartment|house|condo|rent|lease|landlord|tenant|real.?estate|mortgage|down.?payment|closing|inspection|neighborhood|moving|relocat|storage.?unit)\b/i],
            // Legal & Admin
            ['legal', /\b(lawyer|attorney|notary|contract|agreement|will|trust|power.?of.?attorney|legal|court|filing|license|permit|registration|document|notarize)\b/i],
            // Garden & Plants
            ['garden', /\b(plant|seed|garden|flower|herb|pot|soil|fertilizer|water|prune|harvest|compost|succulent|indoor.?plant|outdoor|landscape|mulch|weed)\b/i],
            // Events & Planning
            ['events', /\b(party|celebration|gathering|invite|RSVP|venue|catering|decoration|theme|wedding|shower|reunion|potluck|barbecue|bbq|picnic|holiday)\b/i],
            // DIY & Crafts
            ['crafts', /\b(DIY|craft|knit|crochet|sew|quilt|scrapbook|paint|drawing|sketch|pottery|woodwork|handmade|project|glue|fabric|pattern)\b/i],
            // Subscriptions & Services
            ['subscriptions', /\b(subscription|membership|renew|cancel|trial|plan|monthly|annual|netflix|spotify|gym.?membership|magazine|newspaper|service)\b/i],
          ];
          for (const [cat, regex] of categoryKeywordPairs) {
            if (regex.test(fallbackContent)) {
              fallbackCategory = cat;
              console.log(`[Fallback] Keyword match: "${cat}"`);
              break;
            }
          }
        }

        // LAYER 3: Check user's recent note patterns for frequency-based inference
        if (fallbackCategory === 'task' && recentNotePatterns && Object.keys(recentNotePatterns).length > 0) {
          // If user predominantly uses one category, bias toward it for ambiguous notes
          const patternEntries = Object.entries(recentNotePatterns);
          if (patternEntries.length === 1) {
            fallbackCategory = patternEntries[0][1]; // Use most common category
            console.log(`[Fallback] Pattern-based: "${fallbackCategory}" (sole recent pattern)`);
          }
        }
        
        processedResponse_inner = {
          multiple: false,
          notes: [{
            summary: fallbackSummary,
            category: fallbackCategory,
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
    
    processedResponse = processedResponse_inner;
    } // end of else block for standard AI processing path

    // Category synonym map — used ONLY for matching AI categories to existing list names
    // This is NOT used for classification — the AI handles that via the prompt
    const categorySynonyms: Record<string, string[]> = {
      'groceries': ['grocery', 'groceries', 'food', 'supermarket', 'shopping list'],
      'travel': ['travel idea', 'travel', 'trip', 'vacation', 'flight', 'hotel', 'trips'],
      'home_improvement': ['home', 'home improvement', 'repair', 'fix', 'maintenance', 'renovation'],
      'entertainment': ['entertainment', 'date idea', 'date_ideas', 'concert', 'event', 'events', 'fun'],
      'errands': ['errands', 'errand', 'dry cleaning', 'dry clean', 'pickup', 'pick up', 'drop off', 'returns', 'laundry', 'car wash', 'oil change'],
      'personal': ['personal', 'appointment', 'admin'],
      'shopping': ['shopping', 'buy', 'purchase', 'store', 'wishlist', 'wish list'],
      'health': ['health', 'fitness', 'exercise', 'doctor', 'medical', 'wellness', 'supplements', 'vitamins'],
      'finance': ['finance', 'bill', 'bills', 'payment', 'budget', 'money', 'investments', 'stocks'],
      'books': ['books', 'book', 'reading', 'novel', 'author', 'literature', 'to read'],
      'movies_tv': ['movies_tv', 'movie', 'movies', 'tv', 'tv show', 'tv shows', 'series', 'film', 'watch', 'streaming', 'to watch'],
      'recipes': ['recipes', 'recipe', 'cooking', 'cook', 'bake', 'meal'],
      'date_ideas': ['date ideas', 'date_ideas', 'restaurant', 'restaurants', 'romantic', 'couples'],
      'work': ['work', 'office', 'project', 'meeting', 'career', 'professional'],
      'gift_ideas': ['gift ideas', 'gift_ideas', 'gifts', 'gift', 'present', 'presents'],
    };

    // Content-based keywords for smart matching
    // Each category maps to keywords AND a minimum match threshold for override
    const contentKeywords: Record<string, string[]> = {
      'books': ['book', 'author', 'novel', 'reading', 'chapter', 'isbn', 'publisher', 'paperback', 'hardcover', 'ebook', 'kindle'],
      'movies_tv': ['movie', 'film', 'tv show', 'series', 'watch', 'streaming', 'netflix', 'hulu', 'disney', 'hbo', 'prime video', 'actor', 'director'],
      'recipes': ['recipe', 'cook', 'bake', 'ingredients', 'cuisine', 'dish', 'meal'],
      'music': ['song', 'album', 'artist', 'band', 'playlist', 'spotify', 'music'],
      'travel': ['flight', 'airline', 'boarding pass', 'itinerary', 'departure', 'arrival', 'airport', 'terminal', 'passenger', 'booking', 'hotel', 'check-in', 'check-out', 'reservation', 'train ticket', 'car rental', 'airbnb', 'hostel', 'vacation', 'trip', 'travel', 'pnr', 'cabin', 'economy', 'business class', 'first class', 'layover', 'connection'],
      'stocks': ['stock', 'ticker', '$', 'share', 'shares', 'invest', 'portfolio', 'market', 'trading', 'dividend', 'earnings', 'nasdaq', 'nyse', 'price target', 'buy rating', 'sell rating', 'analyst', 'ferrari', 'apple', 'amazon', 'tesla', 'nvidia', 'microsoft', 'google', 'meta'],
      'finance': ['finance', 'investment', 'crypto', 'bitcoin', 'ethereum', 'currency', 'forex', 'bond', 'etf', 'mutual fund', 'bill', 'payment', 'budget', 'invoice', '401k', 'ira', 'savings', 'bank', 'credit card', 'loan', 'mortgage', 'insurance', 'tax'],
      'health': ['supplement', 'supplements', 'vitamin', 'vitamins', 'medication', 'medicine', 'prescription', 'dosage', 'dose', 'mg', 'mcg', 'capsule', 'tablet', 'pill', 'pills', 'health', 'wellness', 'fitness', 'workout', 'exercise', 'gym', 'yoga', 'meditation', 'sleep', 'nutrition', 'diet', 'calories', 'protein', 'creatine', 'omega', 'magnesium', 'zinc', 'iron', 'calcium', 'probiotic', 'collagen', 'ashwagandha', 'melatonin', 'turmeric', 'lion\'s mane', 'lions mane', 'tart cherry', 'fish oil', 'cbd', 'multivitamin', 'b12', 'vitamin c', 'vitamin d', 'vit c', 'vit d', 'vit b', 'doctor', 'dentist', 'appointment', 'medical', 'therapy', 'therapist', 'blood test', 'checkup', 'vaccination', 'allergy'],
      'groceries': ['milk', 'eggs', 'bread', 'butter', 'cheese', 'chicken', 'beef', 'pork', 'fish', 'rice', 'pasta', 'flour', 'sugar', 'salt', 'pepper', 'oil', 'vinegar', 'tomato', 'potato', 'onion', 'garlic', 'lemon', 'lime', 'orange', 'banana', 'avocado', 'lettuce', 'spinach', 'carrot', 'broccoli', 'cucumber', 'yogurt', 'cream', 'cereal', 'coffee', 'tea', 'juice', 'water', 'soda', 'beer', 'wine', 'snack', 'chips', 'crackers', 'cookies', 'fruit', 'vegetable', 'meat', 'produce', 'dairy', 'frozen', 'canned', 'sauce', 'condiment', 'spice', 'herb', 'nut', 'seed', 'grain', 'bean', 'tofu', 'soy', 'almond', 'oat'],
      'entertainment': ['karaoke', 'dj ', 'dj night', 'happy hour', 'concert', 'festival', 'live music', 'comedy show', 'trivia', 'nightlife', 'club event', 'themed night', 'show', 'theater', 'theatre', 'standup', 'stand-up', 'open mic'],
      'shopping': ['promo code', 'coupon', 'discount', 'sale', 'deal', 'price', 'store', 'amazon', 'ebay', 'walmart', 'target', 'zara', 'nike', 'adidas', 'electronics', 'gadget', 'clothes', 'shoes', 'accessory', 'order', 'delivery'],
      'home_improvement': ['repair', 'fix', 'plumber', 'electrician', 'paint', 'renovation', 'contractor', 'leak', 'faucet', 'pipe', 'drywall', 'tile', 'flooring', 'cabinet', 'shelf', 'furniture', 'ikea', 'hardware', 'drill', 'hammer', 'maintenance', 'sofa', 'couch', 'bed', 'mattress', 'desk', 'table', 'chair', 'dresser', 'wardrobe', 'bookshelf', 'nightstand', 'headboard', 'armchair', 'ottoman', 'curtain', 'curtains', 'rug', 'lamp', 'mirror', 'closet'],
      'errands': ['errand', 'dry clean', 'dry cleaning', 'pick up', 'pickup', 'drop off', 'dropoff', 'return', 'returns', 'laundry', 'car wash', 'oil change', 'inspection', 'post office', 'notary', 'dmv', 'license', 'passport', 'renew'],
      'personal': ['admin', 'register', 'call insurance', 'appointment'],
      'research': ['report', 'study', 'analysis', 'research', 'paper', 'whitepaper', 'white paper', 'thesis', 'dissertation', 'journal', 'publication', 'article', 'document', 'comprehensive', 'executive summary', 'findings', 'methodology', 'data', 'survey', 'statistics', 'benchmark', 'outlook', 'forecast', 'trend', 'industry', 'sector', 'policy', 'strategy', 'framework', 'innovation', 'digital transformation', 'artificial intelligence', 'AI', 'machine learning', 'technology', 'era'],
      'education': ['course', 'class', 'lesson', 'tutorial', 'learn', 'study', 'school', 'university', 'degree', 'certification', 'exam', 'test', 'quiz', 'homework', 'assignment', 'lecture', 'professor', 'student', 'campus', 'semester', 'syllabus'],
    };
    
    // Minimum keyword matches required per category to trigger an override
    // Higher = more conservative (avoids false positives for broad categories)
    const overrideThresholds: Record<string, number> = {
      'groceries': 1,
      'health': 2,
      'travel': 2,
      'entertainment': 1,
      'finance': 2,
      'shopping': 2,
      'home_improvement': 1,
      'books': 1,
      'movies_tv': 1,
      'errands': 1,
      'personal': 2,
      'stocks': 2,
      'recipes': 2,
      'music': 2,
      'research': 2,
      'education': 2,
    };

    // ================================================================
    // CANONICAL NAME MAP: Known category → display name mappings.
    // NOT exhaustive — the AI can create ANY category. Unknown categories
    // are auto-formatted to Title Case (e.g., "real_estate" → "Real Estate").
    // ================================================================
    const canonicalListNames: Record<string, { displayName: string; aliases: string[] }> = {
      'groceries': { displayName: 'Groceries', aliases: ['grocery', 'groceries', 'food shopping', 'supermarket'] },
      'health': { displayName: 'Health', aliases: ['health', 'wellness', 'medical', 'supplements', 'vitamins', 'fitness'] },
      'travel': { displayName: 'Travel', aliases: ['travel', 'trips', 'trip', 'vacation', 'vacations', 'flights'] },
      'entertainment': { displayName: 'Entertainment', aliases: ['entertainment', 'events', 'fun', 'nightlife', 'concerts'] },
      'shopping': { displayName: 'Shopping', aliases: ['shopping', 'wishlist', 'wish list', 'purchases'] },
      'home_improvement': { displayName: 'Home Improvement', aliases: ['home improvement', 'home', 'repairs', 'maintenance', 'renovation'] },
      'finance': { displayName: 'Finance', aliases: ['finance', 'finances', 'bills', 'budget', 'investments', 'money'] },
      'books': { displayName: 'Books', aliases: ['books', 'book', 'reading', 'to read'] },
      'movies_tv': { displayName: 'Movies & TV', aliases: ['movies tv', 'movies & tv', 'movies and tv', 'movie', 'movies', 'tv shows', 'tv show', 'series', 'to watch'] },
      'recipes': { displayName: 'Recipes', aliases: ['recipes', 'recipe', 'cooking', 'meals'] },
      'date_ideas': { displayName: 'Date Ideas', aliases: ['date ideas', 'date idea', 'restaurants', 'restaurant', 'romantic'] },
      'errands': { displayName: 'Errands', aliases: ['errands', 'errand', 'dry cleaning', 'pickups', 'returns', 'to do errands'] },
      'personal': { displayName: 'Personal', aliases: ['personal', 'admin'] },
      'work': { displayName: 'Work', aliases: ['work', 'office', 'career', 'professional'] },
      'gift_ideas': { displayName: 'Gift Ideas', aliases: ['gift ideas', 'gift idea', 'gifts', 'gift', 'presents'] },
      'task': { displayName: 'Tasks', aliases: ['task', 'tasks', 'to do', 'todo'] },
      'stocks': { displayName: 'Investments', aliases: ['stocks', 'stock', 'investing', 'portfolio', 'trading'] },
      'research': { displayName: 'Research', aliases: ['research', 'report', 'study', 'analysis', 'paper', 'whitepaper', 'documents'] },
      'education': { displayName: 'Education', aliases: ['education', 'learning', 'courses', 'school', 'university'] },
      // Novel categories from AI are auto-formatted: "real_estate" → "Real Estate"
    };

    const findOrCreateList = async (category: string, tags: string[] = [], targetList?: string, summary?: string) => {
      console.log('[findOrCreateList] Input - category:', category, 'targetList:', targetList, 'summary:', summary?.substring(0, 50));
      
      // Helper to normalize list names for comparison
      const normalizeName = (name: string): string => {
        return name.toLowerCase().trim().replace(/[_\-\s]+/g, ' ').replace(/&/g, 'and');
      };
      
      // Helper: check if two names are equivalent (singular/plural/alias match)
      const areNamesEquivalent = (nameA: string, nameB: string): boolean => {
        const a = normalizeName(nameA);
        const b = normalizeName(nameB);
        if (a === b) return true;
        // Singular/plural
        if (a + 's' === b || b + 's' === a) return true;
        if (a.replace(/ies$/, 'y') === b || b.replace(/ies$/, 'y') === a) return true;
        if (a.replace(/es$/, '') === b || b.replace(/es$/, '') === a) return true;
        // Check canonical aliases
        for (const entry of Object.values(canonicalListNames)) {
          const normAliases = entry.aliases.map(al => normalizeName(al));
          if (normAliases.includes(a) && normAliases.includes(b)) return true;
        }
        return false;
      };
      
      // Helper: find an existing list matching a name using equivalence
      const findEquivalentList = (name: string) => {
        if (!existingLists || existingLists.length === 0) return null;
        return existingLists.find((l: any) => areNamesEquivalent(l.name, name));
      };
      
      // ================================================================
      // PRIORITY 0: Direct text-to-list-name match
      // Check if any word/phrase in the NOTE's OWN summary/targetList matches a list name
      // IMPORTANT: We use only the individual note's summary, NOT safeText (the full brain dump),
      // to prevent cross-contamination when a brain dump is split into multiple notes.
      // e.g., "Buy groceries. Also pick up dry cleaning" → the "dry cleaning" note
      // should NOT match "Groceries" just because the full text mentions "grocery".
      // ================================================================
      if (existingLists && existingLists.length > 0) {
        const textToCheck = [summary, targetList].filter(Boolean).join(' ').toLowerCase();
        
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
      // PRIORITY 1: Exact, singular/plural, or alias match by category name
      // Uses areNamesEquivalent to catch "grocery" → "Groceries", etc.
      // ================================================================
      if (existingLists && existingLists.length > 0) {
        const equivMatch = findEquivalentList(category);
        if (equivMatch) {
          console.log('[findOrCreateList] Category equivalence match found:', equivMatch.name, '(from category:', category, ')');
          return equivMatch.id;
        }
      }
      
      
      // ================================================================
      // PRIORITY 2: Use AI-suggested target_list if it matches an existing list
      // ================================================================
      if (targetList && existingLists && existingLists.length > 0) {
        // Use equivalence matching (catches "Health" → "Health", "Grocery" → "Groceries", etc.)
        const equivMatch = findEquivalentList(targetList);
        if (equivMatch) {
          console.log('[findOrCreateList] AI target_list equivalence match:', equivMatch.name);
          return equivMatch.id;
        }
        
        // Partial/contains match as fallback — but ONLY if the shorter string
        // is a COMPLETE word inside the longer one (prevents "Work" → "Workouts")
        const targetNorm = normalizeName(targetList);
        const partialMatch = existingLists.find((l: any) => {
          const listNorm = normalizeName(l.name);
          if (listNorm === targetNorm) return true; // exact already handled above
          // Only match if one is a complete word boundary match inside the other
          const shorter = listNorm.length <= targetNorm.length ? listNorm : targetNorm;
          const longer = listNorm.length <= targetNorm.length ? targetNorm : listNorm;
          const escaped = shorter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const wbRegex = new RegExp(`\\b${escaped}\\b`, 'i');
          // Only accept if the shorter name IS the longer name minus a suffix/prefix
          // i.e., they share the same root — but NOT if they're completely different words
          // "Work" should NOT match "Workouts" (different concept)
          // "Home" CAN match "Home Improvement" (the shorter IS a word in the longer)
          return wbRegex.test(longer) && shorter.length >= 4 && (longer.split(/\s+/).some(w => normalizeName(w) === shorter));
        });
        if (partialMatch) {
          console.log('[findOrCreateList] AI target_list partial match:', partialMatch.name);
          return partialMatch.id;
        }
      }

      // ================================================================
      // PRIORITY 2.5: Pattern-based routing from recent user behavior
      // If user previously routed "health" notes to a specific list, do it again
      // ================================================================
      if (category && Object.keys(recentNotePatterns).length > 0) {
        const catNorm = normalizeName(category);
        const patternListName = recentNotePatterns[catNorm];
        if (patternListName && existingLists) {
          const patternMatch = existingLists.find((l: any) => normalizeName(l.name) === normalizeName(patternListName));
          if (patternMatch) {
            console.log('[findOrCreateList] Pattern-based routing: category', category, '→ list', patternMatch.name, '(learned from recent notes)');
            return patternMatch.id;
          }
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
          
           // Check categorySynonyms for semantic matching
          Object.entries(categorySynonyms).forEach(([canonical, synonyms]) => {
            const normalizedSynonyms = synonyms.map(s => normalizeName(s));
            const categoryMatchesSynonyms = normalizedSynonyms.includes(categoryNorm) || 
                                            normalizedSynonyms.some(s => categoryNorm === s);
            const listMatchesSynonyms = normalizedSynonyms.some(s => listNameNorm === s || s === listNameNorm);
            
            if (categoryMatchesSynonyms && listMatchesSynonyms) {
              score += 10;
            }
          });
          
          // Partial match - only if one is a complete word in the other
          // Prevents "work" matching "workouts" (different concepts)
          if (listNameNorm !== categoryNorm) {
            const shorter = listNameNorm.length <= categoryNorm.length ? listNameNorm : categoryNorm;
            const longer = listNameNorm.length <= categoryNorm.length ? categoryNorm : listNameNorm;
            // Only score if the shorter appears as a standalone word in the longer
            if (longer.split(/\s+/).some(w => normalizeName(w) === shorter)) {
              score += 6;
            }
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
      // PRIORITY 4.5: Universal content-based category override
      // Checks ALL keyword categories, not just hardcoded ones.
      // If the note content strongly matches a category's keywords,
      // override the AI's category (which often defaults to "task").
      // ================================================================
      // Use only individual note content for override — NOT safeText (full brain dump)
      // to prevent cross-contamination in multi-note splits
      const allContentForOverride = [summary, category, ...(tags || []), ...mediaDescriptions].filter(Boolean).join(' ').toLowerCase();
      let effectiveCategory = category;
      
      // Override if current category is generic ("task" or "personal")
      // CRITICAL FOR NEW USERS: This override runs even when there are NO existing lists,
      // ensuring that domain-specific content never defaults to "Tasks"
      const genericCategories = ['task', 'personal', 'general'];
      if (genericCategories.includes(normalizeName(effectiveCategory))) {
        let bestOverrideCategory: string | null = null;
        let bestOverrideScore = 0;
        
        for (const [kwCategory, keywords] of Object.entries(contentKeywords)) {
          const threshold = overrideThresholds[kwCategory] || 2;
          
          const matchCount = keywords.filter(kw => {
            // Escape special regex chars in keyword
            const escaped = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp(`\\b${escaped}\\b`, 'i');
            return regex.test(allContentForOverride);
          }).length;
          
          if (matchCount >= threshold && matchCount > bestOverrideScore) {
            bestOverrideScore = matchCount;
            bestOverrideCategory = kwCategory;
          }
        }
        
        if (bestOverrideCategory) {
          console.log('[findOrCreateList] Universal override: detected', bestOverrideScore, bestOverrideCategory, 'keywords, overriding from', effectiveCategory);
          effectiveCategory = bestOverrideCategory;
          
          // After override, re-check if an existing list matches the NEW category
          if (existingLists && existingLists.length > 0) {
            const overrideListMatch = findEquivalentList(effectiveCategory);
            if (overrideListMatch) {
              console.log('[findOrCreateList] Post-override match found:', overrideListMatch.name);
              return overrideListMatch.id;
            }
          }
        }
      }

      // ================================================================
      // PRIORITY 4.6: AI category promotion for new users
      // When the AI assigned a non-generic category but the content override
      // didn't trigger (e.g., niche topics like "research", "education", etc.),
      // preserve the AI's domain category instead of falling to "Tasks".
      // This ensures new users get meaningful list auto-creation from day one.
      // ================================================================
      if (genericCategories.includes(normalizeName(effectiveCategory)) && !genericCategories.includes(normalizeName(category))) {
        // The original AI category was more specific — restore it
        console.log('[findOrCreateList] Restoring AI category:', category, '(was overridden to generic:', effectiveCategory, ')');
        effectiveCategory = category;
      }

      // ================================================================
      // PRIORITY 5: Create new list only if no match found
      // Use canonical name map for clean, user-friendly names.
      // NEVER auto-create a list called "Tasks" — that's the fallback
      // category and would just accumulate unorganized items.
      // ================================================================
      const catKey = normalizeName(effectiveCategory).replace(/\s+/g, '_');

      // If the effective category is still generic, do NOT create a list — return null
      // so the note lands in the default "Tasks" view without a dedicated list.
      if (genericCategories.includes(catKey)) {
        console.log('[findOrCreateList] Generic category "' + effectiveCategory + '" — skipping list creation');
        return null;
      }

      const canonical = canonicalListNames[catKey] || canonicalListNames[effectiveCategory];
      const listName = canonical?.displayName || effectiveCategory
        .replace(/_/g, ' ')
        .split(' ')
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      
      // FINAL SAFETY CHECK: Use equivalence matching to prevent "Grocery" vs "Groceries"
      if (existingLists && existingLists.length > 0) {
        const finalCheck = findEquivalentList(listName);
        if (finalCheck) {
          console.log('[findOrCreateList] Final equivalence check caught duplicate, using:', finalCheck.name);
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
          // Handle race condition: if another note in the same batch already created this list,
          // fetch the existing one instead of returning null
          if (createError.code === '23505') {
            console.log('[findOrCreateList] Duplicate detected (race condition), fetching existing list:', listName);
            const { data: existingList } = await supabase
              .from('clerk_lists')
              .select('*')
              .ilike('name', listName)
              .or(couple_id ? `couple_id.eq.${couple_id}` : `author_id.eq.${user_id}`)
              .limit(1)
              .single();
            if (existingList) {
              if (existingLists) existingLists.push(existingList);
              return existingList.id;
            }
          }
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

        // Use explicit list_id from request if provided (e.g., adding note from within a specific list)
        // Otherwise, use AI routing to find/create the appropriate list
        const listId = explicit_list_id 
          ? explicit_list_id
          : (note.category 
            ? await findOrCreateList(note.category, note.tags || [], note.target_list, summary) 
            : null);
        
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
      ? { multiple: true, notes: processedNotes, original_text: safeText, media_urls: mediaUrls.length > 0 ? mediaUrls : null, is_sensitive: !!is_sensitive }
      : { ...processedNotes[0], original_text: safeText, is_sensitive: !!is_sensitive };

    // Encrypt sensitive note fields server-side (AES-256-GCM)
    if (is_sensitive && isEncryptionAvailable()) {
      try {
        if (isMultiple && result.notes) {
          // Encrypt each note in the batch
          for (let i = 0; i < result.notes.length; i++) {
            const n = result.notes[i];
            const enc = await encryptNoteFields(n.original_text || safeText, n.summary, user_id, true);
            result.notes[i] = { ...n, ...enc };
          }
        } else {
          const enc = await encryptNoteFields(result.original_text || safeText, result.summary, user_id, true);
          result = { ...result, ...enc };
        }
        console.log('[process-note] 🔐 Encrypted sensitive note fields');
      } catch (encErr) {
        console.warn('[process-note] Encryption failed, storing plaintext:', encErr);
      }
    }

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

    // ======================================================================
    // AUTO-ADD TO GOOGLE CALENDAR: Create events for notes with dates
    // ======================================================================
    autoAddToCalendar(supabase, result, user_id).catch(err => {
      console.warn('[Auto Calendar] Non-blocking error:', err);
    });

    // ======================================================================
    // AUTO-DETECT EXPENSES: Check if note contains monetary amounts
    // ======================================================================
    const expenseDetected = detectAndCreateExpense(
      supabase, result, safeText, user_id, couple_id,
      mediaUrls.length > 0 ? mediaUrls[0] : null,
      source
    );
    expenseDetected.catch(err => {
      console.warn('[Expense Detection] Non-blocking error:', err);
    });

    // Auto-extract memories from brain-dump (async, non-blocking) - only if there's actual text
    if (safeText.trim()) {
      extractMemoriesFromDump(genai, supabase, safeText, user_id).catch(err => {
        console.warn('[Memory Extraction] Non-blocking error:', err);
      });
    }

    // ======================================================================
    // OLIVE-MEMORY: Flush facts to persistent memory system (async, non-blocking)
    // This populates olive_memory_files and olive_memory_chunks for the
    // compiled knowledge system (Karpathy Second Brain pattern).
    // ======================================================================
    if (safeText.trim().length >= 20) {
      flushToOliveMemory(supabase, safeText, result, user_id).catch(err => {
        console.warn('[Olive Memory Flush] Non-blocking error:', err);
      });
    }

    // ======================================================================
    // KNOWLEDGE EXTRACTION: Extract entities and relationships (async, non-blocking)
    // Feeds the knowledge graph (olive_entities + olive_relationships)
    // ======================================================================
    if (safeText.trim().length >= 10) {
      extractKnowledge(supabase, result, safeText, user_id, couple_id).catch(err => {
        console.warn('[Knowledge Extract] Non-blocking error:', err);
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
    
    // Determine if this is a transient error that the client can retry
    const msg = error?.message || String(error);
    const isTransient = msg.includes('503') || msg.includes('UNAVAILABLE') || 
                        msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') ||
                        msg.includes('overloaded');
    
    // NEVER return 500 — always return structured JSON with 200 so the client
    // can use the fallback data and display a meaningful result
    return new Response(JSON.stringify({ 
      error: isTransient ? 'SERVICE_UNAVAILABLE' : (error?.message || 'Unknown error occurred'),
      fallback: true,
      summary: 'Note saved',
      category: 'task',
      due_date: null,
      priority: 'medium',
      tags: [],
      items: [],
      list_id: null,
      original_text: ''
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

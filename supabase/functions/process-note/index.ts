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

// Dynamic system prompt
const createSystemPrompt = (userTimezone: string = 'UTC') => {
  const now = new Date();
  const utcTime = now.toISOString();
  
  return `You're Olive, an AI assistant organizing tasks for couples. Process raw text into structured notes.

USER TIMEZONE: ${userTimezone}
Current UTC time: ${utcTime}

IMPORTANT: When calculating times, use the user's timezone (${userTimezone}), not UTC.
- "tomorrow at 10am" means 10am in ${userTimezone}, convert to UTC ISO format for storage

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

2. category: Use lowercase with underscores
   - concerts/events/shows → "entertainment"
   - restaurants/dinner plans → "date_ideas"
   - repairs/fix/maintenance → "home_improvement"
   - vacation/flights/hotels → "travel"
   - groceries/supermarket → "groceries"
   - clothes/electronics → "shopping"
   - appointments/bills/rent → "personal"

3. due_date/reminder_time: ISO format
   - "remind me" → set BOTH reminder_time AND due_date to same datetime
   - Time references: "tomorrow" (next day 09:00), "tonight" (same day 23:59)
   - Weekday references: next occurrence at 09:00
   - IMPORTANT: When setting reminder_time, ALWAYS also set due_date to match

4. priority: high (urgent/bills), medium (regular), low (ideas)

5. items: ONLY for multi-part tasks. NEVER for grocery lists.

6. recurrence_frequency/recurrence_interval: For recurring reminders
   - "every day" → frequency: "daily", interval: 1
   - "every 2 weeks" → frequency: "weekly", interval: 2

Return multiple:true with notes array if multiple items detected.
Return multiple:false with single note fields if just one task.`;
};

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

    const { text, user_id, couple_id, timezone } = await req.json();
    
    if (!text || !user_id) {
      throw new Error('Missing required fields: text and user_id');
    }

    // Initialize clients
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

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
    const systemPrompt = createSystemPrompt(userTimezone);
    const userPrompt = `${systemPrompt}${listsContext}\n\nProcess this note:\n"${text}"`;

    console.log('[GenAI SDK] Processing note with structured output...');

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

    let processedResponse;
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
          original_text: text
        };
      })
    );

    const isMultiple = processedResponse.multiple === true || notes.length > 1;

    const result = isMultiple
      ? { multiple: true, notes: processedNotes, original_text: text }
      : { ...processedNotes[0], original_text: text };

    console.log('[GenAI SDK] Final result:', result);
    
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

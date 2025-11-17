import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
};

const SYSTEM_PROMPT = `Process text into structured notes. Split into multiple notes if text contains distinct tasks separated by semicolons, "and", or topic changes.

For each note extract:
- summary: concise title (max 100 chars)
- category: personal, groceries, shopping, travel, entertainment, date_ideas, home_improvement, reminder, health
- priority: low/medium/high (urgent/ASAP/today=high, soon/this week=medium, someday=low)
- due_date: ISO format if mentioned (calculate from today, e.g., "tomorrow"=+1 day, "next week"=+7 days, "Friday"=next Friday)
- items: array for shopping/groceries
- task_owner: name if assigned ("tell [name]", "[name] should")
- reminder_time: ISO format if specified
- recurrence: {frequency: "daily|weekly|monthly|yearly", interval: number} if recurring ("every day", "monthly", etc.)
- tags: relevant keywords

Summary rules:
- Grocery/shopping: focus on item ("tell Almu to buy lemons" → "lemons")
- Action tasks: keep verb ("fix kitchen sink")
- Assignments: focus on action ("tell John to water plants" → "water plants")

Category keywords:
- concert/event/show tickets, restaurant reservations → entertainment or date_ideas
- home repairs, fix, install, maintenance → home_improvement
- vacation, trip, flights, hotels → travel
- groceries, food shopping → groceries
- general shopping → shopping
- appointments, calls, bills, rent → personal
- "remind me" → reminder (set priority HIGH)

Return JSON:
Multiple tasks: {"notes": [{...}, {...}]}
Single task: {summary, category, due_date, reminder_time, recurrence, priority, tags, items, task_owner}`;

const SIMPLIFIED_PROMPT = `Process note into JSON. Split multiple tasks by semicolons/and/topics.

Extract: summary (concise), category (personal/groceries/shopping/travel/entertainment/date_ideas/home_improvement/reminder/health), priority (low/medium/high), due_date (ISO), items (array), task_owner (name), reminder_time (ISO), recurrence ({frequency, interval}).

Return: {"notes": [...]} or single note object.`;

// Helper function to validate and normalize dates
function validateDate(dateValue: any): string | null {
  if (!dateValue) return null;
  
  try {
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) {
      console.log('Invalid date detected:', dateValue, '- returning null');
      return null;
    }
    return date.toISOString();
  } catch (e) {
    console.error('Error parsing date:', dateValue, e);
    return null;
  }
}

// Helper function to call Gemini API
async function callGeminiAPI(prompt: string, text: string, maxOutputTokens: number = 800) {
  const GEMINI_API_KEY = Deno.env.get('GEMINI_API');
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not found');
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: `${prompt}\n\nProcess this note:\n"${text}"\n\nRespond with ONLY a valid JSON object, no other text.`
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens,
      }
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Gemini API error:', errorText);
    throw new Error('Failed to process note with AI');
  }

  return await response.json();
}

serve(async (req) => {
  // Handle CORS preflight requests
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

    const { text, user_id, couple_id } = await req.json();
    
    if (!text || !user_id) {
      throw new Error('Missing required fields: text and user_id');
    }

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch existing lists for the user/couple to provide context
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
      // Continue without lists context if there's an error
    }

    // Prepare context for AI about existing lists
    const listsContext = existingLists && existingLists.length > 0 
      ? `\n\nExisting lists available:\n${existingLists.map(list => `- ${list.name}${list.description ? ` (${list.description})` : ''}`).join('\n')}\n\nWhen categorizing, consider if this note belongs to one of these existing lists. If it matches an existing list's purpose, use a category that would map to that list.`
      : '';

    // Try with full prompt first, then retry with simplified prompt if token limit hit
    let data;
    let aiResponse;
    let usedSimplifiedPrompt = false;
    
    try {
      // First attempt with full prompt and lists context
      console.log('Attempting AI processing with full prompt...');
      data = await callGeminiAPI(SYSTEM_PROMPT + listsContext, text);
      console.log('Gemini response (full prompt):', data);
      
      // Check if response was truncated
      if (data.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
        console.warn('Token limit hit with full prompt, retrying with simplified prompt...');
        usedSimplifiedPrompt = true;
        
        // Retry with simplified prompt (no lists context, reduced tokens)
        data = await callGeminiAPI(SIMPLIFIED_PROMPT, text, 500);
        console.log('Gemini response (simplified prompt):', data);
      }
    } catch (error) {
      console.error('Error calling Gemini API:', error);
      throw error;
    }
    
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      throw new Error('Invalid response from Gemini API');
    }

    // Check if still hitting token limit after retry - use fallback
    if (data.candidates[0].finishReason === 'MAX_TOKENS') {
      console.error('AI response was truncated even with simplified prompt, using fallback');
      
      // Create a basic fallback note structure
      const fallbackNote = {
        summary: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        category: 'personal',
        priority: 'medium',
        due_date: null,
        reminder_time: null,
        tags: [],
        items: [],
        task_owner: null
      };
      
      // Return the fallback and let it be processed
      return new Response(
        JSON.stringify({ 
          success: true, 
          notes: [fallbackNote],
          warning: 'Message was too long for full AI processing. Created a basic note.'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate that we have the parts array with content
    if (!data.candidates[0].content.parts || !data.candidates[0].content.parts[0] || !data.candidates[0].content.parts[0].text) {
      console.error('AI response missing content parts:', data.candidates[0].content);
      throw new Error('AI returned an empty response. Please try again.');
    }

    aiResponse = data.candidates[0].content.parts[0].text;
    console.log('AI response text:', aiResponse);

    // Parse the JSON response - handle markdown code blocks
    let processedResponse;
    let cleanResponse = '';
    try {
      cleanResponse = aiResponse.trim();
      
      // Remove markdown code blocks if present
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      console.log('Cleaned AI response for parsing:', cleanResponse);
      processedResponse = JSON.parse(cleanResponse);
      console.log('Successfully parsed AI response:', processedResponse);
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', cleanResponse);
      console.error('Parse error:', parseError);
      // Fallback to basic processing
      processedResponse = {
        summary: text.length > 100 ? text.substring(0, 97) + "..." : text,
        category: "task",
        due_date: null,
        priority: "medium",
        tags: [],
        items: text.includes(',') ? text.split(',').map((item: string) => item.trim()) : []
      };
    }

    // Helper function to find or create list for a category
    const findOrCreateList = async (category: string) => {
      if (!category) {
        console.log('No category provided, returning null');
        return null;
      }

      // Try to find an existing list that matches the category
      const matchingList = existingLists && existingLists.length > 0 ? existingLists.find(list => {
        const listName = list.name.toLowerCase();
        const categoryName = category.toLowerCase().replace(/_/g, ' ');
        
        // Direct name match
        if (listName === categoryName) return true;
        
        // Fuzzy matching for common variations
        if (listName.includes(categoryName) || categoryName.includes(listName)) return true;
        
        return false;
      }) : null;
      
      if (matchingList) {
        console.log('Found matching existing list:', matchingList.name, 'with ID:', matchingList.id);
        return matchingList.id;
      } else {
        // Create a new list for this category
        const listName = category.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim();
        
        console.log('Creating new list for category:', category, '->', listName);
        
        try {
          const { data: newList, error: createError } = await supabase
            .from('clerk_lists')
            .insert([{
              name: listName,
              description: `Auto-generated list for ${listName.toLowerCase()} items`,
              is_manual: false,
              author_id: user_id,
              couple_id: couple_id || null,
            }])
            .select()
            .single();
            
          if (createError) {
            console.error('Error creating new list:', createError);
            console.error('List creation data attempted:', {
              name: listName,
              description: `Auto-generated list for ${listName.toLowerCase()} items`,
              is_manual: false,
              author_id: user_id,
              couple_id: couple_id || null,
            });
            
            // Return null but ensure the note is still created without a list
            return null;
          } else {
            console.log('Successfully created new list:', newList.name, 'with ID:', newList.id);
            return newList.id;
          }
        } catch (error) {
          console.error('Exception during list creation:', error);
          return null;
        }
      }
    };

    // Handle multiple notes or single note response
    if (processedResponse.multiple && processedResponse.notes && Array.isArray(processedResponse.notes)) {
      console.log('Processing multiple notes:', processedResponse.notes.length);
      
      // Process each note and assign lists
      const processedNotes = await Promise.all(
        processedResponse.notes.map(async (note: any, index: number) => {
          console.log(`Processing note ${index + 1}:`, { category: note.category, summary: note.summary });
          const listId = note.category ? await findOrCreateList(note.category) : null;
          console.log(`Note ${index + 1} assigned list_id:`, listId);
          
          return {
            summary: note.summary || text,
            category: note.category || "task",
            due_date: validateDate(note.due_date),
            reminder_time: validateDate(note.reminder_time),
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

      console.log('All processed notes with list assignments:', processedNotes.map(n => ({ summary: n.summary, category: n.category, list_id: n.list_id })));

      const result = {
        multiple: true,
        notes: processedNotes,
        original_text: text
      };

      console.log('Processed multiple notes result:', result);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } else {
      // Handle single note
      const listId = processedResponse.category ? await findOrCreateList(processedResponse.category) : null;
      
      const result = {
        summary: processedResponse.summary || text,
        category: processedResponse.category || "task",
        due_date: validateDate(processedResponse.due_date),
        reminder_time: validateDate(processedResponse.reminder_time),
        recurrence_frequency: processedResponse.recurrence_frequency || null,
        recurrence_interval: processedResponse.recurrence_interval || null,
        priority: processedResponse.priority || "medium",
        tags: processedResponse.tags || [],
        items: processedResponse.items || [],
        task_owner: processedResponse.task_owner || null,
        list_id: listId,
        original_text: text
      };

      console.log('Processed single note result:', result);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  } catch (error: any) {
    console.error('Error in process-note function:', error);
    return new Response(JSON.stringify({ 
      error: error?.message || 'Unknown error occurred',
      // Fallback processing for single note
      summary: 'Note processing failed',
      category: 'task',
      due_date: null,
      priority: 'medium',
      tags: [],
      items: [],
      list_id: null,
      original_text: 'Failed to process'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
};

const SYSTEM_PROMPT = `You are Olive Assistant, an intelligent AI designed to support couples in organizing their shared and individual lives seamlessly. Your task is to process unstructured raw text notes entered by users and transform them into actionable, well-organized information.

CRITICAL: Analyze if the input contains MULTIPLE DISTINCT TASKS or if it should be split into SEPARATE NOTES. 

**Examples of when to create MULTIPLE notes:**
1. "rent due Friday; schedule car service; pay internet bill monthly" → 3 separate notes:
   - Note 1: "Pay rent" (due: Friday, category: personal, priority: high)
   - Note 2: "Schedule car service" (category: personal, priority: medium)  
   - Note 3: "Pay internet bill" (recurring: monthly, category: personal, priority: medium)

2. "groceries tonight: salmon, spinach, lemons; cook Fri; Almu handles dessert" → 3 separate notes:
   - Note 1: "Buy groceries" (items: ["salmon", "spinach", "lemons"], due: tonight, category: groceries)
   - Note 2: "Cook dinner" (due: Friday, category: personal, task_owner: current user)
   - Note 3: "Handle dessert" (due: Friday, category: personal, task_owner: "Almu")

3. "book flights to Madrid next month; remind Almu about passport; museum tickets?" → 3 separate notes:
   - Note 1: "Book flights to Madrid" (due: next month, category: travel, priority: high)
   - Note 2: "Renew passport" (task_owner: "Almu", due: 2 weeks, category: travel, priority: high)
   - Note 3: "Buy museum tickets" (category: travel, priority: medium)

4. "buy concert ticket and call doctor on Wednesday" → 2 separate notes:
   - Note 1: "Buy concert ticket" (category: entertainment, priority: medium)
   - Note 2: "Call doctor" (due: Wednesday, category: personal, priority: medium)

5. "pick up dry cleaning and grocery shopping" → 2 separate notes:
   - Note 1: "Pick up dry cleaning" (category: personal, priority: medium)
   - Note 2: "Grocery shopping" (category: groceries, priority: medium)

**When to create a SINGLE note:**
- Single coherent task or thought
- Shopping list for one trip
- Single event planning
- One specific request or reminder

For each note (single or multiple), perform these steps:

Understand the Context and Content:
- Identify distinct tasks separated by semicolons, "and", or clear topic changes
- Look for compound tasks joined by "and" that represent different actions
- Extract key points into concise summaries for each task
- Detect URLs, links, or web references and preserve them appropriately
- Identify if tasks are entertainment, events, or experience-related content

Summary Creation Rules:
- For GROCERY/SHOPPING tasks: Focus on the item itself (e.g., "Tell Almu to buy lemons" → summary: "lemons")
- For ACTION-BASED tasks: Preserve important action verbs (e.g., "fix the kitchen sink" → "fix the kitchen sink")
- For ASSIGNMENT tasks: Focus on the action/item, not the telling (e.g., "Tell John to water plants" → "water plants")
- For RECURRING tasks: Add frequency context (e.g., "pay internet bill monthly" → "pay internet bill")

Enhanced Categorization Logic:
- **concert_tickets**, **event_tickets**, **show_tickets** → category: "entertainment" or "date_ideas"
- **restaurant reservations**, **dinner plans**, **date activities** → category: "date_ideas" 
- **home repairs**, **fix**, **install**, **maintenance** → category: "home_improvement"
- **vacation**, **trip planning**, **flights**, **hotels** → category: "travel"
- **groceries**, **food shopping**, **supermarket** → category: "groceries"
- **general shopping** (clothes, electronics, etc.) → category: "shopping"
- **personal tasks**, **appointments**, **calls**, **bills**, **rent** → category: "personal"
- **reminders**, **remind me**, **don't forget** → category: "reminder", set priority to HIGH and add "reminder" tag

Task Owner Detection:
- Scan for mentions of who should be responsible for or assigned to complete the task
- Look for phrases like: "tell [name] to...", "ask [name] to...", "[name] should...", "[name] handles...", "[name] will..."
- If a specific person is mentioned as responsible, extract their name as the task_owner
- If no specific owner is mentioned, leave the task_owner field as null

Items Extraction:
- For grocery/shopping lists: Extract specific items mentioned
- For events/tickets: Extract event details
- For general tasks: Only use items array if the note contains multiple distinct sub-tasks

Due Date Intelligence (CRITICAL - Use actual date calculation):
- Calculate the current date and time when processing
- "in X hours" or "in X hour" → add X hours to current time in ISO format
- "in X minutes" or "in X minute" → add X minutes to current time in ISO format  
- "in X days" or "in X day" → add X days to current time at 09:00 in ISO format
- "tonight" → today's date at 23:59 in ISO format
- "tomorrow" → tomorrow's date at 09:00 in ISO format  
- "Friday", "next Friday" → calculate the next occurrence of that weekday at 09:00 in ISO format
- "next week" → 7 days from now at 09:00 in ISO format
- "next month" → same day next month at 09:00 in ISO format
- "monthly", "weekly" → set as recurring (note in tags) and set first occurrence
- CRITICAL: Always return actual ISO date strings (YYYY-MM-DDTHH:mm:ss.sssZ), never relative text
- CRITICAL: Calculate dates based on current time: ${new Date().toISOString()}

Reminder vs Due Date (CRITICAL):
- If user says "remind me" → set ONLY reminder_time (not due_date)
- If user mentions a deadline/due date → set ONLY due_date (not reminder_time)
- Only set both if explicitly mentioned
- Examples:
  * "remind me to call doctor in 2 minutes" → reminder_time set, due_date null
  * "project due tomorrow" → due_date set, reminder_time null
  * "remind me tomorrow about the meeting due on Friday" → both set
- CRITICAL: For reminders, extract the time and add priority: high

Date Calculation Examples (assuming today is ${new Date().toDateString()}):
- Input: "next Friday" → Calculate which date is the next Friday and return as "2024-XX-XXTXX:XX:XX.XXXZ"
- Input: "tomorrow" → Return "${new Date(Date.now() + 86400000).toISOString().split('T')[0]}T09:00:00.000Z"
- Input: "tonight" → Return "${new Date().toISOString().split('T')[0]}T23:59:00.000Z"

Priority Detection:
- Bills, rent, flights, passport renewals → HIGH priority
- Regular shopping, cooking, general tasks → MEDIUM priority
- Ideas, suggestions, optional items → LOW priority

Formatting Output:
**CRITICAL:** If multiple distinct tasks are detected, return a JSON object with "multiple": true and "notes" array:
{
  "multiple": true,
  "notes": [
    {
      "summary": "task 1 summary",
      "category": "category1", 
      "due_date": "2024-XX-XXTXX:XX:XX.XXXZ or null",
      "reminder_time": "2024-XX-XXTXX:XX:XX.XXXZ or null",
      "priority": "high/medium/low",
      "tags": ["tag1"],
      "items": ["item1", "item2"],
      "task_owner": "name or null"
    },
    {
      "summary": "task 2 summary", 
      "category": "category2",
      "due_date": "2024-XX-XXTXX:XX:XX.XXXZ or null",
      "reminder_time": "2024-XX-XXTXX:XX:XX.XXXZ or null",
      "priority": "high/medium/low", 
      "tags": ["tag2"],
      "items": ["item3", "item4"],
      "task_owner": "name or null"
    }
  ]
}

**CRITICAL EXAMPLES FOR SPLITTING:**
- "buy concert ticket and call doctor" → MUST return 2 notes
- "grocery shopping and pick up dry cleaning" → MUST return 2 notes  
- "book flight and reserve hotel" → MUST return 2 notes
- Any text with "and" connecting different actions → MULTIPLE notes

**If single task detected, return standard single note format:**
{
  "summary": "concise summary (max 100 characters)",
  "category": "assigned category (lowercase, use underscores)",
  "due_date": "2024-XX-XXTXX:XX:XX.XXXZ or null",
  "reminder_time": "2024-XX-XXTXX:XX:XX.XXXZ or null", 
  "priority": "low/medium/high",
  "tags": ["relevant", "tags"],
  "items": ["individual", "items"],
  "task_owner": "name of responsible person or null"
}

Maintain a warm, helpful, and respectful tone, supporting the couple's shared life organization with intelligence and empathy.`;

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

    // Call Gemini API with enhanced context
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `${SYSTEM_PROMPT}${listsContext}\n\nProcess this note:\n"${text}"\n\nRespond with ONLY a valid JSON object, no other text.`
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1200,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', errorText);
      throw new Error('Failed to process note with AI');
    }

    const data = await response.json();
    console.log('Gemini response:', data);
    
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      throw new Error('Invalid response from Gemini API');
    }

    // Check if response was truncated - continue processing but log warning
    if (data.candidates[0].finishReason === 'MAX_TOKENS') {
      console.warn('AI response may have been truncated due to token limit');
    }

    const aiResponse = data.candidates[0].content.parts[0].text;
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
            due_date: note.due_date || null,
            reminder_time: note.reminder_time || null,
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
        due_date: processedResponse.due_date || null,
        reminder_time: processedResponse.reminder_time || null,
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
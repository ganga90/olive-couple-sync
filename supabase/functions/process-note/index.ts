import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
};

const SYSTEM_PROMPT = `You're Olive, an AI assistant organizing tasks for couples. Process raw text into structured notes.

SPLIT CRITERIA: Create multiple notes when input contains lists of items or distinct tasks.
Examples: 
- "buy milk and call doctor" → 2 notes (different actions)
- "buy milk, eggs, bread" → 3 notes (separate items)
- "groceries: milk, eggs, bread" → 3 notes (separate items)
- "fix the sink" → 1 note (single task)

CRITICAL: For grocery lists or item lists, ALWAYS create separate notes for EACH item, even if mentioned together.

CORE FIELDS:
1. summary: Concise title (max 100 chars)
   - Groceries: item name only ("milk" not "buy milk")
   - Actions: keep verb ("fix sink")
   - Assignments: action only ("water plants" not "tell John to water plants")

2. category: Use lowercase with underscores
   - concerts/events/shows → "entertainment"
   - restaurants/dinner plans → "date_ideas"
   - repairs/fix/maintenance → "home_improvement"
   - vacation/flights/hotels → "travel"
   - groceries/supermarket → "groceries"
   - clothes/electronics → "shopping"
   - appointments/bills/rent → "personal"

3. due_date/reminder_time: ISO format YYYY-MM-DDTHH:mm:ss.sssZ
   Current time: ${new Date().toISOString()}
   - "remind me" → set reminder_time only
   - deadline/due → set due_date only
   - Calculate: "in X hours/minutes/days", "tomorrow" (09:00), "tonight" (23:59), "Friday" (next occurrence 09:00)
   - NEVER return relative text, always ISO dates

4. priority: high (bills/rent/urgent), medium (regular tasks), low (ideas)

5. tags: Extract themes/patterns (["urgent", "financial", "health"])

6. items: ONLY use for multi-part tasks (like "plan vacation: book flights, reserve hotel"). NEVER use for grocery lists - split those into separate notes instead.

7. task_owner: Extract person's name from "tell [name]", "[name] should", "[name] handles" (null if not mentioned)

OUTPUT FORMAT:
Multiple tasks:
{"multiple": true, "notes": [{"summary": "...", "category": "...", "due_date": "...", "reminder_time": "...", "priority": "...", "tags": [], "items": [], "task_owner": "..."}]}

Single task:
{"summary": "...", "category": "...", "due_date": "...", "reminder_time": "...", "priority": "...", "tags": [], "items": [], "task_owner": "..."}`;

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

    // Enhanced pattern detection for smart list categorization
    const detectListPatterns = (notes: any[], category: string, tags: string[]) => {
      // Check for recurring patterns across all user notes
      const categoryFrequency: Record<string, number> = {};
      const tagFrequency: Record<string, string[]> = {};
      
      // Build pattern map from existing lists
      if (existingLists && existingLists.length > 0) {
        existingLists.forEach(list => {
          const normalizedListName = list.name.toLowerCase();
          categoryFrequency[normalizedListName] = categoryFrequency[normalizedListName] || 0;
          categoryFrequency[normalizedListName]++;
        });
      }
      
      // Smart category mapping with synonym detection
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
      
      // Find best matching existing list based on category and tags
      let bestMatch = null;
      let highestScore = 0;
      
      if (existingLists && existingLists.length > 0) {
        existingLists.forEach(list => {
          let score = 0;
          const listNameLower = list.name.toLowerCase();
          const categoryLower = category.toLowerCase().replace(/_/g, ' ');
          
          // Direct match
          if (listNameLower === categoryLower) score += 10;
          
          // Synonym matching
          Object.entries(categoryMap).forEach(([canonical, synonyms]) => {
            if (synonyms.includes(categoryLower) && synonyms.some(s => listNameLower.includes(s))) {
              score += 8;
            }
          });
          
          // Partial match
          if (listNameLower.includes(categoryLower) || categoryLower.includes(listNameLower)) {
            score += 5;
          }
          
          // Tag matching
          if (tags && tags.length > 0 && list.description) {
            const descLower = list.description.toLowerCase();
            tags.forEach(tag => {
              if (descLower.includes(tag.toLowerCase())) score += 2;
            });
          }
          
          if (score > highestScore) {
            highestScore = score;
            bestMatch = list;
          }
        });
      }
      
      return { bestMatch, shouldCreateNew: highestScore < 5 };
    };

    // Helper function to find or create list with smart pattern detection
    const findOrCreateList = async (category: string, tags: string[] = []) => {
      if (!category) {
        console.log('No category provided, returning null');
        return null;
      }

      // Use pattern detection to find best matching list
      const { bestMatch, shouldCreateNew } = detectListPatterns([], category, tags);
      
      if (bestMatch && !shouldCreateNew) {
        console.log('Smart pattern match found:', bestMatch.name, 'with ID:', bestMatch.id);
        return bestMatch.id;
      }
      
      // Check for exact or fuzzy matches as fallback
      const matchingList = existingLists && existingLists.length > 0 ? existingLists.find(list => {
        const listName = list.name.toLowerCase();
        const categoryName = category.toLowerCase().replace(/_/g, ' ');
        
        if (listName === categoryName) return true;
        if (listName.includes(categoryName) || categoryName.includes(listName)) return true;
        
        return false;
      }) : null;
      
      if (matchingList) {
        console.log('Found matching existing list:', matchingList.name, 'with ID:', matchingList.id);
        return matchingList.id;
      }
      
      // Create new list with smart naming
      const listName = category
        .replace(/_/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      
      console.log('Creating smart list for category:', category, '->', listName);
      
      try {
        const { data: newList, error: createError } = await supabase
          .from('clerk_lists')
          .insert([{
            name: listName,
            description: `Auto-generated for ${listName.toLowerCase()}${tags.length > 0 ? ` (tags: ${tags.join(', ')})` : ''}`,
            is_manual: false,
            author_id: user_id,
            couple_id: couple_id || null,
          }])
          .select()
          .single();
          
        if (createError) {
          console.error('Error creating new list:', createError);
          return null;
        }
        
        console.log('Successfully created smart list:', newList.name, 'with ID:', newList.id);
        return newList.id;
      } catch (error) {
        console.error('Exception during list creation:', error);
        return null;
      }
    };

    // Handle multiple notes or single note response
    if (processedResponse.multiple && processedResponse.notes && Array.isArray(processedResponse.notes)) {
      console.log('Processing multiple notes:', processedResponse.notes.length);
      
      // Process each note and assign lists with smart pattern detection
      const processedNotes = await Promise.all(
        processedResponse.notes.map(async (note: any, index: number) => {
          console.log(`Processing note ${index + 1}:`, { category: note.category, summary: note.summary, tags: note.tags });
          const listId = note.category ? await findOrCreateList(note.category, note.tags || []) : null;
          console.log(`Note ${index + 1} assigned list_id:`, listId);
          
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
      // Handle single note with smart list assignment
      const listId = processedResponse.category ? await findOrCreateList(processedResponse.category, processedResponse.tags || []) : null;
      
      const result = {
        summary: processedResponse.summary || text,
        category: processedResponse.category || "task",
        due_date: processedResponse.due_date || null,
        reminder_time: processedResponse.reminder_time || null,
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
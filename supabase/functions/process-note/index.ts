import "https://deno.land/x/xhr@0.1.0/mod.ts"
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.21.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const geminiApiKey = Deno.env.get('GEMINI_API')!

const supabase = createClient(supabaseUrl, supabaseServiceKey)
const genAI = new GoogleGenerativeAI(geminiApiKey)

// Get existing lists for a user/couple to help AI make better category decisions
async function getExistingLists(userId: string, coupleId: string | null) {
  try {
    let query = supabase
      .from('clerk_lists')
      .select('name, description')
      .eq('author_id', userId);

    if (coupleId) {
      query = query.eq('couple_id', coupleId);
    } else {
      query = query.is('couple_id', null);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching existing lists:', error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    console.error('Unexpected error fetching lists:', error);
    return [];
  }
}

// Create a new list if it doesn't exist
async function createListIfNeeded(listName: string, userId: string, coupleId: string | null) {
  try {
    // Check if list already exists
    let checkQuery = supabase
      .from('clerk_lists')
      .select('id')
      .eq('name', listName)
      .eq('author_id', userId);

    if (coupleId) {
      checkQuery = checkQuery.eq('couple_id', coupleId);
    } else {
      checkQuery = checkQuery.is('couple_id', null);
    }

    const { data: existingList } = await checkQuery.single();
    
    if (existingList) {
      return existingList.id;
    }

    // Create new list
    const { data, error } = await supabase
      .from('clerk_lists')
      .insert({
        name: listName,
        author_id: userId,
        couple_id: coupleId,
        is_manual: false, // AI-generated list
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error creating list:', error);
      return null;
    }

    console.log('Created new list:', listName, 'with id:', data.id);
    return data.id;
  } catch (error) {
    console.error('Unexpected error creating list:', error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { text, userId, coupleId } = await req.json()

    if (!text || !userId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: text and userId' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    console.log('Processing note for user:', userId, 'text:', text)

    // Get existing lists to help AI make better category decisions
    const existingLists = await getExistingLists(userId, coupleId || null);
    const existingListNames = existingLists.map(list => list.name).join(', ');
    console.log('Existing lists for context:', existingListNames)

    const prompt = `You are an AI assistant that processes notes and organizes them into structured data.

Given this note text: "${text}"

${existingLists.length > 0 ? 
  `The user already has these lists: ${existingListNames}. 
   If the note fits into one of these existing lists, use that category name exactly as it appears.
   Only create a new category if the note doesn't fit well into any existing list.` :
  'This is a new note that may require a new category.'
}

Please analyze it and return ONLY a JSON response with the following structure:
{
  "summary": "A brief, clear summary of the note (max 100 characters)",
  "category": "Choose from existing lists above, or create a new category name (use proper case like 'Home Improvement', 'Groceries', etc.)",
  "due_date": "ISO date string if a specific date/time is mentioned, otherwise null",
  "task_owner": "Name of person responsible if mentioned (e.g., 'John', 'Sarah'), otherwise null",
  "priority": "low, medium, or high based on urgency indicators",
  "tags": ["relevant", "tags", "from", "content"],
  "items": ["individual", "items", "if", "this", "is", "a", "list"]
}

For the category:
- First check if this note belongs to any existing list above
- If it fits an existing list, use that exact name
- If it doesn't fit any existing list, create a new appropriate category name
- Use proper case formatting (e.g., "Home Improvement", "Gift Ideas", "Movies to Watch")

For task_owner:
- Look for phrases like "John should...", "Sarah needs to...", "I need [name] to...", "[name] can handle this"
- Extract the person's name if clearly mentioned as being responsible
- Return null if no specific person is mentioned as the owner

If the note contains multiple items (like a shopping list), extract them into the items array.

Respond with ONLY the JSON, no additional text.`

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const aiResult = await model.generateContent(prompt);
    const response = await aiResult.response;
    const aiResponse = response.text();

    console.log('AI response text:', aiResponse);

    // Parse the JSON response - handle markdown code blocks
    let parsed;
    try {
      let cleanResponse = aiResponse.trim();
      
      // Remove markdown code blocks if present
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      console.log('Cleaned AI response for parsing:', cleanResponse);
      parsed = JSON.parse(cleanResponse);
      console.log('Successfully parsed AI response:', parsed);
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', aiResponse);
      console.error('Parse error:', parseError);
      // Fallback to basic processing
      parsed = {
        summary: text.length > 100 ? text.substring(0, 97) + "..." : text,
        category: "Task",
        due_date: null,
        task_owner: null,
        priority: "medium",
        tags: [],
        items: text.includes(',') ? text.split(',').map(item => item.trim()) : []
      };
    }

    // Create list if needed and get list ID
    const listId = await createListIfNeeded(parsed.category, userId, coupleId || null);

    // Return the processed note result
    const processedResult = {
      ...parsed,
      original_text: text,
      list_id: listId
    }

    console.log('Processed note result:', processedResult)
    
    return new Response(JSON.stringify(processedResult), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Error in process-note function:', error)
    return new Response(JSON.stringify({ 
      error: error.message,
      summary: 'Note processing failed',
      category: 'Task',
      due_date: null,
      priority: 'medium',
      tags: [],
      items: []
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
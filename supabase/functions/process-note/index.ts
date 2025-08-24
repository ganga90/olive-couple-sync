import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
};

const SYSTEM_PROMPT = `You are Olive Assistant, an intelligent AI designed to support couples in organizing their shared and individual lives seamlessly. Your task is to process unstructured raw text notes entered by users and transform them into actionable, well-organized information.

For each raw note, perform the following steps:

Understand the Context and Content:
- Identify the main message and extract key points into a concise summary.
- Detect the user who submitted the note.

Summary Creation Rules:
- For GROCERY/SHOPPING tasks: If the note mentions specific items to buy/get, focus the summary on the item itself (e.g., "Tell Almu to buy lemons" → summary: "lemons")
- For ACTION-BASED tasks: Preserve important action verbs in the summary (e.g., "fix the kitchen sink" → "fix the kitchen sink", "book restaurant for date" → "book restaurant for date")
- For ASSIGNMENT tasks: When someone is told to do something, focus on the action/item, not the telling (e.g., "Tell John to water plants" → "water plants")

Categorization:
- Assign one or more relevant categories from predefined lists (e.g., groceries, task, home improvement, travel idea, date idea, reminder, shopping list, personal note) based on the content.
- If the note does not fit existing categories, suggest potential new custom categories.

Date Extraction:
- Automatically detect any date, time, or deadline mentioned explicitly or implicitly (e.g., "tomorrow," "next Friday," "in 3 days").
- If no date is found, leave the date field empty.

Task Owner Detection:
- Scan for mentions of who should be responsible for or assigned to complete the task.
- Look for phrases like:
  - "tell [name] to...", "ask [name] to...", "[name] should...", "[name] needs to..."
  - "for [name]", "remind [name]", "[name] can...", "have [name]..."
  - "get [name] to...", "[name] must...", "[name] will..."
- If a specific person is mentioned as responsible, extract their name as the task owner.
- If no specific owner is mentioned, leave the task_owner field as null.

Items Extraction:
- For grocery/shopping lists: Extract specific items mentioned (e.g., "buy milk and eggs" → items: ["milk", "eggs"])
- For general tasks: Only use items array if the note contains multiple distinct sub-tasks or components
- Focus on the actual items/objects, not the actions

Actionability & Prioritization:
- Identify if the note represents an actionable task or idea.
- Highlight important or urgent items when indicated.

Formatting Output:
- Return a structured JSON object with fields:
  - summary: concise summary following the rules above (max 100 characters)
  - category: assigned category (lowercase, use underscores for spaces)
  - due_date: standardized ISO date if detected, otherwise null
  - priority: "low", "medium", or "high"
  - tags: array of relevant tags
  - items: array of individual items if the note contains a list of things
  - task_owner: name of the person responsible for the task if detected, otherwise null

Learning & Memory:
- Store patterns for categories, phrases, or commonly used terms to improve future classification and personalization for this user.

Maintain a warm, helpful, and respectful tone, supporting the couple's shared life organization with intelligence and empathy.`;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API');
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API key is not configured');
    }

    const { text, user_id } = await req.json();
    
    if (!text || !user_id) {
      throw new Error('Missing required fields: text and user_id');
    }

    // Call Gemini API
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `${SYSTEM_PROMPT}\n\nProcess this note:\n"${text}"\n\nRespond with ONLY a valid JSON object, no other text.`
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1000,
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

    const aiResponse = data.candidates[0].content.parts[0].text;
    console.log('AI response text:', aiResponse);

    // Parse the JSON response - handle markdown code blocks
    let processedNote;
    try {
      let cleanResponse = aiResponse.trim();
      
      // Remove markdown code blocks if present
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      console.log('Cleaned AI response for parsing:', cleanResponse);
      processedNote = JSON.parse(cleanResponse);
      console.log('Successfully parsed AI response:', processedNote);
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', cleanResponse);
      console.error('Parse error:', parseError);
      // Fallback to basic processing
      processedNote = {
        summary: text.length > 100 ? text.substring(0, 97) + "..." : text,
        category: "general",
        due_date: null,
        priority: "medium",
        tags: [],
        items: text.includes(',') ? text.split(',').map(item => item.trim()) : []
      };
    }

    // Ensure required fields
    const result = {
      summary: processedNote.summary || text,
      category: processedNote.category || "general",
      due_date: processedNote.due_date || null,
      priority: processedNote.priority || "medium",
      tags: processedNote.tags || [],
      items: processedNote.items || [],
      task_owner: processedNote.task_owner || null,
      original_text: text
    };

    console.log('Processed note result:', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in process-note function:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      // Fallback processing
      summary: 'Note processing failed',
      category: 'general',
      due_date: null,
      priority: 'medium',
      tags: [],
      items: []
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
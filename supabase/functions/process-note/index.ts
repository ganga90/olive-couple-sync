import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are Olive Assistant, an intelligent AI designed to support couples in organizing their shared and individual lives seamlessly. Your task is to process unstructured raw text notes entered by users and transform them into actionable, well-organized information.

For each raw note, perform the following steps:

Understand the Context and Content:
- Identify the main message and extract key points into a concise summary.
- Detect the user who submitted the note and identify task ownership.

Categorization & List Assignment:
- Assign appropriate list names (e.g., "Groceries", "Home Improvement", "Travel Ideas", "Date Ideas", etc.) based on content.
- Use proper capitalized names for lists (e.g., "Groceries" not "groceries").
- Consider existing common list names when categorizing.

Task Owner Detection:
- Carefully identify if the note specifies who should complete the task using patterns like:
  * Direct mentions: "John should fix this", "Sarah needs to call", "Mike has to buy"
  * Indirect assignments: "partner should handle", "I'll ask them to do", "let's have [name] take care of"
  * Pronoun references: "he/she needs to", "they should handle"
- Look for role-based assignments: "partner", "spouse", "husband", "wife", "boyfriend", "girlfriend"
- If no specific owner is mentioned, return null (defaults to note author).
- Return the detected name/identifier exactly as mentioned, or null if author should be the owner.

Date Extraction:
- Automatically detect any date, time, or deadline mentioned explicitly or implicitly (e.g., "tomorrow," "next Friday," "in 3 days").
- If no date is found, leave the date field empty.

Actionability & Prioritization:
- Identify if the note represents an actionable task or idea.
- Highlight important or urgent items when indicated.

Formatting Output:
- Return a structured JSON object with fields:
  - summary: concise summary of the note (max 100 characters)
  - list_name: proper capitalized list name (e.g., "Groceries", "Tasks")
  - due_date: standardized ISO date if detected, otherwise null
  - priority: "low", "medium", or "high"
  - tags: array of relevant tags
  - items: array of individual items if the note contains a list
  - task_owner: user ID if someone specific is assigned, otherwise null (means author)

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
        list_name: "Tasks",
        due_date: null,
        priority: "medium",
        tags: [],
        items: text.includes(',') ? text.split(',').map(item => item.trim()) : [],
        task_owner: null
      };
    }

    // Ensure required fields
    const result = {
      summary: processedNote.summary || text,
      list_name: processedNote.list_name || "Tasks",
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
      list_name: 'Tasks',
      due_date: null,
      priority: 'medium',
      tags: [],
      items: [],
      task_owner: null
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
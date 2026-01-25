import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { user_id } = await req.json();
    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[analyze-notes] Starting analysis for user: ${user_id}`);

    // Create Supabase client with service role
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch the last 20 notes for this user
    const { data: notes, error: notesError } = await supabase
      .from("clerk_notes")
      .select("id, summary, original_text, category, created_at, items, tags")
      .eq("author_id", user_id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (notesError) {
      console.error("[analyze-notes] Error fetching notes:", notesError);
      throw notesError;
    }

    if (!notes || notes.length < 5) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Not enough notes to analyze. Add more tasks first." 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Format notes for analysis
    const formattedNotes = notes
      .map((note) => {
        const date = new Date(note.created_at).toISOString().split("T")[0];
        const items = note.items?.length > 0 ? ` [Items: ${note.items.join(", ")}]` : "";
        return `[${date}] ${note.summary}${items}`;
      })
      .join("\n");

    console.log(`[analyze-notes] Analyzing ${notes.length} notes`);

    // Fetch existing memories to avoid duplicates
    const { data: existingMemories, error: memoriesError } = await supabase
      .from("user_memories")
      .select("content")
      .eq("user_id", user_id)
      .eq("is_active", true);

    if (memoriesError) {
      console.error("[analyze-notes] Error fetching memories:", memoriesError);
    }

    const existingContents = existingMemories?.map((m) => m.content.toLowerCase()) || [];

    // Also fetch existing pending insights to avoid duplicates
    const { data: existingInsights, error: insightsError } = await supabase
      .from("memory_insights")
      .select("suggested_content")
      .eq("user_id", user_id)
      .eq("status", "pending");

    if (insightsError) {
      console.error("[analyze-notes] Error fetching insights:", insightsError);
    }

    const existingInsightContents = existingInsights?.map((i) => i.suggested_content.toLowerCase()) || [];

    // Call AI to analyze patterns
    const systemPrompt = `Role: You are an Insight Discovery Agent for a personal productivity app called Olive. Your goal is to analyze a user's raw task history and detect enduring facts, preferences, or relationships that should be saved to their Long-Term Memory profile.

Rules for Analysis:
1. Ignore One-offs: Do not remember temporary tasks like "Pick up dry cleaning" or "Call Mom".
2. Identify Patterns: Look for repeated dietary choices, recurring locations, named entities (pets, partners, children), or specific work contexts.
3. Fact-Based Only: Do not guess feelings. Only infer facts explicitly supported by the text.
4. Format: Output a JSON object with a "suggested_memory" string and a "confidence" score (0.0 to 1.0).

Examples:
- Input: "Buy gluten-free pasta", "Recipe for keto bread"
  Output: { "suggested_memory": "The user follows a Gluten-Free and Keto diet.", "confidence": 0.9 }
- Input: "Vet appointment for Milka", "Buy dog food"
  Output: { "suggested_memory": "The user has a dog named Milka.", "confidence": 0.95 }
- Input: "Grocery run", "Pick up milk"
  Output: null (no strong pattern)

Constraint: If no strong pattern is found, return null. Do not force a result.
Return ONLY the JSON object or null, no additional text.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Analyze this user's task history for enduring patterns:\n\n${formattedNotes}`,
          },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[analyze-notes] AI API error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error(`AI API error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content?.trim();

    console.log("[analyze-notes] AI response:", content);

    if (!content || content === "null" || content.toLowerCase() === "null") {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "No strong patterns detected in your recent notes.",
          insight_created: false 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse JSON response
    let parsedResult;
    try {
      // Clean the response - remove markdown code blocks if present
      let cleanContent = content;
      if (cleanContent.startsWith("```")) {
        cleanContent = cleanContent.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      }
      parsedResult = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error("[analyze-notes] Failed to parse AI response:", parseError);
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Could not parse AI response.",
          insight_created: false 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate confidence threshold
    if (!parsedResult.suggested_memory || parsedResult.confidence < 0.7) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "No high-confidence patterns detected.",
          insight_created: false 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for duplicates
    const suggestedLower = parsedResult.suggested_memory.toLowerCase();
    const isDuplicateMemory = existingContents.some(
      (existing) => 
        existing.includes(suggestedLower) || 
        suggestedLower.includes(existing) ||
        // Check for high similarity
        calculateSimilarity(existing, suggestedLower) > 0.7
    );

    const isDuplicateInsight = existingInsightContents.some(
      (existing) =>
        existing.includes(suggestedLower) ||
        suggestedLower.includes(existing) ||
        calculateSimilarity(existing, suggestedLower) > 0.7
    );

    if (isDuplicateMemory || isDuplicateInsight) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Similar memory or insight already exists.",
          insight_created: false 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert new insight
    const { error: insertError } = await supabase
      .from("memory_insights")
      .insert({
        user_id: user_id,
        suggested_content: parsedResult.suggested_memory,
        source: "analysis_agent",
        confidence_score: parsedResult.confidence,
        status: "pending",
      });

    if (insertError) {
      console.error("[analyze-notes] Error inserting insight:", insertError);
      throw insertError;
    }

    console.log("[analyze-notes] Insight created successfully");

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Pattern detected! Check your home screen.",
        insight_created: true,
        insight: parsedResult.suggested_memory
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[analyze-notes] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Simple string similarity function
function calculateSimilarity(str1: string, str2: string): number {
  const words1 = new Set(str1.split(/\s+/));
  const words2 = new Set(str2.split(/\s+/));
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  return intersection.size / union.size;
}

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TaskInfo {
  id: string;
  title: string;
  summary: string;
  current_list_id: string | null;
  current_list_name: string | null;
  category: string;
  priority: string | null;
}

interface Move {
  task_id: string;
  task_title: string;
  from_list: string | null;
  from_list_id: string | null;
  to_list: string;
  to_list_id: string | null;
  is_new_list: boolean;
  reason: string;
}

interface OrganizationPlan {
  new_lists_to_create: string[];
  moves: Move[];
  summary: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { scope, list_id } = await req.json();
    console.log("[analyze-organization] Request received - scope:", scope, "list_id:", list_id);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get user ID from JWT
    const token = authHeader.replace("Bearer ", "");
    let userId: string;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      userId = payload.sub;
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[analyze-organization] Processing for user:", userId);

    // Fetch all lists for this user
    const { data: allLists, error: listsError } = await supabase
      .from("clerk_lists")
      .select("id, name, description")
      .eq("author_id", userId);

    if (listsError) {
      console.error("[analyze-organization] Lists fetch error:", listsError);
      throw new Error(`Failed to fetch lists: ${listsError.message}`);
    }

    console.log("[analyze-organization] Found lists:", allLists?.length);

    // Fetch tasks based on scope
    let tasksQuery = supabase
      .from("clerk_notes")
      .select("id, summary, original_text, category, priority, list_id, completed")
      .eq("author_id", userId)
      .eq("completed", false);

    if (scope === "list" && list_id) {
      tasksQuery = tasksQuery.eq("list_id", list_id);
    }

    const { data: tasks, error: tasksError } = await tasksQuery;

    if (tasksError) {
      console.error("[analyze-organization] Tasks fetch error:", tasksError);
      throw new Error(`Failed to fetch tasks: ${tasksError.message}`);
    }

    console.log("[analyze-organization] Found tasks:", tasks?.length);

    if (!tasks || tasks.length === 0) {
      return new Response(
        JSON.stringify({
          new_lists_to_create: [],
          moves: [],
          summary: "No tasks to organize.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build task info with list names
    const listMap = new Map(allLists?.map(l => [l.id, l.name]) || []);
    const taskInfos: TaskInfo[] = tasks.map(t => ({
      id: t.id,
      title: t.summary || t.original_text,
      summary: t.summary,
      current_list_id: t.list_id,
      current_list_name: t.list_id ? (listMap.get(t.list_id) || null) : null,
      category: t.category,
      priority: t.priority,
    }));

    const availableListNames = allLists?.map(l => l.name) || [];

    // Build the AI prompt
    const systemPrompt = `You are an expert Professional Organizer AI. Your goal is to declutter a user's generic lists and organize tasks into logical categories.

Current Context:
- Existing Lists: ${JSON.stringify(availableListNames)}
- Tasks to Review: ${JSON.stringify(taskInfos.map(t => ({ id: t.id, title: t.title, currentList: t.current_list_name })))}

Rules for Organization:
1. **Identify Clusters:** Look for groups of 2+ tasks related to a specific topic (e.g., Finance, Travel, Reading, Loyalty Programs, Receipts).
2. **Prioritize Existing Lists:** If a task fits a list that ALREADY exists, move it there. (e.g., "Read True Believer" -> "Books", "Almu AA Number" -> existing "Loyalty Numbers").
3. **Suggest New Lists:** If you find 3+ tasks that form a strong cluster but have no home, suggest a NEW list name (e.g., if you see multiple airline loyalty numbers, suggest "Loyalty Numbers").
4. **Be Conservative:** If a task is ambiguous, leave it alone. Only move things that clearly belong elsewhere.
5. **Generic Lists:** Items in generic lists like "Personal", "Inbox", "General", "Tasks", "Misc" are the main candidates for organization.
6. **Semantic Analysis:** Look for patterns like:
   - "Read X" or "Book about Y" → Books
   - "Receipt from X" or "Drop off receipt" → Receipts
   - "AA Number", "Loyalty", "Rewards" → Loyalty Numbers
   - "Watch X" or "Movie:" → Movies to Watch
   - "Buy X from Y" → Shopping
   - Restaurant names or "Try X restaurant" → Restaurants

Return ONLY valid JSON matching this exact schema:
{
  "new_lists_to_create": ["List Name 1", "List Name 2"],
  "moves": [
    {
      "task_id": "uuid",
      "task_title": "Task summary",
      "from_list": "Current List Name or null",
      "to_list": "Target List Name",
      "is_new_list": false,
      "reason": "Brief explanation"
    }
  ],
  "summary": "Brief summary of changes (e.g., 'Found 5 tasks to organize into 3 lists')"
}

Important:
- Do NOT include tasks that are already in the correct list
- Only suggest moves for tasks that would clearly benefit from reorganization
- Keep reasons concise (under 15 words)
- If no changes needed, return empty arrays`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("[analyze-organization] Calling AI for analysis...");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Analyze these tasks and suggest organization improvements. Return only valid JSON." },
        ],
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("[analyze-organization] AI API error:", aiResponse.status, errorText);
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No content in AI response");
    }

    console.log("[analyze-organization] Raw AI response:", content);

    // Parse the JSON from the response
    let plan: OrganizationPlan;
    try {
      // Try to extract JSON from the response (handle markdown code blocks)
      let jsonStr = content;
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      plan = JSON.parse(jsonStr.trim());
    } catch (e) {
      console.error("[analyze-organization] Failed to parse AI response:", e);
      return new Response(
        JSON.stringify({
          new_lists_to_create: [],
          moves: [],
          summary: "Unable to analyze tasks at this time.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Enrich moves with list IDs
    const enrichedMoves = plan.moves.map(move => {
      const existingList = allLists?.find(l => l.name.toLowerCase() === move.to_list.toLowerCase());
      const fromList = allLists?.find(l => l.name.toLowerCase() === move.from_list?.toLowerCase());
      return {
        ...move,
        to_list_id: existingList?.id || null,
        from_list_id: fromList?.id || null,
        is_new_list: !existingList && plan.new_lists_to_create.includes(move.to_list),
      };
    });

    const result: OrganizationPlan = {
      new_lists_to_create: plan.new_lists_to_create || [],
      moves: enrichedMoves,
      summary: plan.summary || `Found ${enrichedMoves.length} tasks to organize`,
    };

    console.log("[analyze-organization] Final plan:", JSON.stringify(result, null, 2));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[analyze-organization] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

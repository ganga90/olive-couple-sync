/**
 * Olive Conflicts — Schedule & Resource Conflict Detection
 *
 * Detects conflicts between tasks, events, delegations, and budgets.
 * Can run proactively (heartbeat) or on-demand.
 *
 * Actions:
 * - detect: Run conflict detection for a space
 * - list: Get open conflicts for a space
 * - resolve: Mark a conflict as resolved
 * - dismiss: Dismiss a conflict
 * - cross_space: Detect cross-space conflicts for a user
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { action } = body;

    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    let userId: string | null = null;
    if (token && token !== Deno.env.get("SUPABASE_ANON_KEY")) {
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id ?? null;
    }

    switch (action) {
      case "detect":
        return json(await detectConflicts(supabase, body, userId));
      case "list":
        return json(await listConflicts(supabase, body));
      case "resolve":
        return json(await resolveConflict(supabase, body, userId));
      case "dismiss":
        return json(await dismissConflict(supabase, body, userId));
      case "cross_space":
        return json(await detectCrossSpace(supabase, userId));
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("olive-conflicts error:", err);
    return json({ error: err.message }, 500);
  }
});

// ─── Detect Conflicts ────────────────────────────────────────

async function detectConflicts(supabase: any, body: any, userId: string | null) {
  const { space_id } = body;
  if (!space_id) return { error: "space_id required" };

  const conflicts: any[] = [];

  // 1. Schedule Overlaps — Tasks with overlapping due dates for same assignee
  const { data: tasks } = await supabase
    .from("clerk_notes")
    .select("id, title, due_date, author_id, reminder_time")
    .eq("space_id", space_id)
    .eq("is_completed", false)
    .not("due_date", "is", null)
    .order("due_date");

  if (tasks && tasks.length > 1) {
    // Group by user and check for same-hour conflicts
    const byUser: Record<string, any[]> = {};
    for (const task of tasks) {
      const uid = task.author_id;
      if (!byUser[uid]) byUser[uid] = [];
      byUser[uid].push(task);
    }

    for (const [uid, userTasks] of Object.entries(byUser)) {
      for (let i = 0; i < userTasks.length - 1; i++) {
        const a = userTasks[i];
        const b = userTasks[i + 1];
        const dateA = new Date(a.due_date);
        const dateB = new Date(b.due_date);
        const hoursDiff = Math.abs(dateB.getTime() - dateA.getTime()) / (1000 * 60 * 60);

        if (hoursDiff < 2) {
          conflicts.push({
            conflict_type: "schedule_overlap",
            severity: hoursDiff < 0.5 ? "high" : "medium",
            title: `Overlapping deadlines: "${a.title}" and "${b.title}"`,
            description: `Both tasks due within ${hoursDiff.toFixed(1)} hours of each other`,
            entity_a_type: "note",
            entity_a_id: a.id,
            entity_b_type: "note",
            entity_b_id: b.id,
            user_id: uid,
          });
        }
      }
    }
  }

  // 2. Assignment Overload — Member with too many active delegations
  const { data: members } = await supabase
    .from("olive_space_members")
    .select("user_id")
    .eq("space_id", space_id);

  for (const member of members || []) {
    const { count } = await supabase
      .from("olive_delegations")
      .select("*", { count: "exact", head: true })
      .eq("space_id", space_id)
      .eq("delegated_to", member.user_id)
      .in("status", ["pending", "accepted"]);

    if ((count || 0) > 5) {
      conflicts.push({
        conflict_type: "assignment_overload",
        severity: (count || 0) > 10 ? "critical" : "high",
        title: `Member overloaded with ${count} active delegations`,
        description: `Consider redistributing tasks or extending deadlines`,
        entity_a_type: "delegation",
        entity_a_id: member.user_id,
        entity_b_type: "delegation",
        entity_b_id: `count_${count}`,
        user_id: member.user_id,
      });
    }
  }

  // 3. Budget Conflicts — Over-budget categories
  const { data: budgets } = await supabase
    .from("budgets")
    .select("*")
    .eq("space_id", space_id)
    .eq("is_active", true);

  if (budgets && budgets.length > 0) {
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    firstOfMonth.setHours(0, 0, 0, 0);

    const { data: transactions } = await supabase
      .from("transactions")
      .select("category, amount")
      .eq("space_id", space_id)
      .gte("transaction_date", firstOfMonth.toISOString());

    const spending: Record<string, number> = {};
    for (const tx of transactions || []) {
      spending[tx.category] = (spending[tx.category] || 0) + parseFloat(tx.amount || 0);
    }

    for (const budget of budgets) {
      const spent = spending[budget.category] || 0;
      if (spent > parseFloat(budget.limit_amount)) {
        conflicts.push({
          conflict_type: "budget_conflict",
          severity: spent > parseFloat(budget.limit_amount) * 1.5 ? "critical" : "high",
          title: `${budget.category} over budget`,
          description: `Spent $${spent.toFixed(2)} of $${parseFloat(budget.limit_amount).toFixed(2)} limit`,
          entity_a_type: "budget",
          entity_a_id: budget.id,
          entity_b_type: "budget",
          entity_b_id: `spent_${spent.toFixed(0)}`,
          user_id: userId || members?.[0]?.user_id || "",
        });
      }
    }
  }

  // Insert new conflicts (avoid duplicates by checking recent)
  let inserted = 0;
  for (const conflict of conflicts) {
    // Check for existing open conflict with same entities
    const { data: existing } = await supabase
      .from("olive_conflicts")
      .select("id")
      .eq("space_id", space_id)
      .eq("entity_a_id", conflict.entity_a_id)
      .eq("entity_b_id", conflict.entity_b_id)
      .eq("status", "open")
      .maybeSingle();

    if (!existing) {
      await supabase.from("olive_conflicts").insert({
        space_id,
        ...conflict,
      });
      inserted++;
    }
  }

  return { detected: conflicts.length, new_conflicts: inserted };
}

// ─── List Conflicts ──────────────────────────────────────────

async function listConflicts(supabase: any, body: any) {
  const { space_id, status = "open" } = body;
  if (!space_id) return { error: "space_id required" };

  const { data, error } = await supabase
    .from("olive_conflicts")
    .select("*")
    .eq("space_id", space_id)
    .eq("status", status)
    .order("severity", { ascending: true })  // critical first
    .order("detected_at", { ascending: false });

  if (error) throw error;
  return { conflicts: data || [] };
}

// ─── Resolve Conflict ────────────────────────────────────────

async function resolveConflict(supabase: any, body: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };
  const { conflict_id, resolution } = body;
  if (!conflict_id) return { error: "conflict_id required" };

  const { error } = await supabase
    .from("olive_conflicts")
    .update({
      status: "resolved",
      resolution: resolution || null,
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", conflict_id);

  if (error) throw error;
  return { success: true };
}

// ─── Dismiss Conflict ────────────────────────────────────────

async function dismissConflict(supabase: any, body: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };
  const { conflict_id } = body;
  if (!conflict_id) return { error: "conflict_id required" };

  const { error } = await supabase
    .from("olive_conflicts")
    .update({ status: "dismissed", resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq("id", conflict_id);

  if (error) throw error;
  return { success: true };
}

// ─── Cross-Space Intelligence ────────────────────────────────

async function detectCrossSpace(supabase: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };

  // Get all spaces the user belongs to
  const { data: memberships } = await supabase
    .from("olive_space_members")
    .select("space_id")
    .eq("user_id", userId);

  const spaceIds = (memberships || []).map((m: any) => m.space_id);
  if (spaceIds.length < 2) return { insights: [], message: "Need 2+ spaces for cross-space intelligence" };

  const insights: any[] = [];

  // 1. Cross-space deadline conflicts — same user, overlapping deadlines across spaces
  const { data: allTasks } = await supabase
    .from("clerk_notes")
    .select("id, title, due_date, space_id")
    .eq("author_id", userId)
    .eq("is_completed", false)
    .not("due_date", "is", null)
    .in("space_id", spaceIds)
    .order("due_date")
    .limit(50);

  if (allTasks && allTasks.length > 1) {
    for (let i = 0; i < allTasks.length - 1; i++) {
      const a = allTasks[i];
      const b = allTasks[i + 1];
      if (a.space_id === b.space_id) continue; // Same space, skip

      const hoursDiff = Math.abs(
        new Date(b.due_date).getTime() - new Date(a.due_date).getTime()
      ) / (1000 * 60 * 60);

      if (hoursDiff < 4) {
        insights.push({
          insight_type: "scheduling_conflict",
          source_spaces: [a.space_id, b.space_id],
          title: "Cross-space deadline conflict",
          description: `"${a.title}" and "${b.title}" are due within ${hoursDiff.toFixed(1)} hours across different spaces`,
          suggestion: "Consider rescheduling one of these tasks",
          confidence: hoursDiff < 1 ? 0.9 : 0.6,
        });
      }
    }
  }

  // 2. Time optimization — tasks across spaces that could be batched
  // (Simplified: flag if user has many tasks due on the same day across spaces)
  const tasksByDate: Record<string, { spaces: Set<string>; count: number }> = {};
  for (const task of allTasks || []) {
    const dateKey = new Date(task.due_date).toISOString().split("T")[0];
    if (!tasksByDate[dateKey]) tasksByDate[dateKey] = { spaces: new Set(), count: 0 };
    tasksByDate[dateKey].spaces.add(task.space_id);
    tasksByDate[dateKey].count++;
  }

  for (const [date, info] of Object.entries(tasksByDate)) {
    if (info.spaces.size > 1 && info.count > 4) {
      insights.push({
        insight_type: "time_optimization",
        source_spaces: Array.from(info.spaces),
        title: `Busy day ahead: ${date}`,
        description: `${info.count} tasks due across ${info.spaces.size} spaces`,
        suggestion: "Consider spreading tasks across the week",
        confidence: 0.7,
      });
    }
  }

  // Save insights
  for (const insight of insights) {
    // Check for existing similar insight
    const { data: existing } = await supabase
      .from("olive_cross_space_insights")
      .select("id")
      .eq("user_id", userId)
      .eq("insight_type", insight.insight_type)
      .eq("title", insight.title)
      .eq("status", "new")
      .maybeSingle();

    if (!existing) {
      await supabase.from("olive_cross_space_insights").insert({
        user_id: userId,
        ...insight,
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      });
    }
  }

  return { insights, total: insights.length };
}

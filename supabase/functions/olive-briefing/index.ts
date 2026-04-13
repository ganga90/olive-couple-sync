/**
 * Olive Briefing — Per-Person Daily Briefing Engine
 *
 * Generates personalized briefings for each space member based on their
 * role, assigned tasks, delegations, and space activity.
 *
 * Actions:
 * - generate: Create a briefing for a specific user
 * - generate_space: Generate briefings for all members of a space
 * - get_latest: Fetch the most recent briefing for a user
 * - list: List recent briefings
 * - mark_read: Mark a briefing as read
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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const token = authHeader.replace("Bearer ", "");
    let userId: string;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      userId = payload.sub;
      if (!userId) throw new Error("No sub");
    } catch {
      return json({ error: "Invalid token" }, 401);
    }

    const body = await req.json();
    const { action, ...params } = body;

    switch (action) {
      case "generate":
        return json(await generateBriefing(supabase, userId, params));
      case "generate_space":
        return json(await generateSpaceBriefings(supabase, userId, params));
      case "get_latest":
        return json(await getLatestBriefing(supabase, userId, params));
      case "list":
        return json(await listBriefings(supabase, userId, params));
      case "mark_read":
        return json(await markRead(supabase, userId, params.id));
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("olive-briefing error:", err);
    return json({ error: "Internal error" }, 500);
  }
});

// ─── Generate Briefing ────────────────────────────────────────

interface GenerateParams {
  space_id?: string;
  briefing_type?: string;
}

async function generateBriefing(
  supabase: any,
  userId: string,
  params: GenerateParams
) {
  const briefingType = params.briefing_type || "daily";
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  // Get user profile
  const { data: profile } = await supabase
    .from("clerk_profiles")
    .select("display_name, first_name")
    .eq("user_id", userId)
    .maybeSingle();

  const userName = profile?.display_name || profile?.first_name || "there";

  // Sections for the briefing
  const sections: Array<{ heading: string; items: Array<{ text: string; note_id?: string; priority?: string }> }> = [];
  let taskCount = 0;
  let delegationCount = 0;

  // 1. Pending delegations assigned to me
  const { data: incomingDelegations } = await supabase
    .from("olive_delegations")
    .select("id, title, priority, delegated_by, created_at, snoozed_until, status")
    .or(`delegated_to.eq.${userId},reassigned_to.eq.${userId}`)
    .in("status", ["pending", "snoozed"])
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(10);

  if (incomingDelegations && incomingDelegations.length > 0) {
    const delegatorIds = [...new Set(incomingDelegations.map((d: any) => d.delegated_by))];
    const nameMap = await getUserNames(supabase, delegatorIds as string[]);

    const items = incomingDelegations.map((d: any) => ({
      text: `${d.priority === "urgent" ? "⚡ " : ""}${d.title} — from ${nameMap[d.delegated_by] || "someone"}${d.status === "snoozed" ? " (snoozed)" : ""}`,
      priority: d.priority,
    }));

    sections.push({ heading: "📋 Delegations waiting for you", items });
    delegationCount += incomingDelegations.length;
  }

  // 2. My active tasks (upcoming/overdue)
  const { data: myTasks } = await supabase
    .from("clerk_notes")
    .select("id, title, due_date, priority, status")
    .eq("user_id", userId)
    .eq("is_task", true)
    .neq("status", "completed")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(10);

  if (myTasks && myTasks.length > 0) {
    const overdue = myTasks.filter((t: any) => t.due_date && new Date(t.due_date) < now);
    const upcoming = myTasks.filter((t: any) => !overdue.includes(t));

    if (overdue.length > 0) {
      sections.push({
        heading: "🔴 Overdue tasks",
        items: overdue.map((t: any) => ({
          text: `${t.title}${t.due_date ? ` — due ${formatDate(t.due_date)}` : ""}`,
          note_id: t.id,
          priority: "high",
        })),
      });
      taskCount += overdue.length;
    }

    if (upcoming.length > 0) {
      sections.push({
        heading: "📅 Upcoming tasks",
        items: upcoming.slice(0, 5).map((t: any) => ({
          text: `${t.title}${t.due_date ? ` — due ${formatDate(t.due_date)}` : ""}`,
          note_id: t.id,
          priority: t.priority || "normal",
        })),
      });
      taskCount += upcoming.length;
    }
  }

  // 3. Delegations I'm tracking (outgoing, still pending)
  const { data: outgoingDelegations } = await supabase
    .from("olive_delegations")
    .select("id, title, delegated_to, status, created_at")
    .eq("delegated_by", userId)
    .in("status", ["pending", "accepted"])
    .order("created_at", { ascending: false })
    .limit(5);

  if (outgoingDelegations && outgoingDelegations.length > 0) {
    const assigneeIds = [...new Set(outgoingDelegations.map((d: any) => d.delegated_to))];
    const nameMap = await getUserNames(supabase, assigneeIds as string[]);

    sections.push({
      heading: "👀 Delegations you're tracking",
      items: outgoingDelegations.map((d: any) => ({
        text: `${d.title} — ${d.status === "accepted" ? "✅ accepted by" : "⏳ waiting on"} ${nameMap[d.delegated_to] || "someone"}`,
      })),
    });
  }

  // 4. Recent space activity (last 24h, if in a space)
  if (params.space_id) {
    const { data: activity } = await supabase
      .from("space_activity")
      .select("action, metadata, user_id, created_at")
      .eq("space_id", params.space_id)
      .neq("user_id", userId)
      .gte("created_at", twentyFourHoursAgo)
      .order("created_at", { ascending: false })
      .limit(8);

    if (activity && activity.length > 0) {
      const actorIds = [...new Set(activity.map((a: any) => a.user_id))];
      const nameMap = await getUserNames(supabase, actorIds as string[]);

      sections.push({
        heading: "🏠 Space activity",
        items: activity.map((a: any) => ({
          text: `${nameMap[a.user_id] || "Someone"} ${formatAction(a.action)}${a.metadata?.title ? `: ${a.metadata.title}` : ""}`,
        })),
      });
    }
  }

  // 5. Delegation summary stats (if there are any)
  const { data: recentCompleted } = await supabase
    .from("olive_delegations")
    .select("id")
    .eq("delegated_by", userId)
    .eq("status", "completed")
    .gte("completed_at", twentyFourHoursAgo);

  if (recentCompleted && recentCompleted.length > 0) {
    sections.push({
      heading: "🎉 Completed",
      items: [{ text: `${recentCompleted.length} delegation(s) completed in the last 24 hours` }],
    });
  }

  // Build summary
  const summaryParts: string[] = [];
  if (delegationCount > 0) summaryParts.push(`${delegationCount} delegation(s) need your attention`);
  if (taskCount > 0) summaryParts.push(`${taskCount} task(s) on your plate`);
  if (summaryParts.length === 0) summaryParts.push("You're all caught up!");
  const summary = `Good ${getTimeOfDay()}, ${userName}! ${summaryParts.join(", and ")}.`;

  const title = `${briefingType === "daily" ? "Daily" : briefingType === "weekly" ? "Weekly" : ""} Briefing — ${formatDate(now.toISOString())}`;

  // Save briefing
  const { data: briefing, error } = await supabase
    .from("olive_briefings")
    .insert({
      user_id: userId,
      space_id: params.space_id || null,
      briefing_type: briefingType,
      title,
      summary,
      sections,
      covers_from: twentyFourHoursAgo,
      covers_to: now.toISOString(),
      task_count: taskCount,
      delegation_count: delegationCount,
      delivered_via: ["app"],
    })
    .select()
    .single();

  if (error) return { error: error.message };

  return { success: true, briefing };
}

// ─── Generate Space Briefings ─────────────────────────────────
// Generate a briefing for every member in a space (used by heartbeat).

async function generateSpaceBriefings(
  supabase: any,
  userId: string,
  params: { space_id: string; briefing_type?: string }
) {
  const { space_id, briefing_type } = params;
  if (!space_id) return { error: "space_id is required" };

  // Get all members
  const { data: members } = await supabase
    .from("olive_space_members")
    .select("user_id")
    .eq("space_id", space_id);

  if (!members || members.length === 0) {
    return { error: "No members in space" };
  }

  const results: Array<{ user_id: string; success: boolean; briefing_id?: string; error?: string }> = [];

  for (const member of members) {
    try {
      const result = await generateBriefing(supabase, member.user_id, {
        space_id,
        briefing_type: briefing_type || "daily",
      });
      results.push({
        user_id: member.user_id,
        success: !!result.success,
        briefing_id: result.briefing?.id,
        error: result.error,
      });
    } catch (err) {
      results.push({
        user_id: member.user_id,
        success: false,
        error: String(err),
      });
    }
  }

  return { success: true, results, total: members.length };
}

// ─── Get Latest Briefing ──────────────────────────────────────

async function getLatestBriefing(
  supabase: any,
  userId: string,
  params: { space_id?: string; briefing_type?: string }
) {
  let query = supabase
    .from("olive_briefings")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (params.space_id) {
    query = query.eq("space_id", params.space_id);
  }
  if (params.briefing_type) {
    query = query.eq("briefing_type", params.briefing_type);
  }

  const { data, error } = await query.maybeSingle();
  if (error) return { error: error.message };

  return { briefing: data };
}

// ─── List Briefings ───────────────────────────────────────────

async function listBriefings(
  supabase: any,
  userId: string,
  params: { limit?: number; briefing_type?: string }
) {
  let query = supabase
    .from("olive_briefings")
    .select("id, briefing_type, title, summary, task_count, delegation_count, read_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(params.limit || 10);

  if (params.briefing_type) {
    query = query.eq("briefing_type", params.briefing_type);
  }

  const { data, error } = await query;
  if (error) return { error: error.message };

  return { briefings: data || [] };
}

// ─── Mark Read ────────────────────────────────────────────────

async function markRead(supabase: any, userId: string, briefingId: string) {
  if (!briefingId) return { error: "id is required" };

  const { error } = await supabase
    .from("olive_briefings")
    .update({ read_at: new Date().toISOString() })
    .eq("id", briefingId)
    .eq("user_id", userId);

  if (error) return { error: error.message };

  // Log engagement
  await supabase.from("olive_engagement_events").insert({
    user_id: userId,
    event_type: "briefing_read",
    metadata: { briefing_id: briefingId },
  });

  return { success: true };
}

// ─── Helpers ──────────────────────────────────────────────────

async function getUserNames(supabase: any, userIds: string[]): Promise<Record<string, string>> {
  if (userIds.length === 0) return {};
  const { data: profiles } = await supabase
    .from("clerk_profiles")
    .select("user_id, display_name, first_name")
    .in("user_id", userIds);

  const map: Record<string, string> = {};
  (profiles || []).forEach((p: any) => {
    map[p.user_id] = p.display_name || p.first_name || "Unknown";
  });
  return map;
}

function formatDate(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return isoStr;
  }
}

function formatAction(action: string): string {
  const map: Record<string, string> = {
    created_note: "created a note",
    completed_task: "completed a task",
    delegated: "delegated a task",
    accepted_delegation: "accepted a delegation",
    declined_delegation: "declined a delegation",
    completed_delegation: "completed a delegation",
    reassigned_delegation: "reassigned a delegation",
    reacted: "reacted to a note",
    commented: "commented",
    joined: "joined the space",
    left: "left the space",
  };
  return map[action] || action.replace(/_/g, " ");
}

function getTimeOfDay(): string {
  const hour = new Date().getUTCHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

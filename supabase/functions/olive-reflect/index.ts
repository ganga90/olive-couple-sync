/**
 * olive-reflect — Post-action reflection & engagement tracking.
 *
 * Called after any action completes (by orchestrator, agents, or frontend)
 * to record what happened and update engagement metrics.
 *
 * Actions:
 *   - record           : Record an action outcome (accepted/modified/rejected/ignored)
 *   - track_engagement  : Log an engagement event
 *   - get_reflections   : Get reflection history for the user
 *   - get_learning      : Get what Olive has learned (aggregated insights)
 *   - get_notifications : Get trust notifications (approvals, escalations, etc.)
 *   - dismiss_notification : Dismiss a notification
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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
      case "record":
        return json(await recordReflection(supabase, userId, params));
      case "track_engagement":
        return json(await trackEngagement(supabase, userId, params));
      case "get_reflections":
        return json(await getReflections(supabase, userId, params));
      case "get_learning":
        return json(await getLearning(supabase, userId));
      case "get_notifications":
        return json(await getNotifications(supabase, userId, params));
      case "dismiss_notification":
        return json(await dismissNotification(supabase, userId, params));
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("[olive-reflect] Error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Record Reflection ──────────────────────────────────────────
async function recordReflection(supabase: any, userId: string, params: any) {
  const { action_type, outcome, action_detail, user_modification, lesson, space_id } = params;

  if (!action_type || !outcome) {
    return { error: "action_type and outcome are required" };
  }

  const validOutcomes = ["accepted", "modified", "rejected", "ignored"];
  if (!validOutcomes.includes(outcome)) {
    return { error: `outcome must be one of: ${validOutcomes.join(", ")}` };
  }

  const { data, error } = await supabase
    .from("olive_reflections")
    .insert({
      user_id: userId,
      space_id: space_id || null,
      action_type,
      action_detail: action_detail || {},
      outcome,
      user_modification: user_modification || null,
      lesson: lesson || null,
      confidence: outcome === "accepted" ? 0.8 : outcome === "rejected" ? 0.9 : 0.6,
    })
    .select()
    .single();

  if (error) {
    console.error("[recordReflection] Error:", error);
    return { error: "Failed to record reflection" };
  }

  // Also log engagement event based on outcome
  const eventMap: Record<string, string> = {
    accepted: "proactive_accepted",
    rejected: "proactive_rejected",
    ignored: "proactive_ignored",
    modified: "proactive_accepted", // modified counts as accepted
  };

  await supabase.from("olive_engagement_events").insert({
    user_id: userId,
    event_type: eventMap[outcome] || "proactive_accepted",
    metadata: { action_type, reflection_id: data.id },
  });

  return { reflection: data };
}

// ─── Track Engagement Event ─────────────────────────────────────
async function trackEngagement(supabase: any, userId: string, params: any) {
  const { event_type, metadata } = params;

  if (!event_type) return { error: "event_type is required" };

  const validTypes = [
    "message_sent", "message_responded",
    "proactive_accepted", "proactive_ignored", "proactive_rejected",
    "action_approved", "action_rejected",
    "task_completed", "note_created", "session_start",
  ];

  if (!validTypes.includes(event_type)) {
    return { error: `event_type must be one of: ${validTypes.join(", ")}` };
  }

  const { error } = await supabase.from("olive_engagement_events").insert({
    user_id: userId,
    event_type,
    metadata: metadata || {},
  });

  if (error) {
    console.error("[trackEngagement] Error:", error);
    return { error: "Failed to track engagement" };
  }

  return { success: true };
}

// ─── Get Reflection History ─────────────────────────────────────
async function getReflections(supabase: any, userId: string, params: any) {
  const { limit = 30, offset = 0, action_type } = params;

  let query = supabase
    .from("olive_reflections")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (action_type) {
    query = query.eq("action_type", action_type);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[getReflections] Error:", error);
    return { error: "Failed to fetch reflections" };
  }

  return { reflections: data || [], count: data?.length || 0 };
}

// ─── Get Aggregated Learning Insights ───────────────────────────
async function getLearning(supabase: any, userId: string) {
  // Get last 30 days of reflections grouped by action_type
  const { data: reflections } = await supabase
    .from("olive_reflections")
    .select("action_type, outcome, lesson, created_at")
    .eq("user_id", userId)
    .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false });

  if (!reflections || reflections.length === 0) {
    return {
      total_reflections: 0,
      insights: [],
      top_lessons: [],
      summary: "Olive hasn't recorded enough interactions yet to generate insights.",
    };
  }

  // Group by action_type
  const byAction: Record<string, { accepted: number; rejected: number; modified: number; ignored: number; lessons: string[] }> = {};

  for (const r of reflections) {
    if (!byAction[r.action_type]) {
      byAction[r.action_type] = { accepted: 0, rejected: 0, modified: 0, ignored: 0, lessons: [] };
    }
    byAction[r.action_type][r.outcome as keyof typeof byAction[string]]++;
    if (r.lesson) byAction[r.action_type].lessons.push(r.lesson);
  }

  const insights = Object.entries(byAction).map(([actionType, stats]) => {
    const total = stats.accepted + stats.rejected + stats.modified + stats.ignored;
    const acceptRate = total > 0 ? (stats.accepted + stats.modified) / total : 0;

    let trend: string;
    if (acceptRate >= 0.8) trend = "strong_approval";
    else if (acceptRate >= 0.5) trend = "moderate_approval";
    else if (acceptRate >= 0.3) trend = "mixed";
    else trend = "low_approval";

    return {
      action_type: actionType,
      label: actionType.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
      total_interactions: total,
      acceptance_rate: Math.round(acceptRate * 100),
      trend,
      stats,
      recent_lessons: stats.lessons.slice(0, 3),
    };
  });

  // Sort by total interactions
  insights.sort((a, b) => b.total_interactions - a.total_interactions);

  // Top lessons
  const allLessons = reflections
    .filter((r: any) => r.lesson)
    .map((r: any) => ({ lesson: r.lesson, action_type: r.action_type, date: r.created_at }))
    .slice(0, 10);

  return {
    total_reflections: reflections.length,
    insights,
    top_lessons: allLessons,
    summary: `Olive has ${reflections.length} reflections across ${insights.length} action types in the last 30 days.`,
  };
}

// ─── Get Trust Notifications ────────────────────────────────────
async function getNotifications(supabase: any, userId: string, params: any) {
  const { unread_only = true, limit = 20 } = params;

  let query = supabase
    .from("olive_trust_notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unread_only) {
    query = query.is("read_at", null).is("dismissed_at", null);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[getNotifications] Error:", error);
    return { error: "Failed to fetch notifications" };
  }

  return { notifications: data || [], count: data?.length || 0 };
}

// ─── Dismiss Notification ───────────────────────────────────────
async function dismissNotification(supabase: any, userId: string, params: any) {
  const { notification_id, read_only } = params;
  if (!notification_id) return { error: "notification_id is required" };

  const updates: any = { read_at: new Date().toISOString() };
  if (!read_only) {
    updates.dismissed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("olive_trust_notifications")
    .update(updates)
    .eq("id", notification_id)
    .eq("user_id", userId);

  if (error) return { error: "Failed to dismiss notification" };

  return { success: true };
}

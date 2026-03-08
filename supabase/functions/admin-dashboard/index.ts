import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function verifyAdmin(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;
  const payload = JSON.parse(atob(token.split(".")[1]));
  return payload.sub || null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const userId = verifyAdmin(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify admin role
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action } = await req.json();

    if (action === "analytics") {
      const analytics = await getAnalytics(supabaseAdmin);
      return new Response(JSON.stringify(analytics), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Default: list feedback
    const { data: betaRequests } = await supabaseAdmin
      .from("beta_feedback")
      .select("id, user_name, contact_email, message, created_at, category")
      .eq("category", "beta_request")
      .order("created_at", { ascending: false })
      .limit(100);

    const { data: feedback } = await supabaseAdmin
      .from("beta_feedback")
      .select("id, user_name, contact_email, message, created_at, category, page")
      .neq("category", "beta_request")
      .order("created_at", { ascending: false })
      .limit(100);

    return new Response(
      JSON.stringify({ betaRequests: betaRequests || [], feedback: feedback || [] }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("[admin-dashboard] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Analytics aggregation (privacy-first: only counts and percentages) ──────

async function getAnalytics(sb: any) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Run all queries in parallel for speed
  const [
    totalUsersRes,
    recentUsersRes,
    totalNotesRes,
    recentNotesRes,
    completedNotesRes,
    sensitiveNotesRes,
    notesByCategoryRes,
    notesBySourceRes,
    notesByPriorityRes,
    notesLast30dRes,
    totalCouplesRes,
    totalListsRes,
    calendarConnectionsRes,
    calendarEventsRes,
    whatsappNotesRes,
    routerLogsRes,
    routerIntentsRes,
    agentRunsRes,
    agentRunsCompletedRes,
    memoryFilesRes,
    memoryChunksRes,
    notificationsRes,
    feedbackCountRes,
    betaCountRes,
    privacyDistRes,
    activeUsersRes,
    ouraConnectionsRes,
    emailConnectionsRes,
    auditLogRes,
  ] = await Promise.all([
    // User metrics
    sb.from("clerk_profiles").select("id", { count: "exact", head: true }),
    sb.from("clerk_profiles").select("id", { count: "exact", head: true }).gte("created_at", thirtyDaysAgo),
    // Note metrics
    sb.from("clerk_notes").select("id", { count: "exact", head: true }),
    sb.from("clerk_notes").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
    sb.from("clerk_notes").select("id", { count: "exact", head: true }).eq("completed", true),
    sb.from("clerk_notes").select("id", { count: "exact", head: true }).eq("is_sensitive", true),
    // Category breakdown
    sb.from("clerk_notes").select("category"),
    // Source breakdown
    sb.from("clerk_notes").select("source"),
    // Priority breakdown
    sb.from("clerk_notes").select("priority"),
    // Notes created per day (last 30 days) - we'll get created_at only
    sb.from("clerk_notes").select("created_at").gte("created_at", thirtyDaysAgo).order("created_at", { ascending: true }),
    // Couples
    sb.from("clerk_couples").select("id", { count: "exact", head: true }),
    // Lists
    sb.from("clerk_lists").select("id", { count: "exact", head: true }),
    // Calendar
    sb.from("calendar_connections").select("id", { count: "exact", head: true }).eq("is_active", true),
    sb.from("calendar_events").select("id", { count: "exact", head: true }),
    // WhatsApp notes
    sb.from("clerk_notes").select("id", { count: "exact", head: true }).eq("source", "whatsapp"),
    // AI Router
    sb.from("olive_router_log").select("id", { count: "exact", head: true }),
    sb.from("olive_router_log").select("classified_intent, confidence"),
    // Agent runs
    sb.from("olive_agent_runs").select("id", { count: "exact", head: true }),
    sb.from("olive_agent_runs").select("id", { count: "exact", head: true }).eq("status", "completed"),
    // Memory
    sb.from("olive_memory_files").select("id", { count: "exact", head: true }),
    sb.from("olive_memory_chunks").select("id", { count: "exact", head: true }),
    // Notifications
    sb.from("notifications").select("id", { count: "exact", head: true }),
    // Feedback
    sb.from("beta_feedback").select("id", { count: "exact", head: true }).neq("category", "beta_request"),
    sb.from("beta_feedback").select("id", { count: "exact", head: true }).eq("category", "beta_request"),
    // Privacy distribution
    sb.from("clerk_profiles").select("default_privacy"),
    // Active users (notes in last 7 days) — distinct author_ids
    sb.from("clerk_notes").select("author_id").gte("created_at", sevenDaysAgo),
    // Oura
    sb.from("oura_connections").select("id", { count: "exact", head: true }).eq("is_active", true),
    // Email
    sb.from("olive_email_connections").select("id", { count: "exact", head: true }).eq("is_active", true),
    // Audit log
    sb.from("decryption_audit_log").select("id", { count: "exact", head: true }),
  ]);

  // Aggregate category breakdown
  const categoryMap: Record<string, number> = {};
  (notesByCategoryRes.data || []).forEach((n: any) => {
    categoryMap[n.category] = (categoryMap[n.category] || 0) + 1;
  });

  // Aggregate source breakdown
  const sourceMap: Record<string, number> = {};
  (notesBySourceRes.data || []).forEach((n: any) => {
    const src = n.source || "web";
    sourceMap[src] = (sourceMap[src] || 0) + 1;
  });

  // Aggregate priority breakdown
  const priorityMap: Record<string, number> = {};
  (notesByPriorityRes.data || []).forEach((n: any) => {
    const p = n.priority || "none";
    priorityMap[p] = (priorityMap[p] || 0) + 1;
  });

  // Daily note creation (last 30 days)
  const dailyNotes: Record<string, number> = {};
  (notesLast30dRes.data || []).forEach((n: any) => {
    const day = n.created_at?.substring(0, 10);
    if (day) dailyNotes[day] = (dailyNotes[day] || 0) + 1;
  });

  // Privacy distribution
  const privacyMap: Record<string, number> = {};
  (privacyDistRes.data || []).forEach((p: any) => {
    const val = p.default_privacy || "shared";
    privacyMap[val] = (privacyMap[val] || 0) + 1;
  });

  // Active users (distinct)
  const activeUserIds = new Set((activeUsersRes.data || []).map((n: any) => n.author_id).filter(Boolean));

  // Intent distribution & avg confidence
  const intentMap: Record<string, number> = {};
  let totalConfidence = 0;
  let confidenceCount = 0;
  (routerIntentsRes.data || []).forEach((r: any) => {
    const intent = r.classified_intent || "unknown";
    intentMap[intent] = (intentMap[intent] || 0) + 1;
    if (r.confidence != null) {
      totalConfidence += r.confidence;
      confidenceCount++;
    }
  });

  const totalNotes = totalNotesRes.count || 0;
  const completedNotes = completedNotesRes.count || 0;

  return {
    overview: {
      totalUsers: totalUsersRes.count || 0,
      newUsersLast30d: recentUsersRes.count || 0,
      activeUsersLast7d: activeUserIds.size,
      totalCouples: totalCouplesRes.count || 0,
      totalLists: totalListsRes.count || 0,
    },
    notes: {
      total: totalNotes,
      createdLast7d: recentNotesRes.count || 0,
      completed: completedNotes,
      completionRate: totalNotes > 0 ? Math.round((completedNotes / totalNotes) * 100) : 0,
      sensitive: sensitiveNotesRes.count || 0,
      sensitiveRate: totalNotes > 0 ? Math.round(((sensitiveNotesRes.count || 0) / totalNotes) * 100) : 0,
      byCategory: categoryMap,
      bySource: sourceMap,
      byPriority: priorityMap,
      dailyCreation: dailyNotes,
    },
    channels: {
      whatsappNotes: whatsappNotesRes.count || 0,
      calendarConnections: calendarConnectionsRes.count || 0,
      calendarEvents: calendarEventsRes.count || 0,
      ouraConnections: ouraConnectionsRes.count || 0,
      emailConnections: emailConnectionsRes.count || 0,
    },
    ai: {
      totalRouterCalls: routerLogsRes.count || 0,
      avgConfidence: confidenceCount > 0 ? Math.round((totalConfidence / confidenceCount) * 100) : 0,
      intentDistribution: intentMap,
      agentRuns: agentRunsRes.count || 0,
      agentCompleted: agentRunsCompletedRes.count || 0,
      agentSuccessRate:
        (agentRunsRes.count || 0) > 0
          ? Math.round(((agentRunsCompletedRes.count || 0) / (agentRunsRes.count || 0)) * 100)
          : 0,
    },
    memory: {
      totalFiles: memoryFilesRes.count || 0,
      totalChunks: memoryChunksRes.count || 0,
    },
    privacy: {
      distribution: privacyMap,
      decryptionAuditEvents: auditLogRes.count || 0,
    },
    engagement: {
      totalNotifications: notificationsRes.count || 0,
      totalFeedback: feedbackCountRes.count || 0,
      totalBetaRequests: betaCountRes.count || 0,
    },
  };
}

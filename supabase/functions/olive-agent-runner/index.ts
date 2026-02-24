import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const geminiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY") || "";

// ─── Agent Context ──────────────────────────────────────────────
interface AgentContext {
  supabase: ReturnType<typeof createClient<any>>;
  genai: GoogleGenAI;
  userId: string;
  coupleId?: string;
  agentId: string;
  config: Record<string, unknown>;
  previousState: Record<string, unknown>;
  runId: string;
}

// ─── Agent Result ───────────────────────────────────────────────
interface AgentResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
  state?: Record<string, unknown>; // persisted for next run
  notifyUser?: boolean;
  notificationMessage?: string;
}

// ─── Agent Dispatcher ───────────────────────────────────────────
async function runAgent(ctx: AgentContext): Promise<AgentResult> {
  switch (ctx.agentId) {
    case "stale-task-strategist":
      return runStaleTaskStrategist(ctx);
    case "smart-bill-reminder":
      return runSmartBillReminder(ctx);
    case "energy-task-suggester":
      return runEnergyTaskSuggester(ctx);
    case "sleep-optimization-coach":
      return runSleepOptimizationCoach(ctx);
    case "birthday-gift-agent":
      return runBirthdayGiftAgent(ctx);
    case "weekly-couple-sync":
      return runWeeklyCoupleSyncAgent(ctx);
    default:
      return { success: false, message: `Unknown agent: ${ctx.agentId}` };
  }
}

// ─── Agent 1: Stale Task Strategist ─────────────────────────────
async function runStaleTaskStrategist(ctx: AgentContext): Promise<AgentResult> {
  const stalenessdays = (ctx.config.staleness_days as number) || 14;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - stalenessdays);

  const { data: staleTasks } = await ctx.supabase
    .from("clerk_notes")
    .select("id, summary, category, priority, created_at, list_id")
    .eq("author_id", ctx.userId)
    .eq("completed", false)
    .is("due_date", null)
    .lt("created_at", cutoff.toISOString())
    .order("created_at", { ascending: true })
    .limit(15);

  if (!staleTasks || staleTasks.length === 0) {
    return { success: true, message: "No stale tasks found", notifyUser: false };
  }

  const taskList = staleTasks
    .map((t, i) => {
      const age = Math.floor((Date.now() - new Date(t.created_at).getTime()) / (1000 * 60 * 60 * 24));
      return `${i + 1}. "${t.summary}" — ${age} days old, priority: ${t.priority || "none"}, category: ${t.category || "uncategorized"}`;
    })
    .join("\n");

  const response = await ctx.genai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `You are a productivity coach for a couples app called Olive.

Analyze these stale tasks (not completed, no due date, older than ${stalenessdays} days). For each, suggest ONE action:
- BREAK_DOWN: Task is too big, suggest 2-3 smaller sub-tasks
- DELEGATE: Could be assigned to partner
- RESCHEDULE: Set a specific deadline to create urgency
- ARCHIVE: No longer relevant, safe to remove

Tasks:
${taskList}

Reply in this format for a WhatsApp message (keep it concise, max 1000 chars total):
📋 Task Strategist Report

[For each task, one line:]
• "[task name]" → [ACTION]: [brief reason]

End with a motivational one-liner.`,
    config: { temperature: 0.3, maxOutputTokens: 800 },
  });

  const analysis = response.text || "Could not analyze tasks.";

  return {
    success: true,
    message: analysis,
    data: { tasksAnalyzed: staleTasks.length },
    notifyUser: true,
    notificationMessage: analysis,
  };
}

// ─── Agent 2: Smart Bill Reminder ───────────────────────────────
async function runSmartBillReminder(ctx: AgentContext): Promise<AgentResult> {
  const reminderDays = (ctx.config.reminder_days as number[]) || [3, 1];
  const maxLookahead = Math.max(...reminderDays) + 1;
  const now = new Date();
  const lookAheadDate = new Date();
  lookAheadDate.setDate(now.getDate() + maxLookahead);

  // Find notes with due dates that are bill/payment/finance related
  const { data: bills } = await ctx.supabase
    .from("clerk_notes")
    .select("id, summary, due_date, category, priority, tags")
    .eq("author_id", ctx.userId)
    .eq("completed", false)
    .not("due_date", "is", null)
    .lte("due_date", lookAheadDate.toISOString())
    .order("due_date", { ascending: true });

  if (!bills || bills.length === 0) {
    return { success: true, message: "No upcoming bills", notifyUser: false };
  }

  // Filter to bill-related notes
  const billKeywords = ["bill", "payment", "pay", "rent", "utilities", "insurance", "subscription", "invoice"];
  const billNotes = bills.filter((note) => {
    const text = `${note.summary} ${note.category || ""} ${(note.tags || []).join(" ")}`.toLowerCase();
    return note.category === "finance" || note.category === "bill" || billKeywords.some((k) => text.includes(k));
  });

  if (billNotes.length === 0) {
    return { success: true, message: "No bill-related due dates", notifyUser: false };
  }

  // Group by urgency
  const overdue: string[] = [];
  const dueToday: string[] = [];
  const dueSoon: string[] = [];

  for (const bill of billNotes) {
    const dueDate = new Date(bill.due_date);
    const daysUntil = Math.floor((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    const label = `"${bill.summary}" (${dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`;
    if (daysUntil < 0) overdue.push(label);
    else if (daysUntil === 0) dueToday.push(label);
    else dueSoon.push(label);
  }

  let message = "💰 Bill Reminder\n\n";
  if (overdue.length > 0) message += `🔴 OVERDUE:\n${overdue.map((b) => `• ${b}`).join("\n")}\n\n`;
  if (dueToday.length > 0) message += `🟡 DUE TODAY:\n${dueToday.map((b) => `• ${b}`).join("\n")}\n\n`;
  if (dueSoon.length > 0) message += `🟢 Coming up:\n${dueSoon.map((b) => `• ${b}`).join("\n")}\n\n`;
  message += 'Reply "show bills" to see all details.';

  return {
    success: true,
    message,
    data: { overdue: overdue.length, dueToday: dueToday.length, dueSoon: dueSoon.length },
    notifyUser: true,
    notificationMessage: message,
  };
}

// ─── Agent 3: Energy-Aware Task Suggester ───────────────────────
async function runEnergyTaskSuggester(ctx: AgentContext): Promise<AgentResult> {
  // Fetch Oura data
  const { data: ouraConn } = await ctx.supabase
    .from("oura_connections")
    .select("is_active")
    .eq("user_id", ctx.userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!ouraConn) {
    return { success: true, message: "Oura not connected", notifyUser: false };
  }

  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  const { data: ouraData } = await ctx.supabase
    .from("oura_daily_data")
    .select("day, readiness_score, sleep_score, stress_high_minutes, resilience_level")
    .eq("user_id", ctx.userId)
    .in("day", [today, yesterday])
    .order("day", { ascending: false });

  const latestOura = ouraData?.[0];
  if (!latestOura || !latestOura.readiness_score) {
    return { success: true, message: "No Oura data available", notifyUser: false };
  }

  // Fetch today's tasks
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const { data: tasks } = await ctx.supabase
    .from("clerk_notes")
    .select("id, summary, priority, category")
    .eq("author_id", ctx.userId)
    .eq("completed", false)
    .gte("due_date", todayStart.toISOString())
    .lte("due_date", todayEnd.toISOString())
    .order("priority", { ascending: true })
    .limit(10);

  if (!tasks || tasks.length === 0) {
    return { success: true, message: "No tasks scheduled for today", notifyUser: false };
  }

  const taskList = tasks.map((t, i) => `${i + 1}. "${t.summary}" (priority: ${t.priority || "normal"}, category: ${t.category || "general"})`).join("\n");

  const response = await ctx.genai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `You are an energy-aware productivity coach.

User's biometrics today:
- Readiness: ${latestOura.readiness_score}/100
- Sleep: ${latestOura.sleep_score || "N/A"}/100
- Stress (high minutes): ${latestOura.stress_high_minutes || "N/A"}
- Resilience: ${latestOura.resilience_level || "N/A"}

Today's tasks:
${taskList}

Based on their energy level, suggest the optimal order to tackle these tasks. Keep it brief (3-4 sentences max) for a WhatsApp message. Start with an energy emoji (🔋/⚡/😴) based on readiness score.`,
    config: { temperature: 0.3, maxOutputTokens: 400 },
  });

  return {
    success: true,
    message: response.text || "",
    data: { readiness: latestOura.readiness_score, taskCount: tasks.length },
    notifyUser: false, // This appends to morning briefing, not separate message
  };
}

// ─── Agent 4: Sleep Optimization Coach ──────────────────────────
async function runSleepOptimizationCoach(ctx: AgentContext): Promise<AgentResult> {
  const { data: ouraConn } = await ctx.supabase
    .from("oura_connections")
    .select("is_active")
    .eq("user_id", ctx.userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!ouraConn) {
    return { success: true, message: "Oura not connected", notifyUser: false };
  }

  // Fetch 7 days of sleep data
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  const { data: sleepData } = await ctx.supabase
    .from("oura_daily_data")
    .select("day, sleep_score, readiness_score, raw_data")
    .eq("user_id", ctx.userId)
    .gte("day", weekAgo)
    .order("day", { ascending: true });

  if (!sleepData || sleepData.length < 3) {
    return { success: true, message: "Not enough sleep data (need 3+ days)", notifyUser: false };
  }

  // Check if we already sent a tip recently
  const sentTips = (ctx.previousState.sent_tips as string[]) || [];
  const lastTipDate = ctx.previousState.last_tip_date as string;
  if (lastTipDate) {
    const daysSinceLastTip = Math.floor((Date.now() - new Date(lastTipDate).getTime()) / 86400000);
    if (daysSinceLastTip < 2 && ctx.config.sensitivity === "actionable_only") {
      return { success: true, message: "Too soon since last tip", notifyUser: false };
    }
  }

  const sleepSummary = sleepData
    .map((d) => `${d.day}: sleep=${d.sleep_score || "?"}, readiness=${d.readiness_score || "?"}`)
    .join("\n");

  const response = await ctx.genai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `You are a sleep optimization coach. Analyze this 7-day sleep data and provide ONE actionable tip.

Data:
${sleepSummary}

Previously sent tips (don't repeat these): ${sentTips.join(", ") || "none"}

Rules:
- Only respond if there's a clear pattern or issue (declining scores, inconsistency, low scores)
- If everything looks good, respond with exactly "ALL_GOOD"
- Keep the tip under 280 chars for WhatsApp
- Start with 🛏️ and be encouraging, not preachy
- Be specific (e.g., "try a 10pm bedtime" not "sleep earlier")`,
    config: { temperature: 0.3, maxOutputTokens: 300 },
  });

  const tip = response.text || "";
  if (tip.includes("ALL_GOOD")) {
    return { success: true, message: "Sleep looks good, no tip needed", notifyUser: false };
  }

  return {
    success: true,
    message: tip,
    notifyUser: true,
    notificationMessage: tip,
    state: {
      sent_tips: [...sentTips.slice(-5), tip.substring(0, 80)],
      last_tip_date: new Date().toISOString(),
    },
  };
}

// ─── Agent 5: Anniversary & Birthday Gifter ─────────────────────
async function runBirthdayGiftAgent(ctx: AgentContext): Promise<AgentResult> {
  const tiers = (ctx.config.reminder_tiers as number[]) || [30, 14, 7];
  const maxDays = Math.max(...tiers);

  // Note: get_upcoming_dates RPC needs to be created. For now, return gracefully.
  // TODO: Create the get_upcoming_dates database function
  const dates: any[] = [];
  // Placeholder - this agent requires a get_upcoming_dates DB function to work

  if (!dates || dates.length === 0) {
    return { success: true, message: "No upcoming dates", notifyUser: false };
  }

  // Filter to dates matching our tiers (±1 day buffer)
  const matchingDates = dates.filter((d: { days_until: number }) => tiers.some((tier) => Math.abs(d.days_until - tier) <= 1));

  if (matchingDates.length === 0) {
    return { success: true, message: "No dates in reminder window", notifyUser: false };
  }

  // Check what we've already suggested (from previous runs)
  const previousSuggestions = (ctx.previousState.suggestions as Record<string, string[]>) || {};

  const messages: string[] = [];
  const newState: Record<string, string[]> = { ...previousSuggestions };

  for (const date of matchingDates) {
    const dateKey = `${date.title}_${date.event_date}`;
    const daysUntil = date.days_until;

    // Get memory context for personalization
    const { data: memory } = await ctx.supabase
      .from("olive_memory_files")
      .select("content")
      .eq("user_id", ctx.userId)
      .eq("file_type", "profile")
      .maybeSingle();

    if (daysUntil >= 25 && !previousSuggestions[dateKey]) {
      // First reminder (30 days) — generate gift ideas
      const response = await ctx.genai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `You are a thoughtful gift advisor for a couples app.

Upcoming event: ${date.title} in ${daysUntil} days (${date.event_date})
Person's profile context: ${memory?.content || "No specific preferences known"}
Budget: ${ctx.config.budget_range || "moderate ($30-100)"}

Suggest 3 gift ideas. Format for WhatsApp:
🎁 ${date.title} is in ${daysUntil} days!

1. [Gift idea] — ~$XX
2. [Gift idea] — ~$XX
3. [Gift idea] — ~$XX

Keep it warm and personal.`,
        config: { temperature: 0.7, maxOutputTokens: 400 },
      });

      const suggestion = response.text || "";
      messages.push(suggestion);
      newState[dateKey] = [suggestion];
    } else if (daysUntil >= 10 && daysUntil <= 15) {
      messages.push(`🔔 Reminder: ${date.title} is in ${daysUntil} days! Have you picked a gift yet?`);
    } else if (daysUntil <= 8) {
      messages.push(`⚡ Last call: ${date.title} is in ${daysUntil} days! Time to order if you haven't yet.`);
    }
  }

  if (messages.length === 0) {
    return { success: true, message: "No messages to send", notifyUser: false };
  }

  return {
    success: true,
    message: messages.join("\n\n"),
    notifyUser: true,
    notificationMessage: messages.join("\n\n"),
    state: { suggestions: newState },
  };
}

// ─── Agent 6: Weekly Couple Sync ────────────────────────────────
async function runWeeklyCoupleSyncAgent(ctx: AgentContext): Promise<AgentResult> {
  if (!ctx.coupleId) {
    return { success: true, message: "No couple linked", notifyUser: false };
  }

  // Get partner IDs from couple_members table
  const { data: members } = await ctx.supabase
    .from("clerk_couple_members")
    .select("user_id")
    .eq("couple_id", ctx.coupleId);

  if (!members || members.length === 0) {
    return { success: true, message: "Couple members not found", notifyUser: false };
  }

  const partnerIds = members.map((m: { user_id: string }) => m.user_id).filter(Boolean);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  // Fetch both partners' activity
  const { data: completed } = await ctx.supabase
    .from("clerk_notes")
    .select("author_id, summary")
    .in("author_id", partnerIds)
    .eq("completed", true)
    .gte("updated_at", weekAgo);

  const { data: pending } = await ctx.supabase
    .from("clerk_notes")
    .select("author_id, summary, priority, due_date")
    .in("author_id", partnerIds)
    .eq("completed", false)
    .limit(20);

  // Get partner names
  const { data: profiles } = await ctx.supabase
    .from("clerk_profiles")
    .select("id, display_name")
    .in("id", partnerIds);

  const getName = (uid: string) => profiles?.find((p: { id: string; display_name: string | null }) => p.id === uid)?.display_name || "Partner";

  const partnerSummaries = partnerIds.map((pid: string) => {
    const myCompleted = (completed || []).filter((t: { author_id: string }) => t.author_id === pid);
    const myPending = (pending || []).filter((t: { author_id: string }) => t.author_id === pid);
    return `${getName(pid)}:
  ✅ Completed: ${myCompleted.length} tasks
  ⏳ Pending: ${myPending.length} tasks${myPending.filter((t: { priority: string | null }) => t.priority === "high").length > 0 ? ` (${myPending.filter((t: { priority: string | null }) => t.priority === "high").length} high priority)` : ""}`;
  });

  const response = await ctx.genai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `You are a couples coordination assistant. Generate a brief weekly sync summary.

This week's activity:
${partnerSummaries.join("\n\n")}

Total completed across couple: ${(completed || []).length}
Total pending: ${(pending || []).length}

Generate a warm, brief WhatsApp message (max 600 chars) that:
1. Celebrates what was accomplished together
2. Highlights what's still pending
3. Suggests 1-2 discussion topics for the couple's weekly check-in
Start with 💑 Weekly Sync`,
    config: { temperature: 0.5, maxOutputTokens: 500 },
  });

  return {
    success: true,
    message: response.text || "",
    data: { completedTotal: (completed || []).length, pendingTotal: (pending || []).length, sendToBoth: true, partnerIds },
    notifyUser: true,
    notificationMessage: response.text || "",
  };
}

// ─── HTTP Handler ───────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, agent_id, user_id, couple_id, config_override } = await req.json();
    const supabase = createClient(supabaseUrl, supabaseKey);
    const genai = new GoogleGenAI({ apiKey: geminiKey });

    if (action === "run") {
      // Fetch agent definition
      const { data: agent } = await supabase
        .from("olive_skills")
        .select("skill_id, agent_config, requires_approval")
        .eq("skill_id", agent_id)
        .eq("agent_type", "background_agent")
        .maybeSingle();

      if (!agent) {
        return new Response(JSON.stringify({ success: false, error: "Agent not found" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        });
      }

      // Get previous state (most recent completed run)
      const { data: prevRun } = await supabase
        .from("olive_agent_runs")
        .select("state")
        .eq("agent_id", agent_id)
        .eq("user_id", user_id)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Create run record
      const { data: run } = await supabase
        .from("olive_agent_runs")
        .insert({
          agent_id,
          user_id,
          couple_id,
          status: "running",
          state: prevRun?.state || {},
        })
        .select("id")
        .single();

      const ctx: AgentContext = {
        supabase,
        genai,
        userId: user_id,
        coupleId: couple_id,
        agentId: agent_id,
        config: { ...(agent.agent_config || {}), ...(config_override || {}) },
        previousState: prevRun?.state || {},
        runId: run!.id,
      };

      const result = await runAgent(ctx);

      // Update run record
      await supabase
        .from("olive_agent_runs")
        .update({
          status: result.success ? "completed" : "failed",
          result: { message: result.message, data: result.data },
          state: result.state || ctx.previousState,
          error_message: result.success ? null : result.message,
          completed_at: new Date().toISOString(),
        })
        .eq("id", run!.id);

      // Send notification if needed
      if (result.notifyUser && result.notificationMessage) {
        // Queue via WhatsApp gateway
        await supabase.functions.invoke("whatsapp-gateway", {
          body: {
            action: "send",
            message: {
              user_id,
              message_type: "system_alert",
              content: result.notificationMessage,
              priority: "normal",
            },
          },
        });

        // Also create in-app notification
        await supabase.from("notifications").insert({
          user_id,
          type: "agent_result",
          title: agent_id.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
          message: result.notificationMessage.substring(0, 200),
          metadata: { agent_id, run_id: run!.id },
          priority: 5,
        });
      }

      // For couple sync, also notify partner
      if (result.data?.sendToBoth && result.data?.partnerIds) {
        const partnerIds = result.data.partnerIds as string[];
        const partnerId = partnerIds.find((id) => id !== user_id);
        if (partnerId && result.notificationMessage) {
          await supabase.functions.invoke("whatsapp-gateway", {
            body: {
              action: "send",
              message: {
                user_id: partnerId,
                message_type: "system_alert",
                content: result.notificationMessage,
                priority: "normal",
              },
            },
          });
        }
      }

      return new Response(JSON.stringify({ success: true, result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get_last_run") {
      const { data } = await supabase
        .from("olive_agent_runs")
        .select("id, status, result, started_at, completed_at, error_message")
        .eq("agent_id", agent_id)
        .eq("user_id", user_id)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return new Response(JSON.stringify({ success: true, lastRun: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get_recent_runs") {
      const { data } = await supabase
        .from("olive_agent_runs")
        .select("id, agent_id, status, result, started_at, completed_at, error_message")
        .eq("user_id", user_id)
        .order("started_at", { ascending: false })
        .limit(20);

      return new Response(JSON.stringify({ success: true, runs: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

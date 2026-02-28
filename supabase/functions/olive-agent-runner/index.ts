import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const geminiKey = Deno.env.get("GEMINI_API") || Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY") || "";

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

// ─── Trivial results that should NOT be persisted to memory ────
const TRIVIAL_MESSAGES = [
  "no stale tasks found",
  "no upcoming bills",
  "no bill-related due dates",
  "oura not connected",
  "no oura data available",
  "no tasks scheduled for today",
  "not enough sleep data",
  "too soon since last tip",
  "sleep looks good, no tip needed",
  "no upcoming dates",
  "no dates in reminder window",
  "no messages to send",
  "no couple linked",
  "couple members not found",
  "gmail not connected",
  "email triage set to manual",
  "could not fetch dates",
];

function isTrivialResult(message: string): boolean {
  const lower = (message || "").toLowerCase().trim();
  return TRIVIAL_MESSAGES.some((t) => lower.startsWith(t)) || lower.startsWith("too soon (");
}

// ─── Persist Agent Result to Memory Systems ─────────────────────
async function persistAgentResultToMemory(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  agentId: string,
  result: AgentResult
): Promise<void> {
  // Skip trivial/non-meaningful results
  if (!result.success || !result.message || isTrivialResult(result.message)) {
    return;
  }

  const agentDisplayName = agentId
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c: string) => c.toUpperCase());
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
  const truncatedMessage = result.message.substring(0, 1000);

  // 1. Append to daily log (olive_memory_files via append_to_daily_log RPC)
  try {
    const logContent = `### Agent: ${agentDisplayName}\n${truncatedMessage}`;
    await supabase.rpc("append_to_daily_log", {
      p_user_id: userId,
      p_source: `agent:${agentId}`,
      p_content: logContent,
    });
    console.log(`[Agent Memory] Appended daily log for ${agentId}`);
  } catch (err) {
    console.error(`[Agent Memory] append_to_daily_log failed for ${agentId}:`, err);
  }

  // 2. Upsert into user_memories for immediate webhook access
  try {
    const memoryTitle = `${agentDisplayName} - ${dateStr}`;
    const { error: memErr } = await supabase
      .from("user_memories")
      .upsert(
        {
          user_id: userId,
          title: memoryTitle,
          content: truncatedMessage,
          category: "agent_insight",
          importance: result.notifyUser ? 4 : 2,
          metadata: {
            agent_id: agentId,
            data: result.data || {},
            generated_at: now.toISOString(),
          },
          is_active: true,
        },
        { onConflict: "user_id,title" }
      );
    if (memErr) {
      // Fallback: try plain insert if upsert fails (no unique index yet)
      console.warn(`[Agent Memory] upsert failed, trying insert: ${memErr.message}`);
      await supabase.from("user_memories").insert({
        user_id: userId,
        title: memoryTitle,
        content: truncatedMessage,
        category: "agent_insight",
        importance: result.notifyUser ? 4 : 2,
        metadata: {
          agent_id: agentId,
          data: result.data || {},
          generated_at: now.toISOString(),
        },
        is_active: true,
      });
    }
    console.log(`[Agent Memory] Saved user_memory for ${agentId}`);
  } catch (err) {
    console.error(`[Agent Memory] user_memories insert failed for ${agentId}:`, err);
  }
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
    case "email-triage-agent":
      return runEmailTriageAgent(ctx);
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

  // Build richer data for frontend rendering
  const tasksSummary = staleTasks.map((t) => {
    const age = Math.floor((Date.now() - new Date(t.created_at).getTime()) / (1000 * 60 * 60 * 24));
    return { id: t.id, summary: t.summary, ageDays: age, priority: t.priority || "none" };
  });

  return {
    success: true,
    message: analysis,
    data: { tasksAnalyzed: staleTasks.length, tasks: tasksSummary },
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
  message += 'Open Olive to see bill details: https://witholive.app';

  // Build richer data for frontend rendering
  const billsData = billNotes.map((bill) => {
    const dueDate = new Date(bill.due_date);
    const daysUntil = Math.floor((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return {
      summary: bill.summary,
      due_date: bill.due_date,
      daysUntil,
      urgency: daysUntil < 0 ? "overdue" : daysUntil === 0 ? "today" : "upcoming",
    };
  });

  return {
    success: true,
    message,
    data: { overdue: overdue.length, dueToday: dueToday.length, dueSoon: dueSoon.length, bills: billsData },
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

  const energyMessage = response.text || "";
  return {
    success: true,
    message: energyMessage,
    data: { readiness: latestOura.readiness_score, sleepScore: latestOura.sleep_score, taskCount: tasks.length },
    notifyUser: true,
    notificationMessage: energyMessage,
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

  // Call the get_upcoming_dates RPC function
  // Returns: id, event_name, event_date, event_type, days_until, related_person, reminder_days, should_remind
  const { data: dates, error: datesErr } = await ctx.supabase.rpc("get_upcoming_dates", {
    p_user_id: ctx.userId,
    p_days_ahead: maxDays + 2,
  });

  if (datesErr) {
    console.error("[birthday-gift] RPC error:", datesErr.message);
    return { success: true, message: "Could not fetch dates", notifyUser: false };
  }

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
    const eventName = date.event_name;
    const dateKey = `${eventName}_${date.event_date}`;
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
      const personContext = date.related_person ? `For: ${date.related_person}` : "";
      const response = await ctx.genai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `You are a thoughtful gift advisor for a couples app.

Upcoming event: ${eventName} in ${daysUntil} days (${date.event_date})
${personContext}
Person's profile context: ${memory?.content || "No specific preferences known"}
Budget: ${ctx.config.budget_range || "moderate ($30-100)"}

Suggest 3 gift ideas. Format for WhatsApp:
🎁 ${eventName} is in ${daysUntil} days!

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
      messages.push(`🔔 Reminder: ${eventName} is in ${daysUntil} days! Have you picked a gift yet?`);
    } else if (daysUntil <= 8) {
      messages.push(`⚡ Last call: ${eventName} is in ${daysUntil} days! Time to order if you haven't yet.`);
    }
  }

  if (messages.length === 0) {
    return { success: true, message: "No messages to send", notifyUser: false };
  }

  // Richer data for frontend
  const eventsData = matchingDates.map((d: { event_name: string; event_date: string; days_until: number }) => ({
    name: d.event_name,
    date: d.event_date,
    daysUntil: d.days_until,
  }));

  // State cleanup: prune suggestions for events more than 60 days old (Phase 3d)
  const prunedState: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(newState)) {
    const datePart = key.split("_").pop() || "";
    const eventDate = new Date(datePart);
    if (isNaN(eventDate.getTime()) || (Date.now() - eventDate.getTime()) < 60 * 86400000) {
      prunedState[key] = val;
    }
  }

  return {
    success: true,
    message: messages.join("\n\n"),
    data: { events: eventsData },
    notifyUser: true,
    notificationMessage: messages.join("\n\n"),
    state: { suggestions: prunedState },
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

// ─── Agent 7: Email Triage Agent ─────────────────────────────────
async function runEmailTriageAgent(ctx: AgentContext): Promise<AgentResult> {
  // Check if Gmail is connected and get preferences
  const { data: emailConn } = await ctx.supabase
    .from("olive_email_connections")
    .select("is_active, triage_frequency, triage_lookback_days, auto_save_tasks")
    .eq("user_id", ctx.userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!emailConn) {
    return { success: true, message: "Gmail not connected", notifyUser: false };
  }

  // Check frequency — only skip if explicitly set to manual
  const frequency = emailConn.triage_frequency || "12h"; // Default to 12h if not set
  if (frequency === "manual") {
    return { success: true, message: "Email triage set to manual — skipping", notifyUser: false };
  }

  const lastTriage = ctx.previousState.last_triage as string;
  if (lastTriage) {
    const hoursSinceLast = (Date.now() - new Date(lastTriage).getTime()) / (1000 * 60 * 60);
    const freqHours = frequency === "1h" ? 1 : frequency === "6h" ? 6 : frequency === "12h" ? 12 : 24;
    if (hoursSinceLast < freqHours * 0.9) { // 10% buffer
      return { success: true, message: `Too soon (${Math.round(hoursSinceLast)}h since last run, freq=${frequency})`, notifyUser: false };
    }
  }

  // Pass previously processed email IDs from state for dedup (read-only scope, can't label)
  const previouslyProcessedIds = (ctx.previousState.processed_ids as string[]) || [];

  // Invoke the olive-email-mcp function to run the triage pipeline
  const { data, error } = await ctx.supabase.functions.invoke("olive-email-mcp", {
    body: {
      action: "triage",
      user_id: ctx.userId,
      couple_id: ctx.coupleId,
      processed_ids: previouslyProcessedIds,
    },
  });

  if (error) {
    return {
      success: false,
      message: `Email triage failed: ${error.message}`,
      notifyUser: false,
    };
  }

  if (!data?.success) {
    return {
      success: false,
      message: data?.error || "Email triage failed",
      notifyUser: false,
    };
  }

  const tasksCreated = data.tasks_created || 0;
  const emailsProcessed = data.emails_processed || 0;

  // Build a clear, structured notification message with date range
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  
  let notificationMsg = `📧 *Olive Email Review — ${dateStr}*\n\n`;
  notificationMsg += `Scanned ${emailsProcessed} email${emailsProcessed > 1 ? "s" : ""} from your primary inbox.\n\n`;
  
  if (tasksCreated > 0) {
    notificationMsg += `✅ Found ${tasksCreated} action item${tasksCreated > 1 ? "s" : ""}:\n\n`;
    notificationMsg += `${data.summary || ""}\n\n`;
    notificationMsg += `Tasks have been added to your Olive inbox. Open the app to review.`;
  } else {
    notificationMsg += `All clear — no action items found. You're on top of it! 🎉`;
  }

  return {
    success: true,
    message: data.summary || `Processed ${emailsProcessed} emails, created ${tasksCreated} tasks`,
    data: { tasks_created: tasksCreated, emails_processed: emailsProcessed },
    notifyUser: true, // Always notify user after email triage (they want to know it ran)
    notificationMessage: notificationMsg,
    state: {
      last_triage: new Date().toISOString(),
      total_tasks_created: ((ctx.previousState.total_tasks_created as number) || 0) + tasksCreated,
      total_emails_processed: ((ctx.previousState.total_emails_processed as number) || 0) + emailsProcessed,
      // Cap processed_ids at 500 to prevent unbounded state growth (Phase 3d)
      processed_ids: (data.processed_ids || previouslyProcessedIds).slice(-500),
    },
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

      // Persist meaningful results to memory systems (Phase 1)
      await persistAgentResultToMemory(supabase, user_id, agent_id, result);

      // Send notification if needed
      if (result.notifyUser && result.notificationMessage) {
        console.log(`[Agent Runner] notifyUser=true for ${agent_id}, sending WhatsApp...`);
        
        // Check per-agent WhatsApp opt-out preference
        const { data: userSkill } = await supabase
          .from("olive_user_skills")
          .select("config")
          .eq("user_id", user_id)
          .eq("skill_id", agent_id)
          .maybeSingle();

        const whatsAppEnabled = (userSkill?.config as Record<string, unknown>)?.whatsapp_notify !== false;
        console.log(`[Agent Runner] WhatsApp enabled for ${agent_id}: ${whatsAppEnabled}`);

        if (whatsAppEnabled) {
          // Queue via WhatsApp gateway (using agent_insight template for rich content)
          try {
            const { data: gwData, error: gwError } = await supabase.functions.invoke("whatsapp-gateway", {
              body: {
                action: "send",
                message: {
                  user_id,
                  message_type: "agent_insight",
                  content: result.notificationMessage,
                  priority: "normal",
                },
              },
            });
            
            if (gwError) {
              console.error(`[Agent Runner] WhatsApp gateway invocation error for ${agent_id}:`, gwError);
            } else {
              console.log(`[Agent Runner] WhatsApp gateway result for ${agent_id}:`, JSON.stringify(gwData));
            }
          } catch (gwCatchErr) {
            console.error(`[Agent Runner] WhatsApp gateway threw for ${agent_id}:`, gwCatchErr);
          }
        }

        // Create in-app notification (guarded — table may not exist)
        try {
          await supabase.from("notifications").insert({
            user_id,
            type: "agent_result",
            title: agent_id.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
            message: result.notificationMessage.substring(0, 200),
            metadata: { agent_id, run_id: run!.id },
            priority: 5,
          });
        } catch {
          // notifications table may not exist yet — silently skip
        }
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
                message_type: "agent_insight",
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

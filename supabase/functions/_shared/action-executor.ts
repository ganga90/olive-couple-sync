/**
 * Shared Action Executor — "The Hands"
 * =====================================
 * Executes database mutations for classified intents.
 * Both whatsapp-webhook and ask-olive-individual import this
 * instead of duplicating action execution logic.
 *
 * Handles: complete, set_priority, set_due, remind, delete,
 *          save_memory, partner_message
 *
 * Tables used:
 *   clerk_notes      — Tasks (id, author_id, couple_id, summary, priority, completed, due_date, reminder_time, task_owner)
 *   user_memories     — Memories (id, user_id, title, content, category, importance, is_active)
 *   clerk_couples     — Couple info (id, you_name, partner_name, created_by)
 *   clerk_couple_members — Couple membership (couple_id, user_id)
 *   clerk_profiles    — User profiles (id, phone_number, display_name)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ClassifiedIntent } from "./intent-classifier.ts";

// ─── Types ─────────────────────────────────────────────────────

export interface ActionResult {
  type: string;
  task_id?: string;
  task_summary?: string;
  success: boolean;
  details?: Record<string, any>;
}

type SupabaseClient = ReturnType<typeof createClient<any>>;

// ─── Supported Action Intents ──────────────────────────────────

export const ACTION_INTENTS = [
  "complete",
  "set_priority",
  "set_due",
  "delete",
  "remind",
  "save_memory",
  "partner_message",
] as const;

// ─── Relative Reference Patterns ───────────────────────────────
// Detects "last task", "the latest one", "l'ultima attività", etc.

const RELATIVE_REF_PATTERNS = [
  /^(?:the\s+)?(?:last|latest|most\s+recent|previous|newest|recent)\s+(?:task|one|item|note|thing)$/i,
  /^(?:the\s+)?(?:last|latest|most\s+recent|previous|newest|recent)\s+(?:task|one|item|note|thing)\s+(?:i\s+)?(?:added|created|saved|sent|made)$/i,
  /^(?:that|the)\s+(?:task|one|item|note|thing)\s+(?:i\s+)?(?:just\s+)?(?:added|created|saved|sent|made)$/i,
  /^(?:l'ultima|l'ultimo|ultima|ultimo)\s*(?:attività|compito|nota|cosa)?$/i,
  /^(?:la\s+)?(?:última|ultimo|reciente)\s*(?:tarea|nota|cosa)?$/i,
];

function isRelativeRef(target: string): boolean {
  return RELATIVE_REF_PATTERNS.some((p) => p.test(target.trim()));
}

// ─── Task Resolution ───────────────────────────────────────────

/**
 * Resolve a task ID from the classified intent.
 * 1. If UUID in target_task_id → use directly
 * 2. If target_task_name is relative ref → resolve to most recent uncompleted task
 * 3. If target_task_name is text → ilike search in clerk_notes
 * 4. Returns null if no match found
 */
async function resolveTaskId(
  supabase: SupabaseClient,
  intent: ClassifiedIntent,
  userId: string,
  coupleId: string | null
): Promise<{ taskId: string | null; taskSummary: string | null }> {
  let taskId = intent.target_task_id;
  let taskSummary = intent.target_task_name;

  // Check for relative references ("last task", "latest one", etc.)
  if (taskSummary && isRelativeRef(taskSummary)) {
    console.log("[ActionExecutor] Detected relative reference:", taskSummary);
    let query = supabase
      .from("clerk_notes")
      .select("id, summary, due_date, priority")
      .eq("completed", false)
      .order("created_at", { ascending: false })
      .limit(1);

    if (coupleId) {
      query = query.or(
        `author_id.eq.${userId},couple_id.eq.${coupleId}`
      );
    } else {
      query = query.eq("author_id", userId);
    }

    const { data: recentTasks } = await query;
    if (recentTasks && recentTasks.length > 0) {
      taskId = recentTasks[0].id;
      taskSummary = recentTasks[0].summary;
      console.log("[ActionExecutor] Resolved relative ref to:", taskSummary);
    }
  }

  // Search by name if no UUID provided
  if (!taskId && taskSummary && !isRelativeRef(taskSummary)) {
    const { data: tasks } = await supabase
      .from("clerk_notes")
      .select("id, summary, due_date, priority")
      .or(
        `author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ""}`
      )
      .eq("completed", false)
      .ilike("summary", `%${taskSummary}%`)
      .limit(1);

    if (tasks && tasks.length > 0) {
      taskId = tasks[0].id;
      taskSummary = tasks[0].summary;
    }
  }

  return { taskId, taskSummary };
}

// ─── Natural Language Date Parsing ─────────────────────────────
// Supports: relative (in X mins/hours/days), named (tomorrow, next week),
//           explicit (3pm, 10:30 AM), multilingual (IT/ES)

const WORD_TO_NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15,
  twenty: 20, thirty: 30, un: 1, una: 1, dos: 2, media: 0.5, mezza: 0.5,
};

function resolveNum(t: string): number | null {
  const n = parseInt(t);
  return !isNaN(n) ? n : (WORD_TO_NUM[t.toLowerCase()] ?? null);
}

export function parseNaturalDate(
  dateExpr: string
): { date: Date; readable: string } | null {
  const now = new Date();
  let targetDate: Date | null = null;
  let readable = "";
  const lower = dateExpr.toLowerCase().trim();

  // ── Relative time ──────────────────────────────────
  const halfHourMatch = lower.match(
    /(?:half\s+(?:an?\s+)?hour|mezz'?ora|media\s+hora)/i
  );
  const minMatch = lower.match(
    /in\s+([\w'-]+(?:\s+[\w'-]+)?)\s*(?:min(?:ute)?s?|minuto?s?|minut[io])/i
  );
  const hrMatch = lower.match(
    /in\s+([\w'-]+(?:\s+[\w'-]+)?)\s*(?:hours?|hrs?|or[ae]s?|or[ae])/i
  );
  const dayMatch = lower.match(
    /in\s+([\w'-]+(?:\s+[\w'-]+)?)\s*(?:days?|días?|dias?|giorn[io])/i
  );

  if (halfHourMatch) {
    targetDate = new Date(now);
    targetDate.setMinutes(targetDate.getMinutes() + 30);
    readable = "in 30 minutes";
  } else if (minMatch) {
    const num = resolveNum(minMatch[1].trim());
    if (num) {
      targetDate = new Date(now);
      targetDate.setMinutes(targetDate.getMinutes() + Math.round(num));
      readable = `in ${Math.round(num)} minutes`;
    }
  } else if (hrMatch) {
    const num = resolveNum(hrMatch[1].trim());
    if (num) {
      targetDate = new Date(now);
      if (num === 0.5) {
        targetDate.setMinutes(targetDate.getMinutes() + 30);
        readable = "in 30 minutes";
      } else {
        targetDate.setHours(targetDate.getHours() + Math.round(num));
        readable = `in ${Math.round(num)} hour${num > 1 ? "s" : ""}`;
      }
    }
  } else if (dayMatch) {
    const num = resolveNum(dayMatch[1].trim());
    if (num) {
      targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + Math.round(num));
      targetDate.setHours(9, 0, 0, 0);
      readable = `in ${Math.round(num)} day${num > 1 ? "s" : ""}`;
    }
  }

  // ── Named dates ────────────────────────────────────
  if (!targetDate) {
    if (
      lower.includes("tomorrow") ||
      /\bmañana\b/.test(lower) ||
      lower.includes("domani")
    ) {
      targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + 1);
      targetDate.setHours(9, 0, 0, 0);
      readable = "tomorrow";
    } else if (
      lower.includes("today") ||
      lower.includes("hoy") ||
      lower.includes("oggi")
    ) {
      targetDate = new Date(now);
      targetDate.setHours(18, 0, 0, 0);
      readable = "today";
    } else if (
      lower.includes("next week") ||
      lower.includes("próxima semana") ||
      lower.includes("prossima settimana")
    ) {
      targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + 7);
      targetDate.setHours(9, 0, 0, 0);
      readable = "next week";
    } else if (
      lower.includes("this weekend") ||
      lower.includes("este fin de semana") ||
      lower.includes("questo weekend")
    ) {
      targetDate = new Date(now);
      const daysUntilSat = (6 - targetDate.getDay() + 7) % 7 || 7;
      targetDate.setDate(targetDate.getDate() + daysUntilSat);
      targetDate.setHours(10, 0, 0, 0);
      readable = "this weekend";
    }
  }

  // ── Named time-of-day ──────────────────────────────
  let hours: number | null = null;
  let mins = 0;
  if (
    /\bnoon\b|\bmidday\b|\bmezzogiorno\b|\bmediodía\b|\bmediodia\b/.test(lower)
  ) {
    hours = 12;
  } else if (lower.includes("morning") || lower.includes("mattina")) {
    hours = 9;
  } else if (
    lower.includes("afternoon") ||
    lower.includes("pomeriggio") ||
    lower.includes("tarde")
  ) {
    hours = 14;
  } else if (
    lower.includes("evening") ||
    lower.includes("sera") ||
    lower.includes("noche")
  ) {
    hours = 18;
  } else if (lower.includes("night") || lower.includes("notte")) {
    hours = 20;
  } else if (
    lower.includes("midnight") ||
    lower.includes("mezzanotte") ||
    lower.includes("medianoche")
  ) {
    hours = 0;
  }

  // ── Explicit time: "3pm", "10:30 AM" ───────────────
  const timeMatch = lower.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)/i);
  if (timeMatch) {
    hours = parseInt(timeMatch[1]);
    mins = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    if (timeMatch[3].toLowerCase() === "pm" && hours < 12) hours += 12;
    if (timeMatch[3].toLowerCase() === "am" && hours === 12) hours = 0;
  }

  // ── Standalone time with no date → today (or tomorrow if passed)
  if (!targetDate && hours !== null) {
    targetDate = new Date(now);
    const proposed = new Date(now);
    proposed.setHours(hours, mins, 0, 0);
    if (proposed <= now) {
      targetDate.setDate(targetDate.getDate() + 1);
      readable = "tomorrow";
    } else {
      readable = "today";
    }
  }

  // ── Apply time to date ─────────────────────────────
  if (targetDate && hours !== null) {
    targetDate.setHours(hours, mins, 0, 0);
    if (!readable.includes("minute") && !readable.includes("hour")) {
      readable += ` at ${hours > 12 ? hours - 12 : hours === 0 ? 12 : hours}:${mins.toString().padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
    }
  }

  if (!targetDate) return null;
  return { date: targetDate, readable };
}

// ─── Action Handlers ───────────────────────────────────────────

async function handleComplete(
  supabase: SupabaseClient,
  taskId: string,
  taskSummary: string
): Promise<ActionResult> {
  const { error } = await supabase
    .from("clerk_notes")
    .update({ completed: true, updated_at: new Date().toISOString() })
    .eq("id", taskId);

  if (error) throw error;
  console.log("[ActionExecutor] Completed task:", taskSummary);
  return {
    type: "complete",
    task_id: taskId,
    task_summary: taskSummary,
    success: true,
  };
}

async function handleSetPriority(
  supabase: SupabaseClient,
  taskId: string,
  taskSummary: string,
  priority: string | null
): Promise<ActionResult> {
  const newPriority =
    priority?.toLowerCase() === "low" ? "low" : "high";
  const { error } = await supabase
    .from("clerk_notes")
    .update({ priority: newPriority, updated_at: new Date().toISOString() })
    .eq("id", taskId);

  if (error) throw error;
  console.log("[ActionExecutor] Set priority:", taskSummary, "→", newPriority);
  return {
    type: "set_priority",
    task_id: taskId,
    task_summary: taskSummary,
    success: true,
    details: { new_priority: newPriority },
  };
}

async function handleSetDueOrRemind(
  supabase: SupabaseClient,
  taskId: string,
  taskSummary: string,
  intentType: string,
  dateExpression: string | null
): Promise<ActionResult | null> {
  if (!dateExpression) return null;

  const parsed = parseNaturalDate(dateExpression);
  if (!parsed) return null;

  const updateField = intentType === "remind" ? "reminder_time" : "due_date";
  const { error } = await supabase
    .from("clerk_notes")
    .update({
      [updateField]: parsed.date.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId);

  if (error) throw error;
  console.log(
    `[ActionExecutor] Set ${updateField}:`,
    taskSummary,
    "→",
    parsed.date.toISOString()
  );
  return {
    type: intentType,
    task_id: taskId,
    task_summary: taskSummary,
    success: true,
    details: {
      [`new_${updateField}`]: parsed.date.toISOString(),
      readable: parsed.readable,
    },
  };
}

async function handleDelete(
  supabase: SupabaseClient,
  taskId: string,
  taskSummary: string
): Promise<ActionResult> {
  const { error } = await supabase
    .from("clerk_notes")
    .delete()
    .eq("id", taskId);

  if (error) throw error;
  console.log("[ActionExecutor] Deleted task:", taskSummary);
  return {
    type: "delete",
    task_id: taskId,
    task_summary: taskSummary,
    success: true,
  };
}

async function handleSaveMemory(
  supabase: SupabaseClient,
  userId: string,
  intent: ClassifiedIntent,
  rawMessage?: string
): Promise<ActionResult> {
  // Extract memory content from the classified intent or raw message
  const content = intent.target_task_name || rawMessage || "";
  if (!content) {
    return {
      type: "save_memory",
      success: false,
      details: { error: "no_content" },
    };
  }

  const { error } = await supabase.from("user_memories").insert({
    user_id: userId,
    title: content.substring(0, 100),
    content: content,
    category: "preference",
    importance: 3,
    is_active: true,
  });

  if (error) throw error;
  console.log("[ActionExecutor] Saved memory:", content.substring(0, 80));
  return {
    type: "save_memory",
    success: true,
    details: { saved: content.substring(0, 100) },
  };
}

async function handlePartnerMessage(
  supabase: SupabaseClient,
  userId: string,
  coupleId: string | null,
  intent: ClassifiedIntent
): Promise<ActionResult> {
  const partnerMsgContent =
    intent.parameters?.partner_message_content ||
    intent.target_task_name ||
    "";
  const partnerAction = intent.parameters?.partner_action || "tell";

  if (!coupleId || !partnerMsgContent) {
    return {
      type: "partner_message",
      success: false,
      details: { error: !coupleId ? "no_couple" : "no_content" },
    };
  }

  // Find partner
  const { data: partnerMember } = await supabase
    .from("clerk_couple_members")
    .select("user_id")
    .eq("couple_id", coupleId)
    .neq("user_id", userId)
    .limit(1)
    .single();

  if (!partnerMember?.user_id) {
    return {
      type: "partner_message",
      success: false,
      details: { error: "no_partner" },
    };
  }

  // Get couple info for names
  const { data: coupleInfo } = await supabase
    .from("clerk_couples")
    .select("you_name, partner_name, created_by")
    .eq("id", coupleId)
    .single();

  const isCreator = coupleInfo?.created_by === userId;
  const partnerName = isCreator
    ? coupleInfo?.partner_name || "Partner"
    : coupleInfo?.you_name || "Partner";
  const senderName = isCreator
    ? coupleInfo?.you_name || "Your partner"
    : coupleInfo?.partner_name || "Your partner";
  const partnerId = partnerMember.user_id;

  // Get partner phone
  const { data: partnerProfile } = await supabase
    .from("clerk_profiles")
    .select("phone_number, last_user_message_at")
    .eq("id", partnerId)
    .single();

  if (!partnerProfile?.phone_number) {
    return {
      type: "partner_message",
      success: false,
      task_summary: partnerName,
      details: { error: "no_phone", partner_name: partnerName },
    };
  }

  // Determine if task-like → save as assigned task
  const isTaskLike =
    /\b(buy|get|pick up|call|book|make|schedule|clean|fix|do|send|bring|take|comprar|llamar|hacer|enviar|comprare|chiamare|fare|inviare)\b/i.test(
      partnerMsgContent
    );
  let savedTaskSummary = partnerMsgContent;

  if (isTaskLike) {
    try {
      const { data: processData } = await supabase.functions.invoke(
        "process-note",
        {
          body: {
            text: partnerMsgContent,
            user_id: userId,
            couple_id: coupleId,
          },
        }
      );
      const noteData = {
        author_id: userId,
        couple_id: coupleId,
        original_text: partnerMsgContent,
        summary: processData?.summary || partnerMsgContent,
        category: processData?.category || "task",
        priority: processData?.priority || "medium",
        task_owner: partnerId,
        completed: false,
        tags: processData?.tags || [],
        items: processData?.items || [],
        due_date: processData?.due_date || null,
        list_id: processData?.list_id || null,
      };
      const { data: inserted } = await supabase
        .from("clerk_notes")
        .insert(noteData)
        .select("id, summary")
        .single();
      if (inserted) savedTaskSummary = inserted.summary;
    } catch (e) {
      console.error("[ActionExecutor] Partner task creation error:", e);
    }
  }

  // Send WhatsApp message to partner via gateway
  const actionEmoji: Record<string, string> = {
    remind: "⏰",
    tell: "💬",
    ask: "❓",
    notify: "📢",
  };
  const emoji = actionEmoji[partnerAction] || "💬";
  const partnerMsg =
    partnerAction === "remind"
      ? `${emoji} Reminder from ${senderName}:\n\n${savedTaskSummary}\n\nReply "done" when finished 🫒`
      : partnerAction === "ask"
        ? `${emoji} ${senderName} is asking:\n\n${partnerMsgContent}\n\nReply to let them know 🫒`
        : `${emoji} Message from ${senderName}:\n\n${savedTaskSummary}\n\n🫒 Olive`;

  try {
    await supabase.functions.invoke("whatsapp-gateway", {
      body: {
        action: "send",
        message: {
          user_id: partnerId,
          message_type: "partner_notification",
          content: partnerMsg,
          priority: "normal",
          metadata: {
            from_user_id: userId,
            from_name: senderName,
            action: partnerAction,
          },
        },
      },
    });
  } catch (sendErr) {
    console.error("[ActionExecutor] Gateway send error:", sendErr);
    return {
      type: "partner_message",
      success: true,
      task_summary: savedTaskSummary,
      details: {
        partner_name: partnerName,
        sent: false,
        task_created: isTaskLike,
      },
    };
  }

  return {
    type: "partner_message",
    success: true,
    task_summary: savedTaskSummary,
    details: {
      partner_name: partnerName,
      sent: true,
      task_created: isTaskLike,
      action: partnerAction,
    },
  };
}

// ─── Main Dispatcher ───────────────────────────────────────────

/**
 * Execute a database action based on the classified intent.
 *
 * @param supabase — Supabase client (service role key for bypassing RLS)
 * @param intent — The classified intent from the shared classifier
 * @param userId — Current user ID
 * @param coupleId — Current couple ID (null if no couple space)
 * @param rawMessage — Original user message (used for save_memory content)
 * @returns ActionResult or null if intent is not actionable
 */
export async function executeAction(
  supabase: SupabaseClient,
  intent: ClassifiedIntent,
  userId: string,
  coupleId: string | null,
  rawMessage?: string
): Promise<ActionResult | null> {
  // Only handle action intents
  if (!ACTION_INTENTS.includes(intent.intent as any)) return null;

  // Require minimum confidence
  if (intent.confidence < 0.5) {
    console.log(
      `[ActionExecutor] Skipping ${intent.intent} — confidence ${intent.confidence} < 0.5`
    );
    return null;
  }

  try {
    // save_memory doesn't need task resolution
    if (intent.intent === "save_memory") {
      return await handleSaveMemory(supabase, userId, intent, rawMessage);
    }

    // partner_message has its own resolution flow
    if (intent.intent === "partner_message") {
      return await handlePartnerMessage(supabase, userId, coupleId, intent);
    }

    // All other intents need task resolution
    const { taskId, taskSummary } = await resolveTaskId(
      supabase,
      intent,
      userId,
      coupleId
    );

    if (!taskId) {
      console.warn(
        "[ActionExecutor] No task found for:",
        intent.target_task_name
      );
      return null;
    }

    switch (intent.intent) {
      case "complete":
        return await handleComplete(supabase, taskId, taskSummary || "");

      case "set_priority":
        return await handleSetPriority(
          supabase,
          taskId,
          taskSummary || "",
          intent.parameters?.priority || null
        );

      case "set_due":
      case "remind":
        return await handleSetDueOrRemind(
          supabase,
          taskId,
          taskSummary || "",
          intent.intent,
          intent.parameters?.due_date_expression || null
        );

      case "delete":
        return await handleDelete(supabase, taskId, taskSummary || "");

      default:
        return null;
    }
  } catch (error) {
    console.error(`[ActionExecutor] Error in ${intent.intent}:`, error);
    return null;
  }
}

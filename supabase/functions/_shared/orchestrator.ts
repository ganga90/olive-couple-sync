/**
 * Shared Context Assembly & Orchestration Helpers
 * =================================================
 * Single source of truth for context assembly used by:
 *   - ask-olive-stream (web chat)
 *   - ask-olive-individual (web assistant)
 *   - whatsapp-webhook (WhatsApp)
 *
 * P2: Unified context pipeline with circuit breaker + graceful degradation.
 *
 * v2: Added SOUL.MD integration via assembleSoulContext().
 *     All existing exports are unchanged. Soul is additive only.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { formatDateForZone, formatTimeForZone, getRelativeDayWindowUtc } from "./timezone-calendar.ts";
import {
  assembleSoulContext,
  type SoulAssemblyResult,
  type SoulAssemblyOptions,
} from "./soul.ts";
import {
  assembleContext,
  getSlotTokenLog,
  STANDARD_CONTRACT,
  STANDARD_BUDGET,
  type AssemblyResult,
  type SlotTokenLog,
} from "./context-contract.ts";

// ─── Circuit Breaker ───────────────────────────────────────────
// Tracks failures per subsystem to skip flaky calls for a cooldown period.

interface CircuitState {
  failures: number;
  lastFailure: number;
  open: boolean;
}

const circuits = new Map<string, CircuitState>();
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 60_000; // 1 minute

function isCircuitOpen(name: string): boolean {
  const state = circuits.get(name);
  if (!state || !state.open) return false;
  if (Date.now() - state.lastFailure > CIRCUIT_COOLDOWN_MS) {
    // Half-open: allow one attempt
    state.open = false;
    state.failures = 0;
    return false;
  }
  return true;
}

function recordSuccess(name: string): void {
  circuits.set(name, { failures: 0, lastFailure: 0, open: false });
}

function recordFailure(name: string): void {
  const state = circuits.get(name) || { failures: 0, lastFailure: 0, open: false };
  state.failures++;
  state.lastFailure = Date.now();
  if (state.failures >= CIRCUIT_THRESHOLD) {
    state.open = true;
    console.warn(`[CircuitBreaker] "${name}" opened after ${state.failures} failures`);
  }
  circuits.set(name, state);
}

/**
 * Safe fetch wrapper: returns fallback on circuit-open or error.
 */
async function safeFetch<T>(
  name: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  if (isCircuitOpen(name)) {
    console.log(`[CircuitBreaker] Skipping "${name}" (circuit open)`);
    return fallback;
  }
  try {
    const result = await fn();
    recordSuccess(name);
    return result;
  } catch (err) {
    recordFailure(name);
    console.warn(`[Orchestrator] "${name}" failed (non-blocking):`, err);
    return fallback;
  }
}

// ─── Trivial agent messages to filter out ──────────────────────
const TRIVIAL_PREFIXES = [
  "no stale tasks",
  "no upcoming bills",
  "oura not connected",
  "no oura data",
  "no tasks scheduled",
  "gmail not connected",
  "email triage set to manual",
  "too soon",
  "sleep looks good",
  "no upcoming dates",
  "no couple linked",
  "couple members not found",
  "no bill-related",
  "not enough sleep",
  "could not fetch dates",
  "no messages to send",
  "no dates in reminder",
];

/**
 * Fetch recent agent insights (last 48h, deduplicated per agent, trivial filtered).
 */
export async function fetchAgentInsightsContext(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string
): Promise<string> {
  return safeFetch("agent_insights", async () => {
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: agentRuns } = await supabase
      .from("olive_agent_runs")
      .select("agent_id, result, completed_at")
      .eq("user_id", userId)
      .eq("status", "completed")
      .gte("completed_at", fortyEightHoursAgo)
      .order("completed_at", { ascending: false })
      .limit(10);

    if (!agentRuns || agentRuns.length === 0) return "";

    const seen = new Set<string>();
    const insights: string[] = [];

    for (const run of agentRuns) {
      if (seen.has(run.agent_id)) continue;
      seen.add(run.agent_id);

      const msg = (run.result?.message || "").trim();
      if (!msg) continue;
      const lower = msg.toLowerCase();
      if (TRIVIAL_PREFIXES.some((p) => lower.startsWith(p))) continue;

      const agentName = run.agent_id
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c: string) => c.toUpperCase());
      insights.push(`- ${agentName}: ${msg.substring(0, 300)}`);
    }

    if (insights.length === 0) return "";
    return "## Recent Agent Insights (Background AI analysis):\n" + insights.join("\n") + "\n";
  }, "");
}

/**
 * Fetch user memories from user_memories table.
 */
export async function fetchUserMemories(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  limit = 15
): Promise<Array<{ title: string; content: string; category: string; importance?: number }>> {
  return safeFetch("user_memories", async () => {
    const { data: memories } = await supabase
      .from("user_memories")
      .select("title, content, category, importance")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("importance", { ascending: false })
      .limit(limit);
    return memories || [];
  }, []);
}

/**
 * Fetch user's activated skills with content.
 */
export async function fetchUserSkills(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string
): Promise<Array<{ skill_id: string; name: string; content: string; category: string }>> {
  return safeFetch("user_skills", async () => {
    const { data: userSkills } = await supabase
      .from("olive_user_skills")
      .select("skill_id, olive_skills(skill_id, name, content, category)")
      .eq("user_id", userId)
      .eq("enabled", true)
      .limit(10);

    if (!userSkills) return [];

    return userSkills
      .filter((us: any) => us.olive_skills)
      .map((us: any) => ({
        skill_id: us.olive_skills.skill_id,
        name: us.olive_skills.name,
        content: us.olive_skills.content,
        category: us.olive_skills.category || "general",
      }));
  }, []);
}

/**
 * Fetch behavioral patterns.
 */
export async function fetchPatterns(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string
): Promise<Array<{ pattern_type: string; pattern_data: any; confidence: number }>> {
  return safeFetch("patterns", async () => {
    const { data: patterns } = await supabase
      .from("olive_patterns")
      .select("pattern_type, pattern_data, confidence")
      .eq("user_id", userId)
      .eq("is_active", true)
      .gte("confidence", 0.6)
      .limit(5);
    return patterns || [];
  }, []);
}

// ─── Dynamic Memory Files ──────────────────────────────────────

export async function fetchProfileMemoryFile(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string
): Promise<string> {
  return safeFetch("profile_memory", async () => {
    const { data } = await supabase
      .from("olive_memory_files")
      .select("content, updated_at")
      .eq("user_id", userId)
      .eq("file_type", "profile")
      .is("file_date", null)
      .maybeSingle();

    if (!data?.content || data.content.trim().length < 5) return "";
    const content = data.content.length > 2000
      ? data.content.substring(0, 2000) + "\n...(profile truncated)"
      : data.content;
    return `## 🧠 Olive's Knowledge About You (evolving profile):\n${content}\n`;
  }, "");
}

export async function fetchRecentDailyLogs(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string
): Promise<string> {
  return safeFetch("daily_logs", async () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const startDate = twoDaysAgo.toISOString().split("T")[0];

    const { data } = await supabase
      .from("olive_memory_files")
      .select("content, file_date")
      .eq("user_id", userId)
      .eq("file_type", "daily")
      .gte("file_date", startDate)
      .order("file_date", { ascending: false })
      .limit(2);

    if (!data || data.length === 0) return "";

    const sections = data
      .filter((d: any) => d.content && d.content.trim().length > 10)
      .map((d: any) => {
        const content = d.content.length > 800
          ? d.content.substring(0, 800) + "\n..."
          : d.content;
        return `### ${d.file_date}:\n${content}`;
      });

    if (sections.length === 0) return "";
    return `## 📅 Recent Activity Log:\n${sections.join("\n\n")}\n`;
  }, "");
}

export async function fetchHouseholdMemoryFile(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  coupleId?: string
): Promise<string> {
  if (!coupleId) return "";

  return safeFetch("household_memory", async () => {
    const { data } = await supabase
      .from("olive_memory_files")
      .select("content, file_type")
      .eq("user_id", userId)
      .in("file_type", ["household", "relationship"])
      .is("file_date", null)
      .limit(2);

    if (!data || data.length === 0) return "";

    const sections = data
      .filter((d: any) => d.content && d.content.trim().length > 10)
      .map((d: any) => {
        const content = d.content.length > 1000
          ? d.content.substring(0, 1000) + "\n..."
          : d.content;
        const label = d.file_type === "household" ? "Household" : "Relationship";
        return `### ${label}:\n${content}`;
      });

    if (sections.length === 0) return "";
    return `## 🏠 Shared Context:\n${sections.join("\n\n")}\n`;
  }, "");
}

/**
 * Assemble full dynamic memory context — the "living brain" of Olive.
 * Combines profile + daily logs + household into a single context block.
 * All fetches run in parallel for minimal latency.
 */
export async function fetchDynamicMemoryContext(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  coupleId?: string
): Promise<string> {
  const [profile, dailyLogs, household] = await Promise.all([
    fetchProfileMemoryFile(supabase, userId),
    fetchRecentDailyLogs(supabase, userId),
    fetchHouseholdMemoryFile(supabase, userId, coupleId),
  ]);

  return [profile, dailyLogs, household].filter((s) => s.length > 0).join("\n");
}

// ══════════════════════════════════════════════════════════════════
// UNIFIED CONTEXT PIPELINE (P2)
// ══════════════════════════════════════════════════════════════════
// Single entry point for assembling all server-side context.
// Used by ask-olive-stream, ask-olive-individual, and whatsapp-webhook.

export interface UnifiedContext {
  profile: string;
  memories: string;
  patterns: string;
  calendar: string;
  agentInsights: string;
  deepProfile: string;
  // Semantic (Phase 4)
  semanticNotes: string;
  semanticMemoryChunks: string;
  relationshipGraph: string;
  // For contextual_ask:
  savedItems: string;
  // P4: Partner, task analytics, skills
  partnerContext: string;
  taskAnalytics: string;
  skills: string;
}

const EMPTY_CTX: UnifiedContext = {
  profile: "",
  memories: "",
  patterns: "",
  calendar: "",
  agentInsights: "",
  deepProfile: "",
  semanticNotes: "",
  semanticMemoryChunks: "",
  relationshipGraph: "",
  savedItems: "",
  partnerContext: "",
  taskAnalytics: "",
  skills: "",
};

/**
 * Generate an embedding for semantic search.
 */
export async function generateEmbedding(
  text: string,
  geminiKey: string
): Promise<number[] | null> {
  return safeFetch("embedding", async () => {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          outputDimensionality: 768,
        }),
      }
    );
    if (!response.ok) {
      await response.text();
      return null;
    }
    const data = await response.json();
    return data.embedding?.values || null;
  }, null);
}

/**
 * assembleFullContext — unified context pipeline
 *
 * Fetches ALL layers in parallel with circuit breakers:
 *   Layer 1: Profile + preferences
 *   Layer 2: Memories + patterns + calendar
 *   Layer 3: Deep profile (memory files) + agent insights
 *   Layer 4: Semantic search (notes + memory chunks + knowledge graph)
 *   Layer 5: Saved items (for contextual_ask only)
 *
 * @param supabase - Service-role Supabase client
 * @param userId - Authenticated user ID
 * @param opts - Configuration options
 */
export async function assembleFullContext(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  opts: {
    coupleId?: string;
    intentType?: string;
    userMessage?: string;
    geminiKey?: string;
  } = {}
): Promise<UnifiedContext> {
  if (!userId) return { ...EMPTY_CTX };

  const ctx = { ...EMPTY_CTX };
  const { coupleId, intentType, userMessage, geminiKey } = opts;
  const needsSavedItems = intentType === "contextual_ask";
  const profilePromise = safeFetch("profile", async () => {
    const { data } = await supabase
      .from("clerk_profiles")
      .select("display_name, language_preference, timezone, note_style")
      .eq("id", userId)
      .maybeSingle();
    return data;
  }, null);

  // ─── LAYER 1-3: All base fetches in parallel ───────────────────
  const embeddingPromise =
    userMessage && geminiKey
      ? generateEmbedding(userMessage, geminiKey)
      : Promise.resolve(null);

  const basePromises = [
    // [0] Profile
    profilePromise,
    // [1] Memories
    fetchUserMemories(supabase, userId),
    // [2] Patterns
    fetchPatterns(supabase, userId),
    // [3] Calendar (14-day window)
    safeFetch("calendar", async () => {
      const profileData = await profilePromise;
      const userTimezone = profileData?.timezone || "UTC";
      const { data: connections } = await supabase
        .from("calendar_connections")
        .select("id")
        .eq("user_id", userId)
        .eq("is_active", true);
      if (!connections?.length) return [];
      const ids = connections.map((c: any) => c.id);
      const now = new Date();
      const startOfToday = getRelativeDayWindowUtc(now, userTimezone, 0).start;
      const endOfWindow = getRelativeDayWindowUtc(now, userTimezone, 14).end;
      const { data: events } = await supabase
        .from("calendar_events")
        .select("title, start_time, end_time, location, timezone")
        .in("connection_id", ids)
        .gte("start_time", startOfToday.toISOString())
        .lt("start_time", endOfWindow.toISOString())
        .order("start_time", { ascending: true })
        .limit(15);
      return events || [];
    }, []),
    // [4] Deep profile (memory files)
    safeFetch("deep_profile", async () => {
      const { data } = await supabase
        .from("olive_memory_files")
        .select("file_type, content, updated_at")
        .eq("user_id", userId)
        .in("file_type", ["profile", "patterns", "relationship", "household"])
        .order("updated_at", { ascending: false });
      return data || [];
    }, []),
    // [5] Agent insights
    fetchAgentInsightsContext(supabase, userId),
    // [6] Knowledge entities
    safeFetch("entities", async () => {
      const { data } = await supabase
        .from("olive_entities")
        .select("id, name, canonical_name, entity_type, metadata, mention_count")
        .eq("user_id", userId)
        .order("mention_count", { ascending: false })
        .limit(25);
      return data || [];
    }, []),
    // [7] Partner context (P4)
    safeFetch("partner_context", async () => {
      if (!coupleId) return null;
      const { data: members } = await supabase.rpc("get_space_members", { p_couple_id: coupleId });
      if (!members?.length) return null;
      const others = members.filter((m: any) => m.user_id !== userId);
      if (others.length === 0) return null;
      const partnerNames = others.map((m: any) => m.display_name).join(", ") || "Partner";
      const otherIds = others.map((m: any) => m.user_id);
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const [recentRes, assignedByRes, assignedToRes] = await Promise.all([
        supabase.from("clerk_notes").select("summary").in("author_id", otherIds).eq("couple_id", coupleId).gte("created_at", twoDaysAgo).order("created_at", { ascending: false }).limit(3),
        supabase.from("clerk_notes").select("summary").eq("couple_id", coupleId).in("author_id", otherIds).eq("task_owner", userId).eq("completed", false).limit(3),
        supabase.from("clerk_notes").select("summary").eq("couple_id", coupleId).eq("author_id", userId).in("task_owner", otherIds).eq("completed", false).limit(3),
      ]);
      return { partnerNames, recent: recentRes.data || [], assignedToYou: assignedByRes.data || [], youAssigned: assignedToRes.data || [] };
    }, null),
    // [8] Task analytics (P4)
    safeFetch("task_analytics", async () => {
      const { data: tasks } = await supabase
        .from("clerk_notes")
        .select("id, summary, due_date, completed, priority, category, list_id, author_id, task_owner, created_at, updated_at")
        .or(coupleId ? `author_id.eq.${userId},couple_id.eq.${coupleId}` : `author_id.eq.${userId}`)
        .order("created_at", { ascending: false })
        .limit(100);
      return tasks || [];
    }, []),
    // [9] Skills (P4)
    fetchUserSkills(supabase, userId),
  ];

  // Saved items (only for contextual_ask)
  const savedItemsPromise = needsSavedItems
    ? Promise.all([
        safeFetch("saved_notes", async () => {
          const { data } = await supabase
            .from("clerk_notes")
            .select("id, summary, original_text, category, list_id, items, tags, priority, due_date, reminder_time, completed, created_at")
            .or(
              coupleId
                ? `couple_id.eq.${coupleId},and(author_id.eq.${userId},couple_id.is.null)`
                : `author_id.eq.${userId}`
            )
            .order("created_at", { ascending: false })
            .limit(200);
          return data || [];
        }, []),
        safeFetch("saved_lists", async () => {
          const { data } = await supabase
            .from("clerk_lists")
            .select("id, name, description")
            .or(
              coupleId
                ? `author_id.eq.${userId},couple_id.eq.${coupleId}`
                : `author_id.eq.${userId}`
            );
          return data || [];
        }, []),
      ])
    : Promise.resolve(null);

  // Await all base fetches + embedding in parallel
  const [baseResults, queryEmbedding, savedItemsData] = await Promise.all([
    Promise.all(basePromises),
    embeddingPromise,
    savedItemsPromise,
  ]);

  const [profileData, memories, patterns, calendarEvents, memoryFiles, agentInsights, entities, partnerData, tasksList, userSkills] =
    baseResults as [any, any[], any[], any[], any[], string, any[], any, any[], any[]];

  // ─── FORMAT: Profile ──────────────────────────────────────────
  if (profileData) {
    ctx.profile = `USER PROFILE: Name: ${profileData.display_name || "Unknown"}, Language: ${profileData.language_preference || "en"}, Timezone: ${profileData.timezone || "UTC"}, Note style: ${profileData.note_style || "auto"}`;
  }

  // ─── FORMAT: Memories ─────────────────────────────────────────
  if (memories?.length) {
    ctx.memories = `\nUSER MEMORIES & PREFERENCES:\n${memories
      .map((m: any) => `- [${m.category}] ${m.title}: ${m.content}`)
      .join("\n")}`;
  }

  // ─── FORMAT: Patterns ─────────────────────────────────────────
  if (patterns?.length) {
    ctx.patterns = `\nBEHAVIORAL PATTERNS:\n${patterns
      .map(
        (p: any) =>
          `- ${p.pattern_type}: ${JSON.stringify(p.pattern_data)} (${(p.confidence * 100).toFixed(0)}%)`
      )
      .join("\n")}`;
  }

  // ─── FORMAT: Calendar ─────────────────────────────────────────
  if (calendarEvents?.length) {
    ctx.calendar = `\nUPCOMING CALENDAR:\n${calendarEvents
      .slice(0, 10)
      .map((e: any) => {
        const eventTimeZone = e.timezone || profileData?.timezone || "UTC";
        const date = formatDateForZone(e.start_time, eventTimeZone, {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
        const time = formatTimeForZone(e.start_time, eventTimeZone);
        return `- ${date} ${time}: ${e.title}${e.location ? ` @ ${e.location}` : ""}`;
      })
      .join("\n")}`;
  }

  // ─── FORMAT: Deep Profile (memory files) ──────────────────────
  if (memoryFiles?.length) {
    const parts: string[] = [];
    for (const mf of memoryFiles) {
      if (mf.content && mf.content.trim().length > 0) {
        const label = mf.file_type.toUpperCase();
        const maxLen = mf.file_type === "profile" ? 2500 : 1500;
        const content =
          mf.content.length > maxLen
            ? mf.content.slice(0, maxLen) + "\n...(truncated)"
            : mf.content;
        parts.push(`[${label}]:\n${content}`);
      }
    }
    if (parts.length > 0) {
      ctx.deepProfile = `\n## COMPILED KNOWLEDGE (AI-synthesized from your history):\n${parts.join("\n\n")}`;
    }
  }

  // ─── FORMAT: Agent Insights ───────────────────────────────────
  ctx.agentInsights = agentInsights;

  // ─── FORMAT: Knowledge entities ───────────────────────────────
  if (entities?.length) {
    ctx.deepProfile =
      (ctx.deepProfile || "") +
      `\n\n## KEY PEOPLE, PLACES & THINGS:\n${entities
        .map((e: any) => {
          const meta = e.metadata
            ? Object.entries(e.metadata)
                .filter(([k]) => k !== "aliases")
                .map(([k, v]) => `${k}: ${v}`)
                .join(", ")
            : "";
          return `- ${e.name} (${e.entity_type}${meta ? ", " + meta : ""}) — mentioned ${e.mention_count}x`;
        })
        .join("\n")}`;
  }

  // ─── FORMAT: Partner Context (P4) ─────────────────────────────
  if (partnerData) {
    const pParts: string[] = [`## Partner (${partnerData.partnerNames}):`];
    if (partnerData.recent?.length) pParts.push(`Recently added: ${partnerData.recent.map((t: any) => t.summary).join(", ")}`);
    if (partnerData.assignedToYou?.length) pParts.push(`Assigned to you: ${partnerData.assignedToYou.map((t: any) => t.summary).join(", ")}`);
    if (partnerData.youAssigned?.length) pParts.push(`You assigned: ${partnerData.youAssigned.map((t: any) => t.summary).join(", ")}`);
    if (pParts.length > 1) ctx.partnerContext = "\n" + pParts.join("\n");
  }

  // ─── FORMAT: Task Analytics (P4) ──────────────────────────────
  if (tasksList?.length) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 86400000);
    const active = tasksList.filter((t: any) => !t.completed);
    const yourActive = active.filter((t: any) => t.author_id === userId || t.task_owner === userId);
    const urgent = active.filter((t: any) => t.priority === "high");
    const overdue = active.filter((t: any) => t.due_date && new Date(t.due_date) < today);
    const dueToday = active.filter((t: any) => { if (!t.due_date) return false; const d = new Date(t.due_date); return d >= today && d < tomorrow; });
    const dueTomorrow = active.filter((t: any) => { if (!t.due_date) return false; const d = new Date(t.due_date); return d >= tomorrow && d < new Date(tomorrow.getTime() + 86400000); });

    ctx.taskAnalytics = `\n## Task Analytics:\n- Your active: ${yourActive.length} | Total space: ${active.length}\n- Urgent: ${urgent.length} | Overdue: ${overdue.length}\n- Due today: ${dueToday.length} | Due tomorrow: ${dueTomorrow.length}${urgent.length > 0 ? `\n- Urgent: ${urgent.slice(0, 3).map((t: any) => t.summary).join(", ")}` : ""}${overdue.length > 0 ? `\n- Overdue: ${overdue.slice(0, 3).map((t: any) => t.summary).join(", ")}` : ""}${dueToday.length > 0 ? `\n- Today: ${dueToday.slice(0, 3).map((t: any) => t.summary).join(", ")}` : ""}`;
  }

  // ─── FORMAT: Skills (P4) ──────────────────────────────────────
  if (userSkills?.length) {
    ctx.skills = `\n## Active Skills:\n${userSkills.map((s: any) => `- ${s.name}: ${(s.content || "").substring(0, 200)}`).join("\n")}`;
  }

  // ─── LAYER 4: Semantic Search (with circuit breakers) ─────────
  if (queryEmbedding && userMessage) {
    // 4a: Hybrid note search
    if (needsSavedItems) {
      const semanticNotes = await safeFetch("semantic_notes", async () => {
        const { data } = await supabase.rpc("hybrid_search_notes", {
          p_user_id: userId,
          p_couple_id: coupleId || null,
          p_query: userMessage,
          p_query_embedding: JSON.stringify(queryEmbedding),
          p_vector_weight: 0.7,
          p_limit: 15,
        });
        return data;
      }, null);

      if (semanticNotes?.length) {
        ctx.semanticNotes = `\n## SEMANTICALLY RELEVANT NOTES (AI-ranked):\n`;
        for (const note of semanticNotes.slice(0, 10)) {
          const status = note.completed ? "✓" : "○";
          const dueInfo = note.due_date ? ` | Due: ${note.due_date}` : "";
          const cat = note.category ? ` [${note.category}]` : "";
          ctx.semanticNotes += `\n📌 ${status} "${note.summary}"${cat}${dueInfo} (relevance: ${(note.score * 100).toFixed(0)}%)\n`;
          if (note.original_text && note.original_text !== note.summary) {
            ctx.semanticNotes += `   Full details: ${note.original_text.substring(0, 600)}\n`;
          }
        }
      }
    }

    // 4b: Memory chunk semantic search
    const memChunks = await safeFetch("memory_chunks", async () => {
      const { data } = await supabase.rpc("search_memory_chunks", {
        p_user_id: userId,
        p_query_embedding: JSON.stringify(queryEmbedding),
        p_limit: 8,
        p_min_importance: 2,
      });
      return data;
    }, null);

    if (memChunks?.length) {
      ctx.semanticMemoryChunks = `\n## RELEVANT LEARNED FACTS (from conversations & notes):\n${memChunks
        .map(
          (c: any) =>
            `- ${c.content} (importance: ${c.importance}/5, source: ${c.source || "auto"})`
        )
        .join("\n")}`;
    }

    // 4c: Relationship graph — entity-aware context
    const messageLower = userMessage.toLowerCase();
    const mentionedEntityIds = new Set<string>();
    if (entities?.length) {
      for (const entity of entities) {
        if (
          messageLower.includes(entity.canonical_name) ||
          messageLower.includes(entity.name.toLowerCase())
        ) {
          mentionedEntityIds.add(entity.id);
        }
      }
    }

    const relationships = await safeFetch("relationships", async () => {
      const { data } = await supabase
        .from("olive_relationships")
        .select(
          `relationship_type, confidence, confidence_score, rationale,
           source:olive_entities!source_entity_id(id, name, entity_type),
           target:olive_entities!target_entity_id(id, name, entity_type)`
        )
        .eq("user_id", userId)
        .gte("confidence_score", 0.4)
        .order("confidence_score", { ascending: false })
        .limit(30);
      return data;
    }, null);

    if (relationships?.length) {
      const relevant: string[] = [];
      const general: string[] = [];

      for (const r of relationships as any[]) {
        const src = r.source?.name || "?";
        const tgt = r.target?.name || "?";
        const conf = r.confidence === "AMBIGUOUS" ? " ⚠️" : "";
        const line = `- ${src} → ${r.relationship_type} → ${tgt}${conf}`;

        if (mentionedEntityIds.has(r.source?.id) || mentionedEntityIds.has(r.target?.id)) {
          relevant.push(line);
        } else {
          general.push(line);
        }
      }

      let graphCtx = "";
      if (relevant.length > 0) {
        graphCtx += `\n## RELEVANT CONNECTIONS:\n${relevant.join("\n")}`;
      }
      if (general.length > 0) {
        graphCtx += `\n## OTHER KNOWN RELATIONSHIPS:\n${general.slice(0, 15).join("\n")}`;
      }
      ctx.relationshipGraph = graphCtx;
    }

    // 4d: Community context
    if (mentionedEntityIds.size > 0) {
      const communities = await safeFetch("communities", async () => {
        const { data } = await supabase
          .from("olive_entity_communities")
          .select("label, entity_ids, cohesion, metadata")
          .eq("user_id", userId);
        return data;
      }, null);

      if (communities?.length) {
        const relevantCommunities = communities.filter((c: any) =>
          c.entity_ids?.some((id: string) => mentionedEntityIds.has(id))
        );
        if (relevantCommunities.length > 0) {
          ctx.relationshipGraph =
            (ctx.relationshipGraph || "") +
            `\n\n## LIFE DOMAINS:\n${relevantCommunities
              .map(
                (c: any) =>
                  `- ${c.label} (${c.metadata?.member_count || 0} entities, cohesion: ${c.cohesion})`
              )
              .join("\n")}`;
        }
      }
    }
  }

  // ─── LAYER 5: Saved Items (keyword fallback for contextual_ask) ─
  if (needsSavedItems && savedItemsData) {
    const [allTasks, lists] = savedItemsData;
    const listIdToName = new Map((lists as any[]).map((l: any) => [l.id, l.name]));
    const questionLower = (userMessage || "").toLowerCase();
    const questionWords = questionLower.split(/\s+/).filter((w: string) => w.length > 2);

    const scoredTasks = (allTasks as any[]).map((task: any) => {
      const combined = `${task.summary.toLowerCase()} ${(task.original_text || "").toLowerCase()}`;
      let score = 0;
      questionWords.forEach((w: string) => {
        if (combined.includes(w)) score += 1;
        if (task.summary.toLowerCase().includes(w)) score += 1;
      });
      return { ...task, relevanceScore: score };
    });

    const relevant = scoredTasks
      .filter((t: any) => t.relevanceScore >= 2)
      .sort((a: any, b: any) => b.relevanceScore - a.relevanceScore);
    const others = scoredTasks.filter((t: any) => t.relevanceScore < 2);

    let savedItemsCtx = "";
    if (relevant.length > 0) {
      savedItemsCtx += "\n## MOST RELEVANT SAVED ITEMS (full details):\n";
      relevant.slice(0, 10).forEach((task: any) => {
        const listName =
          task.list_id && listIdToName.has(task.list_id)
            ? listIdToName.get(task.list_id)
            : task.category;
        const status = task.completed ? "✓" : "○";
        const dueInfo = task.due_date ? ` | Due: ${task.due_date}` : "";
        const reminderInfo = task.reminder_time ? ` | Reminder: ${task.reminder_time}` : "";
        savedItemsCtx += `\n📌 ${status} "${task.summary}" [${listName}]${dueInfo}${reminderInfo}\n`;
        if (task.original_text && task.original_text !== task.summary) {
          savedItemsCtx += `   Full details: ${task.original_text.substring(0, 800)}\n`;
        }
        if (task.items?.length > 0) {
          task.items.forEach((item: string) => {
            savedItemsCtx += `   • ${item}\n`;
          });
        }
      });
    }

    savedItemsCtx += "\n## ALL LISTS AND SAVED ITEMS:\n";
    const tasksByList = new Map<string, any[]>();
    const uncategorized: any[] = [];
    others.forEach((task: any) => {
      if (task.list_id && listIdToName.has(task.list_id)) {
        const ln = listIdToName.get(task.list_id)!;
        if (!tasksByList.has(ln)) tasksByList.set(ln, []);
        tasksByList.get(ln)!.push(task);
      } else {
        uncategorized.push(task);
      }
    });
    tasksByList.forEach((tasks, listName) => {
      savedItemsCtx += `\n### ${listName}:\n`;
      tasks.slice(0, 15).forEach((task: any) => {
        const status = task.completed ? "✓" : "○";
        const priority = task.priority === "high" ? " 🔥" : "";
        savedItemsCtx += `- ${status} ${task.summary}${priority}\n`;
      });
      if (tasks.length > 15)
        savedItemsCtx += `  ...and ${tasks.length - 15} more\n`;
    });
    if (uncategorized.length > 0) {
      savedItemsCtx += `\n### Other Items:\n`;
      uncategorized.slice(0, 10).forEach((task: any) => {
        savedItemsCtx += `- ${task.completed ? "✓" : "○"} ${task.summary}\n`;
      });
    }
    ctx.savedItems = savedItemsCtx;
  }

  return ctx;
}

/**
 * Format a UnifiedContext into a single string for LLM prompt injection.
 */
export function formatContextForPrompt(
  ctx: UnifiedContext,
  opts?: {
    userMessage?: string;
    userName?: string;
    conversationHistory?: Array<{ role: string; content: string }>;
    savedItemsContext?: string; // frontend-provided
  }
): string {
  const parts: string[] = [];

  if (ctx.profile) parts.push(ctx.profile);
  if (ctx.memories) parts.push(ctx.memories);
  if (ctx.patterns) parts.push(ctx.patterns);
  if (ctx.calendar) parts.push(ctx.calendar);
  if (ctx.deepProfile) parts.push(ctx.deepProfile);
  if (ctx.semanticMemoryChunks) parts.push(ctx.semanticMemoryChunks);
  if (ctx.relationshipGraph) parts.push(ctx.relationshipGraph);
  if (ctx.agentInsights) parts.push(ctx.agentInsights);
  if (ctx.partnerContext) parts.push(ctx.partnerContext);
  if (ctx.taskAnalytics) parts.push(ctx.taskAnalytics);
  if (ctx.skills) parts.push(ctx.skills);

  if (opts?.savedItemsContext) {
    parts.push(`\nUSER'S SAVED DATA:\n${opts.savedItemsContext}`);
  }

  if (opts?.userName) {
    parts.push(`\nUser's name: ${opts.userName}`);
  }

  if (opts?.conversationHistory?.length) {
    parts.push(
      "\nCONVERSATION HISTORY:\n" +
        opts.conversationHistory
          .map((m) => `${m.role === "user" ? "User" : "Olive"}: ${m.content}`)
          .join("\n")
    );
  }

  if (opts?.userMessage) {
    parts.push(`\nUSER MESSAGE: ${opts.userMessage}`);
  }

  return parts.join("\n");
}

// ══════════════════════════════════════════════════════════════════
// BUDGET-AWARE CONTEXT ASSEMBLY (Phase 2 — Task 1-A)
// ══════════════════════════════════════════════════════════════════

export type { AssemblyResult, SlotTokenLog };
export { getSlotTokenLog };

/**
 * Budget-aware version of formatContextForPrompt.
 *
 * Maps UnifiedContext fields into named slots, then runs them through
 * the formal context contract with token budgets and priority-based
 * overflow handling.
 *
 * Returns both the assembled prompt AND slot-level analytics for the
 * LLM tracker.
 */
export function formatContextWithBudget(
  ctx: UnifiedContext,
  opts?: {
    soulPrompt?: string;
    intentModule?: string;
    userMessage?: string;
    userName?: string;
    conversationHistory?: Array<{ role: string; content: string }>;
    savedItemsContext?: string;
  }
): AssemblyResult {
  // ─── Map UnifiedContext → Contract Slots ─────────────────────

  // IDENTITY: Soul prompt or static identity
  const identity = opts?.soulPrompt || "";

  // QUERY: User message + name
  const queryParts: string[] = [];
  if (opts?.userName) queryParts.push(`User's name: ${opts.userName}`);
  if (opts?.userMessage) queryParts.push(`USER MESSAGE: ${opts.userMessage}`);
  const query = queryParts.join("\n");

  // USER_COMPILED: Profile + memories + patterns + deep profile + relationships + partner
  const userParts: string[] = [];
  if (ctx.profile) userParts.push(ctx.profile);
  if (ctx.memories) userParts.push(ctx.memories);
  if (ctx.patterns) userParts.push(ctx.patterns);
  if (ctx.deepProfile) userParts.push(ctx.deepProfile);
  if (ctx.partnerContext) userParts.push(ctx.partnerContext);
  const userCompiled = userParts.join("\n");

  // INTENT_MODULE: Intent-specific prompt rules
  const intentModule = opts?.intentModule || "";

  // TOOLS: Skills (will expand to tool schemas in future)
  const tools = ctx.skills || "";

  // DYNAMIC: Calendar + task analytics + agent insights + semantic data + saved items
  const dynamicParts: string[] = [];
  if (ctx.calendar) dynamicParts.push(ctx.calendar);
  if (ctx.taskAnalytics) dynamicParts.push(ctx.taskAnalytics);
  if (ctx.agentInsights) dynamicParts.push(ctx.agentInsights);
  if (ctx.semanticNotes) dynamicParts.push(ctx.semanticNotes);
  if (ctx.semanticMemoryChunks) dynamicParts.push(ctx.semanticMemoryChunks);
  if (ctx.relationshipGraph) dynamicParts.push(ctx.relationshipGraph);
  if (opts?.savedItemsContext) dynamicParts.push(`\nUSER'S SAVED DATA:\n${opts.savedItemsContext}`);
  const dynamic = dynamicParts.join("\n");

  // HISTORY: Conversation history
  let history = "";
  if (opts?.conversationHistory?.length) {
    history =
      "CONVERSATION HISTORY:\n" +
      opts.conversationHistory
        .map((m) => `${m.role === "user" ? "User" : "Olive"}: ${m.content}`)
        .join("\n");
  }

  // ─── Run through contract ────────────────────────────────────

  return assembleContext(
    {
      IDENTITY: identity,
      QUERY: query,
      USER_COMPILED: userCompiled,
      INTENT_MODULE: intentModule,
      TOOLS: tools,
      DYNAMIC: dynamic,
      HISTORY: history,
    },
    STANDARD_CONTRACT,
    STANDARD_BUDGET,
  );
}

// ══════════════════════════════════════════════════════════════════
// SESSION MANAGEMENT (P2)
// ══════════════════════════════════════════════════════════════════

/**
 * Clean up stale sessions older than 24 hours.
 * Called opportunistically (not on every request).
 */
export async function cleanupStaleSessions(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string
): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("olive_gateway_sessions")
      .update({ is_active: false })
      .eq("user_id", userId)
      .eq("is_active", true)
      .lt("last_activity", cutoff);
  } catch (err) {
    console.warn("[Session] Cleanup error (non-blocking):", err);
  }
}

/**
 * Touch session — update last_activity timestamp.
 */
export async function touchSession(
  supabase: ReturnType<typeof createClient<any>>,
  sessionId: string
): Promise<void> {
  try {
    await supabase
      .from("olive_gateway_sessions")
      .update({ last_activity: new Date().toISOString() })
      .eq("id", sessionId);
  } catch {
    // non-blocking
  }
}

// ══════════════════════════════════════════════════════════════════
// AUTO-EVOLUTION ENGINE (unchanged from v1)
// ══════════════════════════════════════════════════════════════════

export async function evolveProfileFromConversation(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  userMessage: string,
  oliveResponse: string
): Promise<void> {
  try {
    if (userMessage.length < 15) return;

    const factSignals = [
      /\b(i prefer|i like|i hate|i love|i always|i never|i usually|my favorite|i'm allergic|i don't eat|we always|we prefer)\b/i,
      /\b(mi piace|preferisco|odio|amo|sempre|mai|il mio preferito|sono allergic|non mangio)\b/i,
      /\b(me gusta|prefiero|odio|amo|siempre|nunca|mi favorito|soy alérgic|no como)\b/i,
      /\b(my (?:wife|husband|partner|dog|cat|kid|son|daughter|baby|mom|dad|brother|sister) (?:is|likes|hates|prefers|needs|has))\b/i,
      /\b(we live|we moved|our house|our apartment|our home|my office|my work)\b/i,
      /\b(my birthday|my anniversary|born on|born in)\b/i,
      /\b(remember that|don't forget|important:)\b/i,
    ];

    const hasFactSignal = factSignals.some((r) => r.test(userMessage));

    if (userMessage.length >= 30) {
      await extractAndStoreConversationFacts(supabase, userId, userMessage, oliveResponse);
    } else if (hasFactSignal) {
      await quickProfileAppend(supabase, userId, userMessage);
    }
  } catch (err) {
    console.warn("[Orchestrator] Profile evolution error (non-blocking):", err);
  }
}

async function extractAndStoreConversationFacts(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  userMessage: string,
  oliveResponse: string
): Promise<void> {
  const GEMINI_API_KEY =
    Deno.env.get("GEMINI_API") ||
    Deno.env.get("GEMINI_API_KEY") ||
    Deno.env.get("VITE_GEMINI_API_KEY");

  if (!GEMINI_API_KEY) return;

  let knownFactsBlock = "";
  try {
    const { data: profileData } = await supabase
      .from("olive_memory_files")
      .select("content")
      .eq("user_id", userId)
      .eq("file_type", "profile")
      .is("file_date", null)
      .maybeSingle();

    if (profileData?.content && profileData.content.trim().length > 5) {
      knownFactsBlock = `\n[ALREADY KNOWN FACTS]:\n${profileData.content.substring(0, 400)}\n\nFocus on extracting NEW facts not already covered above.\n`;
    }
  } catch {}

  const prompt = `Analyze this conversation turn and extract memorable facts worth storing in long-term memory.
${knownFactsBlock}
User said: "${userMessage.substring(0, 500)}"
Olive replied: "${oliveResponse.substring(0, 300)}"

Extract facts that are:
- User preferences (food likes/dislikes, habits, routines, style preferences)
- Personal information (names, dates, locations, relationships, allergies)
- Decisions made (chose something, committed to something)
- Patterns (recurring behaviors, schedules, tendencies)
- Important context (life events, goals, concerns)

Rules:
- Only extract facts explicitly stated or strongly implied by the USER
- Do NOT extract facts about Olive or generic advice Olive gave
- Each fact should be a self-contained statement
- Deduplicate: if two facts say the same thing, keep only the more specific one

Return a JSON array. If no memorable facts, return [].
Each item: {"content":"concise fact statement","type":"preference|fact|pattern|personal_info|decision","importance":1-5}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
        }),
      }
    );

    if (!response.ok) {
      await response.text();
      return;
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const facts: Array<{ content: string; type: string; importance: number }> = JSON.parse(jsonMatch[0]);
    if (!facts || facts.length === 0) return;

    console.log(`[ConvMemory] Extracted ${facts.length} facts from conversation`);

    const embeddingPromises = facts.map(async (fact) => {
      return generateEmbedding(fact.content, GEMINI_API_KEY);
    });

    const embeddings = await Promise.all(embeddingPromises);

    let stored = 0;
    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i];
      const embedding = embeddings[i];

      if (embedding) {
        try {
          const { data: similar } = await supabase.rpc("find_similar_chunks", {
            p_user_id: userId,
            p_embedding: embedding,
            p_threshold: 0.95,
            p_limit: 1,
          });
          if (similar && similar.length > 0) continue;
        } catch {}
      }

      const { error } = await supabase.from("olive_memory_chunks").insert({
        user_id: userId,
        memory_file_id: null,
        chunk_index: 0,
        content: fact.content,
        chunk_type: fact.type === "pattern" ? "pattern" : "fact",
        importance: Math.min(5, Math.max(1, fact.importance)),
        embedding,
        source: "conversation",
        is_active: true,
        decay_factor: 1.0,
        metadata: {
          extraction_type: "ai_conversation",
          fact_type: fact.type,
          extracted_at: new Date().toISOString(),
          source_message_preview: userMessage.substring(0, 100),
        },
      });

      if (!error) stored++;
    }

    console.log(`[ConvMemory] Stored ${stored}/${facts.length} new facts`);

    // Decision detection
    try {
      const decisionPatterns = [
        /\bwe decided\b/i, /\blet'?s go with\b/i, /\bfinal answer\b/i,
        /\bwe agreed\b/i, /\bdecision made\b/i, /\bgoing to go with\b/i,
        /\bsettled on\b/i, /\bchose to\b/i, /\bmade up (?:our|my) mind\b/i,
      ];

      const casualExclusions = [
        /\bdecided to (?:have|eat|get|grab|order|make|cook) (?:a |some |the )?(?:pizza|lunch|dinner|breakfast|coffee|snack|food|sandwich|burger|salad|drink|beer|wine|tea|water)\b/i,
        /\bdecided to (?:watch|see|play|read|listen)\b/i,
        /\bdecided to (?:go to bed|take a nap|sleep|rest|relax|chill)\b/i,
      ];

      const combinedText = userMessage + " " + oliveResponse;
      const matchedPattern = decisionPatterns.find((p) => p.test(combinedText));

      if (matchedPattern) {
        const isCasual = casualExclusions.some((p) => p.test(combinedText));
        if (!isCasual) {
          const sentences = combinedText.split(/[.!?\n]+/).filter((s) => s.trim().length > 5);
          const decisionSentence = sentences.find((s) => matchedPattern.test(s));
          const decisionContent = decisionSentence
            ? decisionSentence.trim().substring(0, 300)
            : userMessage.substring(0, 300);

          await supabase.from("olive_memory_chunks").insert({
            user_id: userId,
            memory_file_id: null,
            chunk_index: 0,
            content: decisionContent,
            chunk_type: "fact",
            importance: 5,
            source: "conversation",
            is_active: true,
            decay_factor: 1.0,
            metadata: {
              type: "decision",
              detected_at: new Date().toISOString(),
              extraction_type: "decision_detection",
              source_message_preview: userMessage.substring(0, 100),
            },
          });
        }
      }
    } catch {}

    const highImportanceFacts = facts.filter((f) => f.importance >= 4);
    if (highImportanceFacts.length > 0) {
      await appendFactsToProfile(supabase, userId, highImportanceFacts);
    }
  } catch (err) {
    console.warn("[ConvMemory] Extraction error (non-blocking):", err);
  }
}

async function appendFactsToProfile(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  facts: Array<{ content: string; type: string; importance: number }>
): Promise<void> {
  try {
    const { data: profileFile } = await supabase
      .from("olive_memory_files")
      .select("content")
      .eq("user_id", userId)
      .eq("file_type", "profile")
      .is("file_date", null)
      .maybeSingle();

    const currentContent = profileFile?.content || "";
    const today = new Date().toISOString().split("T")[0];

    const newLines: string[] = [];
    for (const fact of facts) {
      if (currentContent.toLowerCase().includes(fact.content.toLowerCase().substring(0, 30))) {
        continue;
      }
      newLines.push(`- [${today}] ${fact.content}`);
    }

    if (newLines.length === 0) return;

    const appendText = "\n" + newLines.join("\n");

    if (currentContent.length + appendText.length > 5000) return;

    await supabase
      .from("olive_memory_files")
      .upsert(
        {
          user_id: userId,
          file_type: "profile",
          file_date: null,
          content: currentContent + appendText,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,file_type,file_date" }
      );
  } catch {}
}

async function quickProfileAppend(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  userMessage: string
): Promise<void> {
  try {
    const { data: profileFile } = await supabase
      .from("olive_memory_files")
      .select("content")
      .eq("user_id", userId)
      .eq("file_type", "profile")
      .is("file_date", null)
      .maybeSingle();

    const currentContent = profileFile?.content || "";
    const newFact = userMessage.substring(0, 200);

    if (currentContent.includes(newFact)) return;

    const appendLine = `\n- [${new Date().toISOString().split("T")[0]}] ${newFact}`;

    if (currentContent.length + appendLine.length > 5000) return;

    await supabase
      .from("olive_memory_files")
      .upsert(
        {
          user_id: userId,
          file_type: "profile",
          file_date: null,
          content: currentContent + appendLine,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,file_type,file_date" }
      );
  } catch {}
}

// ─── SOUL.MD Integration (v2, additive) ─────────────────────────

// Re-export soul types for convenience
export { assembleSoulContext, type SoulAssemblyResult, type SoulAssemblyOptions };

/**
 * Build the full system context for an LLM call, SOUL-aware.
 *
 * If the user has a soul enabled, this returns a combined prompt with:
 *   1. Soul stack (identity, user context, space context, trust)
 *   2. Memories formatted as context
 *   3. Agent insights
 *   4. Pattern context
 *
 * If soul is NOT enabled, it returns null — the caller should fall back
 * to its existing prompt-building logic. This ensures zero disruption.
 *
 * Usage in an edge function:
 * ```ts
 * const soulContext = await assembleFullContext(supabase, { userId, spaceId });
 * if (soulContext) {
 *   // Use soulContext.systemPrompt as the full system prompt
 * } else {
 *   // Fall back to existing behavior
 * }
 * ```
 */
export async function assembleFullContext(
  supabase: ReturnType<typeof createClient<any>>,
  options: SoulAssemblyOptions & { includeMemories?: boolean; includeAgentInsights?: boolean }
): Promise<{ systemPrompt: string; tokensUsed: number; layersLoaded: string[] } | null> {
  // Step 1: Try to assemble soul
  const soulResult = await assembleSoulContext(supabase, options);

  // If no soul, return null (caller uses legacy behavior)
  if (!soulResult.hasSoul) {
    return null;
  }

  const sections: string[] = [soulResult.prompt];
  let totalTokens = soulResult.tokensUsed;
  const allLayers = [...soulResult.layersLoaded];

  // Step 2: Append memories (if requested, default true)
  if (options.includeMemories !== false) {
    const memories = await fetchUserMemories(supabase, options.userId, 10);
    if (memories.length > 0) {
      const memoryLines = memories.map(
        (m) => `- [${m.category}] ${m.title}: ${m.content}`
      );
      const memoryBlock = "\n## Your memories\n" + memoryLines.join("\n");
      const memTokens = Math.ceil(memoryBlock.length / 4);
      sections.push(memoryBlock);
      totalTokens += memTokens;
      allLayers.push("memories");
    }
  }

  // Step 3: Append agent insights (if requested, default true)
  if (options.includeAgentInsights !== false) {
    const insights = await fetchAgentInsightsContext(supabase, options.userId);
    if (insights) {
      const insightTokens = Math.ceil(insights.length / 4);
      sections.push("\n" + insights);
      totalTokens += insightTokens;
      allLayers.push("agent-insights");
    }
  }

  // Step 4: Append patterns
  const patterns = await fetchPatterns(supabase, options.userId);
  if (patterns.length > 0) {
    const patternLines = patterns.map(
      (p) => `- ${p.pattern_type}: ${JSON.stringify(p.pattern_data)} (confidence: ${p.confidence})`
    );
    const patternBlock = "\n## Behavioral patterns\n" + patternLines.join("\n");
    const patTokens = Math.ceil(patternBlock.length / 4);
    sections.push(patternBlock);
    totalTokens += patTokens;
    allLayers.push("patterns");
  }

  return {
    systemPrompt: sections.join("\n"),
    tokensUsed: totalTokens,
    layersLoaded: allLayers,
  };
}

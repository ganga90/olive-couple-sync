/**
 * Shared Context Assembly & Orchestration Helpers
 * =================================================
 * Extracted from whatsapp-webhook and ask-olive-individual to provide
 * a single source of truth for context assembly.
 *
 * Both WhatsApp and in-app chat import these helpers instead of
 * duplicating memory/task/agent queries.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
 * Returns a formatted context string for LLM injection.
 */
export async function fetchAgentInsightsContext(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string
): Promise<string> {
  try {
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
  } catch (err) {
    console.warn("[Orchestrator] Agent insights fetch error (non-blocking):", err);
    return "";
  }
}

/**
 * Fetch user memories from user_memories table.
 */
export async function fetchUserMemories(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  limit = 15
): Promise<Array<{ title: string; content: string; category: string; importance?: number }>> {
  try {
    const { data: memories } = await supabase
      .from("user_memories")
      .select("title, content, category, importance")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("importance", { ascending: false })
      .limit(limit);
    return memories || [];
  } catch {
    return [];
  }
}

/**
 * Fetch user's activated skills with content.
 */
export async function fetchUserSkills(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string
): Promise<Array<{ skill_id: string; name: string; content: string; category: string }>> {
  try {
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
  } catch {
    return [];
  }
}

/**
 * Fetch behavioral patterns.
 */
export async function fetchPatterns(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string
): Promise<Array<{ pattern_type: string; pattern_data: any; confidence: number }>> {
  try {
    const { data: patterns } = await supabase
      .from("olive_patterns")
      .select("pattern_type, pattern_data, confidence")
      .eq("user_id", userId)
      .eq("is_active", true)
      .gte("confidence", 0.6)
      .limit(5);
    return patterns || [];
  } catch {
    return [];
  }
}

// ─── Dynamic Memory Files ──────────────────────────────────────

/**
 * Fetch the user's evolving profile memory file (profile.md equivalent).
 * This is a living document that grows with every conversation,
 * capturing preferences, facts, routines, and personality.
 */
export async function fetchProfileMemoryFile(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string
): Promise<string> {
  try {
    const { data } = await supabase
      .from("olive_memory_files")
      .select("content, updated_at")
      .eq("user_id", userId)
      .eq("file_type", "profile")
      .is("file_date", null)
      .maybeSingle();

    if (!data?.content || data.content.trim().length < 5) return "";

    // Truncate to ~2000 chars to keep prompt size manageable
    const content = data.content.length > 2000
      ? data.content.substring(0, 2000) + "\n...(profile truncated)"
      : data.content;

    return `## 🧠 Olive's Knowledge About You (evolving profile):\n${content}\n`;
  } catch {
    return "";
  }
}

/**
 * Fetch recent daily memory logs (last 2 days).
 * These capture what happened yesterday and today —
 * agent results, completed tasks, conversations.
 */
export async function fetchRecentDailyLogs(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string
): Promise<string> {
  try {
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
        // Truncate each day to ~800 chars
        const content = d.content.length > 800
          ? d.content.substring(0, 800) + "\n..."
          : d.content;
        return `### ${d.file_date}:\n${content}`;
      });

    if (sections.length === 0) return "";

    return `## 📅 Recent Activity Log:\n${sections.join("\n\n")}\n`;
  } catch {
    return "";
  }
}

/**
 * Fetch the household/relationship memory file (shared context).
 * Contains couple-specific knowledge like partner preferences,
 * shared routines, household info.
 */
export async function fetchHouseholdMemoryFile(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  coupleId?: string
): Promise<string> {
  if (!coupleId) return "";

  try {
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
  } catch {
    return "";
  }
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

  const combined = [profile, dailyLogs, household]
    .filter((s) => s.length > 0)
    .join("\n");

  return combined;
}

/**
 * Auto-evolve the profile memory file after a conversation.
 * Appends new facts/preferences extracted from the conversation.
 * Non-blocking — fire-and-forget to avoid slowing responses.
 */
export async function evolveProfileFromConversation(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  userMessage: string,
  oliveResponse: string
): Promise<void> {
  try {
    // Only evolve for substantive conversations (not greetings or short queries)
    if (userMessage.length < 20 && oliveResponse.length < 50) return;

    // Check if the message reveals preferences, facts, or personal info
    const factSignals = [
      /\b(i prefer|i like|i hate|i love|i always|i never|i usually|my favorite|i'm allergic|i don't eat|we always|we prefer)\b/i,
      /\b(mi piace|preferisco|odio|amo|sempre|mai|il mio preferito|sono allergic|non mangio)\b/i,
      /\b(me gusta|prefiero|odio|amo|siempre|nunca|mi favorito|soy alérgic|no como)\b/i,
      /\b(my (?:wife|husband|partner|dog|cat|kid|son|daughter|baby|mom|dad|brother|sister) (?:is|likes|hates|prefers|needs|has))\b/i,
      /\b(we live|we moved|our house|our apartment|our home|my office|my work)\b/i,
      /\b(my birthday|my anniversary|born on|born in)\b/i,
    ];

    const hasFactSignal = factSignals.some((r) => r.test(userMessage));
    if (!hasFactSignal) return;

    // Read current profile
    const { data: profileFile } = await supabase
      .from("olive_memory_files")
      .select("content")
      .eq("user_id", userId)
      .eq("file_type", "profile")
      .is("file_date", null)
      .maybeSingle();

    const currentContent = profileFile?.content || "";

    // Simple dedup: don't append if the exact sentence is already there
    const newFact = userMessage.substring(0, 200);
    if (currentContent.includes(newFact)) return;

    const appendLine = `\n- [${new Date().toISOString().split("T")[0]}] ${newFact}`;

    // Cap profile at 5000 chars to prevent unbounded growth
    if (currentContent.length + appendLine.length > 5000) {
      console.log("[Orchestrator] Profile at capacity, skipping append");
      return;
    }

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

    console.log("[Orchestrator] Profile evolved with new fact");
  } catch (err) {
    console.warn("[Orchestrator] Profile evolution error (non-blocking):", err);
  }
}

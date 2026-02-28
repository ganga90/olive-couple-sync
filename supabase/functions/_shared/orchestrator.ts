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

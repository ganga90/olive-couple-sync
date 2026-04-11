/**
 * Shared Context Assembly & Orchestration Helpers
 * =================================================
 * Extracted from whatsapp-webhook and ask-olive-individual to provide
 * a single source of truth for context assembly.
 *
 * Both WhatsApp and in-app chat import these helpers instead of
 * duplicating memory/task/agent queries.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
 * Auto-evolve memory from conversations — Phase 3 (Option D).
 *
 * Two-tier extraction:
 *  Tier 1 (fast, regex): Detect fact-signal keywords → quick append to profile
 *  Tier 2 (AI, Gemini): Extract structured facts → store as memory chunks
 *
 * Both tiers are non-blocking fire-and-forget to avoid slowing responses.
 * Tier 2 only runs for substantive conversations (user msg > 30 chars).
 */
export async function evolveProfileFromConversation(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  userMessage: string,
  oliveResponse: string
): Promise<void> {
  try {
    // Skip trivial exchanges
    if (userMessage.length < 15) return;

    // ─── Tier 1: Regex-based quick profile append ───────────────
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

    // ─── Tier 2: AI-powered fact extraction ─────────────────────
    // Runs when message is substantive (>= 30 chars)
    // Short fact signals (<30 chars) use Tier 1 instead (faster, cheaper)
    if (userMessage.length >= 30) {
      await extractAndStoreConversationFacts(
        supabase,
        userId,
        userMessage,
        oliveResponse
      );
    } else if (hasFactSignal) {
      // ─── Tier 1: quick profile append for short fact-signal messages
      await quickProfileAppend(supabase, userId, userMessage);
    }
  } catch (err) {
    console.warn("[Orchestrator] Profile evolution error (non-blocking):", err);
  }
}

/**
 * Extract structured facts from a conversation turn using Gemini AI.
 * Stores each extracted fact as an olive_memory_chunk with source='conversation'.
 * Also appends high-importance facts to the profile memory file.
 */
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

  if (!GEMINI_API_KEY) {
    console.log("[ConvMemory] No Gemini API key, skipping extraction");
    return;
  }

  // Fetch compiled profile to avoid re-extracting already-known facts
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
      const truncated = profileData.content.substring(0, 400);
      knownFactsBlock = `\n[ALREADY KNOWN FACTS]:\n${truncated}\n\nFocus on extracting NEW facts not already covered above. Skip facts that simply repeat known information.\n`;
    }
  } catch (err) {
    console.warn("[ConvMemory] Profile fetch for dedup failed (non-blocking):", err);
  }

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
- Each fact should be a self-contained statement (understandable without context)
- Deduplicate: if two facts say the same thing, keep only the more specific one

Return a JSON array. If no memorable facts, return [].
Each item: {"content":"concise fact statement","type":"preference|fact|pattern|personal_info|decision","importance":1-5}

Example: [{"content":"Allergic to shellfish","type":"personal_info","importance":5}]`;

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
      console.error("[ConvMemory] Gemini error:", response.status);
      return;
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const facts: Array<{
      content: string;
      type: string;
      importance: number;
    }> = JSON.parse(jsonMatch[0]);

    if (!facts || facts.length === 0) return;

    console.log(`[ConvMemory] Extracted ${facts.length} facts from conversation`);

    // Generate embeddings for each fact (batch-friendly)
    const embeddingPromises = facts.map(async (fact) => {
      try {
        const embResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: { parts: [{ text: fact.content }] },
              outputDimensionality: 768,
            }),
          }
        );
        if (!embResp.ok) return null;
        const embData = await embResp.json();
        return embData.embedding?.values || null;
      } catch {
        return null;
      }
    });

    const embeddings = await Promise.all(embeddingPromises);

    // Store each fact as a memory chunk
    let stored = 0;
    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i];
      const embedding = embeddings[i];

      // Dedup check: search for very similar existing chunks
      if (embedding) {
        try {
          const { data: similar } = await supabase.rpc("find_similar_chunks", {
            p_user_id: userId,
            p_embedding: embedding,
            p_threshold: 0.95, // Very high threshold = near-duplicate
            p_limit: 1,
          });

          if (similar && similar.length > 0) {
            console.log(`[ConvMemory] Skipping duplicate: "${fact.content.substring(0, 50)}..."`);
            continue; // Skip near-duplicate
          }
        } catch (dedupErr: any) {
          // RPC might not exist yet (migration pending) — log and proceed
          console.warn("[ConvMemory] Dedup check failed (non-blocking):", dedupErr?.message || dedupErr);
        }
      }

      const { error } = await supabase.from("olive_memory_chunks").insert({
        user_id: userId,
        memory_file_id: null, // Standalone chunk, linked during compilation
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

    // ─── Decision Detection (regex-based, no API calls) ──────────
    try {
      // Patterns that indicate a real decision (require "we" or coupled subject)
      const decisionPatterns = [
        /\bwe decided\b/i,
        /\blet'?s go with\b/i,
        /\bfinal answer\b/i,
        /\bwe agreed\b/i,
        /\bdecision made\b/i,
        /\bgoing to go with\b/i,
        /\bsettled on\b/i,
        /\bchose to\b/i,
        /\bmade up (?:our|my) mind\b/i,
      ];

      // Casual / low-value patterns to exclude (personal trivial decisions)
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
          // Extract the sentence containing the decision
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

          console.log(`[ConvMemory] Decision detected and stored: "${decisionContent.substring(0, 60)}..."`);
        }
      }
    } catch (decisionErr) {
      console.warn("[ConvMemory] Decision detection error (non-blocking):", decisionErr);
    }

    // Also append high-importance facts to profile file (for immediate context)
    const highImportanceFacts = facts.filter((f) => f.importance >= 4);
    if (highImportanceFacts.length > 0) {
      await appendFactsToProfile(supabase, userId, highImportanceFacts);
    }
  } catch (err) {
    console.warn("[ConvMemory] Extraction error (non-blocking):", err);
  }
}

/**
 * Append high-importance facts to the profile memory file.
 * Includes dedup check against existing content.
 */
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
      // Simple dedup: skip if content already in profile
      if (currentContent.toLowerCase().includes(fact.content.toLowerCase().substring(0, 30))) {
        continue;
      }
      newLines.push(`- [${today}] ${fact.content}`);
    }

    if (newLines.length === 0) return;

    const appendText = "\n" + newLines.join("\n");

    // Cap profile at 5000 chars
    if (currentContent.length + appendText.length > 5000) {
      console.log("[ConvMemory] Profile at capacity, skipping append");
      return;
    }

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

    console.log(`[ConvMemory] Appended ${newLines.length} facts to profile`);
  } catch (err) {
    console.warn("[ConvMemory] Profile append error:", err);
  }
}

/**
 * Quick profile append for short messages with clear fact signals.
 * No AI call — just regex-detected facts appended directly.
 */
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

    console.log("[ConvMemory] Quick profile append");
  } catch (err) {
    console.warn("[ConvMemory] Quick append error:", err);
  }
}

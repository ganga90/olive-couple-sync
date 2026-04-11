/**
 * Task Search & Resolution — Shared Helpers
 * =============================================
 * Reusable task search functions for both WhatsApp and web chat.
 * Handles keyword search, semantic search, relative references,
 * and match quality scoring.
 *
 * Extracted from whatsapp-webhook to enable reuse across:
 *   - WhatsApp webhook (task actions)
 *   - ask-olive-individual (contextual ask)
 *   - ask-olive-stream (task context)
 *
 * Usage:
 *   import { semanticTaskSearchMulti, resolveRelativeReference } from "../_shared/task-search.ts";
 */

// ─── Types ─────────────────────────────────────────────────────

export interface TaskCandidate {
  id: string;
  summary: string;
  priority: string;
  completed: boolean;
  task_owner: string | null;
  author_id: string;
  couple_id: string | null;
  due_date: string | null;
  reminder_time: string | null;
  score?: number;
  matchQuality?: number;
}

// ─── Relative Reference Resolution ────────────────────────────

const RELATIVE_REFERENCE_PATTERNS = [
  /^(?:the\s+)?(?:last|latest|most\s+recent|previous|newest|recent)\s+(?:task|one|item|note|thing)$/i,
  /^(?:the\s+)?(?:last|latest|most\s+recent|previous|newest|recent)\s+(?:task|one|item|note|thing)\s+(?:i\s+)?(?:added|created|saved|sent|made)$/i,
  /^(?:that|the)\s+(?:task|one|item|note|thing)\s+(?:i\s+)?(?:just\s+)?(?:added|created|saved|sent|made)$/i,
  /^(?:the\s+)?(?:one|task|item|note)\s+(?:i\s+)?(?:just\s+)?(?:added|created|saved|sent)$/i,
  /^(?:l'ultima|l'ultimo|ultima|ultimo)\s*(?:attività|compito|nota|cosa)?$/i, // Italian
  /^(?:la\s+)?(?:última|ultimo|reciente)\s*(?:tarea|nota|cosa)?$/i, // Spanish
];

export function isRelativeReference(target: string): boolean {
  if (!target) return false;
  return RELATIVE_REFERENCE_PATTERNS.some((p) => p.test(target.trim()));
}

export async function resolveRelativeReference(
  supabase: any,
  userId: string,
  coupleId: string | null,
  completedFilter: boolean = false
): Promise<any | null> {
  try {
    let query = supabase
      .from("clerk_notes")
      .select("id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time, list_id, created_at")
      .eq("completed", completedFilter)
      .order("created_at", { ascending: false })
      .limit(1);

    if (coupleId) {
      query = query.or(`couple_id.eq.${coupleId},and(author_id.eq.${userId},couple_id.is.null)`);
    } else {
      query = query.eq("author_id", userId);
    }

    const { data, error } = await query;
    if (error || !data || data.length === 0) return null;

    console.log('[RelativeRef] Resolved "last task" to:', data[0].summary, "(id:", data[0].id, ")");
    return data[0];
  } catch (e) {
    console.error("[RelativeRef] Error:", e);
    return null;
  }
}

// ─── Match Quality Scoring ─────────────────────────────────────

/**
 * Compute word-overlap quality between a query and a task summary.
 * Returns 0-1 where 1 = all query words matched.
 */
export function computeMatchQuality(query: string, taskSummary: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const queryWords = new Set(normalize(query).split(/\s+/).filter((w) => w.length > 1));
  const taskWords = new Set(normalize(taskSummary).split(/\s+/).filter((w) => w.length > 1));

  if (queryWords.size === 0) return 0;

  let matchedWords = 0;
  for (const qw of queryWords) {
    for (const tw of taskWords) {
      if (tw === qw || tw.includes(qw) || qw.includes(tw)) {
        matchedWords++;
        break;
      }
    }
  }

  return matchedWords / queryWords.size;
}

// ─── Keyword Search ────────────────────────────────────────────

export async function searchTaskByKeywords(
  supabase: any,
  userId: string,
  coupleId: string | null,
  keywords: string[]
): Promise<any | null> {
  let query = supabase
    .from("clerk_notes")
    .select("id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time")
    .eq("completed", false)
    .order("created_at", { ascending: false })
    .limit(50);

  if (coupleId) {
    query = query.or(`couple_id.eq.${coupleId},and(author_id.eq.${userId},couple_id.is.null)`);
  } else {
    query = query.eq("author_id", userId);
  }

  const { data: tasks, error } = await query;
  if (error || !tasks || tasks.length === 0) return null;

  const scoredTasks = tasks.map((task: any) => {
    const summaryLower = task.summary.toLowerCase();
    let score = 0;

    for (const keyword of keywords) {
      const keywordLower = keyword.toLowerCase();
      if (keywordLower.length < 2) continue;

      if (summaryLower.includes(keywordLower)) {
        if (summaryLower.split(/\s+/).some((word: string) => word === keywordLower)) {
          score += 10;
        } else {
          score += 5;
        }
      }
    }

    return { ...task, score };
  });

  scoredTasks.sort((a: any, b: any) => b.score - a.score);

  if (scoredTasks[0]?.score > 0) {
    return scoredTasks[0];
  }

  return null;
}

// ─── Semantic Task Search ──────────────────────────────────────

/**
 * Multi-candidate semantic task search using hybrid_search_notes RPC.
 * Falls back through: vector+text → text-only → keyword search.
 */
export async function semanticTaskSearchMulti(
  supabase: any,
  userId: string,
  coupleId: string | null,
  queryString: string,
  generateEmbedding: (text: string) => Promise<number[] | null>,
  limit: number = 5
): Promise<TaskCandidate[]> {
  try {
    console.log("[semanticTaskSearch] Searching for:", queryString);

    const embedding = await generateEmbedding(queryString);
    let candidates: TaskCandidate[] = [];

    if (embedding) {
      const { data, error } = await supabase.rpc("hybrid_search_notes", {
        p_user_id: userId,
        p_couple_id: coupleId,
        p_query: queryString,
        p_query_embedding: JSON.stringify(embedding),
        p_vector_weight: 0.7,
        p_limit: limit,
      });

      if (!error && data && data.length > 0) {
        candidates = data
          .filter((t: any) => !t.completed)
          .map((t: any) => ({
            ...t,
            matchQuality: computeMatchQuality(queryString, t.summary),
          }));
      }

      if (error) {
        console.warn("[semanticTaskSearch] Hybrid search error:", error);
      }
    }

    // Fallback: text-only search
    if (candidates.length === 0) {
      console.log("[semanticTaskSearch] Falling back to text-only search");
      const { data: textData, error: textError } = await supabase.rpc("hybrid_search_notes", {
        p_user_id: userId,
        p_couple_id: coupleId,
        p_query: queryString,
        p_query_embedding: JSON.stringify(new Array(1536).fill(0)),
        p_vector_weight: 0.0,
        p_limit: limit,
      });

      if (!textError && textData && textData.length > 0) {
        candidates = textData
          .filter((t: any) => !t.completed)
          .map((t: any) => ({
            ...t,
            matchQuality: computeMatchQuality(queryString, t.summary),
          }));
      }
    }

    // Final fallback: keyword search
    if (candidates.length === 0) {
      console.log("[semanticTaskSearch] No semantic match, falling back to keyword search");
      const keywords = queryString.split(/\s+/).filter((w) => w.length > 2);
      if (keywords.length > 0) {
        let query = supabase
          .from("clerk_notes")
          .select("id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time")
          .eq("completed", false)
          .order("created_at", { ascending: false })
          .limit(50);
        if (coupleId) {
          query = query.or(`couple_id.eq.${coupleId},and(author_id.eq.${userId},couple_id.is.null)`);
        } else {
          query = query.eq("author_id", userId);
        }
        const { data: tasks } = await query;
        if (tasks) {
          candidates = tasks
            .map((task: any) => {
              const mq = computeMatchQuality(queryString, task.summary);
              return { ...task, matchQuality: mq, score: mq };
            })
            .filter((t: any) => t.matchQuality > 0)
            .sort((a: any, b: any) => b.matchQuality - a.matchQuality)
            .slice(0, limit);
        }
      }
    }

    // Log candidates
    for (const c of candidates.slice(0, 5)) {
      console.log(
        `[semanticTaskSearch] Candidate: "${c.summary}" score=${c.score?.toFixed(3)} matchQ=${c.matchQuality?.toFixed(2)}`
      );
    }

    return candidates;
  } catch (error) {
    console.error("[semanticTaskSearch] Error:", error);
    return [];
  }
}

/**
 * Single-result wrapper for semantic task search.
 * Returns the best match if quality >= 0.4 word overlap.
 */
export async function semanticTaskSearch(
  supabase: any,
  userId: string,
  coupleId: string | null,
  queryString: string,
  generateEmbedding: (text: string) => Promise<number[] | null>
): Promise<any | null> {
  const candidates = await semanticTaskSearchMulti(supabase, userId, coupleId, queryString, generateEmbedding, 5);
  if (candidates.length === 0) return null;

  const best = candidates[0];
  if ((best.matchQuality ?? 1) < 0.4) {
    console.log(`[semanticTaskSearch] Best match "${best.summary}" has low quality ${best.matchQuality?.toFixed(2)}, rejecting`);
    return null;
  }
  return best;
}

/**
 * Find similar notes using embedding similarity (for merge detection).
 */
export async function findSimilarNotes(
  supabase: any,
  userId: string,
  coupleId: string | null | undefined,
  embedding: number[],
  excludeId: string
): Promise<{ id: string; summary: string; similarity: number } | null> {
  try {
    const { data, error } = await supabase.rpc("find_similar_notes", {
      p_user_id: userId,
      p_couple_id: coupleId,
      p_query_embedding: JSON.stringify(embedding),
      p_threshold: 0.85,
      p_limit: 5,
    });

    if (error) {
      console.error("Error finding similar notes:", error);
      return null;
    }

    const matches = (data || []).filter((n: any) => n.id !== excludeId);

    if (matches.length > 0) {
      return {
        id: matches[0].id,
        summary: matches[0].summary,
        similarity: matches[0].similarity,
      };
    }

    return null;
  } catch (error) {
    console.error("Error in findSimilarNotes:", error);
    return null;
  }
}

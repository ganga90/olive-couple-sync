/**
 * Context Soul — CONTEXTUAL_ASK planner
 * =======================================
 * Fires when the user asks a question about their saved data
 * ("when do I land in Rome?", "what's the wifi password at the
 * airbnb?"). The LLM needs the most relevant rows from `clerk_notes`
 * — not the kitchen-sink dump in SLOT_DYNAMIC.
 *
 * Two retrieval paths, picked at runtime:
 *
 *   A. **Vector search** when the caller injected a `generateEmbedding`
 *      function (whatsapp-webhook + ask-olive-stream both have one).
 *      We embed the query, call the existing `find_similar_notes` RPC
 *      with threshold 0.65 (lower than dedup's 0.85 because we want
 *      paraphrase recall), and pull top-K.
 *
 *   B. **Keyword fallback** when no embedder is provided. Extracts
 *      significant words from the query, OR-joins them, runs a
 *      websearch tsquery against summary. Worse recall than vector,
 *      but doesn't pull Gemini SDK into the framework.
 *
 * Either path returns IDs from the RPC/keyword search; we then
 * fetch full content (summary + original_text + category +
 * due_date) so the LLM has actual answers to extract from. The
 * RPC alone returns only id + summary, which isn't enough.
 *
 * Token efficiency: top-K of 5, ~80 chars per item summary, ~150
 * chars per full body → ~1.2K chars per row → ~300 tokens total
 * for 5 rows. Far tighter than the global "all your saved data"
 * dump.
 */

import { registerPlanner } from "../registry.ts";
import { buildBudgetedSection, estimateTokens } from "../budget.ts";

const STOP_WORDS = new Set([
  "a", "an", "the", "to", "of", "in", "for", "and", "or", "is", "it",
  "my", "me", "i", "that", "this", "we", "us", "our", "your", "you",
  "what", "when", "where", "who", "how", "why", "did", "do", "does",
  "have", "has", "had", "are", "was", "were", "be", "been", "being",
  "un", "una", "il", "la", "le", "lo", "di", "da", "per", "che",
  "el", "los", "las", "del", "en", "por", "con", "los",
]);

const VECTOR_THRESHOLD = 0.65;
const TOP_K = 5;

interface NoteRow {
  id: string;
  summary: string | null;
  original_text: string | null;
  category: string | null;
  due_date: string | null;
  completed: boolean | null;
}

function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\w\sáéíóúñàèìòù]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

registerPlanner("CONTEXTUAL_ASK", async (supabase, params) => {
  const { userId, spaceId, coupleId, query, budgetTokens, generateEmbedding } = params;
  if (!query || query.trim().length === 0) {
    return {
      prompt: "",
      tokensUsed: 0,
      sectionsLoaded: ["no-query"],
      fellBackToDefault: false,
    };
  }

  const sectionsLoaded: string[] = [];
  let candidateIds: string[] = [];

  // ─── Path A: vector search via find_similar_notes ──────────────
  // Caller supplies generateEmbedding when they have GEMINI_API in
  // scope. Cleanly degrades to keyword if absent.
  if (typeof generateEmbedding === "function") {
    try {
      const embedding = await generateEmbedding(query);
      if (embedding && Array.isArray(embedding)) {
        const { data: hits } = await supabase.rpc("find_similar_notes", {
          p_user_id: userId,
          p_couple_id: coupleId, // RPC accepts uuid; null is fine
          p_query_embedding: JSON.stringify(embedding),
          p_threshold: VECTOR_THRESHOLD,
          p_limit: TOP_K,
        });
        if (hits && Array.isArray(hits) && hits.length > 0) {
          candidateIds = hits.map((h: { id: string }) => h.id);
          sectionsLoaded.push("vector-search");
        }
      }
    } catch (err) {
      // Vector path failed — fall through to keyword.
      console.warn("[contextual-ask-planner] vector search failed:", err);
    }
  }

  // ─── Path B: keyword fallback ──────────────────────────────────
  // Only runs when vector returned nothing (or wasn't available).
  if (candidateIds.length === 0) {
    const keywords = extractKeywords(query);
    if (keywords.length === 0) {
      return {
        prompt: "",
        tokensUsed: 0,
        sectionsLoaded: ["no-keywords"],
        fellBackToDefault: false,
      };
    }
    try {
      const tsquery = keywords.slice(0, 5).join(" | ");
      let kwQuery = supabase
        .from("clerk_notes")
        .select("id")
        .textSearch("summary", tsquery, { type: "websearch" });
      // Scope to this user OR the couple/space — apply BEFORE order/limit
      // so .limit() stays the terminal call (Supabase JS canonical pattern).
      if (spaceId) {
        kwQuery = kwQuery.or(`author_id.eq.${userId},space_id.eq.${spaceId}`);
      } else {
        kwQuery = kwQuery.eq("author_id", userId);
      }
      const { data: rows } = await kwQuery
        .order("created_at", { ascending: false })
        .limit(TOP_K);
      if (rows && Array.isArray(rows) && rows.length > 0) {
        candidateIds = (rows as { id: string }[]).map((r) => r.id);
        sectionsLoaded.push("keyword-search");
      }
    } catch (err) {
      console.warn("[contextual-ask-planner] keyword search failed:", err);
    }
  }

  if (candidateIds.length === 0) {
    return {
      prompt: "",
      tokensUsed: 0,
      sectionsLoaded: [...sectionsLoaded, "no-matches"],
      fellBackToDefault: false,
    };
  }

  // ─── Hydrate: pull full content for the matched rows ──────────
  // The vector RPC returns only id + summary; keyword path returns
  // only id. Either way we need a single round-trip to enrich.
  let notes: NoteRow[] = [];
  try {
    const { data } = await supabase
      .from("clerk_notes")
      .select("id, summary, original_text, category, due_date, completed")
      .in("id", candidateIds)
      .limit(TOP_K);
    notes = (data as NoteRow[]) || [];
  } catch (err) {
    console.warn("[contextual-ask-planner] hydrate failed:", err);
  }

  if (notes.length === 0) {
    return {
      prompt: "",
      tokensUsed: 0,
      sectionsLoaded: [...sectionsLoaded, "hydrate-empty"],
      fellBackToDefault: false,
    };
  }

  // Order by candidateIds so vector ranking is preserved
  const orderMap = new Map(candidateIds.map((id, i) => [id, i]));
  notes.sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));

  const lines: string[] = ["These saved items are most relevant to the question:"];
  notes.forEach((n, idx) => {
    const cat = n.category ? `[${n.category}] ` : "";
    const status = n.completed ? " (done)" : "";
    const due = n.due_date ? ` · due ${new Date(n.due_date).toISOString().slice(0, 10)}` : "";
    lines.push(`${idx + 1}. ${cat}${n.summary || "(no summary)"}${status}${due}`);
    // Include original_text only if it adds info beyond the summary —
    // common pattern is summary == truncated original_text.
    if (n.original_text && n.original_text.trim() && n.original_text.trim() !== (n.summary || "").trim()) {
      // Cap each body so a long note can't blow the budget alone.
      const body = n.original_text.length > 240
        ? n.original_text.slice(0, 240) + "..."
        : n.original_text;
      lines.push(`   Full details: ${body}`);
    }
  });

  const fullText = lines.join("\n");
  const built = buildBudgetedSection("Saved items relevant to your question", fullText, budgetTokens);
  return {
    prompt: built.text,
    tokensUsed: built.tokens || estimateTokens(built.text),
    sectionsLoaded,
    fellBackToDefault: false,
  };
});

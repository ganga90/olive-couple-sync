/**
 * Memory Retrieval — unified interface for fetching learned facts
 * ================================================================
 * Closes the critical gap where maintained memory chunks never reach
 * the LLM prompt because semantic search silently fails when:
 *   (a) no query embedding is available, or
 *   (b) the search_memory_chunks RPC doesn't exist / errors.
 *
 * Strategy:
 *   1. If a query embedding is available → try semantic search first.
 *   2. ALWAYS fetch top-k by importance as a baseline.
 *   3. Merge results: semantic hits take priority; importance-only
 *      fills gaps up to the limit.
 *
 * Design invariants:
 *
 *   1. NEVER EMPTY.
 *      If there are active memory chunks, at least some will appear
 *      in the prompt — importance-only fallback guarantees this.
 *
 *   2. TESTABLE PURE CORE.
 *      `mergeMemoryResults`, `formatMemoryChunksForPrompt`, and
 *      `shouldAttemptSemanticSearch` are pure functions.
 *      `fetchMemoryChunks` is the orchestrator (DB + optional embedding).
 *
 *   3. FAIL-SAFE.
 *      Semantic search failure degrades to importance-only.
 *      Importance-only failure degrades to empty string.
 *      No thrown errors escape to the caller.
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface MemoryChunk {
  id: string;
  content: string;
  chunk_type: string;
  importance: number;
  source?: string;
  similarity?: number;
  decay_factor?: number;
  created_at?: string;
}

export interface MemoryRetrievalResult {
  /** Formatted string ready for prompt injection. */
  promptBlock: string;
  /** How many chunks from semantic search. */
  semanticCount: number;
  /** How many chunks from importance-only fallback. */
  importanceCount: number;
  /** Total unique chunks returned. */
  totalCount: number;
  /** Which strategy produced results. */
  strategy: "semantic" | "importance_only" | "merged" | "empty";
}

export interface MemoryRetrievalConfig {
  /** Max chunks to return from semantic search. */
  semanticLimit: number;
  /** Max chunks to return from importance fallback. */
  importanceLimit: number;
  /** Min importance for importance-only query. */
  minImportance: number;
  /** Min importance for semantic query. */
  semanticMinImportance: number;
  /** Max total chunks to include in prompt. */
  maxTotal: number;
}

export const DEFAULT_RETRIEVAL_CONFIG: MemoryRetrievalConfig = {
  semanticLimit: 8,
  importanceLimit: 6,
  minImportance: 3,
  semanticMinImportance: 2,
  maxTotal: 10,
};

// ─── Pure logic (unit-test surface) ─────────────────────────────────

/**
 * Gate: should we attempt semantic search?
 * Requires both a query embedding AND a non-empty user message.
 */
export function shouldAttemptSemanticSearch(
  queryEmbedding: number[] | null,
  userMessage: string | null | undefined
): boolean {
  if (!queryEmbedding || queryEmbedding.length === 0) return false;
  if (!userMessage || userMessage.trim().length < 3) return false;
  return true;
}

/**
 * Merge semantic + importance results. Semantic hits take priority
 * (they're relevance-ranked); importance-only fills remaining slots.
 * Deduplicates by chunk ID.
 */
export function mergeMemoryResults(
  semanticChunks: MemoryChunk[],
  importanceChunks: MemoryChunk[],
  maxTotal: number
): MemoryChunk[] {
  const seen = new Set<string>();
  const merged: MemoryChunk[] = [];

  // Semantic first (relevance-ranked).
  // Cap check BEFORE push — earlier this came after, producing an
  // off-by-one where `maxTotal=0` returned 1 chunk. Caught by the
  // pre-existing `maxTotal=0 → empty` test.
  for (const chunk of semanticChunks) {
    if (merged.length >= maxTotal) break;
    if (seen.has(chunk.id)) continue;
    seen.add(chunk.id);
    merged.push(chunk);
  }

  // Importance-only fills gaps — same cap-before-push pattern.
  for (const chunk of importanceChunks) {
    if (merged.length >= maxTotal) break;
    if (seen.has(chunk.id)) continue;
    seen.add(chunk.id);
    merged.push(chunk);
  }

  return merged;
}

/**
 * Format memory chunks into a prompt-ready string.
 * Compact format to maximize information per token.
 */
export function formatMemoryChunksForPrompt(
  chunks: MemoryChunk[]
): string {
  if (chunks.length === 0) return "";

  const lines = chunks.map((c) => {
    const meta: string[] = [];
    if (c.importance >= 4) meta.push(`importance:${c.importance}/5`);
    if (c.source) meta.push(`via:${c.source}`);
    const metaStr = meta.length > 0 ? ` (${meta.join(", ")})` : "";
    return `- ${c.content}${metaStr}`;
  });

  return (
    "## RELEVANT LEARNED FACTS (from conversations & notes):\n" +
    lines.join("\n")
  );
}

// ─── DB Fetcher (thin, testable by dep injection) ───────────────────

/**
 * Abstract DB interface — injected in tests, Supabase client in production.
 */
export interface MemoryDB {
  searchMemoryChunks(
    userId: string,
    queryEmbedding: number[],
    limit: number,
    minImportance: number
  ): Promise<MemoryChunk[]>;

  fetchTopMemoryChunks(
    userId: string,
    limit: number,
    minImportance: number
  ): Promise<MemoryChunk[]>;
}

/**
 * Supabase adapter — wraps RPC calls into the MemoryDB interface.
 */
export function createSupabaseMemoryDB(supabase: any): MemoryDB {
  return {
    async searchMemoryChunks(
      userId: string,
      queryEmbedding: number[],
      limit: number,
      minImportance: number
    ): Promise<MemoryChunk[]> {
      const { data, error } = await supabase.rpc("search_memory_chunks", {
        p_user_id: userId,
        p_query_embedding: JSON.stringify(queryEmbedding),
        p_limit: limit,
        p_min_importance: minImportance,
      });
      if (error) throw new Error(`search_memory_chunks: ${error.message}`);
      return (data || []).map((row: any) => ({
        id: row.id,
        content: row.content,
        chunk_type: row.chunk_type,
        importance: row.importance,
        similarity: row.similarity,
        source: row.source,
        created_at: row.created_at,
      }));
    },

    async fetchTopMemoryChunks(
      userId: string,
      limit: number,
      minImportance: number
    ): Promise<MemoryChunk[]> {
      const { data, error } = await supabase.rpc("fetch_top_memory_chunks", {
        p_user_id: userId,
        p_limit: limit,
        p_min_importance: minImportance,
      });
      if (error) throw new Error(`fetch_top_memory_chunks: ${error.message}`);
      return (data || []).map((row: any) => ({
        id: row.id,
        content: row.content,
        chunk_type: row.chunk_type,
        importance: row.importance,
        source: row.source,
        decay_factor: row.decay_factor,
        created_at: row.created_at,
      }));
    },
  };
}

// ─── Orchestrator ───────────────────────────────────────────────────

/**
 * Unified memory retrieval: tries semantic search, falls back to
 * importance-only, merges results, formats for prompt injection.
 *
 * This is the single entry point the orchestrator should call.
 * It NEVER throws — failure degrades to empty result.
 */
export async function fetchMemoryChunks(
  db: MemoryDB,
  userId: string,
  queryEmbedding: number[] | null,
  userMessage: string | null | undefined,
  config: MemoryRetrievalConfig = DEFAULT_RETRIEVAL_CONFIG
): Promise<MemoryRetrievalResult> {
  let semanticChunks: MemoryChunk[] = [];
  let importanceChunks: MemoryChunk[] = [];

  // Step 1: Try semantic search if we have an embedding
  if (shouldAttemptSemanticSearch(queryEmbedding, userMessage)) {
    try {
      semanticChunks = await db.searchMemoryChunks(
        userId,
        queryEmbedding!,
        config.semanticLimit,
        config.semanticMinImportance
      );
    } catch (err) {
      console.warn(
        `[MemoryRetrieval] Semantic search failed (falling back to importance):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Step 2: ALWAYS try importance-only as baseline/fallback
  try {
    importanceChunks = await db.fetchTopMemoryChunks(
      userId,
      config.importanceLimit,
      config.minImportance
    );
  } catch (err) {
    console.warn(
      `[MemoryRetrieval] Importance fallback failed:`,
      err instanceof Error ? err.message : err
    );
  }

  // Step 3: Merge + format
  const merged = mergeMemoryResults(
    semanticChunks,
    importanceChunks,
    config.maxTotal
  );

  const promptBlock = formatMemoryChunksForPrompt(merged);

  // Determine strategy
  let strategy: MemoryRetrievalResult["strategy"];
  if (merged.length === 0) {
    strategy = "empty";
  } else if (semanticChunks.length > 0 && importanceChunks.length > 0) {
    // Check if importance actually contributed new chunks
    const semanticIds = new Set(semanticChunks.map((c) => c.id));
    const importanceOnlyCount = merged.filter(
      (c) => !semanticIds.has(c.id)
    ).length;
    strategy = importanceOnlyCount > 0 ? "merged" : "semantic";
  } else if (semanticChunks.length > 0) {
    strategy = "semantic";
  } else {
    strategy = "importance_only";
  }

  return {
    promptBlock,
    semanticCount: semanticChunks.length,
    importanceCount: importanceChunks.length,
    totalCount: merged.length,
    strategy,
  };
}

// ─── Embedding Backfill Helper ──────────────────────────────────────

export interface EmbeddingGenerator {
  (text: string): Promise<number[] | null>;
}

/**
 * Backfill embeddings for chunks that are missing them.
 * Called by heartbeat on each tick (incremental, not batch).
 *
 * Returns count of successfully backfilled embeddings.
 */
export async function backfillChunkEmbeddings(
  supabase: any,
  generateEmbedding: EmbeddingGenerator,
  limit: number = 10
): Promise<{ repaired: number; failed: number; remaining: number }> {
  // Fetch chunks needing embeddings
  const { data: chunks, error } = await supabase.rpc(
    "get_chunks_needing_embeddings",
    { p_limit: limit }
  );

  if (error) {
    console.error("[EmbeddingBackfill] RPC error:", error.message);
    return { repaired: 0, failed: 0, remaining: -1 };
  }

  if (!chunks || chunks.length === 0) {
    return { repaired: 0, failed: 0, remaining: 0 };
  }

  let repaired = 0;
  let failed = 0;

  for (const chunk of chunks) {
    try {
      const embedding = await generateEmbedding(chunk.content);
      if (!embedding) {
        failed++;
        continue;
      }

      const { error: updateErr } = await supabase
        .from("olive_memory_chunks")
        .update({ embedding })
        .eq("id", chunk.id);

      if (updateErr) {
        failed++;
        console.warn(
          `[EmbeddingBackfill] Update failed for chunk ${chunk.id}:`,
          updateErr.message
        );
      } else {
        repaired++;
      }
    } catch (err) {
      failed++;
      console.warn(
        `[EmbeddingBackfill] Failed chunk ${chunk.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Check remaining
  const { data: remainingData } = await supabase.rpc(
    "get_chunks_needing_embeddings",
    { p_limit: 1 }
  );
  const remaining = remainingData?.length > 0 ? -1 : 0; // -1 = more exist

  console.log(
    `[EmbeddingBackfill] Repaired ${repaired}/${chunks.length} chunk embeddings` +
      (remaining !== 0 ? " (more remaining)" : " (all caught up)")
  );

  return { repaired, failed, remaining: remaining === -1 ? chunks.length : 0 };
}

/**
 * Backfill embeddings for clerk_notes that are missing them.
 */
export async function backfillNoteEmbeddings(
  supabase: any,
  generateEmbedding: EmbeddingGenerator,
  limit: number = 10
): Promise<{ repaired: number; failed: number }> {
  const { data: notes, error } = await supabase.rpc(
    "get_notes_needing_embeddings",
    { p_limit: limit }
  );

  if (error) {
    console.error("[NoteEmbeddingBackfill] RPC error:", error.message);
    return { repaired: 0, failed: 0 };
  }

  if (!notes || notes.length === 0) {
    return { repaired: 0, failed: 0 };
  }

  let repaired = 0;
  let failed = 0;

  for (const note of notes) {
    try {
      const embedding = await generateEmbedding(note.content);
      if (!embedding) {
        failed++;
        continue;
      }

      const { error: updateErr } = await supabase
        .from("clerk_notes")
        .update({ embedding })
        .eq("id", note.id);

      if (updateErr) {
        failed++;
      } else {
        repaired++;
      }
    } catch (err) {
      failed++;
    }
  }

  if (repaired > 0) {
    console.log(
      `[NoteEmbeddingBackfill] Repaired ${repaired}/${notes.length} note embeddings`
    );
  }

  return { repaired, failed };
}

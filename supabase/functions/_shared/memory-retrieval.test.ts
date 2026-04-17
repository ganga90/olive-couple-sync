/**
 * Memory Retrieval — Deep Test Suite
 * ====================================
 * Tests the pure functions + orchestrator of the unified memory retrieval
 * module. Uses dep-injected MemoryDB so no real Supabase or API needed.
 *
 * Coverage:
 *   1. shouldAttemptSemanticSearch — gate conditions
 *   2. mergeMemoryResults — dedup, priority, limit
 *   3. formatMemoryChunksForPrompt — formatting, empty, importance display
 *   4. fetchMemoryChunks — orchestrator: semantic+fallback, fallback-only,
 *      semantic failure, both failure, strategy detection
 *   5. backfillChunkEmbeddings — success, partial failure, empty queue
 *   6. createSupabaseMemoryDB — adapter shape validation
 */

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  shouldAttemptSemanticSearch,
  mergeMemoryResults,
  formatMemoryChunksForPrompt,
  fetchMemoryChunks,
  backfillChunkEmbeddings,
  backfillNoteEmbeddings,
  DEFAULT_RETRIEVAL_CONFIG,
  type MemoryChunk,
  type MemoryDB,
  type MemoryRetrievalConfig,
  type EmbeddingGenerator,
} from "./memory-retrieval.ts";

// ─── Helpers ────────────────────────────────────────────────────────

function makeChunk(overrides: Partial<MemoryChunk> & { id: string }): MemoryChunk {
  return {
    content: `Fact about ${overrides.id}`,
    chunk_type: "fact",
    importance: 4,
    source: "conversation",
    ...overrides,
  };
}

function makeMockDB(opts: {
  semanticChunks?: MemoryChunk[];
  importanceChunks?: MemoryChunk[];
  semanticError?: Error;
  importanceError?: Error;
}): MemoryDB {
  return {
    async searchMemoryChunks(_userId, _embedding, _limit, _minImportance) {
      if (opts.semanticError) throw opts.semanticError;
      return opts.semanticChunks || [];
    },
    async fetchTopMemoryChunks(_userId, _limit, _minImportance) {
      if (opts.importanceError) throw opts.importanceError;
      return opts.importanceChunks || [];
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. shouldAttemptSemanticSearch
// ═══════════════════════════════════════════════════════════════════

Deno.test("shouldAttemptSemanticSearch: true with valid embedding + message", () => {
  assertEquals(shouldAttemptSemanticSearch([0.1, 0.2, 0.3], "hello world"), true);
});

Deno.test("shouldAttemptSemanticSearch: false with null embedding", () => {
  assertEquals(shouldAttemptSemanticSearch(null, "hello world"), false);
});

Deno.test("shouldAttemptSemanticSearch: false with empty embedding array", () => {
  assertEquals(shouldAttemptSemanticSearch([], "hello world"), false);
});

Deno.test("shouldAttemptSemanticSearch: false with null message", () => {
  assertEquals(shouldAttemptSemanticSearch([0.1], null), false);
});

Deno.test("shouldAttemptSemanticSearch: false with undefined message", () => {
  assertEquals(shouldAttemptSemanticSearch([0.1], undefined), false);
});

Deno.test("shouldAttemptSemanticSearch: false with too-short message", () => {
  assertEquals(shouldAttemptSemanticSearch([0.1], "hi"), false);
});

Deno.test("shouldAttemptSemanticSearch: false with whitespace-only message", () => {
  assertEquals(shouldAttemptSemanticSearch([0.1], "   "), false);
});

// ═══════════════════════════════════════════════════════════════════
// 2. mergeMemoryResults
// ═══════════════════════════════════════════════════════════════════

Deno.test("mergeMemoryResults: semantic first, importance fills gaps", () => {
  const semantic = [makeChunk({ id: "s1", similarity: 0.95 }), makeChunk({ id: "s2", similarity: 0.9 })];
  const importance = [makeChunk({ id: "i1" }), makeChunk({ id: "i2" })];

  const merged = mergeMemoryResults(semantic, importance, 3);
  assertEquals(merged.length, 3);
  assertEquals(merged[0].id, "s1");
  assertEquals(merged[1].id, "s2");
  assertEquals(merged[2].id, "i1");
});

Deno.test("mergeMemoryResults: deduplicates by ID", () => {
  const semantic = [makeChunk({ id: "shared" })];
  const importance = [makeChunk({ id: "shared" }), makeChunk({ id: "only-imp" })];

  const merged = mergeMemoryResults(semantic, importance, 10);
  assertEquals(merged.length, 2);
  assertEquals(merged[0].id, "shared");
  assertEquals(merged[1].id, "only-imp");
});

Deno.test("mergeMemoryResults: respects maxTotal limit", () => {
  const semantic = [makeChunk({ id: "s1" }), makeChunk({ id: "s2" }), makeChunk({ id: "s3" })];
  const importance = [makeChunk({ id: "i1" })];

  const merged = mergeMemoryResults(semantic, importance, 2);
  assertEquals(merged.length, 2);
});

Deno.test("mergeMemoryResults: empty semantic → importance-only", () => {
  const importance = [makeChunk({ id: "i1" }), makeChunk({ id: "i2" })];
  const merged = mergeMemoryResults([], importance, 10);
  assertEquals(merged.length, 2);
  assertEquals(merged[0].id, "i1");
});

Deno.test("mergeMemoryResults: both empty → empty", () => {
  assertEquals(mergeMemoryResults([], [], 10).length, 0);
});

Deno.test("mergeMemoryResults: maxTotal=0 → empty", () => {
  const semantic = [makeChunk({ id: "s1" })];
  assertEquals(mergeMemoryResults(semantic, [], 0).length, 0);
});

// ═══════════════════════════════════════════════════════════════════
// 3. formatMemoryChunksForPrompt
// ═══════════════════════════════════════════════════════════════════

Deno.test("formatMemoryChunksForPrompt: empty chunks → empty string", () => {
  assertEquals(formatMemoryChunksForPrompt([]), "");
});

Deno.test("formatMemoryChunksForPrompt: includes header", () => {
  const chunks = [makeChunk({ id: "c1", content: "User likes pizza" })];
  const result = formatMemoryChunksForPrompt(chunks);
  assertStringIncludes(result, "RELEVANT LEARNED FACTS");
  assertStringIncludes(result, "User likes pizza");
});

Deno.test("formatMemoryChunksForPrompt: shows importance for high-importance chunks", () => {
  const chunks = [makeChunk({ id: "c1", importance: 5, content: "Important fact" })];
  const result = formatMemoryChunksForPrompt(chunks);
  assertStringIncludes(result, "importance:5/5");
});

Deno.test("formatMemoryChunksForPrompt: omits importance meta for low-importance chunks", () => {
  const chunks = [makeChunk({ id: "c1", importance: 3, content: "Regular fact" })];
  const result = formatMemoryChunksForPrompt(chunks);
  assertEquals(result.includes("importance:3"), false);
});

Deno.test("formatMemoryChunksForPrompt: shows source", () => {
  const chunks = [makeChunk({ id: "c1", source: "process-note", content: "From a note" })];
  const result = formatMemoryChunksForPrompt(chunks);
  assertStringIncludes(result, "via:process-note");
});

Deno.test("formatMemoryChunksForPrompt: multiple chunks each on own line", () => {
  const chunks = [
    makeChunk({ id: "c1", content: "Fact A" }),
    makeChunk({ id: "c2", content: "Fact B" }),
  ];
  const result = formatMemoryChunksForPrompt(chunks);
  assertStringIncludes(result, "- Fact A");
  assertStringIncludes(result, "- Fact B");
});

// ═══════════════════════════════════════════════════════════════════
// 4. fetchMemoryChunks — orchestrator
// ═══════════════════════════════════════════════════════════════════

Deno.test("fetchMemoryChunks: semantic + importance → merged strategy", async () => {
  const db = makeMockDB({
    semanticChunks: [makeChunk({ id: "s1", similarity: 0.9 })],
    importanceChunks: [makeChunk({ id: "i1" }), makeChunk({ id: "i2" })],
  });

  const result = await fetchMemoryChunks(db, "user1", [0.1, 0.2], "hello world");
  assertEquals(result.strategy, "merged");
  assertEquals(result.totalCount, 3);
  assertEquals(result.semanticCount, 1);
  assertEquals(result.importanceCount, 2);
  assertStringIncludes(result.promptBlock, "RELEVANT LEARNED FACTS");
});

Deno.test("fetchMemoryChunks: no embedding → importance_only strategy", async () => {
  const db = makeMockDB({
    importanceChunks: [makeChunk({ id: "i1" }), makeChunk({ id: "i2" })],
  });

  const result = await fetchMemoryChunks(db, "user1", null, "hello");
  assertEquals(result.strategy, "importance_only");
  assertEquals(result.totalCount, 2);
  assertEquals(result.semanticCount, 0);
});

Deno.test("fetchMemoryChunks: short message → importance_only (no semantic attempt)", async () => {
  let semanticCalled = false;
  const db: MemoryDB = {
    async searchMemoryChunks() { semanticCalled = true; return []; },
    async fetchTopMemoryChunks() { return [makeChunk({ id: "i1" })]; },
  };

  const result = await fetchMemoryChunks(db, "user1", [0.1], "hi");
  assertEquals(semanticCalled, false);
  assertEquals(result.strategy, "importance_only");
});

Deno.test("fetchMemoryChunks: semantic error → graceful fallback to importance", async () => {
  const db = makeMockDB({
    semanticError: new Error("RPC not found"),
    importanceChunks: [makeChunk({ id: "i1" })],
  });

  const result = await fetchMemoryChunks(db, "user1", [0.1, 0.2], "hello world");
  assertEquals(result.strategy, "importance_only");
  assertEquals(result.totalCount, 1);
});

Deno.test("fetchMemoryChunks: both fail → empty strategy, no throw", async () => {
  const db = makeMockDB({
    semanticError: new Error("DB down"),
    importanceError: new Error("DB down"),
  });

  const result = await fetchMemoryChunks(db, "user1", [0.1, 0.2], "hello world");
  assertEquals(result.strategy, "empty");
  assertEquals(result.totalCount, 0);
  assertEquals(result.promptBlock, "");
});

Deno.test("fetchMemoryChunks: semantic returns all results → pure semantic strategy", async () => {
  const db = makeMockDB({
    semanticChunks: [makeChunk({ id: "s1" }), makeChunk({ id: "s2" })],
    importanceChunks: [makeChunk({ id: "s1" }), makeChunk({ id: "s2" })], // same IDs
  });

  const result = await fetchMemoryChunks(db, "user1", [0.1], "hello world");
  assertEquals(result.strategy, "semantic");
  assertEquals(result.totalCount, 2);
});

Deno.test("fetchMemoryChunks: empty DB → empty strategy", async () => {
  const db = makeMockDB({});
  const result = await fetchMemoryChunks(db, "user1", [0.1], "hello world");
  assertEquals(result.strategy, "empty");
  assertEquals(result.totalCount, 0);
  assertEquals(result.promptBlock, "");
});

Deno.test("fetchMemoryChunks: respects maxTotal config", async () => {
  const db = makeMockDB({
    semanticChunks: Array.from({ length: 10 }, (_, i) => makeChunk({ id: `s${i}` })),
    importanceChunks: Array.from({ length: 10 }, (_, i) => makeChunk({ id: `i${i}` })),
  });

  const config: MemoryRetrievalConfig = {
    ...DEFAULT_RETRIEVAL_CONFIG,
    maxTotal: 5,
  };

  const result = await fetchMemoryChunks(db, "user1", [0.1], "hello world", config);
  assertEquals(result.totalCount, 5);
});

Deno.test("fetchMemoryChunks: passes correct params to DB", async () => {
  let capturedSemanticArgs: any = null;
  let capturedImportanceArgs: any = null;

  const db: MemoryDB = {
    async searchMemoryChunks(userId, _embed, limit, minImportance) {
      capturedSemanticArgs = { userId, limit, minImportance };
      return [];
    },
    async fetchTopMemoryChunks(userId, limit, minImportance) {
      capturedImportanceArgs = { userId, limit, minImportance };
      return [];
    },
  };

  const config: MemoryRetrievalConfig = {
    semanticLimit: 12,
    importanceLimit: 8,
    minImportance: 4,
    semanticMinImportance: 3,
    maxTotal: 15,
  };

  await fetchMemoryChunks(db, "user42", [0.1], "hello world", config);

  assertEquals(capturedSemanticArgs?.userId, "user42");
  assertEquals(capturedSemanticArgs?.limit, 12);
  assertEquals(capturedSemanticArgs?.minImportance, 3);
  assertEquals(capturedImportanceArgs?.userId, "user42");
  assertEquals(capturedImportanceArgs?.limit, 8);
  assertEquals(capturedImportanceArgs?.minImportance, 4);
});

// ═══════════════════════════════════════════════════════════════════
// 5. backfillChunkEmbeddings
// ═══════════════════════════════════════════════════════════════════

function mockBackfillSupabase(chunks: Array<{ id: string; content: string }>, updateError = false) {
  const updates: Array<{ id: string; embedding: number[] }> = [];
  const rpcCalls: any[] = [];

  return {
    supabase: {
      rpc(name: string, params: any) {
        rpcCalls.push({ name, params });
        if (name === "get_chunks_needing_embeddings") {
          return { data: chunks, error: null };
        }
        return { data: [], error: null };
      },
      from(table: string) {
        return {
          update(data: any) {
            return {
              eq(col: string, val: string) {
                if (updateError) {
                  return { error: { message: "update failed" } };
                }
                updates.push({ id: val, embedding: data.embedding });
                return { error: null };
              },
            };
          },
        };
      },
    },
    updates,
    rpcCalls,
  };
}

Deno.test("backfillChunkEmbeddings: repairs chunks with null embeddings", async () => {
  const chunks = [
    { id: "c1", user_id: "u1", content: "User likes pizza" },
    { id: "c2", user_id: "u1", content: "User has a dog named Max" },
  ];
  const { supabase, updates } = mockBackfillSupabase(chunks);

  const embedFn: EmbeddingGenerator = async (_text) => [0.1, 0.2, 0.3];

  const result = await backfillChunkEmbeddings(supabase as any, embedFn, 10);
  assertEquals(result.repaired, 2);
  assertEquals(result.failed, 0);
  assertEquals(updates.length, 2);
  assertEquals(updates[0].id, "c1");
  assertEquals(updates[1].id, "c2");
});

Deno.test("backfillChunkEmbeddings: handles embedding generation failure", async () => {
  const chunks = [{ id: "c1", user_id: "u1", content: "test" }];
  const { supabase } = mockBackfillSupabase(chunks);

  const embedFn: EmbeddingGenerator = async (_text) => null;

  const result = await backfillChunkEmbeddings(supabase as any, embedFn, 10);
  assertEquals(result.repaired, 0);
  assertEquals(result.failed, 1);
});

Deno.test("backfillChunkEmbeddings: handles DB update failure", async () => {
  const chunks = [{ id: "c1", user_id: "u1", content: "test" }];
  const { supabase } = mockBackfillSupabase(chunks, true);

  const embedFn: EmbeddingGenerator = async (_text) => [0.1, 0.2];

  const result = await backfillChunkEmbeddings(supabase as any, embedFn, 10);
  assertEquals(result.repaired, 0);
  assertEquals(result.failed, 1);
});

Deno.test("backfillChunkEmbeddings: empty queue → zero repairs", async () => {
  const { supabase } = mockBackfillSupabase([]);

  const embedFn: EmbeddingGenerator = async (_text) => [0.1];

  const result = await backfillChunkEmbeddings(supabase as any, embedFn, 10);
  assertEquals(result.repaired, 0);
  assertEquals(result.failed, 0);
  assertEquals(result.remaining, 0);
});

Deno.test("backfillChunkEmbeddings: RPC error → graceful return", async () => {
  const supabase = {
    rpc(_name: string, _params: any) {
      return { data: null, error: { message: "function not found" } };
    },
  };

  const embedFn: EmbeddingGenerator = async (_text) => [0.1];

  const result = await backfillChunkEmbeddings(supabase as any, embedFn, 10);
  assertEquals(result.repaired, 0);
  assertEquals(result.failed, 0);
  assertEquals(result.remaining, -1);
});

// ═══════════════════════════════════════════════════════════════════
// 6. backfillNoteEmbeddings
// ═══════════════════════════════════════════════════════════════════

Deno.test("backfillNoteEmbeddings: repairs notes", async () => {
  const notes = [
    { id: "n1", user_id: "u1", content: "Buy groceries" },
  ];
  const updates: string[] = [];

  const supabase = {
    rpc(_name: string, _params: any) {
      return { data: notes, error: null };
    },
    from(_table: string) {
      return {
        update(data: any) {
          return {
            eq(_col: string, val: string) {
              updates.push(val);
              return { error: null };
            },
          };
        },
      };
    },
  };

  const embedFn: EmbeddingGenerator = async (_text) => [0.5, 0.6];

  const result = await backfillNoteEmbeddings(supabase as any, embedFn, 10);
  assertEquals(result.repaired, 1);
  assertEquals(result.failed, 0);
  assertEquals(updates.length, 1);
  assertEquals(updates[0], "n1");
});

Deno.test("backfillNoteEmbeddings: empty queue → zero repairs", async () => {
  const supabase = {
    rpc(_name: string, _params: any) {
      return { data: [], error: null };
    },
  };

  const embedFn: EmbeddingGenerator = async (_text) => [0.1];
  const result = await backfillNoteEmbeddings(supabase as any, embedFn, 10);
  assertEquals(result.repaired, 0);
  assertEquals(result.failed, 0);
});

Deno.test("backfillNoteEmbeddings: handles mixed success/failure", async () => {
  const notes = [
    { id: "n1", user_id: "u1", content: "Good note" },
    { id: "n2", user_id: "u1", content: "Bad note" },
  ];
  let callCount = 0;

  const supabase = {
    rpc(_name: string, _params: any) {
      return { data: notes, error: null };
    },
    from(_table: string) {
      return {
        update(_data: any) {
          return {
            eq(_col: string, _val: string) {
              callCount++;
              if (callCount === 2) return { error: { message: "fail" } };
              return { error: null };
            },
          };
        },
      };
    },
  };

  const embedFn: EmbeddingGenerator = async (_text) => [0.1];
  const result = await backfillNoteEmbeddings(supabase as any, embedFn, 10);
  assertEquals(result.repaired, 1);
  assertEquals(result.failed, 1);
});

// ═══════════════════════════════════════════════════════════════════
// 7. Integration-style: full pipeline scenario
// ═══════════════════════════════════════════════════════════════════

Deno.test("full pipeline: no embedding available → importance-only → chunks in prompt", async () => {
  const db = makeMockDB({
    importanceChunks: [
      makeChunk({ id: "c1", content: "Martha is celebrating her Doctorate", importance: 5 }),
      makeChunk({ id: "c2", content: "User likes Haitian food", importance: 4 }),
      makeChunk({ id: "c3", content: "Almu has pets named Milka and Cats", importance: 5 }),
    ],
  });

  // No embedding, no message → importance_only
  const result = await fetchMemoryChunks(db, "user1", null, null);

  assertEquals(result.strategy, "importance_only");
  assertEquals(result.totalCount, 3);
  assertStringIncludes(result.promptBlock, "Martha is celebrating her Doctorate");
  assertStringIncludes(result.promptBlock, "User likes Haitian food");
  assertStringIncludes(result.promptBlock, "Almu has pets");
});

Deno.test("full pipeline: with embedding → semantic augments importance", async () => {
  const db = makeMockDB({
    semanticChunks: [
      makeChunk({ id: "relevant", content: "User needs EIN from IRS", importance: 5, similarity: 0.92 }),
    ],
    importanceChunks: [
      makeChunk({ id: "general1", content: "Martha celebrating Doctorate", importance: 5 }),
      makeChunk({ id: "general2", content: "Haitian food for celebration", importance: 4 }),
    ],
  });

  const result = await fetchMemoryChunks(db, "user1", [0.1, 0.2, 0.3], "What about the EIN number?");

  assertEquals(result.strategy, "merged");
  assertEquals(result.totalCount, 3);
  // Semantic result should be first
  assertStringIncludes(result.promptBlock, "User needs EIN from IRS");
  assertStringIncludes(result.promptBlock, "Martha celebrating Doctorate");
});

Deno.test("full pipeline: semantic search broken → still get memories via importance", async () => {
  // Simulates the pre-fix state where search_memory_chunks didn't exist
  const db = makeMockDB({
    semanticError: new Error("function search_memory_chunks does not exist"),
    importanceChunks: [
      makeChunk({ id: "i1", content: "User has dog named Max", importance: 4 }),
    ],
  });

  const result = await fetchMemoryChunks(db, "user1", [0.1], "Tell me about Max");

  assertEquals(result.strategy, "importance_only");
  assertEquals(result.totalCount, 1);
  assertStringIncludes(result.promptBlock, "User has dog named Max");
});

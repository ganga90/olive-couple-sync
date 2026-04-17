/**
 * Deep tests for the Contradiction Resolver (Phase 2 Task 2-A).
 * Run with: deno test supabase/functions/_shared/contradiction-resolver.test.ts
 *
 * Coverage goals:
 *   1. `formatContradictionQuestion`: type-specific intros, trimming, A/B shape
 *   2. `buildResolverPrompt`: prompt shape, user-reply escaping
 *   3. `parseResolverJson`: direct JSON, fenced JSON, embedded JSON, rejects
 *   4. `shortcutResolve`: A/B shortcuts, rejection of ambiguous input
 *   5. `mapWinnerToResolution`: chronology mapping for keep_newer/keep_older
 *   6. `parseUserResolution`: LLM happy path + parse-fail + LLM-fail
 *   7. `formatResolutionConfirmation`: all 4 winner branches
 *   8. `handleContradictionResolveJob`: idempotency + dedupe + insert
 *   9. `applyResolution`: chunk deactivation on a/b, merge, neither
 *  10. `tryResolvePendingQuestion`: resolved vs not-classified
 *  11. `markPendingQuestionAnswered`: update call shape
 */

import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  formatContradictionQuestion,
  buildResolverPrompt,
  parseResolverJson,
  shortcutResolve,
  mapWinnerToResolution,
  parseUserResolution,
  formatResolutionConfirmation,
  handleContradictionResolveJob,
  applyResolution,
  tryResolvePendingQuestion,
  markPendingQuestionAnswered,
  type ContradictionPayload,
  type ResolverDecision,
  type PendingQuestionRow,
  type GeminiCaller,
} from "./contradiction-resolver.ts";

// ─── Fixtures ──────────────────────────────────────────────────────

const baseFactualPayload: ContradictionPayload = {
  contradiction_id: "ctx-1",
  chunk_a_id: "chunk-a",
  chunk_b_id: "chunk-b",
  chunk_a_content: "User lives in Brooklyn.",
  chunk_b_content: "User lives in Queens.",
  contradiction_type: "factual",
  confidence: 0.65,
};

function mkPayload(overrides: Partial<ContradictionPayload> = {}): ContradictionPayload {
  return { ...baseFactualPayload, ...overrides };
}

// ─── formatContradictionQuestion ──────────────────────────────────

Deno.test("formatContradictionQuestion: factual intro + A/B layout", () => {
  const q = formatContradictionQuestion(baseFactualPayload);
  assert(q.includes("Quick check"));
  assert(q.includes("A) User lives in Brooklyn."));
  assert(q.includes("B) User lives in Queens."));
  assert(q.includes("Reply with A, B"));
});

Deno.test("formatContradictionQuestion: preference intro differs", () => {
  const q = formatContradictionQuestion(
    mkPayload({ contradiction_type: "preference" })
  );
  assert(q.includes("Two different preferences"));
});

Deno.test("formatContradictionQuestion: temporal intro differs", () => {
  const q = formatContradictionQuestion(
    mkPayload({ contradiction_type: "temporal" })
  );
  assert(q.includes("dates that don't line up"));
});

Deno.test("formatContradictionQuestion: unknown type falls back gracefully", () => {
  const q = formatContradictionQuestion(
    mkPayload({ contradiction_type: "unknown-type" })
  );
  assert(q.includes("might be contradicting"));
});

Deno.test("formatContradictionQuestion: long chunk content gets trimmed with ellipsis", () => {
  const q = formatContradictionQuestion(
    mkPayload({
      chunk_a_content: "A".repeat(500),
      chunk_b_content: "B".repeat(500),
    })
  );
  assert(q.includes("…"));
  // Hard bound: both A and B lines should be under ~250 chars total
  const lines = q.split("\n");
  const aLine = lines.find((l) => l.startsWith("A) "))!;
  assert(aLine.length < 250, `A line too long: ${aLine.length}`);
});

Deno.test("formatContradictionQuestion: collapses whitespace", () => {
  const q = formatContradictionQuestion(
    mkPayload({ chunk_a_content: "multi\n\n  space  \t content" })
  );
  assert(q.includes("A) multi space content"));
});

// ─── buildResolverPrompt ──────────────────────────────────────────

Deno.test("buildResolverPrompt: includes both facts, user reply, JSON schema", () => {
  const prompt = buildResolverPrompt(baseFactualPayload, "it's A, I moved back");
  assert(prompt.includes("Fact A: User lives in Brooklyn."));
  assert(prompt.includes("Fact B: User lives in Queens."));
  assert(prompt.includes('User reply: "it\'s A, I moved back"'));
  assert(prompt.includes('"winner": "a" | "b" | "merge" | "neither"'));
  assert(prompt.includes("No markdown fences"));
});

// ─── parseResolverJson ────────────────────────────────────────────

Deno.test("parseResolverJson: direct valid JSON", () => {
  const r = parseResolverJson(
    '{"winner":"a","reasoning":"user said A"}'
  );
  assertExists(r);
  assertEquals(r!.winner, "a");
  assertEquals(r!.reasoning, "user said A");
});

Deno.test("parseResolverJson: fenced JSON", () => {
  const r = parseResolverJson("```json\n{\"winner\":\"b\"}\n```");
  assertExists(r);
  assertEquals(r!.winner, "b");
});

Deno.test("parseResolverJson: embedded JSON with prose around it", () => {
  const r = parseResolverJson(
    'Sure, the answer is: {"winner":"neither","reasoning":"off-topic"}. Done.'
  );
  assertExists(r);
  assertEquals(r!.winner, "neither");
});

Deno.test("parseResolverJson: merge without merge_text → rejected", () => {
  const r = parseResolverJson('{"winner":"merge"}');
  assertEquals(r, null);
});

Deno.test("parseResolverJson: merge with merge_text → accepted", () => {
  const r = parseResolverJson(
    '{"winner":"merge","merge_text":"User splits time between Brooklyn and Queens."}'
  );
  assertExists(r);
  assertEquals(r!.winner, "merge");
  assertEquals(
    r!.merge_text,
    "User splits time between Brooklyn and Queens."
  );
});

Deno.test("parseResolverJson: invalid winner value → null", () => {
  const r = parseResolverJson('{"winner":"yes"}');
  assertEquals(r, null);
});

Deno.test("parseResolverJson: missing winner field → null", () => {
  const r = parseResolverJson('{"reasoning":"user picked A"}');
  assertEquals(r, null);
});

Deno.test("parseResolverJson: garbage input → null", () => {
  assertEquals(parseResolverJson(""), null);
  assertEquals(parseResolverJson("hello"), null);
  assertEquals(parseResolverJson("null"), null);
});

Deno.test("parseResolverJson: case-insensitive winner", () => {
  const r = parseResolverJson('{"winner":"A"}');
  assertExists(r);
  assertEquals(r!.winner, "a");
});

// ─── shortcutResolve ──────────────────────────────────────────────

Deno.test("shortcutResolve: bare 'A' / 'a' / 'option a' → winner=a", () => {
  for (const t of ["A", "a", "option a", "Option A", "letter a", "it's a"]) {
    const r = shortcutResolve(t);
    assertExists(r, `should match: "${t}"`);
    assertEquals(r!.winner, "a");
  }
});

Deno.test("shortcutResolve: bare 'B' / 'b' → winner=b", () => {
  const r = shortcutResolve("B");
  assertExists(r);
  assertEquals(r!.winner, "b");
});

Deno.test("shortcutResolve: ambiguous replies → null", () => {
  for (const t of [
    "a, but actually b",
    "both",
    "merge them",
    "hmm not sure",
    "",
    "   ",
  ]) {
    const r = shortcutResolve(t);
    assertEquals(r, null, `should NOT match: "${t}"`);
  }
});

// ─── mapWinnerToResolution ────────────────────────────────────────

Deno.test("mapWinnerToResolution: chronology-aware", () => {
  // chunk_a is newer:
  assertEquals(mapWinnerToResolution("a", true), "keep_newer"); // A wins & A is newer
  assertEquals(mapWinnerToResolution("b", true), "keep_older"); // B wins & A is newer → B is older
  // chunk_a is older:
  assertEquals(mapWinnerToResolution("a", false), "keep_older"); // A wins & A is older
  assertEquals(mapWinnerToResolution("b", false), "keep_newer"); // B wins & A is older → B is newer
});

Deno.test("mapWinnerToResolution: merge and neither independent of chronology", () => {
  assertEquals(mapWinnerToResolution("merge", true), "merge");
  assertEquals(mapWinnerToResolution("merge", false), "merge");
  assertEquals(mapWinnerToResolution("neither", true), "unresolved");
  assertEquals(mapWinnerToResolution("neither", false), "unresolved");
});

// ─── parseUserResolution (LLM integration, mocked caller) ─────────

Deno.test("parseUserResolution: shortcut bypasses LLM", async () => {
  let called = false;
  const caller: GeminiCaller = async () => {
    called = true;
    return "";
  };
  const r = await parseUserResolution(baseFactualPayload, "A", undefined, caller);
  assertEquals(called, false);
  assertExists(r);
  assertEquals(r!.winner, "a");
  assertEquals(r!.model, "shortcut");
});

Deno.test("parseUserResolution: LLM happy path", async () => {
  const caller: GeminiCaller = async () =>
    '{"winner":"b","reasoning":"user said they moved to Queens last month"}';
  const r = await parseUserResolution(
    baseFactualPayload,
    "I moved last month to Queens actually",
    undefined,
    caller
  );
  assertExists(r);
  assertEquals(r!.winner, "b");
  assert(r!.reasoning?.includes("Queens"));
});

Deno.test("parseUserResolution: LLM returns unparseable → null", async () => {
  const caller: GeminiCaller = async () => "I cannot determine the answer from this reply.";
  const r = await parseUserResolution(
    baseFactualPayload,
    "something off-topic",
    undefined,
    caller
  );
  assertEquals(r, null);
});

Deno.test("parseUserResolution: LLM throws → null (fail-open)", async () => {
  const caller: GeminiCaller = async () => {
    throw new Error("Gemini 429");
  };
  const r = await parseUserResolution(
    baseFactualPayload,
    "a bit ambiguous",
    undefined,
    caller
  );
  assertEquals(r, null);
});

// ─── formatResolutionConfirmation ─────────────────────────────────

Deno.test("formatResolutionConfirmation: all 4 branches", () => {
  const a = formatResolutionConfirmation({ winner: "a" }, baseFactualPayload);
  assert(a.includes("Brooklyn"));
  assert(a.includes("drop the other"));

  const b = formatResolutionConfirmation({ winner: "b" }, baseFactualPayload);
  assert(b.includes("Queens"));

  const m = formatResolutionConfirmation(
    { winner: "merge", merge_text: "Splits time between both." },
    baseFactualPayload
  );
  assert(m.includes("Splits time between both."));

  const n = formatResolutionConfirmation(
    { winner: "neither" },
    baseFactualPayload
  );
  assert(n.includes("leave both as-is"));
});

// ─── Mock Supabase helpers ────────────────────────────────────────

/**
 * Build a chainable fake supabase tailored per-test. Records .from('table')
 * + .select/.insert/.update/.eq/.maybeSingle calls so tests can assert
 * which tables were touched.
 */
function buildMockSupabase(handlers: {
  selectSingle?: (table: string, filters: Record<string, unknown>) => any;
  insertReturn?: (table: string, row: any) => any;
  update?: (table: string, row: any, filters: Record<string, unknown>) => void;
}) {
  const calls: Array<{ table: string; op: string; args: any }> = [];
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let op = "";
    let opPayload: any = null;
    const chain: any = {
      select: (_cols?: string) => {
        op = op || "select";
        return chain;
      },
      insert: (row: any) => {
        op = "insert";
        opPayload = row;
        calls.push({ table, op, args: row });
        return chain;
      },
      update: (row: any) => {
        op = "update";
        opPayload = row;
        return chain;
      },
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      },
      gt: (_col: string, _val: unknown) => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        calls.push({ table, op: "selectSingle", args: filters });
        const data = handlers.selectSingle?.(table, filters) ?? null;
        return { data, error: null };
      },
      single: async () => {
        calls.push({ table, op: "insertSingle", args: opPayload });
        const data = handlers.insertReturn?.(table, opPayload) ?? null;
        return { data, error: null };
      },
      then: (resolve: any) => {
        // For .update(...).eq(...) without .select()/.single(), the chain
        // resolves as a plain thenable. Record the op.
        if (op === "update") {
          calls.push({ table, op, args: { row: opPayload, filters } });
          handlers.update?.(table, opPayload, filters);
        }
        return resolve({ data: null, error: null });
      },
    };
    return chain;
  };
  return {
    calls,
    from,
    rpc: (_fn: string, _args: any) => Promise.resolve({ data: null, error: null }),
  };
}

// ─── handleContradictionResolveJob ────────────────────────────────

Deno.test("handleContradictionResolveJob: already-resolved contradiction → null", async () => {
  const sb = buildMockSupabase({
    selectSingle: (table) => {
      if (table === "olive_memory_contradictions") {
        return { id: "ctx-1", resolved_at: "2026-04-01T00:00:00Z", resolution: "keep_newer" };
      }
      return null;
    },
  });
  const r = await handleContradictionResolveJob(sb as any, "user-abc", baseFactualPayload);
  assertEquals(r, null);
});

Deno.test("handleContradictionResolveJob: dedupe — reuses existing pending question", async () => {
  const sb = buildMockSupabase({
    selectSingle: (table) => {
      if (table === "olive_memory_contradictions") return { id: "ctx-1", resolved_at: null };
      if (table === "olive_pending_questions") {
        return {
          id: "pq-existing",
          question_text: "reused question",
          asked_at: "2026-04-16T00:00:00Z",
        };
      }
      return null;
    },
  });
  const r = await handleContradictionResolveJob(sb as any, "user-abc", baseFactualPayload);
  assertExists(r);
  assertEquals(r!.pendingQuestionId, "pq-existing");
  assertEquals(r!.questionText, "reused question");
  // Should NOT have inserted a new row
  assertEquals(
    sb.calls.filter((c) => c.op === "insert" && c.table === "olive_pending_questions").length,
    0
  );
});

Deno.test("handleContradictionResolveJob: happy path — inserts pending question", async () => {
  let insertedRow: any = null;
  const sb = buildMockSupabase({
    selectSingle: (table) => {
      if (table === "olive_memory_contradictions") return { id: "ctx-1", resolved_at: null };
      return null; // no dupe
    },
    insertReturn: (table, row) => {
      if (table === "olive_pending_questions") {
        insertedRow = row;
        return { id: "pq-new" };
      }
      return null;
    },
  });
  const r = await handleContradictionResolveJob(sb as any, "user-abc", baseFactualPayload);
  assertExists(r);
  assertEquals(r!.pendingQuestionId, "pq-new");
  assert(r!.questionText.includes("A) User lives in Brooklyn."));
  // Inserted row shape
  assertExists(insertedRow);
  assertEquals(insertedRow.user_id, "user-abc");
  assertEquals(insertedRow.question_type, "contradiction_resolve");
  assertEquals(insertedRow.reference_id, "ctx-1");
  assertEquals(insertedRow.channel, "whatsapp");
  assertEquals(insertedRow.payload, baseFactualPayload);
});

// ─── applyResolution ──────────────────────────────────────────────

/**
 * Richer mock for applyResolution — it chains through several tables.
 * This version tracks update payloads per table.
 */
function buildApplyMock(options: {
  contradiction: any;
  chunkA: any;
  chunkB: any;
}) {
  const updates: Array<{ table: string; payload: any; filters: any }> = [];
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let op = "";
    let opPayload: any = null;
    const chain: any = {
      select: () => chain,
      update: (row: any) => {
        op = "update";
        opPayload = row;
        return chain;
      },
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      },
      maybeSingle: async () => {
        if (table === "olive_memory_contradictions") {
          return { data: options.contradiction, error: null };
        }
        if (table === "olive_memory_chunks") {
          if (filters.id === options.chunkA.id) return { data: options.chunkA, error: null };
          if (filters.id === options.chunkB.id) return { data: options.chunkB, error: null };
        }
        return { data: null, error: null };
      },
      then: (resolve: any) => {
        if (op === "update") {
          updates.push({ table, payload: opPayload, filters: { ...filters } });
        }
        return resolve({ data: null, error: null });
      },
    };
    return chain;
  };
  return { updates, from, rpc: () => Promise.resolve({ data: null, error: null }) };
}

const contradictionRow = {
  id: "ctx-1",
  chunk_a_id: "chunk-a",
  chunk_b_id: "chunk-b",
  resolved_at: null,
};
const chunkA = {
  id: "chunk-a",
  content: "User lives in Brooklyn.",
  created_at: "2026-04-15T00:00:00Z", // older
  is_active: true,
};
const chunkB = {
  id: "chunk-b",
  content: "User lives in Queens.",
  created_at: "2026-04-16T00:00:00Z", // newer
  is_active: true,
};

Deno.test("applyResolution: winner=a (older) → keep_older + deactivate chunk_b", async () => {
  const sb = buildApplyMock({ contradiction: contradictionRow, chunkA, chunkB });
  const r = await applyResolution(
    sb as any,
    "ctx-1",
    { winner: "a", reasoning: "user said A" },
    "I meant A"
  );
  assertEquals(r.applied, true);

  const chunkBDeact = sb.updates.find(
    (u) => u.table === "olive_memory_chunks" && u.filters.id === "chunk-b"
  );
  assertExists(chunkBDeact);
  assertEquals(chunkBDeact!.payload.is_active, false);

  const contraUpdate = sb.updates.find((u) => u.table === "olive_memory_contradictions");
  assertExists(contraUpdate);
  assertEquals(contraUpdate!.payload.resolution, "keep_older");
  assertEquals(contraUpdate!.payload.resolution_strategy, "MANUAL");
  assertEquals(contraUpdate!.payload.winning_chunk_id, "chunk-a");
  assert(contraUpdate!.payload.resolved_at);
  assert(contraUpdate!.payload.resolution_notes?.includes("winner=a"));
});

Deno.test("applyResolution: winner=b (newer) → keep_newer + deactivate chunk_a", async () => {
  const sb = buildApplyMock({ contradiction: contradictionRow, chunkA, chunkB });
  const r = await applyResolution(
    sb as any,
    "ctx-1",
    { winner: "b" },
    "B"
  );
  assertEquals(r.applied, true);

  const chunkADeact = sb.updates.find(
    (u) => u.table === "olive_memory_chunks" && u.filters.id === "chunk-a"
  );
  assertExists(chunkADeact);
  assertEquals(chunkADeact!.payload.is_active, false);

  const contraUpdate = sb.updates.find((u) => u.table === "olive_memory_contradictions");
  assertEquals(contraUpdate!.payload.resolution, "keep_newer");
  assertEquals(contraUpdate!.payload.winning_chunk_id, "chunk-b");
});

Deno.test("applyResolution: winner=merge → no chunk deactivation, resolved_content set", async () => {
  const sb = buildApplyMock({ contradiction: contradictionRow, chunkA, chunkB });
  const r = await applyResolution(
    sb as any,
    "ctx-1",
    { winner: "merge", merge_text: "Both are partially true." },
    "actually both"
  );
  assertEquals(r.applied, true);

  const deactivations = sb.updates.filter(
    (u) => u.table === "olive_memory_chunks"
  );
  assertEquals(deactivations.length, 0); // merge leaves both active

  const contraUpdate = sb.updates.find((u) => u.table === "olive_memory_contradictions");
  assertEquals(contraUpdate!.payload.resolution, "merge");
  assertEquals(contraUpdate!.payload.resolved_content, "Both are partially true.");
  assertEquals(contraUpdate!.payload.winning_chunk_id, null);
});

Deno.test("applyResolution: winner=neither → no deactivation, resolution='unresolved'", async () => {
  const sb = buildApplyMock({ contradiction: contradictionRow, chunkA, chunkB });
  const r = await applyResolution(sb as any, "ctx-1", { winner: "neither" }, "idk");
  assertEquals(r.applied, true);

  const deactivations = sb.updates.filter(
    (u) => u.table === "olive_memory_chunks"
  );
  assertEquals(deactivations.length, 0);

  const contraUpdate = sb.updates.find((u) => u.table === "olive_memory_contradictions");
  assertEquals(contraUpdate!.payload.resolution, "unresolved");
  assertEquals(contraUpdate!.payload.winning_chunk_id, null);
});

Deno.test("applyResolution: idempotent — resolved_at set → returns reason=already_resolved", async () => {
  const sb = buildApplyMock({
    contradiction: { ...contradictionRow, resolved_at: "2026-04-10T00:00:00Z" },
    chunkA,
    chunkB,
  });
  const r = await applyResolution(sb as any, "ctx-1", { winner: "a" }, "A");
  assertEquals(r.applied, false);
  assertEquals(r.reason, "already_resolved");
  // No updates should have been issued
  assertEquals(sb.updates.length, 0);
});

Deno.test("applyResolution: missing contradiction row → reason=contradiction_not_found", async () => {
  const sb = buildApplyMock({ contradiction: null, chunkA, chunkB });
  const r = await applyResolution(sb as any, "ctx-missing", { winner: "a" }, "A");
  assertEquals(r.applied, false);
  assertEquals(r.reason, "contradiction_not_found");
});

// ─── tryResolvePendingQuestion ────────────────────────────────────

function mkPending(overrides: Partial<PendingQuestionRow> = {}): PendingQuestionRow {
  return {
    id: "pq-1",
    user_id: "user-abc",
    question_type: "contradiction_resolve",
    reference_id: "ctx-1",
    channel: "whatsapp",
    question_text: "A or B?",
    payload: baseFactualPayload,
    asked_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400_000).toISOString(),
    answered_at: null,
    answer_text: null,
    resolution: null,
    status: "pending",
    ...overrides,
  };
}

Deno.test("tryResolvePendingQuestion: unparseable reply → resolved=false", async () => {
  const sb = buildApplyMock({ contradiction: contradictionRow, chunkA, chunkB });
  const caller: GeminiCaller = async () => "no valid json here";
  const r = await tryResolvePendingQuestion(
    sb as any,
    mkPending(),
    "something off-topic",
    caller
  );
  assertEquals(r.resolved, false);
  assert("reason" in r && r.reason === "could_not_classify_reply");
});

Deno.test("tryResolvePendingQuestion: malformed payload → resolved=false", async () => {
  const sb = buildApplyMock({ contradiction: contradictionRow, chunkA, chunkB });
  const bad = mkPending({ payload: {} as any });
  const caller: GeminiCaller = async () => "never called";
  const r = await tryResolvePendingQuestion(sb as any, bad, "A", caller);
  assertEquals(r.resolved, false);
  assert("reason" in r && r.reason === "malformed_payload");
});

Deno.test("tryResolvePendingQuestion: shortcut reply → resolved + applied", async () => {
  const sb = buildApplyMock({ contradiction: contradictionRow, chunkA, chunkB });
  // Shortcut "A" should bypass LLM entirely
  const caller: GeminiCaller = async () => {
    throw new Error("LLM should not be called for shortcut");
  };
  const r = await tryResolvePendingQuestion(sb as any, mkPending(), "A", caller);
  assert(r.resolved);
  if (r.resolved) {
    assertEquals(r.decision.winner, "a");
    assertEquals(r.applied, true);
  }
});

Deno.test("tryResolvePendingQuestion: LLM-classified reply → resolved + applied", async () => {
  const sb = buildApplyMock({ contradiction: contradictionRow, chunkA, chunkB });
  const caller: GeminiCaller = async () =>
    '{"winner":"b","reasoning":"user said they moved"}';
  const r = await tryResolvePendingQuestion(
    sb as any,
    mkPending(),
    "Yeah, actually I moved to Queens recently",
    caller
  );
  assert(r.resolved);
  if (r.resolved) {
    assertEquals(r.decision.winner, "b");
    assertEquals(r.applied, true);
  }
});

// ─── markPendingQuestionAnswered ──────────────────────────────────

Deno.test("markPendingQuestionAnswered: updates status + answer + resolution", async () => {
  let captured: any = null;
  const sb = {
    from: (_table: string) => {
      const chain: any = {
        update: (row: any) => {
          captured = row;
          return chain;
        },
        eq: () => chain,
        then: (resolve: any) => resolve({ data: null, error: null }),
      };
      return chain;
    },
  };
  await markPendingQuestionAnswered(
    sb as any,
    "pq-1",
    "it's A",
    { winner: "a", reasoning: "shortcut" }
  );
  assertExists(captured);
  assertEquals(captured.status, "answered");
  assertEquals(captured.answer_text, "it's A");
  assertEquals(captured.resolution.winner, "a");
  assert(captured.answered_at);
});

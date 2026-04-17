/**
 * Deep tests for the Thread Compactor (Phase 2 Task 2-B).
 * Run with: deno test supabase/functions/_shared/thread-compactor.test.ts
 *
 * Coverage goals:
 *   1. `shouldCompact`: all gating conditions (threshold, history length)
 *   2. `selectMessagesToCompact`: cursor filter × keep-recent filter × edge cases
 *   3. `renderTurns` + `buildSummarizationPrompt`: output shape + recondense hint
 *   4. `formatHistoryWithSummary`: both-present, only-history, only-summary, empty
 *   5. `generateCombinedSummary`: caller dep-injection, length clamp, too-short reject
 *   6. `performCompaction`: full orchestrator with a fake supabase + LLM
 */

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  shouldCompact,
  selectMessagesToCompact,
  renderTurns,
  buildSummarizationPrompt,
  formatHistoryWithSummary,
  generateCombinedSummary,
  performCompaction,
  DEFAULT_COMPACTION_CONFIG,
  type ConversationTurn,
  type GatewaySessionSnapshot,
  type UserSessionSnapshot,
  type CompactionConfig,
  type GeminiCaller,
} from "./thread-compactor.ts";

// ─── Fixtures ──────────────────────────────────────────────────────

const baseSession: GatewaySessionSnapshot = {
  id: "sess-1",
  user_id: "user-abc",
  channel: "whatsapp",
  message_count: 20,
  compact_summary: null,
  last_compacted_at: null,
};

function mkTurn(
  role: "user" | "assistant",
  content: string,
  minutesAgo: number
): ConversationTurn {
  return {
    role,
    content,
    timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

function seedHistory(n: number): ConversationTurn[] {
  // n alternating turns, oldest first (turn 0 is oldest).
  const out: ConversationTurn[] = [];
  for (let i = 0; i < n; i++) {
    out.push(
      mkTurn(
        i % 2 === 0 ? "user" : "assistant",
        `message ${i}`,
        (n - i) * 10 // oldest at n*10 min ago, newest at 10 min ago
      )
    );
  }
  return out;
}

// ─── shouldCompact ────────────────────────────────────────────────

Deno.test("shouldCompact: below threshold → should=false", () => {
  const r = shouldCompact({ ...baseSession, message_count: 14 }, seedHistory(20));
  assertEquals(r.should, false);
  assert(r.reason.startsWith("below_threshold"));
});

Deno.test("shouldCompact: at threshold → should=true", () => {
  const r = shouldCompact({ ...baseSession, message_count: 15 }, seedHistory(20));
  assertEquals(r.should, true);
});

Deno.test("shouldCompact: history ≤ keepRecentTurns → should=false", () => {
  const r = shouldCompact(
    { ...baseSession, message_count: 50 },
    seedHistory(DEFAULT_COMPACTION_CONFIG.keepRecentTurns)
  );
  assertEquals(r.should, false);
  assert(r.reason.startsWith("history_too_short"));
});

Deno.test("shouldCompact: empty history → should=false", () => {
  const r = shouldCompact({ ...baseSession, message_count: 50 }, []);
  assertEquals(r.should, false);
});

// ─── selectMessagesToCompact ──────────────────────────────────────

Deno.test("selectMessagesToCompact: first compaction picks everything except recent", () => {
  const cfg = { ...DEFAULT_COMPACTION_CONFIG, keepRecentTurns: 6 };
  const hist = seedHistory(20);
  const { toCompact, newCursor } = selectMessagesToCompact(
    hist,
    null,
    cfg,
    new Date().toISOString()
  );
  // 20 - 6 = 14 compacted
  assertEquals(toCompact.length, 14);
  // Cursor must advance — it should be the timestamp of the LAST compacted turn
  // (index 13), which is older than the 14th turn (the first kept).
  assertEquals(newCursor, hist[13].timestamp);
  // Kept turns must NOT appear in toCompact
  for (const kept of hist.slice(14)) {
    assert(!toCompact.includes(kept), "kept turn leaked into toCompact");
  }
});

Deno.test("selectMessagesToCompact: cursor skips already-compacted turns", () => {
  const cfg = { ...DEFAULT_COMPACTION_CONFIG, keepRecentTurns: 6 };
  const hist = seedHistory(20);
  // Pretend we already compacted through index 8 (i.e. cursor = hist[8].timestamp)
  const cursor = hist[8].timestamp!;
  const { toCompact } = selectMessagesToCompact(hist, cursor, cfg, new Date().toISOString());

  // Eligible: older-than-recent (indices 0..13), newer-than-cursor (indices 9..).
  // Intersection: 9..13 → 5 turns.
  assertEquals(toCompact.length, 5);
  assertEquals(toCompact[0].content, "message 9");
  assertEquals(toCompact[toCompact.length - 1].content, "message 13");
});

Deno.test("selectMessagesToCompact: everything already compacted → empty slice", () => {
  const cfg = { ...DEFAULT_COMPACTION_CONFIG, keepRecentTurns: 6 };
  const hist = seedHistory(20);
  // Cursor at the last compactable turn — nothing newer than cursor AND older than recent
  const cursor = hist[13].timestamp!;
  const { toCompact } = selectMessagesToCompact(hist, cursor, cfg, new Date().toISOString());
  assertEquals(toCompact.length, 0);
});

Deno.test("selectMessagesToCompact: missing timestamps fall back to 'compact me'", () => {
  const cfg = { ...DEFAULT_COMPACTION_CONFIG, keepRecentTurns: 2 };
  const nowIso = new Date().toISOString();
  const history: ConversationTurn[] = [
    { role: "user", content: "no-ts-1" }, // missing timestamp
    { role: "assistant", content: "no-ts-2" },
    { role: "user", content: "recent-1", timestamp: new Date().toISOString() },
    { role: "assistant", content: "recent-2", timestamp: new Date().toISOString() },
  ];
  const { toCompact, newCursor } = selectMessagesToCompact(history, null, cfg, nowIso);
  assertEquals(toCompact.length, 2);
  assertEquals(toCompact.map((t) => t.content), ["no-ts-1", "no-ts-2"]);
  // No timestamps on compacted turns → cursor should fall back to nowIso.
  assertEquals(newCursor, nowIso);
});

Deno.test("selectMessagesToCompact: malformed cursor treated as 'compact everything eligible'", () => {
  const cfg = { ...DEFAULT_COMPACTION_CONFIG, keepRecentTurns: 4 };
  const hist = seedHistory(10);
  const { toCompact } = selectMessagesToCompact(hist, "not-a-date", cfg, new Date().toISOString());
  assertEquals(toCompact.length, 6); // 10 - 4 kept recent
});

// ─── renderTurns + buildSummarizationPrompt ───────────────────────

Deno.test("renderTurns: user/assistant role mapping and trimming", () => {
  const turns: ConversationTurn[] = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hey" },
    { role: "user", content: "x".repeat(2000) }, // should clip at 800
  ];
  const out = renderTurns(turns);
  assert(out.startsWith("User: hi\nOlive: hey\nUser: "));
  const lastLine = out.split("\n")[2];
  assert(lastLine.length <= "User: ".length + 800, `clipped line too long: ${lastLine.length}`);
});

Deno.test("buildSummarizationPrompt: first-time compaction signals no prior summary", () => {
  const prompt = buildSummarizationPrompt(null, seedHistory(3), false);
  assert(prompt.includes("(none — this is the first compaction)"));
  assert(prompt.includes("NEW TURNS TO FOLD IN"));
  assert(!prompt.includes("re-condense aggressively"));
});

Deno.test("buildSummarizationPrompt: recondense hint flips the target length rule", () => {
  const prompt = buildSummarizationPrompt(
    "existing summary here ".repeat(100),
    seedHistory(3),
    true
  );
  assert(prompt.includes("re-condense aggressively"));
  assert(prompt.includes("PRIOR SUMMARY (fold the new turns INTO this"));
});

// ─── formatHistoryWithSummary ─────────────────────────────────────

Deno.test("formatHistoryWithSummary: only recent, no summary", () => {
  const out = formatHistoryWithSummary(null, seedHistory(3));
  assert(out.startsWith("Recent turns:"));
  assert(!out.includes("Earlier in this thread"));
});

Deno.test("formatHistoryWithSummary: both present, summary first", () => {
  const out = formatHistoryWithSummary("User discussed X and Y", seedHistory(2));
  assert(out.startsWith("Earlier in this thread (compacted summary):"));
  assert(out.includes("User discussed X and Y"));
  assert(out.includes("Recent turns:"));
  assert(out.indexOf("Earlier") < out.indexOf("Recent turns:"));
});

Deno.test("formatHistoryWithSummary: empty summary string treated as none", () => {
  const out = formatHistoryWithSummary("   ", seedHistory(1));
  assert(!out.includes("Earlier in this thread"));
});

Deno.test("formatHistoryWithSummary: no recent turns, only summary", () => {
  const out = formatHistoryWithSummary("Summary only", []);
  assert(out.includes("Summary only"));
  assert(out.includes("Recent turns: (none)"));
});

// ─── generateCombinedSummary ──────────────────────────────────────

Deno.test("generateCombinedSummary: happy path returns trimmed LLM text", async () => {
  const caller: GeminiCaller = async () => "  A combined summary of the conversation.  ";
  const out = await generateCombinedSummary(
    null,
    seedHistory(3),
    DEFAULT_COMPACTION_CONFIG,
    caller
  );
  assertEquals(out, "A combined summary of the conversation.");
});

Deno.test("generateCombinedSummary: too-short output throws (treated as failure)", async () => {
  const caller: GeminiCaller = async () => "nope";
  await assertRejects(
    () =>
      generateCombinedSummary(null, seedHistory(3), DEFAULT_COMPACTION_CONFIG, caller),
    Error,
    "summarizer_returned_too_short"
  );
});

Deno.test("generateCombinedSummary: clamps to maxSummaryChars", async () => {
  const cfg: CompactionConfig = { ...DEFAULT_COMPACTION_CONFIG, maxSummaryChars: 100 };
  const caller: GeminiCaller = async () => "A".repeat(500);
  const out = await generateCombinedSummary(null, seedHistory(3), cfg, caller);
  assertEquals(out.length, 100);
});

Deno.test("generateCombinedSummary: triggers recondense when existing summary is big", async () => {
  const cfg: CompactionConfig = { ...DEFAULT_COMPACTION_CONFIG, maxSummaryChars: 100 };
  let capturedPrompt = "";
  const caller: GeminiCaller = async (p) => {
    capturedPrompt = p;
    return "A valid summary that is long enough to pass the min-length check.";
  };
  const big = "x".repeat(95); // > 75% of 100
  await generateCombinedSummary(big, seedHistory(3), cfg, caller);
  assert(capturedPrompt.includes("re-condense aggressively"));
});

// ─── performCompaction (orchestrator w/ mocks) ────────────────────

/** Minimal fake supabase: records RPC calls and returns success. */
function mockSupabase() {
  const rpcCalls: Array<{ fn: string; args: any }> = [];
  return {
    rpcCalls,
    rpc: (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

Deno.test("performCompaction: short-circuits when below threshold", async () => {
  const sb = mockSupabase();
  const session = { ...baseSession, message_count: 5 };
  const userSession: UserSessionSnapshot = {
    user_id: "user-abc",
    context_data: { conversation_history: seedHistory(20) },
  };
  const result = await performCompaction(
    sb as any,
    session,
    userSession,
    DEFAULT_COMPACTION_CONFIG,
    async () => "never called"
  );
  assertEquals(result.compacted, false);
  assert(result.reason?.startsWith("below_threshold"));
  assertEquals(sb.rpcCalls.length, 0);
});

Deno.test("performCompaction: skips when not enough NEW turns to compact", async () => {
  const sb = mockSupabase();
  const hist = seedHistory(10);
  const cursor = hist[6].timestamp!; // only 7,8,9 would be newer-than-cursor, but 8,9 are in keep-recent
  const session = {
    ...baseSession,
    message_count: 50,
    last_compacted_at: cursor,
  };
  const cfg: CompactionConfig = {
    ...DEFAULT_COMPACTION_CONFIG,
    keepRecentTurns: 3,
    minTurnsToCompact: 5,
  };
  const userSession: UserSessionSnapshot = {
    user_id: "user-abc",
    context_data: { conversation_history: hist },
  };
  const result = await performCompaction(
    sb as any,
    session,
    userSession,
    cfg,
    async () => "never called"
  );
  assertEquals(result.compacted, false);
  assert(result.reason?.startsWith("below_min_turns"));
  assertEquals(sb.rpcCalls.length, 0);
});

Deno.test("performCompaction: happy path — writes summary via RPC and returns metadata", async () => {
  const sb = mockSupabase();
  const session = { ...baseSession, message_count: 20 };
  const userSession: UserSessionSnapshot = {
    user_id: "user-abc",
    context_data: { conversation_history: seedHistory(20) },
  };
  const summary = "A dense, faithful summary of the user's discussion.";
  const result = await performCompaction(
    sb as any,
    session,
    userSession,
    DEFAULT_COMPACTION_CONFIG,
    async () => summary
  );

  assertEquals(result.compacted, true);
  assertEquals(result.compactedCount, 14); // 20 - 6 keep-recent
  assertEquals(result.summaryChars, summary.length);

  assertEquals(sb.rpcCalls.length, 1);
  assertEquals(sb.rpcCalls[0].fn, "apply_gateway_session_compaction");
  assertEquals(sb.rpcCalls[0].args.p_session_id, "sess-1");
  assertEquals(sb.rpcCalls[0].args.p_compact_summary, summary);
  assertEquals(sb.rpcCalls[0].args.p_compacted_count, 14);
});

Deno.test("performCompaction: summarizer failure → no RPC, reason='summarizer_failed'", async () => {
  const sb = mockSupabase();
  const session = { ...baseSession, message_count: 20 };
  const userSession: UserSessionSnapshot = {
    user_id: "user-abc",
    context_data: { conversation_history: seedHistory(20) },
  };
  const result = await performCompaction(
    sb as any,
    session,
    userSession,
    DEFAULT_COMPACTION_CONFIG,
    async () => {
      throw new Error("Gemini 503");
    }
  );
  assertEquals(result.compacted, false);
  assertEquals(result.reason, "summarizer_failed");
  assertEquals(sb.rpcCalls.length, 0);
});

Deno.test("performCompaction: RPC error bubbles up (caller decides retry)", async () => {
  const sb = {
    rpc: () => Promise.resolve({ data: null, error: { message: "deadlock" } }),
  };
  const session = { ...baseSession, message_count: 20 };
  const userSession: UserSessionSnapshot = {
    user_id: "user-abc",
    context_data: { conversation_history: seedHistory(20) },
  };
  await assertRejects(
    () =>
      performCompaction(
        sb as any,
        session,
        userSession,
        DEFAULT_COMPACTION_CONFIG,
        async () => "A long enough summary to pass the guard."
      ),
    Error,
    "apply_gateway_session_compaction RPC failed"
  );
});

Deno.test("performCompaction: null user_session treated as empty history", async () => {
  const sb = mockSupabase();
  const session = { ...baseSession, message_count: 50 };
  const result = await performCompaction(
    sb as any,
    session,
    null,
    DEFAULT_COMPACTION_CONFIG,
    async () => "never called"
  );
  assertEquals(result.compacted, false);
  assert(result.reason?.startsWith("history_too_short"));
});

Deno.test("performCompaction: second compaction only folds NEW turns", async () => {
  const sb = mockSupabase();
  const hist = seedHistory(20);
  const cursor = hist[9].timestamp!; // already summarized through index 9
  const session = {
    ...baseSession,
    message_count: 20,
    compact_summary: "existing summary text here",
    last_compacted_at: cursor,
  };
  const userSession: UserSessionSnapshot = {
    user_id: "user-abc",
    context_data: { conversation_history: hist },
  };

  let seenTurnsInPrompt = "";
  const caller: GeminiCaller = async (prompt) => {
    seenTurnsInPrompt = prompt;
    return "combined summary covering old + new turns faithfully.";
  };

  const result = await performCompaction(
    sb as any,
    session,
    userSession,
    DEFAULT_COMPACTION_CONFIG,
    caller
  );

  assertEquals(result.compacted, true);
  // Should compact indices 10..13 (4 turns) — 14..19 are keep-recent
  assertEquals(result.compactedCount, 4);
  // Prompt must include existing summary and new turns, but NOT old turns
  assert(seenTurnsInPrompt.includes("existing summary text here"));
  assert(seenTurnsInPrompt.includes("message 10"));
  assert(seenTurnsInPrompt.includes("message 13"));
  assert(!seenTurnsInPrompt.includes("message 0"));
  assert(!seenTurnsInPrompt.includes("message 9"));
});

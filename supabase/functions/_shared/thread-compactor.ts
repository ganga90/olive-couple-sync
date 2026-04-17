/**
 * Thread Compactor — cursor-based summarization of long WhatsApp threads
 * =======================================================================
 * Keeps long-running threads within the context budget by rolling older
 * turns into a compact summary stored on `olive_gateway_sessions`. The
 * recent K turns stay verbatim in `user_sessions.context_data.conversation_history`.
 *
 * Design invariants (read these before editing):
 *
 *   1. CURSOR-BASED, NOT DESTRUCTIVE.
 *      We never delete from `user_sessions.context_data.conversation_history`.
 *      The webhook keeps trimming that array to its own FIFO cap. We only
 *      summarize messages older than the cursor (`last_compacted_at`) and
 *      newer than (or equal to) it on the next tick — so a race with the
 *      webhook can never cause data loss.
 *
 *   2. APPEND-ONLY SUMMARY.
 *      Each new summary folds the prior `compact_summary` + the new slice
 *      into a combined summary via Flash-Lite. If the combined summary
 *      grows beyond MAX_SUMMARY_CHARS we ask the model to re-condense,
 *      preserving invariants (named entities, commitments, emotional arc).
 *
 *   3. TESTABLE PURE CORE.
 *      `selectMessagesToCompact`, `shouldCompact`, `buildSummarizationPrompt`,
 *      and `formatHistoryWithSummary` are deterministic and pure — they're
 *      the unit-test surface. `performCompaction` is the orchestrator that
 *      touches the DB and the LLM; exercise it via integration tests.
 *
 *   4. FAIL-SAFE.
 *      A summarization failure must NEVER corrupt the session. If the LLM
 *      returns empty or an error, we abort and leave the cursor + summary
 *      untouched; the next tick will try again.
 */

import { GEMINI_KEY } from "./gemini.ts";

// ─── Types ──────────────────────────────────────────────────────────

export interface ConversationTurn {
  role: "user" | "assistant" | string;
  content: string;
  timestamp?: string; // ISO; missing treated as "very old" so it gets compacted
}

export interface GatewaySessionSnapshot {
  id: string;
  user_id: string;
  channel: string;
  message_count: number;
  compact_summary: string | null;
  last_compacted_at: string | null;
}

export interface UserSessionSnapshot {
  user_id: string;
  context_data: {
    conversation_history?: ConversationTurn[];
    [k: string]: unknown;
  } | null;
}

export interface CompactionConfig {
  /** Compaction triggers when message_count >= this threshold. */
  triggerMessageCount: number;
  /** Number of most-recent turns to always keep verbatim (never compacted). */
  keepRecentTurns: number;
  /** Minimum NEW turns below which we skip compaction. */
  minTurnsToCompact: number;
  /**
   * Soft cap on the combined summary in characters. When exceeded, the
   * summarizer is invoked with a `recondense: true` hint so it trims its
   * own output instead of appending forever.
   */
  maxSummaryChars: number;
  /** Model ID to use for summarization — Flash-Lite by default. */
  model: string;
  /** Temperature for summarization. Low to keep factual fidelity. */
  temperature: number;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  triggerMessageCount: 15,
  keepRecentTurns: 6, // 3 user/assistant exchanges
  minTurnsToCompact: 4,
  maxSummaryChars: 2000, // ~500 tokens — well under HISTORY slot's 600 cap
  model: "gemini-2.5-flash-lite",
  temperature: 0.1,
};

export interface CompactionResult {
  /** True if a new summary was written. */
  compacted: boolean;
  /** Why we skipped, if compacted=false. For observability. */
  reason?: string;
  /** How many turns were rolled into the summary this run. */
  compactedCount?: number;
  /** The new (combined) summary length in characters. */
  summaryChars?: number;
  /** The cursor advance — latest timestamp of compacted turns. */
  newCursor?: string;
}

// ─── Pure logic (unit-test surface) ─────────────────────────────────

/**
 * Gate: should we attempt compaction for this session right now?
 * Exposed as a standalone function so tests can assert the trigger.
 */
export function shouldCompact(
  session: GatewaySessionSnapshot,
  history: ConversationTurn[],
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG
): { should: boolean; reason: string } {
  if (session.message_count < config.triggerMessageCount) {
    return {
      should: false,
      reason: `below_threshold:${session.message_count}<${config.triggerMessageCount}`,
    };
  }
  if (history.length <= config.keepRecentTurns) {
    return {
      should: false,
      reason: `history_too_short:${history.length}<=${config.keepRecentTurns}`,
    };
  }
  return { should: true, reason: "trigger_met" };
}

/**
 * Select which messages from `history` should be rolled into the summary.
 * Applies both the cursor filter (skip anything older-than-or-equal to
 * `last_compacted_at` — already compacted) AND the keep-recent filter
 * (the most-recent K turns stay verbatim).
 *
 * Returns the slice to compact PLUS the cursor timestamp to advance to.
 * If no turn has a timestamp, cursor falls back to the caller-provided
 * `nowIso` so progress is still made.
 */
export function selectMessagesToCompact(
  history: ConversationTurn[],
  lastCompactedAt: string | null,
  config: CompactionConfig,
  nowIso: string
): { toCompact: ConversationTurn[]; newCursor: string } {
  const cutoffRecent = Math.max(0, history.length - config.keepRecentTurns);
  const olderSlice = history.slice(0, cutoffRecent);

  const cursorMs = lastCompactedAt ? Date.parse(lastCompactedAt) : NaN;
  const toCompact = olderSlice.filter((turn) => {
    // Missing timestamp → assume it's old and compact it (safe: we only
    // ever summarize, never delete).
    if (!turn.timestamp) return true;
    if (isNaN(cursorMs)) return true;
    const ts = Date.parse(turn.timestamp);
    if (isNaN(ts)) return true;
    return ts > cursorMs;
  });

  // Cursor advances to the MAX timestamp seen in the compacted slice.
  // If no compacted turn carries a usable timestamp, fall back to nowIso
  // so we still make progress and don't re-scan the same slice next tick.
  let newCursor: string | null = null;
  for (const t of toCompact) {
    if (!t.timestamp) continue;
    const ts = Date.parse(t.timestamp);
    if (isNaN(ts)) continue;
    if (newCursor === null || ts > Date.parse(newCursor)) {
      newCursor = t.timestamp;
    }
  }
  return { toCompact, newCursor: newCursor ?? nowIso };
}

/** Render a turn list into a compact, model-friendly transcript block. */
export function renderTurns(turns: ConversationTurn[]): string {
  return turns
    .map((t) => {
      const who = t.role === "assistant" ? "Olive" : "User";
      // Trim insanely long turns so one giant message can't blow the prompt.
      const body = (t.content || "").trim().slice(0, 800);
      return `${who}: ${body}`;
    })
    .join("\n");
}

/**
 * Build the summarization prompt. `existingSummary` can be null on first
 * compaction; otherwise the model is instructed to fold-in, not replace.
 */
export function buildSummarizationPrompt(
  existingSummary: string | null,
  newTurns: ConversationTurn[],
  recondense: boolean
): string {
  const header =
    `You are compressing a WhatsApp conversation between Olive (an AI personal ` +
    `assistant) and a user. Produce a faithful, dense summary optimized for ` +
    `later context injection.`;

  const rules = [
    "Preserve: decisions made, commitments, named entities (tasks, lists, " +
      "people, dates, amounts), emotional tone shifts, unresolved items.",
    "Use third person. Refer to the user as 'the user' and to the assistant as 'Olive'.",
    "No small talk, no filler. If a topic was started but never concluded, " +
      "explicitly note it as open.",
    recondense
      ? "The combined summary is getting long — re-condense aggressively. " +
        "Target ≤ 1200 characters while keeping every commitment."
      : "Target ≤ 1500 characters for the combined summary.",
    "Return ONLY the summary text. No preamble, no markdown fences.",
  ];

  const ctx = existingSummary
    ? `PRIOR SUMMARY (fold the new turns INTO this; do not replace it):\n${existingSummary}\n`
    : "PRIOR SUMMARY: (none — this is the first compaction)\n";

  const turns = `NEW TURNS TO FOLD IN:\n${renderTurns(newTurns)}\n`;

  return `${header}\n\nRULES:\n- ${rules.join("\n- ")}\n\n${ctx}\n${turns}\nCombined summary:`;
}

/**
 * Format HISTORY slot content by combining the compact summary with the
 * recent verbatim turns. This is what the webhook injects into the
 * HISTORY slot of the Context Contract.
 *
 * Pure function — easy to test.
 */
export function formatHistoryWithSummary(
  compactSummary: string | null,
  recentTurns: ConversationTurn[]
): string {
  const recentBlock = recentTurns.length > 0
    ? `Recent turns:\n${renderTurns(recentTurns)}`
    : "Recent turns: (none)";

  if (!compactSummary || compactSummary.trim().length === 0) {
    return recentBlock;
  }
  return (
    `Earlier in this thread (compacted summary):\n${compactSummary.trim()}\n\n` +
    recentBlock
  );
}

// ─── LLM wrapper (thin, testable by dep injection) ──────────────────

export type GeminiCaller = (
  prompt: string,
  model: string,
  temperature: number,
  maxOutputTokens: number
) => Promise<string>;

/**
 * Default caller — hits Gemini REST directly. Accepts an injected caller
 * in tests so we don't need the real API key or network.
 */
export const defaultGeminiCaller: GeminiCaller = async (
  prompt,
  model,
  temperature,
  maxOutputTokens
) => {
  if (!GEMINI_KEY) throw new Error("GEMINI_KEY not configured");
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens },
    }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
};

/**
 * Compose a new combined summary by calling the LLM. Exposed separately
 * from `performCompaction` so tests can inject a fake caller.
 */
export async function generateCombinedSummary(
  existingSummary: string | null,
  newTurns: ConversationTurn[],
  config: CompactionConfig,
  caller: GeminiCaller = defaultGeminiCaller
): Promise<string> {
  const existingLen = existingSummary ? existingSummary.length : 0;
  const recondense = existingLen > config.maxSummaryChars * 0.75;

  const prompt = buildSummarizationPrompt(existingSummary, newTurns, recondense);
  // Cap output so we can't runaway past the HISTORY slot budget.
  const maxTokens = Math.ceil(config.maxSummaryChars / 4) + 64;

  const text = await caller(prompt, config.model, config.temperature, maxTokens);
  const cleaned = text.trim();
  if (cleaned.length < 20) {
    // Suspiciously short — treat as a failure so the caller aborts.
    throw new Error(`summarizer_returned_too_short:${cleaned.length}`);
  }
  // Hard clamp in case the model ignored the soft target.
  return cleaned.slice(0, config.maxSummaryChars);
}

// ─── Orchestrator (DB side-effects) ─────────────────────────────────

/**
 * End-to-end compaction for one session. Idempotent: safe to call even
 * when below threshold (will short-circuit with reason='below_threshold').
 *
 * Failure modes:
 *   - No history or below threshold → returns `{compacted:false, reason}`.
 *   - Summarizer throws / returns empty → returns `{compacted:false,
 *     reason:'summarizer_failed'}` and leaves DB untouched.
 *   - RPC commit fails → throws (caller decides whether to retry).
 */
export async function performCompaction(
  supabase: any,
  gatewaySession: GatewaySessionSnapshot,
  userSession: UserSessionSnapshot | null,
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
  caller: GeminiCaller = defaultGeminiCaller,
  nowIso: string = new Date().toISOString()
): Promise<CompactionResult> {
  const history: ConversationTurn[] =
    (userSession?.context_data?.conversation_history as ConversationTurn[]) || [];

  const gate = shouldCompact(gatewaySession, history, config);
  if (!gate.should) {
    return { compacted: false, reason: gate.reason };
  }

  const { toCompact, newCursor } = selectMessagesToCompact(
    history,
    gatewaySession.last_compacted_at,
    config,
    nowIso
  );

  if (toCompact.length < config.minTurnsToCompact) {
    return {
      compacted: false,
      reason: `below_min_turns:${toCompact.length}<${config.minTurnsToCompact}`,
    };
  }

  // Summarize — bail out cleanly on failure.
  let combinedSummary: string;
  try {
    combinedSummary = await generateCombinedSummary(
      gatewaySession.compact_summary,
      toCompact,
      config,
      caller
    );
  } catch (err) {
    console.warn(
      `[Compactor] summarizer failed for session=${gatewaySession.id}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return { compacted: false, reason: "summarizer_failed" };
  }

  // Commit via RPC: atomic write of summary + cursor + counter decrement.
  const { error } = await supabase.rpc("apply_gateway_session_compaction", {
    p_session_id: gatewaySession.id,
    p_compact_summary: combinedSummary,
    p_cursor_ts: newCursor,
    p_compacted_count: toCompact.length,
  });

  if (error) {
    throw new Error(`apply_gateway_session_compaction RPC failed: ${error.message}`);
  }

  return {
    compacted: true,
    compactedCount: toCompact.length,
    summaryChars: combinedSummary.length,
    newCursor,
  };
}

/**
 * Find all active sessions ripe for compaction and run them serially.
 * Serial (not parallel) because the summarizer LLM calls are the expensive
 * step and we don't want to burst the quota mid-heartbeat.
 */
export async function compactActiveThreads(
  supabase: any,
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
  caller: GeminiCaller = defaultGeminiCaller
): Promise<{ scanned: number; compacted: number; skipped: number; failed: number }> {
  const { data: sessions, error } = await supabase
    .from("olive_gateway_sessions")
    .select("id, user_id, channel, message_count, compact_summary, last_compacted_at")
    .eq("is_active", true)
    .gte("message_count", config.triggerMessageCount)
    .limit(50);

  if (error) {
    console.error("[Compactor] scan failed:", error);
    return { scanned: 0, compacted: 0, skipped: 0, failed: 1 };
  }

  let compacted = 0;
  let skipped = 0;
  let failed = 0;

  for (const session of sessions || []) {
    // Fetch the paired user_session (where conversation_history lives).
    const { data: userSession } = await supabase
      .from("user_sessions")
      .select("user_id, context_data")
      .eq("user_id", session.user_id)
      .eq("is_active", true)
      .order("last_activity", { ascending: false })
      .limit(1)
      .maybeSingle();

    try {
      const result = await performCompaction(
        supabase,
        session,
        userSession,
        config,
        caller
      );
      if (result.compacted) {
        compacted++;
        console.log(
          `[Compactor] user=${session.user_id} compacted ${result.compactedCount} turns ` +
            `into ${result.summaryChars} chars; cursor=${result.newCursor}`
        );
      } else {
        skipped++;
        console.log(`[Compactor] user=${session.user_id} skipped: ${result.reason}`);
      }
    } catch (err) {
      failed++;
      console.error(
        `[Compactor] user=${session.user_id} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return { scanned: (sessions || []).length, compacted, skipped, failed };
}

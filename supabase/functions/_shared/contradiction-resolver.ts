/**
 * Contradiction Resolver — close the ASK_USER loop for memory contradictions
 * ===========================================================================
 * Phase 1 Task 1-C produced contradictions with `resolution_strategy='ASK_USER'`
 * and enqueued `olive_heartbeat_jobs` rows of type `contradiction_resolve`.
 * Phase 2 connects the loop:
 *
 *   [heartbeat tick]
 *     ├── handleContradictionResolveJob()
 *     │     ├── formatContradictionQuestion()   ← pure, testable
 *     │     ├── INSERT olive_pending_questions  ← so inbound knows we're waiting
 *     │     └── INSERT olive_outbound_queue     ← user receives the question
 *     │
 *   [user replies on WhatsApp]
 *     │
 *   [whatsapp-webhook]
 *     └── tryResolvePendingQuestion()
 *           ├── parseUserResolution()            ← Flash-Lite JSON schema
 *           └── applyResolution()                ← updates contradiction + chunks
 *
 * The resolver is channel-agnostic: it knows nothing about WhatsApp vs web;
 * callers pass `channel` into the pending-question row.
 *
 * Design invariants:
 *
 *   1. NO SILENT DELETION.
 *      "neither" answers leave both chunks alive and mark the contradiction
 *      `resolution='unresolved'` with explanatory notes. The user can revisit.
 *
 *   2. PURE CORE.
 *      `formatContradictionQuestion`, `buildResolverPrompt`, and
 *      `parseResolverJson` are pure functions — they're the unit-test surface.
 *      `applyResolution` is the DB orchestrator.
 *
 *   3. IDEMPOTENT.
 *      `applyResolution` checks whether the contradiction already has
 *      `resolved_at` set; if so, it no-ops. Safe to retry on transient errors.
 *
 *   4. FAIL-OPEN.
 *      If the LLM fails to classify the answer, we do NOT auto-resolve.
 *      The pending question stays open until timeout; the user's message
 *      falls through to normal processing (they can resolve via UI).
 */

import { GEMINI_KEY } from "./gemini.ts";

// ─── Types ──────────────────────────────────────────────────────────

export interface ContradictionPayload {
  contradiction_id: string;
  chunk_a_id?: string;
  chunk_b_id?: string;
  chunk_a_content: string;
  chunk_b_content: string;
  contradiction_type: string; // "factual" | "temporal" | "preference" | "behavioral" | …
  confidence: number;
}

export type ResolutionWinner = "a" | "b" | "merge" | "neither";

export interface ResolverDecision {
  winner: ResolutionWinner;
  /** Required when winner = 'merge'. */
  merge_text?: string;
  /** Short explanation for audit logging. */
  reasoning?: string;
  /** Model that produced this decision. */
  model?: string;
}

export interface PendingQuestionRow {
  id: string;
  user_id: string;
  question_type: string; // "contradiction_resolve"
  reference_id: string;  // contradiction_id
  channel: string;
  question_text: string;
  payload: ContradictionPayload | Record<string, unknown>;
  asked_at: string;
  expires_at: string;
  answered_at: string | null;
  answer_text: string | null;
  resolution: ResolverDecision | null;
  status: "pending" | "answered" | "expired" | "cancelled";
}

// ─── Pure logic (unit-test surface) ─────────────────────────────────

/**
 * Human-facing clarification question. Kept short — WhatsApp users scan,
 * they don't read. We show both facts and let them answer free-form.
 *
 * Examples by type:
 *
 *   factual:   "Quick check — which is current?
 *               A) Lives in Brooklyn
 *               B) Lives in Queens
 *               Reply A, B, both (if they changed over time), or say what's actually true."
 *
 *   preference: "Two different things you've mentioned about coffee:
 *                A) Prefers light roast
 *                B) Prefers dark roast
 *                Still true for both? Or has it changed?"
 */
export function formatContradictionQuestion(
  payload: ContradictionPayload
): string {
  const { chunk_a_content, chunk_b_content, contradiction_type } = payload;

  // Trim long chunks; users don't need the full chunk.
  const a = oneLine(chunk_a_content, 180);
  const b = oneLine(chunk_b_content, 180);

  const intro = introForType(contradiction_type);
  return (
    `${intro}\n\n` +
    `A) ${a}\n` +
    `B) ${b}\n\n` +
    `Reply with A, B, "both" (if both are true), "merge" (if they combine), ` +
    `or just tell me what's current.`
  );
}

function introForType(type: string): string {
  switch ((type || "").toLowerCase()) {
    case "factual":
      return "Quick check — I've got two different facts here and I'm not sure which is current.";
    case "temporal":
      return "I have two things with dates that don't line up.";
    case "preference":
      return "Two different preferences you've mentioned — has one changed?";
    case "behavioral":
      return "I've noticed two different patterns — which still fits?";
    default:
      return "Quick check — I have two things that might be contradicting.";
  }
}

function oneLine(s: string, max: number): string {
  const collapsed = (s || "").replace(/\s+/g, " ").trim();
  return collapsed.length > max ? collapsed.slice(0, max - 1) + "…" : collapsed;
}

/** Prompt that asks Flash-Lite to classify the user's free-form reply. */
export function buildResolverPrompt(
  payload: ContradictionPayload,
  userReply: string
): string {
  const a = oneLine(payload.chunk_a_content, 300);
  const b = oneLine(payload.chunk_b_content, 300);
  const reply = oneLine(userReply, 600);

  return [
    `You are resolving a memory contradiction. Given two conflicting facts and`,
    `the user's reply, pick the winner.`,
    ``,
    `Fact A: ${a}`,
    `Fact B: ${b}`,
    ``,
    `User reply: "${reply}"`,
    ``,
    `Classify the reply as one of:`,
    `  "a"       — user confirms A is current, B is stale`,
    `  "b"       — user confirms B is current, A is stale`,
    `  "merge"   — both are true; provide merged text`,
    `  "neither" — user rejects both or the reply is off-topic`,
    ``,
    `Return ONLY a JSON object with this exact shape:`,
    `{ "winner": "a" | "b" | "merge" | "neither",`,
    `  "merge_text": "<required only when winner='merge'>",`,
    `  "reasoning": "<one short sentence>" }`,
    ``,
    `No markdown fences, no prose before or after the JSON.`,
  ].join("\n");
}

/**
 * Robust JSON extraction. The model may occasionally wrap its answer in
 * ```json fences or leak a sentence before the JSON. Try hard before we
 * give up.
 */
export function parseResolverJson(raw: string): ResolverDecision | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // Try: direct parse.
  const direct = tryParse(trimmed);
  if (direct) return normalizeDecision(direct);

  // Try: extract fenced JSON block.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const fenced = tryParse(fenceMatch[1].trim());
    if (fenced) return normalizeDecision(fenced);
  }

  // Try: first balanced { ... } in the string.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const sliced = tryParse(trimmed.slice(start, end + 1));
    if (sliced) return normalizeDecision(sliced);
  }

  return null;
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeDecision(v: unknown): ResolverDecision | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  const winnerRaw = String(obj.winner ?? "").toLowerCase().trim();
  if (!["a", "b", "merge", "neither"].includes(winnerRaw)) return null;
  const winner = winnerRaw as ResolutionWinner;

  const mergeText = typeof obj.merge_text === "string" ? obj.merge_text.trim() : undefined;
  if (winner === "merge" && (!mergeText || mergeText.length < 3)) {
    // Merge without merge_text is unusable; reject.
    return null;
  }

  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning.trim() : undefined;

  return { winner, merge_text: mergeText, reasoning };
}

/**
 * Map a `winner` decision onto the `resolution` enum stored on
 * `olive_memory_contradictions`. The DB check constraint accepts:
 *   keep_newer | keep_older | merge | ask_user | unresolved
 *
 * "a" and "b" translate based on chronological order of chunk_a vs chunk_b,
 * which the CALLER must pass in because this function is pure.
 */
export function mapWinnerToResolution(
  winner: ResolutionWinner,
  chunkAIsNewer: boolean
): "keep_newer" | "keep_older" | "merge" | "unresolved" {
  if (winner === "merge") return "merge";
  if (winner === "neither") return "unresolved";
  const aWon = winner === "a";
  return aWon === chunkAIsNewer ? "keep_newer" : "keep_older";
}

// ─── LLM wrapper (thin, testable by dep injection) ──────────────────

export type GeminiCaller = (
  prompt: string,
  model: string,
  temperature: number,
  maxOutputTokens: number
) => Promise<string>;

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
      generationConfig: { temperature, maxOutputTokens, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
};

/** Call the model and extract a ResolverDecision, or null on any failure. */
export async function parseUserResolution(
  payload: ContradictionPayload,
  userReply: string,
  model: string = "gemini-2.5-flash-lite",
  caller: GeminiCaller = defaultGeminiCaller
): Promise<ResolverDecision | null> {
  // Fast-path: explicit single-letter answers don't need the LLM.
  const shortcut = shortcutResolve(userReply);
  if (shortcut) return { ...shortcut, model: "shortcut" };

  try {
    const prompt = buildResolverPrompt(payload, userReply);
    const raw = await caller(prompt, model, 0.1, 256);
    const parsed = parseResolverJson(raw);
    if (parsed) return { ...parsed, model };
    console.warn("[ContradictionResolver] could not parse LLM output:", raw.slice(0, 200));
    return null;
  } catch (err) {
    console.warn(
      "[ContradictionResolver] LLM call failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Catch the easy cases before paying for an LLM call.
 * - "A" / "a" / "option a" → winner=a
 * - "B" / "b" / "option b" → winner=b
 * - "both" → not a resolver shortcut (requires merge_text); fall through
 * - "merge" alone → fall through (needs merge_text which LLM will draft)
 */
export function shortcutResolve(
  userReply: string
): Pick<ResolverDecision, "winner" | "reasoning"> | null {
  const t = (userReply || "").trim().toLowerCase();
  if (!t) return null;
  if (/^(a|option a|letter a|it's a)[.!]?$/.test(t)) {
    return { winner: "a", reasoning: "explicit_shortcut" };
  }
  if (/^(b|option b|letter b|it's b)[.!]?$/.test(t)) {
    return { winner: "b", reasoning: "explicit_shortcut" };
  }
  return null;
}

// ─── DB orchestrators ───────────────────────────────────────────────

/**
 * Called by the heartbeat when a `contradiction_resolve` job fires.
 * Creates a pending-question row AND returns the formatted question text
 * for the caller to send through its outbound pipeline.
 *
 * Returns `null` if the contradiction has already been resolved (idempotent).
 */
export async function handleContradictionResolveJob(
  supabase: any,
  userId: string,
  payload: ContradictionPayload,
  channel: "whatsapp" | "web" = "whatsapp"
): Promise<{ pendingQuestionId: string; questionText: string } | null> {
  // Idempotency: if the contradiction is already resolved, skip.
  const { data: existing } = await supabase
    .from("olive_memory_contradictions")
    .select("id, resolved_at, resolution")
    .eq("id", payload.contradiction_id)
    .maybeSingle();

  if (!existing) return null;
  if (existing.resolved_at) {
    console.log(
      `[ContradictionResolver] skip: contradiction ${payload.contradiction_id} already resolved`
    );
    return null;
  }

  // Dedupe: if an unanswered pending question already exists for this
  // contradiction, reuse it (avoid spamming the user on every heartbeat).
  const { data: dupe } = await supabase
    .from("olive_pending_questions")
    .select("id, question_text, asked_at")
    .eq("user_id", userId)
    .eq("question_type", "contradiction_resolve")
    .eq("reference_id", payload.contradiction_id)
    .eq("status", "pending")
    .maybeSingle();

  if (dupe) {
    console.log(
      `[ContradictionResolver] reusing pending question ${dupe.id} (asked_at=${dupe.asked_at})`
    );
    return { pendingQuestionId: dupe.id, questionText: dupe.question_text };
  }

  const questionText = formatContradictionQuestion(payload);

  const { data: inserted, error: insErr } = await supabase
    .from("olive_pending_questions")
    .insert({
      user_id: userId,
      question_type: "contradiction_resolve",
      reference_id: payload.contradiction_id,
      channel,
      question_text: questionText,
      payload,
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    throw new Error(
      `insert olive_pending_questions failed: ${insErr?.message || "unknown"}`
    );
  }

  return { pendingQuestionId: inserted.id, questionText };
}

/**
 * Look up the most-recent active pending question for this user. Used by
 * the webhook to decide whether an inbound is an answer to Olive's question.
 *
 * Only returns a row whose `expires_at` is in the future and `status='pending'`.
 */
export async function findActivePendingQuestion(
  supabase: any,
  userId: string,
  channel: "whatsapp" | "web" = "whatsapp"
): Promise<PendingQuestionRow | null> {
  const { data, error } = await supabase
    .from("olive_pending_questions")
    .select("*")
    .eq("user_id", userId)
    .eq("channel", channel)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("asked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[ContradictionResolver] findActivePendingQuestion error:", error);
    return null;
  }
  return (data as PendingQuestionRow) || null;
}

/**
 * Apply a resolver decision to `olive_memory_contradictions` and the
 * underlying chunks. Idempotent — if the row already has `resolved_at`,
 * returns `{applied:false, reason:'already_resolved'}`.
 *
 * The caller is responsible for marking the pending question answered.
 */
export async function applyResolution(
  supabase: any,
  contradictionId: string,
  decision: ResolverDecision,
  userReply: string
): Promise<{ applied: boolean; reason?: string }> {
  // Fetch the contradiction + both chunks to decide chronology.
  const { data: contradiction } = await supabase
    .from("olive_memory_contradictions")
    .select("id, chunk_a_id, chunk_b_id, resolved_at")
    .eq("id", contradictionId)
    .maybeSingle();

  if (!contradiction) {
    return { applied: false, reason: "contradiction_not_found" };
  }
  if (contradiction.resolved_at) {
    return { applied: false, reason: "already_resolved" };
  }

  const [{ data: chunkA }, { data: chunkB }] = await Promise.all([
    supabase
      .from("olive_memory_chunks")
      .select("id, content, created_at, is_active")
      .eq("id", contradiction.chunk_a_id)
      .maybeSingle(),
    supabase
      .from("olive_memory_chunks")
      .select("id, content, created_at, is_active")
      .eq("id", contradiction.chunk_b_id)
      .maybeSingle(),
  ]);

  if (!chunkA || !chunkB) {
    return { applied: false, reason: "chunks_missing" };
  }

  const chunkAIsNewer =
    new Date(chunkA.created_at).getTime() >= new Date(chunkB.created_at).getTime();

  const resolutionEnum = mapWinnerToResolution(decision.winner, chunkAIsNewer);
  let winningChunkId: string | null = null;
  let resolvedContent: string | null = null;

  switch (decision.winner) {
    case "a":
      winningChunkId = chunkA.id;
      resolvedContent = chunkA.content;
      // Deactivate the losing chunk.
      await supabase
        .from("olive_memory_chunks")
        .update({
          is_active: false,
          metadata: {
            deactivated_reason: "contradiction_user_resolved",
            deactivated_at: new Date().toISOString(),
          },
        })
        .eq("id", chunkB.id);
      break;
    case "b":
      winningChunkId = chunkB.id;
      resolvedContent = chunkB.content;
      await supabase
        .from("olive_memory_chunks")
        .update({
          is_active: false,
          metadata: {
            deactivated_reason: "contradiction_user_resolved",
            deactivated_at: new Date().toISOString(),
          },
        })
        .eq("id", chunkA.id);
      break;
    case "merge":
      resolvedContent = decision.merge_text || `${chunkA.content}\n\n${chunkB.content}`;
      // Both chunks stay active; the merged text is stored for the
      // compiler to prefer on next compilation.
      break;
    case "neither":
      // Leave both chunks alone; mark unresolved with explanatory notes.
      break;
  }

  const resolutionNotes =
    `USER_RESOLVED: winner=${decision.winner}. ` +
    `reply="${oneLine(userReply, 140)}". ` +
    (decision.reasoning ? `reasoning="${oneLine(decision.reasoning, 140)}". ` : "") +
    (decision.model ? `model=${decision.model}` : "");

  await supabase
    .from("olive_memory_contradictions")
    .update({
      resolution: resolutionEnum,
      resolution_strategy: "MANUAL",
      winning_chunk_id: winningChunkId,
      resolved_content: resolvedContent,
      resolved_at: new Date().toISOString(),
      resolution_notes: resolutionNotes,
    })
    .eq("id", contradictionId);

  return { applied: true };
}

/**
 * Mark a pending question answered. Stored with the raw reply + structured
 * resolution for audit.
 */
export async function markPendingQuestionAnswered(
  supabase: any,
  pendingQuestionId: string,
  userReply: string,
  decision: ResolverDecision | null
): Promise<void> {
  await supabase
    .from("olive_pending_questions")
    .update({
      status: "answered",
      answered_at: new Date().toISOString(),
      answer_text: oneLine(userReply, 1000),
      resolution: decision,
    })
    .eq("id", pendingQuestionId);
}

/**
 * End-to-end helper for the webhook: given an active pending question and
 * the user's reply, resolve it. Returns a structured outcome the webhook
 * can turn into a confirmation message.
 *
 * If the resolver can't classify the reply confidently, returns
 * `{resolved:false}` and LEAVES THE PENDING QUESTION ACTIVE. The caller
 * should then fall through to normal intent processing — the user's
 * message might be unrelated ("actually, add milk to groceries").
 */
export async function tryResolvePendingQuestion(
  supabase: any,
  pending: PendingQuestionRow,
  userReply: string,
  caller: GeminiCaller = defaultGeminiCaller
): Promise<
  | { resolved: true; decision: ResolverDecision; applied: boolean; reason?: string }
  | { resolved: false; reason: string }
> {
  const payload = pending.payload as ContradictionPayload;
  if (!payload || !payload.contradiction_id) {
    return { resolved: false, reason: "malformed_payload" };
  }

  const decision = await parseUserResolution(payload, userReply, undefined, caller);
  if (!decision) {
    return { resolved: false, reason: "could_not_classify_reply" };
  }

  const apply = await applyResolution(
    supabase,
    payload.contradiction_id,
    decision,
    userReply
  );
  await markPendingQuestionAnswered(supabase, pending.id, userReply, decision);

  return { resolved: true, decision, applied: apply.applied, reason: apply.reason };
}

/**
 * Build the user-facing confirmation after a resolution is applied.
 * Exposed (and tested) so the webhook can produce a consistent voice.
 */
export function formatResolutionConfirmation(
  decision: ResolverDecision,
  payload: ContradictionPayload
): string {
  switch (decision.winner) {
    case "a":
      return `Got it — I'll stick with "${oneLine(payload.chunk_a_content, 120)}" and drop the other one.`;
    case "b":
      return `Got it — I'll stick with "${oneLine(payload.chunk_b_content, 120)}" and drop the other one.`;
    case "merge":
      return `Got it — I'll remember both as: "${oneLine(decision.merge_text || "", 180)}".`;
    case "neither":
      return `No problem — I'll leave both as-is for now. Let me know if either changes.`;
  }
}

/**
 * Reflection Capture — natural-signal helpers
 * ============================================
 * Writes rows to `olive_reflections` based on natural user signals.
 *
 * Used for the OBSERVE → REFLECT → EVOLVE loop in `olive-soul-evolve`:
 * the more high-quality reflections we capture, the better soul evolution
 * decisions become. Until this module shipped, the only path to a
 * reflection was `olive-trust-gate` approve/reject — a tiny fraction of the
 * signal users actually emit.
 *
 * Design principles:
 *   1. **Deterministic-first.** Regex classification is fast (~1ms), free,
 *      and high-precision for strong signals. We DO NOT call Gemini for
 *      reflection classification — that would balloon cost on every WA
 *      reply. The classifier is intentionally narrow.
 *   2. **Always anchor.** A reflection only fires when there's a recent
 *      outbound message to anchor against. "thanks" alone is noise;
 *      "thanks" within 24h of a proactive nudge is signal.
 *   3. **Fail-soft.** Capture must NEVER block the user-facing flow. All
 *      callers wrap in try/catch + warn-only logging. The promise is
 *      typically NOT awaited by the caller (fire-and-forget).
 *   4. **High-precision over high-recall.** Missing a reflection is fine;
 *      capturing a wrong one corrupts soul evolution. Strict thresholds,
 *      negation guards, length cap.
 */

// ─── Types ──────────────────────────────────────────────────────────

export type ReflectionOutcome = "accepted" | "modified" | "rejected" | "ignored";

export interface ClassifiedReply {
  /** null = no strong signal — caller should skip capture */
  outcome: ReflectionOutcome | null;
  /** 0.0 to 1.0 — used by olive-soul-evolve to weight evidence */
  confidence: number;
  /** which deterministic pattern matched (for analytics / debugging) */
  matched_phrase?: string;
}

export interface RecentOutbound {
  /** olive_heartbeat_log.job_type — e.g. 'overdue_nudge', 'morning_briefing' */
  job_type: string;
  message_preview: string | null;
  created_at: string;
}

export interface CaptureResult {
  captured: boolean;
  outcome?: ReflectionOutcome;
  /** debug breadcrumb for log lines: 'no_strong_signal' | 'no_recent_outbound' | 'insert_error' */
  reason?: string;
}

// ─── Strong-signal patterns ─────────────────────────────────────────
// Order matters: REJECT patterns are checked first because "not great"
// must not match the "great" accept pattern. A negation prefix
// disqualifies any subsequent accept match too.

const NEGATIVE_PREFIX = /^\s*(no|not|don[''`]?t|never|please don)\b/i;

const REJECTED_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(stop|silence|mute|shut up)\b/i, label: "stop" },
  { pattern: /\b(too much|too many|less\s+(of|please)|annoying|spam)\b/i, label: "too_much" },
  { pattern: /\b(not now|leave me alone|wrong|incorrect)\b/i, label: "reject" },
];

const ACCEPTED_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(thanks|thank you|ty|thx)\b/i, label: "thanks" },
  { pattern: /\b(perfect|exactly|love it|awesome|yes please)\b/i, label: "positive_emphatic" },
  { pattern: /\b(do it|go ahead|sounds good|sgtm)\b/i, label: "go_ahead" },
  // Standalone "great" requires its own pattern — the word commonly
  // appears in non-reactive sentences ("the great migration") so we only
  // accept it when it's the dominant content of a short reply.
  { pattern: /^\s*great[!.\s]*$/i, label: "great_short" },
];

/** Maximum reply length we'll classify. Beyond this it's a real message,
 * not a one-word reaction; the false-positive rate climbs steeply. */
const MAX_CLASSIFY_LEN = 200;

/**
 * Pure deterministic classifier. No I/O, no LLM. Returns `outcome: null`
 * for anything that isn't a strong, unambiguous signal — that case is
 * the overwhelming majority of inbound messages and produces no
 * reflection.
 */
export function classifyReplyOutcome(text: string): ClassifiedReply {
  const t = (text || "").trim();
  if (t.length === 0 || t.length > MAX_CLASSIFY_LEN) {
    return { outcome: null, confidence: 0 };
  }

  // Reject patterns dominate. "not bad" is ambiguous; "stop" is not.
  for (const { pattern, label } of REJECTED_PATTERNS) {
    if (pattern.test(t)) {
      return { outcome: "rejected", confidence: 0.85, matched_phrase: label };
    }
  }

  // Accept patterns: only if the message doesn't open with a negation.
  // "no thanks" → null. "thanks but not now" → already caught by REJECT.
  if (NEGATIVE_PREFIX.test(t)) {
    return { outcome: null, confidence: 0 };
  }
  for (const { pattern, label } of ACCEPTED_PATTERNS) {
    if (pattern.test(t)) {
      return { outcome: "accepted", confidence: 0.85, matched_phrase: label };
    }
  }

  return { outcome: null, confidence: 0 };
}

// ─── Anchor lookup ─────────────────────────────────────────────────

/**
 * Was there a heartbeat-driven outbound message to this user recently?
 * If not, we don't capture — a "thanks" with no anchor is just thanks.
 */
export async function findRecentProactiveOutbound(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  withinMinutes: number = 1440 // 24h default
): Promise<RecentOutbound | null> {
  try {
    const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("olive_heartbeat_log")
      .select("job_type, message_preview, created_at")
      .eq("user_id", userId)
      .eq("status", "sent")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data || null;
  } catch {
    return null;
  }
}

// ─── End-to-end orchestration ──────────────────────────────────────

/**
 * Top-level helper: classify the reply, anchor it against a recent
 * outbound, write a reflection if both checks pass.
 *
 * Caller should typically NOT await this — it's fire-and-forget. Wrap
 * in `.catch()` to keep the unhandled-rejection warning out of logs:
 *
 *   captureReplyReflection(sb, uid, text).catch(err => console.warn(err));
 */
export async function captureReplyReflection(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  replyText: string
): Promise<CaptureResult> {
  const classification = classifyReplyOutcome(replyText);
  if (classification.outcome === null) {
    return { captured: false, reason: "no_strong_signal" };
  }

  const recent = await findRecentProactiveOutbound(supabase, userId);
  if (!recent) {
    return { captured: false, reason: "no_recent_outbound" };
  }

  try {
    await supabase.from("olive_reflections").insert({
      user_id: userId,
      action_type: recent.job_type,
      action_detail: {
        outbound_preview: recent.message_preview,
        reply_text: replyText.slice(0, MAX_CLASSIFY_LEN),
        matched_phrase: classification.matched_phrase,
      },
      outcome: classification.outcome,
      lesson:
        classification.outcome === "rejected"
          ? `User reacted negatively ('${classification.matched_phrase}') to ${recent.job_type}`
          : `User reacted positively ('${classification.matched_phrase}') to ${recent.job_type}`,
      confidence: classification.confidence,
    });
    return { captured: true, outcome: classification.outcome };
  } catch (err) {
    console.warn("[reflection-capture] insert failed:", err);
    return { captured: false, reason: "insert_error" };
  }
}

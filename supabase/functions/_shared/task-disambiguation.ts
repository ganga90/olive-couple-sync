// _shared/task-disambiguation.ts
//
// The original Ask Olive action handlers all did the same thing:
//   .ilike('summary', '%X%').limit(1)
//
// First-match-wins is dangerous: a user with two "Visit apartment" tasks
// (Brooklyn vs SoHo) would silently get the wrong one updated. This
// helper replaces that pattern. It:
//
//   1. Fetches a small shortlist (top N) of fuzzy matches
//   2. Scores them against the user's reference phrase using a
//      transparent rubric — exact-phrase boost, token overlap, recency,
//      due-date proximity. The rubric is pure, unit-testable, and not
//      LLM-dependent.
//   3. Returns a typed verdict: SINGLE_BEST → proceed; AMBIGUOUS → ask
//      the user to pick; NONE → say so honestly.
//
// The verdict carries the candidates so callers can stash them on the
// pending offer for the next-turn disambiguation reply ("the SoHo one").

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface TaskCandidate {
  id: string;
  summary: string;
  due_date: string | null;
  reminder_time: string | null;
  updated_at: string | null;
}

export type DisambiguationVerdict =
  | { kind: "SINGLE_BEST"; task: TaskCandidate; confidence: number; rank: TaskCandidate[] }
  | { kind: "AMBIGUOUS"; candidates: TaskCandidate[] }
  | { kind: "NONE" };

const DEFAULT_TOP_N = 5;
// Threshold gap between top-1 and top-2 below which we treat as ambiguous.
// Tuned on the principle: if the second-best is 60% as good as the best,
// we can't be sure — ask. If it's <60%, top-1 dominates and we proceed.
const AMBIGUITY_GAP = 0.4;
// Below this confidence even the top-1 is too weak to proceed silently.
// Surface as ambiguous so the user can correct us.
const MIN_CONFIDENCE = 0.45;

// ─── Scoring ──────────────────────────────────────────────────────────

// Pure scoring function — exported for testing. Returns a number in
// [0, 1]; higher = better match. Components:
//   - 0.55: token overlap (Jaccard on lowercased word tokens, ignoring stopwords)
//   - 0.25: exact-phrase boost (full reference string appears verbatim)
//   - 0.10: starts-with boost (task summary starts with reference, or vice versa)
//   - 0.10: recency (linear decay: < 7 days = full, > 60 days = none)
export function scoreCandidate(
  reference: string,
  candidate: TaskCandidate,
  now: number = Date.now(),
): number {
  const ref = normalize(reference);
  const sum = normalize(candidate.summary);
  if (!ref || !sum) return 0;

  const refTokens = tokenize(ref);
  const sumTokens = tokenize(sum);
  if (refTokens.size === 0 || sumTokens.size === 0) return 0;

  // Jaccard similarity
  let inter = 0;
  for (const t of refTokens) if (sumTokens.has(t)) inter++;
  const jaccard = inter / (refTokens.size + sumTokens.size - inter);

  // Exact-phrase containment (either direction)
  const exact = sum.includes(ref) || ref.includes(sum) ? 1 : 0;

  // Starts-with
  const starts = sum.startsWith(ref) || ref.startsWith(sum) ? 1 : 0;

  // Recency
  let recency = 0;
  if (candidate.updated_at) {
    const ageMs = now - new Date(candidate.updated_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < 7) recency = 1;
    else if (ageDays > 60) recency = 0;
    else recency = 1 - (ageDays - 7) / 53;
  }

  return 0.55 * jaccard + 0.25 * exact + 0.1 * starts + 0.1 * recency;
}

// ─── Resolution ───────────────────────────────────────────────────────

export interface ResolveOptions {
  topN?: number;
  // When true, treat AMBIGUOUS as SINGLE_BEST if top-1 confidence is high
  // enough. Useful for non-destructive intents (e.g. read-only search).
  // For mutating intents (set_due / delete / edit) we default false —
  // always ask if there's any doubt.
  preferTopWhenConfident?: boolean;
}

export async function resolveTaskReference(
  supabase: SupabaseClient,
  args: {
    userId: string;
    spaceId: string | null;
    reference: string;
    options?: ResolveOptions;
  },
): Promise<DisambiguationVerdict> {
  const { userId, spaceId, reference, options = {} } = args;
  const { topN = DEFAULT_TOP_N, preferTopWhenConfident = false } = options;

  // Fetch a candidate pool. We pull a wider net than the original
  // `.limit(1)`: any task whose summary contains a salient token. The
  // scoring then ranks them.
  const probe = reference.trim().substring(0, 50);
  if (!probe) return { kind: "NONE" };

  let query = supabase
    .from("clerk_notes")
    .select("id, summary, due_date, reminder_time, updated_at")
    .eq("completed", false)
    .ilike("summary", `%${probe}%`)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (spaceId) {
    query = query.or(`author_id.eq.${userId},space_id.eq.${spaceId}`);
  } else {
    query = query.eq("author_id", userId);
  }

  const { data, error } = await query;
  if (error || !data || data.length === 0) return { kind: "NONE" };

  const candidates = data as TaskCandidate[];
  const scored = candidates
    .map((c) => ({ c, s: scoreCandidate(reference, c) }))
    .sort((a, b) => b.s - a.s);

  const top = scored[0];
  if (!top || top.s < MIN_CONFIDENCE) return { kind: "NONE" };

  const second = scored[1];
  const gap = second ? top.s - second.s : top.s;

  // Single clear winner: top is much better than runner-up.
  if (!second || gap >= AMBIGUITY_GAP) {
    return {
      kind: "SINGLE_BEST",
      task: top.c,
      confidence: top.s,
      rank: scored.slice(0, topN).map((x) => x.c),
    };
  }

  // Close race. Decide based on caller's preference.
  if (preferTopWhenConfident && top.s > 0.7) {
    return {
      kind: "SINGLE_BEST",
      task: top.c,
      confidence: top.s,
      rank: scored.slice(0, topN).map((x) => x.c),
    };
  }

  // Surface ambiguity. Cap candidates at topN so the prompt to the user
  // stays human-readable.
  return {
    kind: "AMBIGUOUS",
    candidates: scored
      .filter((x) => x.s >= MIN_CONFIDENCE * 0.8)
      .slice(0, Math.max(2, Math.min(topN, 4)))
      .map((x) => x.c),
  };
}

// ─── Disambiguation reply matching ────────────────────────────────────

// User replies to "did you mean A or B?". This matches free-text replies
// to one of the candidates Olive surfaced. Examples we handle:
//   - "the SoHo one" / "the first one" / "the second"
//   - exact-phrase reference: "Visit apartment SoHo"
//   - "neither" / "none of those" → returns null (caller treats as cancel)
//   - "1" / "2" → ordinal pick
export type DisambiguationPick =
  | { kind: "PICKED"; task: TaskCandidate }
  | { kind: "NONE_OF_THESE" }
  | { kind: "UNCLEAR" };

const NONE_RE = /^(?:neither|none(?:\s+of\s+(?:them|those|these))?|ninguno|nessuno|ni uno|n[óo]\s+nessuno)$/i;
const ORDINAL_RE = /^(?:(\d+)(?:st|nd|rd|th)?|first|second|third|fourth|fifth|primero?|secondo|terzero|primo|seconda|terza)$/i;

const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  primero: 1, segundo: 2, tercero: 3,
  primo: 1, seconda: 2, terzo: 3,
};

export function pickDisambiguation(
  reply: string,
  candidates: TaskCandidate[],
): DisambiguationPick {
  const trimmed = reply.trim().toLowerCase().replace(/[!?¡¿.,;:]/g, "").trim();
  if (!trimmed) return { kind: "UNCLEAR" };

  if (NONE_RE.test(trimmed)) return { kind: "NONE_OF_THESE" };

  // Ordinal pick
  const ord = trimmed.match(ORDINAL_RE);
  if (ord) {
    const num = ord[1] ? parseInt(ord[1], 10) : ORDINAL_WORDS[ord[0]];
    if (num && num >= 1 && num <= candidates.length) {
      return { kind: "PICKED", task: candidates[num - 1] };
    }
  }

  // Free-text — score reply against each candidate, take the winner if
  // it's notably better than the runner-up. The dispatch is dual-gated:
  //   - absolute floor (0.25): the reply has to have *some* overlap
  //   - relative gap (top >= 2x second, OR fixed 0.2 delta): one
  //     candidate genuinely dominates
  // The 2x-ratio path catches the "the soho one" case where one
  // distinguishing token gives top a moderate score and runner-up zero,
  // even though the absolute top is < 0.4.
  const scored = candidates
    .map((c) => ({ c, s: scoreCandidate(reply, c) }))
    .sort((a, b) => b.s - a.s);
  const top = scored[0];
  const second = scored[1];
  if (!top || top.s < 0.25) return { kind: "UNCLEAR" };
  if (!second) return { kind: "PICKED", task: top.c };
  const gap = top.s - second.s;
  const ratio = second.s > 0 ? top.s / second.s : Infinity;
  if (gap >= 0.2 || ratio >= 2) {
    return { kind: "PICKED", task: top.c };
  }
  return { kind: "UNCLEAR" };
}

// ─── Internal helpers ─────────────────────────────────────────────────

const STOPWORDS = new Set([
  // Articles / particles / common verbs
  "a", "an", "the", "to", "for", "of", "and", "or", "in", "on", "at",
  "my", "our", "your", "this", "that", "these", "those", "is", "are",
  "be", "been", "do", "does", "did", "with", "by",
  // Referential pronouns / ordinal-pointers users say in disambig
  // replies ("the soho one", "the first one"). These carry no
  // identity information — without filtering them out, "one" would
  // count as a content token and dilute the actual distinguishing
  // word's contribution to Jaccard.
  "one", "first", "second", "third", "fourth", "fifth",
  "primero", "segundo", "tercero", "primo", "seconda", "secondo", "terzo",
  // Spanish / Italian articles and connectors
  "el", "la", "los", "las", "un", "una", "y", "o", "de", "del",
  "lo", "il", "le", "uno", "e", "di", "da", "della",
]);

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  for (const tok of s.split(/[\s\-_/]+/)) {
    const clean = tok.replace(/[^\p{L}\p{N}]/gu, "");
    if (!clean || clean.length < 2) continue;
    if (STOPWORDS.has(clean)) continue;
    out.add(clean);
  }
  return out;
}

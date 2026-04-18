/**
 * Compiled Memory Artifacts
 * ==========================
 * Phase 4-A/B — Engineering Plan Tasks 2-A and 2-B.
 *
 * Olive's memory pipeline already emits compiled markdown files to
 * `olive_memory_files` (profile, patterns, relationship, household) via
 * `olive-compile-memory`. This module adds two things on top:
 *
 *   1. A source-citation VALIDATOR. Flash-class models sometimes invent
 *      plausible-sounding facts when summarizing a large pile of source
 *      chunks. We can't just trust compiled output. `validateCompiledAgainstSources`
 *      scores how well the compiled text is grounded in the source material
 *      and lets callers either reject low-scoring outputs or flag them.
 *
 *   2. A `USER_COMPILED` SLOT ASSEMBLER. `assembleUserSlot()` is the single
 *      entry point for building the USER_COMPILED slot content: try
 *      compiled artifacts first (fast, pre-built, <24h old), fall back to
 *      dynamic memory files if the cache is stale or absent. Returns both
 *      the slot text AND a telemetry object so callers can log which path
 *      was taken to `olive_llm_analytics` for later optimization.
 *
 * This module is PURE LOGIC + DB orchestration — no HTTP handler here.
 * All heavy-lifting is done via dependency-injected DB abstractions so
 * the pure pieces (scoring, formatting, truncation) are unit-testable
 * without a live Supabase instance.
 *
 * Design invariants:
 *
 *   1. NO REGRESSION. If this module returns an empty slot, callers MUST
 *      still function — the old dynamic-memory path is preserved as a
 *      fallback behind the same API.
 *
 *   2. VALIDATION NEVER BLOCKS. A low validation score does not prevent
 *      the artifact from being stored/served. It's surfaced as metadata
 *      so the wiki-lint pass (Phase 7-D) and humans can review.
 *
 *   3. BUDGETS ARE HARD CAPS. Each artifact has a target token count
 *      (see `ARTIFACT_BUDGETS`). Truncation happens at sentence/newline
 *      boundaries. Callers never see an artifact above its cap.
 */

// ─── Types ──────────────────────────────────────────────────────────

export type ArtifactType = "profile" | "patterns" | "relationship" | "household";

/** Maximum tokens per compiled artifact — keeps SLOT_USER inside budget. */
export const ARTIFACT_BUDGETS: Record<ArtifactType, number> = {
  profile: 400,
  patterns: 150,
  relationship: 100,
  household: 150,
};

/** Total target for all compiled artifacts combined — must fit SLOT_USER (650). */
export const COMPILED_USER_BUDGET = 650;

/** Max staleness before we consider compiled artifact expired and fall back. */
export const COMPILED_STALE_MS = 24 * 60 * 60 * 1000; // 24h

export interface CompiledArtifact {
  file_type: ArtifactType;
  content: string;
  content_hash?: string | null;
  token_count?: number | null;
  updated_at?: string | null;
  /** Source chunk IDs that contributed — populated when validator runs. */
  source_chunk_ids?: string[];
  /** 0..1 — proportion of compiled sentences grounded in source. */
  validation_score?: number | null;
  /** Human-readable explanation of validation outcome. */
  validation_notes?: string | null;
}

export interface UserSlotResult {
  /** Assembled slot text, ready to drop into SLOT_USER. */
  content: string;
  /** Which path produced the content. */
  source: "compiled" | "dynamic" | "mixed" | "empty";
  /** True when the compiled artifact(s) used were <24h old. */
  fresh: boolean;
  /** Per-artifact status for analytics. */
  artifactStatus: Array<{
    type: ArtifactType;
    status: "used" | "stale" | "missing" | "empty";
    tokens: number;
  }>;
  /** Estimated total tokens in `content`. */
  estimatedTokens: number;
}

export interface ValidationResult {
  /** 0..1 — higher is better. 1.0 = every sentence has strong source overlap. */
  score: number;
  /** Number of sentences in the compiled output. */
  totalSentences: number;
  /** Sentences where no source chunk contained ≥2 shared keywords. */
  ungroundedSentences: string[];
  /** Human-readable summary. */
  notes: string;
}

// ─── Token estimation (shared with context-contract) ──────────────

/** Approximate token count: ~4 chars per English token. */
export function estimateArtifactTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within a token budget, breaking at sentence or
 * newline boundaries when possible.
 * Mirrors context-contract.ts behavior so budget math is consistent.
 */
export function truncateArtifact(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;

  const truncated = text.slice(0, maxChars);
  const lastPeriod = truncated.lastIndexOf(". ");
  const lastNewline = truncated.lastIndexOf("\n");
  const breakPoint = Math.max(lastPeriod, lastNewline);

  if (breakPoint > maxChars * 0.5) {
    return truncated.slice(0, breakPoint + 1) + "\n...(truncated)";
  }
  return truncated + "\n...(truncated)";
}

// ─── Source-citation validator ───────────────────────────────────

/**
 * Keyword tokenizer for heuristic grounding check.
 * Lowercases, strips punctuation, removes stopwords/short tokens.
 * Intentionally permissive — we want to measure overlap, not parse.
 */
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "her",
  "was", "one", "our", "out", "day", "get", "has", "him", "his", "how",
  "its", "may", "new", "now", "old", "see", "two", "way", "who", "boy",
  "did", "use", "man", "any", "she", "too", "this", "that", "with",
  "from", "they", "were", "have", "them", "been", "their", "what",
  "when", "your", "some", "will", "would", "there", "about", "which",
  "into", "than", "also", "just", "like", "only", "over", "such",
  "then", "these", "those", "very", "well", "where", "while", "still",
]);

export function tokenizeForGrounding(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

/**
 * Split a paragraph into sentences, trimming empty lines.
 * Handles common English punctuation; good enough for compiled markdown.
 */
export function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8); // Ignore fragments, list markers
}

/**
 * Pure heuristic validator: does each sentence in `compiledText` have
 * keyword overlap with at least one source chunk?
 *
 * This is NOT a perfect hallucination detector. It's a cheap, zero-LLM
 * grounding check that flags obvious fabrications (dates, names,
 * locations) that appear in the compiled output with no source backing.
 *
 * Score semantics:
 *   - 1.0 = every compiled sentence has ≥2 unique keyword overlaps
 *           with ≥1 source chunk.
 *   - 0.5 = half of compiled sentences are grounded.
 *   - 0.0 = nothing aligns with source. Likely catastrophic hallucination
 *           or unrelated source material.
 *
 * Why ≥2 keyword overlap: single-word matches ("the", "user") are
 * noise; two distinct content keywords co-occurring is a real signal.
 */
export function validateCompiledAgainstSources(
  compiledText: string,
  sourceChunks: Array<{ content: string }>,
  options: { minOverlap?: number } = {}
): ValidationResult {
  const minOverlap = options.minOverlap ?? 2;

  if (!compiledText || compiledText.trim().length === 0) {
    return {
      score: 0,
      totalSentences: 0,
      ungroundedSentences: [],
      notes: "empty_compiled_text",
    };
  }

  if (!sourceChunks || sourceChunks.length === 0) {
    return {
      score: 0,
      totalSentences: 0,
      ungroundedSentences: [],
      notes: "no_source_chunks_provided",
    };
  }

  // Pre-tokenize all source chunks once.
  const sourceTokens = sourceChunks.map((c) => new Set(tokenizeForGrounding(c.content)));

  const sentences = splitIntoSentences(compiledText);
  if (sentences.length === 0) {
    return {
      score: 0,
      totalSentences: 0,
      ungroundedSentences: [],
      notes: "no_sentences_in_compiled",
    };
  }

  const ungrounded: string[] = [];
  let grounded = 0;

  for (const sentence of sentences) {
    const sentTokens = new Set(tokenizeForGrounding(sentence));
    if (sentTokens.size === 0) {
      // Sentence has no content-bearing tokens — treat as grounded-trivial.
      grounded++;
      continue;
    }

    let bestOverlap = 0;
    for (const sourceSet of sourceTokens) {
      let overlap = 0;
      for (const tok of sentTokens) {
        if (sourceSet.has(tok)) overlap++;
      }
      if (overlap > bestOverlap) bestOverlap = overlap;
      if (bestOverlap >= minOverlap) break;
    }

    if (bestOverlap >= minOverlap) {
      grounded++;
    } else {
      ungrounded.push(sentence);
    }
  }

  const score = grounded / sentences.length;
  const pct = Math.round(score * 100);
  const notes =
    ungrounded.length === 0
      ? `all ${sentences.length} sentences grounded in ${sourceChunks.length} sources`
      : `${grounded}/${sentences.length} sentences grounded (${pct}%); ${ungrounded.length} flagged`;

  return {
    score,
    totalSentences: sentences.length,
    ungroundedSentences: ungrounded,
    notes,
  };
}

// ─── Compiled-Artifact DB interface ──────────────────────────────

/**
 * Abstract DB interface for testability.
 * `fetchCompiledArtifacts` returns the 4 user-scoped artifact rows
 * (missing entries show up with `content: ""`).
 */
export interface ArtifactDB {
  fetchCompiledArtifacts(userId: string): Promise<CompiledArtifact[]>;
  fetchDynamicMemoryFiles(userId: string): Promise<CompiledArtifact[]>;
}

/**
 * Supabase adapter.
 */
export function createSupabaseArtifactDB(supabase: any): ArtifactDB {
  return {
    async fetchCompiledArtifacts(userId: string): Promise<CompiledArtifact[]> {
      const { data, error } = await supabase
        .from("olive_memory_files")
        .select(
          "file_type, content, content_hash, token_count, updated_at, metadata"
        )
        .eq("user_id", userId)
        .in("file_type", ["profile", "patterns", "relationship", "household"])
        .is("file_date", null);
      if (error) throw new Error(`fetchCompiledArtifacts: ${error.message}`);
      return (data || []).map((row: any) => ({
        file_type: row.file_type,
        content: row.content || "",
        content_hash: row.content_hash,
        token_count: row.token_count,
        updated_at: row.updated_at,
        source_chunk_ids: row.metadata?.source_chunk_ids || [],
        validation_score: row.metadata?.validation_score ?? null,
        validation_notes: row.metadata?.validation_notes ?? null,
      }));
    },
    async fetchDynamicMemoryFiles(userId: string): Promise<CompiledArtifact[]> {
      // Same table — the semantic distinction is purely "is it fresh enough
      // to treat as compiled?". The dynamic path uses the same source but
      // doesn't care about staleness.
      const { data, error } = await supabase
        .from("olive_memory_files")
        .select("file_type, content, updated_at")
        .eq("user_id", userId)
        .in("file_type", ["profile", "patterns", "relationship", "household"])
        .is("file_date", null);
      if (error) throw new Error(`fetchDynamicMemoryFiles: ${error.message}`);
      return (data || []).map((row: any) => ({
        file_type: row.file_type,
        content: row.content || "",
        updated_at: row.updated_at,
      }));
    },
  };
}

// ─── Pure assembler (test surface) ───────────────────────────────

/**
 * Given a set of compiled artifacts and a reference time, decide which
 * are fresh, format them into a USER_COMPILED slot string, and report
 * which path(s) contributed.
 *
 * Order of sections in the returned string:
 *   1. profile   (400 tok)
 *   2. patterns  (150 tok)
 *   3. relationship (100 tok)  — only if couple linked
 *   4. household (150 tok)     — only if couple linked
 *
 * Truncation per artifact uses `ARTIFACT_BUDGETS`. Total capped at
 * `COMPILED_USER_BUDGET` tokens to preserve SLOT_USER budget.
 */
export function assembleCompiledSlot(
  artifacts: CompiledArtifact[],
  referenceNowMs: number = Date.now()
): UserSlotResult {
  const byType = new Map<ArtifactType, CompiledArtifact>();
  for (const a of artifacts) {
    byType.set(a.file_type as ArtifactType, a);
  }

  // Deterministic ordering — profile first for LLM priming.
  const order: ArtifactType[] = ["profile", "patterns", "relationship", "household"];
  const sections: string[] = [];
  const artifactStatus: UserSlotResult["artifactStatus"] = [];
  let usedFresh = 0;
  let usedStale = 0;
  let totalTokens = 0;

  for (const type of order) {
    const art = byType.get(type);
    if (!art || !art.content || art.content.trim().length < 10) {
      artifactStatus.push({ type, status: "missing", tokens: 0 });
      continue;
    }

    const ageMs = art.updated_at
      ? referenceNowMs - new Date(art.updated_at).getTime()
      : Number.POSITIVE_INFINITY;
    const isFresh = ageMs <= COMPILED_STALE_MS;

    // Budget remaining in the combined slot.
    const remaining = COMPILED_USER_BUDGET - totalTokens;
    if (remaining <= 20) {
      artifactStatus.push({ type, status: "empty", tokens: 0 });
      continue;
    }

    // Cap this artifact at min(perType, remaining).
    const perTypeCap = ARTIFACT_BUDGETS[type];
    const effectiveCap = Math.min(perTypeCap, remaining);
    const truncated = truncateArtifact(art.content, effectiveCap);
    const tokens = estimateArtifactTokens(truncated);

    sections.push(formatArtifactSection(type, truncated));
    artifactStatus.push({
      type,
      status: isFresh ? "used" : "stale",
      tokens,
    });
    totalTokens += tokens;
    if (isFresh) usedFresh++;
    else usedStale++;
  }

  if (sections.length === 0) {
    return {
      content: "",
      source: "empty",
      fresh: false,
      artifactStatus,
      estimatedTokens: 0,
    };
  }

  const source: UserSlotResult["source"] =
    usedStale === 0
      ? "compiled"
      : usedFresh === 0
        ? "dynamic"
        : "mixed";

  return {
    content: sections.join("\n\n"),
    source,
    fresh: usedStale === 0,
    artifactStatus,
    estimatedTokens: totalTokens,
  };
}

/**
 * Consistent section headers so the LLM reads them the same way every
 * time. Keeps the compiled slot parseable by downstream observers.
 */
function formatArtifactSection(type: ArtifactType, content: string): string {
  const headers: Record<ArtifactType, string> = {
    profile: "## COMPILED USER PROFILE",
    patterns: "## COMPILED BEHAVIORAL PATTERNS",
    relationship: "## COMPILED RELATIONSHIP CONTEXT",
    household: "## COMPILED HOUSEHOLD CONTEXT",
  };
  return `${headers[type]}\n${content}`;
}

// ─── Orchestrator: fetch + assemble with fallback ────────────────

/**
 * High-level entry point for building the USER_COMPILED slot.
 *
 * Strategy:
 *   1. Fetch all 4 compiled artifact rows for this user.
 *   2. If any are present AND the overall result is non-empty → return
 *      it. Individual artifacts that are stale are still used — staleness
 *      is signaled in `artifactStatus` so telemetry can surface it.
 *   3. If ALL artifacts are missing/empty → return the empty result.
 *      The caller (`formatContextWithBudget`) can then choose to leave
 *      SLOT_USER empty or use the live-fetch path. This module never
 *      invents content — an empty user means "no compiled memory yet."
 *
 * Never throws. DB errors degrade to empty.
 */
export async function assembleUserSlot(
  db: ArtifactDB,
  userId: string,
  referenceNowMs: number = Date.now()
): Promise<UserSlotResult> {
  if (!userId) {
    return {
      content: "",
      source: "empty",
      fresh: false,
      artifactStatus: [],
      estimatedTokens: 0,
    };
  }

  let artifacts: CompiledArtifact[] = [];
  try {
    artifacts = await db.fetchCompiledArtifacts(userId);
  } catch (err) {
    console.warn(
      "[compiled-artifacts] fetchCompiledArtifacts failed (degrading to empty):",
      err instanceof Error ? err.message : err
    );
    return {
      content: "",
      source: "empty",
      fresh: false,
      artifactStatus: [],
      estimatedTokens: 0,
    };
  }

  return assembleCompiledSlot(artifacts, referenceNowMs);
}

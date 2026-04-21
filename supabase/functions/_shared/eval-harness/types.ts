/**
 * Eval Harness — Type Contracts
 * ==============================
 * Phase 8-A: foundational types for Olive's test-and-measurement layer.
 *
 * WHY this harness exists:
 *   Phase 4 shipped a modular prompt system behind a feature flag. To
 *   roll it out to real users we need to answer: "does the modular
 *   path produce output at least as good as legacy?" That question has
 *   two sub-questions:
 *
 *     (1) STATIC — does the pipeline assemble prompts correctly?
 *         Classifier → resolver → context-contract → slot budgets.
 *         This is pure logic, deterministic, free. Runs on every PR.
 *
 *     (2) LIVE — does the actual LLM output meet quality bars?
 *         Regex + substring checks + memory-recall tests against real
 *         Gemini. Expensive, flaky, run manually or nightly.
 *
 * This module defines the shared CASE + RESULT + REPORT shapes both
 * layers emit, so a single report file can mix static + live runs and
 * the CI gate doesn't care where a failure came from — only whether it
 * happened.
 *
 * Design invariants:
 *
 *   1. CASES ARE DATA. An EvalCase is a JSON-serializable fixture.
 *      `tools/eval-harness/fixtures/*.json` is the authorable surface.
 *      Anyone (PMs, eng, even Claude) can add a case by editing JSON.
 *
 *   2. NO HIDDEN STATE. Every case carries its own seeded context +
 *      classifier fixture. Re-running a case gives the same result
 *      (modulo live-layer LLM nondeterminism, gated by layer flag).
 *
 *   3. FAILURES ARE STRUCTURED. A case fails a specific assertion
 *      (e.g., "resolvedIntent: expected 'expense', got 'create'")
 *      rather than an opaque boolean. The reporter can group by
 *      failure type to surface systemic bugs.
 */

import type { ClassifiedIntent } from "../intent-classifier.ts";
import type { MemoryChunk } from "../memory-retrieval.ts";

// ─── Identifiers ──────────────────────────────────────────────────

/** Known personas — controls couple_id seeding + partner context. */
export type PersonaId = "solo" | "couple" | "team";

/**
 * Test-suite identifiers. Keep coarse: finer-grained grouping lives
 * in case `description` / tags. New suites require discussion + a
 * corresponding assertion set in the runner.
 */
export type SuiteId =
  | "intent-classification" // classifier → resolver dispatch correctness
  | "prompt-budget" // slot budgets under the Context Contract
  | "memory-recall" // seeded fact reaches the LLM prompt
  | "user-slot-source" // compiled vs dynamic telemetry
  | "modular-prompt-parity"; // modular path produces equivalent shape to legacy

/** Which evaluation layer this case targets. */
export type EvalLayer =
  | "static" // pure in-memory, no Gemini calls — default
  | "live"; // hits real Gemini for quality checks

// ─── Case ─────────────────────────────────────────────────────────

export interface EvalInput {
  message: string;
  userId: string;
  /** Present on "couple" / "team" personas; omitted on "solo". */
  coupleId?: string;
  /** Optional prior conversation turns fed into context. */
  conversationHistory?: Array<{ role: string; content: string }>;
}

/**
 * Any DB-sourced context the case wants to pretend exists.
 * The runner stitches these into a mock UnifiedContext so the case
 * doesn't need a live Supabase connection.
 */
export interface SeededContext {
  /** Overrides portions of UnifiedContext returned by the mock assembleFullContext. */
  profile?: string;
  memories?: Array<{ title: string; content: string; category: string; importance?: number }>;
  patterns?: Array<{ pattern_type: string; pattern_data: any; confidence: number }>;
  /** Pre-compiled memory files (profile / patterns / relationship / household). */
  compiledArtifacts?: Array<{
    file_type: "profile" | "patterns" | "relationship" | "household";
    content: string;
    updated_at?: string; // ISO
  }>;
  /** Pre-seeded memory chunks. Relevant for memory-recall suite. */
  memoryChunks?: MemoryChunk[];
  /** Tasks the pipeline can "find" when the user asks a contextual question. */
  savedNotes?: Array<{
    id: string;
    summary: string;
    category?: string;
    due_date?: string;
    completed?: boolean;
  }>;
  /** Lists owned by this user. */
  savedLists?: Array<{ id: string; name: string }>;
  /** Known entities in the user's KG (for entity-prepass tests). */
  knowledgeEntities?: Array<{
    id: string;
    name: string;
    canonical_name: string;
    entity_type: string;
    mention_count: number;
  }>;
}

export interface ClassifierFixture {
  intent: ClassifiedIntent;
  /** Rationale — human-readable; not used by the runner. */
  notes?: string;
}

/**
 * Expected outcomes. Every field is OPTIONAL — a case asserts only
 * what it cares about. The runner only fails on fields the case
 * explicitly set (open-world assumption).
 */
export interface ExpectedOutcome {
  // Resolver layer ─────────────────────────────────────────────────
  /** e.g. "chat" | "help_about_olive" | "expense" — post-alias. */
  resolvedIntent?: string;
  /** "modular" | "legacy" — which prompt path the resolver chose. */
  promptSystem?: "modular" | "legacy";
  /** Exact version string, e.g. "chat-intent-v1.0". */
  moduleVersion?: string;

  // Context Contract layer ─────────────────────────────────────────
  /** All slot tokens summed must be <= this. */
  slotBudgetUnder?: number;
  /** Slot names that MUST be populated in the assembled prompt. */
  requiredSlotsPopulated?: string[];
  /** Slot names that MUST NOT appear (e.g., HISTORY for a first-turn case). */
  slotsMustBeEmpty?: string[];

  // Memory layer ────────────────────────────────────────────────────
  /** What strategy the memory-retrieval step reported. */
  memoryRetrievalStrategy?: "semantic" | "importance_only" | "merged" | "empty";
  /** Substrings (case-insensitive) that MUST appear anywhere in the
   * assembled prompt. Used to verify seeded memory actually reaches
   * the LLM input. */
  promptMustContain?: string[];
  /** Substrings that MUST NOT appear in the assembled prompt. Used to
   * assert information isolation (partner data not leaking across
   * personas, etc.). */
  promptMustNotContain?: string[];

  // USER_COMPILED telemetry (Phase 4-B) ────────────────────────────
  userSlotSource?: "compiled" | "dynamic" | "mixed" | "empty";

  // Live layer (evaluated only when layer === 'live') ──────────────
  /** Response patterns to match when real Gemini is invoked. */
  responseShape?: {
    mustContain?: string[];
    mustNotContain?: string[];
    mustMatchRegex?: string[]; // patterns serialized as strings
  };
}

export interface EvalCase {
  /** Stable identifier — becomes part of the report. */
  id: string;
  /** Short human-readable description. */
  description: string;
  suite: SuiteId;
  persona: PersonaId;
  /** `static` (default) or `live`. Runner skips cases whose layer isn't active. */
  layer: EvalLayer;
  /** Tags for filtering (e.g., ["phase4", "regression"]). */
  tags?: string[];

  input: EvalInput;
  seededContext?: SeededContext;
  classifierFixture?: ClassifierFixture;

  expected: ExpectedOutcome;
}

// ─── Result ───────────────────────────────────────────────────────

export interface AssertionFailure {
  /** Path to the failing field, e.g. `expected.resolvedIntent`. */
  field: string;
  /** Expected value (JSON-serializable). */
  expected: unknown;
  /** Actual value produced by the run. */
  actual: unknown;
  /** Short human explanation, e.g. "classifier drift" or "budget overflow". */
  reason?: string;
}

export interface RunMetrics {
  /** Total tokens across all slots (from AssemblyResult). */
  totalTokens?: number;
  /** Per-slot token map. */
  slotTokens?: Record<string, number>;
  /** Slots dropped to fit budget. */
  droppedSlots?: string[];
  /** Slots truncated to fit their per-slot cap. */
  truncatedSlots?: string[];
  /** ms — populated on 'live' layer only. */
  latencyMs?: number;
  /** Which prompt system was used for this run. */
  promptSystem?: string;
  /** Which module version was loaded. */
  moduleVersion?: string;
  /** Which memory strategy produced results. */
  memoryRetrievalStrategy?: string;
  /** USER_COMPILED slot source. */
  userSlotSource?: string;
}

export interface EvalResult {
  caseId: string;
  suite: SuiteId;
  passed: boolean;
  failures: AssertionFailure[];
  layer: EvalLayer;
  metrics: RunMetrics;
  /** Execution time in ms (static == "how long did OUR runner take?"). */
  runtimeMs: number;
  timestamp: string; // ISO
  /** Short note appended by the runner (e.g. "skipped: wrong layer"). */
  skipReason?: string;
}

// ─── Report ───────────────────────────────────────────────────────

export interface SuiteSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface ReportSummary {
  /** Per-suite pass/fail counts. */
  bySuite: Record<SuiteId, SuiteSummary>;
  /** Per-intent average total tokens (static layer = slot-assembly tokens only). */
  avgTokensByIntent?: Record<string, number>;
  /** P50 / P95 tokens across all passing cases, by suite. */
  tokenPercentiles?: Record<
    SuiteId,
    { p50: number; p95: number; max: number }
  >;
  /** Classifier intent-match rate across intent-classification cases. */
  classifierAccuracy?: number;
  /** Memory-recall rate: fraction of memory-recall cases where the seeded
   * fact substring appeared in the assembled prompt. */
  memoryRecallRate?: number;
}

export interface EvalReport {
  /** ISO timestamp of the run. */
  ranAt: string;
  /** Layer the run targeted. */
  layer: EvalLayer;
  /** Total cases the runner saw (before layer filtering). */
  totalCases: number;
  /** Cases actually executed at this layer. */
  executedCases: number;
  /** Aggregate counts. */
  passed: number;
  failed: number;
  skipped: number;
  /** Every case's result, in input order. */
  results: EvalResult[];
  /** Aggregate metrics — populated by the reporter. */
  summary: ReportSummary;
  /** Commit sha + branch if available (so reports are diff-able across runs). */
  provenance?: {
    commitSha?: string;
    branch?: string;
    runner?: string; // e.g. "local" | "ci"
  };
}

// ─── Runner config ────────────────────────────────────────────────

export interface EvalConfig {
  /** Which layer to execute. Cases whose layer doesn't match are skipped. */
  layer: EvalLayer;
  /** Filter cases by suite(s). Empty = all. */
  suites?: SuiteId[];
  /** Filter by tag(s). Empty = all. */
  tags?: string[];
  /** Fail the run if ANY case fails (CI mode). */
  failFast?: boolean;
  /** For live layer: Gemini API key. Ignored on static. */
  geminiApiKey?: string;
}

/** Default config — safe for CI. */
export const DEFAULT_CONFIG: EvalConfig = {
  layer: "static",
  failFast: false,
};

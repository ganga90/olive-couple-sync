/**
 * Phase D-1 — types for reflection-driven prompt evolution
 * ===========================================================================
 * Shared types used by:
 *   - reflection-cluster.ts (the pure clustering function)
 *   - cluster-thresholds.ts (the pure gating logic)
 *   - olive-prompt-evolve   (the cron edge function)
 *   - ab-resolver.ts        (the request-time A/B routing helper)
 *   - olive-soul-safety     (admin endpoints: approve/reject/rollback)
 *
 * Keep these types stable — they are the contract between the data
 * gathering layer (olive_reflections) and the prompt-evolution
 * machinery. A breaking change here ripples across all six call sites.
 */

// ─── Reflection row mirror ──────────────────────────────────────────
//
// Subset of olive_reflections columns we actually consume. Matches the
// schema in 20260412100000_olive_soul_system.sql + 20260427000000_*.

export type ReflectionOutcome = "accepted" | "modified" | "rejected" | "ignored";

export interface ReflectionRow {
  id: string;
  user_id: string;
  /** olive_reflections.action_type — the action Olive took that's being reflected on. */
  action_type: string;
  outcome: ReflectionOutcome;
  /** What the user changed it to (free-text from the user). May be null. */
  user_modification: string | null;
  /** Distilled lesson from olive-soul-evolve or trigger code. May be null. */
  lesson: string | null;
  /** 0..1 — confidence that this reflection is a real signal vs noise. */
  confidence: number;
  /** JSONB blob with action-specific metadata. */
  action_detail: Record<string, unknown> | null;
  created_at: string;
}

// ─── Cluster shape ──────────────────────────────────────────────────
//
// One cluster = one (action_type, observation_window) tuple. Produced
// by reflection-cluster.ts; consumed by cluster-thresholds and the
// proposal generator.

export interface ModificationSample {
  /** What the AI's original output was (e.g. category before user fixed it). */
  from: string | null;
  /** What the user changed it to. */
  to: string | null;
  /** Distilled lesson if available. */
  lesson: string | null;
}

export interface ReflectionCluster {
  /** olive_reflections.action_type — the grouping key. */
  action_type: string;
  /** Total reflections in the cluster (across all outcomes). */
  total: number;
  /** Outcome distribution. Keys cover all ReflectionOutcome values. */
  by_outcome: Record<ReflectionOutcome, number>;
  /** (modified + rejected) / total. The "users disagreed" rate. */
  modify_reject_rate: number;
  /** Average of confidence values across the cluster. 0..1. */
  avg_confidence: number;
  /** Up to 10 sample modifications, the most informative ones. */
  modification_samples: ModificationSample[];
  /**
   * Composite score 0..1 used for ordering. Combines modify_reject_rate
   * (60%), volume (30%, log-scaled), avg_confidence (10%). Higher is
   * a stronger candidate for prompt evolution.
   */
  significance: number;
}

// ─── Threshold gate ─────────────────────────────────────────────────
//
// The "is this cluster worth proposing against?" decision. Pure logic,
// tunable via the constants in cluster-thresholds.ts.

export interface ClusterThresholds {
  /** Minimum total reflections in the cluster. */
  min_size: number;
  /** Minimum modify_reject_rate to be worth a proposal. */
  min_modify_reject_rate: number;
  /** Minimum avg_confidence (filters out low-quality reflection sources). */
  min_avg_confidence: number;
}

// ─── Mapping action_type → prompt module ────────────────────────────
//
// olive_reflections.action_type uses verbs like 'categorize_note';
// the intent registry uses keys like 'create'. This map is the bridge.
// Action_types not in this map yield no proposal (cron logs + skips).

export type PromptModuleKey =
  | "chat"
  | "contextual_ask"
  | "create"
  | "search"
  | "expense"
  | "task_action"
  | "partner_message"
  | "help_about_olive";

export const ACTION_TYPE_TO_MODULE: Record<string, PromptModuleKey> = {
  // Inbound classifier corrections (high signal — what Pro can actually fix)
  categorize_note: "create",
  partner_message: "partner_message",
  process_receipt: "expense",
  // (More mappings added as new reflection sources land)
};

// ─── Proposal shape (pre-DB write) ──────────────────────────────────
//
// What the proposal generator produces before inserting into
// olive_prompt_addendums. The DB row mirrors this plus lifecycle fields.

export interface AddendumProposal {
  prompt_module: PromptModuleKey;
  base_version: string;
  addendum_text: string;
  reasoning: string;
  reflections_observed_count: number;
  reflections_window_start: string;
  reflections_window_end: string;
  pattern_signature: string;
}

/**
 * Context Contract — Formal Token Budget System
 * ===============================================
 * Defines named slots with priority, max tokens, and enforcement.
 * Every LLM call assembles context through this contract.
 *
 * Slots are filled by priority (1 = highest). When total exceeds
 * the budget, lower-priority slots are truncated or dropped.
 *
 * v1.0 — Phase 1 foundation (Task 1-A)
 */

// ─── Types ──────────────────────────────────────────────────────

export interface ContextSlot {
  /** Unique slot name */
  name: string;
  /** 1 = must-have, 4 = nice-to-have. Lower-priority slots dropped first. */
  priority: 1 | 2 | 3 | 4;
  /** Maximum tokens this slot may consume */
  maxTokens: number;
  /** If true, assembly fails if this slot is empty */
  required: boolean;
}

export interface FilledSlot {
  name: string;
  content: string;
  tokens: number;
  truncated: boolean;
  dropped: boolean;
}

export interface AssemblyResult {
  /** Combined prompt text, slots joined with newlines */
  prompt: string;
  /** Total tokens used across all slots */
  totalTokens: number;
  /** Per-slot token breakdown (for analytics) */
  slots: FilledSlot[];
  /** Slots that exceeded their budget and were truncated */
  truncatedSlots: string[];
  /** Slots that were dropped entirely to fit budget */
  droppedSlots: string[];
  /** Whether emergency mode was used (DYNAMIC slot dropped) */
  emergency: boolean;
  /**
   * `required` slots whose content was empty at assembly time.
   * Empty-required is a policy violation for the caller, but we do not
   * throw — we surface it here so the caller can log and degrade gracefully.
   */
  missingRequired: string[];
  /**
   * Whether any non-required slot was dropped (priority 2, 3, or 4).
   * Broader signal than `emergency`, which only flags DYNAMIC loss.
   */
  degraded: boolean;
}

export interface SlotTokenLog {
  [slotName: string]: number;
}

// ─── Default Contract ───────────────────────────────────────────

/**
 * Standard context budget: ~2,850 tokens.
 * Emergency budget (drop DYNAMIC): ~2,050 tokens.
 */
export const STANDARD_CONTRACT: ContextSlot[] = [
  { name: "IDENTITY",       priority: 1, maxTokens: 200,  required: true },
  { name: "QUERY",           priority: 1, maxTokens: 400,  required: true },
  { name: "USER_COMPILED",   priority: 2, maxTokens: 650,  required: false },
  { name: "INTENT_MODULE",   priority: 2, maxTokens: 250,  required: false },
  { name: "TOOLS",           priority: 2, maxTokens: 300,  required: false },
  { name: "DYNAMIC",         priority: 3, maxTokens: 800,  required: false },
  { name: "HISTORY",         priority: 4, maxTokens: 600,  required: false },
];

export const STANDARD_BUDGET = 3200;
export const EMERGENCY_BUDGET = 2050;

// ─── Token Estimation ───────────────────────────────────────────

/** Rough token count: ~4 chars per token for English text */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Truncate text to fit within a token budget, breaking at sentence boundaries */
function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;

  // Try to break at a sentence boundary
  const truncated = text.slice(0, maxChars);
  const lastPeriod = truncated.lastIndexOf(". ");
  const lastNewline = truncated.lastIndexOf("\n");
  const breakPoint = Math.max(lastPeriod, lastNewline);

  if (breakPoint > maxChars * 0.5) {
    return truncated.slice(0, breakPoint + 1) + "\n...(truncated)";
  }
  return truncated + "\n...(truncated)";
}

// ─── Assembly Engine ────────────────────────────────────────────

/**
 * Assemble context from slot contents according to the contract.
 *
 * Algorithm:
 * 1. Fill each slot, truncating to its maxTokens
 * 2. Sum all slots — if under budget, done
 * 3. If over budget, drop slots from lowest priority up until under budget
 * 4. Log overages and drops
 *
 * @param slotContents - Map of slot name → raw content string
 * @param contract - Slot definitions (defaults to STANDARD_CONTRACT)
 * @param budget - Total token budget (defaults to STANDARD_BUDGET)
 */
export function assembleContext(
  slotContents: Record<string, string>,
  contract: ContextSlot[] = STANDARD_CONTRACT,
  budget: number = STANDARD_BUDGET,
): AssemblyResult {
  // Step 1: Fill slots, truncating each to its max
  const filled: FilledSlot[] = contract.map((slot) => {
    const raw = slotContents[slot.name] || "";
    if (!raw) {
      return { name: slot.name, content: "", tokens: 0, truncated: false, dropped: false };
    }

    const rawTokens = estimateTokens(raw);
    if (rawTokens <= slot.maxTokens) {
      return { name: slot.name, content: raw, tokens: rawTokens, truncated: false, dropped: false };
    }

    // Truncate
    const truncated = truncateToTokens(raw, slot.maxTokens);
    return {
      name: slot.name,
      content: truncated,
      tokens: estimateTokens(truncated),
      truncated: true,
      dropped: false,
    };
  });

  // Step 2: Check total
  let totalTokens = filled.reduce((sum, s) => sum + s.tokens, 0);

  // Step 3: If over budget, drop lowest-priority slots first
  if (totalTokens > budget) {
    // Sort by priority descending (drop priority 4 before 3, etc.)
    const droppable = filled
      .filter((s) => s.tokens > 0 && !contract.find((c) => c.name === s.name)?.required)
      .sort((a, b) => {
        const prioA = contract.find((c) => c.name === a.name)?.priority || 4;
        const prioB = contract.find((c) => c.name === b.name)?.priority || 4;
        return prioB - prioA; // Higher priority number = drop first
      });

    for (const slot of droppable) {
      if (totalTokens <= budget) break;
      totalTokens -= slot.tokens;
      slot.tokens = 0;
      slot.content = "";
      slot.dropped = true;
    }
  }

  // Step 4: Build result
  const truncatedSlots = filled.filter((s) => s.truncated).map((s) => s.name);
  const droppedSlots = filled.filter((s) => s.dropped).map((s) => s.name);
  const emergency = droppedSlots.includes("DYNAMIC");
  const degraded = droppedSlots.length > 0;

  // Required-but-empty detection (policy violation — log, don't throw)
  const missingRequired = contract
    .filter((c) => c.required)
    .filter((c) => {
      const slot = filled.find((s) => s.name === c.name);
      return !slot || slot.content.length === 0;
    })
    .map((c) => c.name);

  // Log warnings
  if (missingRequired.length > 0) {
    console.warn(
      `[ContextContract] Required slots empty: ${missingRequired.join(", ")}. ` +
        `Caller must always populate required slots.`
    );
  }
  if (truncatedSlots.length > 0) {
    console.warn(`[ContextContract] Truncated slots: ${truncatedSlots.join(", ")}`);
  }
  if (droppedSlots.length > 0) {
    console.warn(`[ContextContract] Dropped slots to fit budget: ${droppedSlots.join(", ")}`);
  }

  // Combine non-empty slots in contract order
  const prompt = filled
    .filter((s) => s.content.length > 0)
    .map((s) => s.content)
    .join("\n\n");

  return {
    prompt,
    totalTokens,
    slots: filled,
    truncatedSlots,
    droppedSlots,
    emergency,
    degraded,
    missingRequired,
  };
}

/**
 * Extract slot token map for analytics logging.
 * Returns { IDENTITY: 180, QUERY: 50, USER_COMPILED: 620, ... }
 */
export function getSlotTokenLog(result: AssemblyResult): SlotTokenLog {
  const log: SlotTokenLog = {};
  for (const slot of result.slots) {
    log[slot.name] = slot.tokens;
  }
  return log;
}

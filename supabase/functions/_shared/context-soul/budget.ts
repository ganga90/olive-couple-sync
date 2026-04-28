/**
 * Context Soul — token budget utilities
 * =======================================
 * Simple, deterministic, no I/O. Planners use these to stay inside
 * `params.budgetTokens` without each one rolling its own approximation.
 *
 * Token estimation matches the heuristic used elsewhere in this repo
 * (`_shared/soul.ts:estimateTokens`): 1 token ≈ 4 chars for English.
 * Good enough for budgeting; the LLM SDK has the precise count if we
 * ever need it.
 */

/** Default budget for a Layer 4 assembly. Tuned to fit comfortably in
 * the orchestrator's `SLOT_DYNAMIC` (800 tokens reserved per the
 * existing ContextContract) without crowding the slot. Callers can
 * override via `params.budgetTokens`. */
export const DEFAULT_CONTEXT_SOUL_BUDGET = 800;

export function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 4);
}

/**
 * Clamp `text` to at most `maxTokens`. If the text overflows, cut at
 * the last char boundary that fits and append a clear "[truncated]"
 * marker so the LLM (and humans reading logs) know there's more.
 *
 * Preserves the FIRST `maxTokens` worth — front-loaded data is more
 * relevant for the LLM, and most planners arrange their output that
 * way (highest-value section first).
 */
export function clampToBudget(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  // Reserve space for the truncation marker so we don't blow the budget
  // by appending it.
  const marker = "\n... [truncated]";
  const cutTo = Math.max(0, maxChars - marker.length);
  return text.substring(0, cutTo) + marker;
}

/**
 * Convenience: build a section block, estimate tokens, and clamp if
 * needed. Returns the assembled string and the token count actually
 * used.
 */
export function buildBudgetedSection(
  title: string,
  body: string,
  maxTokens: number,
): { text: string; tokens: number } {
  const full = title ? `## ${title}\n${body}` : body;
  const clamped = clampToBudget(full, maxTokens);
  return { text: clamped, tokens: estimateTokens(clamped) };
}

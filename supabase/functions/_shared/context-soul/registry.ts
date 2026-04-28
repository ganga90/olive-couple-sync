/**
 * Context Soul — planner registry
 * =================================
 * Module-scoped Map<intent, planner>. Real planners register themselves
 * via side-effect imports in `index.ts` (`import './planners/expense.ts'`).
 * That keeps the registry pluggable: dropping a new planner file in
 * `planners/` and adding the side-effect import is the entire wiring.
 *
 * The registry is intentionally simple — no DI, no hot-reload, no
 * priority ordering. Planners cover disjoint intents; the dispatcher
 * just looks up the intent string.
 */

import type { ContextSoulIntent, ContextSoulPlanner } from "./types.ts";

const planners: Map<ContextSoulIntent, ContextSoulPlanner> = new Map();

/**
 * Register a planner for an intent. Last-write-wins so test fixtures
 * can override real planners; production code MUST register exactly
 * once at module init.
 */
export function registerPlanner(
  intent: ContextSoulIntent,
  planner: ContextSoulPlanner,
): void {
  planners.set(intent, planner);
}

/** Look up the planner for an intent. Returns null if none registered. */
export function getPlanner(
  intent: ContextSoulIntent,
): ContextSoulPlanner | null {
  return planners.get(intent) ?? null;
}

/** All registered intents — useful for diagnostics + tests. */
export function listIntents(): ContextSoulIntent[] {
  return Array.from(planners.keys());
}

/**
 * Test-only: clear the registry. Production code must NEVER call this.
 * Marked with a leading underscore so usage stands out in code review.
 */
export function _clearRegistryForTesting(): void {
  planners.clear();
}

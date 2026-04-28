/**
 * Context Soul — DEFAULT planner (no-op fallback)
 * =================================================
 * Returns an empty context block. Used when:
 *   - The caller passes an unmapped intent
 *   - Real planners haven't been imported yet
 *   - A test scenario explicitly wants the no-op path
 *
 * Why a planner instead of just returning `null` from `getPlanner`?
 * Symmetry: every code path through the dispatcher ends in a planner
 * call, which means consistent observability (sectionsLoaded carries
 * the breadcrumb) and consistent token accounting (always returns a
 * `tokensUsed`).
 *
 * `fellBackToDefault` is set to true so callers can distinguish "no
 * matched planner, no enrichment" from "planner ran but had nothing
 * to add".
 */

import { registerPlanner } from "../registry.ts";

registerPlanner("DEFAULT", async (_supabase, _params) => {
  return {
    prompt: "",
    tokensUsed: 0,
    sectionsLoaded: ["default-noop"],
    fellBackToDefault: true,
  };
});

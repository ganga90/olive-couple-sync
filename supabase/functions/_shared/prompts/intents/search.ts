/**
 * Intent module: search (user is looking for a saved item).
 * Used when the classifier sees `?query`, or a natural-language question
 * that maps to lookup-in-my-stuff rather than open-ended chat.
 */

import { SYSTEM_CORE_V1 } from "./system-core.ts";
import type { PromptModule } from "./types.ts";

export const SEARCH_MODULE: PromptModule = {
  version: "search-intent-v1.0",
  intent: "search",
  system_core: SYSTEM_CORE_V1,
  intent_rules: `## SEARCH INTENT RULES

The user is looking for a saved item — a task, note, list, calendar event, or memory.

- Ground the answer in the hybrid-search results provided. Each result has a relevance score.
- Prefer results with higher scores and exact keyword matches.
- If multiple matches are possible, show the top 3-5 with brief context (category, due date, list).
- For tasks: show completion status (○ open, ✓ done) and due date.
- For calendar events: show day of week + time + location.
- If nothing matches well, say so and suggest a rephrase or a related term.
- Keep responses compact — the user wants the item, not analysis.`,
};

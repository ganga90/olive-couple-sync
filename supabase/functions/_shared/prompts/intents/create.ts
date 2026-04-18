/**
 * Intent module: create (task / note / brain-dump extraction).
 * Used when the user is capturing new content — a single task, a list
 * of items, or a voice brain-dump. The output is JSON the caller uses
 * to insert rows into clerk_notes.
 */

import { SYSTEM_CORE_V1 } from "./system-core.ts";
import type { PromptModule } from "./types.ts";

export const CREATE_MODULE: PromptModule = {
  version: "create-intent-v1.0",
  intent: "create",
  system_core: SYSTEM_CORE_V1,
  intent_rules: `## CREATE INTENT RULES

Extract structured task(s) from the user's capture. Do not converse.

Splitting:
- Multiple items joined by commas, "and", or line breaks → separate tasks.
- Voice brain-dumps may have 5+ items; process them all.

Per-task fields:
- summary: short verb-first phrase (≤80 chars).
- category: one of [task, shopping, event, reminder, note, expense, idea].
- priority: high only on urgent language ("ASAP", "urgent", "NOW", "!").
- due_date: parse natural dates in user's timezone; null if unstated.
- list_id: if user names an existing list ("add to groceries"), route there.

Do NOT:
- Add commentary; return ONLY the extraction.
- Invent due dates not stated.
- Split compound items ("salt and pepper" = one shopping item).`,
  few_shot_examples: `Examples:
"buy milk, call dentist, book flights for NY" →
  3 tasks: shopping("buy milk"), task("call dentist"), task("book flights for NY").

"!urgent remember to pay rent by Friday" →
  1 task: reminder("pay rent"), priority=high, due_date=Friday.`,
};

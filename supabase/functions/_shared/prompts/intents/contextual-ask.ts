/**
 * Intent module: contextual_ask (question about user's saved data).
 * Used when the user asks a question where the answer lives inside
 * their tasks, lists, calendar, or memories. The orchestrator provides
 * a rich SAVED_ITEMS block; this module tells the model how to use it.
 */

import { SYSTEM_CORE_V1 } from "./system-core.ts";
import type { PromptModule } from "./types.ts";

export const CONTEXTUAL_ASK_MODULE: PromptModule = {
  version: "contextual-ask-intent-v1.0",
  intent: "contextual_ask",
  system_core: SYSTEM_CORE_V1,
  intent_rules: `## CONTEXTUAL_ASK INTENT RULES

The user is asking a question about THEIR OWN saved data (tasks, lists, calendar, memories, past notes).

- Answer from the user's ACTUAL saved data provided in the context — look inside "Full details" for addresses, times, ingredients, references.
- Be specific and precise. Pull the exact fact, not a paraphrase.
- If the answer is a recommendation, choose from items in their saved lists.
- When mentioning dates, include the day of week + time if available (timezone-adjusted).
- Check upcoming calendar events for any timing/scheduling question.
- When the user uses pronouns, refer to prior conversation turns.
- If the data truly isn't there, say so clearly — don't hallucinate.
- Keep the answer short. Only include details the user asked for.`,
};

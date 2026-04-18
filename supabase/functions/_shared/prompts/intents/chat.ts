/**
 * Intent module: chat (general assistant).
 * The "default" catch-all for open-ended questions, drafting, planning,
 * advice. Used when the classifier returns CHAT or no other intent matches.
 */

import { SYSTEM_CORE_V1 } from "./system-core.ts";
import type { PromptModule } from "./types.ts";

export const CHAT_MODULE: PromptModule = {
  version: "chat-intent-v1.0",
  intent: "chat",
  system_core: SYSTEM_CORE_V1,
  intent_rules: `## CHAT INTENT RULES

You're in open conversation mode. The user wants drafting, planning, advice, brainstorming, or an open-ended answer.

- Deliver the FULL output (email body, itinerary, bulleted plan) — never a summary of what you'd produce.
- Personalize using the user's saved tasks, preferences, partner info, and recent context.
- For emails: **Subject:** line, greeting, body, sign-off.
- For plans: clear headings + numbered steps.
- For advice: give your honest recommendation with one line of reasoning.
- After producing substantial content, add a brief "Want me to save this?" or "Want to refine?" offer.
- If a task, date, or decision emerges in your reply, mention you can capture it.`,
};

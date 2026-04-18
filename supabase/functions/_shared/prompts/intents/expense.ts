/**
 * Intent module: expense (user is logging a receipt or an amount).
 * Triggered by `$N description`, photos of receipts, or natural-language
 * ("spent 45 on lunch"). Output feeds the `expenses` table.
 */

import { SYSTEM_CORE_V1 } from "./system-core.ts";
import type { PromptModule } from "./types.ts";

export const EXPENSE_MODULE: PromptModule = {
  version: "expense-intent-v1.0",
  intent: "expense",
  system_core: SYSTEM_CORE_V1,
  intent_rules: `## EXPENSE INTENT RULES

Extract a single expense from the user's message (text OR receipt image).

Required fields:
- amount: numeric, in the user's local currency. Strip currency symbols.
- currency: ISO code (USD, EUR, GBP, etc.); default to user's profile currency if unstated.
- category: one of [food, transport, shopping, entertainment, bills, health, travel, other]. Match to the most specific.
- vendor: merchant name if identifiable; null otherwise.
- description: 1-line summary (≤60 chars). Prefer concrete over generic: "Panera lunch" beats "lunch".
- occurred_at: ISO date; default to today in user's timezone if unstated.

Do NOT:
- Do not invent vendor, category, or date — leave null if unclear.
- Do not add conversational replies; return ONLY the structured extraction.`,
  few_shot_examples: `Examples:
"$45 lunch at Panera" → amount:45, category:food, vendor:"Panera", description:"lunch at Panera".
"spent 18 euros on a taxi home last night" → amount:18, currency:EUR, category:transport, description:"taxi home", occurred_at:yesterday.
"87.50 target" → amount:87.50, category:shopping, vendor:"Target", description:"Target".`,
};

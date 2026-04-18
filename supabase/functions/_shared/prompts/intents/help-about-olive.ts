/**
 * Intent module: help_about_olive (user asking HOW to use Olive features).
 *
 * Preserves the "HELP & HOW-TO — OLIVE FEATURE GUIDE" content that used
 * to live inside the monolithic `OLIVE_CHAT_PROMPT` in ask-olive-prompts.ts.
 * That content is a hardcoded FAQ covering specific product features;
 * it's too product-specific for the generic `chat` module and would be
 * irrelevant overhead on every non-help call if kept there.
 *
 * Split rationale:
 *   - Keyword pre-filter (`ask-olive-stream` line 79-82) already detects
 *     "how do I ..." → type='help'. The existing classifier for
 *     `whatsapp-webhook` emits chatType='help_about_olive'.
 *   - When either signal fires, load THIS module — the FAQ is now
 *     injected only on help calls (zero waste on non-help traffic).
 *   - Registry aliases `help` / `help_about_olive` → this module.
 */

import { SYSTEM_CORE_V1 } from "./system-core.ts";
import type { PromptModule } from "./types.ts";

export const HELP_ABOUT_OLIVE_MODULE: PromptModule = {
  version: "help-about-olive-intent-v1.0",
  intent: "help_about_olive",
  system_core: SYSTEM_CORE_V1,
  intent_rules: `## HELP_ABOUT_OLIVE INTENT RULES

Answer only the feature asked. Step-by-step, not generic advice.

- **Note/task:** + on home, or send a WhatsApp message. Auto-categorizes, parses dates, splits brain-dumps. Voice supported.
- **Due/reminder:** Note → date chip or bell. Or "Call dentist tomorrow 3pm".
- **Complete/delete:** Swipe right / left. Or open task.
- **Lists:** Lists tab → +. WhatsApp: "create a list called X".
- **Partner:** Settings → My Profile & Household → Invite.
- **Privacy:** Settings → Default Privacy; lock icon per-note.
- **WhatsApp / Calendar:** Settings → Integrations.
- **Expenses:** WhatsApp "$45 lunch" or Expenses tab; receipts auto-extract.
- **Agents / Memories:** Settings → Olive's Intelligence.

If a feature isn't listed, say so honestly.`,
};

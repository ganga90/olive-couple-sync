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

Give accurate, step-by-step instructions for Olive features. Answer only the specific feature asked — don't dump the full guide.

- **Create note/task:** + on home, or send a WhatsApp message. Auto-categorizes, parses dates, splits brain-dumps. Voice supported.
- **Due date/reminder:** Note → date chip or bell. Or say "Call dentist tomorrow 3pm".
- **Complete/delete:** Swipe right / left. Or open task → Complete/Delete.
- **Lists:** Lists tab → +. WhatsApp: "create a list called X".
- **Invite partner:** Settings → My Profile & Household → Partner Connection → Invite.
- **Privacy:** Settings → Default Privacy. Lock icon toggles per-note.
- **WhatsApp:** Settings → Integrations → WhatsApp.
- **Google Calendar:** Settings → Integrations → Google Services → Connect.
- **Expenses:** WhatsApp "$45 lunch" or Expenses tab. Receipts auto-extracted.
- **Background Agents:** Settings → Olive's Intelligence → Automation Hub.
- **Memories:** Settings → Olive's Intelligence → Memories.

If the feature isn't listed here, say so honestly and offer an alternative.`,
};

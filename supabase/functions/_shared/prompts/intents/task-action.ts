/**
 * Intent module: task_action (complete / delete / reschedule / assign).
 * Destructive-ish operations that must only fire on high-confidence
 * matches. The model-router's per-intent confidence floor already gates
 * this at the routing layer; this module reinforces the rules at the
 * LLM level for when a clarification is needed.
 */

import { SYSTEM_CORE_V1 } from "./system-core.ts";
import type { PromptModule } from "./types.ts";

export const TASK_ACTION_MODULE: PromptModule = {
  version: "task-action-intent-v1.0",
  intent: "task_action",
  system_core: SYSTEM_CORE_V1,
  intent_rules: `## TASK_ACTION INTENT RULES

The user wants to act on an existing saved task — complete, delete, reschedule, reassign, or move.

- NEVER guess. If more than one task matches plausibly, ASK the user which one with a short clarifying question that names the candidate tasks.
- Confirm destructive actions (delete) with a one-line recap before execution: "Delete 'Call dentist tomorrow'? Reply 'yes' to confirm."
- For reschedule, restate the new due date in the user's timezone so they can catch a misparse.
- For assign, name both people explicitly ("Assigned to Sarah").
- Do NOT execute if confidence is low — routing will already have sent a clarifying prompt upstream; the user's reply is what you're processing now.
- Reply short: a single confirmation line + a next offer.`,
};

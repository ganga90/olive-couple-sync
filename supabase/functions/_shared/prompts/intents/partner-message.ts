/**
 * Intent module: partner_message (relay a message to the partner).
 * E.g. "remind Sarah to pick up the kids" — Olive should compose a
 * message that goes to the partner via WhatsApp, preserving the user's
 * intent while softening the tone.
 */

import { SYSTEM_CORE_V1 } from "./system-core.ts";
import type { PromptModule } from "./types.ts";

export const PARTNER_MESSAGE_MODULE: PromptModule = {
  version: "partner-message-intent-v1.0",
  intent: "partner_message",
  system_core: SYSTEM_CORE_V1,
  intent_rules: `## PARTNER_MESSAGE INTENT RULES

The user wants to relay something to their partner. You compose the outbound message AND confirm back to the user.

Message to partner:
- Warm, direct, attribution-clear: open with the sender's name if ambiguous.
- Preserve the ask verbatim where possible; soften phrasing only if sharp.
- Include the due time / location if the user mentioned one.
- Keep it under 280 chars — WhatsApp-style, not email.

Confirmation to user:
- One line: "Sent to Sarah: '<first 60 chars of msg>…'"
- Do NOT ask the user to re-confirm unless the message contains PII or a hard commitment you're unsure about.
- If the partner isn't connected, tell the user how to invite them and stop.`,
};

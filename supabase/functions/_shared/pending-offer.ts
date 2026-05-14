// Pending Offer — the structured Capture → Offer → Confirm → Execute state.
//
// When Olive proposes an action ("Want me to save this?") and waits for the user's
// next reply, we freeze the proposal here. The frozen artifact is immune to any
// intermediate CHAT turn that would otherwise overwrite `last_assistant_*`, and
// short multilingual confirmations ("yes", "sì", "do it") can be resolved back to
// the original proposed artifact unambiguously.
//
// Discriminated by `type`. New variants plug in without a schema migration —
// they all live in user_sessions.context_data.pending_action.

import type { ConflictSummary } from "./conflict-detector.ts";
import type { MatchedPattern } from "./pattern-detector.ts";

export const PENDING_OFFER_TTL_MS = 10 * 60 * 1000;

// Original save-artifact offer (web search / contextual ask / chat).
export interface SaveArtifactOffer {
  type: 'save_artifact';
  artifact_content: string;
  artifact_request: string;
  artifact_kind: 'web_search' | 'contextual_ask' | 'chat';
  offered_at: string;
}

// Reschedule offer — set_due / remind. Carries the resolved target and the
// new datetime so confirmation is deterministic (no re-parsing of "Thursday
// at 6pm" against a possibly-shifted current time).
export interface RescheduleTaskOffer {
  type: 'reschedule_task';
  task_id: string;
  task_summary: string;
  field: 'due_date' | 'reminder_time';
  new_iso: string;            // full ISO timestamp to write
  has_time: boolean;          // false → store as date-only + treat as all-day on calendar
  prior_due_date: string | null;
  prior_reminder_time: string | null;
  readable: string;           // human-friendly phrase for confirmation copy
  timezone: string;
  // Phase 3.1 — calendar conflicts detected at offer time. Up to N entries
  // (typically 3-5). Empty array = no conflicts. Absent = conflict
  // detection wasn't run (older offers, or user has no calendar
  // connection). Surfaced in the offer line so the user sees the
  // conflict before confirming.
  conflicts?: ConflictSummary[];
  // Phase 3.5 — strong user patterns matching the proposed action.
  // Empty array = no strong match. Absent = pattern lookup wasn't
  // run. At most one entry by current planner convention (one hint
  // per offer); array shape keeps room for future multi-pattern
  // surfacing without a contract break.
  pattern_hints?: MatchedPattern[];
  offered_at: string;
}

// Generic edit offer — title / location / description / duration. Used by
// Phase 1's update_title intent; calendar mutation follows by patch.
export interface EditTaskOffer {
  type: 'edit_task';
  task_id: string;
  task_summary: string;            // current summary (used as label in copy)
  changes: {
    new_title?: string;
    new_location?: string;
    new_description?: string;
    new_duration_minutes?: number;
  };
  prior: {
    summary: string;
    description: string | null;
  };
  // Phase 3.1 — only meaningful for `new_duration_minutes` edits where
  // the event window changes. Title/location/description don't affect
  // scheduling so conflict detection is skipped for those.
  conflicts?: ConflictSummary[];
  offered_at: string;
}

// Delete offer — destructive, always confirmed even when classifier is
// confident, to keep parity with the WhatsApp confirmation discipline.
export interface DeleteTaskOffer {
  type: 'delete_task';
  task_id: string;
  task_summary: string;
  prior_due_date: string | null;
  prior_reminder_time: string | null;
  offered_at: string;
}

// Disambiguation offer — surfaced when ≥2 tasks match the user's reference.
// Candidates are pre-resolved so the next-turn reply ("the SoHo one")
// resolves against the same shortlist Olive showed.
export interface DisambiguationOffer {
  type: 'disambiguate';
  // The intent we'll execute once disambiguated.
  pending_intent:
    | { kind: 'reschedule_task'; new_iso: string; has_time: boolean; readable: string; timezone: string }
    | { kind: 'delete_task' }
    | { kind: 'edit_task'; changes: EditTaskOffer['changes'] };
  candidates: Array<{
    task_id: string;
    summary: string;
    due_date: string | null;
    reminder_time: string | null;
  }>;
  original_message: string;
  offered_at: string;
}

// Phase 3.2 — bulk reschedule by weekday. The user says "move all my
// Tuesday tasks to Thursday" and Olive surfaces a preview of every
// affected task BEFORE confirming. Per-candidate prior state is
// captured here so bulk undo can reverse each one to its original
// schedule.
export interface BulkRescheduleCandidate {
  task_id: string;
  task_summary: string;
  prior_due_date: string | null;
  prior_reminder_time: string | null;
  // Pre-computed new ISO (date portion shifted, time-of-day preserved
  // in user's tz). Stored at offer time so confirmation is
  // deterministic — no re-parsing or re-shifting against a shifted
  // clock between offer and confirm.
  new_iso: string;
  // The new write-target column. Mirrors RescheduleTaskOffer.field.
  field: 'due_date' | 'reminder_time';
  // Whether the original schedule had a time-of-day (we preserve
  // that distinction across the shift — all-day Tuesday becomes
  // all-day Thursday).
  has_time: boolean;
}

export interface BulkRescheduleOffer {
  type: 'bulk_reschedule_weekday';
  from_dow: number; // Sun=0..Sat=6
  to_dow: number;
  timezone: string;
  candidates: BulkRescheduleCandidate[];
  // The original message that triggered this — handy for the
  // confirmation prompt's context and for telemetry.
  original_message: string;
  offered_at: string;
}

// Topical-follow-up attach offer — Change 3 of the brain-dump-organization
// programme. When Olive silently attaches a sub-detail ("Email: foo@bar.com")
// to a recent parent note ("Hard Rock Stadium examples") because the user
// just typed "Email for Hard Rock\nfoo@bar.com", this variant records the
// state needed to UNDO that attach within the 10-min TTL. The action is
// taken eagerly (per Olive's "she just does it" brand), the offer here is
// the REVERSAL path the user gets if they reply "undo" / "no" / "split".
//
// Stored at the moment of attach. Two writes happen in the same turn:
//   1. clerk_notes.items is updated for parent_note_id with prior_items
//      → next_items (next_items = [...prior_items, addition]).
//   2. user_sessions.context_data.pending_offer = this row.
//
// On a follow-up "undo" reply within PENDING_OFFER_TTL_MS:
//   - clerk_notes.items is reverted to prior_items.
//   - A new standalone note is created from original_message.
//   - The pending_offer is cleared.
export interface AttachedToParentOffer {
  type: 'attached_to_parent';
  /** The note we wrote the new field onto. */
  parent_note_id: string;
  parent_summary: string;
  /** The full items[] array before the attach — captured for reversal. */
  prior_items: string[];
  /** The single new entry we appended, e.g. "Email: foo@bar.com". */
  addition: string;
  /** The user's original raw message — used to reconstruct a standalone
   *  note if the user undoes the attach. Without this we'd lose their
   *  value when reverting. */
  original_message: string;
  /** Detector confidence at the time of attach — useful for telemetry
   *  / threshold tuning, not consulted by the undo path itself. */
  confidence: number;
  offered_at: string;
}

// Proactive bridge — opt-in (olive_user_preferences.proactive_bridge_enabled).
// After a brain-dump CREATE saved a task with NO due_date AND NO
// reminder_time, Olive appends a single bounded offer ("🌿 Want me to set
// a date?") and waits ONE turn. If the next message parses to a date,
// she applies it. If not, the offer expires (5-min TTL) and the message
// is processed normally — no compounding nudges. This is the "Offer"
// step of the Capture → Offer → Confirm → Execute loop for the case
// where the brain dump had no temporal hint.
export interface DateForRecentTaskOffer {
  type: 'date_for_recent_task';
  /** The task we just saved that's missing a date. */
  task_id: string;
  task_summary: string;
  /** User's timezone — pinned at offer time to avoid re-resolution. */
  timezone: string;
  offered_at: string;
}

export type PendingOffer =
  | SaveArtifactOffer
  | RescheduleTaskOffer
  | EditTaskOffer
  | DeleteTaskOffer
  | DisambiguationOffer
  | BulkRescheduleOffer
  | AttachedToParentOffer
  | DateForRecentTaskOffer;

export function isPendingOfferFresh(
  offer: PendingOffer | null | undefined,
  now: number = Date.now(),
): offer is PendingOffer {
  if (!offer || !offer.offered_at) return false;
  const t = new Date(offer.offered_at).getTime();
  if (Number.isNaN(t)) return false;
  const age = now - t;
  return age >= 0 && age < PENDING_OFFER_TTL_MS;
}

// Multi-word phrases come BEFORE their single-word prefixes so JavaScript's
// leftmost-first alternation picks the longer match. Single-word atoms come last.
// Modifier group is `*` (not `?`) so messages like "yes please save it" — which
// chain head + 2 modifiers — still match.
const AFFIRM_RE = /^(?:claro que sí|sí por favor|sí gracias|sì per favore|sì grazie|por favor|of course|sounds good|do it|go ahead|go for it|save it|save that|save this|keep it|va bene|yes|yeah|yep|yup|yas|sure|ok|okay|k|alright|aight|please|pls|absolutely|definitely|sí|si|claro|vale|dale|hazlo|guárdalo|guardalo|guárdamelo|sì|certo|certamente|fallo|salvalo|salvala|dai)(?:\s+(?:por favor|que sí|que si|do it|save it|save that|save this|thank you|please|pls|grazie|thanks|guárdalo|salvalo|fallo|hazlo|sì|si|yes|yeah|sure|ok|okay|now))*$/i;

const DENY_RE = /^(?:no thanks|no thank you|no gracias|no por favor|no grazie|no per ora|never mind|nevermind|forget it|not now|not really|lascia stare|déjalo|dejalo|don't|do not|no|nope|nah|skip)(?:\s+(?:thank you|thanks|gracias|grazie|por favor|please|pls))*$/i;

export function classifyConfirmationReply(
  raw: string | null | undefined,
): 'affirm' | 'deny' | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 60) return null;
  const cleaned = trimmed
    .toLowerCase()
    .replace(/[!?¡¿.,;:"'()\[\]{}🌿🫒👍👎✅❌😊😄🙏]/g, ' ')
    .replace(/[“”‘’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  if (AFFIRM_RE.test(cleaned)) return 'affirm';
  if (DENY_RE.test(cleaned)) return 'deny';
  return null;
}

// Generic placeholder titles + the screenshot-bug pattern ("Clarification Request
// for X"). Quotes are pre-stripped by isBadTitle, so the pattern matches without
// requiring them.
const GENERIC_TITLE_RE = /^(save\s*note|saved?\s*draft|note|task|untitled|n\/a|clarification(?:\s+request)?(?:\s+for\s+.+)?)$/i;

export function isBadTitle(title: string | null | undefined): boolean {
  if (!title) return true;
  const t = title
    .trim()
    .replace(/['"“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return true;
  if (GENERIC_TITLE_RE.test(t)) return true;
  if (looksLikeConfirmation(t)) return true;
  return false;
}

// Single source of truth for "is this string fundamentally a confirmation phrase":
// reuse the same affirm regex used to detect chat replies. Title use is the same
// shape — short, mostly-affirm tokens — so one definition keeps them aligned.
export function looksLikeConfirmation(text: string | null | undefined): boolean {
  return classifyConfirmationReply(text) === 'affirm';
}

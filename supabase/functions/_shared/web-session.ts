// _shared/web-session.ts
//
// AWAITING_CONFIRMATION loop for the web Ask Olive surface. WhatsApp's
// whatsapp-webhook has had this for a year; web Ask Olive has been
// stateless turn-to-turn, which is what enabled the silent-execute
// brand-contract violation.
//
// Storage is intentionally the existing `user_sessions` table — same
// schema, same RLS, same TTL semantics. The only thing that changes is
// who writes to it. We keep WhatsApp's compatibility by:
//   - never clearing fields whatsapp-webhook hasn't seen
//   - using the same `pending_action` JSON shape for set_due/delete
//   - using a separate `pending_offer` slot for non-action offers
//     (save_artifact) — exact mirror of whatsapp-webhook
//
// What's web-specific:
//   - `last_action` slot, for the 5-minute undo window. WhatsApp doesn't
//     have undo today; when it does, this file becomes the shared home.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isPendingOfferFresh, type PendingOffer } from "./pending-offer.ts";

export type ConversationState = "IDLE" | "AWAITING_CONFIRMATION";

// Last executed action — captured so the user can say "undo" within the
// window. Discriminated for typesafe revert dispatch.
export type LastAction =
  | {
      kind: "reschedule_task";
      task_id: string;
      task_summary: string;
      prior_due_date: string | null;
      prior_reminder_time: string | null;
      new_due_date: string | null;
      new_reminder_time: string | null;
      // Was the calendar event also updated? We use this to decide whether
      // to roll back Google too.
      calendar_synced: boolean;
      executed_at: string;
    }
  | {
      kind: "delete_task";
      task_summary: string;
      // The full row we just deleted, so undo can re-insert it. We store a
      // restricted set of columns — enough to feel "undone" without
      // restoring derived fields like search vectors (those get recomputed
      // by the standard triggers on insert).
      restored_row: Record<string, unknown>;
      // Linked calendar event we just removed from Google (if any).
      google_event_id: string | null;
      executed_at: string;
    }
  | {
      kind: "edit_task";
      task_id: string;
      task_summary: string;
      prior: { summary: string; description: string | null };
      new: { summary?: string; description?: string };
      calendar_synced: boolean;
      executed_at: string;
    }
  | {
      // Phase 3.2 — bulk reschedule. Carries the per-task snapshots so
      // a single "undo" reverses every shift atomically. Storing the
      // full array is fine because bulk operations are capped by the
      // resolver (default 50 candidates); even at the cap the JSON
      // footprint is small (~5KB).
      kind: "bulk_reschedule_task";
      from_dow: number;
      to_dow: number;
      // Successful per-task outcomes — only entries we actually wrote
      // and synced. Per-task failures are recorded separately on the
      // ExecutedAction and don't need an undo entry.
      entries: Array<{
        task_id: string;
        task_summary: string;
        prior_due_date: string | null;
        prior_reminder_time: string | null;
        new_due_date: string | null;
        new_reminder_time: string | null;
        calendar_synced: boolean;
      }>;
      executed_at: string;
    };

export const UNDO_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface SessionContext {
  // WhatsApp-compatible slot for pending mutations awaiting confirmation.
  // Shape: { type, task_id, ... } where `type` ∈ schedule-event / set-due /
  // delete / etc. The actual contract is owned by the writer; readers
  // narrow on `type`.
  pending_action?: PendingOffer | null;
  // WhatsApp-compatible slot for save_artifact offers. Separate from
  // pending_action because save_artifact has different lifecycle (it's
  // proactive, not user-initiated).
  pending_offer?: PendingOffer | null;
  // Web-only — last successfully executed action, for undo.
  last_action?: LastAction | null;
  // Free-form extras (preserved on every write so other surfaces' fields
  // aren't clobbered).
  [k: string]: unknown;
}

export interface WebSession {
  id: string;
  user_id: string;
  conversation_state: ConversationState;
  context_data: SessionContext;
}

// ─── Read ─────────────────────────────────────────────────────────────

// Fetch (or lazily create) a session row for the user. Service-role
// callers only. RLS on user_sessions is permissive to authenticated users
// matching user_id, which is what the UI uses; edge functions go through
// the service key and bypass RLS by design.
export async function getOrCreateSession(
  supabase: SupabaseClient,
  userId: string,
): Promise<WebSession> {
  const { data } = await supabase
    .from("user_sessions")
    .select("id, user_id, conversation_state, context_data")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data) {
    return {
      id: data.id,
      user_id: data.user_id,
      conversation_state: (data.conversation_state as ConversationState) ?? "IDLE",
      context_data: (data.context_data as SessionContext) ?? {},
    };
  }

  const { data: created, error } = await supabase
    .from("user_sessions")
    .insert({
      user_id: userId,
      conversation_state: "IDLE",
      context_data: {},
    })
    .select("id, user_id, conversation_state, context_data")
    .single();

  if (error || !created) {
    throw new Error(`Failed to create user_session for ${userId}: ${error?.message}`);
  }
  return {
    id: created.id,
    user_id: created.user_id,
    conversation_state: "IDLE",
    context_data: {},
  };
}

// ─── Write ────────────────────────────────────────────────────────────

// Store a pending action and flip state to AWAITING_CONFIRMATION. Returns
// the updated session so callers can chain.
export async function storePendingAction(
  supabase: SupabaseClient,
  session: WebSession,
  action: PendingOffer,
): Promise<WebSession> {
  const newCtx: SessionContext = {
    ...session.context_data,
    pending_action: action,
  };
  const { error } = await supabase
    .from("user_sessions")
    .update({
      conversation_state: "AWAITING_CONFIRMATION",
      context_data: newCtx,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id);
  if (error) throw new Error(`storePendingAction: ${error.message}`);
  return { ...session, conversation_state: "AWAITING_CONFIRMATION", context_data: newCtx };
}

// Clear pending action and return to IDLE.
export async function clearPendingAction(
  supabase: SupabaseClient,
  session: WebSession,
): Promise<WebSession> {
  const newCtx: SessionContext = { ...session.context_data, pending_action: null };
  const { error } = await supabase
    .from("user_sessions")
    .update({
      conversation_state: "IDLE",
      context_data: newCtx,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id);
  if (error) throw new Error(`clearPendingAction: ${error.message}`);
  return { ...session, conversation_state: "IDLE", context_data: newCtx };
}

// Stamp the last executed action, for undo. Also clears any stale
// pending_action so we never leave the session in a half-confirmed state.
export async function stampLastAction(
  supabase: SupabaseClient,
  session: WebSession,
  action: LastAction,
): Promise<WebSession> {
  const newCtx: SessionContext = {
    ...session.context_data,
    pending_action: null,
    last_action: action,
  };
  const { error } = await supabase
    .from("user_sessions")
    .update({
      conversation_state: "IDLE",
      context_data: newCtx,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id);
  if (error) throw new Error(`stampLastAction: ${error.message}`);
  return { ...session, conversation_state: "IDLE", context_data: newCtx };
}

// Clear last_action after a successful undo so the user can't double-undo.
export async function clearLastAction(
  supabase: SupabaseClient,
  session: WebSession,
): Promise<WebSession> {
  const newCtx: SessionContext = { ...session.context_data, last_action: null };
  const { error } = await supabase
    .from("user_sessions")
    .update({
      context_data: newCtx,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id);
  if (error) throw new Error(`clearLastAction: ${error.message}`);
  return { ...session, context_data: newCtx };
}

// ─── Freshness ────────────────────────────────────────────────────────

// Last action is "undoable" only inside the 5-minute window. Callers
// check this before reversing.
export function isLastActionUndoable(
  last: LastAction | null | undefined,
  now: number = Date.now(),
): last is LastAction {
  if (!last || !last.executed_at) return false;
  const t = new Date(last.executed_at).getTime();
  if (Number.isNaN(t)) return false;
  return now - t < UNDO_TTL_MS;
}

// Re-export the pending-offer freshness check so callers don't need two
// imports. PendingOffer's TTL is 10 minutes; undo is 5. They're different
// because confirmation is "did you mean this?" and undo is "wait, no!" —
// the latter has tighter user expectation of immediacy.
export { isPendingOfferFresh };

// ─── Undo command detection ──────────────────────────────────────────

// Multilingual undo phrases. Like the AFFIRM_RE / DENY_RE patterns in
// pending-offer.ts, we keep this as a regex so the dispatch is sub-ms
// and locale-aware without an LLM round-trip. Captured phrases:
//   en: "undo", "undo that", "revert", "go back", "wait no"
//   es: "deshacer", "deshazlo", "regresa", "espera no"
//   it: "annulla", "annullalo", "torna indietro", "aspetta no"
const UNDO_RE = /^(?:undo(?:\s+that|\s+it|\s+the\s+last(?:\s+one)?)?|revert(?:\s+that|\s+it)?|go\s+back|wait[\s,]*no(?:\s+wait)?|nevermind\s+undo|deshacer(?:lo)?|deshaz(?:lo)?|deshaga(?:lo)?|reg?resa|vuelve\s+atr[áa]s|espera\s+no|annulla(?:lo|la)?|torna\s+indietro|aspetta\s+no)$/i;

export function looksLikeUndoCommand(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[!?¡¿.,;:"'()\[\]{}🌿🫒]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length > 40) return false;
  return UNDO_RE.test(cleaned);
}

// handlers/confirmation.ts — pending-offer confirmation dispatcher.
// ============================================================================
// Initiative 1.3 of OLIVE_REFACTOR_PLAN.md. Extracts the three
// "POST-CLASSIFICATION SAFETY NET" blocks (#1.4, #1.4b, #1.4c) that
// implement the Capture → Offer → Confirm → Execute loop on top of
// `pending_offer` in `user_sessions.context_data`.
//
// Three variants this dispatcher handles (out of the 8 `PendingOffer`
// types):
//   1. `save_artifact` — Olive ended the previous turn with "Want me
//      to save this?". Affirm → override intent to SAVE_ARTIFACT.
//      Deny → clear offer + acknowledge.
//   2. `date_for_recent_task` — proactive bridge after a CREATE that
//      had no due_date. Affirm with a date phrase → apply to the
//      task. Deny → clear + ack. Unmatched → clear + pass through.
//   3. `attached_to_parent` — silently-attached follow-up that the
//      user can undo. Undo reply → revert + create standalone note
//      from the original message + clear.
//
// The other five `PendingOffer` types (reschedule_task, edit_task,
// delete_task, disambiguate, bulk_reschedule_weekday) route through
// the LEGACY `AWAITING_CONFIRMATION` state machine in the webhook —
// that's a separate, larger refactor for a future task.
//
// The dispatcher returns a discriminated `ConfirmationOutcome` so the
// caller (router) can apply the right effect: send a Reply, override
// the classified intent, or pass through to normal classification.
// Side-effects (DB writes for clearing the offer or applying a date)
// happen inside the variant handlers — they are async and tested
// against a stub Supabase client.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { insertNote, type NoteSource } from "../../_shared/note-insert.ts";
import {
  classifyConfirmationReply,
  isPendingOfferFresh,
  type PendingOffer,
} from "../../_shared/pending-offer.ts";
import { revertAttach, isUndoReply } from "../../_shared/topical-followup.ts";
import { detectDateRefinement } from "../../_shared/conversation-continuity.ts";
import type {
  ConversationContext,
  HandlerContext,
  Reply,
  WhatsAppIntent,
} from "../../_shared/types.ts";

/**
 * The dispatcher's return shape. The router translates each variant
 * into the appropriate side-effect:
 *   * `pass-through` — no offer matched; continue normal intent flow.
 *   * `override-intent` — replace the classified intent with this one
 *     and continue (handler-of-record runs next).
 *   * `reply` — the offer was fully handled here; send this Reply and
 *     short-circuit further classification.
 */
export type ConfirmationOutcome =
  | { kind: 'pass-through' }
  | {
      kind: 'override-intent';
      intent: WhatsAppIntent;
      /** Forwarded into the next handler's cleanMessage slot. */
      cleanMessage?: string;
    }
  | { kind: 'reply'; reply: Reply };

/** Injected dependencies. Only `t` and the process-note invoker live
 *  in the webhook today; everything else this module needs is already
 *  in `_shared/`. Keeping the deps surface tiny means the dispatcher
 *  is trivially mockable for tests. */
export interface ConfirmationDeps {
  /** Webhook-local i18n. */
  t: (key: string, lang: string, vars?: Record<string, string>) => string;
  /**
   * Invokes the `process-note` edge function. Used by the
   * `attached_to_parent` undo path to rebuild a standalone note from
   * the original message. Injected because edge-function-to-edge-
   * function invocation is non-trivial to stub in unit tests.
   */
  invokeProcessNote: (body: Record<string, unknown>) => Promise<{
    data: unknown;
    error: unknown;
  }>;
}

/** PASS_THROUGH sentinel — referenced from variant handlers when they
 *  decide the offer isn't theirs to handle. The object is frozen so
 *  no test can accidentally mutate it. */
const PASS_THROUGH: ConfirmationOutcome = Object.freeze({ kind: 'pass-through' });

// ── Variant handler: save_artifact ────────────────────────────────────
//
// User replies to "Want me to save this?" with affirm / deny / other.
//   * affirm → override intent to SAVE_ARTIFACT; downstream handler
//     reads the same `pending_offer` and saves the artifact.
//   * deny → clear the offer + acknowledge.
//   * other (unmatched) → pass-through. The offer stays alive until
//     TTL or a new save offer overwrites it.
//
// No DB writes on the affirm path — that happens in SAVE_ARTIFACT's
// own session-clear after-reply callback.
async function handleSaveArtifactOffer(
  ctx: HandlerContext,
  offer: Extract<PendingOffer, { type: 'save_artifact' }>,
  deps: ConfirmationDeps,
): Promise<ConfirmationOutcome> {
  void offer; // type-narrowed; not yet needed beyond the discriminator
  const confirmation = classifyConfirmationReply(ctx.messageBody);
  if (confirmation === 'affirm') {
    console.log(`[Confirmation/save_artifact] affirm reply ("${(ctx.messageBody || '').substring(0, 40)}") → SAVE_ARTIFACT`);
    return {
      kind: 'override-intent',
      intent: 'SAVE_ARTIFACT',
      cleanMessage: ctx.messageBody ?? undefined,
    };
  }
  if (confirmation === 'deny') {
    console.log('[Confirmation/save_artifact] deny reply → declining offer');
    await clearPendingOffer(ctx);
    return { kind: 'reply', reply: { text: deps.t('artifact_offer_declined', ctx.userLang) } };
  }
  return PASS_THROUGH;
}

// ── Variant handler: date_for_recent_task ─────────────────────────────
//
// Proactive bridge offer after a CREATE saved a task missing a date.
// Matcher for the deny pattern is kept here verbatim from the webhook
// for back-compat (en/es/it). Date refinement detection delegates to
// the shared helper.
//
// One-shot semantics: the offer ALWAYS clears after this dispatch
// runs (apply, deny, or unmatched). The user can't re-engage with the
// same offer on a subsequent message.
const DENY_DATE_RE =
  /^\s*(no|nope|nah|skip|never\s?mind|forget\s+it|no\s+gracias|no\s+thanks|non\s+importa|lascia)\s*[.!?]?\s*$/i;

async function handleDateForRecentTaskOffer(
  ctx: HandlerContext,
  offer: Extract<PendingOffer, { type: 'date_for_recent_task' }>,
  deps: ConfirmationDeps,
): Promise<ConfirmationOutcome> {
  const tz = offer.timezone || ctx.userTimezone || 'America/New_York';
  const body = ctx.messageBody ?? '';

  // Deny path — clear + acknowledge.
  if (DENY_DATE_RE.test(body)) {
    await clearPendingOffer(ctx);
    console.log('[Confirmation/date_for_recent_task] declined');
    return { kind: 'reply', reply: { text: deps.t('proactive_date_skipped', ctx.userLang) } };
  }

  // Try to parse a date refinement out of the message.
  try {
    const parsed = detectDateRefinement(body, tz, ctx.userLang);
    if (parsed) {
      const { error: updateErr } = await ctx.supabase
        .from('clerk_notes')
        .update({
          due_date: parsed.parsedDateIso,
          updated_at: new Date().toISOString(),
        })
        .eq('id', offer.task_id);
      if (updateErr) {
        console.warn('[Confirmation/date_for_recent_task] due_date update failed:', updateErr);
      }
      await clearPendingOffer(ctx);
      console.log(
        '[Confirmation/date_for_recent_task] applied',
        parsed.parsedReadable,
        'to',
        offer.task_id,
      );
      return {
        kind: 'reply',
        reply: {
          text: deps.t('proactive_date_applied', ctx.userLang, {
            task: offer.task_summary,
            when: parsed.parsedReadable,
          }),
        },
      };
    }
  } catch (parseErr) {
    console.warn(
      '[Confirmation/date_for_recent_task] parse/apply failed (non-fatal):',
      parseErr instanceof Error ? parseErr.message : parseErr,
    );
  }

  // Anything else — one-shot offer expires. Pass through to normal
  // classification so the user's actual message is still handled.
  await clearPendingOffer(ctx);
  console.log('[Confirmation/date_for_recent_task] no match — offer cleared, passing through');
  return PASS_THROUGH;
}

// ── Variant handler: attached_to_parent ───────────────────────────────
//
// Heaviest of the three. On `isUndoReply`:
//   1. Restore the parent note's items[] to the pre-attach snapshot.
//   2. Re-process the original message through `process-note` so the
//      standalone note gets a clean AI-derived summary, category, tags.
//   3. Clear the offer so a second "undo" can't double-fire.
//
// If the revert fails, the attach stays — better than a half-undone
// state. If the standalone creation fails after a successful revert,
// the user gets a plain message telling them to resend.
async function handleAttachedToParentOffer(
  ctx: HandlerContext,
  offer: Extract<PendingOffer, { type: 'attached_to_parent' }>,
  deps: ConfirmationDeps,
): Promise<ConfirmationOutcome> {
  if (!ctx.messageBody || !isUndoReply(ctx.messageBody)) {
    return PASS_THROUGH;
  }
  console.log(
    `[Confirmation/attached_to_parent] undo reply ("${ctx.messageBody.substring(0, 40)}") → reverting`,
  );

  // 1. Revert the attach. If it fails, bail without creating a
  //    standalone — half-undone state is worse than no undo.
  const reverted = await revertAttach(
    ctx.supabase,
    offer.parent_note_id,
    offer.prior_items,
  );
  if (!reverted) {
    console.warn('[Confirmation/attached_to_parent] revertAttach failed — bailing');
    return { kind: 'reply', reply: { text: revertFailedCopy(ctx.userLang) } };
  }

  // 2. Re-process the original message so the standalone note gets
  //    a proper AI categorization. Fallback to a minimal insert if
  //    process-note is unreachable.
  let insertedSummary = '';
  try {
    const { data: processData, error: processError } = await deps.invokeProcessNote({
      text: offer.original_message,
      user_id: ctx.userId,
      couple_id: ctx.effectiveCoupleId,
      timezone: ctx.userTimezone || 'America/New_York',
      language: ctx.userLang,
      source: 'whatsapp',
    });

    if (!processError && processData) {
      // deno-lint-ignore no-explicit-any
      const data = processData as any;
      const isMultiple = data?.multiple === true && Array.isArray(data?.notes);
      // deno-lint-ignore no-explicit-any
      const notesToInsert: any[] = isMultiple ? data.notes : [data];
      for (const note of notesToInsert) {
        const noteSummary = note?.summary || 'Saved note';
        const { data: inserted, error: insertErr } = await insertNote(ctx.supabase, {
          author_id: ctx.userId,
          couple_id: ctx.effectiveCoupleId,
          source: ctx.inboundNoteSource as NoteSource,
          source_ref: ctx.wamid,
          original_text: note?.original_text || offer.original_message,
          summary: noteSummary,
          category: note?.category || 'task',
          due_date: note?.due_date || null,
          reminder_time: note?.reminder_time || null,
          recurrence_frequency: note?.recurrence_frequency || null,
          recurrence_interval: note?.recurrence_interval || null,
          priority: note?.priority || 'medium',
          tags: note?.tags || [],
          items: note?.items || [],
          task_owner: note?.task_owner || null,
          list_id: note?.list_id || null,
          completed: false,
        });
        if (!insertErr && inserted?.summary) insertedSummary = inserted.summary;
      }
    } else {
      console.warn('[Confirmation/attached_to_parent] process-note failed, using minimal insert:', processError);
      const fallbackSummary =
        offer.original_message.length > 80
          ? offer.original_message.substring(0, 77) + '...'
          : offer.original_message;
      const { data: fb } = await insertNote(ctx.supabase, {
        author_id: ctx.userId,
        couple_id: ctx.effectiveCoupleId,
        source: ctx.inboundNoteSource as NoteSource,
        source_ref: ctx.wamid,
        original_text: offer.original_message,
        summary: fallbackSummary,
        category: 'task',
        priority: 'medium',
        tags: [],
        items: [],
        completed: false,
      });
      if (fb?.summary) insertedSummary = fb.summary;
    }

    // 3. Clear the offer so a follow-up "undo" can't re-fire.
    await clearPendingOffer(ctx);

    return { kind: 'reply', reply: { text: undoSuccessCopy(ctx.userLang, insertedSummary) } };
  } catch (undoErr) {
    console.error('[Confirmation/attached_to_parent] standalone creation threw:', undoErr);
    // The revert already succeeded; user just doesn't get the
    // standalone. Surface what happened so they can retry.
    return { kind: 'reply', reply: { text: undoPartialFailureCopy(ctx.userLang) } };
  }
}

// ── Localized copy for attached_to_parent variant ─────────────────────
// Kept inline because the strings are specific to the undo flow and
// don't reuse keys in the main RESPONSES table. Future cleanup: lift
// into the shared i18n bundle once `t()` itself moves to `_shared/`.

function shortLang(lang: string): 'en' | 'es' | 'it' {
  const s = (lang || 'en').split('-')[0];
  return s === 'es' || s === 'it' ? s : 'en';
}

function revertFailedCopy(lang: string): string {
  const sl = shortLang(lang);
  return sl === 'it'
    ? "🌿 Non sono riuscita ad annullare. La nota è ancora collegata."
    : sl === 'es'
      ? "🌿 No pude deshacerlo. La nota sigue adjunta."
      : "🌿 I couldn't undo that — the attach is still in place. Try again or edit it in the app.";
}

function undoSuccessCopy(lang: string, insertedSummary: string): string {
  const sl = shortLang(lang);
  const summaryClause = insertedSummary ? ` as "${insertedSummary}"` : '';
  const summaryClauseEs = insertedSummary ? ` como "${insertedSummary}"` : '';
  const summaryClauseIt = insertedSummary ? ` come "${insertedSummary}"` : '';
  if (sl === 'es') return `🌿 Listo — guardado por separado${summaryClauseEs}.`;
  if (sl === 'it') return `🌿 Fatto — salvata separatamente${summaryClauseIt}.`;
  return `🌿 Got it — saved separately${summaryClause}.`;
}

function undoPartialFailureCopy(lang: string): string {
  const sl = shortLang(lang);
  return sl === 'it'
    ? "🌿 Ho annullato l'allegato, ma non sono riuscita a creare la nota separata. Rimandala?"
    : sl === 'es'
      ? "🌿 Deshice el adjunto, pero no pude crear la nota separada. ¿Lo reenvías?"
      : "🌿 Undone — but I couldn't create the standalone note. Resend it?";
}

// ── Shared: clear pending_offer atomically ─────────────────────────────
//
// All three variants need to clear the offer at some point. Centralized
// here so the shape of the update is consistent and recovery on failure
// is uniform (non-fatal warn; the offer expires via TTL anyway).
async function clearPendingOffer(ctx: HandlerContext): Promise<void> {
  try {
    const sessionCtx = (ctx.session.context_data || {}) as ConversationContext;
    await ctx.supabase
      .from('user_sessions')
      .update({
        context_data: { ...sessionCtx, pending_offer: null },
        updated_at: new Date().toISOString(),
      })
      .eq('id', ctx.session.id);
  } catch (clearErr) {
    console.warn('[Confirmation] clearPendingOffer failed (non-fatal):', clearErr);
  }
}

// ── Top-level dispatcher ───────────────────────────────────────────────

/**
 * Inspect the current session's `pending_offer`. If it's fresh AND
 * its `type` is one of the three variants this dispatcher handles,
 * route to the matching variant handler. Otherwise pass through.
 *
 * The webhook's router calls this BEFORE the main intent dispatch.
 * Pass-through means "carry on with normal classification".
 */
export function makeConfirmationDispatcher(deps: ConfirmationDeps) {
  return async (ctx: HandlerContext): Promise<ConfirmationOutcome> => {
    if (!ctx.messageBody) return PASS_THROUGH;

    const sessionCtx = (ctx.session.context_data || {}) as ConversationContext;
    const offer = sessionCtx.pending_offer;
    if (!isPendingOfferFresh(offer)) return PASS_THROUGH;

    // Discriminated dispatch on offer.type. New variants plug in here
    // as additional branches; the exhaustiveness check in the default
    // case forces TypeScript to enforce coverage if the union widens.
    switch (offer.type) {
      case 'save_artifact':
        return await handleSaveArtifactOffer(ctx, offer, deps);
      case 'date_for_recent_task':
        return await handleDateForRecentTaskOffer(ctx, offer, deps);
      case 'attached_to_parent':
        return await handleAttachedToParentOffer(ctx, offer, deps);
      // These five variants flow through the LEGACY AWAITING_CONFIRMATION
      // state machine in the webhook. Not handled here yet — a separate
      // refactor task migrates them onto pending_offer + this dispatcher.
      case 'reschedule_task':
      case 'edit_task':
      case 'delete_task':
      case 'disambiguate':
      case 'bulk_reschedule_weekday':
        return PASS_THROUGH;
      default: {
        // Exhaustiveness check — fails compile if a new variant is
        // added to PendingOffer without being routed here.
        const _exhaustive: never = offer;
        void _exhaustive;
        return PASS_THROUGH;
      }
    }
  };
}

// Exports for testing internals individually if needed.
export const __testing__ = {
  handleSaveArtifactOffer,
  handleDateForRecentTaskOffer,
  handleAttachedToParentOffer,
  clearPendingOffer,
  PASS_THROUGH,
};

// Re-export the supabase type so tests can stub against it without
// pulling the dependency themselves.
export type { SupabaseClient };

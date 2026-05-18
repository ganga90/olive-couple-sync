// handlers/create-note.ts — CREATE (brain-dump) intent handler.
// ============================================================================
// Initiative 1.6 of OLIVE_REFACTOR_PLAN.md. Extracts the largest remaining
// inline block after the 1.5 cuts — the "Capture First" brain-dump path
// that catches every WhatsApp message the classifier doesn't route
// elsewhere and turns it into one or more saved notes.
//
// Responsibilities (in order):
//   1. Pronoun-only resolution — when the user says "schedule it",
//      "save that", "do it", pull the previous user message from
//      session.last_user_message (10-min TTL) and operate on that
//      instead.
//   2. Topical-followup attach — if the message looks like a follow-up
//      field for a parent note the user captured in the last 30 min
//      (e.g. "Email for Smith Realty\njohn@…"), silently attach to the
//      parent's items[] instead of creating a sibling row. Persists an
//      `attached_to_parent` PendingOffer so the user can `undo` within
//      the offer TTL.
//   3. process-note invoke — AI categorization, list inference,
//      multi-note splitting.
//   4. Insert path — multi-note (insertNotesBatch) OR single-note
//      (insertNote), with:
//      - encryption at rest when `isSensitive` is set (AES-256-GCM via
//        encryptNoteFields)
//      - list_id → couple_id inheritance (shared list → shared note)
//      - items[] sub-items mode preserved in the saved row
//   5. Post-insert duplicate detection — single-note only. Generates
//      embedding, writes to clerk_notes.embedding, calls
//      find_similar_notes RPC to surface dupes in the confirmation.
//   6. Proactive bridge offer — single-note + no due_date + no
//      reminder_time + user opted-in → emit a one-shot
//      `date_for_recent_task` PendingOffer asking for a date.
//   7. Localized confirmation with: list name, encryption label
//      (🔒 Encrypted at rest), sub-items preview (up to 5 with
//      overflow tail), random productivity tip (or proactive offer
//      copy when set), brand voice "🌿".
//   8. After-reply: saveReferencedEntity + pending_offer persistence.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { encryptNoteFields, isEncryptionAvailable } from "../../_shared/encryption.ts";
import {
  insertNote,
  insertNotesBatch,
  type NoteSource,
} from "../../_shared/note-insert.ts";
import { findSimilarNotes } from "../../_shared/task-search.ts";
import {
  attachToParent,
  findFollowupParent,
} from "../../_shared/topical-followup.ts";
import {
  isPendingOfferFresh,
  type PendingOffer,
} from "../../_shared/pending-offer.ts";
import type {
  ConversationContext,
  Handler,
  HandlerContext,
  Reply,
} from "../../_shared/types.ts";
import type { SaveReferencedEntityFn } from "./contextual-ask.ts";

// ─── Type definitions ──────────────────────────────────────────────────

/** Signature of the webhook's `process-note` invocation. Injected so
 *  tests can mock it without spinning up a second edge function. */
export type InvokeProcessNoteFn = (
  body: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

export interface CreateNoteDeps {
  t: (key: string, lang: string, vars?: Record<string, string>) => string;
  generateEmbedding: (text: string) => Promise<number[] | null>;
  /** Webhook-local closure that owns conversation_history +
   *  last_referenced_entity writes on user_sessions.context_data. */
  saveReferencedEntity: SaveReferencedEntityFn;
  /** Invokes the `process-note` edge function. */
  invokeProcessNote: InvokeProcessNoteFn;
}

// ─── Random productivity tip ───────────────────────────────────────────

const RANDOM_TIPS_LOCALIZED: Record<string, string[]> = {
  en: [
    "Reply 'Make it urgent' to change priority",
    "Reply 'Show my tasks' to see your list",
    "You can send voice notes too! 🎤",
    "Use ! prefix for urgent tasks (e.g., !call mom)",
    "Use $ to log expenses (e.g., $25 lunch)",
    "Use ? to search your tasks (e.g., ?groceries)",
    "Send a photo of a receipt to log it automatically 📸",
    "Say 'Remind me tomorrow at 9am' to set reminders",
    "Say 'done with X' to mark a task complete",
    "Send a comma-separated list to create multiple tasks at once",
  ],
  es: [
    "Responde 'Hazlo urgente' para cambiar prioridad",
    "Responde 'Mostrar mis tareas' para ver tu lista",
    "¡También puedes enviar notas de voz! 🎤",
    "Usa ! para tareas urgentes (ej. !llamar a mamá)",
    "Usa $ para registrar gastos (ej. $25 almuerzo)",
    "Usa ? para buscar tareas (ej. ?compras)",
    "Envía una foto de un recibo para registrarlo automáticamente 📸",
    "Di 'Recuérdame mañana a las 9am' para establecer recordatorios",
    "Di 'hecho con X' para completar una tarea",
    "Envía una lista separada por comas para crear varias tareas a la vez",
  ],
  it: [
    "Rispondi 'Rendilo urgente' per cambiare priorità",
    "Rispondi 'Mostra le mie attività' per vedere la tua lista",
    "Puoi anche inviare note vocali! 🎤",
    "Usa ! per attività urgenti (es. !chiamare mamma)",
    "Usa $ per registrare spese (es. $25 pranzo)",
    "Usa ? per cercare attività (es. ?spesa)",
    "Invia una foto di uno scontrino per registrarlo automaticamente 📸",
    "Di 'Ricordami domani alle 9' per impostare promemoria",
    "Di 'fatto con X' per completare un'attività",
    "Invia una lista separata da virgole per creare più attività",
  ],
};

function shortLang(lang: string): string {
  return (lang || 'en').split('-')[0];
}

function pickRandomTip(lang: string): string {
  const tips = RANDOM_TIPS_LOCALIZED[shortLang(lang)] || RANDOM_TIPS_LOCALIZED.en;
  return tips[Math.floor(Math.random() * tips.length)];
}

// ─── Pronoun-only resolution ───────────────────────────────────────────
//
// Verbatim from `index.ts:6577–6590`. When the message is just
// "schedule it" / "save that" / "lo guardo" / "salvalo" and a recent
// previous user message exists, operate on that previous message.

const PRONOUN_ONLY_RE =
  /^(then\s+)?(schedule|create|save|add|set|do|make)\s+(it|that|this|lo|eso|esto|quello|questo)\s*[.!]?$/i;

export function isPronounOnlyCreate(message: string): boolean {
  return PRONOUN_ONLY_RE.test(message.trim());
}

/** Resolves a pronoun-only CREATE message to the previous user
 *  message when one exists in the 10-min TTL window. Returns the
 *  resolved message string. */
export function resolvePronounOnlyMessage(
  effectiveMessage: string,
  sessionContext: ConversationContext,
): string {
  if (!isPronounOnlyCreate(effectiveMessage)) return effectiveMessage;
  const prevMsg = sessionContext.last_user_message;
  const prevMsgAt = sessionContext.last_user_message_at;
  const isRecent = prevMsgAt && (Date.now() - new Date(prevMsgAt).getTime()) < 10 * 60 * 1000;
  if (prevMsg && isRecent) {
    console.log('[CREATE] Pronoun-only create detected, using previous message:', prevMsg.substring(0, 80));
    return prevMsg;
  }
  console.log('[CREATE] Pronoun-only but no recent context, proceeding with original message');
  return effectiveMessage;
}

// ─── Topical-followup attach ───────────────────────────────────────────
//
// Verbatim from `index.ts:6612–6699`. When the message matches a
// "Field for Topic\n<value>" pattern against a parent note from the
// last 30 min, silently attach + persist an undo offer. Returns the
// reply text on attach (handler returns early), or null to fall
// through to the standard create path.

const UNDO_HINT_LOCALIZED: Record<string, string> = {
  en: `Reply "undo" to save it as a separate note.`,
  es: `Responde "deshacer" para guardarlo como nota aparte.`,
  it: `Rispondi "annulla" per salvarla come nota separata.`,
};

const ATTACH_VERB_LOCALIZED: Record<string, string> = {
  en: 'Added to',
  es: 'Añadido a',
  it: 'Aggiunto a',
};

async function tryTopicalFollowupAttach(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  ctx: HandlerContext,
  createMessage: string,
): Promise<{ replyText: string; offer: PendingOffer } | null> {
  const sessionContext = (ctx.session.context_data || {}) as ConversationContext;
  const eligible =
    createMessage &&
    createMessage.trim().length > 0 &&
    ctx.mediaUrls.length === 0 &&
    !isPronounOnlyCreate(createMessage) &&
    !isPendingOfferFresh(sessionContext.pending_offer);
  if (!eligible) return null;

  try {
    const followupMatch = await findFollowupParent(
      supabase,
      ctx.userId,
      ctx.coupleId,
      createMessage,
    );
    if (!followupMatch) return null;

    console.log(
      `[CREATE] Topical follow-up detected — attaching to "${followupMatch.parentSummary}"`
      + ` (confidence=${followupMatch.confidence.toFixed(2)}, addition="${followupMatch.addition}")`,
    );
    const priorItems = followupMatch.nextItems.slice(0, -1);
    const attached = await attachToParent(
      supabase,
      followupMatch.parentNoteId,
      followupMatch.nextItems,
    );
    if (!attached) {
      // attachToParent returned false (DB write failed). Caller falls
      // through to the standard CREATE path so the user's data still
      // lands somewhere.
      console.warn('[CREATE] Topical follow-up: attachToParent failed, falling back to standard create');
      return null;
    }

    const offer: PendingOffer = {
      type: 'attached_to_parent',
      parent_note_id: followupMatch.parentNoteId,
      parent_summary: followupMatch.parentSummary,
      prior_items: priorItems,
      addition: followupMatch.addition,
      original_message: createMessage,
      confidence: followupMatch.confidence,
      offered_at: new Date().toISOString(),
    };

    const sl = shortLang(ctx.userLang);
    const undoHint = UNDO_HINT_LOCALIZED[sl] || UNDO_HINT_LOCALIZED.en;
    const verb = ATTACH_VERB_LOCALIZED[sl] || ATTACH_VERB_LOCALIZED.en;
    const replyText =
      `🌿 ${verb} "${followupMatch.parentSummary}":\n` +
      `  • ${followupMatch.addition}\n\n` +
      `💡 ${undoHint}`;
    return { replyText, offer };
  } catch (followupErr) {
    // Defensive: never let a follow-up detection bug break the
    // standard CREATE path. Log and continue.
    console.warn('[CREATE] Topical follow-up check threw (non-blocking):', followupErr);
    return null;
  }
}

// ─── Sub-items preview ─────────────────────────────────────────────────
//
// Verbatim from `index.ts:6973–6990`. Renders up to 5 items with a
// localized "and N more" tail.

const ITEMS_OVERFLOW_LOCALIZED: Record<string, (n: number) => string> = {
  en: (n) => `  …and ${n} more`,
  es: (n) => `  …y ${n} más`,
  it: (n) => `  …e altri ${n}`,
};

export function buildItemsPreview(items: unknown, userLang: string): string {
  if (!Array.isArray(items)) return '';
  const stringItems = items
    // deno-lint-ignore no-explicit-any
    .map((it: any) => typeof it === 'string' ? it : (it && typeof it === 'object' && 'text' in it ? String(it.text) : ''))
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);
  if (stringItems.length === 0) return '';
  const shown = stringItems.slice(0, 5);
  const overflow = stringItems.length - shown.length;
  const sl = shortLang(userLang);
  const overflowFn = ITEMS_OVERFLOW_LOCALIZED[sl] || ITEMS_OVERFLOW_LOCALIZED.en;
  const overflowText = overflow > 0 ? '\n' + overflowFn(overflow) : '';
  return '\n' + shown.map((s) => `  • ${s}`).join('\n') + overflowText;
}

// ─── List name lookup ─────────────────────────────────────────────────

async function getListName(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  listId: string | null,
): Promise<string> {
  if (!listId) return 'Tasks';
  const { data: list } = await supabase
    .from('clerk_lists')
    .select('name')
    .eq('id', listId)
    .single();
  return list?.name || 'Tasks';
}

/** When `list_id` is set on the processed note, inherit the list's
 *  `couple_id` so a shared list yields a shared note. Verbatim from
 *  `index.ts:6812–6823` (multi) + `index.ts:6890–6900` (single). */
async function inheritCoupleIdFromList(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  listId: string | null | undefined,
  fallbackCoupleId: string | null,
): Promise<string | null> {
  if (!listId) return fallbackCoupleId;
  const { data: listData } = await supabase
    .from('clerk_lists')
    .select('couple_id')
    .eq('id', listId)
    .single();
  if (!listData) return fallbackCoupleId;
  // deno-lint-ignore no-explicit-any
  return ((listData as any).couple_id ?? fallbackCoupleId) as string | null;
}

// ─── Encryption ────────────────────────────────────────────────────────

interface EncryptionFields {
  original_text: string;
  summary: string;
  encrypted_original_text: string | null;
  encrypted_summary: string | null;
  is_sensitive: boolean;
}

async function buildEncryptionFields(
  rawText: string,
  rawSummary: string,
  userId: string,
  isSensitive: boolean,
): Promise<EncryptionFields> {
  const fields: EncryptionFields = {
    original_text: rawText,
    summary: rawSummary,
    encrypted_original_text: null,
    encrypted_summary: null,
    is_sensitive: isSensitive,
  };
  if (!isSensitive || !isEncryptionAvailable()) return fields;
  try {
    return await encryptNoteFields(rawText, rawSummary, userId, true);
  } catch (encErr) {
    console.warn('[WhatsApp] Encryption failed, storing as plaintext:', encErr);
    return fields;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────

export function makeCreateNoteHandler(deps: CreateNoteDeps): Handler {
  return async (ctx: HandlerContext): Promise<Reply> => {
    const sessionContext = (ctx.session.context_data || {}) as ConversationContext;
    // deno-lint-ignore no-explicit-any
    const intentResultAny = ctx.intentResult as any;
    const isUrgent: boolean = intentResultAny.isUrgent === true;

    // ── 1. Pronoun-only resolution.
    const createMessage = resolvePronounOnlyMessage(
      ctx.effectiveMessage || '',
      sessionContext,
    );

    // ── 2. Topical-followup attach (returns early on success).
    const attachResult = await tryTopicalFollowupAttach(
      ctx.supabase, ctx, createMessage,
    );
    if (attachResult) {
      // Persist the undo offer; non-fatal on write failure.
      const after_reply: Array<() => Promise<void>> = [
        async () => {
          try {
            await ctx.supabase
              .from('user_sessions')
              .update({
                context_data: { ...sessionContext, pending_offer: attachResult.offer },
                updated_at: new Date().toISOString(),
              })
              .eq('id', ctx.session.id);
          } catch (sessErr) {
            console.warn('[CREATE] Topical follow-up: session update failed (attach stays, undo unavailable):', sessErr);
          }
        },
      ];
      return { text: attachResult.replyText, after_reply };
    }

    // ── 3. process-note invoke.
    // deno-lint-ignore no-explicit-any
    const notePayload: Record<string, any> = {
      text: createMessage,
      user_id: ctx.userId,
      couple_id: ctx.effectiveCoupleId,
      timezone: ctx.profile.timezone || 'America/New_York',
      language: ctx.userLang,
      source: 'whatsapp',
      force_priority: isUrgent ? 'high' : undefined,
    };
    if (ctx.latitude && ctx.longitude) {
      notePayload.location = { latitude: ctx.latitude, longitude: ctx.longitude };
      if (notePayload.text) {
        notePayload.text = `${notePayload.text} (Location: ${ctx.latitude}, ${ctx.longitude})`;
      }
    }
    if (ctx.mediaUrls.length > 0) {
      notePayload.media = ctx.mediaUrls;
      notePayload.mediaTypes = ctx.mediaTypes;
      console.log('[WhatsApp] Sending', ctx.mediaUrls.length, 'media file(s) for AI processing, types:', ctx.mediaTypes);
    }

    const { data: processData, error: processError } = await deps.invokeProcessNote(notePayload);
    if (processError) {
      console.error('Error processing note:', processError);
      return { text: deps.t('error_generic', ctx.userLang) };
    }
    // deno-lint-ignore no-explicit-any
    const pd: any = processData;

    // ── 4. Insert path: multi-note OR single-note.
    try {
      if (pd?.multiple && Array.isArray(pd.notes)) {
        // ── Multi-note path.
        const notesToInsert = await Promise.all(
          // deno-lint-ignore no-explicit-any
          pd.notes.map(async (note: any) => {
            const rawText = ctx.messageBody || note.summary || 'Media attachment';
            const rawSum = note.summary;
            const encFields = await buildEncryptionFields(
              rawText, rawSum, ctx.userId,
              !!ctx.isSensitive || !!pd.is_sensitive,
            );
            const noteCoupleId = await inheritCoupleIdFromList(
              ctx.supabase, note.list_id, ctx.effectiveCoupleId,
            );
            return {
              author_id: ctx.userId,
              couple_id: noteCoupleId,
              source: ctx.inboundNoteSource as NoteSource,
              source_ref: ctx.wamid,
              ...encFields,
              category: note.category || 'task',
              due_date: note.due_date,
              reminder_time: note.reminder_time,
              recurrence_frequency: note.recurrence_frequency,
              recurrence_interval: note.recurrence_interval,
              priority: isUrgent ? 'high' : (note.priority || 'medium'),
              tags: note.tags || [],
              items: note.items || [],
              task_owner: note.task_owner,
              list_id: note.list_id,
              location: ctx.latitude && ctx.longitude
                ? { latitude: ctx.latitude, longitude: ctx.longitude }
                : null,
              media_urls: ctx.mediaUrls.length > 0 ? ctx.mediaUrls : null,
              completed: false,
            };
          }),
        );

        const { data: insertedNotes, error: insertError } =
          await insertNotesBatch(ctx.supabase, notesToInsert);
        if (insertError) throw insertError;

        const primaryListId = insertedNotes?.[0]?.list_id ?? null;
        const listName = await getListName(ctx.supabase, primaryListId);
        const count = pd.notes.length;
        const itemsList =
          // deno-lint-ignore no-explicit-any
          insertedNotes?.slice(0, 3).map((n: any) => `• ${n.summary}`).join('\n') || '';
        const moreCount = count > 3 ? count - 3 : 0;
        const moreTextLocalized: Record<string, string> = {
          en: `\n...and ${moreCount} more`,
          es: `\n...y ${moreCount} más`,
          it: `\n...e altri ${moreCount}`,
        };
        const sl = shortLang(ctx.userLang);
        const moreText = moreCount > 0 ? (moreTextLocalized[sl] || moreTextLocalized.en) : '';

        const replyText =
          `${deps.t('note_multi_saved', ctx.userLang, { count: String(count) })}\n${itemsList}${moreText}\n\n`
          + `${deps.t('note_added_to', ctx.userLang, { list: listName })}\n\n`
          + `${deps.t('note_manage', ctx.userLang)}\n\n💡 ${pickRandomTip(ctx.userLang)}`;
        // Multi-note path: monolith does not call saveReferencedEntity here.
        return { text: replyText };
      }

      // ── Single-note path.
      const rawOriginalText = ctx.messageBody || pd?.summary || 'Media attachment';
      const rawSummary = pd?.summary || '';
      const encryptionFields = await buildEncryptionFields(
        rawOriginalText, rawSummary, ctx.userId,
        !!ctx.isSensitive || !!pd?.is_sensitive,
      );
      if (encryptionFields.encrypted_original_text) {
        console.log('[WhatsApp] 🔐 Note fields encrypted for sensitive note');
      }

      const singleNoteCoupleId = await inheritCoupleIdFromList(
        ctx.supabase, pd?.list_id, ctx.effectiveCoupleId,
      );

      const { data: insertedNote, error: insertError } = await insertNote(ctx.supabase, {
        author_id: ctx.userId,
        couple_id: singleNoteCoupleId,
        source: ctx.inboundNoteSource as NoteSource,
        source_ref: ctx.wamid,
        ...encryptionFields,
        category: pd?.category || 'task',
        due_date: pd?.due_date,
        reminder_time: pd?.reminder_time,
        recurrence_frequency: pd?.recurrence_frequency,
        recurrence_interval: pd?.recurrence_interval,
        priority: isUrgent ? 'high' : (pd?.priority || 'medium'),
        tags: pd?.tags || [],
        items: pd?.items || [],
        task_owner: pd?.task_owner,
        list_id: pd?.list_id,
        location: ctx.latitude && ctx.longitude
          ? { latitude: ctx.latitude, longitude: ctx.longitude }
          : null,
        media_urls: ctx.mediaUrls.length > 0 ? ctx.mediaUrls : null,
        completed: false,
      });
      if (insertError || !insertedNote) {
        throw insertError ?? new Error('Insert returned no row');
      }

      const insertedNoteId: string = insertedNote.id;
      const insertedNoteSummary: string = insertedNote.summary ?? '';
      const insertedListId: string | null = insertedNote.list_id ?? null;
      const listName = await getListName(ctx.supabase, insertedListId);

      // ── 5. Post-insert duplicate detection + embedding write.
      let duplicateWarning: { found: boolean; targetId: string; targetTitle: string } | null = null;
      try {
        const embedding = await deps.generateEmbedding(insertedNoteSummary);
        if (embedding && insertedNoteId) {
          await ctx.supabase
            .from('clerk_notes')
            .update({ embedding: JSON.stringify(embedding) })
            .eq('id', insertedNoteId);
          const similarNote = (ctx.coupleId && typeof ctx.coupleId === 'string')
            ? await findSimilarNotes(ctx.supabase, ctx.userId, ctx.coupleId, embedding, insertedNoteId)
            : null;
          if (similarNote) {
            duplicateWarning = {
              found: true,
              targetId: similarNote.id,
              targetTitle: similarNote.summary,
            };
            console.log('[Duplicate Detection] Found similar note:', similarNote.summary, 'similarity:', similarNote.similarity);
          }
        }
      } catch (dupError) {
        console.error('Duplicate detection error (non-blocking):', dupError);
      }

      // ── 6. Proactive bridge offer (single-note + no date + opted-in).
      let proactiveBridgeOffer: PendingOffer | null = null;
      if (
        insertedNoteId
        && !pd?.due_date
        && !pd?.reminder_time
        && !duplicateWarning?.found
      ) {
        try {
          const { data: prefRow } = await ctx.supabase
            .from('olive_user_preferences')
            .select('proactive_bridge_enabled')
            .eq('user_id', ctx.userId)
            .maybeSingle();
          // deno-lint-ignore no-explicit-any
          if ((prefRow as any)?.proactive_bridge_enabled) {
            proactiveBridgeOffer = {
              type: 'date_for_recent_task',
              task_id: insertedNoteId,
              task_summary: insertedNoteSummary,
              timezone: ctx.profile.timezone || 'America/New_York',
              offered_at: new Date().toISOString(),
            };
          }
        } catch (prefErr) {
          console.warn(
            '[ProactiveBridge] preference lookup failed (non-fatal):',
            prefErr instanceof Error ? prefErr.message : prefErr,
          );
        }
      }

      // ── 7. Build confirmation.
      const itemsPreview = buildItemsPreview(pd?.items, ctx.userLang);
      let confirmationMessage: string;
      if (duplicateWarning?.found) {
        confirmationMessage = [
          deps.t('note_saved', ctx.userLang, { summary: insertedNoteSummary }) + itemsPreview,
          deps.t('note_added_to', ctx.userLang, { list: listName }),
          ``,
          deps.t('note_similar_found', ctx.userLang, { task: duplicateWarning.targetTitle }),
        ].join('\n');
      } else {
        const sensitiveLabel = encryptionFields.is_sensitive ? '\n🔒 Encrypted at rest' : '';
        const tailLine = proactiveBridgeOffer
          ? deps.t('proactive_date_offer', ctx.userLang)
          : `💡 ${pickRandomTip(ctx.userLang)}`;
        confirmationMessage = [
          deps.t('note_saved', ctx.userLang, { summary: rawSummary }) + itemsPreview,
          deps.t('note_added_to', ctx.userLang, { list: listName }),
          sensitiveLabel,
          ``,
          deps.t('note_manage', ctx.userLang),
          ``,
          tailLine,
        ].filter(Boolean).join('\n');
      }

      // ── 8. After-reply side-effects.
      const after_reply: Array<() => Promise<void>> = [
        async () => {
          try {
            await deps.saveReferencedEntity(
              { id: insertedNoteId, summary: insertedNoteSummary, list_id: insertedListId || undefined },
              confirmationMessage,
            );
          } catch (refErr) {
            console.warn('[CREATE] saveReferencedEntity failed (non-blocking):', refErr);
          }
        },
      ];
      if (proactiveBridgeOffer) {
        after_reply.push(async () => {
          try {
            // Re-read context_data to merge atomically with whatever
            // saveReferencedEntity wrote (mirrors monolith's pattern).
            const { data: currentSession } = await ctx.supabase
              .from('user_sessions')
              .select('context_data')
              .eq('id', ctx.session.id)
              .maybeSingle();
            // deno-lint-ignore no-explicit-any
            const currentCtx = ((currentSession as any)?.context_data || {}) as ConversationContext;
            await ctx.supabase
              .from('user_sessions')
              .update({
                context_data: { ...currentCtx, pending_offer: proactiveBridgeOffer },
                updated_at: new Date().toISOString(),
              })
              .eq('id', ctx.session.id);
            console.log('[ProactiveBridge] offered date_for_recent_task for note', insertedNoteId);
          } catch (offerErr) {
            console.warn(
              '[ProactiveBridge] offer persistence failed (non-fatal):',
              offerErr instanceof Error ? offerErr.message : offerErr,
            );
          }
        });
      }

      return { text: confirmationMessage, after_reply };
    } catch (insertError) {
      console.error('Database insertion error:', JSON.stringify(insertError));
      // deno-lint-ignore no-explicit-any
      const ie = insertError as any;
      console.error('Insert error details:', ie?.message, ie?.details, ie?.hint);
      return { text: deps.t('error_save_failed', ctx.userLang) };
    }
  };
}

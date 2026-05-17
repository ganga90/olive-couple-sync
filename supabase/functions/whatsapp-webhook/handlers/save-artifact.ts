// handlers/save-artifact.ts — SAVE_ARTIFACT intent handler.
// ============================================================================
// Initiative 1.2 of OLIVE_REFACTOR_PLAN.md. First handler extracted from
// the monolithic whatsapp-webhook/index.ts.
//
// Responsibilities (in order):
//   1. Recover the artifact from the session — prefer the structured
//      `pending_offer` (frozen at offer time, immune to CHAT clobber);
//      fall back to `last_assistant_output` for legacy "save this" flows.
//   2. Classify {title, category, tags} via the pure
//      `classifyArtifact` helper. Failures here are NEVER fatal.
//   3. Build a clerk_notes insert payload + resolve any "save it to my
//      <list>" mention to a list_id.
//   4. Insert. On a Postgres FK/RLS/CHECK failure, retry once with a
//      minimal personal-scope payload. The user's content survives.
//   5. Return a `Reply` with the localized confirmation text, the
//      referenced entity for the router to persist, and after-reply
//      callbacks for the non-blocking side-effects (embedding gen,
//      session clear).
//
// Pure-ish handler: all external dependencies (`callAI`,
// `generateEmbedding`, `t`) are injected via the factory. The webhook
// dispatch site wires its real implementations; tests pass stubs.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { insertNote, type NoteSource } from "../../_shared/note-insert.ts";
import { isPendingOfferFresh } from "../../_shared/pending-offer.ts";
import {
  classifyArtifact,
  type ArtifactClassifierCall,
} from "../../_shared/ai/classify-artifact.ts";
import type {
  ConversationContext,
  Handler,
  HandlerContext,
  Reply,
} from "../../_shared/types.ts";

/** Dependencies the handler closes over. The factory injects these once;
 *  individual invocations re-use them. Tests pass stubs. */
export interface SaveArtifactDeps {
  /** AI invocation — the webhook's `callAI`. */
  callAI: ArtifactClassifierCall;
  /** Embedding generator — the webhook's `generateEmbedding`. Non-blocking. */
  generateEmbedding: (text: string) => Promise<number[] | null>;
  /** i18n function — the webhook's `t`. */
  t: (key: string, lang: string, vars?: Record<string, string>) => string;
  /** Prompt version string for analytics attribution. */
  promptVersion: string;
}

/** Match "save it [in|to|on] <list-name>" in en / es / it. Captures the
 *  raw list name; resolution against the user's lists happens after. */
const LIST_MENTION_RE =
  /(?:in|to|on|nella|nella\s+lista|en\s+(?:mi\s+)?lista|alla\s+lista)\s+(?:my\s+)?[""""]?([^""""\n]{2,30})[""""]?\s*(?:list|lista)?/i;

/** Read the artifact + the user's original request out of session state.
 *  Returns null if no recoverable artifact exists (the handler should
 *  reply with `artifact_none` in that case). */
export function readArtifactFromSession(
  ctx: ConversationContext,
): { content: string; request: string } | null {
  const rawOffer = isPendingOfferFresh(ctx.pending_offer) ? ctx.pending_offer : null;
  const freshOffer =
    rawOffer && rawOffer.type === 'save_artifact' ? rawOffer : null;

  const content = freshOffer?.artifact_content || ctx.last_assistant_output || '';
  const request = freshOffer?.artifact_request || ctx.last_assistant_request || '';

  if (!content) return null;
  return { content, request };
}

/** Build the note insert payload from a classified artifact. Pure. */
function buildNotePayload(
  ctx: HandlerContext,
  artifact: { content: string; request: string },
  classification: { title: string; category: string; tags: string[] },
): Record<string, unknown> {
  const artifactLines = artifact.content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return {
    author_id: ctx.userId,
    couple_id: ctx.effectiveCoupleId,
    // Bucket 3: capture channel is WhatsApp (user typed "save this" via
    // WhatsApp); the artifact's *content* came from Olive's chat reply,
    // but that's incidental to source attribution.
    source: ctx.inboundNoteSource,
    source_ref: ctx.wamid,
    original_text: (artifact.request || 'Saved from Olive chat').substring(0, 2000),
    summary: classification.title,
    category: (classification.category || 'task').toLowerCase().replace(/\s+/g, '_'),
    priority: 'medium',
    tags: classification.tags,
    items: artifactLines.length > 0 ? artifactLines : [artifact.content.substring(0, 4000)],
    completed: false,
  };
}

/** Look up an explicit "in <list>" mention against the user's existing
 *  lists. Returns the matched list (id + couple_id) or null. */
async function resolveListMention(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  coupleId: string | null,
  messageBody: string | null,
): Promise<{ id: string; couple_id: string | null } | null> {
  if (!messageBody) return null;
  const match = messageBody.toLowerCase().match(LIST_MENTION_RE);
  if (!match) return null;

  const { data: lists } = await supabase
    .from('clerk_lists')
    .select('id, name, couple_id')
    .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`);

  if (!lists || lists.length === 0) return null;
  const target = match[1].toLowerCase().trim();
  const found =
    lists.find((l) => l.name.toLowerCase() === target) ||
    lists.find((l) => l.name.toLowerCase().includes(target)) ||
    lists.find((l) => target.includes(l.name.toLowerCase()));
  return found ? { id: found.id, couple_id: found.couple_id } : null;
}

/**
 * Factory — wires `deps` once and returns a Handler the webhook router
 * can dispatch to.
 */
export function makeSaveArtifactHandler(deps: SaveArtifactDeps): Handler {
  return async (ctx: HandlerContext): Promise<Reply> => {
    console.log('[SAVE_ARTIFACT] User wants to save assistant output as note');

    const sessionCtx = (ctx.session.context_data || {}) as ConversationContext;
    const artifact = readArtifactFromSession(sessionCtx);

    if (!artifact) {
      return { text: deps.t('artifact_none', ctx.userLang) };
    }

    const classification = await classifyArtifact({
      artifactContent: artifact.content,
      artifactRequest: artifact.request,
      callAI: deps.callAI,
      tracker: ctx.tracker,
      promptVersion: deps.promptVersion,
    });

    const notePayload = buildNotePayload(ctx, artifact, classification);

    const matchedList = await resolveListMention(
      ctx.supabase,
      ctx.userId,
      ctx.coupleId,
      ctx.messageBody,
    );
    if (matchedList) {
      notePayload.list_id = matchedList.id;
      notePayload.couple_id = matchedList.couple_id ?? ctx.effectiveCoupleId;
    }

    let { data: savedNote, error: saveError } =
      await insertNote(ctx.supabase, notePayload as never);

    // Retry once with a minimal personal-scope payload if the full
    // payload tripped any insert-time failure. The user's content
    // ALWAYS survives — they can re-share later from the web app.
    if (saveError || !savedNote) {
      console.error('[SAVE_ARTIFACT] Insert error (full payload):', JSON.stringify({
        message: saveError?.message,
        details: (saveError as { details?: string } | null)?.details,
        code: (saveError as { code?: string } | null)?.code,
        payload_keys: Object.keys(notePayload),
        summary_len: classification.title.length,
        items_count: (notePayload.items as unknown[])?.length ?? 0,
        category: notePayload.category,
        couple_id_set: !!notePayload.couple_id,
        list_id_set: !!notePayload.list_id,
      }));

      const minimalPayload = {
        author_id: ctx.userId,
        couple_id: null,
        source: ctx.inboundNoteSource as NoteSource,
        source_ref: ctx.wamid,
        original_text: (artifact.request || 'Saved from Olive chat').substring(0, 2000),
        summary: classification.title,
        category: 'personal',
        priority: 'medium',
        tags: ['olive-draft'],
        items: [artifact.content.substring(0, 4000)],
        completed: false,
      };

      const retry = await insertNote(ctx.supabase, minimalPayload);
      if (retry.error || !retry.data) {
        console.error('[SAVE_ARTIFACT] Insert error (minimal payload):', JSON.stringify({
          message: retry.error?.message,
          details: (retry.error as { details?: string } | null)?.details,
          code: (retry.error as { code?: string } | null)?.code,
        }));
        return { text: deps.t('artifact_save_error', ctx.userLang) };
      }
      savedNote = retry.data;
    }

    // Capture the saved row into local scope so after-reply callbacks
    // close over a stable value (savedNote was let-rebound during retry).
    const final = savedNote!;
    const savedListId = final.list_id;
    const savedId = final.id;
    const savedSummary = final.summary ?? '';

    // Fetch list name for the confirmation copy (cheap query, blocks
    // the reply because the localized string needs it inline).
    let listConfirm = '';
    if (savedListId) {
      const { data: listInfo } = await ctx.supabase
        .from('clerk_lists')
        .select('name')
        .eq('id', savedListId)
        .single();
      if (listInfo) listConfirm = ` in your *${(listInfo as { name: string }).name}* list`;
    }

    const replyText = deps.t('artifact_saved', ctx.userLang, {
      title: savedSummary,
      list: listConfirm,
    });

    // After-reply side-effects — fire-and-forget. Embedding generation
    // and session-state cleanup never block the outbound reply.
    const after_reply: Array<() => Promise<void>> = [
      // Generate embedding for semantic search.
      async () => {
        try {
          const embedding = await deps.generateEmbedding(
            classification.title + ' ' + artifact.content.substring(0, 500),
          );
          if (embedding) {
            await ctx.supabase
              .from('clerk_notes')
              .update({ embedding })
              .eq('id', savedId);
          }
        } catch (e) {
          console.warn('[SAVE_ARTIFACT] embedding generation failed:', e);
        }
      },
      // Atomically clear the artifact + pending_offer so the next "save
      // this" can't double-fire on a stale row.
      async () => {
        try {
          await ctx.supabase
            .from('user_sessions')
            .update({
              context_data: {
                ...sessionCtx,
                last_assistant_output: null,
                last_assistant_output_at: null,
                last_assistant_request: null,
                pending_offer: null,
              },
              updated_at: new Date().toISOString(),
            })
            .eq('id', ctx.session.id);
        } catch (e) {
          console.warn('[SAVE_ARTIFACT] session clear failed:', e);
        }
      },
    ];

    return {
      text: replyText,
      referenced_entity: {
        id: savedId,
        summary: savedSummary,
        list_id: savedListId ?? undefined,
      },
      after_reply,
    };
  };
}

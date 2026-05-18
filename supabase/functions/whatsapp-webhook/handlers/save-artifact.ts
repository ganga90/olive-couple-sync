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
import {
  resolveSaveTargetList,
  type UserList,
} from "../../_shared/list-matcher.ts";
import type {
  ConversationContext,
  Handler,
  HandlerContext,
  Reply,
} from "../../_shared/types.ts";

/** Feature flag — when truthy, SAVE_ARTIFACT enriches the classifier with
 *  the user's existing lists and routes the saved note into the matched
 *  (or newly-created) list. When falsy/unset, behavior is identical to
 *  pre-Apr-2026 (only explicit "in my X list" mentions get a list_id).
 *  Flip via Supabase Studio → Edge Functions → Secrets. */
const SMART_SAVE_ROUTING_FLAG = 'OLIVE_SMART_SAVE_ROUTING';

function smartSaveRoutingEnabled(): boolean {
  const v = Deno.env.get(SMART_SAVE_ROUTING_FLAG);
  return v === '1' || v === 'true' || v === 'on';
}

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
 *  lists. Returns the matched list (id + couple_id) or null.
 *
 *  Always runs FIRST — an explicit user mention beats any AI-suggested
 *  routing. `lists` may be passed pre-fetched when smart routing already
 *  loaded them; we only re-query if the caller didn't.
 */
async function resolveListMention(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  coupleId: string | null,
  messageBody: string | null,
  preFetched?: Array<{ id: string; name: string; couple_id: string | null }>,
): Promise<{ id: string; couple_id: string | null; name: string } | null> {
  if (!messageBody) return null;
  const match = messageBody.toLowerCase().match(LIST_MENTION_RE);
  if (!match) return null;

  let lists = preFetched;
  if (!lists) {
    const { data } = await supabase
      .from('clerk_lists')
      .select('id, name, couple_id')
      .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`);
    lists = data ?? undefined;
  }

  if (!lists || lists.length === 0) return null;
  const target = match[1].toLowerCase().trim();
  const found =
    lists.find((l) => l.name.toLowerCase() === target) ||
    lists.find((l) => l.name.toLowerCase().includes(target)) ||
    lists.find((l) => target.includes(l.name.toLowerCase()));
  return found ? { id: found.id, couple_id: found.couple_id, name: found.name } : null;
}

/** Fetch the user's most recently touched lists for smart routing.
 *  Bounded by 30 to keep the classifier prompt under budget. RLS scopes
 *  to the user/couple. */
async function fetchExistingListsForRouting(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  coupleId: string | null,
): Promise<Array<{ id: string; name: string; couple_id: string | null }>> {
  const { data, error } = await supabase
    .from('clerk_lists')
    .select('id, name, couple_id')
    .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
    .order('updated_at', { ascending: false })
    .limit(30);
  if (error) {
    console.warn('[SAVE_ARTIFACT] Failed to fetch existing lists:', error);
    return [];
  }
  return data ?? [];
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

    // Smart-save routing (Apr 2026): fetch the user's existing lists ONCE
    // and reuse them for (a) explicit "in my X list" matching, (b)
    // classifier prompt enrichment, (c) resolver equivalence checks.
    // When the feature flag is off, we skip the fetch + classifier enrichment
    // and behavior is identical to the pre-flag path (only explicit mentions
    // populate list_id).
    const smartRouting = smartSaveRoutingEnabled();
    let existingLists: Array<{ id: string; name: string; couple_id: string | null }> = [];
    if (smartRouting) {
      existingLists = await fetchExistingListsForRouting(
        ctx.supabase,
        ctx.userId,
        ctx.coupleId,
      );
    }

    const classification = await classifyArtifact({
      artifactContent: artifact.content,
      artifactRequest: artifact.request,
      callAI: deps.callAI,
      tracker: ctx.tracker,
      promptVersion: deps.promptVersion,
      existingLists: smartRouting
        ? existingLists.map((l) => ({ name: l.name }))
        : undefined,
    });

    const notePayload = buildNotePayload(ctx, artifact, classification);

    // STEP 1 — explicit "in my X list" mention ALWAYS wins (preserves the
    // pre-Apr-2026 contract for power users who hand-route their saves).
    const explicitMention = await resolveListMention(
      ctx.supabase,
      ctx.userId,
      ctx.coupleId,
      ctx.messageBody,
      existingLists.length > 0 ? existingLists : undefined,
    );
    let routedListName: string | null = null;
    let routedCreated = false;
    if (explicitMention) {
      notePayload.list_id = explicitMention.id;
      notePayload.couple_id = explicitMention.couple_id ?? ctx.effectiveCoupleId;
      routedListName = explicitMention.name;
    } else if (smartRouting && existingLists.length >= 0) {
      // STEP 2 — smart resolver. Pass the AI's nomination + existing lists.
      const userLists: UserList[] = existingLists.map((l) => ({
        id: l.id,
        name: l.name,
      }));
      const resolved = await resolveSaveTargetList({
        supabase: ctx.supabase,
        userId: ctx.userId,
        coupleId: ctx.coupleId,
        // Personal scope for saved chat replies — couple/space contexts are
        // not currently surfaced via the session. A future migration can
        // thread a space_id through HandlerContext if shared SAVE_ARTIFACT
        // routing into couple spaces becomes a requirement.
        spaceId: null,
        existingLists: userLists,
        aiSuggestion: {
          name: classification.target_list_name,
          isNew: classification.is_new_list,
          confidence: classification.confidence,
        },
        classification: {
          category: classification.category,
          tags: classification.tags,
          title: classification.title,
        },
      });
      if (resolved) {
        notePayload.list_id = resolved.listId;
        // Couple-scope inheritance: if the matched list belongs to a couple,
        // carry that scope onto the note so RLS lets both members see it.
        const matched = existingLists.find((l) => l.id === resolved.listId);
        if (matched) {
          notePayload.couple_id = matched.couple_id ?? ctx.effectiveCoupleId;
        }
        routedListName = resolved.listName;
        routedCreated = resolved.created;
      }
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

    // Resolve the list name for the confirmation copy. Prefer the in-scope
    // name from smart routing / explicit mention so we don't re-query.
    let listNameForCopy = routedListName;
    if (!listNameForCopy && savedListId) {
      const { data: listInfo } = await ctx.supabase
        .from('clerk_lists')
        .select('name')
        .eq('id', savedListId)
        .single();
      if (listInfo) listNameForCopy = (listInfo as { name: string }).name;
    }

    // Pick the right copy variant:
    //  - new list auto-created (routedCreated=true) → "to a new list *X*"
    //  - matched an existing list / explicit mention → "in your *X* list"
    //  - no list at all → leave the list slot out entirely
    let replyText: string;
    if (routedCreated && listNameForCopy) {
      replyText = deps.t('artifact_saved_new_list', ctx.userLang, {
        title: savedSummary,
        list: listNameForCopy,
      });
    } else if (listNameForCopy) {
      replyText = deps.t('artifact_saved', ctx.userLang, {
        title: savedSummary,
        list: ` in your *${listNameForCopy}* list`,
      });
    } else {
      replyText = deps.t('artifact_saved_no_list', ctx.userLang, {
        title: savedSummary,
      });
    }

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

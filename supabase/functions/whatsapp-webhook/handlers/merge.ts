// handlers/merge.ts — MERGE intent handler.
// ============================================================================
// Initiative 1.8 of OLIVE_REFACTOR_PLAN.md. Extracts the smallest of the four
// 1.8 blocks (~60 lines). The MERGE intent fires when the user says "merge"
// after Olive saved a brain-dump that they realize is a duplicate of an
// existing task.
//
// Responsibilities (in order):
//   1. Find the most-recent (last 5min) note authored by the user.
//   2. Use its embedding (or generate one) to find the closest existing
//      note via `findSimilarNotes` cosine similarity.
//   3. If a target is found, freeze a `merge` pending_action and return
//      a confirm_merge prompt. The actual merge runs when the user
//      confirms (handled by the existing confirmation dispatcher).
//   4. If nothing recent OR nothing similar, return a localized
//      "no recent" / "no similar" message.
//
// Pure-ish handler: external dependencies (`t`, `generateEmbedding`)
// injected via the factory. The webhook dispatch site wires its real
// implementations; tests pass stubs.

import { findSimilarNotes } from "../../_shared/task-search.ts";
import type {
  Handler,
  HandlerContext,
  Reply,
} from "../../_shared/types.ts";

export interface MergeDeps {
  t: (key: string, lang: string, vars?: Record<string, string>) => string;
  generateEmbedding: (text: string) => Promise<number[] | null>;
}

export function makeMergeHandler(deps: MergeDeps): Handler {
  return async (ctx: HandlerContext): Promise<Reply> => {
    const { t, generateEmbedding } = deps;
    const { supabase, userId, userLang, coupleId, session } = ctx;

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { data: recentNotes, error: recentError } = await supabase
      .from('clerk_notes')
      .select('id, summary, embedding, created_at')
      .eq('author_id', userId)
      .eq('completed', false)
      .gte('created_at', fiveMinutesAgo)
      .order('created_at', { ascending: false })
      .limit(1);

    if (recentError || !recentNotes || recentNotes.length === 0) {
      return { text: t('merge_no_recent', userLang) };
    }

    const sourceNote = recentNotes[0];
    let targetNote: { id: string; summary: string } | null = null;

    if (sourceNote.embedding) {
      const similar = await findSimilarNotes(supabase, userId, coupleId, sourceNote.embedding, sourceNote.id);
      if (similar) {
        targetNote = { id: similar.id, summary: similar.summary };
      }
    }

    if (!targetNote) {
      const embedding = await generateEmbedding(sourceNote.summary);
      if (embedding) {
        const similar = await findSimilarNotes(supabase, userId, coupleId, embedding, sourceNote.id);
        if (similar) {
          targetNote = { id: similar.id, summary: similar.summary };
        }
      }
    }

    if (!targetNote) {
      return { text: t('merge_no_similar', userLang, { task: sourceNote.summary }) };
    }

    // NOTE: monolith deliberately does NOT spread existing context_data here;
    // this drops other session state on the floor when the merge offer is
    // staged. Behavior preserved verbatim for the refactor — a follow-up
    // PR should add `...currentCtx` to match the rest of the pending_action
    // call sites in 1.7b.
    await supabase
      .from('user_sessions')
      .update({
        conversation_state: 'AWAITING_CONFIRMATION',
        context_data: {
          pending_action: {
            type: 'merge',
            source_id: sourceNote.id,
            source_summary: sourceNote.summary,
            target_id: targetNote.id,
            target_summary: targetNote.summary,
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.id);

    return { text: t('confirm_merge', userLang, { source: sourceNote.summary, target: targetNote.summary }) };
  };
}

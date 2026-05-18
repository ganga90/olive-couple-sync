// handlers/create-list.ts — CREATE_LIST intent handler.
// ============================================================================
// Initiative 1.8 of OLIVE_REFACTOR_PLAN.md. Owns the explicit-list-creation
// path ("create a Travel list", "make me a Books list with item1, item2").
//
// Responsibilities (in order):
//   1. Pull `_listName` from the AI classifier (fallback to cleanMessage).
//      Reject if shorter than 2 chars.
//   2. Look up the user's lists (own + couple-scoped) — match by name AND
//      privacy scope so users CAN have "Work" (private) and "Work" (shared)
//      as separate lists. If a same-scope match exists, return the
//      `list_already_exists` localized copy with active-item count.
//   3. Title-case the list name and insert into clerk_lists with the
//      effective couple scope.
//   4. If `_initialItems` is set (comma/semicolon/newline-separated), split
//      and bulk-insert one note per item via `insertNotesBatch`.
//   5. Build the success reply ("Created list X" + item count + manage link)
//      and stamp it as the referenced output via saveReferencedEntity.
//
// Pure-ish handler: external dependencies (`t`, `saveReferencedEntity`)
// injected via the factory. `insertNotesBatch` is imported statically — it's
// a thin Supabase wrapper that already handles RLS and source_ref normalization.

import { insertNotesBatch } from "../../_shared/note-insert.ts";
import type {
  Handler,
  HandlerContext,
  Reply,
} from "../../_shared/types.ts";

export type SaveReferencedEntityFn = (
  task: { id: string; summary: string; due_date?: string; list_id?: string; priority?: string } | null,
  oliveResponse: string,
  displayedList?: Array<{ id: string; summary: string }>,
) => Promise<void>;

export interface CreateListDeps {
  t: (key: string, lang: string, vars?: Record<string, string>) => string;
  saveReferencedEntity: SaveReferencedEntityFn;
}

export function makeCreateListHandler(deps: CreateListDeps): Handler {
  return async (ctx: HandlerContext): Promise<Reply> => {
    const { t, saveReferencedEntity } = deps;
    const {
      supabase, userId, userLang, coupleId, effectiveCoupleId,
      cleanMessage, wamid, inboundNoteSource, intentResult,
    } = ctx;

    // deno-lint-ignore no-explicit-any
    const intentResultAny = intentResult as any;
    const listName = (intentResultAny._listName as string | undefined) || cleanMessage || '';
    const initialItemsRaw = (intentResultAny._initialItems as string | undefined) || '';
    console.log('[CREATE_LIST] Creating list:', listName, '| initial items:', initialItemsRaw?.substring(0, 80));

    if (!listName || listName.trim().length < 2) {
      return { text: t('list_no_name', userLang) };
    }

    // Check for same-name + same-privacy duplicates. Users CAN have
    // "Work" (private) and "Work" (shared) as separate lists.
    const { data: existingLists } = await supabase
      .from('clerk_lists')
      .select('id, name, couple_id')
      .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`);

    const normalizedNewName = listName.toLowerCase().trim();
    const existingMatch = existingLists?.find((l: { name: string; couple_id: string | null }) => {
      const nameMatch = l.name.toLowerCase().trim() === normalizedNewName;
      if (!nameMatch) return false;
      const existingIsShared = l.couple_id !== null;
      const newIsShared = effectiveCoupleId !== null;
      return existingIsShared === newIsShared;
    });

    if (existingMatch) {
      const { data: existingItems } = await supabase
        .from('clerk_notes')
        .select('id')
        .eq('list_id', existingMatch.id)
        .eq('completed', false);

      const count = existingItems?.length || 0;
      return {
        text: t('list_already_exists', userLang, {
          list: existingMatch.name,
          count: String(count),
          plural: count !== 1 ? 's' : '',
        }),
      };
    }

    // Title-case the new list name.
    const formattedName = listName.trim()
      .split(/\s+/)
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');

    const { data: newList, error: createError } = await supabase
      .from('clerk_lists')
      .insert({
        name: formattedName,
        author_id: userId,
        couple_id: effectiveCoupleId,
        is_manual: true,
        description: `Created via WhatsApp`,
      })
      .select('id, name')
      .single();

    if (createError || !newList) {
      console.error('[CREATE_LIST] Insert error:', createError);
      return { text: 'Sorry, I couldn\'t create that list. Please try again.' };
    }

    console.log('[CREATE_LIST] Created list:', newList.name, newList.id);

    let itemsCreated = 0;
    if (initialItemsRaw && initialItemsRaw.trim().length > 0) {
      const items = initialItemsRaw
        .split(/[,;\n]+/)
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 1);

      if (items.length > 0) {
        const notesToInsert = items.map((item: string) => ({
          author_id: userId,
          couple_id: effectiveCoupleId,
          source: inboundNoteSource,
          source_ref: wamid,
          original_text: item,
          summary: item,
          category: formattedName.toLowerCase().replace(/\s+/g, '_'),
          list_id: newList.id,
          priority: 'medium',
          completed: false,
          tags: [],
          items: [],
        }));

        const { error: itemsError } = await insertNotesBatch(supabase, notesToInsert);
        if (!itemsError) {
          itemsCreated = items.length;
        } else {
          console.error('[CREATE_LIST] Items insert error:', itemsError);
        }
      }
    }

    let response = `📋 Created list: *${newList.name}*\n`;
    if (itemsCreated > 0) {
      response += `✅ Added ${itemsCreated} item${itemsCreated > 1 ? 's' : ''}\n`;
    }
    response += `\n💡 Now just send items and they'll be automatically sorted here!\n`;
    response += `📂 Say "show my ${newList.name} list" to view it\n`;
    response += `🔗 Manage: https://witholive.app`;

    await saveReferencedEntity(null, response);
    return { text: response };
  };
}

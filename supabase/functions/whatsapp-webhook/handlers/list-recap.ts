// handlers/list-recap.ts — LIST_RECAP intent handler.
// ============================================================================
// Initiative 1.8 of OLIVE_REFACTOR_PLAN.md. Owns the "recap my X list" path.
// Generates an AI-rendered detailed review of a single list, with a
// deterministic structured fallback when the AI call fails.
//
// Responsibilities (in order):
//   1. Smart list lookup — fuzzy name match (normalize + singularize +
//      contains) against the user's lists. If no match, return the
//      list_not_found prompt with a sample of available list names.
//   2. Fetch up to 50 items from the matched list (active + completed).
//      Empty list → list_empty prompt.
//   3. Bucket items: active / completed / urgent / overdue / has-due.
//   4. Build a rich AI prompt that includes status, priority, due,
//      reminder, owner, and sub-items for each row.
//   5. Call AI (standard tier) with the localized-language directive.
//      Stamp the displayed list (first 10 active items) as referenced.
//   6. On AI failure, render a deterministic structured fallback that
//      still groups urgent / overdue / active and keeps locale-aware
//      dates via `formatFriendlyDate`.
//
// Pure-ish handler: external dependencies (`callAI`, `t`,
// `saveReferencedEntity`) injected via the factory.

import { formatFriendlyDate } from "../../_shared/whatsapp-messaging.ts";
import { langName } from "../../_shared/whatsapp-localization.ts";
import { WA_LIST_RECAP_PROMPT_VERSION } from "../../_shared/prompts/whatsapp-prompts.ts";
import type { LLMTracker } from "../../_shared/llm-tracker.ts";
import type {
  Handler,
  HandlerContext,
  Reply,
} from "../../_shared/types.ts";

export type ListRecapCallAI = (
  systemPrompt: string,
  userMessage: string,
  temperature: number,
  tier: string,
  tracker?: LLMTracker | null,
  promptVersion?: string,
) => Promise<string>;

export type SaveReferencedEntityFn = (
  task: { id: string; summary: string; due_date?: string; list_id?: string; priority?: string } | null,
  oliveResponse: string,
  displayedList?: Array<{ id: string; summary: string }>,
) => Promise<void>;

export interface ListRecapDeps {
  callAI: ListRecapCallAI;
  t: (key: string, lang: string, vars?: Record<string, string>) => string;
  saveReferencedEntity: SaveReferencedEntityFn;
}

// ─── Pure list-name normalization helpers (exported for tests) ─────────

export function normalizeListName(name: string): string {
  return name.toLowerCase().replace(/\b(the|a|an|my|our)\b/g, '').replace(/\s+/g, ' ').trim();
}

export function singularizeListName(word: string): string {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function matchListByName<L extends { id: string; name: string }>(
  candidates: L[],
  query: string,
): L | null {
  const searchNormalized = normalizeListName(query);
  const searchSingular = singularizeListName(searchNormalized);
  for (const list of candidates) {
    const nln = normalizeListName(list.name);
    const nlnS = singularizeListName(nln);
    if (
      nln === searchNormalized
      || nlnS === searchSingular
      || nln.includes(searchNormalized)
      || searchNormalized.includes(nln)
      || nlnS.includes(searchSingular)
      || searchSingular.includes(nlnS)
    ) {
      return list;
    }
  }
  return null;
}

// ─── Factory ───────────────────────────────────────────────────────────

export function makeListRecapHandler(deps: ListRecapDeps): Handler {
  return async (ctx: HandlerContext): Promise<Reply> => {
    const { callAI, t, saveReferencedEntity } = deps;
    const {
      supabase, userId, userLang, coupleId, cleanMessage, effectiveMessage,
      profile, tracker, intentResult,
    } = ctx;

    // deno-lint-ignore no-explicit-any
    const targetListName = ((intentResult as any)._listName as string | undefined)
      || cleanMessage || effectiveMessage || '';
    console.log('[LIST_RECAP] Generating recap for list:', targetListName);

    const { data: allLists } = await supabase
      .from('clerk_lists')
      .select('id, name, description, created_at')
      .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`);

    if (!allLists || allLists.length === 0) {
      return { text: '📋 You don\'t have any lists yet! Try "create a list about [topic]" to get started.' };
    }

    const matchedList = matchListByName(
      allLists as Array<{ id: string; name: string; description: string | null; created_at: string }>,
      targetListName,
    );

    if (!matchedList) {
      const listNames = allLists.slice(0, 8).map((l: { name: string }) => `• ${l.name}`).join('\n');
      return { text: t('list_not_found', userLang, { query: targetListName, lists: listNames }) };
    }

    const { data: listItems } = await supabase
      .from('clerk_notes')
      .select('id, summary, original_text, category, priority, due_date, reminder_time, completed, created_at, items, tags, task_owner')
      .eq('list_id', matchedList.id)
      .order('completed', { ascending: true })
      .order('priority', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(50);

    if (!listItems || listItems.length === 0) {
      return { text: t('list_empty', userLang, { list: matchedList.name }) };
    }

    // deno-lint-ignore no-explicit-any
    const activeItems = listItems.filter((i: any) => !i.completed);
    // deno-lint-ignore no-explicit-any
    const completedItems = listItems.filter((i: any) => i.completed);
    // deno-lint-ignore no-explicit-any
    const urgentItems = activeItems.filter((i: any) => i.priority === 'high');
    // deno-lint-ignore no-explicit-any
    const overdueItems = activeItems.filter((i: any) => i.due_date && new Date(i.due_date) < new Date());
    // deno-lint-ignore no-explicit-any
    const withDueDate = activeItems.filter((i: any) => i.due_date);

    // Build rich context for AI recap.
    let itemsContext = '';
    // deno-lint-ignore no-explicit-any
    listItems.forEach((item: any, i: number) => {
      const status = item.completed ? '✅' : '⬜';
      const priority = item.priority === 'high' ? ' 🔥' : '';
      const dueInfo = item.due_date ? ` | Due: ${formatFriendlyDate(item.due_date, true, profile.timezone ?? undefined, userLang)}` : '';
      const reminderInfo = item.reminder_time ? ` | ⏰ ${formatFriendlyDate(item.reminder_time, true, profile.timezone ?? undefined, userLang)}` : '';
      const owner = item.task_owner ? ` | Assigned: ${item.task_owner}` : '';
      itemsContext += `${i + 1}. ${status} ${item.summary}${priority}${dueInfo}${reminderInfo}${owner}\n`;
      if (item.original_text && item.original_text !== item.summary) {
        itemsContext += `   Details: ${item.original_text.substring(0, 300)}\n`;
      }
      if (item.items && item.items.length > 0) {
        item.items.forEach((sub: string) => {
          itemsContext += `   • ${sub}\n`;
        });
      }
    });

    const recapPrompt = `You are Olive, generating a detailed recap/review of the user's "${matchedList.name}" list.

## LIST DATA:
- List: ${matchedList.name}
- Description: ${matchedList.description || 'None'}
- Total items: ${listItems.length} (${activeItems.length} active, ${completedItems.length} completed)
- Urgent items: ${urgentItems.length}
- Overdue items: ${overdueItems.length}
- Items with due dates: ${withDueDate.length}
- Created: ${new Date(matchedList.created_at).toLocaleDateString()}

## ALL ITEMS:
${itemsContext}

## YOUR TASK:
Generate a DETAILED, organized recap that includes:
1. **Overview** — Quick status summary (total, active, completed, urgent)
2. **Active Items** — List each active item with full details, due dates, and priorities
3. **Action Needed** — Highlight overdue or urgent items that need attention NOW
4. **Completed** — Brief mention of what's been done (count and optionally names)
5. **Insights** — Any patterns or suggestions (e.g., "3 items are overdue", "most items have no due date set")

FORMAT for WhatsApp (max 1500 chars):
- Use *bold* for headers
- Use emojis for visual clarity
- Be concise but thorough
- Group items logically
- End with an actionable suggestion`;

    const recapLangName = langName(userLang);
    const fullRecapPrompt = recapLangName !== 'English'
      ? recapPrompt + `\n\nIMPORTANT: Respond entirely in ${recapLangName}.`
      : recapPrompt;

    try {
      const recapResponse = await callAI(
        fullRecapPrompt,
        `Recap my ${matchedList.name} list`,
        0.7,
        'standard',
        tracker,
        WA_LIST_RECAP_PROMPT_VERSION,
      );

      const displayedItems = activeItems.slice(0, 10);
      if (displayedItems.length > 0) {
        await saveReferencedEntity(
          displayedItems[0],
          recapResponse,
          // deno-lint-ignore no-explicit-any
          displayedItems.map((it: any) => ({ id: it.id, summary: it.summary })),
        );
      } else {
        await saveReferencedEntity(null, recapResponse);
      }

      return { text: recapResponse.slice(0, 1500) };
    } catch (aiError) {
      console.error('[LIST_RECAP] AI error, using fallback:', aiError);

      // Deterministic structured fallback.
      let fallback = `📋 *${matchedList.name}* Recap\n\n`;
      fallback += `📊 ${activeItems.length} active | ${completedItems.length} done`;
      if (urgentItems.length > 0) fallback += ` | ${urgentItems.length} urgent 🔥`;
      if (overdueItems.length > 0) fallback += ` | ${overdueItems.length} overdue ⚠️`;
      fallback += '\n\n';

      if (urgentItems.length > 0) {
        fallback += `🔥 *Urgent:*\n`;
        // deno-lint-ignore no-explicit-any
        urgentItems.slice(0, 5).forEach((item: any, i: number) => {
          fallback += `${i + 1}. ${item.summary}\n`;
        });
        fallback += '\n';
      }

      if (overdueItems.length > 0) {
        fallback += `⚠️ *Overdue:*\n`;
        // deno-lint-ignore no-explicit-any
        overdueItems.slice(0, 5).forEach((item: any, i: number) => {
          const days = Math.floor((Date.now() - new Date(item.due_date!).getTime()) / 86400000);
          fallback += `${i + 1}. ${item.summary} (${days}d overdue)\n`;
        });
        fallback += '\n';
      }

      const regularItems = activeItems.filter(
        // deno-lint-ignore no-explicit-any
        (i: any) => i.priority !== 'high' && !(i.due_date && new Date(i.due_date) < new Date()),
      );
      if (regularItems.length > 0) {
        fallback += `📝 *Active:*\n`;
        // deno-lint-ignore no-explicit-any
        regularItems.slice(0, 8).forEach((item: any, i: number) => {
          const due = item.due_date ? ` (${formatFriendlyDate(item.due_date, false, profile.timezone ?? undefined, userLang)})` : '';
          fallback += `${i + 1}. ${item.summary}${due}\n`;
        });
        if (regularItems.length > 8) fallback += `...and ${regularItems.length - 8} more\n`;
      }

      fallback += `\n🔗 Manage: https://witholive.app`;

      const displayedFallback = activeItems.slice(0, 10);
      if (displayedFallback.length > 0) {
        await saveReferencedEntity(
          displayedFallback[0],
          fallback,
          // deno-lint-ignore no-explicit-any
          displayedFallback.map((it: any) => ({ id: it.id, summary: it.summary })),
        );
      }
      return { text: fallback };
    }
  };
}

// handlers/search.ts — SEARCH intent handler.
// ============================================================================
// Initiative 1.8 of OLIVE_REFACTOR_PLAN.md. Largest of the four 1.8 blocks
// (~620 lines). Powers the "show my X / what's urgent / today / tomorrow /
// this week / overdue / recent" dashboard queries plus the smart list
// lookup path ("what's on my Travel list?").
//
// Responsibilities (in order):
//   1. Fetch the user's last 100 incomplete-or-complete notes + all lists.
//      Build a listId → name map for matching.
//   2. SMART LIST LOOKUP — try AI-provided `_listName` first, then regex
//      patterns over the cleaned message. On match, fetch the WHOLE list
//      directly (not constrained by the 100-recency window) and render
//      the numbered items + stamp them as the displayed list.
//   3. ARBITRARY-DATE AGENDA — when classifier carries a parsed-date
//      expression that isn't today/tomorrow, render that day's agenda
//      (tasks + calendar events).
//   4. queryType dashboards — urgent / today / tomorrow / this_week /
//      overdue / recent. Each renders a numbered list, stamps the first
//      task + the full slice as displayed list for ordinal references.
//   5. SMART ESCALATION — when the message LOOKS like a content question
//      ("what / where / which / how / do I have ...") and no dashboard
//      slot matched, escalate to CONTEXTUAL_ASK via the `escalate_to`
//      field on the returned Reply. The dispatcher mutates `intent`
//      and falls through to the CONTEXTUAL_ASK handler.
//   6. DEFAULT — generic task summary dashboard ("Your Tasks: Active,
//      Urgent, Due today, Overdue + Recent/Urgent sample").
//
// Pure-ish handler: external dependencies (`t`, `saveReferencedEntity`)
// injected via the factory. `parseNaturalDate`, `formatFriendlyDate`,
// `formatTimeForZone`, etc. imported statically from `_shared`.

import { parseNaturalDate } from "../../_shared/natural-date-parser.ts";
import { formatFriendlyDate } from "../../_shared/whatsapp-messaging.ts";
import {
  formatDateForZone,
  formatTimeForZone,
  getNextWeekBoundaryUtc,
  getRelativeDayWindowUtc,
  isBeforeUtc,
  isInUtcRange,
  parseStoredTimestamp,
} from "../../_shared/timezone-calendar.ts";
import type {
  Handler,
  HandlerContext,
  Reply,
} from "../../_shared/types.ts";

export type QueryType =
  | 'urgent'
  | 'today'
  | 'tomorrow'
  | 'this_week'
  | 'recent'
  | 'overdue'
  | 'general'
  | undefined;

export type SaveReferencedEntityFn = (
  task: { id: string; summary: string; due_date?: string; list_id?: string; priority?: string } | null,
  oliveResponse: string,
  displayedList?: Array<{ id: string; summary: string }>,
) => Promise<void>;

export interface SearchDeps {
  t: (key: string, lang: string, vars?: Record<string, string>) => string;
  saveReferencedEntity: SaveReferencedEntityFn;
}

// ─── Pure helpers (exported for tests) ────────────────────────────────

export function normalizeListName(name: string): string {
  return name.toLowerCase()
    .replace(/\b(the|a|an|my|our)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function singularize(word: string): string {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ves')) return word.slice(0, -3) + 'f';
  if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('zes') || word.endsWith('ches') || word.endsWith('shes')) {
    return word.slice(0, -2);
  }
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

const LIST_EXTRACTION_PATTERNS = [
  /(?:show|display|open|get|see)\s+(?:me\s+)?(?:the\s+|my\s+|our\s+)?(.+?)\s+(?:list|tasks?|items?)$/i,
  /(?:what'?s|whats)\s+(?:in|on)\s+(?:the\s+|my\s+|our\s+)?(.+?)\s+(?:list|tasks?|items?)$/i,
  /^list\s+(?:my\s+|the\s+|our\s+)?(.+?)$/i,
  /^(?:my|our)\s+(.+?)(?:\s+list)?$/i,
  /^(.+?)\s+list$/i,
  /(?:show|display|open|get|see|what'?s\s+in)\s+(?:me\s+)?(?:the\s+|my\s+|our\s+)?(.+?)$/i,
];

const QUESTION_PATTERNS = /^(which|what|where|who|how|do i|did i|any |are there|have i|cuál|qué|dónde|quién|cómo|tengo|hay|quali|cosa|dove|chi|come|ho )\b/i;
const DASHBOARD_QUERY_TYPES = new Set<string>(['urgent', 'today', 'tomorrow', 'this_week', 'overdue', 'recent']);

export function isContentQuestion(message: string): boolean {
  const trimmed = (message || '').trim();
  if (!trimmed) return false;
  return QUESTION_PATTERNS.test(trimmed) || trimmed.endsWith('?');
}

// ─── Factory ───────────────────────────────────────────────────────────

export function makeSearchHandler(deps: SearchDeps): Handler {
  return async (ctx: HandlerContext): Promise<Reply> => {
    const { t, saveReferencedEntity } = deps;
    const {
      supabase, userId, userLang, coupleId, session: _session,
      effectiveMessage, profile, intentResult,
    } = ctx;
    void _session;

    // deno-lint-ignore no-explicit-any
    const queryType = (intentResult as any).queryType as QueryType;

    const { data: tasks } = await supabase
      .from('clerk_notes')
      .select('id, summary, due_date, completed, priority, category, list_id, items, task_owner, created_at')
      .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
      .order('created_at', { ascending: false })
      .limit(100);

    const { data: lists } = await supabase
      .from('clerk_lists')
      .select('id, name, description')
      .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`);

    const listIdToName = new Map<string, string>(
      // deno-lint-ignore no-explicit-any
      (lists || []).map((l: any) => [l.id, l.name]),
    );

    // ── SMART LIST LOOKUP ─────────────────────────────────────────────

    const cleanedMessage = (effectiveMessage || '').replace(/[?!.]+$/, '').trim();
    let specificList: string | null = null;
    let matchedListName: string | null = null;

    // deno-lint-ignore no-explicit-any
    const aiListName = (intentResult as any)._listName as string | undefined;
    if (aiListName) {
      const aiNormalized = normalizeListName(aiListName);
      const aiSingular = singularize(aiNormalized);
      console.log('[WhatsApp] AI provided list_name:', aiListName, '→ normalized:', aiNormalized);

      for (const [listId, listName] of listIdToName) {
        const nln = normalizeListName(listName);
        const nlnS = singularize(nln);
        if (nln === aiNormalized || nlnS === aiSingular || nln.includes(aiNormalized) || aiNormalized.includes(nln) || nlnS.includes(aiSingular) || aiSingular.includes(nlnS)) {
          specificList = listId;
          matchedListName = listName;
          console.log(`[WhatsApp] AI list match: "${aiListName}" → "${matchedListName}"`);
          break;
        }
      }
    }

    if (!specificList) {
      for (const pattern of LIST_EXTRACTION_PATTERNS) {
        const match = cleanedMessage.match(pattern);
        if (!match) continue;

        const rawExtracted = normalizeListName(match[1]);
        if (!rawExtracted || rawExtracted.length < 2) continue;

        const genericWords = new Set(['tasks', 'task', 'all', 'everything', 'stuff', 'things', 'my', 'me', 'the']);
        if (genericWords.has(rawExtracted)) continue;

        const extractedSingular = singularize(rawExtracted);

        for (const [listId, listName] of listIdToName) {
          const normalizedListName = normalizeListName(listName);
          const listNameSingular = singularize(normalizedListName);

          if (normalizedListName === rawExtracted || normalizedListName === extractedSingular) {
            specificList = listId;
            matchedListName = listName;
            break;
          }
          if (listNameSingular === extractedSingular) {
            specificList = listId;
            matchedListName = listName;
            break;
          }
          if (normalizedListName.includes(rawExtracted) || rawExtracted.includes(normalizedListName)) {
            specificList = listId;
            matchedListName = listName;
            break;
          }
          if (listNameSingular.includes(extractedSingular) || extractedSingular.includes(listNameSingular)) {
            specificList = listId;
            matchedListName = listName;
            break;
          }
        }

        if (specificList) {
          console.log(`[WhatsApp] Regex list matched: "${match[1]}" → "${matchedListName}"`);
          break;
        }
      }
    }

    if (specificList && tasks) {
      // Targeted list fetch (no recency cap) — heavy users have lists with
      // items older than the 100-recent slice.
      const { data: listTasksDirect } = await supabase
        .from('clerk_notes')
        .select('id, summary, due_date, completed, priority, category, list_id, items, task_owner, original_text')
        .eq('list_id', specificList)
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
        .order('created_at', { ascending: false });

      const allListTasks = listTasksDirect || [];
      // deno-lint-ignore no-explicit-any
      const relevantTasks = allListTasks.filter((row: any) => !row.completed);
      // deno-lint-ignore no-explicit-any
      const completedInList = allListTasks.filter((row: any) => row.completed);

      console.log('[WhatsApp/SEARCH] Targeted list fetch:', matchedListName, '→', allListTasks.length, 'total |', relevantTasks.length, 'active');

      if (relevantTasks.length === 0) {
        const emptyMsg = completedInList.length > 0
          ? `Your ${matchedListName} list is all done! ✅ (${completedInList.length} completed item${completedInList.length > 1 ? 's' : ''})`
          : `Your ${matchedListName} list is empty! 🎉`;
        return { text: emptyMsg };
      }

      // deno-lint-ignore no-explicit-any
      const itemsList = relevantTasks.map((task: any, i: number) => {
        const subs = task.items && task.items.length > 0 ? `\n  ${task.items.join('\n  ')}` : '';
        const priority = task.priority === 'high' ? ' 🔥' : '';
        const dueInfo = task.due_date
          ? t('label_task_due_paren', userLang, { date: formatFriendlyDate(task.due_date, true, profile.timezone ?? undefined, userLang) })
          : '';
        return `${i + 1}. ${task.summary}${priority}${dueInfo}${subs}`;
      }).join('\n\n');

      const searchListResponse = `📋 ${matchedListName} (${relevantTasks.length}):\n\n${itemsList}\n\n💡 Say "done with [task]" to complete items`;
      await saveReferencedEntity(
        relevantTasks[0],
        searchListResponse,
        // deno-lint-ignore no-explicit-any
        relevantTasks.map((row: any) => ({ id: row.id, summary: row.summary })),
      );
      return { text: searchListResponse };
    }

    // ── No tasks at all? ─────────────────────────────────────────────
    if (!tasks || tasks.length === 0) {
      return { text: 'You don\'t have any tasks yet! Send me something to save like "Buy groceries tomorrow" 🛒' };
    }

    // deno-lint-ignore no-explicit-any
    const activeTasks = tasks.filter((row: any) => !row.completed);
    // deno-lint-ignore no-explicit-any
    const urgentTasks = activeTasks.filter((row: any) => row.priority === 'high');
    const now = new Date();
    const userTimezone = profile.timezone || 'UTC';
    const todayWindow = getRelativeDayWindowUtc(now, userTimezone, 0);
    const tomorrowWindow = getRelativeDayWindowUtc(now, userTimezone, 1);

    // deno-lint-ignore no-explicit-any
    const dueTodayTasks = activeTasks.filter((row: any) => isInUtcRange(row.due_date, todayWindow.start, todayWindow.end));
    // deno-lint-ignore no-explicit-any
    const overdueTasks = activeTasks.filter((row: any) => isBeforeUtc(row.due_date, todayWindow.start));

    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    // deno-lint-ignore no-explicit-any
    const recentTasks = activeTasks.filter((row: any) => new Date(row.created_at) >= oneDayAgo);

    // ── ARBITRARY-DATE AGENDA ─────────────────────────────────────────

    // deno-lint-ignore no-explicit-any
    const dueDateExpr = (intentResult as any)._dueDateExpr as string | undefined;
    if (dueDateExpr && (!queryType || queryType === 'general')) {
      try {
        const parsedDate = parseNaturalDate(dueDateExpr, userTimezone, userLang);
        if (parsedDate.date) {
          const targetIso = parsedDate.date;
          const target = new Date(targetIso);
          const msPerDay = 24 * 60 * 60 * 1000;
          const todayMs = todayWindow.start.getTime();
          const targetDayStart = new Date(target);
          targetDayStart.setUTCHours(0, 0, 0, 0);
          const dayOffset = Math.round((targetDayStart.getTime() - todayMs) / msPerDay);

          if (dayOffset !== 0 && dayOffset !== 1) {
            const dateWindow = getRelativeDayWindowUtc(now, userTimezone, dayOffset);

            const dueOnDateTasks = activeTasks.filter(
              // deno-lint-ignore no-explicit-any
              (row: any) => isInUtcRange(row.due_date, dateWindow.start, dateWindow.end),
            );

            let dateCalendarEvents: string[] = [];
            try {
              const { data: dateConnections } = await supabase
                .from('calendar_connections')
                .select('id')
                .eq('user_id', userId)
                .eq('is_active', true);
              if (dateConnections && dateConnections.length > 0) {
                // deno-lint-ignore no-explicit-any
                const connIds = dateConnections.map((c: any) => c.id);
                const { data: events } = await supabase
                  .from('calendar_events')
                  .select('title, start_time, all_day')
                  .in('connection_id', connIds)
                  .gte('start_time', dateWindow.start.toISOString())
                  .lt('start_time', dateWindow.end.toISOString())
                  .order('start_time', { ascending: true })
                  .limit(10);
                // deno-lint-ignore no-explicit-any
                dateCalendarEvents = (events || []).map((e: any) => {
                  if (e.all_day) return `• ${e.title} (all day)`;
                  const time = formatTimeForZone(e.start_time, userTimezone);
                  return `• ${time}: ${e.title}`;
                });
              }
            } catch (calErr) {
              console.warn('[WhatsApp/SEARCH date] Calendar fetch error:', calErr);
            }

            const dateLabel = formatFriendlyDate(
              dateWindow.start.toISOString(),
              false,
              profile.timezone ?? undefined,
              userLang,
            );

            if (dueOnDateTasks.length === 0 && dateCalendarEvents.length === 0) {
              return { text: t('empty_no_date', userLang, { date: dateLabel }) };
            }

            let response = `📅 Agenda for ${dateLabel}:\n`;
            if (dateCalendarEvents.length > 0) {
              response += `\n🗓️ Calendar (${dateCalendarEvents.length}):\n${dateCalendarEvents.join('\n')}\n`;
            }
            if (dueOnDateTasks.length > 0) {
              // deno-lint-ignore no-explicit-any
              const list = dueOnDateTasks.slice(0, 8).map((t2: any, i: number) => {
                const priority = t2.priority === 'high' ? ' 🔥' : '';
                return `${i + 1}. ${t2.summary}${priority}`;
              }).join('\n');
              const moreText = dueOnDateTasks.length > 8 ? `\n...and ${dueOnDateTasks.length - 8} more` : '';
              response += `\n📋 Tasks Due (${dueOnDateTasks.length}):\n${list}${moreText}\n`;
            }
            response += '\n\n🔗 Manage: https://witholive.app';

            const displayedDate = dueOnDateTasks.slice(0, 8);
            if (displayedDate.length > 0) {
              await saveReferencedEntity(
                displayedDate[0],
                response,
                // deno-lint-ignore no-explicit-any
                displayedDate.map((t2: any) => ({ id: t2.id, summary: t2.summary })),
              );
            }
            return { text: response };
          }
        }
      } catch (dateBranchErr) {
        console.warn(
          '[WhatsApp/SEARCH date] Date-scoped branch failed (non-fatal, falling through):',
          dateBranchErr instanceof Error ? dateBranchErr.message : dateBranchErr,
        );
      }
    }

    // ── queryType DASHBOARDS ─────────────────────────────────────────

    if (queryType === 'urgent') {
      if (urgentTasks.length === 0) {
        return { text: t('empty_no_urgent', userLang) };
      }
      // deno-lint-ignore no-explicit-any
      const urgentList = urgentTasks.slice(0, 8).map((task: any, i: number) => {
        const dueInfo = task.due_date
          ? t('label_task_due_paren', userLang, { date: formatFriendlyDate(task.due_date, true, profile.timezone ?? undefined, userLang) })
          : '';
        return `${i + 1}. ${task.summary}${dueInfo}`;
      }).join('\n');
      const moreText = urgentTasks.length > 8 ? `\n\n...and ${urgentTasks.length - 8} more urgent tasks` : '';
      const urgentResponse = `🔥 ${urgentTasks.length} Urgent Task${urgentTasks.length === 1 ? '' : 's'}:\n\n${urgentList}${moreText}\n\n🔗 Manage: https://witholive.app`;
      const displayedUrgent = urgentTasks.slice(0, 8);
      await saveReferencedEntity(
        displayedUrgent[0],
        urgentResponse,
        // deno-lint-ignore no-explicit-any
        displayedUrgent.map((row: any) => ({ id: row.id, summary: row.summary })),
      );
      return { text: urgentResponse };
    }

    if (queryType === 'today') {
      let todayCalendarEvents: string[] = [];
      try {
        const { data: calConnections } = await supabase
          .from('calendar_connections')
          .select('id')
          .eq('user_id', userId)
          .eq('is_active', true);
        if (calConnections && calConnections.length > 0) {
          // deno-lint-ignore no-explicit-any
          const connIds = calConnections.map((c: any) => c.id);
          const { data: events } = await supabase
            .from('calendar_events')
            .select('title, start_time, all_day')
            .in('connection_id', connIds)
            .gte('start_time', todayWindow.start.toISOString())
            .lt('start_time', todayWindow.end.toISOString())
            .order('start_time', { ascending: true })
            .limit(10);
          // deno-lint-ignore no-explicit-any
          todayCalendarEvents = (events || []).map((e: any) => {
            if (e.all_day) return `• ${e.title} (all day)`;
            const time = formatTimeForZone(e.start_time, userTimezone);
            return `• ${time}: ${e.title}`;
          });
        }
      } catch (calErr) {
        console.warn('[WhatsApp] Calendar fetch error for today:', calErr);
      }

      if (dueTodayTasks.length === 0 && todayCalendarEvents.length === 0) {
        return { text: t('empty_no_today', userLang) };
      }

      let response = `📅 Today's Agenda:\n`;
      if (todayCalendarEvents.length > 0) {
        response += `\n🗓️ Calendar (${todayCalendarEvents.length}):\n${todayCalendarEvents.join('\n')}\n`;
      }
      if (dueTodayTasks.length > 0) {
        // deno-lint-ignore no-explicit-any
        const todayList = dueTodayTasks.slice(0, 8).map((row: any, i: number) => {
          const priority = row.priority === 'high' ? ' 🔥' : '';
          return `${i + 1}. ${row.summary}${priority}`;
        }).join('\n');
        const moreText = dueTodayTasks.length > 8 ? `\n...and ${dueTodayTasks.length - 8} more` : '';
        response += `\n📋 Tasks Due (${dueTodayTasks.length}):\n${todayList}${moreText}\n`;
      }
      if (overdueTasks.length > 0) {
        response += `\n⚠️ Also: ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''} to catch up on`;
      }
      response += '\n\n🔗 Manage: https://witholive.app';

      const displayedToday = dueTodayTasks.slice(0, 8);
      if (displayedToday.length > 0) {
        await saveReferencedEntity(
          displayedToday[0],
          response,
          // deno-lint-ignore no-explicit-any
          displayedToday.map((row: any) => ({ id: row.id, summary: row.summary })),
        );
      }
      return { text: response };
    }

    if (queryType === 'tomorrow') {
      const dueTomorrowTasks = activeTasks.filter(
        // deno-lint-ignore no-explicit-any
        (row: any) => isInUtcRange(row.due_date, tomorrowWindow.start, tomorrowWindow.end),
      );
      let tomorrowCalendarEvents: string[] = [];
      try {
        const { data: calConnections } = await supabase
          .from('calendar_connections')
          .select('id')
          .eq('user_id', userId)
          .eq('is_active', true);
        if (calConnections && calConnections.length > 0) {
          // deno-lint-ignore no-explicit-any
          const connIds = calConnections.map((c: any) => c.id);
          const { data: events } = await supabase
            .from('calendar_events')
            .select('title, start_time, all_day')
            .in('connection_id', connIds)
            .gte('start_time', tomorrowWindow.start.toISOString())
            .lt('start_time', tomorrowWindow.end.toISOString())
            .order('start_time', { ascending: true })
            .limit(10);
          // deno-lint-ignore no-explicit-any
          tomorrowCalendarEvents = (events || []).map((e: any) => {
            if (e.all_day) return `• ${e.title} (all day)`;
            const time = formatTimeForZone(e.start_time, userTimezone);
            return `• ${time}: ${e.title}`;
          });
        }
      } catch (calErr) {
        console.warn('[WhatsApp] Calendar fetch error for tomorrow:', calErr);
      }

      if (dueTomorrowTasks.length === 0 && tomorrowCalendarEvents.length === 0) {
        return { text: '📅 Nothing scheduled for tomorrow! Enjoy your free day.\n\n💡 Try "what\'s urgent" to see high-priority tasks' };
      }

      let response = '📅 Tomorrow\'s Agenda:\n';
      if (tomorrowCalendarEvents.length > 0) {
        response += `\n🗓️ Calendar (${tomorrowCalendarEvents.length}):\n${tomorrowCalendarEvents.join('\n')}\n`;
      }
      if (dueTomorrowTasks.length > 0) {
        // deno-lint-ignore no-explicit-any
        const tomorrowList = dueTomorrowTasks.slice(0, 8).map((row: any, i: number) => {
          const priority = row.priority === 'high' ? ' 🔥' : '';
          return `${i + 1}. ${row.summary}${priority}`;
        }).join('\n');
        const moreText = dueTomorrowTasks.length > 8 ? `\n...and ${dueTomorrowTasks.length - 8} more` : '';
        response += `\n📋 Tasks Due (${dueTomorrowTasks.length}):\n${tomorrowList}${moreText}\n`;
      }
      if (overdueTasks.length > 0) {
        response += `\n⚠️ Also: ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''} to catch up on`;
      }
      response += '\n\n🔗 Manage: https://witholive.app';

      const displayedTomorrow = dueTomorrowTasks.slice(0, 8);
      if (displayedTomorrow.length > 0) {
        await saveReferencedEntity(
          displayedTomorrow[0],
          response,
          // deno-lint-ignore no-explicit-any
          displayedTomorrow.map((row: any) => ({ id: row.id, summary: row.summary })),
        );
      }
      return { text: response };
    }

    if (queryType === 'this_week') {
      const endOfWeek = getNextWeekBoundaryUtc(now, userTimezone);
      const dueThisWeekTasks = activeTasks.filter(
        // deno-lint-ignore no-explicit-any
        (row: any) => isInUtcRange(row.due_date, todayWindow.start, endOfWeek),
      );

      let weekCalendarEvents: string[] = [];
      try {
        const { data: calConnections } = await supabase
          .from('calendar_connections')
          .select('id')
          .eq('user_id', userId)
          .eq('is_active', true);
        if (calConnections && calConnections.length > 0) {
          // deno-lint-ignore no-explicit-any
          const connIds = calConnections.map((c: any) => c.id);
          const { data: events } = await supabase
            .from('calendar_events')
            .select('title, start_time, all_day')
            .in('connection_id', connIds)
            .gte('start_time', todayWindow.start.toISOString())
            .lt('start_time', endOfWeek.toISOString())
            .order('start_time', { ascending: true })
            .limit(15);
          // deno-lint-ignore no-explicit-any
          weekCalendarEvents = (events || []).map((e: any) => {
            const dayName = formatDateForZone(e.start_time, userTimezone, { weekday: 'short' });
            if (e.all_day) return `• ${dayName}: ${e.title} (all day)`;
            const time = formatTimeForZone(e.start_time, userTimezone);
            return `• ${dayName} ${time}: ${e.title}`;
          });
        }
      } catch (calErr) {
        console.warn('[WhatsApp] Calendar fetch error for week:', calErr);
      }

      if (dueThisWeekTasks.length === 0 && weekCalendarEvents.length === 0) {
        return { text: '📅 Nothing scheduled for this week! Looks like a clear week ahead.\n\n💡 Try "what\'s urgent" to see high-priority tasks' };
      }

      let response = '📅 This Week\'s Overview:\n';
      if (weekCalendarEvents.length > 0) {
        response += `\n🗓️ Calendar (${weekCalendarEvents.length}):\n${weekCalendarEvents.join('\n')}\n`;
      }
      if (dueThisWeekTasks.length > 0) {
        // deno-lint-ignore no-explicit-any
        const weekList = dueThisWeekTasks.slice(0, 10).map((task: any, i: number) => {
          const priority = task.priority === 'high' ? ' 🔥' : '';
          const dueDate = task.due_date ? formatFriendlyDate(task.due_date, false, profile.timezone ?? undefined, userLang) : '';
          return `${i + 1}. ${task.summary}${priority}${dueDate ? ` (${dueDate})` : ''}`;
        }).join('\n');
        const moreText = dueThisWeekTasks.length > 10 ? `\n...and ${dueThisWeekTasks.length - 10} more` : '';
        response += `\n📋 Tasks Due (${dueThisWeekTasks.length}):\n${weekList}${moreText}\n`;
      }
      if (overdueTasks.length > 0) {
        response += `\n⚠️ Also: ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''} to catch up on`;
      }
      if (urgentTasks.length > 0) {
        response += `\n🔥 ${urgentTasks.length} urgent task${urgentTasks.length > 1 ? 's' : ''} need attention`;
      }
      response += '\n\n🔗 Manage: https://witholive.app';

      const displayedWeek = dueThisWeekTasks.slice(0, 10);
      if (displayedWeek.length > 0) {
        await saveReferencedEntity(
          displayedWeek[0],
          response,
          // deno-lint-ignore no-explicit-any
          displayedWeek.map((row: any) => ({ id: row.id, summary: row.summary })),
        );
      }
      return { text: response };
    }

    if (queryType === 'recent') {
      if (recentTasks.length === 0) {
        const lastFive = activeTasks.slice(0, 5);
        if (lastFive.length === 0) {
          return { text: t('empty_no_recent', userLang) };
        }
        // deno-lint-ignore no-explicit-any
        const recentList = lastFive.map((row: any, i: number) => `${i + 1}. ${row.summary}`).join('\n');
        const recentResponse = `📝 Your Latest Tasks:\n\n${recentList}\n\n🔗 Manage: https://witholive.app`;
        await saveReferencedEntity(
          lastFive[0],
          recentResponse,
          // deno-lint-ignore no-explicit-any
          lastFive.map((row: any) => ({ id: row.id, summary: row.summary })),
        );
        return { text: recentResponse };
      }

      const displayedRecent = recentTasks.slice(0, 8);
      // deno-lint-ignore no-explicit-any
      const recentList = displayedRecent.map((row: any, i: number) => {
        const priority = row.priority === 'high' ? ' 🔥' : '';
        return `${i + 1}. ${row.summary}${priority}`;
      }).join('\n');
      const moreText = recentTasks.length > 8 ? `\n\n...and ${recentTasks.length - 8} more` : '';
      const recentResponse = `🕐 ${recentTasks.length} Task${recentTasks.length === 1 ? '' : 's'} Added Recently:\n\n${recentList}${moreText}\n\n🔗 Manage: https://witholive.app`;
      await saveReferencedEntity(
        displayedRecent[0],
        recentResponse,
        // deno-lint-ignore no-explicit-any
        displayedRecent.map((row: any) => ({ id: row.id, summary: row.summary })),
      );
      return { text: recentResponse };
    }

    if (queryType === 'overdue') {
      if (overdueTasks.length === 0) {
        return { text: '✅ No overdue tasks! You\'re on track.\n\n💡 Try "what\'s due today" to see today\'s tasks' };
      }
      // deno-lint-ignore no-explicit-any
      const overdueList = overdueTasks.slice(0, 8).map((row: any, i: number) => {
        const dueDate = parseStoredTimestamp(row.due_date);
        const daysOverdue = dueDate
          ? Math.max(1, Math.floor((todayWindow.start.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000)))
          : 1;
        return `${i + 1}. ${row.summary} (${daysOverdue}d overdue)`;
      }).join('\n');
      const moreText = overdueTasks.length > 8 ? `\n\n...and ${overdueTasks.length - 8} more` : '';
      const overdueResponse = `⚠️ ${overdueTasks.length} Overdue Task${overdueTasks.length === 1 ? '' : 's'}:\n\n${overdueList}${moreText}\n\n🔗 Manage: https://witholive.app`;
      const displayedOverdue = overdueTasks.slice(0, 8);
      await saveReferencedEntity(
        displayedOverdue[0],
        overdueResponse,
        // deno-lint-ignore no-explicit-any
        displayedOverdue.map((row: any) => ({ id: row.id, summary: row.summary })),
      );
      return { text: overdueResponse };
    }

    // ── SMART ESCALATION → CONTEXTUAL_ASK ─────────────────────────────

    if (isContentQuestion(effectiveMessage || '') && !DASHBOARD_QUERY_TYPES.has(queryType as string)) {
      console.log(
        '[WhatsApp] SEARCH escalating to CONTEXTUAL_ASK — question detected:',
        effectiveMessage?.substring(0, 60), 'queryType:', queryType,
      );
      return { text: '', escalate_to: 'CONTEXTUAL_ASK' };
    }

    // ── DEFAULT — generic task summary dashboard ─────────────────────

    let summary = `📊 Your Tasks:\n`;
    summary += `• Active: ${activeTasks.length}\n`;
    if (urgentTasks.length > 0) summary += `• Urgent: ${urgentTasks.length} 🔥\n`;
    if (dueTodayTasks.length > 0) summary += `• Due today: ${dueTodayTasks.length}\n`;
    if (overdueTasks.length > 0) summary += `• Overdue: ${overdueTasks.length} ⚠️\n`;

    if (urgentTasks.length > 0) {
      summary += `\n⚡ Urgent:\n`;
      // deno-lint-ignore no-explicit-any
      summary += urgentTasks.slice(0, 3).map((row: any, i: number) => `${i + 1}. ${row.summary}`).join('\n');
    } else if (activeTasks.length > 0) {
      summary += `\n📝 Recent:\n`;
      // deno-lint-ignore no-explicit-any
      summary += activeTasks.slice(0, 5).map((row: any, i: number) => `${i + 1}. ${row.summary}`).join('\n');
    }

    summary += '\n\n💡 Try: "what\'s urgent", "what\'s due today", or "show my groceries list"';

    const prominentTask = urgentTasks[0] || dueTodayTasks[0] || activeTasks[0] || null;
    const displayedTasks = urgentTasks.length > 0 ? urgentTasks.slice(0, 3) : activeTasks.slice(0, 5);
    await saveReferencedEntity(
      prominentTask,
      summary,
      // deno-lint-ignore no-explicit-any
      displayedTasks.map((row: any) => ({ id: row.id, summary: row.summary })),
    );
    return { text: summary };
  };
}

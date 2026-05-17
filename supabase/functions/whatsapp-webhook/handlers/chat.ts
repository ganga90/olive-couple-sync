// handlers/chat.ts — CHAT intent handler.
// ============================================================================
// Initiative 1.4 of OLIVE_REFACTOR_PLAN.md. Extracts the largest single intent
// from the monolithic whatsapp-webhook/index.ts — ~1,000 lines of context
// assembly + 11 chat-type prompts + AI call w/ Pro tier fallback + 3 post-
// reply side-effects.
//
// Responsibilities (in order):
//   1. Resolve `chatType` from intent classification (heuristic fallback via
//      `detectChatType` when the AI didn't emit one).
//   2. Fetch the data the chat prompts depend on: tasks, memories, patterns,
//      lists, partner context, calendar, Oura, agent insights, memory files,
//      compact summary, skill match, recent outbound.
//   3. Build per-chat-type system prompt via `_shared/prompts/whatsapp-chat-
//      prompts.ts` (single source of truth for the 11 prompt variants).
//   4. Call AI through the model router. `weekly_summary` + `planning` route
//      to Pro; everything else to Flash (standard). On Pro failure, fall
//      back once to Flash.
//   5. Return a `Reply` carrying the text + 3 after-reply callbacks
//      (session-write, memory evolution, daily log append).
//   6. If the AI throws on the chosen tier (and no Pro→Flash retry applied),
//      render a per-chatType deterministic fallback message.
//
// Fixed (follow-up to Initiative 1.4): the monolith's partner-wellness +
// Oura blocks referenced a bare `today` that was never assigned, so they
// silently no-op'd under the surrounding try/catch. Both helpers now take
// `now: Date` from the handler scope, so briefing replies actually include
// the Oura health block and the partner-wellness signal when applicable.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  getChatSystemPrompt,
  type ChatPromptContext,
} from "../../_shared/prompts/whatsapp-chat-prompts.ts";
import { getWAChatPromptVersion } from "../../_shared/prompts/whatsapp-prompts.ts";
import { langName } from "../../_shared/whatsapp-localization.ts";
import {
  formatTimeForZone,
  getRelativeDayWindowUtc,
  isBeforeUtc,
  isInUtcRange,
} from "../../_shared/timezone-calendar.ts";
import { routeIntent } from "../../_shared/model-router.ts";
import {
  getRecentOutboundMessages,
  type RecentOutbound,
} from "../../_shared/whatsapp-outbound-context.ts";
// `orchestrator.ts` is imported dynamically below to side-step a pre-
// existing TS2345 in `assembleContext` (orchestrator.ts:1448) that would
// otherwise block module-level type-checking. The dynamic-import pattern
// matches the monolith's behavior verbatim (whatsapp-webhook/index.ts
// previously used `await import("../_shared/orchestrator.ts")` for the
// same reason).
import { resolveAddendum } from "../../_shared/prompt-evolution/ab-router.ts";
import { isPendingOfferFresh } from "../../_shared/pending-offer.ts";
import type { LLMTracker } from "../../_shared/llm-tracker.ts";
import type {
  ConversationContext,
  Handler,
  HandlerContext,
  Reply,
} from "../../_shared/types.ts";

// ─── Type definitions ──────────────────────────────────────────────────

/**
 * Canonical chat sub-types the prompt registry knows how to handle. The
 * router may emit other strings (e.g. `help_about_olive` from a few
 * post-classification safety nets) — those fall through to the warm-
 * conversational default in `getChatSystemPrompt`. Keeping the union
 * narrow ensures TS still flags typos when callers build a ChatType
 * literal.
 */
export type ChatType =
  | 'briefing'
  | 'weekly_summary'
  | 'daily_focus'
  | 'productivity_tips'
  | 'progress_check'
  | 'motivation'
  | 'planning'
  | 'greeting'
  | 'help'
  | 'assistant'
  | 'general';

interface SkillMatch {
  matched: boolean;
  skill?: {
    skill_id: string;
    name: string;
    content: string;
    category: string;
  };
  trigger_type?: 'keyword' | 'category' | 'command';
  matched_value?: string;
}

/** Signature of the webhook's `callAI` helper. Injected so tests can mock
 *  Gemini. Matches `whatsapp-webhook/index.ts:851`. */
export type ChatCallAI = (
  systemPrompt: string,
  userMessage: string,
  temperature: number,
  tier: string,
  tracker?: LLMTracker | null,
  promptVersion?: string,
  mediaUrls?: string[],
  userId?: string,
) => Promise<string>;

export interface ChatDeps {
  /** Gemini wrapper. The webhook passes its own; tests pass a script. */
  callAI: ChatCallAI;
  /** i18n — only used by the early-exit `help` chatType for `help_text`. */
  t: (key: string, lang: string, vars?: Record<string, string>) => string;
}

// ─── Regex fallback for chat-type when AI didn't emit one ───────────────
//
// Originally lived at `whatsapp-webhook/index.ts:508`. Used as the last-
// resort classifier for the WhatsApp `/` shortcut path and as a defensive
// floor when the AI router skips chatType.

export function detectChatType(message: string): ChatType {
  const lower = message.toLowerCase();
  if (/^(who\s+are\s+you|what\s+can\s+you\s+do|help\b|commands)/i.test(lower)) return 'help';
  if (/^(hi|hello|hey)\s*[!.]?$/i.test(lower)) return 'greeting';
  return 'general';
}

// ─── Context-assembly helpers ──────────────────────────────────────────
//
// Each helper is a private, side-effect-free (modulo Supabase reads)
// function. They mirror the inline blocks of the monolith verbatim
// (line ranges noted) and are not exported — if a future intent needs
// one, lift it to `_shared/` then.

interface TaskAnalyticsResult {
  taskContext: ChatPromptContext['taskContext'];
  topUrgentTasks: string[];
  topOverdueTasks: string[];
  topTodayTasks: string[];
  topTomorrowTasks: string[];
  todayEvents: Array<{ title: string; start_time: string; all_day: boolean }>;
  overdueTasksCount: number;
  dueTodayCount: number;
}

/** Originally `index.ts:7007–7068`. */
function computeTaskAnalytics(
  allTasks: Array<{
    id?: string; summary: string; due_date?: string | null; completed?: boolean;
    priority?: string; category?: string; list_id?: string | null;
    created_at: string; updated_at?: string | null;
    task_owner?: string | null; author_id?: string;
  }>,
  listIdToName: Map<string, string>,
  userId: string,
  oneWeekAgoIso: number,
  todayStartIso: Date,
  todayEndIso: Date,
  tomorrowStartIso: Date,
  tomorrowEndIso: Date,
): TaskAnalyticsResult {
  const activeTasks = allTasks.filter((t) => !t.completed);
  const completedTasks = allTasks.filter((t) => t.completed);
  const urgentTasks = activeTasks.filter((t) => t.priority === 'high');
  const overdueTasks = activeTasks.filter((t) => isBeforeUtc(t.due_date ?? null, todayStartIso));
  const dueTodayTasks = activeTasks.filter((t) => isInUtcRange(t.due_date ?? null, todayStartIso, todayEndIso));
  const dueTomorrowTasks = activeTasks.filter((t) =>
    isInUtcRange(t.due_date ?? null, tomorrowStartIso, tomorrowEndIso));

  const tasksCreatedThisWeek = allTasks.filter((t) => new Date(t.created_at).getTime() >= oneWeekAgoIso);
  const tasksCompletedThisWeek = completedTasks.filter(
    (t) => t.updated_at && new Date(t.updated_at).getTime() >= oneWeekAgoIso,
  );

  const categoryCount: Record<string, number> = {};
  activeTasks.forEach((t) => {
    const cat = t.category || 'uncategorized';
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  });
  const topCategories = Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat, count]) => `${cat}: ${count}`);

  const listCount: Record<string, number> = {};
  activeTasks.forEach((t) => {
    if (t.list_id) {
      const listName = listIdToName.get(t.list_id) || 'Unknown';
      listCount[listName] = (listCount[listName] || 0) + 1;
    }
  });
  const topLists = Object.entries(listCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([list, count]) => `${list}: ${count}`);

  const yourTasks = activeTasks.filter((t) => t.author_id === userId || t.task_owner === userId);
  const taskContext = {
    total_active: activeTasks.length,
    your_active: yourTasks.length,
    urgent: urgentTasks.length,
    overdue: overdueTasks.length,
    due_today: dueTodayTasks.length,
    due_tomorrow: dueTomorrowTasks.length,
    created_this_week: tasksCreatedThisWeek.length,
    completed_this_week: tasksCompletedThisWeek.length,
    top_categories: topCategories,
    top_lists: topLists,
    completion_rate: tasksCreatedThisWeek.length > 0
      ? Math.round((tasksCompletedThisWeek.length / tasksCreatedThisWeek.length) * 100)
      : 0,
  };

  return {
    taskContext,
    topUrgentTasks: urgentTasks.slice(0, 3).map((t) => t.summary),
    topOverdueTasks: overdueTasks.slice(0, 3).map((t) => t.summary),
    topTodayTasks: dueTodayTasks.slice(0, 3).map((t) => t.summary),
    topTomorrowTasks: dueTomorrowTasks.slice(0, 3).map((t) => t.summary),
    todayEvents: [], // populated by calendar assembly when briefing
    overdueTasksCount: overdueTasks.length,
    dueTodayCount: dueTodayTasks.length,
  };
}

/** Originally `index.ts:6721–6785`. */
async function assemblePartnerContext(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  coupleId: string | null,
  nowMs: number,
): Promise<{ partnerContext: string; partnerName: string }> {
  if (!coupleId) return { partnerContext: '', partnerName: '' };
  try {
    const { data: spaceMembers } = await supabase.rpc('get_space_members', {
      p_couple_id: coupleId,
    });
    if (!spaceMembers || spaceMembers.length === 0) return { partnerContext: '', partnerName: '' };

    // deno-lint-ignore no-explicit-any
    const otherMembers = spaceMembers.filter((m: any) => m.user_id !== userId);
    // deno-lint-ignore no-explicit-any
    const partnerName: string = otherMembers.map((m: any) => m.display_name).join(', ') || 'Partner';
    // deno-lint-ignore no-explicit-any
    const otherUserIds = otherMembers.map((m: any) => m.user_id);

    if (otherUserIds.length === 0) return { partnerContext: '', partnerName };

    const twoDaysAgo = new Date(nowMs - 48 * 60 * 60 * 1000);

    const { data: partnerRecentTasks } = await supabase
      .from('clerk_notes')
      .select('summary, created_at, priority, author_id')
      .in('author_id', otherUserIds)
      .eq('couple_id', coupleId)
      .gte('created_at', twoDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(5);

    const { data: assignedByPartner } = await supabase
      .from('clerk_notes')
      .select('summary, due_date, priority')
      .eq('couple_id', coupleId)
      .in('author_id', otherUserIds)
      .eq('task_owner', userId)
      .eq('completed', false)
      .limit(3);

    const { data: assignedToPartner } = await supabase
      .from('clerk_notes')
      .select('summary, due_date, priority, completed')
      .eq('couple_id', coupleId)
      .eq('author_id', userId)
      .in('task_owner', otherUserIds)
      .eq('completed', false)
      .limit(3);

    const partnerRecentSummaries = partnerRecentTasks?.slice(0, 3).map((t: { summary: string }) => t.summary) || [];
    const assignedToMe = assignedByPartner?.map((t: { summary: string }) => t.summary) || [];
    const myAssignments = assignedToPartner?.map((t: { summary: string }) => t.summary) || [];

    if (partnerRecentSummaries.length === 0 && assignedToMe.length === 0 && myAssignments.length === 0) {
      return { partnerContext: '', partnerName };
    }

    const partnerContext = `
## Member Activity (${partnerName}):
${partnerRecentSummaries.length > 0 ? `- Recently added: ${partnerRecentSummaries.join(', ')}` : ''}
${assignedToMe.length > 0 ? `- Assigned to you: ${assignedToMe.join(', ')}` : ''}
${myAssignments.length > 0 ? `- You assigned to them: ${myAssignments.join(', ')}` : ''}
`;
    return { partnerContext, partnerName };
  } catch (partnerErr) {
    console.error('[WhatsApp Chat] Partner context fetch error (non-blocking):', partnerErr);
    return { partnerContext: '', partnerName: '' };
  }
}

/** Originally `index.ts:6789–6834`. Briefing-only. */
async function assemblePartnerWellness(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  coupleId: string | null,
  partnerName: string,
  chatType: string,
  now: Date,
): Promise<string> {
  if (!coupleId || chatType !== 'briefing') return '';
  try {
    const { data: partnerMemberForWellness } = await supabase
      .from('clerk_couple_members')
      .select('user_id')
      .eq('couple_id', coupleId)
      .neq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (!partnerMemberForWellness?.user_id) return '';

    const { data: partnerOuraConn } = await supabase
      .from('oura_connections')
      .select('share_wellness_with_partner')
      .eq('user_id', partnerMemberForWellness.user_id)
      .eq('is_active', true)
      .maybeSingle();

    if (!partnerOuraConn?.share_wellness_with_partner) return '';

    const todayStr = now.toISOString().split('T')[0];
    const yesterdayStr = new Date(now.getTime() - 86400000).toISOString().split('T')[0];

    const { data: partnerHealth } = await supabase
      .from('oura_daily_data')
      .select('day, readiness_score, sleep_score')
      .eq('user_id', partnerMemberForWellness.user_id)
      .in('day', [todayStr, yesterdayStr])
      .order('day', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (partnerHealth?.readiness_score && partnerHealth.readiness_score < 65) {
      console.log('[WhatsApp Chat] Partner wellness signal included (low readiness)');
      return `\nNote: ${partnerName || 'Your partner'} had a rough night and may appreciate some extra help today.\n`;
    }
    return '';
  } catch (pwErr) {
    console.warn('[WhatsApp Chat] Partner wellness fetch error (non-blocking):', pwErr);
    return '';
  }
}

/** Originally `index.ts:6839–6903`. Briefing-only. */
async function assembleCalendarContext(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  todayWindow: { start: Date; end: Date },
  tomorrowWindow: { start: Date; end: Date },
  isTomorrowQuery: boolean,
  userTimezone: string,
  chatType: string,
): Promise<{
  calendarContext: string;
  todayEvents: Array<{ title: string; start_time: string; all_day: boolean }>;
  tomorrowEvents: Array<{ title: string; start_time: string; all_day: boolean }>;
}> {
  if (chatType !== 'briefing') return { calendarContext: '', todayEvents: [], tomorrowEvents: [] };
  try {
    const { data: calConnections } = await supabase
      .from('calendar_connections')
      .select('id, calendar_name')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (!calConnections || calConnections.length === 0) {
      return { calendarContext: '', todayEvents: [], tomorrowEvents: [] };
    }

    const connIds = calConnections.map((c: { id: string }) => c.id);
    const { data: events } = await supabase
      .from('calendar_events')
      .select('title, start_time, end_time, all_day, location, timezone')
      .in('connection_id', connIds)
      .gte('start_time', todayWindow.start.toISOString())
      .lt('start_time', todayWindow.end.toISOString())
      .order('start_time', { ascending: true })
      .limit(10);

    const todayEvents = events || [];

    const { data: tmrwEvents } = await supabase
      .from('calendar_events')
      .select('title, start_time, end_time, all_day, location, timezone')
      .in('connection_id', connIds)
      .gte('start_time', tomorrowWindow.start.toISOString())
      .lt('start_time', tomorrowWindow.end.toISOString())
      .order('start_time', { ascending: true })
      .limit(10);

    const tomorrowEvents = tmrwEvents || [];

    // deno-lint-ignore no-explicit-any
    const formatEvents = (evts: any[]) => evts.map((e) => {
      if (e.all_day) return `• ${e.title} (all day)`;
      const time = formatTimeForZone(e.start_time, e.timezone || userTimezone);
      return `• ${time}: ${e.title}`;
    }).join('\n');

    let calendarContext: string;
    if (isTomorrowQuery) {
      calendarContext = tomorrowEvents.length > 0
        ? `\n## Tomorrow's Calendar (${tomorrowEvents.length} events):\n${formatEvents(tomorrowEvents)}\n`
        : '\n## Tomorrow\'s Calendar:\nNo events scheduled for tomorrow.\n';
    } else {
      calendarContext = todayEvents.length > 0
        ? `\n## Today's Calendar (${todayEvents.length} events):\n${formatEvents(todayEvents)}\n`
        : '\n## Today\'s Calendar:\nNo events scheduled today - clear schedule!\n';

      if (tomorrowEvents.length > 0) {
        calendarContext += `\n## Tomorrow Preview (${tomorrowEvents.length} events):\n${formatEvents(tomorrowEvents)}\n`;
      }
    }

    return { calendarContext, todayEvents, tomorrowEvents };
  } catch (calErr) {
    console.error('[WhatsApp Chat] Calendar fetch error (non-blocking):', calErr);
    return { calendarContext: '', todayEvents: [], tomorrowEvents: [] };
  }
}

/** Originally `index.ts:6908–7001`. Briefing-only. */
async function assembleHealthContext(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  chatType: string,
  now: Date,
): Promise<string> {
  if (chatType !== 'briefing') return '';
  try {
    const { data: ouraConn } = await supabase
      .from('oura_connections')
      .select('id, last_sync_time, share_wellness_with_partner')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (!ouraConn) return '';

    const lastSync = ouraConn.last_sync_time ? new Date(ouraConn.last_sync_time).getTime() : 0;
    const fourHoursMs = 4 * 60 * 60 * 1000;
    if (Date.now() - lastSync > fourHoursMs) {
      try {
        console.log('[WhatsApp Chat] Oura data stale, triggering pre-briefing sync...');
        await supabase.functions.invoke('oura-sync', {
          body: { user_id: userId, action: 'fetch_data' },
        });
      } catch (syncErr) {
        console.warn('[WhatsApp Chat] Pre-briefing sync failed (non-blocking):', syncErr);
      }
    }

    const todayStr = now.toISOString().split('T')[0];
    const yesterdayStr = new Date(now.getTime() - 86400000).toISOString().split('T')[0];
    const sevenDaysAgoStr = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];

    const { data: ouraWeek } = await supabase
      .from('oura_daily_data')
      .select('day, sleep_score, sleep_duration_seconds, readiness_score, activity_score, steps, stress_day_summary, stress_high_minutes, resilience_level')
      .eq('user_id', userId)
      .gte('day', sevenDaysAgoStr)
      .order('day', { ascending: false })
      .limit(7);

    if (!ouraWeek || ouraWeek.length === 0) return '';

    // deno-lint-ignore no-explicit-any
    const ouraToday = ouraWeek.find((r: any) => r.day === todayStr);
    // deno-lint-ignore no-explicit-any
    const ouraYesterday = ouraWeek.find((r: any) => r.day === yesterdayStr);
    const ouraDay = ouraToday || ouraYesterday;
    const isYesterday = !ouraToday && !!ouraYesterday;
    if (!ouraDay) return '';

    const sleepHours = ouraDay.sleep_duration_seconds
      ? (ouraDay.sleep_duration_seconds / 3600).toFixed(1)
      : null;

    // deno-lint-ignore no-explicit-any
    const rowsWithSleep = ouraWeek.filter((r: any) => r.sleep_score);
    // deno-lint-ignore no-explicit-any
    const rowsWithReadiness = ouraWeek.filter((r: any) => r.readiness_score);
    const avgSleep = rowsWithSleep.length
      // deno-lint-ignore no-explicit-any
      ? Math.round(rowsWithSleep.reduce((s: number, r: any) => s + r.sleep_score, 0) / rowsWithSleep.length)
      : null;
    const avgReadiness = rowsWithReadiness.length
      // deno-lint-ignore no-explicit-any
      ? Math.round(rowsWithReadiness.reduce((s: number, r: any) => s + r.readiness_score, 0) / rowsWithReadiness.length)
      : null;

    let ouraContext = `\n## Health & Wellness (Oura Ring${isYesterday ? ' — yesterday\'s data' : ''}):\n`;
    ouraContext += `• Sleep: ${ouraDay.sleep_score || 'N/A'}/100${sleepHours ? ` (${sleepHours}h)` : ''}`;
    if (avgSleep && ouraDay.sleep_score) {
      const delta = ouraDay.sleep_score - avgSleep;
      if (Math.abs(delta) >= 8) ouraContext += ` (${delta > 0 ? '+' : ''}${delta} vs 7-day avg)`;
    }
    ouraContext += '\n';
    ouraContext += `• Readiness: ${ouraDay.readiness_score || 'N/A'}/100`;
    if (avgReadiness && ouraDay.readiness_score) {
      const delta = ouraDay.readiness_score - avgReadiness;
      if (Math.abs(delta) >= 8) ouraContext += ` (${delta > 0 ? '+' : ''}${delta} vs 7-day avg)`;
    }
    ouraContext += '\n';
    ouraContext += `• Activity: ${ouraDay.activity_score || 'N/A'}/100 | ${ouraDay.steps || 0} steps\n`;
    if (ouraDay.stress_day_summary) {
      ouraContext += `• Stress: ${ouraDay.stress_day_summary}${ouraDay.stress_high_minutes ? ` (${ouraDay.stress_high_minutes}min high stress)` : ''}\n`;
    }
    if (ouraDay.resilience_level) {
      ouraContext += `• Resilience: ${ouraDay.resilience_level}\n`;
    }
    if (ouraDay.readiness_score && ouraDay.readiness_score < 65) {
      ouraContext += `Advisory: Readiness is low — suggest a lighter, recovery-focused day.\n`;
    } else if (ouraDay.readiness_score && ouraDay.readiness_score >= 85) {
      ouraContext += `Advisory: Readiness is high — great day to tackle demanding tasks.\n`;
    }
    console.log('[WhatsApp Chat] Enhanced Oura data included in briefing');
    return ouraContext;
  } catch (ouraErr) {
    console.error('[WhatsApp Chat] Oura fetch error (non-blocking):', ouraErr);
    return '';
  }
}

/** Originally `index.ts:7137–7151`. */
async function assembleDynamicContext(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  coupleId: string | null,
): Promise<{ chatAgentInsightsContext: string; dynamicMemoryFileContext: string }> {
  try {
    // String-indirection on the import URL keeps Deno's type checker
    // from transitively pulling orchestrator.ts (which has an unrelated
    // pre-existing TS2345 in assembleContext that would block this
    // module's typecheck).
    const orchestratorUrl = "../../_shared/orchestrator.ts";
    // deno-lint-ignore no-explicit-any
    const orchestrator: any = await import(orchestratorUrl);
    const [fullAgentCtx, memFileCtx] = await Promise.all([
      orchestrator.fetchAgentInsightsContext(supabase, userId),
      orchestrator.fetchDynamicMemoryContext(supabase, userId, coupleId ?? undefined),
    ]);
    return {
      chatAgentInsightsContext: fullAgentCtx
        .replace(/^## Recent Agent Insights.*\n/m, '')
        .trim(),
      dynamicMemoryFileContext: memFileCtx,
    };
  } catch (ctxErr) {
    console.warn('[WhatsApp Chat] Dynamic context fetch error (non-blocking):', ctxErr);
    return { chatAgentInsightsContext: '', dynamicMemoryFileContext: '' };
  }
}

/** Originally `index.ts:7162–7182`. */
async function loadCompactSummary(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
): Promise<string | null> {
  try {
    const { data: gwRow } = await supabase
      .from('olive_gateway_sessions')
      .select('compact_summary, last_compacted_at')
      .eq('user_id', userId)
      .eq('channel', 'whatsapp')
      .eq('is_active', true)
      .order('last_activity', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (gwRow?.compact_summary && gwRow.compact_summary.trim().length > 0) {
      const summary = gwRow.compact_summary.trim();
      console.log(
        `[CompactSummary] loaded (${summary.length} chars, ` +
        `last_compacted_at=${gwRow.last_compacted_at || 'never'})`,
      );
      return summary;
    }
    return null;
  } catch (csErr) {
    console.warn('[CompactSummary] load error (non-blocking):', csErr);
    return null;
  }
}

/** Originally `index.ts:1003–1083`. Moved verbatim — only consumer is CHAT. */
async function matchUserSkills(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  message: string,
  noteCategory?: string,
): Promise<SkillMatch> {
  const lowerMessage = message.toLowerCase();
  try {
    const { data: userSkills } = await supabase
      .from('olive_user_skills')
      .select('skill_id, enabled')
      .eq('user_id', userId)
      .eq('enabled', true);

    // deno-lint-ignore no-explicit-any
    const enabledSkillIds = new Set(userSkills?.map((s: any) => s.skill_id) || []);

    const { data: allSkills } = await supabase
      .from('olive_skills')
      .select('skill_id, name, content, category, triggers')
      .eq('is_active', true);

    if (!allSkills || allSkills.length === 0) return { matched: false };

    for (const skill of allSkills) {
      if (!skill.triggers || !skill.content) continue;
      const triggers = Array.isArray(skill.triggers) ? skill.triggers : [];

      for (const trigger of triggers) {
        if (trigger.keyword) {
          const keyword = trigger.keyword.toLowerCase();
          if (lowerMessage.includes(keyword)) {
            console.log(`[Skills] Matched skill "${skill.name}" via keyword "${keyword}"`);
            return {
              matched: true,
              skill: { skill_id: skill.skill_id, name: skill.name, content: skill.content, category: skill.category || 'general' },
              trigger_type: 'keyword',
              matched_value: keyword,
            };
          }
        }
        if (trigger.category && noteCategory) {
          if (noteCategory.toLowerCase() === trigger.category.toLowerCase()) {
            console.log(`[Skills] Matched skill "${skill.name}" via category "${trigger.category}"`);
            return {
              matched: true,
              skill: { skill_id: skill.skill_id, name: skill.name, content: skill.content, category: skill.category || 'general' },
              trigger_type: 'category',
              matched_value: trigger.category,
            };
          }
        }
        if (trigger.command && lowerMessage.startsWith(trigger.command.toLowerCase())) {
          console.log(`[Skills] Matched skill "${skill.name}" via command "${trigger.command}"`);
          return {
            matched: true,
            skill: { skill_id: skill.skill_id, name: skill.name, content: skill.content, category: skill.category || 'general' },
            trigger_type: 'command',
            matched_value: trigger.command,
          };
        }
      }
    }
    void enabledSkillIds;
    return { matched: false };
  } catch (error) {
    console.error('[Skills] Error matching skills:', error);
    return { matched: false };
  }
}

/** Originally `index.ts:7073–7132`. */
async function loadSkillContext(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  effectiveMessage: string,
  aiSkillId: string | undefined,
): Promise<{ skillContext: string; skillMatch: SkillMatch }> {
  let skillMatch: SkillMatch = { matched: false };

  if (aiSkillId) {
    console.log(`[WhatsApp Chat] AI-provided skill match: ${aiSkillId}`);
    const { data: aiSkill } = await supabase
      .from('olive_skills')
      .select('skill_id, name, content, category')
      .eq('skill_id', aiSkillId)
      .eq('is_active', true)
      .maybeSingle();

    if (aiSkill) {
      skillMatch = {
        matched: true,
        skill: {
          skill_id: aiSkill.skill_id,
          name: aiSkill.name,
          content: aiSkill.content,
          category: aiSkill.category || 'general',
        },
        trigger_type: 'keyword',
        matched_value: 'ai-router',
      };
    }
  }

  if (!skillMatch.matched) {
    skillMatch = await matchUserSkills(supabase, userId, effectiveMessage);
  }

  let skillContext = '';
  if (skillMatch.matched && skillMatch.skill) {
    console.log(`[WhatsApp Chat] Skill matched: ${skillMatch.skill.name} via ${skillMatch.trigger_type}: ${skillMatch.matched_value}`);
    skillContext = `
## 🧩 Active Skill: ${skillMatch.skill.name}
${skillMatch.skill.content}

IMPORTANT: Use the above skill knowledge to enhance your response with domain-specific expertise.
`;

    try {
      await supabase
        .from('olive_user_skills')
        .upsert({
          user_id: userId,
          skill_id: skillMatch.skill.skill_id,
          enabled: true,
          usage_count: 1,
          last_used_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id,skill_id',
        });
    } catch (trackErr) {
      console.warn('[Skills] Failed to track usage:', trackErr);
    }
  }

  return { skillContext, skillMatch };
}

// ─── Error-fallback rendering ──────────────────────────────────────────
//
// Originally `index.ts:7656–7694`. Returns a deterministic message when
// the AI call (Pro+Flash both) throws.

function buildChatErrorFallback(
  chatType: string,
  taskContext: ChatPromptContext['taskContext'],
  todayEvents: Array<{ title: string; start_time: string; all_day: boolean }>,
  topOverdueTasks: string[],
  topUrgentTasks: string[],
  topTodayTasks: string[],
  overdueTasksCount: number,
  dueTodayCount: number,
  partnerName: string,
): string {
  switch (chatType) {
    case 'briefing': {
      const calEventCount = todayEvents.length;
      const calSummary = calEventCount > 0
        ? `📅 ${calEventCount} event${calEventCount > 1 ? 's' : ''} today`
        : '📅 Clear calendar';
      const focusList = [
        ...topOverdueTasks.slice(0, 1).map((t) => `⚠️ Overdue: ${t}`),
        ...topUrgentTasks.slice(0, 1).map((t) => `🔥 Urgent: ${t}`),
        ...topTodayTasks.slice(0, 1).map((t) => `📌 Due today: ${t}`),
      ].slice(0, 3);
      const partnerNote = partnerName ? `\n👥 ${partnerName}'s activity in the app` : '';
      return `🌅 Morning Briefing\n\n${calSummary}\n\n🎯 Focus:\n${focusList.length > 0 ? focusList.join('\n') : '• No urgent items!'}\n\n📊 ${taskContext.total_active} active | ${taskContext.urgent} urgent | ${taskContext.overdue} overdue${partnerNote}\n\n✨ Have a great day!`;
    }
    case 'weekly_summary':
      return `📊 Your Week:\n• Created: ${taskContext.created_this_week} tasks\n• Completed: ${taskContext.completed_this_week}\n• Active: ${taskContext.total_active} (${taskContext.urgent} urgent)\n\n💡 Try "what's urgent?" for priorities`;
    case 'daily_focus':
      if (overdueTasksCount > 0) {
        return `🎯 Focus Today:\n1. Clear overdue: ${topOverdueTasks[0] || 'Check your overdue items'}\n${topTodayTasks.length > 0 ? `2. Then: ${topTodayTasks[0]}` : ''}\n\n🔗 witholive.app`;
      } else if (dueTodayCount > 0) {
        return `🎯 Today's Priorities:\n${topTodayTasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n✨ You've got this!`;
      }
      return `🎯 No urgent deadlines today! Consider tackling urgent tasks:\n${topUrgentTasks[0] || 'Check your task list'}\n\n💪 Stay proactive!`;
    case 'motivation':
      return `💚 You're doing great! ${taskContext.completed_this_week} tasks done this week.\n\nOne step at a time. Start with just one small task - momentum builds! 🫒`;
    default:
      return '🫒 Hi! I\'m Olive.\n\nTry:\n• "Morning briefing"\n• "Summarize my week"\n• "What should I focus on?"\n• "What\'s urgent?"\n\nOr just tell me what\'s on your mind!';
  }
}

// ─── Factory ──────────────────────────────────────────────────────────

export function makeChatHandler(deps: ChatDeps): Handler {
  return async (ctx: HandlerContext): Promise<Reply> => {
    // deno-lint-ignore no-explicit-any
    const intentResultAny = ctx.intentResult as any;
    const rawChatType: string = intentResultAny.chatType || 'general';
    console.log(
      '[WhatsApp] Processing CHAT intent, type:', rawChatType,
      'message:', ctx.effectiveMessage?.substring(0, 50),
    );

    // `help` is an early-exit: no AI call, just static help text.
    if (rawChatType === 'help') {
      return { text: deps.t('help_text', ctx.userLang) };
    }

    const now = new Date();
    const nowMs = now.getTime();
    const oneWeekAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;
    const userTimezone = ctx.profile.timezone || 'UTC';
    const todayWindow = getRelativeDayWindowUtc(now, userTimezone, 0);
    const tomorrowWindow = getRelativeDayWindowUtc(now, userTimezone, 1);

    // ── Parallel data fetches (the monolith ran these sequentially).
    const [allTasksRes, memoriesRes, patternsRes, listsRes, recentOutbound] =
      await Promise.all([
        ctx.supabase
          .from('clerk_notes')
          .select('id, summary, due_date, completed, priority, category, list_id, items, created_at, updated_at, task_owner, author_id')
          .or(`author_id.eq.${ctx.userId}${ctx.coupleId ? `,couple_id.eq.${ctx.coupleId}` : ''}`)
          .order('created_at', { ascending: false })
          .limit(100),
        ctx.supabase
          .from('user_memories')
          .select('title, content, category, importance')
          .eq('user_id', ctx.userId)
          .eq('is_active', true)
          .order('importance', { ascending: false })
          .limit(10),
        ctx.supabase
          .from('olive_patterns')
          .select('pattern_type, pattern_data, confidence')
          .eq('user_id', ctx.userId)
          .eq('is_active', true)
          .gte('confidence', 0.6)
          .limit(5),
        ctx.supabase
          .from('clerk_lists')
          .select('id, name')
          .or(`author_id.eq.${ctx.userId}${ctx.coupleId ? `,couple_id.eq.${ctx.coupleId}` : ''}`),
        getRecentOutboundMessages(ctx.supabase, ctx.userId),
      ]);

    const allTasks = allTasksRes.data || [];
    const memories = memoriesRes.data || [];
    const patterns = patternsRes.data || [];
    const lists = listsRes.data || [];
    const listIdToName = new Map<string, string>(
      // deno-lint-ignore no-explicit-any
      lists.map((l: any) => [l.id, l.name]),
    );

    // ── Partner context.
    const { partnerContext, partnerName } = await assemblePartnerContext(
      ctx.supabase, ctx.userId, ctx.coupleId, nowMs,
    );

    // ── Partner wellness (briefing only).
    const partnerWellnessContext = await assemblePartnerWellness(
      ctx.supabase, ctx.userId, ctx.coupleId, partnerName, rawChatType, now,
    );

    // ── Calendar (briefing only).
    const isTomorrowQuery = /\btomorrow\b/i.test(ctx.effectiveMessage || '');
    const { calendarContext, todayEvents } = await assembleCalendarContext(
      ctx.supabase, ctx.userId, todayWindow, tomorrowWindow, isTomorrowQuery,
      userTimezone, rawChatType,
    );

    // ── Oura (briefing only).
    const ouraContext = await assembleHealthContext(ctx.supabase, ctx.userId, rawChatType, now);

    // ── Task analytics.
    const {
      taskContext, topUrgentTasks, topOverdueTasks, topTodayTasks, topTomorrowTasks,
      overdueTasksCount, dueTodayCount,
    } = computeTaskAnalytics(
      allTasks, listIdToName, ctx.userId, oneWeekAgoMs,
      todayWindow.start, todayWindow.end, tomorrowWindow.start, tomorrowWindow.end,
    );

    // ── Memory + pattern summaries.
    const memoryContext = memories
      // deno-lint-ignore no-explicit-any
      .map((m: any) => `${m.title}: ${m.content}`).join('; ') || 'No personalization data yet.';
    const patternContext = patterns
      // deno-lint-ignore no-explicit-any
      .map((p: any) => {
        const data = p.pattern_data as { description?: string };
        return `${p.pattern_type}: ${data.description || JSON.stringify(p.pattern_data)}`;
      }).join('; ') || 'No behavioral patterns detected yet.';

    // ── Skill match.
    const { skillContext } = await loadSkillContext(
      ctx.supabase, ctx.userId, ctx.effectiveMessage || '',
      intentResultAny._aiSkillId as string | undefined,
    );

    // ── Dynamic context + compact summary.
    const { chatAgentInsightsContext, dynamicMemoryFileContext } =
      await assembleDynamicContext(ctx.supabase, ctx.userId, ctx.coupleId);
    const compactSummary = await loadCompactSummary(ctx.supabase, ctx.userId);

    // ── Build the prompt.
    const sessionContext = (ctx.session.context_data || {}) as ConversationContext;
    const promptCtx: ChatPromptContext = {
      taskContext,
      memoryContext,
      patternContext,
      partnerContext,
      partnerName,
      partnerWellnessContext,
      calendarContext,
      ouraContext,
      skillContext,
      dynamicMemoryFileContext,
      chatAgentInsightsContext,
      compactSummary,
      topUrgentTasks,
      topOverdueTasks,
      topTodayTasks,
      topTomorrowTasks,
      recentOutbound: recentOutbound as RecentOutbound[],
      conversationHistory: (sessionContext.conversation_history || []).map((h) => ({
        role: h.role,
        content: h.content,
      })),
      effectiveMessage: ctx.effectiveMessage || '',
      isTomorrowQuery,
    };

    const { systemPrompt: basePrompt, userPromptEnhancement } = getChatSystemPrompt(
      rawChatType, promptCtx,
    );
    let systemPrompt = basePrompt;

    // ── Prompt evolution addendum (gated).
    let chatPromptVersion = getWAChatPromptVersion(rawChatType);
    if (Deno.env.get('PROMPT_EVOLUTION_ROUTER_ENABLED') === 'true') {
      try {
        const addendum = await resolveAddendum(ctx.supabase, ctx.userId, 'chat');
        if (addendum) {
          systemPrompt += `\n\n## Additional rules learned from user feedback\n${addendum.addendum_text}`;
          chatPromptVersion = `${chatPromptVersion}+addendum-${addendum.addendum_id}`;
        }
      } catch (e) {
        console.warn('[CHAT] Addendum lookup failed (non-blocking):', e);
      }
    }

    // ── Language directive (kept last).
    const userLangName = langName(ctx.userLang);
    if (userLangName !== 'English') {
      systemPrompt += `\n\nIMPORTANT: Respond entirely in ${userLangName}.`;
    }

    // ── Model routing.
    const route = routeIntent('chat', rawChatType, ctx.mediaUrls.length > 0);
    const enhancedMessage = (ctx.effectiveMessage || '') + userPromptEnhancement;
    const chatMediaUrls = ctx.mediaUrls.length > 0 ? ctx.mediaUrls : undefined;

    let chatResponse: string;
    try {
      console.log('[WhatsApp Chat] Calling AI for chatType:', rawChatType, 'lang:', ctx.userLang);
      try {
        chatResponse = await deps.callAI(
          systemPrompt, enhancedMessage, 0.7, route.responseTier,
          ctx.tracker, chatPromptVersion, chatMediaUrls, ctx.userId,
        );
      } catch (escalationErr) {
        if (route.responseTier === 'pro') {
          console.warn('[Router] Pro failed for CHAT, falling back to standard:', escalationErr);
          chatResponse = await deps.callAI(
            systemPrompt, enhancedMessage, 0.7, 'standard',
            ctx.tracker, chatPromptVersion, chatMediaUrls, ctx.userId,
          );
        } else {
          throw escalationErr;
        }
      }
    } catch (error) {
      console.error('[WhatsApp] Chat AI error:', error);
      const fallback = buildChatErrorFallback(
        rawChatType, taskContext, todayEvents,
        topOverdueTasks, topUrgentTasks, topTodayTasks,
        overdueTasksCount, dueTodayCount, partnerName,
      );
      return { text: fallback };
    }

    // ── Truncate to chatType-specific max length (matches monolith).
    const finalText = chatResponse.slice(0, rawChatType === 'assistant' ? 2000 : 1500);

    // ── After-reply side-effects. All three are fire-and-forget and
    //    isolated from each other (per the 1.1/1.3 pattern). Run in this
    //    order so a downstream "save this" can find last_assistant_output
    //    immediately.
    const after_reply: Array<() => Promise<void>> = [
      // 1. Session write — preserves "save this" follow-up window.
      async () => {
        try {
          const currentCtx = (ctx.session.context_data || {}) as ConversationContext;
          const offerStillAlive = isPendingOfferFresh(currentCtx.pending_offer);
          const nowIsoChat = new Date().toISOString();
          const nextCtx: ConversationContext = offerStillAlive
            ? { ...currentCtx }
            : {
                ...currentCtx,
                last_assistant_output: chatResponse.substring(0, 4000),
                last_assistant_output_at: nowIsoChat,
                last_assistant_request: (ctx.effectiveMessage || '').substring(0, 500),
              };
          await ctx.supabase
            .from('user_sessions')
            .update({ context_data: nextCtx, updated_at: nowIsoChat })
            .eq('id', ctx.session.id);
          console.log(`[CHAT/${rawChatType}] Stored output for save-artifact follow-up — pending_offer_alive=${offerStillAlive}`);
        } catch (storeErr) {
          console.warn(`[CHAT/${rawChatType}] Failed to store output (non-blocking):`, storeErr);
        }
      },
      // 2. Memory evolution.
      async () => {
        try {
          const orchestratorUrl = "../../_shared/orchestrator.ts";
          // deno-lint-ignore no-explicit-any
          const { evolveProfileFromConversation }: any = await import(orchestratorUrl);
          await evolveProfileFromConversation(
            ctx.supabase, ctx.userId, ctx.effectiveMessage || '', chatResponse,
          );
        } catch (e) {
          console.warn('[ConvMemory] Non-blocking error:', e);
        }
      },
      // 3. Daily log append.
      async () => {
        try {
          const turnSummary = `[${rawChatType}] User: ${(ctx.effectiveMessage || '').substring(0, 120)} → Olive responded`;
          await ctx.supabase.rpc('append_to_daily_log', {
            p_user_id: ctx.userId,
            p_content: turnSummary,
            p_source: 'chat',
          });
          console.log('[ConvMemory] Daily log appended');
        } catch (e) {
          console.warn('[ConvMemory] Daily log append failed:', e);
        }
      },
    ];

    return {
      text: finalText,
      max_length: rawChatType === 'assistant' ? 2000 : 1500,
      after_reply,
    };
  };
}

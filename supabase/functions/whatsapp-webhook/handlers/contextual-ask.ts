// handlers/contextual-ask.ts — CONTEXTUAL_ASK / WEB_RESEARCH / SCHEDULE_CALENDAR handler.
// ============================================================================
// Initiative 1.5 of OLIVE_REFACTOR_PLAN.md. Extracts the second-largest
// inline block (574 lines covering three intents that share the same
// "semantic search over saved data" pipeline) into a co-located handler
// with unit tests. Follows the 1.1/1.3/1.4 pattern: factory + DI,
// (ctx) => Promise<Reply>, hand-rolled Supabase stub tests, after_reply
// for fire-and-forget side-effects.
//
// Responsibilities (in order):
//   1. Fetch the user's tasks, lists, calendar events (30-day window),
//      memory chunks, and recent agent insights / memory files. All
//      reads scoped to user + couple_id when present.
//   2. Anchor on a named list when the user references one ("my book
//      list") via _shared/list-matcher.ts.
//   3. Score every task against the question using (a) word-overlap,
//      (b) vector similarity via find_similar_notes RPC, (c) anchored-
//      list boost. Top items get full-detail prompt slots; the rest
//      are summarized per list.
//   4. Detect general-knowledge questions and augment with Perplexity
//      ("hybrid" prompt) when triggered.
//   5. Call Gemini with Pro→Flash escalation fallback.
//   6. Return a Reply with after_reply callbacks for:
//      (a) saveReferencedEntity (preserves conversation_history +
//          optional last_referenced_entity)
//      (b) session.context_data update with last_assistant_* slots
//          and a structured `pending_offer` (type=save_artifact) when
//          the response contains a "save this" tail — this is the
//          artifact-freezing behavior that lets a downstream "yes" /
//          "save it" survive an intervening CHAT turn.
//   7. Error path: deterministic keyword fallback against saved tasks
//      (no AI required).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  WA_CONTEXTUAL_ASK_PROMPT_VERSION,
  WA_HYBRID_ASK_PROMPT_VERSION,
} from "../../_shared/prompts/whatsapp-prompts.ts";
import { langName } from "../../_shared/whatsapp-localization.ts";
import {
  formatDateForZone,
  formatTimeForZone,
  getRelativeDayWindowUtc,
} from "../../_shared/timezone-calendar.ts";
import { formatFriendlyDate } from "../../_shared/whatsapp-messaging.ts";
import { routeIntent } from "../../_shared/model-router.ts";
import type { PendingOffer } from "../../_shared/pending-offer.ts";
import { assembleContextSoul } from "../../_shared/context-soul/index.ts";
import type { LLMTracker } from "../../_shared/llm-tracker.ts";
import type {
  ConversationContext,
  Handler,
  HandlerContext,
  Reply,
} from "../../_shared/types.ts";

// ─── Type definitions ──────────────────────────────────────────────────

/** Signature of the webhook's `callAI` helper. */
export type ContextualAskCallAI = (
  systemPrompt: string,
  userMessage: string,
  temperature: number,
  tier: string,
  tracker?: LLMTracker | null,
  promptVersion?: string,
  mediaUrls?: string[],
  userId?: string,
) => Promise<string>;

/** Signature of the webhook's `saveReferencedEntity`. */
export type SaveReferencedEntityFn = (
  task: { id: string; summary: string; due_date?: string; list_id?: string; priority?: string } | null,
  oliveResponse: string,
  displayedList?: Array<{ id: string; summary: string }>,
) => Promise<void>;

export interface ContextualAskDeps {
  callAI: ContextualAskCallAI;
  t: (key: string, lang: string, vars?: Record<string, string>) => string;
  generateEmbedding: (text: string) => Promise<number[] | null>;
  /** Webhook-local closure that owns conversation_history + last_referenced_entity writes. */
  saveReferencedEntity: SaveReferencedEntityFn;
}

// ─── General-knowledge detector (verbatim from monolith) ───────────────

/**
 * Detects messages that warrant a Perplexity augmentation. Lifted
 * verbatim from `index.ts:6047–6053` to keep the trigger surface
 * byte-identical. Exported for unit tests.
 */
export function isGeneralKnowledgeQuestion(message: string): boolean {
  const msgLower = message.toLowerCase();
  return (
    /\b(what\s+(?:are|is)\s+the\s+(?:best|top|most|greatest|nicest|popular|famous|recommended)|best\s+(?:cities|restaurants?|hotels?|places?|things?|activities|spots?|bars?|cafes?|neighborhoods?|beaches?|parks?|museums?|shops?|attractions?|destinations?)|top\s+\d+|recommend\s+(?:a|some|me)|where\s+(?:should|can|do)\s+(?:i|we)\s+(?:go|visit|eat|stay|travel|explore)|what\s+(?:should|can|do)\s+(?:i|we)\s+(?:do|see|visit|try|eat|cook|watch|read|buy)\s+(?:in|at|near|around|for))\b/i.test(msgLower) ||
    /\b(how\s+(?:much|many|far|long|old|big|tall|deep|wide)\s+(?:is|are|does|do|did|was|were)\s+(?:the|a|an|it)?|what\s+(?:is|are|was|were)\s+(?:the\s+)?(?:capital|population|currency|language|weather|temperature|distance|cost|price|height|meaning|definition|history|origin|difference))\b/i.test(msgLower) ||
    (/\b(good|great|nice|cool|fun|interesting|amazing)\s+(?:places?|things?|restaurants?|cities|spots?|ideas?|activities)\b/i.test(msgLower) && !/\b(my|saved|list|tasks?|notes?)\b/i.test(msgLower))
  );
}

/**
 * Detects whether an AI response contains a "save this" / "salvar"
 * tail — the trigger for constructing a `save_artifact` PendingOffer
 * so a subsequent "yes" / "sí" / "do it" can survive a CHAT
 * interruption and still resolve to this artifact. Verbatim regex from
 * `index.ts:6276` and `index.ts:6535`.
 */
export function responseOffersSave(response: string): boolean {
  return /\b(save\s+this|save\s+it|salvar(?:lo|la)|guardar(?:lo|la)|salvarlo|guardarlo)\b/i.test(response);
}

// ─── Olive identity guard-rails (verbatim) ─────────────────────────────

const OLIVE_IDENTITY_RULES = `
ABSOLUTE IDENTITY RULES:
- You are Olive, the assistant inside the user's Olive app at witholive.app. There is no other "Olive" app, no "Olive Tree" app, no "My Book List" app, no external "Olive Inventory". Never reference other apps the user could use instead.
- The user's data lives in this app. You access it through the SAVED DATA sections below — that is your ONLY source of truth about the user's lists, notes, tasks, calendar, and memories.
- When the user names a list ("my book list", "my travel list", "my X list"), look first at the "## YOU ASKED ABOUT THE [list name] LIST" section if present, then the "### [list name]:" section under "ALL LISTS AND SAVED ITEMS". If neither has the list or it's empty, say the list is empty (or doesn't exist yet) — do not pretend it has items.

WHEN YOU CAN'T FULLY ANSWER — three distinct cases, three distinct responses:

(A) **Nothing related saved at all.** No matching item in any SAVED DATA section, no list with that name, the question is about a topic the user has never captured.
    → Reply exactly: "🌿 I don't have that yet — want me to save it?"

(B) **A related note exists but the SPECIFIC detail asked for is missing from its body.** This is common: the user saved a placeholder note like "Waymo discount code" or "WiFi password" with just the title and no body — the title looks like a match but the actual value isn't there. Distinguish this case carefully: look at the "Full details" field of MOST RELEVANT items. If the full details just repeat the summary (or are empty/short and don't contain the answer the user is asking for), this is case B.
    → Acknowledge what IS saved, name the gap, and offer to fill it. Example: "🌿 You have a note titled 'Waymo discount code' in your Shopping list, but the code itself isn't in the body — want to add it now?" Be specific about which note and which list.

(C) **A related note exists AND the answer is in its full details.** The summary plus original_text together contain the answer the user asked for.
    → Extract the EXACT answer from the full details. Don't just repeat the summary.

NEVER invent items. NEVER suggest external apps. NEVER speculate from general knowledge about what the user "might have."`;

// ─── Internal helpers ──────────────────────────────────────────────────

interface ScoredTask {
  id: string;
  summary: string;
  original_text?: string | null;
  category?: string | null;
  list_id?: string | null;
  items?: string[];
  tags?: string[] | null;
  priority?: string | null;
  due_date?: string | null;
  reminder_time?: string | null;
  completed?: boolean;
  created_at: string;
  relevanceScore: number;
}

/** Score every task using (a) word overlap, (b) semantic similarity,
 *  (c) anchored-list boost. Verbatim scoring from `index.ts:5867–5898`. */
function scoreTasks(
  allTasks: Array<{
    id: string;
    summary: string;
    original_text?: string | null;
    category?: string | null;
    list_id?: string | null;
    items?: string[];
    tags?: string[] | null;
    priority?: string | null;
    due_date?: string | null;
    reminder_time?: string | null;
    completed?: boolean;
    created_at: string;
  }>,
  question: string,
  semanticHits: Map<string, number>,
  anchoredListMatch: { listId: string; listName: string; matchedVia: string } | null,
): ScoredTask[] {
  const questionLower = question.toLowerCase();
  const questionWords = questionLower.split(/\s+/).filter((w) => w.length > 2);

  return allTasks.map((task) => {
    const summaryLower = task.summary.toLowerCase();
    const originalLower = (task.original_text || '').toLowerCase();
    const combined = `${summaryLower} ${originalLower}`;

    let score = 0;
    questionWords.forEach((w) => {
      if (combined.includes(w)) score += 1;
      if (summaryLower.includes(w)) score += 1;
    });
    const sim = semanticHits.get(task.id);
    if (typeof sim === 'number' && sim >= 0.55) {
      score += Math.round(2 + (sim - 0.55) * (3 / 0.45));
    }
    if (anchoredListMatch && task.list_id === anchoredListMatch.listId) {
      score += 5;
    }
    return { ...task, relevanceScore: score };
  });
}

/** Fetch calendar events for the next 30 days. Wraps the throw in
 *  try/catch like the monolith — calendar is non-blocking enrichment. */
async function fetchCalendarContext(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  userTimezone: string,
): Promise<string> {
  try {
    const { data: calConnections } = await supabase
      .from('calendar_connections')
      .select('id')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (!calConnections || calConnections.length === 0) return '';

    // deno-lint-ignore no-explicit-any
    const connIds = calConnections.map((c: any) => c.id);
    const now = new Date();
    const startOfToday = getRelativeDayWindowUtc(now, userTimezone, 0).start;
    const thirtyDaysFromNow = getRelativeDayWindowUtc(now, userTimezone, 30).end;

    const { data: calEvents } = await supabase
      .from('calendar_events')
      .select('title, start_time, end_time, location, description, all_day, timezone')
      .in('connection_id', connIds)
      .gte('start_time', startOfToday.toISOString())
      .lt('start_time', thirtyDaysFromNow.toISOString())
      .order('start_time', { ascending: true })
      .limit(30);

    if (!calEvents || calEvents.length === 0) return '';

    let calendarContext = '\n## UPCOMING CALENDAR EVENTS:\n';
    // deno-lint-ignore no-explicit-any
    calEvents.forEach((ev: any) => {
      const eventTimeZone = ev.timezone || userTimezone;
      const dayStr = formatDateForZone(ev.start_time, eventTimeZone, { weekday: 'long', month: 'long', day: 'numeric' });
      const timeStr = ev.all_day ? 'All day' : formatTimeForZone(ev.start_time, eventTimeZone);
      const endStr = ev.end_time && !ev.all_day ? ` - ${formatTimeForZone(ev.end_time, eventTimeZone)}` : '';
      const loc = ev.location ? ` | 📍 ${ev.location}` : '';
      calendarContext += `- ${ev.title}: ${dayStr} at ${timeStr}${endStr}${loc}\n`;
      if (ev.description) calendarContext += `  Details: ${ev.description}\n`;
    });
    return calendarContext;
  } catch (calErr) {
    console.warn('[WhatsApp] Calendar fetch error (non-blocking):', calErr);
    return '';
  }
}

/** Semantic retrieval via find_similar_notes RPC. Returns
 *  task_id → similarity map. Non-blocking. */
async function fetchSemanticHits(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  coupleId: string | null,
  query: string,
  generateEmbedding: (text: string) => Promise<number[] | null>,
): Promise<Map<string, number>> {
  const hits = new Map<string, number>();
  try {
    const queryEmbedding = await generateEmbedding(query);
    if (!queryEmbedding) return hits;
    const { data: vectorMatches } = await supabase.rpc('find_similar_notes', {
      p_user_id: userId,
      p_couple_id: coupleId,
      p_query_embedding: JSON.stringify(queryEmbedding),
      p_threshold: 0.55,
      p_limit: 8,
    });
    if (vectorMatches && Array.isArray(vectorMatches)) {
      for (const m of vectorMatches as Array<{ id: string; similarity: number }>) {
        hits.set(m.id, m.similarity);
      }
      console.log('[CONTEXTUAL_ASK] Semantic retrieval found', hits.size, 'matches');
    }
  } catch (vecErr) {
    console.warn('[CONTEXTUAL_ASK] Semantic retrieval failed (non-blocking):', vecErr);
  }
  return hits;
}

/** Perplexity augmentation for general-knowledge questions. Non-blocking. */
async function fetchPerplexityAugmentation(query: string): Promise<string> {
  const PERPLEXITY_KEY = Deno.env.get('OLIVE_PERPLEXITY');
  if (!PERPLEXITY_KEY) return '';
  try {
    const perplexityRes = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: 'Be precise and comprehensive. Give actionable, specific answers with details.' },
          { role: 'user', content: query },
        ],
        temperature: 0.2,
      }),
    });
    if (!perplexityRes.ok) return '';
    const pData = await perplexityRes.json();
    const searchResult = pData.choices?.[0]?.message?.content || '';
    const citations = pData.citations || [];
    if (!searchResult) return '';
    let webSearchContext = `\n## WEB SEARCH RESULTS (authoritative external knowledge):\n${searchResult}\n`;
    if (citations.length > 0) {
      webSearchContext += `\nSources: ${citations.slice(0, 3).join(', ')}\n`;
    }
    console.log('[CONTEXTUAL_ASK] Perplexity augmentation successful, length:', searchResult.length);
    return webSearchContext;
  } catch (searchErr) {
    console.warn('[CONTEXTUAL_ASK] Perplexity augmentation failed (non-blocking):', searchErr);
    return '';
  }
}

/** Fetch the items of the anchored list directly (bypassing the
 *  200-row recency cap on the main task fetch). Builds a labeled
 *  prompt section. Verbatim from `index.ts:5917–5953`. */
async function fetchAnchoredListSection(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  coupleId: string | null,
  anchoredListMatch: { listId: string; listName: string; matchedVia: string },
  userLang: string,
  userTimezone: string | undefined,
): Promise<string> {
  const { data: listTasksDirect } = await supabase
    .from('clerk_notes')
    .select('id, summary, original_text, due_date, completed, priority, items, reminder_time, created_at')
    .eq('list_id', anchoredListMatch.listId)
    .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
    .order('created_at', { ascending: false });

  const listTasks = listTasksDirect || [];
  // deno-lint-ignore no-explicit-any
  const activeListTasks = listTasks.filter((t: any) => !t.completed);
  // deno-lint-ignore no-explicit-any
  const completedListTasks = listTasks.filter((t: any) => t.completed);
  console.log('[CONTEXTUAL_ASK] Targeted list fetch:', anchoredListMatch.listName, '→', listTasks.length, 'total |', activeListTasks.length, 'active');

  let section = `\n## YOU ASKED ABOUT THE "${anchoredListMatch.listName}" LIST (${activeListTasks.length} active, ${completedListTasks.length} completed):\n`;
  if (activeListTasks.length === 0 && completedListTasks.length === 0) {
    section += `(this list exists but has no items yet)\n`;
    return section;
  }
  // deno-lint-ignore no-explicit-any
  activeListTasks.forEach((task: any, idx: number) => {
    const dueInfo = task.due_date ? ` | Due: ${formatFriendlyDate(task.due_date, true, userTimezone, userLang)}` : '';
    section += `\n${idx + 1}. ○ ${task.summary}${dueInfo}\n`;
    if (task.original_text && task.original_text !== task.summary) {
      section += `   Full details: ${task.original_text.substring(0, 800)}\n`;
    }
    if (task.items && task.items.length > 0) {
      task.items.forEach((item: string) => {
        section += `   • ${item}\n`;
      });
    }
  });
  if (completedListTasks.length > 0 && completedListTasks.length <= 5) {
    // deno-lint-ignore no-explicit-any
    section += `\nCompleted items: ${completedListTasks.map((t: any) => t.summary).join(', ')}\n`;
  }
  return section;
}

/** Build the prompt's "MOST RELEVANT" + "ALL LISTS" sections. */
function buildSavedItemsContext(
  relevantTasks: ScoredTask[],
  otherTasks: ScoredTask[],
  listIdToName: Map<string, string>,
  userLang: string,
  userTimezone: string | undefined,
): string {
  let savedItemsContext = '';
  if (relevantTasks.length > 0) {
    savedItemsContext += '\n## MOST RELEVANT SAVED ITEMS (full details):\n';
    relevantTasks.slice(0, 10).forEach((task) => {
      const listName = task.list_id && listIdToName.has(task.list_id) ? listIdToName.get(task.list_id) : task.category;
      const status = task.completed ? '✓' : '○';
      const dueInfo = task.due_date ? ` | Due: ${formatFriendlyDate(task.due_date, true, userTimezone, userLang)}` : '';
      const reminderInfo = task.reminder_time ? ` | Reminder: ${formatFriendlyDate(task.reminder_time, true, userTimezone, userLang)}` : '';
      savedItemsContext += `\n📌 ${status} "${task.summary}" [${listName}]${dueInfo}${reminderInfo}\n`;
      if (task.original_text && task.original_text !== task.summary) {
        savedItemsContext += `   Full details: ${task.original_text.substring(0, 800)}\n`;
      }
      if (task.items && task.items.length > 0) {
        task.items.forEach((item) => {
          savedItemsContext += `   • ${item}\n`;
        });
      }
    });
  }

  savedItemsContext += '\n## ALL LISTS AND SAVED ITEMS:\n';
  const tasksByList = new Map<string, ScoredTask[]>();
  const uncategorizedTasks: ScoredTask[] = [];

  otherTasks.forEach((task) => {
    if (task.list_id && listIdToName.has(task.list_id)) {
      const listName = listIdToName.get(task.list_id)!;
      if (!tasksByList.has(listName)) tasksByList.set(listName, []);
      tasksByList.get(listName)!.push(task);
    } else {
      uncategorizedTasks.push(task);
    }
  });

  tasksByList.forEach((tasks, listName) => {
    savedItemsContext += `\n### ${listName}:\n`;
    tasks.slice(0, 15).forEach((task) => {
      const status = task.completed ? '✓' : '○';
      const priority = task.priority === 'high' ? ' 🔥' : '';
      const dueInfo = task.due_date ? ` (Due: ${formatFriendlyDate(task.due_date, true, userTimezone, userLang)})` : '';
      savedItemsContext += `- ${status} ${task.summary}${priority}${dueInfo}\n`;
    });
    if (tasks.length > 15) savedItemsContext += `  ...and ${tasks.length - 15} more items\n`;
  });

  if (uncategorizedTasks.length > 0) {
    savedItemsContext += `\n### Other Items:\n`;
    uncategorizedTasks.slice(0, 10).forEach((task) => {
      const status = task.completed ? '✓' : '○';
      savedItemsContext += `- ${status} ${task.summary}\n`;
    });
  }
  return savedItemsContext;
}

// ─── Factory ──────────────────────────────────────────────────────────

export function makeContextualAskHandler(deps: ContextualAskDeps): Handler {
  return async (ctx: HandlerContext): Promise<Reply> => {
    const intent = ctx.intentResult.intent;
    console.log(`[WhatsApp] Processing ${intent} for:`, ctx.effectiveMessage?.substring(0, 50));

    // ── Parallel data fetch.
    const [allTasksRes, listsRes, memoriesRes] = await Promise.all([
      ctx.supabase
        .from('clerk_notes')
        .select('id, summary, original_text, category, list_id, items, tags, priority, due_date, reminder_time, completed, created_at')
        .or(`author_id.eq.${ctx.userId}${ctx.coupleId ? `,couple_id.eq.${ctx.coupleId}` : ''}`)
        .order('created_at', { ascending: false })
        .limit(200),
      ctx.supabase
        .from('clerk_lists')
        .select('id, name, description')
        .or(`author_id.eq.${ctx.userId}${ctx.coupleId ? `,couple_id.eq.${ctx.coupleId}` : ''}`),
      ctx.supabase
        .from('olive_memory_chunks')
        .select('content, chunk_type')
        .eq('user_id', ctx.userId)
        .order('importance', { ascending: false })
        .limit(15),
    ]);

    // deno-lint-ignore no-explicit-any
    const allTasks: any[] = allTasksRes.data || [];
    // deno-lint-ignore no-explicit-any
    const lists: any[] = listsRes.data || [];
    // deno-lint-ignore no-explicit-any
    const memories: any[] = memoriesRes.data || [];

    const userTimezone = ctx.profile.timezone || 'UTC';
    const calendarContext = await fetchCalendarContext(ctx.supabase, ctx.userId, userTimezone);

    const listIdToName = new Map<string, string>(lists.map((l) => [l.id, l.name as string]));

    // ── Anchored list resolution.
    let anchoredListMatch: { listId: string; listName: string; matchedVia: string } | null = null;
    try {
      const { findUserList } = await import("../../_shared/list-matcher.ts");
      // deno-lint-ignore no-explicit-any
      const aiListNameHint = (ctx.intentResult as any)._listName as string | undefined;
      anchoredListMatch = findUserList(
        ctx.effectiveMessage || '',
        lists.map((l) => ({ id: l.id, name: l.name as string, description: l.description })),
        aiListNameHint,
      );
      if (anchoredListMatch) {
        console.log('[CONTEXTUAL_ASK] Anchored on list:', anchoredListMatch.listName, 'via:', anchoredListMatch.matchedVia);
      }
    } catch (matcherErr) {
      console.warn('[CONTEXTUAL_ASK] list-matcher import failed (non-blocking):', matcherErr);
    }

    // ── Semantic retrieval.
    const semanticHits = await fetchSemanticHits(
      ctx.supabase, ctx.userId, ctx.coupleId, ctx.effectiveMessage || '', deps.generateEmbedding,
    );

    // ── Scoring.
    const scoredTasks = scoreTasks(allTasks, ctx.effectiveMessage || '', semanticHits, anchoredListMatch);
    const relevantTasks = scoredTasks.filter((t) => t.relevanceScore >= 2).sort((a, b) => b.relevanceScore - a.relevanceScore);
    const otherTasks = scoredTasks.filter((t) => t.relevanceScore < 2);

    // ── Build saved items context.
    let savedItemsContext = '';
    if (anchoredListMatch) {
      savedItemsContext += await fetchAnchoredListSection(
        ctx.supabase, ctx.userId, ctx.coupleId, anchoredListMatch, ctx.userLang, userTimezone,
      );
    }
    savedItemsContext += buildSavedItemsContext(relevantTasks, otherTasks, listIdToName, ctx.userLang, userTimezone);

    // ── Memory context.
    let memoryContext = '';
    if (memories.length > 0) {
      memoryContext = '\n## USER MEMORIES & PREFERENCES:\n';
      memories.forEach((m) => {
        memoryContext += `- [${m.chunk_type}] ${m.content}\n`;
      });
    }

    // ── Dynamic context (agent insights + memory files).
    let agentInsightsContext = '';
    let ctxAskMemoryFileContext = '';
    try {
      const orchestratorUrl = "../../_shared/orchestrator.ts";
      // deno-lint-ignore no-explicit-any
      const orchestrator: any = await import(orchestratorUrl);
      const [agentCtx, memFileCtx] = await Promise.all([
        orchestrator.fetchAgentInsightsContext(ctx.supabase, ctx.userId),
        orchestrator.fetchDynamicMemoryContext(ctx.supabase, ctx.userId, ctx.coupleId ?? undefined),
      ]);
      agentInsightsContext = agentCtx ? '\n' + agentCtx : '';
      ctxAskMemoryFileContext = memFileCtx;
    } catch (ctxErr) {
      console.warn('[WhatsApp] Dynamic context fetch error (non-blocking):', ctxErr);
    }

    // ── Conversation history.
    const sessionContext = (ctx.session.context_data || {}) as ConversationContext;
    let conversationHistoryContext = '';
    if (sessionContext.conversation_history && sessionContext.conversation_history.length > 0) {
      conversationHistoryContext = '\n## RECENT CONVERSATION (for resolving references like "it", "that", "this task"):\n';
      sessionContext.conversation_history.forEach((msg) => {
        conversationHistoryContext += `${msg.role === 'user' ? 'User' : 'Olive'}: ${msg.content}\n`;
      });
    }

    // ── Hybrid Perplexity augmentation.
    let webSearchContext = '';
    if (isGeneralKnowledgeQuestion(ctx.effectiveMessage || '')) {
      console.log('[CONTEXTUAL_ASK] General knowledge detected — augmenting with Perplexity');
      webSearchContext = await fetchPerplexityAugmentation(ctx.effectiveMessage || '');
    }

    // ── Context Soul (gated).
    let contextSoulBlock = '';
    if (Deno.env.get('CONTEXT_SOUL_ROLLOUT') === 'true') {
      try {
        const csResult = await assembleContextSoul(ctx.supabase, 'CONTEXTUAL_ASK', {
          userId: ctx.userId,
          spaceId: ctx.coupleId ?? null,
          coupleId: ctx.coupleId ?? null,
          query: ctx.effectiveMessage || ctx.messageBody || '',
          generateEmbedding: deps.generateEmbedding,
        });
        if (csResult.prompt && csResult.prompt.trim().length > 0) {
          contextSoulBlock = `\n\n${csResult.prompt}`;
          console.log(
            `[ContextSoul] CONTEXTUAL_ASK loaded sections=${csResult.sectionsLoaded.join(',')}`
              + ` tokens=${csResult.tokensUsed}`,
          );
        }
      } catch (csErr) {
        console.warn('[ContextSoul] CONTEXTUAL_ASK assembly failed (non-blocking):', csErr);
      }
    }

    // ── Build system prompt.
    const isHybridResponse = webSearchContext.length > 0;
    const entityContext = '';

    let systemPrompt = isHybridResponse
      ? `You are Olive, a world-class AI assistant — like a brilliant friend who knows the world AND the user's life. The user asked a general knowledge question.
${OLIVE_IDENTITY_RULES}

CRITICAL INSTRUCTIONS:
1. Lead with a comprehensive, knowledgeable answer using the WEB SEARCH RESULTS — be the expert. Give real, specific recommendations.
2. Then, if relevant personal context exists in their saved data, WEAVE IT IN naturally (e.g., "I also noticed you have X saved..." or "By the way, you already have plans for Y...").
3. The answer should feel like talking to a brilliant friend who knows the world AND knows your life.
4. Be specific, helpful, and thorough. Give real recommendations with details.
5. Use emojis sparingly for warmth 🫒
6. Max 1200 chars for WhatsApp. Prioritize the most useful information.
7. If you mention sources, keep it brief.

${webSearchContext}
${savedItemsContext}${contextSoulBlock}
${calendarContext}
${memoryContext}
${ctxAskMemoryFileContext}
${agentInsightsContext}
${conversationHistoryContext}

USER'S QUESTION: ${ctx.effectiveMessage}

Answer comprehensively using web knowledge, then naturally connect to any relevant personal context.`
      : `You are Olive, a friendly and intelligent AI assistant for the Olive app. The user is asking a question about their saved items, calendar, or personal data.
${OLIVE_IDENTITY_RULES}

CRITICAL INSTRUCTIONS:
1. You MUST answer based on the user's actual saved data provided below — including the "Full details" field which contains rich information like addresses, flight arrival/departure times, booking references, ingredients, etc.
2. Be SPECIFIC and PRECISE — if the user asks "when do I land?", look at the full details for arrival time; if they ask for an address, extract it from the details.
3. If you find a relevant saved item, extract the EXACT answer from its full details, don't just repeat the summary.
4. If they ask for recommendations, ONLY suggest items from their saved lists.
5. If you can't find what they're looking for in their data, say "🌿 I don't have that yet — want me to save it?" — never speculate, never reference external apps.
6. Be concise (max 500 chars for WhatsApp) but include all key details the user asked for.
7. Use emojis sparingly for warmth.
8. When mentioning dates, always include the day of the week and time if available.
9. When the user uses pronouns like "it", "that", "this task", refer to the RECENT CONVERSATION section.
10. Check CALENDAR EVENTS when questions involve timing, scheduling, or "when" questions.

${savedItemsContext}${contextSoulBlock}
${calendarContext}
${memoryContext}
${ctxAskMemoryFileContext}
${agentInsightsContext}
${conversationHistoryContext}
${entityContext}

USER'S QUESTION: ${ctx.effectiveMessage}

Respond with helpful, specific information extracted from their saved data. Answer the EXACT question asked.`;

    // ── Language directive (kept last).
    const ctxLangName = langName(ctx.userLang);
    if (ctxLangName !== 'English') {
      systemPrompt += `\n\nIMPORTANT: Respond entirely in ${ctxLangName}.`;
    }

    // ── Audit log.
    try {
      console.log('[CONTEXTUAL_ASK_PROMPT_AUDIT]', JSON.stringify({
        user_id: ctx.userId,
        q: (ctx.effectiveMessage || '').substring(0, 120),
        // deno-lint-ignore no-explicit-any
        intent_q_type: (ctx.intentResult as any).queryType ?? null,
        hybrid: isHybridResponse,
        relevant_count: relevantTasks.length,
        other_count: otherTasks.length,
        lists_count: lists.length,
        // deno-lint-ignore no-explicit-any
        ai_list_name: (ctx.intentResult as any)._listName ?? null,
        saved_chars: savedItemsContext.length,
        web_chars: webSearchContext.length,
        mem_chars: memoryContext.length + ctxAskMemoryFileContext.length,
        cal_chars: calendarContext.length,
        total_prompt_chars: systemPrompt.length,
      }));
    } catch (auditErr) {
      console.warn('[CONTEXTUAL_ASK_PROMPT_AUDIT] log failed:', auditErr);
    }

    // ── AI call with Pro→Flash fallback.
    const route = routeIntent(intent.toLowerCase(), undefined, ctx.mediaUrls.length > 0);
    const effectiveTier = isHybridResponse ? 'standard' : route.responseTier;
    const ctxAskPromptVersion = isHybridResponse ? WA_HYBRID_ASK_PROMPT_VERSION : WA_CONTEXTUAL_ASK_PROMPT_VERSION;
    const ctxMediaUrls = ctx.mediaUrls.length > 0 ? ctx.mediaUrls : undefined;

    let response: string;
    try {
      try {
        response = await deps.callAI(
          systemPrompt, ctx.effectiveMessage || '', 0.7, effectiveTier,
          ctx.tracker, ctxAskPromptVersion, ctxMediaUrls, ctx.userId,
        );
      } catch (escalationErr) {
        if (effectiveTier === 'pro') {
          console.warn('[Router] Pro failed for CONTEXTUAL_ASK, falling back to standard:', escalationErr);
          response = await deps.callAI(
            systemPrompt, ctx.effectiveMessage || '', 0.7, 'standard',
            ctx.tracker, ctxAskPromptVersion, ctxMediaUrls, ctx.userId,
          );
        } else {
          throw escalationErr;
        }
      }
    } catch (error) {
      console.error('[WhatsApp] Contextual AI error:', error);
      const searchTerms = (ctx.effectiveMessage || '').toLowerCase().split(/\s+/);
      // deno-lint-ignore no-explicit-any
      const matchingTasks = allTasks.filter((t: any) =>
        searchTerms.some((term) =>
          t.summary.toLowerCase().includes(term) ||
          // deno-lint-ignore no-explicit-any
          t.items?.some((i: any) => i.toLowerCase().includes(term))
        )
      ).slice(0, 5);
      if (matchingTasks.length > 0) {
        // deno-lint-ignore no-explicit-any
        const results = matchingTasks.map((t: any) => `• ${t.summary}`).join('\n');
        return { text: deps.t('search_found_items', ctx.userLang, { results }) };
      }
      return { text: 'I couldn\'t find matching items in your lists. Try "show my tasks" to see everything.' };
    }

    // ── Find matching task for last_referenced_entity write.
    const questionLower = (ctx.effectiveMessage || '').toLowerCase();
    // deno-lint-ignore no-explicit-any
    const matchingTask = allTasks.find((task: any) => {
      const summaryLower = task.summary.toLowerCase();
      const taskWords = summaryLower.split(/\s+/).filter((w: string) => w.length > 3);
      const matchCount = taskWords.filter((w: string) => questionLower.includes(w)).length;
      return matchCount >= Math.min(2, taskWords.length) || questionLower.includes(summaryLower);
    });

    // ── Build pending_offer for "save this" follow-ups (artifact freezing).
    const requestForSave = (ctx.effectiveMessage || '').substring(0, 500);
    const offeredArtifact = response.substring(0, 4000);
    const responseSuggestsSave = responseOffersSave(response);
    const pendingOffer: PendingOffer | null = responseSuggestsSave
      ? {
          type: 'save_artifact',
          artifact_content: offeredArtifact,
          artifact_request: requestForSave,
          artifact_kind: 'contextual_ask',
          offered_at: new Date().toISOString(),
        }
      : null;

    // ── After-reply: webhook-managed conversation history + structured session write.
    const after_reply: Array<() => Promise<void>> = [
      async () => {
        try {
          await deps.saveReferencedEntity(matchingTask || null, response);
        } catch (refErr) {
          console.warn('[CONTEXTUAL_ASK] saveReferencedEntity failed (non-blocking):', refErr);
        }
      },
      async () => {
        try {
          const currentCtxCA = (ctx.session.context_data || {}) as ConversationContext;
          const nowIsoCA = new Date().toISOString();
          await ctx.supabase
            .from('user_sessions')
            .update({
              context_data: {
                ...currentCtxCA,
                last_assistant_output: offeredArtifact,
                last_assistant_output_at: nowIsoCA,
                last_assistant_request: requestForSave,
                pending_offer: pendingOffer,
              },
              updated_at: nowIsoCA,
            })
            .eq('id', ctx.session.id);
          console.log(`[CONTEXTUAL_ASK] Stored output for save-artifact follow-up — pending_offer=${pendingOffer ? 'yes' : 'no'}`);
        } catch (storeErr) {
          console.warn('[Context] Error saving context after CONTEXTUAL_ASK:', storeErr);
        }
      },
    ];

    return {
      text: response.slice(0, 1500),
      max_length: 1500,
      after_reply,
    };
  };
}

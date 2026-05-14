/**
 * ASK-OLIVE-STREAM Edge Function — Multi-Agent Router (P3 Upgrade)
 * ============================================================================
 * World-class streaming chat for the Olive web app.
 *
 * P3 upgrades:
 *   - Shared intent classifier (parity with WhatsApp)
 *   - Full action execution via process-note (not inline)
 *   - Memory evolution post-response
 *   - Unified context pipeline (P2)
 *
 * Architecture:
 *   1. Shared intent classification (Gemini structured JSON, <200ms)
 *   2. Route to the right agent:
 *      - ACTION → process-note / task mutation → confirmation stream
 *      - WEB_SEARCH → Perplexity API → Gemini formatting stream
 *      - CONTEXTUAL_ASK → Fetch relevant saved data → Gemini answer stream
 *      - CHAT → Rich context → Gemini stream
 *   3. All routes use model-router for cost-optimized tier selection
 *   4. Server-side context via shared orchestrator
 *   5. Post-response memory evolution (fire-and-forget)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GEMINI_KEY, getModel } from "../_shared/gemini.ts";
import { routeIntent, checkConfidenceFloor } from "../_shared/model-router.ts";
import { createLLMTracker } from "../_shared/llm-tracker.ts";
import {
  OLIVE_CHAT_PROMPT as CHAT_PROMPT_IMPORTED,
  CHAT_PROMPT_VERSION,
  CONTEXTUAL_ASK_PROMPT as CTX_ASK_PROMPT_IMPORTED,
  CONTEXTUAL_ASK_PROMPT_VERSION,
  WEB_SEARCH_FORMAT_PROMPT as WEB_SEARCH_PROMPT_IMPORTED,
  WEB_SEARCH_FORMAT_PROMPT_VERSION,
} from "../_shared/prompts/ask-olive-prompts.ts";
// Phase 4 follow-up (Option A): feature-flagged per-intent prompt modules.
// When `USE_INTENT_MODULES=1` (or a userId-hashed rollout via
// `INTENT_MODULES_ROLLOUT_PCT`) is set, the CHAT path switches from the
// monolithic `OLIVE_CHAT_PROMPT` to the per-intent modular system.
// Legacy path remains the default — zero regression risk.
import { resolvePrompt, resolvePromptAsync } from "../_shared/prompts/intents/resolver.ts";
import {
  assembleFullContext,
  formatContextForPrompt,
  formatContextWithBudget,
  getSlotTokenLog,
  cleanupStaleSessions,
  evolveProfileFromConversation,
  type UnifiedContext,
} from "../_shared/orchestrator.ts";
import {
  classifyIntent,
  type ClassifiedIntent,
} from "../_shared/intent-classifier.ts";
import { parseNaturalDate } from "../_shared/natural-date-parser.ts";
import {
  classifyConfirmationReply,
  isPendingOfferFresh,
  type DisambiguationOffer,
  type PendingOffer,
} from "../_shared/pending-offer.ts";
import {
  clearLastAction,
  clearPendingAction,
  getOrCreateSession,
  isLastActionUndoable,
  looksLikeUndoCommand,
  stampLastAction,
  storePendingAction,
  type LastAction,
  type WebSession,
} from "../_shared/web-session.ts";
import {
  PLANNABLE_INTENTS,
  planAction,
  planOfferForResolvedTask,
} from "../_shared/action-planner.ts";
import {
  executeBulkReschedule,
  executeDelete,
  executeEdit,
  executeReschedule,
  executeUndo,
  type ExecutedAction,
} from "../_shared/action-executor-offers.ts";
import {
  buildBulkRescheduleOffer,
  buildDeleteOffer,
  buildDisambiguationOffer,
  buildEditOffer,
  buildRescheduleOffer,
  buildResultHint,
  buildUndoConfirmation,
} from "../_shared/offer-copy.ts";
import { pickDisambiguation } from "../_shared/task-disambiguation.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ============================================================================
// SYSTEM PROMPTS — imported from _shared/prompts/ (versioned)
// ============================================================================

const OLIVE_CHAT_PROMPT = CHAT_PROMPT_IMPORTED;
const CONTEXTUAL_ASK_PROMPT = CTX_ASK_PROMPT_IMPORTED;
const WEB_SEARCH_FORMAT_PROMPT = WEB_SEARCH_PROMPT_IMPORTED;

// ============================================================================
// FAST REGEX PRE-FILTER (avoids Gemini call for obvious intents)
// ============================================================================

interface PreFilterResult {
  type: 'chat' | 'contextual_ask' | 'web_search' | 'action' | 'help' | null;
  chatType?: string;
  confidence: number;
}

function preFilterIntent(message: string, conversationHistory: Array<{ role: string; content: string }>): PreFilterResult {
  const lower = message.toLowerCase().trim();

  // Help questions about Olive features
  if (/\b(how\s+(?:do\s+i|can\s+i|to)\s+(?:use|connect|invite|create|add|delete|remove|share|export|change|set|enable|disable|link|track|save))\b/i.test(lower) ||
      /\b(come\s+(?:faccio|posso|si\s+fa)\s+(?:a|per)\s+)/i.test(lower) ||
      /\b(como\s+(?:hago|puedo|se\s+hace)\s+(?:para\s+)?)/i.test(lower)) {
    return { type: 'help', confidence: 0.9 };
  }

  // Web search signals
  if ((/\b(search|google|look\s*up|find\s+(?:me|us)?\s*(?:a|the|some)?|best\s+(?:restaurants?|hotels?|places?|things?|cities|activities|spots?)|top\s+\d+|recommend\s+(?:a|some|me)|what\s+(?:are|is)\s+the\s+(?:best|top|most|popular)|where\s+(?:can|should)\s+(?:I|we)\s+(?:go|visit|eat|stay)|what's\s+(?:the\s+)?(?:weather|news|price|time\s+(?:in|at)))\b/i.test(lower)) &&
      !/\b(my\s+(?:tasks?|notes?|lists?|items?|saved|data))\b/i.test(lower)) {
    return { type: 'web_search', confidence: 0.85 };
  }

  // Contextual ask — questions about user's saved data
  if (/\b(my\s+(?:tasks?|notes?|lists?|items?|groceries?|shopping|travel|appointments?)|what\s+(?:do\s+)?i\s+have|show\s+(?:me\s+)?my|when\s+(?:is|are)\s+(?:my|the)|did\s+i\s+(?:save|add|create)|any\s+(?:tasks?|notes?|reminders?))\b/i.test(lower)) {
    return { type: 'contextual_ask', confidence: 0.85 };
  }

  // Pronoun follow-ups referencing data
  if (conversationHistory.length > 0 && /^(what|when|where|how|which|who|is\s+it|what\s+about)\b/i.test(lower) && lower.length < 60) {
    const lastAssistant = [...conversationHistory].reverse().find(m => m.role === 'assistant');
    if (lastAssistant?.content && /\b(task|note|list|item|saved|due|reminder|calendar)\b/i.test(lastAssistant.content)) {
      return { type: 'contextual_ask', confidence: 0.75 };
    }
  }

  // No strong signal — return null to trigger full AI classification
  return { type: null, confidence: 0 };
}

// ============================================================================
// HELPER: create supabase client
// ============================================================================

function getServiceSupabase() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
}

// ============================================================================
// SERVER-SIDE CONTEXT — delegates to shared orchestrator (P2)
// ============================================================================

type ServerContext = UnifiedContext;

async function fetchServerContext(
  userId: string,
  coupleId?: string,
  intentType?: string,
  userMessage?: string
): Promise<ServerContext> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!userId || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { profile: '', memories: '', patterns: '', calendar: '', agentInsights: '', deepProfile: '', savedItems: '', semanticNotes: '', semanticMemoryChunks: '', relationshipGraph: '' };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Opportunistic session cleanup (~5% of requests)
  if (Math.random() < 0.05) {
    cleanupStaleSessions(supabase, userId).catch(() => {});
  }

  return assembleFullContext(supabase, userId, {
    coupleId,
    intentType,
    userMessage,
    geminiKey: GEMINI_KEY,
  });
}

// ============================================================================
// PERPLEXITY WEB SEARCH
// ============================================================================

async function performWebSearch(query: string, conversationHistory: Array<{ role: string; content: string }>): Promise<{ content: string; citations: string[] }> {
  const PERPLEXITY_KEY = Deno.env.get('OLIVE_PERPLEXITY');
  if (!PERPLEXITY_KEY) {
    console.warn('[WebSearch] OLIVE_PERPLEXITY not configured');
    return { content: '', citations: [] };
  }

  let searchQuery = query;
  let userQuestion = query;

  if (conversationHistory.length > 0) {
    try {
      const { GoogleGenAI } = await import("https://esm.sh/@google/genai@1.0.0");
      const genai = new GoogleGenAI({ apiKey: GEMINI_KEY });
      const recentMsgs = conversationHistory.slice(-8).map(m =>
        `${m.role === 'user' ? 'User' : 'Olive'}: ${m.content.substring(0, 300)}`
      ).join('\n');

      const result = await genai.models.generateContent({
        model: getModel('lite'),
        contents: `Given this conversation:\n${recentMsgs}\n\nUser's latest: "${query}"\n\nProduce two lines:\nSEARCH_QUERY: (optimized web search, max 15 words, resolve pronouns)\nUSER_QUESTION: (full self-contained question)`,
        config: { temperature: 0.1, maxOutputTokens: 150 },
      });
      const text = result.text || '';
      const sqMatch = text.match(/SEARCH_QUERY:\s*(.+)/i);
      const uqMatch = text.match(/USER_QUESTION:\s*(.+)/i);
      if (sqMatch?.[1]?.trim()) searchQuery = sqMatch[1].trim();
      if (uqMatch?.[1]?.trim()) userQuestion = uqMatch[1].trim();
      console.log('[WebSearch] Rewritten:', searchQuery, '|', userQuestion);
    } catch (e) {
      console.warn('[WebSearch] Query rewrite failed, using original:', e);
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: `Answer the user's SPECIFIC question precisely. Include relevant links, hours, phone numbers, or addresses only if they're part of the answer.` },
          { role: 'user', content: `Question: ${userQuestion}\n\nSearch for: ${searchQuery}` },
        ],
        temperature: 0.1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.error('[WebSearch] Perplexity error:', response.status);
      return { content: '', citations: [] };
    }

    const data = await response.json();
    return {
      content: data.choices?.[0]?.message?.content || '',
      citations: data.citations || [],
    };
  } catch (e) {
    console.error('[WebSearch] Error:', e);
    return { content: '', citations: [] };
  }
}

// ============================================================================
// STREAMING RESPONSE GENERATOR (with response capture for memory evolution)
// ============================================================================

async function streamGeminiResponse(
  systemPrompt: string,
  userContent: string,
  tier: string
): Promise<Response> {
  const model = getModel(tier as any);
  console.log(`[ask-olive-stream] Streaming with ${model} (tier=${tier})`);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${GEMINI_KEY}&alt=sse`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userContent }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: tier === 'pro' ? 4096 : 2048,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[ask-olive-stream] Gemini error:', response.status, errorText);
    throw new Error(`Gemini API error: ${response.status}`);
  }

  return new Response(response.body, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// ============================================================================
// CALENDAR SYNC HELPERS
// ============================================================================
//
// These wrap the calendar-update-event / calendar-delete-event edge
// functions so the action handlers can stay focused on the DB write.
// Both helpers are intentionally swallow-and-report: a Google API error
// must NOT block the local DB mutation — but it MUST surface in the
// returned `calendar_sync` so the chat confirmation can say the truth
// ("Updated in Olive, but I couldn't reach your Google Calendar").

// Mirror of CalendarSyncStatus in _shared/calendar-sync-logger.ts. Kept
// local because this file historically pre-dated the shared module; the
// duplicate is fine as long as both stay in sync (Layer 2 of the
// 2026-05-12 fix added needs_reconnect / rate_limited / google_unavailable
// / enqueue_failed in both places).
type CalendarSyncStatus =
  | 'updated'
  | 'deleted'
  | 'already_gone'
  | 'not_connected'
  | 'no_linked_event'
  | 'etag_conflict'
  | 'needs_reconnect'
  | 'rate_limited'
  | 'google_unavailable'
  | 'enqueue_failed'
  | 'google_api_error'
  | 'token_refresh_failed'
  | 'invoke_failed';

interface CalendarSyncReport {
  status: CalendarSyncStatus;
  message?: string;
}

async function syncCalendarUpdate(
  supabase: any,
  userId: string,
  noteId: string,
  patch: { start_time?: string; all_day?: boolean; timezone?: string; title?: string },
): Promise<CalendarSyncReport> {
  try {
    const { data, error } = await supabase.functions.invoke('calendar-update-event', {
      body: { user_id: userId, note_id: noteId, patch },
    });
    if (error) {
      console.warn('[ask-olive-stream] calendar-update-event invoke failed:', error);
      return { status: 'invoke_failed', message: error.message };
    }
    return {
      status: (data?.sync_status as CalendarSyncStatus) || 'invoke_failed',
      message: data?.error,
    };
  } catch (e) {
    console.warn('[ask-olive-stream] calendar-update-event threw:', e);
    return {
      status: 'invoke_failed',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

// Translate a CalendarSyncReport into a one-line hint the LLM can use to
// stay honest in the confirmation. Phrasing is deliberate: when nothing
// went wrong on Google's side ('updated' / 'deleted' / 'not_connected' /
// 'no_linked_event') we either confirm the sync or stay silent so the
// chat doesn't volunteer "your calendar was updated" to a user who
// doesn't have a calendar connected. For real failures, we explicitly
// tell the LLM to say the calendar didn't sync.
function buildCalendarSyncHint(report: CalendarSyncReport): string {
  switch (report.status) {
    case 'updated':
      return 'CALENDAR SYNC: ✓ The linked Google Calendar event was updated to match. You can mention this naturally.\n\n';
    case 'deleted':
      return 'CALENDAR SYNC: ✓ The linked Google Calendar event was deleted. You can mention this naturally.\n\n';
    case 'already_gone':
      return 'CALENDAR SYNC: The Google Calendar event was already removed before this. The user no longer has it on their calendar.\n\n';
    case 'not_connected':
    case 'no_linked_event':
      // Nothing to say — there was no calendar event to update.
      return '';
    case 'etag_conflict':
    case 'google_api_error':
    case 'token_refresh_failed':
    case 'invoke_failed':
      return 'CALENDAR SYNC: ✗ The change was saved in Olive but did NOT sync to Google Calendar. Tell the user honestly that you updated it in Olive but couldn\'t reach Google Calendar this time, and they can refresh or reconnect from Settings.\n\n';
  }
}

async function syncCalendarDelete(
  supabase: any,
  userId: string,
  noteId: string,
): Promise<CalendarSyncReport> {
  try {
    const { data, error } = await supabase.functions.invoke('calendar-delete-event', {
      body: { user_id: userId, note_id: noteId },
    });
    if (error) {
      console.warn('[ask-olive-stream] calendar-delete-event invoke failed:', error);
      return { status: 'invoke_failed', message: error.message };
    }
    return {
      status: (data?.sync_status as CalendarSyncStatus) || 'invoke_failed',
      message: data?.error,
    };
  } catch (e) {
    console.warn('[ask-olive-stream] calendar-delete-event threw:', e);
    return {
      status: 'invoke_failed',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

// ============================================================================
// PRE-FLOW GATE — Phase 1.1 / 1.4 (web Ask Olive)
// ============================================================================
//
// Runs BEFORE classification. Handles three short-circuit cases:
//   1. Undo command ("undo" / "wait no") — reverses the last action if
//      it's inside the 5-minute window and clears the stamp.
//   2. Pending confirmation — when the previous turn surfaced an offer
//      and this turn is a yes/no, execute or cancel.
//   3. Disambiguation pick — when the previous turn was a "did you mean
//      A or B?" and this turn names one, resolve and execute.
//
// Each case streams its own response and returns it; null means
// "continue to normal classification."

async function fetchUserTimezone(supabase: any, userId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('clerk_profiles')
      .select('timezone')
      .eq('id', userId)
      .maybeSingle();
    return data?.timezone || null;
  } catch {
    return null;
  }
}

async function handlePreFlowGate(args: {
  supabase: any;
  userId: string;
  message: string;
  userTimezone: string;
  lang: 'en' | 'es' | 'it';
}): Promise<Response | null> {
  const { supabase, userId, message, userTimezone, lang } = args;

  // 1. Undo — highest priority. A user saying "undo" after we did
  // something should not be re-classified into something else.
  if (looksLikeUndoCommand(message)) {
    const undoResp = await runUndo(supabase, userId, message);
    if (undoResp) return undoResp;
    // No undoable action → fall through. The user might have meant
    // something else; let normal classification take over.
  }

  // 2. Pending confirmation
  const session = await getOrCreateSession(supabase, userId);
  const pending = session.context_data.pending_action;
  if (session.conversation_state === 'AWAITING_CONFIRMATION' && isPendingOfferFresh(pending)) {
    // Disambiguation reply has its own resolution path — try it first
    // because a user reply might match a candidate name verbatim.
    if (pending.type === 'disambiguate') {
      return await handleDisambiguationReply(supabase, session, pending, message, userTimezone, lang);
    }

    const confirmation = classifyConfirmationReply(message);
    if (confirmation === 'affirm') {
      return await executeConfirmedOffer(supabase, session, pending as Exclude<PendingOffer, DisambiguationOffer | { type: 'save_artifact' }>, userTimezone, lang);
    }
    if (confirmation === 'deny') {
      await clearPendingAction(supabase, session);
      return streamGeminiResponse(
        `You are Olive. The user just declined a proposal you made. Acknowledge briefly and warmly (1 sentence) — no apology spiral, no follow-up question. ${OLIVE_CHAT_PROMPT}`,
        `User declined the pending action: "${message}". Acknowledge in 1 sentence.`,
        'lite',
      );
    }

    // Cross-surface parity with WhatsApp's smart re-targeting: before
    // discarding a pending reschedule proposal, try to interpret the
    // message as a *refinement* of the same action (different date).
    // If matched, replace the pending offer's new_iso/readable and
    // re-prompt for confirmation instead of starting over.
    if (pending.type === 'reschedule_task') {
      try {
        const { detectRescheduleRefinement } = await import('../_shared/conversation-continuity.ts');
        const refined = detectRescheduleRefinement(pending, message, userTimezone, lang);
        if (refined) {
          await supabase
            .from('user_sessions')
            .update({
              conversation_state: 'AWAITING_CONFIRMATION',
              context_data: { ...session.context_data, pending_action: refined.updated },
              updated_at: new Date().toISOString(),
            })
            .eq('id', session.id);
          console.log(
            '[chat/pre-flow] Re-targeted pending reschedule_task →',
            refined.parsedReadable,
          );
          return streamGeminiResponse(
            `You are Olive. The user refined the date on a proposal you just made — confirm the NEW proposal in 1-2 sentences using the EXACT phrasing in RESULT, then ask them to reply "yes" to confirm. ${OLIVE_CHAT_PROMPT}`,
            `RESULT: Move "${(refined.updated as any).task_summary}" to ${refined.parsedReadable}? Reply "yes" to confirm.`,
            'lite',
          );
        }
      } catch (refineErr) {
        console.warn(
          '[chat/pre-flow] Re-target attempt failed (non-fatal):',
          refineErr instanceof Error ? refineErr.message : refineErr,
        );
      }
    }

    // Neither yes nor no, not a refinement — clear pending and let
    // normal classification run. The next turn's intent overrides any
    // stale offer. WhatsApp does the same; consistency keeps surprises
    // low.
    await clearPendingAction(supabase, session);
    return null;
  }

  return null;
}

// Executor for an affirmed offer. Dispatches by offer type.
async function executeConfirmedOffer(
  supabase: any,
  session: WebSession,
  offer: Exclude<PendingOffer, DisambiguationOffer | { type: 'save_artifact' }>,
  userTimezone: string,
  lang: 'en' | 'es' | 'it',
): Promise<Response> {
  let result: ExecutedAction | null = null;
  const ctx = { supabase, userId: session.user_id, invokedFrom: 'ask-olive-stream' };
  if (offer.type === 'reschedule_task') {
    result = await executeReschedule(ctx, offer);
  } else if (offer.type === 'delete_task') {
    result = await executeDelete(ctx, offer);
  } else if (offer.type === 'edit_task') {
    result = await executeEdit(ctx, offer);
  } else if (offer.type === 'bulk_reschedule_weekday') {
    result = await executeBulkReschedule(ctx, offer);
  }

  if (!result) {
    await clearPendingAction(supabase, session);
    return streamGeminiResponse(
      `You are Olive. An action you tried to perform failed. Tell the user honestly and briefly (1 sentence) and offer to try again. ${OLIVE_CHAT_PROMPT}`,
      `The action ${offer.type} failed for ${('task_summary' in offer) ? offer.task_summary : 'this item'}. Tell the user in 1 sentence.`,
      'lite',
    );
  }

  // Stamp last_action for undo and clear pending in one write.
  await stampLastAction(supabase, session, result.last_action);

  const hint = buildResultHint(result, { timezone: userTimezone, lang });
  const prompt = `You are Olive. You just executed a confirmed action. Confirm in 1-2 sentences using the EXACT phrasing in RESULT, do not invent details about the calendar. ${OLIVE_CHAT_PROMPT}`;
  const content = `RESULT (surface this verbatim, then optionally add a brief warm closing sentence):\n${hint}`;
  return streamGeminiResponse(prompt, content, 'lite');
}

// Handle a user reply to a disambiguation offer.
async function handleDisambiguationReply(
  supabase: any,
  session: WebSession,
  offer: DisambiguationOffer,
  message: string,
  userTimezone: string,
  lang: 'en' | 'es' | 'it',
): Promise<Response> {
  const pick = pickDisambiguation(message, offer.candidates.map((c) => ({
    id: c.task_id,
    summary: c.summary,
    due_date: c.due_date,
    reminder_time: c.reminder_time,
    updated_at: null,
  })));

  if (pick.kind === 'NONE_OF_THESE' || pick.kind === 'UNCLEAR') {
    if (pick.kind === 'NONE_OF_THESE') {
      await clearPendingAction(supabase, session);
      return streamGeminiResponse(
        `You are Olive. The user said none of the candidates you offered are the right one. Acknowledge in 1 sentence and invite them to rephrase. ${OLIVE_CHAT_PROMPT}`,
        `User said none of the disambiguation candidates fit. Ask once for clearer wording.`,
        'lite',
      );
    }
    // UNCLEAR — keep the offer alive and re-ask the question.
    return streamGeminiResponse(
      `You are Olive. The user's reply to your disambiguation question didn't match any candidate. Re-ask which one they mean in 1 sentence and re-list the candidates as a numbered list. ${OLIVE_CHAT_PROMPT}`,
      `Candidates still on offer:\n${offer.candidates.map((c, i) => `${i + 1}. ${c.summary}`).join('\n')}`,
      'lite',
    );
  }

  // We have a pick. Re-build the original intent against this task and
  // execute as a normal confirmed offer.
  const pi = offer.pending_intent;
  const synth: any = {
    intent:
      pi.kind === 'reschedule_task' ? 'set_due'
      : pi.kind === 'delete_task' ? 'delete'
      : 'edit_title', // edit_* — we collapse to a single re-plan
    target_task_id: pick.task.id,
    target_task_name: pick.task.summary,
    matched_skill_id: null,
    parameters: {
      due_date_expression: pi.kind === 'reschedule_task' ? pi.readable : null,
      new_title: pi.kind === 'edit_task' ? pi.changes.new_title ?? null : null,
      new_location: pi.kind === 'edit_task' ? pi.changes.new_location ?? null : null,
      new_description: pi.kind === 'edit_task' ? pi.changes.new_description ?? null : null,
      new_duration_minutes: pi.kind === 'edit_task' ? pi.changes.new_duration_minutes ?? null : null,
    },
    confidence: 0.95,
    reasoning: 'Resolved via disambiguation pick',
  };
  // Bypass the planner's date re-parse: build the offer directly from the
  // pending_intent (which already contains the resolved ISO).
  let directOffer: PendingOffer | null = null;
  if (pi.kind === 'reschedule_task') {
    directOffer = {
      type: 'reschedule_task',
      task_id: pick.task.id,
      task_summary: pick.task.summary,
      field: pi.has_time ? 'reminder_time' : 'due_date',
      new_iso: pi.new_iso,
      has_time: pi.has_time,
      prior_due_date: pick.task.due_date,
      prior_reminder_time: pick.task.reminder_time,
      readable: pi.readable,
      timezone: pi.timezone,
      offered_at: new Date().toISOString(),
    };
  } else if (pi.kind === 'delete_task') {
    directOffer = {
      type: 'delete_task',
      task_id: pick.task.id,
      task_summary: pick.task.summary,
      prior_due_date: pick.task.due_date,
      prior_reminder_time: pick.task.reminder_time,
      offered_at: new Date().toISOString(),
    };
  } else if (pi.kind === 'edit_task') {
    directOffer = {
      type: 'edit_task',
      task_id: pick.task.id,
      task_summary: pick.task.summary,
      changes: pi.changes,
      prior: { summary: pick.task.summary, description: null },
      offered_at: new Date().toISOString(),
    };
  }

  if (!directOffer) {
    await clearPendingAction(supabase, session);
    return streamGeminiResponse(
      `You are Olive. Something went wrong resolving the disambiguation. Apologize once and ask the user to rephrase. ${OLIVE_CHAT_PROMPT}`,
      `Disambig resolution failed.`,
      'lite',
    );
  }

  // Execute the resolved offer directly — the user already implied
  // affirmation by picking from the shortlist.
  return await executeConfirmedOffer(supabase, session, directOffer as Exclude<PendingOffer, DisambiguationOffer | { type: 'save_artifact' }>, userTimezone, lang);
}

// Render the offer-line that goes to the LLM as "use this verbatim".
function renderOfferLine(offer: PendingOffer, timezone: string, lang: 'en' | 'es' | 'it'): string {
  switch (offer.type) {
    case 'reschedule_task':
      return buildRescheduleOffer(offer, { timezone, lang });
    case 'delete_task':
      return buildDeleteOffer(offer);
    case 'edit_task':
      return buildEditOffer(offer);
    case 'disambiguate':
      return buildDisambiguationOffer(offer);
    case 'bulk_reschedule_weekday':
      return buildBulkRescheduleOffer(offer, { timezone, lang });
    case 'save_artifact':
      // Not generated by our planner; surface a generic offer.
      return `🌿 Save this — confirm?`;
  }
}

// Undo handler. Pulls last_action from the session, dispatches reverse,
// streams a one-sentence acknowledgement.
async function runUndo(supabase: any, userId: string, _message: string): Promise<Response | null> {
  const session = await getOrCreateSession(supabase, userId);
  const last = session.context_data.last_action ?? null;
  if (!isLastActionUndoable(last)) return null;

  const result = await executeUndo(
    { supabase, userId, invokedFrom: 'ask-olive-stream' },
    last,
  );
  await clearLastAction(supabase, session);

  const taskSummary = 'task_summary' in last ? last.task_summary : 'that one';
  const line = buildUndoConfirmation({ kind: result.kind, reverted: result.reverted, detail: result.detail }, taskSummary);
  const prompt = `You are Olive. Confirm the undo in 1 sentence, using the line below verbatim. ${OLIVE_CHAT_PROMPT}`;
  const content = `UNDO RESULT (verbatim): ${line}`;
  return streamGeminiResponse(prompt, content, 'lite');
}

// ============================================================================
// ACTION HANDLER (P3: upgraded to use process-note + shared classifier)
// ============================================================================

async function handleAction(
  supabase: any,
  userId: string,
  spaceId: string | null,
  message: string,
  classifiedIntent: ClassifiedIntent
): Promise<Record<string, any> | null> {
  const intent = classifiedIntent.intent;

  // ── CREATE TASK (delegate to process-note for full AI categorization) ──
  if (intent === 'create' || intent === 'remind' || intent === 'create_list') {
    try {
      const { data, error } = await supabase.functions.invoke('process-note', {
        body: {
          text: message,
          user_id: userId,
          space_id: spaceId,
          source: 'web_chat',
        },
      });

      if (error) {
        console.error('[ask-olive-stream] process-note error:', error);
        return null;
      }

      const noteId = data?.id || data?.note?.id;
      const summary = data?.summary || data?.note?.summary || message;
      const category = data?.category || data?.note?.category;
      const dueDate = data?.due_date || data?.note?.due_date;
      const reminderTime = data?.reminder_time || data?.note?.reminder_time;

      if (intent === 'create_list') {
        return { action: 'list_created', name: classifiedIntent.parameters?.list_name || summary };
      }

      if (intent === 'remind' || reminderTime) {
        return { action: 'reminder_set', id: noteId, summary, reminder_time: reminderTime, due_date: dueDate };
      }

      return { action: 'task_created', id: noteId, summary, category, due_date: dueDate };
    } catch (e) {
      console.error('[ask-olive-stream] Action create error:', e);
      return null;
    }
  }

  // ── COMPLETE TASK ──
  if (intent === 'complete') {
    const taskName = classifiedIntent.target_task_name;
    if (!taskName) return null;

    let query = supabase
      .from('clerk_notes')
      .select('id, summary')
      .eq('completed', false)
      .ilike('summary', `%${taskName.substring(0, 40)}%`)
      .limit(1);

    if (spaceId) {
      query = query.or(`author_id.eq.${userId},space_id.eq.${spaceId}`);
    } else {
      query = query.eq('author_id', userId);
    }

    const { data: tasks } = await query;
    if (!tasks || tasks.length === 0) return null;

    const { error } = await supabase
      .from('clerk_notes')
      .update({ completed: true, updated_at: new Date().toISOString() })
      .eq('id', tasks[0].id);

    if (error) return null;
    return { action: 'task_completed', id: tasks[0].id, summary: tasks[0].summary };
  }

  // ── DELETE TASK ──
  if (intent === 'delete') {
    const taskName = classifiedIntent.target_task_name;
    if (!taskName) return null;

    let query = supabase
      .from('clerk_notes')
      .select('id, summary')
      .ilike('summary', `%${taskName.substring(0, 40)}%`)
      .limit(1);

    if (spaceId) {
      query = query.or(`author_id.eq.${userId},space_id.eq.${spaceId}`);
    } else {
      query = query.eq('author_id', userId);
    }

    const { data: tasks } = await query;
    if (!tasks || tasks.length === 0) return null;

    // Tear down any linked Google Calendar event FIRST. Doing this before
    // the clerk_notes delete keeps us from orphaning the calendar row
    // (calendar_events.note_id has ON DELETE SET NULL — the link would
    // be lost the moment the note is gone). Errors are non-fatal: we
    // surface the sync state to the user via the action result.
    const calendarSync = await syncCalendarDelete(supabase, userId, tasks[0].id);

    const { error } = await supabase
      .from('clerk_notes')
      .delete()
      .eq('id', tasks[0].id);

    if (error) return null;
    return {
      action: 'task_deleted',
      id: tasks[0].id,
      summary: tasks[0].summary,
      calendar_sync: calendarSync,
    };
  }

  // ── SET PRIORITY ──
  if (intent === 'set_priority') {
    const taskName = classifiedIntent.target_task_name;
    const rawPriority = (classifiedIntent.parameters?.priority || '').toLowerCase();
    const priority = rawPriority === 'low' ? 'low' : rawPriority === 'medium' ? 'medium' : 'high';
    if (!taskName) return null;

    let query = supabase
      .from('clerk_notes')
      .select('id, summary')
      .eq('completed', false)
      .ilike('summary', `%${taskName.substring(0, 40)}%`)
      .limit(1);

    if (spaceId) {
      query = query.or(`author_id.eq.${userId},space_id.eq.${spaceId}`);
    } else {
      query = query.eq('author_id', userId);
    }

    const { data: tasks } = await query;
    if (!tasks || tasks.length === 0) return null;

    const { error } = await supabase
      .from('clerk_notes')
      .update({ priority, updated_at: new Date().toISOString() })
      .eq('id', tasks[0].id);

    if (error) return null;
    return { action: 'priority_set', id: tasks[0].id, summary: tasks[0].summary, priority };
  }

  // ── SET DUE DATE ──
  if (intent === 'set_due') {
    const taskName = classifiedIntent.target_task_name;
    const dateExpr = classifiedIntent.parameters?.due_date_expression;
    if (!taskName || !dateExpr) return null;

    // Parse the date
    let userTimezone = 'America/New_York';
    try {
      const { data: profile } = await supabase
        .from('clerk_profiles')
        .select('timezone')
        .eq('id', userId)
        .maybeSingle();
      if (profile?.timezone) userTimezone = profile.timezone;
    } catch {}

    // parseNaturalDate's signature is (expression, timezone, lang?) and it
    // returns { date, time, readable } where `date` is a full ISO timestamp
    // (the parser always assigns a default time when none was specified).
    // The previous call passed `{ timezone }` as the 2nd positional arg,
    // which coerced to "[object Object]" and broke downstream — and the
    // handler then crashed accessing the non-existent `parsed.iso` /
    // `parsed.hasTime`. handleAction caught the throw and returned null,
    // which is why Ask Olive's confirmations never matched reality:
    // the chat fell through to general-chat and hallucinated success.
    const parsed = parseNaturalDate(dateExpr, userTimezone);
    if (!parsed.date) return null;

    // The parser doesn't expose "did the user specify a time?" directly,
    // but `readable` includes "at H:MM" / "H:MM" only when a time-of-day
    // was present in the user's expression. Use that as the all-day signal.
    const hasTime = /\bat\s+\d/i.test(parsed.readable) || /\b\d{1,2}:\d{2}\b/.test(parsed.readable) || /\bin\s+\d+\s*(minute|hour|min|hr)/i.test(parsed.readable);

    let query = supabase
      .from('clerk_notes')
      .select('id, summary')
      .eq('completed', false)
      .ilike('summary', `%${taskName.substring(0, 40)}%`)
      .limit(1);

    if (spaceId) {
      query = query.or(`author_id.eq.${userId},space_id.eq.${spaceId}`);
    } else {
      query = query.eq('author_id', userId);
    }

    const { data: tasks } = await query;
    if (!tasks || tasks.length === 0) return null;

    const updateFields: Record<string, any> = { updated_at: new Date().toISOString() };
    if (hasTime) {
      updateFields.reminder_time = parsed.date;
      updateFields.due_date = parsed.date.split('T')[0];
    } else {
      updateFields.due_date = parsed.date.split('T')[0];
    }

    const { error } = await supabase
      .from('clerk_notes')
      .update(updateFields)
      .eq('id', tasks[0].id);

    if (error) return null;

    // Propagate the new schedule to Google Calendar if the task is linked
    // to an event. We DON'T fall through to chat on calendar errors — the
    // DB write succeeded so the user's note view is correct; sync status
    // flows back via `calendar_sync` so the confirmation message can tell
    // the truth about what happened on Google's side.
    const calendarSync = await syncCalendarUpdate(supabase, userId, tasks[0].id, {
      start_time: hasTime ? parsed.date : updateFields.due_date,
      all_day: !hasTime,
      timezone: userTimezone,
    });

    return {
      action: 'due_date_set',
      id: tasks[0].id,
      summary: tasks[0].summary,
      due_date: updateFields.due_date,
      reminder_time: updateFields.reminder_time,
      calendar_sync: calendarSync,
    };
  }

  // ── EXPENSE ──
  if (intent === 'expense') {
    try {
      const { data, error } = await supabase.functions.invoke('process-note', {
        body: {
          text: message,
          user_id: userId,
          space_id: spaceId,
          source: 'web_chat',
        },
      });
      if (error) return null;
      return { action: 'expense_created', id: data?.id || data?.note?.id, summary: data?.summary || message };
    } catch {
      return null;
    }
  }

  // ── ASSIGN TASK (P4) ──
  if (intent === 'assign') {
    const taskName = classifiedIntent.target_task_name;
    if (!taskName || !spaceId) return null;

    // Find partner (or any other member). Use olive_space_members so this
    // works for non-couple spaces too — the legacy get_space_members RPC
    // only reads clerk_couple_members and would return empty for family /
    // business / custom spaces.
    const { data: members } = await supabase
      .from('olive_space_members')
      .select('user_id, nickname, clerk_profiles:user_id (display_name)')
      .eq('space_id', spaceId);
    const partner = members?.find((m: any) => m.user_id !== userId);
    if (!partner) return null;

    let query = supabase
      .from('clerk_notes')
      .select('id, summary')
      .eq('completed', false)
      .ilike('summary', `%${taskName.substring(0, 40)}%`)
      .or(`author_id.eq.${userId},space_id.eq.${spaceId}`)
      .limit(1);

    const { data: tasks } = await query;
    if (!tasks?.length) return null;

    const { error } = await supabase
      .from('clerk_notes')
      .update({ task_owner: partner.user_id, updated_at: new Date().toISOString() })
      .eq('id', tasks[0].id);

    if (error) return null;
    const assigneeName = (partner as any).nickname
      || (partner as any).clerk_profiles?.display_name
      || 'Member';
    return { action: 'task_assigned', id: tasks[0].id, summary: tasks[0].summary, assignee: assigneeName };
  }

  // ── MOVE TASK (P4) ──
  if (intent === 'move') {
    const taskName = classifiedIntent.target_task_name;
    const listName = classifiedIntent.parameters?.list_name;
    if (!taskName || !listName) return null;

    // Find or create list
    let listQuery = supabase
      .from('clerk_lists')
      .select('id, name')
      .ilike('name', `%${listName}%`)
      .or(spaceId ? `author_id.eq.${userId},space_id.eq.${spaceId}` : `author_id.eq.${userId}`)
      .limit(1);

    const { data: lists } = await listQuery;
    let targetListId: string;
    let targetListName: string;

    if (lists?.length) {
      targetListId = lists[0].id;
      targetListName = lists[0].name;
    } else {
      // Create list
      const { data: newList, error: listErr } = await supabase
        .from('clerk_lists')
        .insert({ name: listName, author_id: userId, space_id: spaceId })
        .select('id, name')
        .single();
      if (listErr || !newList) return null;
      targetListId = newList.id;
      targetListName = newList.name;
    }

    // Find task
    let taskQuery = supabase
      .from('clerk_notes')
      .select('id, summary')
      .eq('completed', false)
      .ilike('summary', `%${taskName.substring(0, 40)}%`)
      .limit(1);

    if (spaceId) {
      taskQuery = taskQuery.or(`author_id.eq.${userId},space_id.eq.${spaceId}`);
    } else {
      taskQuery = taskQuery.eq('author_id', userId);
    }

    const { data: tasks } = await taskQuery;
    if (!tasks?.length) return null;

    const { error } = await supabase
      .from('clerk_notes')
      .update({ list_id: targetListId, updated_at: new Date().toISOString() })
      .eq('id', tasks[0].id);

    if (error) return null;
    return { action: 'task_moved', id: tasks[0].id, summary: tasks[0].summary, list: targetListName };
  }

  return null;
}

// ============================================================================
// MEMORY EVOLUTION + DAILY LOG (fire-and-forget after streaming completes)
// ============================================================================

function scheduleMemoryEvolution(userId: string, userMessage: string, responsePreview: string): void {
  const supabase = getServiceSupabase();
  // Memory evolution
  evolveProfileFromConversation(supabase, userId, userMessage, responsePreview).catch((err) => {
    console.warn('[ask-olive-stream] Memory evolution error (non-blocking):', err);
  });
  // Daily log append (P4 parity with WhatsApp)
  supabase.rpc('append_to_daily_log', {
    p_user_id: userId,
    p_content: `[web_chat] User: ${userMessage.substring(0, 120)} → Olive responded`,
    p_source: 'web_chat',
  }).then(() => console.log('[ask-olive-stream] Daily log appended'))
    .catch(() => { /* non-blocking */ });
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, context, user_id, couple_id, space_id } = await req.json();
    // Spaces Phase 2-2: prefer space_id (canonical) over couple_id (legacy).
    // For couple-type spaces both are the same UUID via the 1:1 bridge, so
    // existing 2-person and 3-10 person couple-type spaces are unaffected.
    // For non-couple spaces (family / business / custom), only space_id is
    // populated and is the only path that returns the user's shared notes.
    const scopeSpaceId: string | null = space_id ?? couple_id ?? null;

    if (!GEMINI_KEY) throw new Error('GEMINI_API key not configured');
    if (!message?.trim()) throw new Error('Empty message');

    const conversationHistory: Array<{ role: string; content: string }> =
      context?.conversation_history || [];

    // ── Step 0: Pre-flow gate (undo / pending confirm / disambig pick) ──
    // This MUST run before classification. The brand contract says Olive
    // surfaces the proposal and waits for "yes" — so when an offer is
    // pending and the user says "yes", we execute the stored plan
    // verbatim instead of re-classifying (the LLM might disagree with its
    // own past offer, which is how the silent-execute bug shipped).
    const supabaseEarly = getServiceSupabase();
    const userTimezone =
      (await fetchUserTimezone(supabaseEarly, user_id)) ||
      (context?.timezone as string) ||
      'America/New_York';
    const gateResult = await handlePreFlowGate({
      supabase: supabaseEarly,
      userId: user_id,
      message,
      userTimezone,
      lang: (context?.language as 'en' | 'es' | 'it') || 'en',
    });
    if (gateResult) return gateResult;

    // ── Step 1: Fast regex pre-filter ────────────────────────────
    const preFilter = preFilterIntent(message, conversationHistory);

    // Determine effective intent type
    let effectiveType = preFilter.type;
    let classifiedIntent: ClassifiedIntent | null = null;

    // For actions or ambiguous cases, use the shared AI classifier
    const isLikelyAction = /\b(add|create|make|put|save|mark|complete|finish|done|check\s*off|remind|delete|remove|set\s+(?:priority|due)|assign)\b/i.test(message.toLowerCase());

    if (isLikelyAction || !effectiveType) {
      try {
        // Fetch minimal context for classifier
        const supabase = getServiceSupabase();
        const [tasksResult, memoriesResult] = await Promise.all([
          supabase
            .from('clerk_notes')
            .select('id, summary, due_date, priority')
            .or(scopeSpaceId ? `author_id.eq.${user_id},space_id.eq.${scopeSpaceId}` : `author_id.eq.${user_id}`)
            .eq('completed', false)
            .order('created_at', { ascending: false })
            .limit(20),
          supabase
            .from('user_memories')
            .select('title, content, category')
            .eq('user_id', user_id)
            .eq('is_active', true)
            .limit(10),
        ]);

        // Resolve partner identity (best-effort, non-blocking) so the
        // classifier can validate "text/tell <NAME>" verb-targets against
        // the actual partner — same continuity fix applied in WhatsApp.
        let streamPartnerName: string | null = null;
        let streamSelfName: string | null = null;
        if (scopeSpaceId) {
          try {
            const { data: coupleRow } = await supabase
              .from('clerk_couples')
              .select('you_name, partner_name, created_by')
              .eq('id', scopeSpaceId)
              .maybeSingle();
            if (coupleRow) {
              const isCreator = coupleRow.created_by === user_id;
              streamPartnerName = (isCreator ? coupleRow.partner_name : coupleRow.you_name) || null;
              streamSelfName = (isCreator ? coupleRow.you_name : coupleRow.partner_name) || null;
            }
          } catch { /* non-blocking */ }
        }

        const result = await classifyIntent({
          message,
          conversationHistory,
          activeTasks: (tasksResult.data || []).map((t: any) => ({
            id: t.id,
            summary: t.summary,
            due_date: t.due_date,
            priority: t.priority || 'medium',
          })),
          userMemories: memoriesResult.data || [],
          activatedSkills: [],
          userLanguage: context?.language || 'en',
          partnerName: streamPartnerName,
          selfName: streamSelfName,
        });

        if (result.intent) {
          classifiedIntent = result.intent;
          console.log(`[ask-olive-stream] AI classified: ${classifiedIntent.intent} (conf: ${classifiedIntent.confidence})`);

          // Map classified intent to effective type. The edit_* and undo
          // intents introduced in Phase 1.2 / 1.4 also route to 'action'
          // — they're mutating operations subject to the same offer-
          // before-execute contract as the rest.
          const actionIntents = [
            'create', 'complete', 'delete', 'set_priority', 'set_due', 'remind',
            'move', 'assign', 'expense', 'create_list',
            'edit_title', 'edit_location', 'edit_description', 'edit_duration',
            'undo',
            // Phase 3.2 — bulk operations route to action so the
            // offer-before-execute flow runs.
            'bulk_reschedule_weekday',
          ];
          if (actionIntents.includes(classifiedIntent.intent)) {
            effectiveType = 'action';
          } else if (classifiedIntent.intent === 'web_search') {
            effectiveType = 'web_search';
          } else if (classifiedIntent.intent === 'contextual_ask' || classifiedIntent.intent === 'search') {
            effectiveType = 'contextual_ask';
          } else {
            effectiveType = 'chat';
          }
        }
      } catch (classifyErr) {
        console.warn('[ask-olive-stream] Classification failed, falling back to regex:', classifyErr);
        if (!effectiveType) effectiveType = 'chat';
      }
    }

    if (!effectiveType) effectiveType = 'chat';

    console.log(`[ask-olive-stream] Effective intent: ${effectiveType}`);

    // ── Step 2: Route to model tier ──────────────────────────────
    const intentMap: Record<string, string> = {
      'web_search': 'web_search',
      'contextual_ask': 'contextual_ask',
      'chat': 'chat',
      'help': 'chat',
      'action': 'chat',
    };
    const route = routeIntent(
      intentMap[effectiveType] || 'chat',
      classifiedIntent?.parameters?.chat_type || 'general'
    );
    console.log(`[ask-olive-stream] Route: tier=${route.responseTier}, reason=${route.reason}`);

    // ── Step 3: Fetch context (parallel with intent-specific work) ─
    const serverCtxPromise = fetchServerContext(user_id, scopeSpaceId ?? undefined, effectiveType, message);

    // ── Step 4: Intent-specific handling ──────────────────────────

    // ── WEB SEARCH ────────────────────────────────────────────────
    if (effectiveType === 'web_search') {
      const [serverCtx, searchResult] = await Promise.all([
        serverCtxPromise,
        performWebSearch(message, conversationHistory),
      ]);

      if (!searchResult.content) {
        const fullContext = formatContextForPrompt(serverCtx, {
          userMessage: message,
          userName: context?.user_name,
          conversationHistory,
          savedItemsContext: context?.saved_items_context,
        });
        // Schedule memory evolution
        scheduleMemoryEvolution(user_id, message, '(web search fallback to chat)');
        return streamGeminiResponse(OLIVE_CHAT_PROMPT, fullContext, route.responseTier);
      }

      const citationsList = searchResult.citations.length > 0
        ? '\n\nSOURCES:\n' + searchResult.citations.map((c: string, i: number) => `[${i + 1}] ${c}`).join('\n')
        : '';

      const searchContext = `You are Olive, a world-class AI assistant — like a brilliant friend who knows the world AND the user's life.

CRITICAL INSTRUCTIONS:
1. Lead with a comprehensive, expert answer using the WEB SEARCH RESULTS.
2. If relevant personal context exists (memories, saved items), WEAVE IT IN naturally.
3. Be specific, helpful, and thorough. Give real recommendations with details.
4. Use markdown formatting (bold, bullets, numbered lists).
5. After substantial content, suggest saving it: "Want me to save this to your notes?"

${serverCtx.profile}
${serverCtx.memories}
${serverCtx.deepProfile}
${serverCtx.semanticMemoryChunks}
${serverCtx.relationshipGraph}

USER'S QUESTION: ${message}

WEB SEARCH RESULTS:
${searchResult.content}
${citationsList}

${context?.user_name ? `User's name: ${context.user_name}` : ''}

Answer comprehensively using web knowledge, then naturally connect to any relevant personal context.`;

      const historyCtx = conversationHistory.length > 0
        ? '\n\nCONVERSATION HISTORY:\n' + conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')
        : '';

      scheduleMemoryEvolution(user_id, message, searchResult.content.substring(0, 200));
      return streamGeminiResponse(searchContext, searchContext + historyCtx, 'standard');
    }

    // ── CONTEXTUAL ASK ────────────────────────────────────────────
    if (effectiveType === 'contextual_ask') {
      const serverCtx = await serverCtxPromise;

      const msgLower = message.toLowerCase();
      const isGeneralKnowledge = (
        /\b(what\s+(?:are|is)\s+the\s+(?:best|top|most|greatest|popular|famous)|best\s+(?:cities|restaurants?|hotels?|places?|things?|activities|spots?)|top\s+\d+|recommend\s+(?:a|some)|where\s+(?:should|can)\s+(?:i|we)\s+(?:go|visit|eat|stay))\b/i.test(msgLower) ||
        /\b(what\s+(?:should|can|do)\s+(?:i|we)\s+(?:do|see|visit|try|eat)\s+(?:in|at|near|for))\b/i.test(msgLower)
      ) && !/\b(my\s+(?:tasks?|notes?|lists?|saved))\b/i.test(msgLower);

      let webSearchContext = '';
      if (isGeneralKnowledge) {
        console.log('[ask-olive-stream] Contextual ask is general knowledge — adding Perplexity');
        const searchResult = await performWebSearch(message, conversationHistory);
        if (searchResult.content) {
          webSearchContext = `\n## WEB SEARCH RESULTS (authoritative external knowledge):\n${searchResult.content}\n`;
          if (searchResult.citations.length > 0) {
            webSearchContext += `\nSources: ${searchResult.citations.slice(0, 3).join(', ')}\n`;
          }
        }
      }

      const isHybrid = webSearchContext.length > 0;
      const hybridPrompt = isHybrid
        ? `You are Olive, a world-class AI assistant — like a brilliant friend who knows the world AND the user's life.

CRITICAL INSTRUCTIONS:
1. Lead with a comprehensive, expert answer using the WEB SEARCH RESULTS.
2. Then WEAVE IN any relevant personal context (saved items, calendar) naturally.
3. Be specific, helpful, thorough — use markdown formatting.
4. After substantial content, suggest: "Want me to save this to your notes?"
`
        : CONTEXTUAL_ASK_PROMPT;

      const ctxAskContent = `${hybridPrompt}

${webSearchContext}
${serverCtx.semanticNotes || serverCtx.savedItems}
${serverCtx.semanticMemoryChunks}
${serverCtx.calendar}
${serverCtx.memories}
${serverCtx.deepProfile}
${serverCtx.relationshipGraph}
${serverCtx.agentInsights}
${serverCtx.partnerContext}
${serverCtx.taskAnalytics}
${serverCtx.skills}

${conversationHistory.length > 0
  ? '\n## RECENT CONVERSATION:\n' + conversationHistory.map(m => `${m.role === 'user' ? 'User' : 'Olive'}: ${m.content}`).join('\n')
  : ''}

${context?.user_name ? `User's name: ${context.user_name}` : ''}

USER'S QUESTION: ${message}

${isHybrid ? 'Answer comprehensively using web knowledge, then naturally connect to personal context.' : 'Respond with helpful, specific information extracted from their saved data.'}`;

      scheduleMemoryEvolution(user_id, message, '(contextual ask)');
      return streamGeminiResponse(hybridPrompt, ctxAskContent, isHybrid ? 'standard' : route.responseTier);
    }

    // ── ACTION (P3: full action parity via shared classifier + process-note) ──
    if (effectiveType === 'action' && classifiedIntent) {
      // Phase 1 Task 1-E: Confidence floor for destructive actions.
      // Below the floor we don't execute — we ask the user to confirm.
      const floorCheck = checkConfidenceFloor(classifiedIntent.intent, classifiedIntent.confidence);
      console.log(`[ask-olive-stream] Confidence floor: ${floorCheck.reason}`);

      if (!floorCheck.passes) {
        const targetDesc = classifiedIntent.target_task_name
          ? `"${classifiedIntent.target_task_name}"`
          : 'this item';
        const clarifyPrompt = `You are Olive. The user issued a potentially destructive action ("${classifiedIntent.intent}" on ${targetDesc}) but you're not confident (${(classifiedIntent.confidence * 100).toFixed(0)}% confidence, need ${(floorCheck.floor * 100).toFixed(0)}%). Ask the user to confirm exactly which task they want to ${classifiedIntent.intent.replace('_', ' ')} — keep it warm and brief (1-2 sentences). Do NOT perform the action.`;
        const clarifyContent = `User's original request: "${message}"\n\nClassifier interpretation: intent=${classifiedIntent.intent}, target=${classifiedIntent.target_task_name || 'none'}, confidence=${classifiedIntent.confidence}\n\nAsk the user to confirm before you proceed.`;
        scheduleMemoryEvolution(user_id, message, `Confidence floor triggered: ${floorCheck.reason}`);
        return streamGeminiResponse(clarifyPrompt, clarifyContent, 'lite');
      }

      const serverCtx = await serverCtxPromise;
      const supabase = getServiceSupabase();

      // Phase 1.1 — Offer-before-execute. For PLANNABLE mutating intents
      // (set_due, remind, delete, edit_*), plan the action and surface
      // an offer instead of executing immediately. The user's next-turn
      // "yes" / "no" runs through handlePreFlowGate above.
      if (PLANNABLE_INTENTS.has(classifiedIntent.intent)) {
        const planResult = await planAction(supabase, classifiedIntent, {
          userId: user_id,
          spaceId: scopeSpaceId,
          userTimezone,
          originalMessage: message,
        });

        if (planResult.kind === 'offer') {
          const offer = planResult.offer;
          const session = await getOrCreateSession(supabase, user_id);
          await storePendingAction(supabase, session, offer);
          const offerLine = renderOfferLine(offer, userTimezone, (context?.language as 'en' | 'es' | 'it') || 'en');
          const offerPrompt = `You are Olive. Surface this single-line offer verbatim and wait — do not execute yet. Then add ONE short sentence in your voice (warm, direct, no fluff) reminding the user they can say "yes" / "no" / "undo later". ${OLIVE_CHAT_PROMPT}`;
          const offerContent = `OFFER TO SURFACE (use this exact phrasing for the proposal, then add your sentence):\n${offerLine}\n\nUser's original request: ${message}`;
          scheduleMemoryEvolution(user_id, message, `Offered: ${offer.type}`);
          return streamGeminiResponse(offerPrompt, offerContent, 'lite');
        }

        // Planning failed — fall through to the user-facing failure prompt.
        const fail = planResult.failure;
        const failPrompt = `You are Olive. The user asked to edit a task but planning failed. Tell them honestly and briefly what went wrong and suggest a clearer phrasing. ${OLIVE_CHAT_PROMPT}`;
        const failContent = `Original message: "${message}"\nPlanner failure: ${JSON.stringify(fail)}\nRespond in 1-2 sentences.`;
        scheduleMemoryEvolution(user_id, message, `Plan failed: ${fail.kind}`);
        return streamGeminiResponse(failPrompt, failContent, 'lite');
      }

      // Undo command via classifier (regex match is preferred and runs in
      // handlePreFlowGate; this is a safety net for less-obvious phrasings).
      if (classifiedIntent.intent === 'undo') {
        const undoResp = await runUndo(supabase, user_id, message);
        if (undoResp) return undoResp;
        // No last_action available → fall through to chat.
      }

      const actionResult = await handleAction(supabase, user_id, scopeSpaceId, message, classifiedIntent);

      if (actionResult) {
        // Build a calendar-sync hint for the confirmation prompt so Olive
        // doesn't lie when Google Calendar wasn't actually updated. The
        // hint is appended only when the action touched calendar state.
        const calSync = (actionResult as any).calendar_sync as CalendarSyncReport | undefined;
        const calendarHint = calSync ? buildCalendarSyncHint(calSync) : '';

        const confirmPrompt = `You are Olive. You just performed an action for the user. Confirm what you did warmly and briefly. Include the specific details. ${calendarHint ? 'When mentioning the calendar, be truthful — use the calendar sync state below verbatim instead of assuming Google Calendar was updated. ' : ''}${OLIVE_CHAT_PROMPT}`;
        const confirmContent = `ACTION PERFORMED:\n${JSON.stringify(actionResult)}\n\n${calendarHint}User's original request: ${message}\n\n${context?.user_name ? `User's name: ${context.user_name}` : ''}\n\nConfirm what you did in 1-2 sentences. Be specific about what was created/completed.`;
        scheduleMemoryEvolution(user_id, message, `Action: ${actionResult.action} - ${actionResult.summary || ''}`);
        return streamGeminiResponse(confirmPrompt, confirmContent, 'lite');
      }

      // Action failed — fall through to chat
    }

    // ── CHAT / HELP ───────────────────────────────────────────────
    // Phase 4 follow-up: resolve which prompt system to use (legacy vs
    // modular). Decision is driven by env flag + userId-hashed rollout,
    // so a single user sees a STABLE path across requests — A/B is clean.
    //
    // The classified intent or pre-filter type both flow into the
    // resolver. For help queries (pre-filter type='help' or classifier
    // contextual_ask with how-to signal), the resolver aliases to the
    // help_about_olive module and the FAQ ships as SLOT_INTENT_MODULE
    // only on help calls — no waste on non-help traffic.
    const intentForResolver =
      effectiveType === 'help'
        ? 'help'
        : (classifiedIntent?.intent || effectiveType || 'chat');

    // Phase D-1 live integration: when PROMPT_EVOLUTION_ROUTER_ENABLED
    // is set, the async resolver consults `olive_prompt_addendums` for an
    // approved/testing addendum on the resolved intent and folds it in.
    // When the flag is unset (default), `resolvePromptAsync` is byte-
    // identical to the synchronous `resolvePrompt` — verified by the
    // resolver.test.ts pinned tests. So this swap is risk-free.
    const resolved = await resolvePromptAsync({
      intent: intentForResolver,
      userId: user_id,
      legacyPrompt: OLIVE_CHAT_PROMPT,
      legacyVersion: CHAT_PROMPT_VERSION,
      supabase: getServiceSupabase(),
    });

    const serverCtx = await serverCtxPromise;
    const budgetResult = formatContextWithBudget(serverCtx, {
      // Modular path passes system_core + intent_rules through the
      // Context Contract's named slots so budgets apply uniformly.
      // Legacy path keeps them empty — the full legacy prompt goes via
      // `systemInstruction` to Gemini directly, preserving current behavior.
      soulPrompt: resolved.source === 'modular' ? resolved.systemInstruction : undefined,
      intentModule: resolved.source === 'modular' ? resolved.intentRules : undefined,
      userMessage: message,
      userName: context?.user_name,
      conversationHistory,
      savedItemsContext: context?.saved_items_context,
    });

    // Log slot-level token usage for analytics (to console + olive_llm_calls)
    if (budgetResult.truncatedSlots.length > 0 || budgetResult.droppedSlots.length > 0 || budgetResult.missingRequired.length > 0) {
      console.log(
        `[ask-olive-stream] Context budget: ${budgetResult.totalTokens} tokens, ` +
        `truncated: [${budgetResult.truncatedSlots}], dropped: [${budgetResult.droppedSlots}], ` +
        `missingRequired: [${budgetResult.missingRequired}], degraded: ${budgetResult.degraded}, ` +
        `emergency: ${budgetResult.emergency}, prompt_system: ${resolved.source}`
      );
    }

    // Emit slot-level analytics to olive_llm_calls (fire-and-forget)
    const chatStartedAt = performance.now();
    const chatSupabase = getServiceSupabase();
    const chatTracker = createLLMTracker(chatSupabase, "ask-olive-stream", user_id);
    const chatModel = getModel(route.responseTier as any);

    // On the modular path, `systemInstruction` is the small system_core
    // and `intent_rules` already rides in SLOT_INTENT_MODULE of budgetResult.
    // On legacy, systemInstruction carries the full monolithic prompt.
    const streamSystemPrompt = resolved.source === 'modular'
      ? resolved.systemInstruction
      : OLIVE_CHAT_PROMPT;

    scheduleMemoryEvolution(user_id, message, '(chat response)');
    const resp = await streamGeminiResponse(streamSystemPrompt, budgetResult.prompt, route.responseTier);

    // Log context-assembly analytics now that stream has started
    chatTracker.logStreamingCall(
      chatModel,
      streamSystemPrompt.length + budgetResult.prompt.length,
      Math.round(performance.now() - chatStartedAt),
      {
        promptVersion: resolved.version,
        slotTokens: getSlotTokenLog(budgetResult),
        contextTotalTokens: budgetResult.totalTokens,
        slotsOverBudget: budgetResult.truncatedSlots,
        metadata: {
          intent: 'chat',
          effective_type: effectiveType,
          classified_intent: classifiedIntent?.intent,
          classifier_confidence: classifiedIntent?.confidence,
          route_tier: route.responseTier,
          route_reason: route.reason,
          dropped_slots: budgetResult.droppedSlots,
          missing_required: budgetResult.missingRequired,
          degraded: budgetResult.degraded,
          emergency: budgetResult.emergency,
          // Phase 4 follow-up: A/B key. Analytics group by this.
          prompt_system: resolved.source,
          resolved_intent: resolved.resolvedIntent,
        },
      }
    );

    return resp;

  } catch (error: any) {
    console.error('[ask-olive-stream] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

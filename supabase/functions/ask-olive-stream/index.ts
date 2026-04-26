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
import { resolvePrompt } from "../_shared/prompts/intents/resolver.ts";
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

    const { error } = await supabase
      .from('clerk_notes')
      .delete()
      .eq('id', tasks[0].id);

    if (error) return null;
    return { action: 'task_deleted', id: tasks[0].id, summary: tasks[0].summary };
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

    const parsed = parseNaturalDate(dateExpr, { timezone: userTimezone });
    if (!parsed) return null;

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
    if (parsed.hasTime) {
      updateFields.reminder_time = parsed.iso;
      updateFields.due_date = parsed.iso.split('T')[0];
    } else {
      updateFields.due_date = parsed.iso.split('T')[0];
    }

    const { error } = await supabase
      .from('clerk_notes')
      .update(updateFields)
      .eq('id', tasks[0].id);

    if (error) return null;
    return { action: 'due_date_set', id: tasks[0].id, summary: tasks[0].summary, due_date: updateFields.due_date, reminder_time: updateFields.reminder_time };
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
        });

        if (result.intent) {
          classifiedIntent = result.intent;
          console.log(`[ask-olive-stream] AI classified: ${classifiedIntent.intent} (conf: ${classifiedIntent.confidence})`);

          // Map classified intent to effective type
          const actionIntents = ['create', 'complete', 'delete', 'set_priority', 'set_due', 'remind', 'move', 'assign', 'expense', 'create_list'];
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

      const actionResult = await handleAction(supabase, user_id, scopeSpaceId, message, classifiedIntent);

      if (actionResult) {
        const confirmPrompt = `You are Olive. You just performed an action for the user. Confirm what you did warmly and briefly. Include the specific details. ${OLIVE_CHAT_PROMPT}`;
        const confirmContent = `ACTION PERFORMED:\n${JSON.stringify(actionResult)}\n\nUser's original request: ${message}\n\n${context?.user_name ? `User's name: ${context.user_name}` : ''}\n\nConfirm what you did in 1-2 sentences. Be specific about what was created/completed.`;
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

    const resolved = resolvePrompt({
      intent: intentForResolver,
      userId: user_id,
      legacyPrompt: OLIVE_CHAT_PROMPT,
      legacyVersion: CHAT_PROMPT_VERSION,
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

/**
 * ASK-OLIVE-STREAM Edge Function — Multi-Agent Router
 * ============================================================================
 * World-class streaming chat for the Olive web app.
 *
 * Architecture:
 *   1. Lightweight intent classification (lite model, <200ms)
 *   2. Route to the right agent:
 *      - WEB_SEARCH → Perplexity API → Gemini formatting stream
 *      - CONTEXTUAL_ASK → Fetch relevant saved data → Gemini answer stream
 *      - CHAT (assistant/general/briefing/etc.) → Rich context → Gemini stream
 *   3. All routes use model-router for cost-optimized tier selection
 *   4. Server-side context: memories, profile, patterns, calendar, agent insights
 *   5. Conversation history for multi-turn awareness
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GEMINI_KEY, getModel } from "../_shared/gemini.ts";
import { routeIntent } from "../_shared/model-router.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ============================================================================
// SYSTEM PROMPTS
// ============================================================================

const OLIVE_CHAT_PROMPT = `You are Olive, a world-class AI personal assistant. You are the user's trusted, intelligent companion — like a brilliant friend who knows their life, their preferences, their tasks, and their world.

## CORE PHILOSOPHY — PRODUCE, DON'T JUST DESCRIBE:
When the user asks for help, DELIVER results immediately. Don't describe what you could do — DO IT.
- Asked to draft an email? → Write the full email (Subject, Body, Sign-off)
- Asked to plan a trip? → Produce a structured itinerary with steps
- Asked for ideas? → Give specific, personalized suggestions
- Asked for advice? → Give your honest, well-reasoned recommendation
- Asked a question about their data? → Reference their actual tasks, lists, and memories

## HELP & HOW-TO — OLIVE FEATURE GUIDE:
When the user asks HOW to use Olive features (e.g., "how do I invite a partner?"), provide accurate step-by-step answers:

**Creating notes/tasks**: Tap + on home screen, type anything. On WhatsApp, just send a message. Olive AI auto-categorizes, sets dates, splits multi-item lists. Voice notes supported.
**Due dates/reminders**: Open note → tap date chip or bell icon. Or include naturally: "Call dentist tomorrow 3pm".
**Complete/delete**: Swipe right (complete) or left (delete). Or open task → tap Complete/Delete.
**Multiple tasks**: Brain dumps work — "Buy milk, call dentist, book flights" → auto-split.
**Lists**: Lists tab → + button. WhatsApp: "create a list called [name]". Tasks auto-route by content.
**Invite partner**: Settings → My Profile & Household → Partner Connection → Invite Partner. Share link.
**Shared vs private**: Default follows privacy setting (Settings → Default Privacy). Toggle per-note with lock icon.
**Connect WhatsApp**: Settings → Integrations → WhatsApp.
**Connect Google Calendar**: Settings → Integrations → Google Services → Connect Google Calendar.
**Expenses**: WhatsApp: "$45 lunch". App: Expenses tab. Photo receipts auto-extracted.
**Background Agents**: Settings → Olive's Intelligence → Automation Hub.
**Memories**: Settings → Olive's Intelligence → Memories. Add personal facts for better AI.

## PERSONALITY:
- Warm, intelligent, direct — like texting a smart friend who has your back
- Match the depth and tone of their message
- Use their name, reference their specific tasks and memories
- Use emojis naturally but sparingly 🫒
- Minimal preamble — go straight to the content

## CAPABILITIES:
- Help draft emails, messages, letters, posts, and any written content
- Plan trips, events, projects, meals, and schedules
- Brainstorm ideas personalized to their life and preferences
- Analyze options, compare choices, give strategic advice
- Answer questions about their saved tasks, lists, and data
- Search the web for external information when needed
- Reference memories, partner info, calendar events, and behavioral patterns

## FORMATTING:
- Use **bold** for emphasis, bullet points for lists, numbered lists for steps
- For emails: format with **Subject:** / greeting / body / sign-off
- For plans: use clear headings and numbered steps
- Keep responses focused — don't pad with unnecessary text

## CRITICAL RULES:
1. When user context is provided, ALWAYS mine it for relevant details
2. Track conversation history for continuity — never repeat or ask what's already answered
3. If the user asks for something creative or compositional, produce the FULL output
4. Be proactively helpful — if you notice something relevant in their data, mention it
5. After producing substantial content, end with a brief note like "Want me to save this to your notes?"
6. End long outputs with a brief offer to refine or iterate`;

const CONTEXTUAL_ASK_PROMPT = `You are Olive, a friendly and intelligent AI assistant. The user is asking a question about their saved items, calendar, or personal data.

CRITICAL INSTRUCTIONS:
1. Answer based on the user's ACTUAL saved data provided below — including "Full details" for rich info like addresses, times, references, ingredients.
2. Be SPECIFIC and PRECISE — extract the EXACT answer from details.
3. If you find a relevant item, extract the answer from its full details.
4. If they ask for recommendations, suggest items from their saved lists.
5. If you can't find what they're looking for, say so clearly.
6. Be concise but include all key details the user asked for.
7. Use emojis sparingly for warmth 🫒
8. When mentioning dates, include day of week and time if available.
9. When the user uses pronouns, refer to conversation history.
10. Check CALENDAR EVENTS for timing/scheduling questions.`;

const WEB_SEARCH_FORMAT_PROMPT = `You are Olive, a friendly AI assistant. The user asked a question that required a web search. Answer their SPECIFIC question directly using the search results below. Be warm but concise. Only include details that answer the question. Include relevant links.`;

// ============================================================================
// LIGHTWEIGHT INTENT DETECTION (no Gemini call — regex + heuristics)
// ============================================================================

interface DetectedIntent {
  type: 'chat' | 'contextual_ask' | 'web_search' | 'assistant' | 'help';
  chatType?: string;
  confidence: number;
}

function detectIntent(message: string, conversationHistory: Array<{ role: string; content: string }>): DetectedIntent {
  const lower = message.toLowerCase().trim();

  // Help questions about Olive features
  if (/\b(how\s+(?:do\s+i|can\s+i|to)\s+(?:use|connect|invite|create|add|delete|remove|share|export|change|set|enable|disable|link|track|save|send|assign|complete|view|see|find|manage|configure|setup))\b/i.test(lower) ||
      /\b(come\s+(?:faccio|posso|si\s+fa)\s+(?:a|per)\s+)/i.test(lower) ||
      /\b(como\s+(?:hago|puedo|se\s+hace)\s+(?:para\s+)?)/i.test(lower)) {
    return { type: 'help', confidence: 0.9 };
  }

  // Web search signals — user wants external info OR general knowledge
  if ((/\b(search|google|look\s*up|find\s+(?:me|us)?\s*(?:a|the|some)?|best\s+(?:restaurants?|hotels?|places?|things?|cities|towns|activities|spots?|bars?|cafes?|shops?|neighborhoods?|beaches?|parks?|museums?|attractions?|destinations?)|top\s+\d+|recommend\s+(?:a|some|me)|what\s+(?:are|is)\s+the\s+(?:best|top|most|greatest|popular|famous|nicest)|where\s+(?:can|should)\s+(?:I|we)\s+(?:go|visit|eat|stay|travel)|reviews?\s+(?:for|of)|directions?\s+to|near\s+(?:me|us|here)|what's\s+(?:the\s+)?(?:weather|news|price|cost|time\s+(?:in|at))|what\s+(?:should|can|do)\s+(?:i|we)\s+(?:do|see|visit|try|eat|cook|watch|read|buy)\s+(?:in|at|near|around|for)|good\s+(?:places?|things?|restaurants?|cities|spots?|ideas?|activities)\s+(?:in|at|near|around|for|to))\b/i.test(lower) ||
      // General knowledge "what are" / "how much" patterns
      /\b(what\s+(?:are|is)\s+(?:the\s+)?(?:best|top|main|biggest|famous|popular|capital|most)|how\s+(?:much|many|far|long)\s+(?:does|do|is|are)\b)/i.test(lower)) &&
      !/\b(my\s+(?:tasks?|notes?|lists?|items?|saved|data))\b/i.test(lower)) {
    return { type: 'web_search', confidence: 0.85 };
  }

  // Contextual ask — questions about user's saved data
  if (/\b(my\s+(?:tasks?|notes?|lists?|items?|groceries?|shopping|travel|appointments?)|what\s+(?:do\s+)?i\s+have|show\s+(?:me\s+)?my|when\s+(?:is|are)\s+(?:my|the)|where\s+(?:is|are)\s+(?:my|the)|did\s+i\s+(?:save|add|create)|any\s+(?:tasks?|notes?|reminders?))\b/i.test(lower)) {
    return { type: 'contextual_ask', confidence: 0.85 };
  }

  // Pronoun follow-ups referencing data ("what about it", "when is it")
  if (conversationHistory.length > 0 && /^(what|when|where|how|which|who|is\s+it|is\s+that|and\s+the|what\s+about)\b/i.test(lower) && lower.length < 60) {
    // Check if last exchange was contextual
    const lastAssistant = [...conversationHistory].reverse().find(m => m.role === 'assistant');
    if (lastAssistant?.content && /\b(task|note|list|item|saved|due|reminder|calendar)\b/i.test(lastAssistant.content)) {
      return { type: 'contextual_ask', confidence: 0.75 };
    }
  }

  // Assistant signals — user wants Olive to produce content
  if (/\b(help\s+me\s+(?:draft|write|compose|plan|brainstorm|think|figure|organize|prepare|create\s+a\s+(?:plan|list|email|message|letter))|draft\s+(?:a|an|the)|write\s+(?:a|an|the)|compose\s+(?:a|an)|can\s+you\s+(?:help|draft|write|plan|brainstorm|prepare|create)|what\s+(?:do\s+you\s+think|would\s+you\s+(?:suggest|recommend))|compare|pros?\s+and\s+cons?|should\s+i|advice\s+(?:on|about|for)|opinion\s+(?:on|about)|prepare\s+(?:a|an|the))\b/i.test(lower) ||
      /\b(aiutami\s+a|puoi\s+(?:aiutarmi|prepararmi|scrivermi)|preparami|scrivimi|bozza|redigi)\b/i.test(lower) ||
      /\b(ayudame\s+a|puedes\s+(?:ayudarme|prepararme|escribirme)|preparame|escribeme|borrador)\b/i.test(lower) ||
      lower.length > 120) {
    // Long messages are likely assistant requests
    if (lower.length > 120 && /[?]/.test(lower)) {
      return { type: 'assistant', chatType: 'assistant', confidence: 0.8 };
    }
    if (/\b(draft|write|compose|plan|brainstorm|help\s+me|prepare|bozza|aiutami|ayudame)\b/i.test(lower)) {
      return { type: 'assistant', chatType: 'assistant', confidence: 0.9 };
    }
  }

  // Default: general chat
  return { type: 'chat', chatType: 'general', confidence: 0.6 };
}

// ============================================================================
// SERVER-SIDE CONTEXT FETCHER
// ============================================================================

interface ServerContext {
  profile: string;
  memories: string;
  patterns: string;
  calendar: string;
  agentInsights: string;
  deepProfile: string;
  // For contextual_ask:
  savedItems: string;
}

async function fetchServerContext(
  userId: string,
  coupleId?: string,
  intentType?: string,
  userMessage?: string
): Promise<ServerContext> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  const empty: ServerContext = { profile: '', memories: '', patterns: '', calendar: '', agentInsights: '', deepProfile: '', savedItems: '' };
  if (!userId || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return empty;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const ctx = { ...empty };

  try {
    // Base fetches — always needed
    const baseFetches = [
      // Memories
      supabase
        .from('user_memories')
        .select('title, content, category, importance')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('importance', { ascending: false })
        .limit(15),
      // Profile
      supabase
        .from('clerk_profiles')
        .select('display_name, language_preference, timezone, note_style')
        .eq('id', userId)
        .maybeSingle(),
      // Patterns
      supabase
        .from('olive_patterns')
        .select('pattern_type, pattern_data, confidence')
        .eq('user_id', userId)
        .eq('is_active', true)
        .gte('confidence', 0.6)
        .limit(10),
      // Calendar events (14 days)
      supabase
        .from('calendar_events')
        .select('title, start_time, end_time, location')
        .gte('start_time', new Date().toISOString())
        .lte('start_time', new Date(Date.now() + 14 * 86400000).toISOString())
        .order('start_time', { ascending: true })
        .limit(15),
    ];

    // For contextual_ask, also fetch saved items with full details
    const needsSavedItems = intentType === 'contextual_ask';
    if (needsSavedItems) {
      baseFetches.push(
        supabase
          .from('clerk_notes')
          .select('id, summary, original_text, category, list_id, items, tags, priority, due_date, reminder_time, completed, created_at')
          .or(coupleId
            ? `couple_id.eq.${coupleId},and(author_id.eq.${userId},couple_id.is.null)`
            : `author_id.eq.${userId}`)
          .order('created_at', { ascending: false })
          .limit(200) as any
      );
      baseFetches.push(
        supabase
          .from('clerk_lists')
          .select('id, name, description')
          .or(coupleId
            ? `author_id.eq.${userId},couple_id.eq.${coupleId}`
            : `author_id.eq.${userId}`) as any
      );
    }

    const results = await Promise.all(baseFetches);
    const [memoriesRes, profileRes, patternsRes, calendarRes] = results;

    // Profile
    if (profileRes.data) {
      const p = profileRes.data;
      ctx.profile = `USER PROFILE: Name: ${p.display_name || 'Unknown'}, Language: ${p.language_preference || 'en'}, Timezone: ${p.timezone || 'UTC'}, Note style: ${p.note_style || 'auto'}`;
    }

    // Memories
    if (memoriesRes.data?.length) {
      ctx.memories = `\nUSER MEMORIES & PREFERENCES:\n${memoriesRes.data.map((m: any) => `- [${m.category}] ${m.title}: ${m.content}`).join('\n')}`;
    }

    // Patterns
    if (patternsRes.data?.length) {
      ctx.patterns = `\nBEHAVIORAL PATTERNS:\n${patternsRes.data.map((p: any) =>
        `- ${p.pattern_type}: ${JSON.stringify(p.pattern_data)} (${(p.confidence * 100).toFixed(0)}%)`
      ).join('\n')}`;
    }

    // Calendar
    if (calendarRes.data?.length) {
      ctx.calendar = `\nUPCOMING CALENDAR:\n${calendarRes.data.slice(0, 10).map((e: any) => {
        const d = new Date(e.start_time);
        const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        return `- ${date} ${time}: ${e.title}${e.location ? ` @ ${e.location}` : ''}`;
      }).join('\n')}`;
    }

    // Saved items for contextual_ask
    if (needsSavedItems && results.length >= 6) {
      const notesRes = results[4];
      const listsRes = results[5];
      const allTasks = notesRes.data || [];
      const lists = listsRes.data || [];
      const listIdToName = new Map(lists.map((l: any) => [l.id, l.name]));

      // Score by relevance to the question
      const questionLower = (userMessage || '').toLowerCase();
      const questionWords = questionLower.split(/\s+/).filter((w: string) => w.length > 2);

      const scoredTasks = allTasks.map((task: any) => {
        const combined = `${task.summary.toLowerCase()} ${(task.original_text || '').toLowerCase()}`;
        let score = 0;
        questionWords.forEach((w: string) => {
          if (combined.includes(w)) score += 1;
          if (task.summary.toLowerCase().includes(w)) score += 1;
        });
        return { ...task, relevanceScore: score };
      });

      const relevant = scoredTasks.filter((t: any) => t.relevanceScore >= 2).sort((a: any, b: any) => b.relevanceScore - a.relevanceScore);
      const others = scoredTasks.filter((t: any) => t.relevanceScore < 2);

      let savedItemsCtx = '';
      if (relevant.length > 0) {
        savedItemsCtx += '\n## MOST RELEVANT SAVED ITEMS (full details):\n';
        relevant.slice(0, 10).forEach((task: any) => {
          const listName = task.list_id && listIdToName.has(task.list_id) ? listIdToName.get(task.list_id) : task.category;
          const status = task.completed ? '✓' : '○';
          const dueInfo = task.due_date ? ` | Due: ${task.due_date}` : '';
          const reminderInfo = task.reminder_time ? ` | Reminder: ${task.reminder_time}` : '';
          savedItemsCtx += `\n📌 ${status} "${task.summary}" [${listName}]${dueInfo}${reminderInfo}\n`;
          if (task.original_text && task.original_text !== task.summary) {
            savedItemsCtx += `   Full details: ${task.original_text.substring(0, 800)}\n`;
          }
          if (task.items?.length > 0) {
            task.items.forEach((item: string) => { savedItemsCtx += `   • ${item}\n`; });
          }
        });
      }

      // Summary of all other items grouped by list
      savedItemsCtx += '\n## ALL LISTS AND SAVED ITEMS:\n';
      const tasksByList = new Map<string, any[]>();
      const uncategorized: any[] = [];
      others.forEach((task: any) => {
        if (task.list_id && listIdToName.has(task.list_id)) {
          const ln = listIdToName.get(task.list_id)!;
          if (!tasksByList.has(ln)) tasksByList.set(ln, []);
          tasksByList.get(ln)!.push(task);
        } else {
          uncategorized.push(task);
        }
      });
      tasksByList.forEach((tasks, listName) => {
        savedItemsCtx += `\n### ${listName}:\n`;
        tasks.slice(0, 15).forEach((task: any) => {
          const status = task.completed ? '✓' : '○';
          const priority = task.priority === 'high' ? ' 🔥' : '';
          savedItemsCtx += `- ${status} ${task.summary}${priority}\n`;
        });
        if (tasks.length > 15) savedItemsCtx += `  ...and ${tasks.length - 15} more\n`;
      });
      if (uncategorized.length > 0) {
        savedItemsCtx += `\n### Other Items:\n`;
        uncategorized.slice(0, 10).forEach((task: any) => {
          savedItemsCtx += `- ${task.completed ? '✓' : '○'} ${task.summary}\n`;
        });
      }
      ctx.savedItems = savedItemsCtx;
    }

    // Deep profile (memory file)
    try {
      const { data: memoryFile } = await supabase
        .from('olive_memory_files')
        .select('content')
        .eq('user_id', userId)
        .eq('file_type', 'profile')
        .maybeSingle();
      if (memoryFile?.content) {
        ctx.deepProfile = `\nDEEP PROFILE:\n${memoryFile.content.slice(0, 800)}`;
      }
    } catch { /* non-critical */ }

    // Agent insights (non-critical)
    try {
      const { data: agentRuns } = await supabase
        .from('olive_agent_runs')
        .select('agent_id, result, completed_at')
        .eq('user_id', userId)
        .eq('status', 'completed')
        .gte('completed_at', new Date(Date.now() - 48 * 3600000).toISOString())
        .order('completed_at', { ascending: false })
        .limit(5);
      if (agentRuns?.length) {
        ctx.agentInsights = `\nRECENT AGENT INSIGHTS:\n${agentRuns.map((r: any) =>
          `- [${r.agent_id}]: ${typeof r.result === 'string' ? r.result.substring(0, 200) : JSON.stringify(r.result).substring(0, 200)}`
        ).join('\n')}`;
      }
    } catch { /* non-critical */ }

  } catch (err) {
    console.error('[ask-olive-stream] Context fetch error:', err);
  }

  return ctx;
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

  // Resolve pronouns from conversation history
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
// STREAMING RESPONSE GENERATOR
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
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, context, user_id, couple_id } = await req.json();

    if (!GEMINI_KEY) throw new Error('GEMINI_API key not configured');
    if (!message?.trim()) throw new Error('Empty message');

    // ── Step 1: Detect intent ────────────────────────────────────
    const conversationHistory: Array<{ role: string; content: string }> =
      context?.conversation_history || [];

    const detected = detectIntent(message, conversationHistory);
    console.log(`[ask-olive-stream] Intent: ${detected.type} (confidence: ${detected.confidence})`);

    // ── Step 2: Route to model tier ──────────────────────────────
    const intentMap: Record<string, string> = {
      'web_search': 'web_search',
      'contextual_ask': 'contextual_ask',
      'assistant': 'chat',
      'chat': 'chat',
      'help': 'chat',
    };
    const chatTypeMap: Record<string, string> = {
      'assistant': 'planning',
      'help': 'general',
    };
    const route = routeIntent(
      intentMap[detected.type] || 'chat',
      detected.chatType || chatTypeMap[detected.type] || 'general'
    );
    console.log(`[ask-olive-stream] Route: tier=${route.responseTier}, reason=${route.reason}`);

    // ── Step 3: Fetch context (parallel with intent-specific work) ─
    const serverCtxPromise = fetchServerContext(user_id, couple_id, detected.type, message);

    // ── Step 4: Intent-specific handling ──────────────────────────

    // ── WEB SEARCH ────────────────────────────────────────────────
    if (detected.type === 'web_search') {
      const [serverCtx, searchResult] = await Promise.all([
        serverCtxPromise,
        performWebSearch(message, conversationHistory),
      ]);

      if (!searchResult.content) {
        // Fallback: just answer with Gemini
        const fullContext = buildFullContext(serverCtx, context, message, conversationHistory);
        return streamGeminiResponse(OLIVE_CHAT_PROMPT, fullContext, route.responseTier);
      }

      // Stream Gemini formatting of the search results + personal context
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

USER'S QUESTION: ${message}

WEB SEARCH RESULTS:
${searchResult.content}
${citationsList}

${context?.user_name ? `User's name: ${context.user_name}` : ''}

Answer comprehensively using web knowledge, then naturally connect to any relevant personal context.`;

      const historyCtx = conversationHistory.length > 0
        ? '\n\nCONVERSATION HISTORY:\n' + conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')
        : '';

      return streamGeminiResponse(searchContext, searchContext + historyCtx, 'standard');
    }

    // ── CONTEXTUAL ASK ────────────────────────────────────────────
    if (detected.type === 'contextual_ask') {
      const serverCtx = await serverCtxPromise;

      // Check if this is also a general knowledge question that needs web augmentation
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
${serverCtx.savedItems}
${serverCtx.calendar}
${serverCtx.memories}
${serverCtx.deepProfile}
${serverCtx.agentInsights}

${conversationHistory.length > 0
  ? '\n## RECENT CONVERSATION:\n' + conversationHistory.map(m => `${m.role === 'user' ? 'User' : 'Olive'}: ${m.content}`).join('\n')
  : ''}

${context?.user_name ? `User's name: ${context.user_name}` : ''}

USER'S QUESTION: ${message}

${isHybrid ? 'Answer comprehensively using web knowledge, then naturally connect to personal context.' : 'Respond with helpful, specific information extracted from their saved data.'}`;

      return streamGeminiResponse(hybridPrompt, ctxAskContent, isHybrid ? 'standard' : route.responseTier);
    }

    // ── CHAT / ASSISTANT / HELP ───────────────────────────────────
    const serverCtx = await serverCtxPromise;
    const fullContext = buildFullContext(serverCtx, context, message, conversationHistory);
    return streamGeminiResponse(OLIVE_CHAT_PROMPT, fullContext, route.responseTier);

  } catch (error: any) {
    console.error('[ask-olive-stream] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ============================================================================
// CONTEXT BUILDER
// ============================================================================

function buildFullContext(
  serverCtx: ServerContext,
  frontendCtx: any,
  message: string,
  conversationHistory: Array<{ role: string; content: string }>
): string {
  const parts: string[] = [];

  // Server-side context
  if (serverCtx.profile) parts.push(serverCtx.profile);
  if (serverCtx.memories) parts.push(serverCtx.memories);
  if (serverCtx.patterns) parts.push(serverCtx.patterns);
  if (serverCtx.calendar) parts.push(serverCtx.calendar);
  if (serverCtx.deepProfile) parts.push(serverCtx.deepProfile);
  if (serverCtx.agentInsights) parts.push(serverCtx.agentInsights);

  // Frontend-provided saved items context
  if (frontendCtx?.saved_items_context) {
    parts.push(`\nUSER'S SAVED DATA:\n${frontendCtx.saved_items_context}`);
  }

  // User name
  if (frontendCtx?.user_name) {
    parts.push(`\nUser's name: ${frontendCtx.user_name}`);
  }

  // Conversation history
  if (conversationHistory.length > 0) {
    parts.push('\nCONVERSATION HISTORY:\n' +
      conversationHistory.map(m => `${m.role === 'user' ? 'User' : 'Olive'}: ${m.content}`).join('\n')
    );
  }

  parts.push(`\nUSER MESSAGE: ${message}`);

  return parts.join('\n');
}

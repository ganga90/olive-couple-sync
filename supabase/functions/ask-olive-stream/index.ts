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
import { createLLMTracker } from "../_shared/llm-tracker.ts";
import {
  OLIVE_CHAT_PROMPT as CHAT_PROMPT_IMPORTED,
  CHAT_PROMPT_VERSION,
  CONTEXTUAL_ASK_PROMPT as CTX_ASK_PROMPT_IMPORTED,
  CONTEXTUAL_ASK_PROMPT_VERSION,
  WEB_SEARCH_FORMAT_PROMPT as WEB_SEARCH_PROMPT_IMPORTED,
  WEB_SEARCH_FORMAT_PROMPT_VERSION,
} from "../_shared/prompts/ask-olive-prompts.ts";
import {
  assembleFullContext,
  formatContextForPrompt,
  cleanupStaleSessions,
  type UnifiedContext,
} from "../_shared/orchestrator.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ============================================================================
// SYSTEM PROMPTS — imported from _shared/prompts/ (versioned)
// ============================================================================

// Re-export under original names for backward compatibility
const OLIVE_CHAT_PROMPT = CHAT_PROMPT_IMPORTED;
const CONTEXTUAL_ASK_PROMPT = CTX_ASK_PROMPT_IMPORTED;
const WEB_SEARCH_FORMAT_PROMPT = WEB_SEARCH_PROMPT_IMPORTED;

// Legacy inline prompt kept as reference (now lives in _shared/prompts/ask-olive-prompts.ts)
const _LEGACY_OLIVE_CHAT_PROMPT = `You are Olive, a world-class AI personal assistant. You are the user's trusted, intelligent companion — like a brilliant friend who knows their life, their preferences, their tasks, and their world.

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
// End of legacy reference block — active prompts are imported from _shared/prompts/

// ============================================================================
// LIGHTWEIGHT INTENT DETECTION (no Gemini call — regex + heuristics)
// ============================================================================

interface DetectedIntent {
  type: 'chat' | 'contextual_ask' | 'web_search' | 'assistant' | 'help' | 'action';
  chatType?: string;
  confidence: number;
}

function detectIntent(message: string, conversationHistory: Array<{ role: string; content: string }>): DetectedIntent {
  const lower = message.toLowerCase().trim();

  // Action signals — user wants to DO something (create task, complete task, set reminder)
  if (/\b(add|create|make)\s+(?:a\s+)?(?:task|note|reminder|item|to[- ]?do)\b/i.test(lower) ||
      /\b(?:add|put)\s+["'].+["']\s+(?:to|on|in)\s+(?:my|the)\b/i.test(lower) ||
      /\b(mark|complete|finish|done|check\s+off)\s+(?:the\s+)?["']?.+["']?\s+(?:as\s+)?(?:done|complete|finished)?\b/i.test(lower) ||
      /\b(remind\s+me|set\s+(?:a\s+)?reminder)\b/i.test(lower) ||
      /\b(?:add|save)\s+.+\s+(?:to|on)\s+(?:my|the)\s+(?:list|grocery|shopping|to[- ]?do)\b/i.test(lower)) {
    return { type: 'action', confidence: 0.85 };
  }

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
  // Phase 4: Semantic context
  semanticNotes: string;
  semanticMemoryChunks: string;
  relationshipGraph: string;
  // For contextual_ask:
  savedItems: string;
}

/**
 * Generate embedding for semantic search (Phase 4).
 * Uses Gemini embedding API with 768 dimensions.
 */
async function generateQueryEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          outputDimensionality: 768,
        }),
      }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data.embedding?.values || null;
  } catch {
    return null;
  }
}

async function fetchServerContext(
  userId: string,
  coupleId?: string,
  intentType?: string,
  userMessage?: string
): Promise<ServerContext> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  const empty: ServerContext = { profile: '', memories: '', patterns: '', calendar: '', agentInsights: '', deepProfile: '', savedItems: '', semanticNotes: '', semanticMemoryChunks: '', relationshipGraph: '' };
  if (!userId || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return empty;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const ctx = { ...empty };

  try {
    // Phase 4: Generate query embedding in parallel with base fetches
    const embeddingPromise = userMessage ? generateQueryEmbedding(userMessage) : Promise.resolve(null);

    // Base fetches — always needed
    // Profile fetch (maybeSingle → returns object, not array) — separate to avoid union type issues
    const profilePromise = supabase
      .from('clerk_profiles')
      .select('display_name, language_preference, timezone, note_style')
      .eq('id', userId)
      .maybeSingle();

    // Array-based fetches (all return { data: T[] })
    const arrayFetches: Promise<{ data: any[] | null; error: any }>[] = [
      // [0] Memories
      supabase
        .from('user_memories')
        .select('title, content, category, importance')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('importance', { ascending: false })
        .limit(15) as any,
      // [1] Patterns
      supabase
        .from('olive_patterns')
        .select('pattern_type, pattern_data, confidence')
        .eq('user_id', userId)
        .eq('is_active', true)
        .gte('confidence', 0.6)
        .limit(10) as any,
      // [2] Calendar events (14 days) — scoped to user's connections for data isolation
      (async () => {
        const { data: connections } = await supabase
          .from('calendar_connections')
          .select('id')
          .eq('user_id', userId)
          .eq('is_active', true);

        if (!connections?.length) return { data: [], error: null };

        const connectionIds = connections.map((c: any) => c.id);
        return supabase
          .from('calendar_events')
          .select('title, start_time, end_time, location')
          .in('connection_id', connectionIds)
          .gte('start_time', new Date().toISOString())
          .lte('start_time', new Date(Date.now() + 14 * 86400000).toISOString())
          .order('start_time', { ascending: true })
          .limit(15);
      })() as any,
    ];

    // For contextual_ask, also fetch saved items with full details
    const needsSavedItems = intentType === 'contextual_ask';
    if (needsSavedItems) {
      arrayFetches.push(
        supabase
          .from('clerk_notes')
          .select('id, summary, original_text, category, list_id, items, tags, priority, due_date, reminder_time, completed, created_at')
          .or(coupleId
            ? `couple_id.eq.${coupleId},and(author_id.eq.${userId},couple_id.is.null)`
            : `author_id.eq.${userId}`)
          .order('created_at', { ascending: false })
          .limit(200) as any
      );
      arrayFetches.push(
        supabase
          .from('clerk_lists')
          .select('id, name, description')
          .or(coupleId
            ? `author_id.eq.${userId},couple_id.eq.${coupleId}`
            : `author_id.eq.${userId}`) as any
      );
    }

    const [arrayResults, profileRes, queryEmbedding] = await Promise.all([
      Promise.all(arrayFetches),
      profilePromise,
      embeddingPromise,
    ]);

    const [memoriesRes, patternsRes, calendarRes] = arrayResults;

    // Profile (single object, not array)
    if (profileRes.data) {
      const p = profileRes.data as any;
      ctx.profile = `USER PROFILE: Name: ${p.display_name || 'Unknown'}, Language: ${p.language_preference || 'en'}, Timezone: ${p.timezone || 'UTC'}, Note style: ${p.note_style || 'auto'}`;
    }

    // Memories
    if (memoriesRes?.data?.length) {
      ctx.memories = `\nUSER MEMORIES & PREFERENCES:\n${memoriesRes.data.map((m: any) => `- [${m.category}] ${m.title}: ${m.content}`).join('\n')}`;
    }

    // Patterns
    if (patternsRes?.data?.length) {
      ctx.patterns = `\nBEHAVIORAL PATTERNS:\n${patternsRes.data.map((p: any) =>
        `- ${p.pattern_type}: ${JSON.stringify(p.pattern_data)} (${(p.confidence * 100).toFixed(0)}%)`
      ).join('\n')}`;
    }

    // Calendar
    if (calendarRes?.data?.length) {
      ctx.calendar = `\nUPCOMING CALENDAR:\n${calendarRes.data.slice(0, 10).map((e: any) => {
        const d = new Date(e.start_time);
        const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        return `- ${date} ${time}: ${e.title}${e.location ? ` @ ${e.location}` : ''}`;
      }).join('\n')}`;
    }

    // ══════════════════════════════════════════════════════════════
    // PHASE 4: SEMANTIC CONTEXT INJECTION
    // ══════════════════════════════════════════════════════════════

    // 4a. Semantic note search — for contextual_ask, use hybrid search
    //     instead of brute-force keyword matching
    if (needsSavedItems && queryEmbedding && userMessage) {
      try {
        const { data: hybridResults } = await supabase.rpc('hybrid_search_notes', {
          p_user_id: userId,
          p_couple_id: coupleId || null,
          p_query: userMessage,
          p_query_embedding: JSON.stringify(queryEmbedding),
          p_vector_weight: 0.7,
          p_limit: 15,
        });

        if (hybridResults?.length) {
          ctx.semanticNotes = `\n## SEMANTICALLY RELEVANT NOTES (AI-ranked by relevance to your question):\n`;
          for (const note of hybridResults.slice(0, 10)) {
            const status = note.completed ? '✓' : '○';
            const dueInfo = note.due_date ? ` | Due: ${note.due_date}` : '';
            const cat = note.category ? ` [${note.category}]` : '';
            ctx.semanticNotes += `\n📌 ${status} "${note.summary}"${cat}${dueInfo} (relevance: ${(note.score * 100).toFixed(0)}%)\n`;
            if (note.original_text && note.original_text !== note.summary) {
              ctx.semanticNotes += `   Full details: ${note.original_text.substring(0, 600)}\n`;
            }
          }
          console.log(`[Phase4] Semantic note search returned ${hybridResults.length} results`);
        }
      } catch (e) {
        console.warn('[Phase4] Hybrid search failed (non-blocking):', e);
      }
    }

    // 4b. Memory chunk semantic search — find relevant learned facts
    if (queryEmbedding) {
      try {
        const { data: memChunks } = await supabase.rpc('search_memory_chunks', {
          p_user_id: userId,
          p_query_embedding: JSON.stringify(queryEmbedding),
          p_limit: 8,
          p_min_importance: 2,
        });

        if (memChunks?.length) {
          ctx.semanticMemoryChunks = `\n## RELEVANT LEARNED FACTS (from conversations & notes):\n${memChunks.map((c: any) =>
            `- ${c.content} (importance: ${c.importance}/5, source: ${c.source || 'auto'})`
          ).join('\n')}`;
          console.log(`[Phase4] Memory chunk search returned ${memChunks.length} results`);
        }
      } catch {
        // search_memory_chunks may not have data yet
      }
    }

    // 4c. Relationship graph — entity-aware context with subgraph traversal
    try {
      // First, find entities mentioned in the user's message
      const messageLower = (userMessage || '').toLowerCase();
      
      const { data: allEntities } = await supabase
        .from('olive_entities')
        .select('id, name, canonical_name, entity_type')
        .eq('user_id', userId);
      
      // Find entities referenced in the current message
      const mentionedEntityIds = new Set<string>();
      if (allEntities?.length) {
        for (const entity of allEntities) {
          if (messageLower.includes(entity.canonical_name) || 
              messageLower.includes(entity.name.toLowerCase())) {
            mentionedEntityIds.add(entity.id);
          }
        }
      }

      // Fetch relationships — prioritize those connected to mentioned entities
      let relationshipQuery = supabase
        .from('olive_relationships')
        .select(`
          relationship_type, confidence, confidence_score, rationale,
          source:olive_entities!source_entity_id(id, name, entity_type),
          target:olive_entities!target_entity_id(id, name, entity_type)
        `)
        .eq('user_id', userId)
        .gte('confidence_score', 0.4)
        .order('confidence_score', { ascending: false })
        .limit(30);

      const { data: relationships } = await relationshipQuery;

      if (relationships?.length) {
        // Separate into directly relevant (connected to mentioned entities) and general
        const relevant: string[] = [];
        const general: string[] = [];

        for (const r of relationships as any[]) {
          const src = r.source?.name || '?';
          const tgt = r.target?.name || '?';
          const srcId = r.source?.id;
          const tgtId = r.target?.id;
          const conf = r.confidence === 'AMBIGUOUS' ? ' ⚠️' : '';
          const line = `- ${src} → ${r.relationship_type} → ${tgt}${conf}`;
          
          if (mentionedEntityIds.has(srcId) || mentionedEntityIds.has(tgtId)) {
            relevant.push(line);
          } else {
            general.push(line);
          }
        }

        let graphCtx = '';
        if (relevant.length > 0) {
          graphCtx += `\n## RELEVANT CONNECTIONS (entities mentioned in this question):\n${relevant.join('\n')}`;
        }
        if (general.length > 0) {
          graphCtx += `\n## OTHER KNOWN RELATIONSHIPS:\n${general.slice(0, 15).join('\n')}`;
        }
        ctx.relationshipGraph = graphCtx;
      }

      // 4d. Community context — what life domains does this relate to?
      if (mentionedEntityIds.size > 0) {
        try {
          const { data: communities } = await supabase
            .from('olive_entity_communities')
            .select('label, entity_ids, cohesion, metadata')
            .eq('user_id', userId);

          if (communities?.length) {
            const relevantCommunities = communities.filter((c: any) =>
              c.entity_ids?.some((id: string) => mentionedEntityIds.has(id))
            );
            if (relevantCommunities.length > 0) {
              ctx.relationshipGraph = (ctx.relationshipGraph || '') + 
                `\n\n## LIFE DOMAINS (auto-detected clusters):\n${relevantCommunities.map((c: any) => 
                  `- ${c.label} (${c.metadata?.member_count || 0} entities, cohesion: ${c.cohesion})`
                ).join('\n')}`;
            }
          }
        } catch { /* communities table may be empty */ }
      }
    } catch { /* non-critical */ }

    // Saved items for contextual_ask (keep as fallback alongside semantic)
    if (needsSavedItems && arrayResults.length >= 5) {
      const notesRes = arrayResults[3];
      const listsRes = arrayResults[4];
      const allTasks = notesRes.data || [];
      const lists = listsRes.data || [];
      const listIdToName = new Map(lists.map((l: any) => [l.id, l.name]));

      // Score by relevance to the question (keyword fallback)
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

    // Deep profile + compiled knowledge (memory files)
    // Phase 4: Use full compiled content (up to 2KB per file) instead of truncated 600 chars
    try {
      const { data: memoryFiles } = await supabase
        .from('olive_memory_files')
        .select('file_type, content, updated_at')
        .eq('user_id', userId)
        .in('file_type', ['profile', 'patterns', 'relationship', 'household'])
        .order('updated_at', { ascending: false });

      if (memoryFiles?.length) {
        const parts: string[] = [];
        for (const mf of memoryFiles) {
          if (mf.content && mf.content.trim().length > 0) {
            const label = mf.file_type.toUpperCase();
            // Phase 4: Allow up to 2KB per file (was 600 chars)
            const maxLen = mf.file_type === 'profile' ? 2500 : 1500;
            const content = mf.content.length > maxLen
              ? mf.content.slice(0, maxLen) + '\n...(truncated)'
              : mf.content;
            parts.push(`[${label}]:\n${content}`);
          }
        }
        if (parts.length > 0) {
          ctx.deepProfile = `\n## COMPILED KNOWLEDGE (AI-synthesized from your history):\n${parts.join('\n\n')}`;
        }
      }
    } catch { /* non-critical */ }

    // Knowledge entities (if graph populated)
    try {
      const { data: entities } = await supabase
        .from('olive_entities')
        .select('name, entity_type, metadata, mention_count')
        .eq('user_id', userId)
        .order('mention_count', { ascending: false })
        .limit(25);

      if (entities?.length) {
        ctx.deepProfile = (ctx.deepProfile || '') + `\n\n## KEY PEOPLE, PLACES & THINGS:\n${entities.map((e: any) => {
          const meta = e.metadata ? Object.entries(e.metadata).filter(([k]) => k !== 'aliases').map(([k, v]) => `${k}: ${v}`).join(', ') : '';
          return `- ${e.name} (${e.entity_type}${meta ? ', ' + meta : ''}) — mentioned ${e.mention_count}x`;
        }).join('\n')}`;
      }
    } catch { /* olive_entities may not exist yet — non-critical */ }

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
// ACTION HANDLER (create/complete task, set reminder)
// ============================================================================

async function handleActionRequest(
  supabase: any,
  userId: string,
  coupleId: string | null,
  message: string,
  serverCtx: ServerContext,
  context: any
): Promise<Record<string, any> | null> {
  const lower = message.toLowerCase();

  // ── CREATE TASK ──
  if (/\b(add|create|make|put|save)\b/i.test(lower) && !/\b(mark|complete|finish|done|check\s*off)\b/i.test(lower)) {
    const extractKey = Deno.env.get("GEMINI_API") || Deno.env.get("GEMINI_API_KEY") || "";
    const extractResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${extractKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Extract task details from this message. Return JSON only.\nMessage: "${message}"\n\nReturn: {"summary": "task text", "category": "best category", "due_date": "ISO date or null", "priority": "high/medium/low", "list_name": "target list or null"}` }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 200, responseMimeType: "application/json" },
        }),
      }
    );

    if (!extractResponse.ok) return null;
    const extractData = await extractResponse.json();
    const text = extractData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    try {
      const task = JSON.parse(text);
      const { data: note, error } = await supabase
        .from('clerk_notes')
        .insert({
          author_id: userId,
          couple_id: coupleId || null,
          summary: task.summary,
          original_text: message,
          category: task.category || 'general',
          priority: task.priority || 'medium',
          due_date: task.due_date || null,
          completed: false,
        })
        .select('id, summary, category, due_date')
        .single();

      if (error) {
        console.error('[ask-olive-stream] Create task error:', error);
        return null;
      }

      return { action: 'task_created', ...note };
    } catch (e) {
      console.error('[ask-olive-stream] Parse action error:', e);
      return null;
    }
  }

  // ── COMPLETE TASK ──
  if (/\b(mark|complete|finish|done|check\s*off)\b/i.test(lower)) {
    const taskMatch = lower.match(/(?:mark|complete|finish|done|check\s*off)\s+(?:the\s+)?["']?(.+?)["']?\s*(?:as\s+(?:done|complete|finished))?$/i);
    const taskName = taskMatch?.[1]?.trim();
    if (!taskName) return null;

    const { data: tasks } = await supabase
      .from('clerk_notes')
      .select('id, summary')
      .eq('author_id', userId)
      .eq('completed', false)
      .ilike('summary', `%${taskName.substring(0, 30)}%`)
      .limit(1);

    if (!tasks || tasks.length === 0) return null;

    const { error } = await supabase
      .from('clerk_notes')
      .update({ completed: true, updated_at: new Date().toISOString() })
      .eq('id', tasks[0].id);

    if (error) return null;
    return { action: 'task_completed', id: tasks[0].id, summary: tasks[0].summary };
  }

  // ── SET REMINDER ──
  if (/\b(remind\s+me|set\s+(?:a\s+)?reminder)\b/i.test(lower)) {
    const extractKey = Deno.env.get("GEMINI_API") || Deno.env.get("GEMINI_API_KEY") || "";
    const extractResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${extractKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Extract reminder details from this message. Today is ${new Date().toISOString().split('T')[0]}. Return JSON only.\nMessage: "${message}"\n\nReturn: {"summary": "what to remember", "reminder_time": "ISO datetime", "due_date": "ISO date or null"}` }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 200, responseMimeType: "application/json" },
        }),
      }
    );

    if (!extractResponse.ok) return null;
    const extractData = await extractResponse.json();
    const text = extractData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    try {
      const reminder = JSON.parse(text);
      const { data: note, error } = await supabase
        .from('clerk_notes')
        .insert({
          author_id: userId,
          couple_id: coupleId || null,
          summary: reminder.summary,
          original_text: message,
          category: 'reminder',
          priority: 'medium',
          due_date: reminder.due_date || reminder.reminder_time || null,
          reminder_time: reminder.reminder_time || null,
          completed: false,
        })
        .select('id, summary, reminder_time, due_date')
        .single();

      if (error) return null;
      return { action: 'reminder_set', ...note };
    } catch {
      return null;
    }
  }

  return null; // Not recognized
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
      'action': 'chat',
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
${serverCtx.semanticNotes || serverCtx.savedItems}
${serverCtx.semanticMemoryChunks}
${serverCtx.calendar}
${serverCtx.memories}
${serverCtx.deepProfile}
${serverCtx.relationshipGraph}
${serverCtx.agentInsights}

${conversationHistory.length > 0
  ? '\n## RECENT CONVERSATION:\n' + conversationHistory.map(m => `${m.role === 'user' ? 'User' : 'Olive'}: ${m.content}`).join('\n')
  : ''}

${context?.user_name ? `User's name: ${context.user_name}` : ''}

USER'S QUESTION: ${message}

${isHybrid ? 'Answer comprehensively using web knowledge, then naturally connect to personal context.' : 'Respond with helpful, specific information extracted from their saved data. Use the semantically matched notes and learned facts above as your primary source.'}`;

      return streamGeminiResponse(hybridPrompt, ctxAskContent, isHybrid ? 'standard' : route.responseTier);
    }

    // ── ACTION (create/complete task, set reminder) ──────────────
    if (detected.type === 'action') {
      const serverCtx = await serverCtxPromise;
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      const actionResult = await handleActionRequest(supabase, user_id, couple_id, message, serverCtx, context);

      if (actionResult) {
        // Stream a confirmation response that includes the action result
        const confirmPrompt = `You are Olive. You just performed an action for the user. Confirm what you did warmly and briefly. Include the specific details. ${OLIVE_CHAT_PROMPT}`;
        const confirmContent = `ACTION PERFORMED:\n${JSON.stringify(actionResult)}\n\nUser's original request: ${message}\n\n${context?.user_name ? `User's name: ${context.user_name}` : ''}\n\nConfirm what you did in 1-2 sentences. Be specific about what was created/completed.`;
        return streamGeminiResponse(confirmPrompt, confirmContent, 'lite');
      }

      // Action failed or not recognized — fall through to chat
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

  // Phase 4: Semantic context — learned facts & relationships
  if (serverCtx.semanticMemoryChunks) parts.push(serverCtx.semanticMemoryChunks);
  if (serverCtx.relationshipGraph) parts.push(serverCtx.relationshipGraph);

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

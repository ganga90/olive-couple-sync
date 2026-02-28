/**
 * ASK-OLIVE-INDIVIDUAL Edge Function
 * ============================================================================
 * Enhanced with Feature 2: Recall & Reframe Agent (Opinionated RAG)
 *
 * This function now performs dual-source semantic search:
 * 1. FACTS from saved_links (objective information)
 * 2. MEMORIES from olive_memory_chunks (subjective experiences/opinions)
 *
 * The LLM receives both sources tagged appropriately and synthesizes
 * responses that prioritize warnings from negative memories.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai@1.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Citation {
  type: 'fact' | 'memory';
  label: string;
  url?: string;
  date?: string;
  similarity?: number;
}

interface RAGDocument {
  id: string;
  content: string;
  source_type: string;
  source_label: string;
  similarity: number;
  created_at: string;
  metadata: Record<string, any>;
}

// ============================================================================
// SYSTEM PROMPT - Enhanced with RAG Instructions
// ============================================================================

const OLIVE_SYSTEM_PROMPT = `You are Olive, the friendly and resourceful AI assistant within the Olive app. Your purpose is to help couples and individuals manage everyday tasks, ideas, notes, and saved items with intelligence and empathy.

You act like a well-informed, upbeat companion—practical, concise, and always positive. You are proactive, efficient, and focus relentlessly on solving the user's present need.

CRITICAL: You have access to the user's saved data (lists, notes, tasks, books, restaurants, date ideas, etc.). When the user asks about their saved items:
- ALWAYS reference the specific items from their saved data provided in the context
- Be specific - mention actual titles, names, and details from their lists
- If they ask "what books did I save?" - tell them the exact books from their "Books" list
- If they ask for restaurant recommendations - check their saved restaurants/date ideas first, then supplement with search if needed
- If they ask about tasks - reference their actual task statistics and items

RECALL & REFRAME (RAG) - CRITICAL:
You have access to two types of retrieved context:
1. [FACT] entries - Objective information from saved links, documents, bookings, products
2. [MEMORY] entries - Subjective experiences, opinions, feelings, past decisions

SYNTHESIS RULES for retrieved context:
1. When facts and memories ALIGN, combine them naturally into a helpful response
2. When a fact CONFLICTS with a negative memory, ALWAYS PRIORITIZE THE WARNING
   - Example: If a hotel has good facts but the user had a bad experience, warn them
3. Always acknowledge the source of information in your response
4. Be conversational but informative
5. Include relevant citations when referencing retrieved information

EXAMPLE SCENARIOS:

User: "Should we go back to Hotel Belvedere?"
[FACT] Hotel Belvedere - 4 star, $200/night, downtown location
[MEMORY] "The service was terrible and the bed was uncomfortable"
Response: "You saved Hotel Belvedere as an option - it's a 4-star downtown hotel at $200/night. However, you noted last time that the service was terrible and the bed was uncomfortable. I'd suggest looking for alternatives unless you want to give them another chance."

User: "What's that Thai restaurant we liked?"
[FACT] Thai Orchid - 123 Main St, saved Jan 15
[MEMORY] "Best pad thai in the city, cozy atmosphere"
Response: "That's Thai Orchid at 123 Main St! You saved it back in January and mentioned it has the best pad thai in the city with a cozy atmosphere."

User: "Any ideas for this weekend?"
[FACT] Saturday weather forecast: Sunny, 72°F
[MEMORY] "We wanted to try that hiking trail" (from 2 weeks ago)
Response: "The weather looks perfect for Saturday - sunny and 72°F! You mentioned a couple weeks ago wanting to try that hiking trail. Could be a great opportunity!"

Core Objectives:
- Deliver the most useful, actionable, and accurate response based on the user's saved data and conversation context
- When asked about saved items, ALWAYS use the provided saved_items_context - never say you don't have access
- Use retrieved [FACT] and [MEMORY] context to enrich your responses
- Be concise, friendly, and clear—your tone should be encouraging, approachable, and smart
- Track the conversation flow to ensure continuity and avoid repetition
- Use the user's stored memories and preferences to personalize your responses

Guidelines:
1. Personality: Warm, optimistic, respectful—like a friendly concierge or knowledgeable local
2. Direct Support: Immediately provide your best answer or recommendation
3. Saved Data Priority: When asked about saved items, tasks, lists, books, restaurants, etc., FIRST check the provided saved_items_context
4. RAG Context: Use [FACT] and [MEMORY] entries to provide informed, personalized responses
5. Use Real-Time Search: When the user asks about restaurants, events, prices, reviews, or anything that benefits from current data AND their saved items don't have relevant info, use Google Search
6. Cite Sources: When providing factual information from search or RAG, mention where it comes from
7. Conversation Memory: Build upon earlier messages in this session, don't repeat questions already answered
8. User Memory: Leverage the user's stored memories and preferences for personalized assistance

RESPONSE FORMATTING (CRITICAL):
Always format your responses using proper Markdown for rich rendering:
- Use **bold** for emphasis on key points
- Use bullet points (- or *) for lists
- Use numbered lists (1. 2. 3.) for sequential steps or rankings
- Use [Link Text](URL) format for ALL hyperlinks - never show raw URLs
- Use ### for section headings when organizing longer responses
- Use \`code\` for specific names, codes, or technical terms
- Keep paragraphs short and scannable

IMPORTANT - Handling questions about saved items:
When the user asks about their saved items (e.g., "What books did I save?", "What's in my lists?", "Show my tasks"):
1. Check the USER'S LISTS AND SAVED ITEMS section in the context
2. Respond with the ACTUAL items from their lists
3. Never say "I don't have access to your lists" if the context includes saved_items_context
4. If a specific list is empty or doesn't exist, say so clearly

Example responses:

User: What books did I save?
Olive: Here are the books from your **Books** list:
1. **The Ride of a Lifetime** by Robert Iger – Lessons from 15 years as Disney CEO
2. **Atomic Habits** by James Clear – Building good habits and breaking bad ones
3. **Deep Work** by Cal Newport – Rules for focused success

Would you like me to add any new books to your reading list?

User: Any restaurant ideas for tonight?
Olive: Based on your saved restaurants, here are some options:

**From your Date Ideas list:**
- **Mandolin Aegean Bistro** – Your saved note mentions the beautiful courtyard
- **Cote Miami** – Korean BBQ experience you wanted to try

Would you like me to search for what's available tonight, or add a new restaurant to your list?`;

// ============================================================================
// RAG RETRIEVAL FUNCTION
// ============================================================================

async function performRAGRetrieval(
  supabase: SupabaseClient,
  query: string,
  userId: string,
  coupleId: string | null
): Promise<{ documents: RAGDocument[]; citations: Citation[] }> {
  console.log('[RAG] Performing semantic search for query:', query.substring(0, 100));

  try {
    // First, generate embedding for the query
    const { data: embeddingData, error: embeddingError } = await supabase.functions.invoke('manage-memories', {
      body: {
        action: 'generate_embedding',
        text: query
      }
    });

    if (embeddingError || !embeddingData?.embedding) {
      console.warn('[RAG] Failed to generate query embedding:', embeddingError);
      return { documents: [], citations: [] };
    }

    const queryEmbedding = embeddingData.embedding;
    console.log('[RAG] Generated query embedding, dimensions:', queryEmbedding.length);

    // Call match_documents RPC for dual-source retrieval
    const { data: documents, error: searchError } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_user_id: userId,
      match_couple_id: coupleId,
      match_threshold: 0.65,
      match_count: 8
    });

    if (searchError) {
      console.error('[RAG] Search error:', searchError);
      return { documents: [], citations: [] };
    }

    if (!documents || documents.length === 0) {
      console.log('[RAG] No relevant documents found');
      return { documents: [], citations: [] };
    }

    console.log('[RAG] Found', documents.length, 'relevant documents');

    // Build citations
    const citations: Citation[] = documents.map((doc: RAGDocument) => ({
      type: doc.source_type as 'fact' | 'memory',
      label: doc.source_label,
      url: doc.metadata?.url,
      date: doc.created_at,
      similarity: doc.similarity
    }));

    return { documents, citations };

  } catch (error) {
    console.error('[RAG] Retrieval error:', error);
    return { documents: [], citations: [] };
  }
}

// ============================================================================
// BUILD RAG CONTEXT
// ============================================================================

function buildRAGContext(documents: RAGDocument[]): string {
  if (!documents || documents.length === 0) {
    return '';
  }

  // Separate facts and memories
  const facts = documents.filter(d => d.source_type === 'fact');
  const memories = documents.filter(d => d.source_type === 'memory');

  let context = '\n\nRETRIEVED CONTEXT (from your saved data):\n';
  context += '=' .repeat(50) + '\n';

  // Add facts first
  for (const fact of facts) {
    context += `[FACT] ${fact.content}\n`;
    context += `  Source: ${fact.source_label}`;
    if (fact.metadata?.url) {
      context += ` | URL: ${fact.metadata.url}`;
    }
    context += `\n  Saved: ${new Date(fact.created_at).toLocaleDateString()}\n\n`;
  }

  // Add memories
  for (const memory of memories) {
    context += `[MEMORY] ${memory.content}\n`;
    context += `  Source: ${memory.source_label}`;
    if (memory.metadata?.importance) {
      context += ` | Importance: ${memory.metadata.importance}/5`;
    }
    context += `\n  From: ${new Date(memory.created_at).toLocaleDateString()}\n\n`;
  }

  context += '=' .repeat(50) + '\n';
  context += `Total: ${facts.length} facts, ${memories.length} memories retrieved\n`;

  return context;
}

// ============================================================================
// AI INTENT CLASSIFICATION (for web chat task actions)
// Same pattern as whatsapp-webhook classifyIntent()
// ============================================================================

interface ClassifiedIntent {
  intent: string;
  target_task_id: string | null;
  target_task_name: string | null;
  matched_skill_id: string | null;
  parameters: {
    priority: string | null;
    due_date_expression: string | null;
    query_type: string | null;
    chat_type: string | null;
    list_name: string | null;
    amount: number | null;
    expense_description: string | null;
    is_urgent: boolean | null;
    partner_message_content: string | null;
    partner_action: string | null;
  };
  confidence: number;
  reasoning: string;
}

interface ActionResult {
  type: string;
  task_id?: string;
  task_summary?: string;
  success: boolean;
  details?: Record<string, any>;
}

const intentClassificationSchema = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      enum: ['search', 'create', 'complete', 'set_priority', 'set_due', 'delete', 'move', 'assign', 'remind', 'expense', 'chat', 'contextual_ask', 'partner_message'],
    },
    target_task_id: { type: Type.STRING, nullable: true },
    target_task_name: { type: Type.STRING, nullable: true },
    matched_skill_id: { type: Type.STRING, nullable: true },
    parameters: {
      type: Type.OBJECT,
      properties: {
        priority: { type: Type.STRING, nullable: true },
        due_date_expression: { type: Type.STRING, nullable: true },
        query_type: { type: Type.STRING, nullable: true },
        chat_type: { type: Type.STRING, nullable: true },
        list_name: { type: Type.STRING, nullable: true },
        amount: { type: Type.NUMBER, nullable: true },
        expense_description: { type: Type.STRING, nullable: true },
        is_urgent: { type: Type.BOOLEAN, nullable: true },
        partner_message_content: { type: Type.STRING, nullable: true },
        partner_action: { type: Type.STRING, nullable: true, enum: ['remind', 'tell', 'ask', 'notify'] },
      },
      required: [],
    },
    confidence: { type: Type.NUMBER },
    reasoning: { type: Type.STRING },
  },
  required: ['intent', 'confidence', 'reasoning'],
};

async function classifyIntentForChat(
  message: string,
  conversationHistory: Array<{ role: string; content: string }>,
  activeTasks: Array<{ id: string; summary: string; due_date: string | null; priority: string }>,
  userMemories: Array<{ title: string; content: string; category: string }>,
  activatedSkills: Array<{ skill_id: string; name: string }>,
): Promise<ClassifiedIntent | null> {
  const GEMINI_API_KEY = Deno.env.get('GEMINI_API') || Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      console.warn('[classifyIntentForChat] No GEMINI_API env var');
    return null;
  }

  try {
    const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const recentConvo = conversationHistory.slice(-6).map(msg =>
      `${msg.role === 'user' ? 'User' : 'Olive'}: ${msg.content}`
    ).join('\n');

    const taskList = activeTasks.slice(0, 30).map(t =>
      `- [${t.id}] "${t.summary}" (due: ${t.due_date || 'none'}, priority: ${t.priority})`
    ).join('\n');

    const memoryList = userMemories.slice(0, 10).map(m =>
      `- [${m.category}] ${m.title}: ${m.content}`
    ).join('\n');

    const skillsList = activatedSkills.map(s => `- ${s.skill_id}: ${s.name}`).join('\n');

    const systemPrompt = `You are the intent classifier for Olive, an AI personal assistant. You understand natural, conversational language — the user talks to you like a friend. Interpret the MEANING behind their words, not just keywords. Return structured JSON.

## INTENTS:
- "search": User wants to see/find/list their tasks or items (e.g., "what's urgent?", "show my tasks")
- "create": User wants to save something new (e.g., "buy milk", "call mom tomorrow")
- "complete": User wants to mark a task as done (e.g., "done with groceries", "finished!")
- "set_priority": User wants to change importance (e.g., "make it urgent")
- "set_due": User wants to change when something is due (e.g., "change it to 7:30 AM", "postpone to Friday")
- "delete": User wants to remove/cancel a task (e.g., "delete the dentist task", "cancel that", "never mind about that")
- "move": User wants to move a task to a different list
- "assign": User wants to assign a task to someone
- "remind": User wants a reminder
- "expense": User wants to log spending
- "chat": User wants conversational interaction (e.g., "morning briefing", "how am I doing?", "motivate me")
- "contextual_ask": User is asking about their saved data (e.g., "when is dental?", "what restaurants did I save?")
- "partner_message": User wants to send a message TO their partner via Olive (e.g., "remind Marco to buy lemons", "tell Almu to pick up the kids", "ask partner to call the dentist"). Set partner_message_content to the message/task content, and partner_action to the type (remind/tell/ask/notify).

## CRITICAL RULES:
1. **Conversational context is king.** Use CONVERSATION HISTORY to resolve "it", "that", "this", "the last one" and pronouns. If someone says "cancel it" after discussing a task, the target is that task.
2. **Match tasks by meaning.** Use ACTIVE TASKS to find the referred task. Fuzzy match — "dentist" matches "Dental checkup for Milka". Return UUID in target_task_id.
3. **Use memories for personalization.** MEMORIES tell you who people are, what things mean, preferences, etc.
4. **"Cancel" is context-dependent.** "Cancel the dentist" = delete. "Cancel my subscription" = probably create (a task to cancel).
5. **Time expressions = set_due, not create.** "Change/move/postpone/reschedule" → always set_due.
6. **Relative references.** "Last task", "the latest one", "previous task" → preserve the EXACT phrase in target_task_name. These are action intents, never "create".
7. **Ambiguity → lean towards most helpful intent.** Check context before defaulting to "create".
8. **Confidence:** 0.9+ clear, 0.7-0.9 moderate, 0.5-0.7 uncertain.

## CONVERSATION HISTORY:
${recentConvo || 'No previous conversation.'}

## USER'S ACTIVE TASKS:
${taskList || 'No active tasks.'}

## USER'S MEMORIES:
${memoryList || 'No memories stored.'}

## USER'S ACTIVATED SKILLS:
${skillsList || 'No skills activated.'}`;

    const response = await genai.models.generateContent({
      model: "gemini-2.5-flash-lite", // Lite: fast JSON classification for in-app chat
      contents: `Classify this message: "${message}"`,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: intentClassificationSchema,
        temperature: 0.1,
        maxOutputTokens: 500,
      },
    });

    const responseText = response.text || '';
    console.log('[classifyIntentForChat] Raw response:', responseText);

    const result: ClassifiedIntent = JSON.parse(responseText);
    console.log(`[classifyIntentForChat] intent=${result.intent}, confidence=${result.confidence}, task_id=${result.target_task_id}, reasoning=${result.reasoning}`);

    return result;
  } catch (error) {
    console.error('[classifyIntentForChat] Error:', error);
    return null;
  }
}

// Relative reference patterns for "last task", "latest one", etc.
const RELATIVE_REF_PATTERNS = [
  /^(?:the\s+)?(?:last|latest|most\s+recent|previous|newest|recent)\s+(?:task|one|item|note|thing)$/i,
  /^(?:the\s+)?(?:last|latest|most\s+recent|previous|newest|recent)\s+(?:task|one|item|note|thing)\s+(?:i\s+)?(?:added|created|saved|sent|made)$/i,
  /^(?:that|the)\s+(?:task|one|item|note|thing)\s+(?:i\s+)?(?:just\s+)?(?:added|created|saved|sent|made)$/i,
  /^(?:l'ultima|l'ultimo|ultima|ultimo)\s*(?:attività|compito|nota|cosa)?$/i,
  /^(?:la\s+)?(?:última|ultimo|reciente)\s*(?:tarea|nota|cosa)?$/i,
];

function isRelativeRef(target: string): boolean {
  return RELATIVE_REF_PATTERNS.some(p => p.test(target.trim()));
}

// Execute a task action server-side and return the result
async function executeTaskAction(
  supabase: SupabaseClient,
  intent: ClassifiedIntent,
  userId: string,
  coupleId: string | null
): Promise<ActionResult | null> {
  const taskActions = ['complete', 'set_priority', 'set_due', 'delete', 'partner_message', 'remind'];
    if (!taskActions.includes(intent.intent)) return null;
    if (intent.confidence < 0.5) return null;

  try {
    // Find the target task
    let taskId = intent.target_task_id;
    let taskSummary = intent.target_task_name;

    // Check for relative references first ("last task", "latest one", etc.)
    if (taskSummary && isRelativeRef(taskSummary)) {
      console.log('[executeTaskAction] Detected relative reference:', taskSummary);
      let query = supabase
        .from('clerk_notes')
        .select('id, summary, due_date, priority')
        .eq('completed', false)
        .order('created_at', { ascending: false })
        .limit(1);

      if (coupleId) {
        query = query.or(`author_id.eq.${userId},couple_id.eq.${coupleId}`);
      } else {
        query = query.eq('author_id', userId);
      }

      const { data: recentTasks } = await query;
      if (recentTasks && recentTasks.length > 0) {
        taskId = recentTasks[0].id;
        taskSummary = recentTasks[0].summary;
        console.log('[executeTaskAction] Resolved relative ref to:', taskSummary);
      }
    }

    if (!taskId && taskSummary && !isRelativeRef(taskSummary)) {
      // Search by name if no UUID provided
      const { data: tasks } = await supabase
        .from('clerk_notes')
        .select('id, summary, due_date, priority')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
        .eq('completed', false)
        .ilike('summary', `%${taskSummary}%`)
        .limit(1);

      if (tasks && tasks.length > 0) {
        taskId = tasks[0].id;
        taskSummary = tasks[0].summary;
      }
    }

    if (!taskId) {
      console.warn('[executeTaskAction] No task found for:', taskSummary);
      return null;
    }

    switch (intent.intent) {
      case 'complete': {
        const { error } = await supabase
          .from('clerk_notes')
          .update({ completed: true, updated_at: new Date().toISOString() })
          .eq('id', taskId);

        if (error) throw error;
        console.log('[executeTaskAction] Completed task:', taskSummary);
        return { type: 'complete', task_id: taskId, task_summary: taskSummary || '', success: true };
      }

      case 'set_priority': {
        const newPriority = intent.parameters?.priority?.toLowerCase() === 'low' ? 'low' : 'high';
        const { error } = await supabase
          .from('clerk_notes')
          .update({ priority: newPriority, updated_at: new Date().toISOString() })
          .eq('id', taskId);

        if (error) throw error;
        console.log('[executeTaskAction] Set priority:', taskSummary, '→', newPriority);
        return { type: 'set_priority', task_id: taskId, task_summary: taskSummary || '', success: true, details: { new_priority: newPriority } };
      }

      case 'set_due':
      case 'remind': {
        const dateExpr = intent.parameters?.due_date_expression;
        if (!dateExpr) return null;

        // Robust natural language date parsing
        const now = new Date();
        let targetDate: Date | null = null;
        let readable = '';
        const lower = dateExpr.toLowerCase().trim();

        // Word-to-number map
        const wordToNum: Record<string, number> = {
          'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
          'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'fifteen': 15,
          'twenty': 20, 'thirty': 30, 'un': 1, 'una': 1, 'dos': 2, 'media': 0.5, 'mezza': 0.5,
        };
        const resolveNum = (t: string): number | null => { const n = parseInt(t); return !isNaN(n) ? n : (wordToNum[t.toLowerCase()] ?? null); };

        // Relative time: "in X minutes/hours/days"
        const halfHourMatch = lower.match(/(?:half\s+(?:an?\s+)?hour|mezz'?ora|media\s+hora)/i);
        const minMatch = lower.match(/in\s+([\w'-]+(?:\s+[\w'-]+)?)\s*(?:min(?:ute)?s?|minuto?s?|minut[io])/i);
        const hrMatch = lower.match(/in\s+([\w'-]+(?:\s+[\w'-]+)?)\s*(?:hours?|hrs?|or[ae]s?|or[ae])/i);
        const dayMatch = lower.match(/in\s+([\w'-]+(?:\s+[\w'-]+)?)\s*(?:days?|días?|dias?|giorn[io])/i);

        if (halfHourMatch) {
          targetDate = new Date(now); targetDate.setMinutes(targetDate.getMinutes() + 30); readable = 'in 30 minutes';
        } else if (minMatch) {
          const num = resolveNum(minMatch[1].trim());
          if (num) { targetDate = new Date(now); targetDate.setMinutes(targetDate.getMinutes() + Math.round(num)); readable = `in ${Math.round(num)} minutes`; }
        } else if (hrMatch) {
          const num = resolveNum(hrMatch[1].trim());
          if (num) { targetDate = new Date(now); if (num === 0.5) { targetDate.setMinutes(targetDate.getMinutes() + 30); readable = 'in 30 minutes'; } else { targetDate.setHours(targetDate.getHours() + Math.round(num)); readable = `in ${Math.round(num)} hour${num > 1 ? 's' : ''}`; } }
        } else if (dayMatch) {
          const num = resolveNum(dayMatch[1].trim());
          if (num) { targetDate = new Date(now); targetDate.setDate(targetDate.getDate() + Math.round(num)); targetDate.setHours(9, 0, 0, 0); readable = `in ${Math.round(num)} day${num > 1 ? 's' : ''}`; }
        }

        // Named dates
        if (!targetDate) {
          if (lower.includes('tomorrow') || /\bmañana\b/.test(lower) || lower.includes('domani')) {
            targetDate = new Date(now); targetDate.setDate(targetDate.getDate() + 1); targetDate.setHours(9, 0, 0, 0); readable = 'tomorrow';
          } else if (lower.includes('today') || lower.includes('hoy') || lower.includes('oggi')) {
            targetDate = new Date(now); targetDate.setHours(18, 0, 0, 0); readable = 'today';
          } else if (lower.includes('next week') || lower.includes('próxima semana') || lower.includes('prossima settimana')) {
            targetDate = new Date(now); targetDate.setDate(targetDate.getDate() + 7); targetDate.setHours(9, 0, 0, 0); readable = 'next week';
          } else if (lower.includes('this weekend') || lower.includes('este fin de semana') || lower.includes('questo weekend')) {
            targetDate = new Date(now); const daysUntilSat = (6 - targetDate.getDay() + 7) % 7 || 7; targetDate.setDate(targetDate.getDate() + daysUntilSat); targetDate.setHours(10, 0, 0, 0); readable = 'this weekend';
          }
        }

        // Named time-of-day
        let hours: number | null = null;
        let mins = 0;
        if (/\bnoon\b|\bmidday\b|\bmezzogiorno\b|\bmediodía\b|\bmediodia\b/.test(lower)) { hours = 12; }
        else if (lower.includes('morning') || lower.includes('mattina')) { hours = 9; }
        else if (lower.includes('afternoon') || lower.includes('pomeriggio') || lower.includes('tarde')) { hours = 14; }
        else if (lower.includes('evening') || lower.includes('sera') || lower.includes('noche')) { hours = 18; }
        else if (lower.includes('night') || lower.includes('notte')) { hours = 20; }
        else if (lower.includes('midnight') || lower.includes('mezzanotte') || lower.includes('medianoche')) { hours = 0; }

        // Explicit time: "3pm", "10:30 AM"
        const timeMatch = lower.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)/i);
        if (timeMatch) {
          hours = parseInt(timeMatch[1]);
          mins = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
          if (timeMatch[3].toLowerCase() === 'pm' && hours < 12) hours += 12;
          if (timeMatch[3].toLowerCase() === 'am' && hours === 12) hours = 0;
        }

        // Standalone time with no date → today (or tomorrow if passed)
        if (!targetDate && hours !== null) {
          targetDate = new Date(now);
          const proposed = new Date(now); proposed.setHours(hours, mins, 0, 0);
          if (proposed <= now) { targetDate.setDate(targetDate.getDate() + 1); readable = 'tomorrow'; } else { readable = 'today'; }
        }

        // Apply time to date
        if (targetDate && hours !== null) {
          targetDate.setHours(hours, mins, 0, 0);
          if (!readable.includes('minute') && !readable.includes('hour')) {
            readable += ` at ${hours > 12 ? hours - 12 : hours === 0 ? 12 : hours}:${mins.toString().padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
          }
        }

        if (!targetDate) return null;

        const updateField = intent.intent === 'remind' ? 'reminder_time' : 'due_date';
        const { error } = await supabase
          .from('clerk_notes')
          .update({ [updateField]: targetDate.toISOString(), updated_at: new Date().toISOString() })
          .eq('id', taskId);

        if (error) throw error;
        console.log(`[executeTaskAction] Set ${updateField}:`, taskSummary, '→', targetDate.toISOString());
        return { type: intent.intent, task_id: taskId, task_summary: taskSummary || '', success: true, details: { [`new_${updateField}`]: targetDate.toISOString(), readable } };
      }

      case 'delete': {
        const { error } = await supabase
          .from('clerk_notes')
          .delete()
          .eq('id', taskId);

        if (error) throw error;
        console.log('[executeTaskAction] Deleted task:', taskSummary);
        return { type: 'delete', task_id: taskId, task_summary: taskSummary || '', success: true };
      }

      case 'partner_message': {
        // Handle partner messaging from web chat
        const partnerMsgContent = intent.parameters?.partner_message_content || intent.target_task_name || '';
        const partnerAction = intent.parameters?.partner_action || 'tell';

        if (!coupleId || !partnerMsgContent) {
          return { type: 'partner_message', success: false, details: { error: !coupleId ? 'no_couple' : 'no_content' } };
        }

        // Find partner
        const { data: partnerMember } = await supabase
          .from('clerk_couple_members')
          .select('user_id')
          .eq('couple_id', coupleId)
          .neq('user_id', userId)
          .limit(1)
          .single();

        if (!partnerMember?.user_id) {
          return { type: 'partner_message', success: false, details: { error: 'no_partner' } };
        }

        // Get couple info for names
        const { data: coupleInfo } = await supabase
          .from('clerk_couples')
          .select('you_name, partner_name, created_by')
          .eq('id', coupleId)
          .single();

        const isCreator = coupleInfo?.created_by === userId;
        const partnerName = isCreator ? (coupleInfo?.partner_name || 'Partner') : (coupleInfo?.you_name || 'Partner');
        const senderName = isCreator ? (coupleInfo?.you_name || 'Your partner') : (coupleInfo?.partner_name || 'Your partner');
        const partnerId = partnerMember.user_id;

        // Get partner phone
        const { data: partnerProfile } = await supabase
          .from('clerk_profiles')
          .select('phone_number, last_user_message_at')
          .eq('id', partnerId)
          .single();

        if (!partnerProfile?.phone_number) {
          return { type: 'partner_message', success: false, task_summary: partnerName, details: { error: 'no_phone', partner_name: partnerName } };
        }

        // Determine if task-like → save as assigned task
        const isTaskLike = /\b(buy|get|pick up|call|book|make|schedule|clean|fix|do|send|bring|take|comprar|llamar|hacer|enviar|comprare|chiamare|fare|inviare)\b/i.test(partnerMsgContent);
        let savedTaskSummary = partnerMsgContent;

        if (isTaskLike) {
          try {
            const { data: processData } = await supabase.functions.invoke('process-note', {
              body: { text: partnerMsgContent, user_id: userId, couple_id: coupleId }
            });
            const noteData = {
              author_id: userId, couple_id: coupleId,
              original_text: partnerMsgContent,
              summary: processData?.summary || partnerMsgContent,
              category: processData?.category || 'task',
              priority: processData?.priority || 'medium',
              task_owner: partnerId, completed: false,
              tags: processData?.tags || [], items: processData?.items || [],
              due_date: processData?.due_date || null,
              list_id: processData?.list_id || null,
            };
            const { data: inserted } = await supabase.from('clerk_notes').insert(noteData).select('id, summary').single();
            if (inserted) savedTaskSummary = inserted.summary;
          } catch (e) {
            console.error('[partner_message] Task creation error:', e);
          }
        }

        // Send WhatsApp message to partner via gateway
        const actionEmoji: Record<string, string> = { remind: '⏰', tell: '💬', ask: '❓', notify: '📢' };
        const emoji = actionEmoji[partnerAction] || '💬';
        const partnerMsg = partnerAction === 'remind'
          ? `${emoji} Reminder from ${senderName}:\n\n${savedTaskSummary}\n\nReply "done" when finished 🫒`
          : partnerAction === 'ask'
          ? `${emoji} ${senderName} is asking:\n\n${partnerMsgContent}\n\nReply to let them know 🫒`
          : `${emoji} Message from ${senderName}:\n\n${savedTaskSummary}\n\n🫒 Olive`;

        try {
          await supabase.functions.invoke('whatsapp-gateway', {
            body: {
              action: 'send',
              message: {
                user_id: partnerId, message_type: 'partner_notification',
                content: partnerMsg, priority: 'normal',
                metadata: { from_user_id: userId, from_name: senderName, action: partnerAction },
              },
            },
          });
        } catch (sendErr) {
          console.error('[partner_message] Gateway send error:', sendErr);
          return { type: 'partner_message', success: true, task_summary: savedTaskSummary, details: { partner_name: partnerName, sent: false, task_created: isTaskLike } };
        }

        return { type: 'partner_message', success: true, task_summary: savedTaskSummary, details: { partner_name: partnerName, sent: true, task_created: isTaskLike, action: partnerAction } };
      }
    }

    return null;
  } catch (error) {
    console.error('[executeTaskAction] Error:', error);
    return null;
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  console.log('[Ask Olive Individual] Request received:', req.method);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Support both the old note-specific format and the new global chat format
    const {
      // New global chat format
      message,
      user_id,
      couple_id,
      context,
      // Old note-specific format
      noteContent,
      userMessage,
      noteCategory,
      noteTitle,
      previousInteractionId,
      // RAG control
      enable_rag = true,  // Enable RAG by default
    } = body;

    // Determine which format we're dealing with
    const isGlobalChat = context?.source === 'global_chat';
    const actualMessage = message || userMessage;
    const actualUserId = user_id || body.user_id;
    const actualCoupleId = couple_id || body.couple_id || null;

    console.log('[Ask Olive Individual] Mode:', isGlobalChat ? 'global_chat' : 'note_specific');
    console.log('[Ask Olive Individual] User ID:', actualUserId);
    console.log('[Ask Olive Individual] Message:', actualMessage?.slice(0, 100));
    console.log('[Ask Olive Individual] RAG enabled:', enable_rag);

    const geminiApiKey = Deno.env.get('GEMINI_API');
    if (!geminiApiKey) {
      throw new Error('GEMINI_API environment variable not found');
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    let supabase: SupabaseClient | null = null;
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    }

    // Fetch user memories for context personalization
    let memoryContext = '';
    if (actualUserId && supabase) {
      try {
        const { data: memoryData } = await supabase.functions.invoke('manage-memories', {
          body: { action: 'get_context', user_id: actualUserId }
        });

        if (memoryData?.success && memoryData.context) {
          memoryContext = memoryData.context;
          console.log('[Ask Olive Individual] Retrieved', memoryData.count, 'user memories for context');
        }
      } catch (memErr) {
        console.warn('[Ask Olive Individual] Could not fetch user memories:', memErr);
      }
    }

    // =========================================================================
    // NEW: Perform RAG retrieval for semantic search
    // =========================================================================
    let ragContext = '';
    let citations: Citation[] = [];

    if (enable_rag && actualUserId && supabase && actualMessage) {
      const ragResult = await performRAGRetrieval(
        supabase,
        actualMessage,
        actualUserId,
        actualCoupleId
      );

      if (ragResult.documents.length > 0) {
        ragContext = buildRAGContext(ragResult.documents);
        citations = ragResult.citations;
        console.log('[Ask Olive Individual] RAG context built, length:', ragContext.length);
      }
    }

    // =========================================================================
    // Fetch Oura Ring health data for context
    // =========================================================================
    let ouraContext = '';
    if (actualUserId && supabase) {
      try {
        // Check if user has an active Oura connection
        const { data: ouraConn } = await supabase
          .from('oura_connections')
          .select('id, is_active')
          .eq('user_id', actualUserId)
          .eq('is_active', true)
          .maybeSingle();

        if (ouraConn) {
          // Fetch last 7 days of Oura data including stress & resilience
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const { data: ouraRows } = await supabase
            .from('oura_daily_data')
            .select('day, sleep_score, sleep_duration_seconds, readiness_score, activity_score, steps, stress_day_summary, stress_high_minutes, recovery_high_minutes, resilience_level')
            .eq('user_id', actualUserId)
            .gte('day', sevenDaysAgo)
            .order('day', { ascending: false })
            .limit(7);

          if (ouraRows && ouraRows.length > 0) {
            const today = new Date().toISOString().split('T')[0];
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const todayData = ouraRows.find((r: any) => r.day === today);
            // Use today's data, or yesterday's if today is not yet available
            const latestData = todayData || ouraRows.find((r: any) => r.day === yesterday);

            const rowsWithSleep = ouraRows.filter((r: any) => r.sleep_score);
            const rowsWithReadiness = ouraRows.filter((r: any) => r.readiness_score);
            const rowsWithActivity = ouraRows.filter((r: any) => r.activity_score);
            const avgSleep = rowsWithSleep.length ? Math.round(rowsWithSleep.reduce((s: number, r: any) => s + r.sleep_score, 0) / rowsWithSleep.length) : 0;
            const avgReadiness = rowsWithReadiness.length ? Math.round(rowsWithReadiness.reduce((s: number, r: any) => s + r.readiness_score, 0) / rowsWithReadiness.length) : 0;
            const avgActivity = rowsWithActivity.length ? Math.round(rowsWithActivity.reduce((s: number, r: any) => s + r.activity_score, 0) / rowsWithActivity.length) : 0;

            const parts: string[] = ['## Health & Wellness (Oura Ring, last 7 days):'];
            if (latestData) {
              const sleepHours = latestData.sleep_duration_seconds ? (latestData.sleep_duration_seconds / 3600).toFixed(1) : null;
              const dayLabel = latestData.day === today ? 'Today' : 'Yesterday';
              parts.push(`${dayLabel}: Sleep ${latestData.sleep_score || 'N/A'}/100${sleepHours ? ` (${sleepHours}h)` : ''} | Readiness ${latestData.readiness_score || 'N/A'}/100 | Activity ${latestData.activity_score || 'N/A'}/100 | ${latestData.steps || 0} steps`);
              if (latestData.stress_day_summary) {
                parts.push(`Stress today: ${latestData.stress_day_summary}${latestData.stress_high_minutes ? ` (${latestData.stress_high_minutes}min high stress)` : ''}`);
              }
              if (latestData.resilience_level) {
                parts.push(`Resilience: ${latestData.resilience_level}`);
              }
            }
            parts.push(`7-day averages: Sleep ${avgSleep}/100 | Readiness ${avgReadiness}/100 | Activity ${avgActivity}/100`);

            // Surface notable trends to help the AI give better advice
            if (latestData?.sleep_score && avgSleep && (latestData.sleep_score - avgSleep) < -10) {
              parts.push(`Note: Sleep is notably below their average (${latestData.sleep_score} vs avg ${avgSleep}).`);
            }
            if (latestData?.readiness_score && latestData.readiness_score < 65) {
              parts.push(`Note: Readiness is low — body may need recovery.`);
            }

            parts.push('Use this data to give gentle, advisory suggestions when relevant. Frame as "you might want to..." not "you must...". Never alarm the user.');
            ouraContext = parts.join('\n');
            console.log('[Ask Olive Individual] Oura context built for', ouraRows.length, 'days');
          }
        }
      } catch (ouraErr) {
        console.warn('[Ask Olive Individual] Could not fetch Oura data:', ouraErr);
      }
    }

    // =========================================================================
    // AI INTENT CLASSIFICATION + ACTION EXECUTION (global chat only)
    // =========================================================================
    let actionResult: ActionResult | null = null;

    if (isGlobalChat && supabase && actualUserId && actualMessage) {
      try {
        const conversationHist = context?.conversation_history || [];

        // Fetch context for AI router (parallel lightweight queries)
        const [tasksRes, memoriesRes, skillsRes] = await Promise.all([
          supabase
            .from('clerk_notes')
            .select('id, summary, due_date, priority')
            .or(`author_id.eq.${actualUserId}${actualCoupleId ? `,couple_id.eq.${actualCoupleId}` : ''}`)
            .eq('completed', false)
            .order('created_at', { ascending: false })
            .limit(30),
          supabase
            .from('user_memories')
            .select('title, content, category')
            .eq('user_id', actualUserId)
            .eq('is_active', true)
            .order('importance', { ascending: false })
            .limit(10),
          supabase
            .from('olive_user_skills')
            .select('skill_id')
            .eq('user_id', actualUserId)
            .eq('enabled', true)
            .then(async (userSkillsRes: any) => {
              if (!userSkillsRes.data || userSkillsRes.data.length === 0) return { data: [] };
              const skillIds = userSkillsRes.data.map((s: any) => s.skill_id);
              return supabase
                .from('olive_skills')
                .select('skill_id, name')
                .in('skill_id', skillIds)
                .eq('is_active', true);
            }),
        ]);

        const activeTasks = tasksRes.data || [];
        const userMems = memoriesRes.data || [];
        const activeSkills = skillsRes.data || [];

        // Classify intent
        const aiResult = await classifyIntentForChat(
          actualMessage,
          conversationHist,
          activeTasks,
          userMems,
          activeSkills,
        );

        // Execute task actions server-side (complete, set_priority, set_due, delete)
        if (aiResult && aiResult.confidence >= 0.5) {
          const taskActions = ['complete', 'set_priority', 'set_due', 'delete', 'partner_message', 'remind'];
          if (taskActions.includes(aiResult.intent)) {
            console.log(`[Ask Olive Individual] Task action detected: ${aiResult.intent} (confidence: ${aiResult.confidence})`);
            actionResult = await executeTaskAction(supabase, aiResult, actualUserId, actualCoupleId);
          }
        }
      } catch (err) {
        console.warn('[Ask Olive Individual] Intent classification error (non-fatal):', err);
        // Continue with normal conversational response
      }
    }

    // Build the full context based on the chat mode
    let fullContext = '';

    if (isGlobalChat) {
      // Global chat mode - include saved items context
      const userName = context?.user_name || 'there';
      const savedItemsContext = context?.saved_items_context || '';
      const conversationHistory = context?.conversation_history || [];

      fullContext = `User's Name: ${userName}\n`;

      if (memoryContext) {
        fullContext += `\n${memoryContext}\n`;
      }

      if (ouraContext) {
        fullContext += `\n${ouraContext}\n`;
      }

      if (savedItemsContext) {
        fullContext += `\n${savedItemsContext}\n`;
      }

      // Add RAG context
      if (ragContext) {
        fullContext += ragContext;
      }

      // Add conversation history for multi-turn context
      if (conversationHistory.length > 0) {
        fullContext += '\nCONVERSATION HISTORY:\n';
        conversationHistory.slice(-10).forEach((msg: { role: string; content: string }) => {
          fullContext += `${msg.role === 'user' ? 'User' : 'Olive'}: ${msg.content}\n`;
        });
        fullContext += '\n';
      }

      fullContext += `Current User Question: ${actualMessage}`;

      // If an action was executed, tell Gemini so it responds naturally
      if (actionResult && actionResult.success) {
        const actionVerbs: Record<string, string> = {
          complete: 'marked as complete',
          set_priority: `changed the priority to ${actionResult.details?.new_priority || 'updated'}`,
          set_due: `updated the due date/time to ${actionResult.details?.new_due_date ? new Date(actionResult.details.new_due_date).toLocaleString() : 'updated'}`,
          delete: 'deleted',
          remind: `set a reminder ${actionResult.details?.readable || 'for ' + (actionResult.details?.new_reminder_time ? new Date(actionResult.details.new_reminder_time).toLocaleString() : 'later')}`,
          partner_message: actionResult.details?.sent
            ? `sent a WhatsApp message to ${actionResult.details?.partner_name || 'your partner'}${actionResult.details?.task_created ? ' and created a task assigned to them' : ''}`
            : actionResult.details?.error === 'no_phone'
            ? `couldn't message ${actionResult.details?.partner_name || 'your partner'} because they haven't linked their WhatsApp yet`
            : actionResult.details?.error === 'no_couple'
            ? 'couldn\'t send the message because you\'re not in a shared space'
            : `couldn't reach ${actionResult.details?.partner_name || 'your partner'} right now`,
        };
        const verb = actionVerbs[actionResult.type] || actionResult.type;
        fullContext += `\n\nACTION PERFORMED: You just ${verb}${actionResult.type !== 'partner_message' ? ` the task "${actionResult.task_summary}"` : ''}. Acknowledge this naturally in your response and confirm what you did. Be concise and friendly.`;
      }

      console.log('[Ask Olive Individual] Built global chat context, length:', fullContext.length);
      console.log('[Ask Olive Individual] Has saved items context:', !!savedItemsContext);
      console.log('[Ask Olive Individual] Has RAG context:', !!ragContext);
      console.log('[Ask Olive Individual] Action result:', actionResult ? `${actionResult.type} (success: ${actionResult.success})` : 'none');
    } else {
      // Note-specific chat mode (legacy)
      fullContext = `${memoryContext ? memoryContext + '\n\n' : ''}`;

      // Add RAG context even in note-specific mode
      if (ragContext) {
        fullContext += ragContext + '\n\n';
      }

      fullContext += `Current Note Details:
- Title: ${noteTitle || 'Untitled'}
- Category: ${noteCategory || 'General'}
- Content: ${noteContent}

User's Question: ${actualMessage}`;
    }

    console.log('[Ask Olive Individual] Calling Gemini API...');

    // Use Gemini Interactions API for stateful multi-turn conversations
    const interactionPayload: any = {
      model: "gemini-2.5-flash",
      config: {
        systemInstruction: OLIVE_SYSTEM_PROMPT,
        tools: [
          { googleSearch: {} } // Enable real-time Google Search for up-to-date information
        ]
      },
      userContent: {
        parts: [{ text: fullContext }]
      }
    };

    // If we have a previous interaction, continue that conversation
    if (previousInteractionId) {
      interactionPayload.previousInteractionId = previousInteractionId;
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1alpha/interactions?key=${geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(interactionPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Ask Olive Individual] Gemini Interactions API error:', response.status, errorText);

      // Fallback to standard generateContent if Interactions API fails
      console.log('[Ask Olive Individual] Falling back to standard generateContent...');
      return await fallbackToGenerateContent(geminiApiKey, fullContext, corsHeaders, citations, actionResult);
    }

    const data = await response.json();
    console.log('[Ask Olive Individual] Gemini response received');
    console.log('[Ask Olive Individual] Interaction ID:', data.interactionId);

    // Extract the text response from the interaction
    const assistantReply = extractTextFromInteraction(data);

    // Return both 'reply' and 'response' for backwards compatibility
    // NEW: Include citations for frontend display
    return new Response(JSON.stringify({
      reply: assistantReply,
      response: assistantReply, // For backwards compatibility with frontend
      interactionId: data.interactionId,
      citations: citations.length > 0 ? citations : undefined,
      sources_used: citations.length > 0 ? {
        facts: citations.filter(c => c.type === 'fact').length,
        memories: citations.filter(c => c.type === 'memory').length
      } : undefined,
      action: actionResult || undefined, // Task action result for frontend
      success: true
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[Ask Olive Individual] Error:', error);
    return new Response(JSON.stringify({
      error: error?.message || 'Unknown error occurred',
      reply: "I'm sorry, I'm having trouble processing your request right now. Please try again in a moment.",
      response: "I'm sorry, I'm having trouble processing your request right now. Please try again in a moment."
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Extract text content from Gemini Interactions response
function extractTextFromInteraction(data: any): string {
  try {
    if (data.outputContent?.parts) {
      return data.outputContent.parts
        .filter((part: any) => part.text)
        .map((part: any) => part.text)
        .join('\n');
    }

    // Handle different response structures
    if (data.candidates?.[0]?.content?.parts) {
      return data.candidates[0].content.parts
        .filter((part: any) => part.text)
        .map((part: any) => part.text)
        .join('\n');
    }

    console.warn('[Ask Olive Individual] Unexpected response structure:', JSON.stringify(data).slice(0, 500));
    return "I received your message but couldn't process the response properly. Please try again.";
  } catch (e) {
    console.error('[Ask Olive Individual] Error extracting text:', e);
    return "I received your message but had trouble formatting my response. Please try again.";
  }
}

// Fallback to standard generateContent API if Interactions API is unavailable
async function fallbackToGenerateContent(
  apiKey: string,
  fullContext: string,
  corsHeaders: Record<string, string>,
  citations: Citation[] = [],
  actionResult: ActionResult | null = null
): Promise<Response> {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: fullContext }]
        }],
        systemInstruction: {
          parts: [{ text: OLIVE_SYSTEM_PROMPT }]
        },
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Fallback API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I'm here to help! Could you rephrase your question?";

    return new Response(JSON.stringify({
      reply,
      response: reply, // For backwards compatibility
      interactionId: null,
      citations: citations.length > 0 ? citations : undefined,
      sources_used: citations.length > 0 ? {
        facts: citations.filter(c => c.type === 'fact').length,
        memories: citations.filter(c => c.type === 'memory').length
      } : undefined,
      action: actionResult || undefined, // Task action result for frontend
      success: true
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[Ask Olive Individual] Fallback error:', error);
    return new Response(JSON.stringify({
      error: error?.message || 'Unknown error occurred',
      reply: "I'm sorry, I'm having trouble right now. Please try again in a moment.",
      response: "I'm sorry, I'm having trouble right now. Please try again in a moment."
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

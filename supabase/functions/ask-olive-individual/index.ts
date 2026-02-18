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
      enum: ['search', 'create', 'complete', 'set_priority', 'set_due', 'delete', 'move', 'assign', 'remind', 'expense', 'chat', 'contextual_ask'],
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
  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GEMINI_API');
    if (!GEMINI_API_KEY) {
      console.warn('[classifyIntentForChat] No GEMINI_API_KEY or GEMINI_API');
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
      model: "gemini-2.5-flash",
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
  const taskActions = ['complete', 'set_priority', 'set_due', 'delete'];
  if (!taskActions.includes(intent.intent)) return null;
  if (intent.confidence < 0.7) return null;

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

      case 'set_due': {
        const dateExpr = intent.parameters?.due_date_expression;
        if (!dateExpr) return null;

        // Simple date parsing for common expressions
        const now = new Date();
        let targetDate: Date | null = null;

        const lower = dateExpr.toLowerCase();
        if (lower.includes('tomorrow')) {
          targetDate = new Date(now);
          targetDate.setDate(targetDate.getDate() + 1);
          targetDate.setHours(9, 0, 0, 0);
        } else if (lower.includes('today')) {
          targetDate = new Date(now);
          targetDate.setHours(18, 0, 0, 0);
        } else {
          // Try to parse time expression like "7:30 AM", "7.30am"
          const timeMatch = lower.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)/i);
          if (timeMatch) {
            targetDate = new Date(now);
            let hours = parseInt(timeMatch[1]);
            const mins = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
            if (timeMatch[3].toLowerCase() === 'pm' && hours < 12) hours += 12;
            if (timeMatch[3].toLowerCase() === 'am' && hours === 12) hours = 0;
            targetDate.setHours(hours, mins, 0, 0);
          }
        }

        if (!targetDate) return null;

        const { error } = await supabase
          .from('clerk_notes')
          .update({ due_date: targetDate.toISOString(), updated_at: new Date().toISOString() })
          .eq('id', taskId);

        if (error) throw error;
        console.log('[executeTaskAction] Set due date:', taskSummary, '→', targetDate.toISOString());
        return { type: 'set_due', task_id: taskId, task_summary: taskSummary || '', success: true, details: { new_due_date: targetDate.toISOString() } };
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
          const taskActions = ['complete', 'set_priority', 'set_due', 'delete'];
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
        };
        const verb = actionVerbs[actionResult.type] || actionResult.type;
        fullContext += `\n\nACTION PERFORMED: You just ${verb} the task "${actionResult.task_summary}". Acknowledge this naturally in your response and confirm what you did. Be concise and friendly.`;
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

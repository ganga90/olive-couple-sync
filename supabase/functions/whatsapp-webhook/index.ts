import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai@1.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// DETERMINISTIC ROUTING - "Strict Gatekeeper"
// ============================================================================
// SEARCH: starts with Show, Find, List, Search, Get, ?, or contains "my tasks/list/reminders"
// MERGE: message is exactly "merge" (case-insensitive)  
// CREATE: Everything else (default)
// ============================================================================

type IntentResult = { intent: 'SEARCH' | 'MERGE' | 'CREATE' | 'CHAT' | 'CONTEXTUAL_ASK' | 'TASK_ACTION' | 'EXPENSE'; isUrgent?: boolean; cleanMessage?: string };

// ============================================================================
// RECENT OUTBOUND MESSAGE CONTEXT
// ============================================================================
interface RecentOutbound {
  type: string;        // 'reminder' | 'morning_briefing' | 'proactive_nudge' | etc.
  content: string;     // The message content sent to the user
  sent_at: string;     // ISO timestamp
  source: 'queue' | 'heartbeat';
}

// ============================================================================
// WHATSAPP SHORTCUT VOCABULARY (prefix-based power user commands)
// ============================================================================
const SHORTCUTS: Record<string, { intent: string; options?: Record<string, any>; label: string }> = {
  '?': { intent: 'SEARCH', label: 'Search' },
  '!': { intent: 'CREATE', options: { isUrgent: true }, label: 'Urgent task' },
  '+': { intent: 'CREATE', label: 'New task' },
  '/': { intent: 'CHAT', options: { chatType: 'general' }, label: 'Chat with Olive' },
  '$': { intent: 'EXPENSE', label: 'Log expense' },
  '@': { intent: 'TASK_ACTION', options: { actionType: 'assign' }, label: 'Assign to partner' },
};

// ============================================================================
// MULTILINGUAL RESPONSE TEMPLATES
// ============================================================================
const LANG_NAMES: Record<string, string> = {
  'en': 'English',
  'es-ES': 'Spanish',
  'es': 'Spanish',
  'it-IT': 'Italian',
  'it': 'Italian',
};

const RESPONSES: Record<string, Record<string, string>> = {
  task_completed: {
    en: '✅ Done! Marked "{task}" as complete. Great job! 🎉',
    'es': '✅ ¡Hecho! "{task}" marcada como completada. ¡Buen trabajo! 🎉',
    'it': '✅ Fatto! "{task}" segnata come completata. Ottimo lavoro! 🎉',
  },
  task_not_found: {
    en: 'I couldn\'t find a task matching "{query}". Try "show my tasks" to see your list.',
    'es': 'No encontré una tarea que coincida con "{query}". Prueba "mostrar mis tareas".',
    'it': 'Non ho trovato un\'attività corrispondente a "{query}". Prova "mostra le mie attività".',
  },
  task_need_target: {
    en: 'I need to know which task you want to modify. Try "done with buy milk" or "make groceries urgent".',
    'es': 'Necesito saber qué tarea quieres modificar. Prueba "hecho con comprar leche" o "hacer urgente compras".',
    'it': 'Devo sapere quale attività vuoi modificare. Prova "fatto con comprare latte" o "rendi urgente la spesa".',
  },
  context_completed: {
    en: '✅ Done! Marked "{task}" as complete (from your recent reminder). Great job! 🎉',
    'es': '✅ ¡Hecho! "{task}" completada (de tu recordatorio reciente). ¡Buen trabajo! 🎉',
    'it': '✅ Fatto! "{task}" completata (dal tuo promemoria recente). Ottimo lavoro! 🎉',
  },
  expense_logged: {
    en: '💰 Logged: {amount} at {merchant} ({category})',
    'es': '💰 Registrado: {amount} en {merchant} ({category})',
    'it': '💰 Registrato: {amount} da {merchant} ({category})',
  },
  expense_budget_warning: {
    en: '⚠️ Warning: You\'re at {percentage}% of your {category} budget ({spent}/{limit})',
    'es': '⚠️ Aviso: Estás al {percentage}% de tu presupuesto de {category} ({spent}/{limit})',
    'it': '⚠️ Attenzione: Sei al {percentage}% del tuo budget {category} ({spent}/{limit})',
  },
  expense_over_budget: {
    en: '🚨 Over budget! {category}: {spent}/{limit}',
    'es': '🚨 ¡Presupuesto excedido! {category}: {spent}/{limit}',
    'it': '🚨 Budget superato! {category}: {spent}/{limit}',
  },
  expense_need_amount: {
    en: 'Please include an amount, e.g. "$25 coffee at Starbucks"',
    'es': 'Incluye un monto, ej. "$25 café en Starbucks"',
    'it': 'Includi un importo, es. "$25 caffè da Starbucks"',
  },
  action_cancelled: {
    en: '👍 No problem, I cancelled that action.',
    'es': '👍 Sin problema, cancelé esa acción.',
    'it': '👍 Nessun problema, ho annullato quell\'azione.',
  },
  confirm_unclear: {
    en: 'I didn\'t understand. Please reply "yes" to confirm or "no" to cancel.',
    'es': 'No entendí. Responde "sí" para confirmar o "no" para cancelar.',
    'it': 'Non ho capito. Rispondi "sì" per confermare o "no" per annullare.',
  },
  priority_updated: {
    en: '{emoji} Updated! "{task}" is now {priority} priority.',
    'es': '{emoji} ¡Actualizado! "{task}" ahora tiene prioridad {priority}.',
    'it': '{emoji} Aggiornato! "{task}" ora ha priorità {priority}.',
  },
  error_generic: {
    en: 'Sorry, something went wrong. Please try again.',
    'es': 'Lo siento, algo salió mal. Inténtalo de nuevo.',
    'it': 'Mi dispiace, qualcosa è andato storto. Riprova.',
  },
  help_text: {
    en: `🫒 *Olive Quick Commands*

*Shortcuts:*
+ New task: +Buy milk tomorrow
! Urgent: !Call doctor now
$ Expense: $45 lunch at Chipotle
? Search: ?groceries
/ Chat: /what should I focus on?
@ Assign: @partner pick up kids

*Natural language also works:*
• Just send any text to save a task
• "done with X" to complete tasks
• "what's urgent?" to see priorities
• "summarize my week" for insights

🔗 Manage: https://witholive.app`,
    'es': `🫒 *Comandos Rápidos de Olive*

*Atajos:*
+ Nueva tarea: +Comprar leche mañana
! Urgente: !Llamar al doctor
$ Gasto: $45 almuerzo en Chipotle
? Buscar: ?compras
/ Chat: /¿en qué debo enfocarme?
@ Asignar: @pareja recoger niños

*También funciona lenguaje natural:*
• Envía cualquier texto para guardar una tarea
• "hecho con X" para completar tareas
• "¿qué es urgente?" para ver prioridades
• "resumen de mi semana" para insights

🔗 Gestionar: https://witholive.app`,
    'it': `🫒 *Comandi Rapidi di Olive*

*Scorciatoie:*
+ Nuova attività: +Comprare latte domani
! Urgente: !Chiamare il dottore
$ Spesa: $45 pranzo da Chipotle
? Cerca: ?spesa
/ Chat: /su cosa dovrei concentrarmi?
@ Assegna: @partner prendere i bambini

*Funziona anche il linguaggio naturale:*
• Invia qualsiasi testo per salvare un'attività
• "fatto con X" per completare attività
• "cosa è urgente?" per vedere priorità
• "riassunto della settimana" per approfondimenti

🔗 Gestisci: https://witholive.app`,
  },
};

function t(key: string, lang: string, vars?: Record<string, string>): string {
  // Normalize language code: es-ES → es, it-IT → it, en → en
  const shortLang = lang.split('-')[0];
  const template = RESPONSES[key]?.[lang] || RESPONSES[key]?.[shortLang] || RESPONSES[key]?.['en'] || key;
  if (!vars) return template;
  return Object.entries(vars).reduce((s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, 'g'), v), template);
}

// ============================================================================
// RECENT OUTBOUND CONTEXT HELPERS
// ============================================================================

/**
 * Fetch recent outbound messages sent to this user (last 60 min)
 * Combines olive_outbound_queue + olive_heartbeat_log for full picture
 */
async function getRecentOutboundMessages(supabase: any, userId: string): Promise<RecentOutbound[]> {
  const sixtyMinAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const results: RecentOutbound[] = [];

  try {
    // PRIMARY SOURCE: Read last_outbound_context from clerk_profiles
    // This is the most reliable source — stored directly by the gateway after sending
    const { data: profile, error: profileErr } = await supabase
      .from('clerk_profiles')
      .select('last_outbound_context')
      .eq('id', userId)
      .single();

    if (profileErr) {
      console.log('[Context] Profile query error:', profileErr.message);
    }

    if (profile?.last_outbound_context) {
      const ctx = profile.last_outbound_context;
      const sentAt = ctx.sent_at || '';
      // Only use if sent within last 60 minutes
      if (sentAt && new Date(sentAt).getTime() > Date.now() - 60 * 60 * 1000) {
        console.log('[Context] Found outbound context in profile:', ctx.message_type, ctx.content?.substring(0, 80));
        results.push({
          type: ctx.message_type || 'unknown',
          content: ctx.content || '',
          sent_at: sentAt,
          source: 'queue',
        });
      } else {
        console.log('[Context] Profile outbound context is stale (>60min)');
      }
    } else {
      console.log('[Context] No last_outbound_context in profile');
    }

    // SECONDARY: Also check olive_outbound_queue and olive_heartbeat_log (may be empty)
    if (results.length === 0) {
      const { data: queueMsgs } = await supabase
        .from('olive_outbound_queue')
        .select('message_type, content, message, sent_at')
        .eq('user_id', userId)
        .eq('status', 'sent')
        .gte('sent_at', sixtyMinAgo)
        .order('sent_at', { ascending: false })
        .limit(3);

      if (queueMsgs) {
        for (const msg of queueMsgs) {
          results.push({
            type: msg.message_type || 'unknown',
            content: msg.content || msg.message || '',
            sent_at: msg.sent_at,
            source: 'queue',
          });
        }
      }

      const { data: heartbeatMsgs } = await supabase
        .from('olive_heartbeat_log')
        .select('job_type, message_preview, created_at')
        .eq('user_id', userId)
        .eq('status', 'sent')
        .gte('created_at', sixtyMinAgo)
        .order('created_at', { ascending: false })
        .limit(3);

      if (heartbeatMsgs) {
        for (const msg of heartbeatMsgs) {
          results.push({
            type: msg.job_type || 'unknown',
            content: msg.message_preview || '',
            sent_at: msg.created_at,
            source: 'heartbeat',
          });
        }
      }
    }
  } catch (e) {
    console.log('[Context] Could not fetch recent outbound:', e);
  }

  // Sort by most recent first
  results.sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());
  return results.slice(0, 5);
}

/**
 * Extract task summary/name from a recent outbound message
 * Parses reminder, briefing, and nudge formats
 */
function extractTaskFromOutbound(message: RecentOutbound): string | null {
  const content = message.content;
  if (!content) return null;

  // Reminder: "⏰ Reminder: "Answer email from CHAI" is due in 24 hours"
  const reminderMatch = content.match(/Reminder:\s*"?([^"""\n]+)"?/i);
  if (reminderMatch) return reminderMatch[1].trim();

  // Reminder alt: "⏰ Reminder: Answer email from CHAI"
  const reminderAlt = content.match(/^⏰\s*Reminder:\s*(.+?)(?:\n|$)/i);
  if (reminderAlt) return reminderAlt[1].replace(/is due.*$/i, '').replace(/["""]/g, '').trim();

  // Nudge: "• Buy Christmas gifts\n"
  const nudgeMatch = content.match(/•\s*(.+?)(?:\n|$)/);
  if (nudgeMatch) return nudgeMatch[1].trim();

  // Briefing numbered: "1. Buy groceries 🔥"
  const briefingMatch = content.match(/\d+\.\s*(.+?)(?:\s*🔥)?\s*(?:\n|$)/);
  if (briefingMatch) return briefingMatch[1].trim();

  return null;
}

// Task action types for management commands
type TaskActionType = 
  | 'complete'      // "done with X", "mark X complete"
  | 'set_priority'  // "make X urgent", "prioritize X"
  | 'set_due'       // "X is due tomorrow"
  | 'assign'        // "assign X to partner"
  | 'edit'          // "change X to Y", "rename X"
  | 'delete'        // "delete X", "remove X"
  | 'move'          // "move X to groceries list"
  | 'remind';       // "remind me about X tomorrow"

type QueryType = 'urgent' | 'today' | 'tomorrow' | 'this_week' | 'recent' | 'overdue' | 'general' | undefined;

// Chat subtypes for specialized AI handling
type ChatType = 
  | 'briefing'            // "good morning olive", "morning briefing", "start my day"
  | 'weekly_summary'      // "summarize my week", "how was my week"
  | 'daily_focus'         // "what should I focus on", "prioritize my day"
  | 'productivity_tips'   // "give me tips", "help me be productive"
  | 'progress_check'      // "how am I doing", "my progress"
  | 'motivation'          // "motivate me", "I'm stressed"
  | 'planning'            // "help me plan", "what's next"
  | 'greeting'            // "hi", "hello"
  | 'help'                // "what can you do", "help"
  | 'general';            // Catch-all for other questions

// ============================================================================
// TEXT NORMALIZATION - Handle iOS/Android typographic characters
// ============================================================================
function normalizeText(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201B\u0060\u00B4]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u00A0]/g, ' ');
}

// ============================================================================
// CHAT TYPE DETECTION - Classify conversational queries
// ============================================================================
function detectChatType(message: string): ChatType {
  const lower = message.toLowerCase();
  
  // Briefing patterns - comprehensive morning overview (today AND tomorrow)
  if (/\b(morning\s+)?briefing\b/i.test(lower) ||
      /\bstart\s+my\s+day\b/i.test(lower) ||
      /\bmy\s+day\s+ahead\b/i.test(lower) ||
      /\bgive\s+me\s+(a\s+)?(rundown|quick\s+update|update|overview|snapshot|recap)\b/i.test(lower) ||
      /\b(what'?s|whats)\s+(on\s+)?(my\s+)?(schedule|agenda|calendar|day|plate)\s*(today|for today|tomorrow|for tomorrow)?\b/i.test(lower) ||
      /\b(what'?s|whats)\s+(for|on)\s+(today|tomorrow)\b/i.test(lower) ||
      /\b(what|which)\s+(tasks?|things?|items?)\s+(are|do i have)\s+(on|for|due)\s+(my\s+)?(day|today|tomorrow)\b/i.test(lower) ||
      /\b(my|the)\s+(agenda|schedule|plan)\s+(for\s+)?(today|tomorrow)\b/i.test(lower) ||
      /\bgood\s+morning\s+olive\b/i.test(lower) ||
      /\bmorning\s+olive\b/i.test(lower) ||
      /\bbrief\s+me\b/i.test(lower) ||
      /\bdaily\s+briefing\b/i.test(lower) ||
      /\bcatch\s+me\s+up\b/i.test(lower) ||
      /\bquick\s+update\b/i.test(lower) ||
      /\bwhat\s+do\s+i\s+need\s+to\s+know\b/i.test(lower) ||
      /\bwhat('?s| is)\s+happening\s+(today|tomorrow|this week)\b/i.test(lower) ||
      /\bgive\s+me\s+(the\s+)?highlights\b/i.test(lower)) {
    return 'briefing';
  }
  
  // Weekly summary patterns
  if (/\b(summarize|recap|review)\s+(my\s+)?(week|weekly|past\s+7|last\s+7)/i.test(lower) ||
      /\b(how\s+was|how'?s)\s+(my\s+)?week/i.test(lower) ||
      /\bweek(ly)?\s+(summary|recap|review)/i.test(lower) ||
      /\bwhat\s+did\s+i\s+(do|accomplish|complete)\s+(this|last)\s+week/i.test(lower) ||
      /\b(anything|something|what'?s?)\s+(important|big|notable)\s+(this|for the)\s+week\b/i.test(lower) ||
      /\bwhat('?s| is)\s+(coming\s+up|ahead)\s+(this\s+week|for the week)\b/i.test(lower) ||
      /\bhow('?s| is)\s+(this|the)\s+week\s+(looking|going|shaping)\b/i.test(lower)) {
    return 'weekly_summary';
  }
  
  // Daily focus patterns
  if (/\b(what\s+should\s+i|help\s+me)\s+(focus|prioritize|work)\s+on/i.test(lower) ||
      /\b(prioritize|plan)\s+(my\s+)?(day|today)/i.test(lower) ||
      /\bwhat'?s?\s+(most\s+)?important\s+today/i.test(lower) ||
      /\bfocus\s+(for\s+)?today/i.test(lower) ||
      /\bwhat\s+first\b/i.test(lower) ||
      /\bwhere\s+should\s+i\s+start/i.test(lower) ||
      /\bwhat\s+do\s+i\s+need\s+to\s+(focus|work)\s+on\b/i.test(lower) ||
      /\bwhat('?s| is)\s+(the\s+)?top\s+priority\b/i.test(lower) ||
      /\bwhat\s+matters\s+most\b/i.test(lower) ||
      /\bmy\s+priorities\b/i.test(lower) ||
      /\bwhat\s+should\s+i\s+tackle\b/i.test(lower)) {
    return 'daily_focus';
  }
  
  // Productivity tips patterns
  if (/\b(productivity|efficiency)\s+(tips?|advice|suggestions?)/i.test(lower) ||
      /\bgive\s+me\s+(some\s+)?(tips?|advice|suggestions?)/i.test(lower) ||
      /\bhow\s+(can\s+i|to)\s+be\s+(more\s+)?(productive|efficient|organized)/i.test(lower) ||
      /\bhelp\s+me\s+(be|get)\s+(more\s+)?(productive|organized|efficient)/i.test(lower)) {
    return 'productivity_tips';
  }
  
  // Progress check patterns
  if (/\bhow\s+am\s+i\s+doing/i.test(lower) ||
      /\b(my|check)\s+(progress|status|stats)/i.test(lower) ||
      /\bhow\s+productive\s+(am\s+i|have\s+i\s+been)/i.test(lower) ||
      /\bam\s+i\s+on\s+track/i.test(lower) ||
      /\bhow\s+(are|am)\s+(we|i)\s+doing\b/i.test(lower)) {
    return 'progress_check';
  }
  
  // Motivation patterns
  if (/\b(motivate|encourage|inspire)\s+me/i.test(lower) ||
      /\bi'?m\s+(stressed|overwhelmed|anxious|tired|exhausted)/i.test(lower) ||
      /\b(feeling|feel)\s+(down|bad|stressed|overwhelmed)/i.test(lower) ||
      /\bneed\s+(some\s+)?(motivation|encouragement)/i.test(lower) ||
      /\btoo\s+much\s+to\s+do/i.test(lower)) {
    return 'motivation';
  }
  
  // Planning patterns
  if (/\bhelp\s+me\s+plan/i.test(lower) ||
      /\bwhat'?s?\s+next\b/i.test(lower) ||
      /\bplan\s+(my|the)\s+(day|week|tomorrow)/i.test(lower) ||
      /\bwhat\s+should\s+i\s+do\s+(next|now|after)/i.test(lower) ||
      /\bwhat('?s| is)\s+the\s+plan\b/i.test(lower) ||
      /\bwhat('?s| is)\s+(on\s+)?(the|my)\s+plate\b/i.test(lower)) {
    return 'planning';
  }
  
  // Greeting patterns
  if (/^(hi|hello|hey|good\s*(morning|afternoon|evening)|thanks|thank\s*you)\b/i.test(lower) ||
      /^(how\s+are\s+you|how'?s\s+it\s+going)/i.test(lower)) {
    return 'greeting';
  }
  
  // Help patterns
  if (/^(who\s+are\s+you|what\s+can\s+you\s+do|help\b|commands)/i.test(lower) ||
      /\bwhat\s+are\s+your\s+(features|capabilities)/i.test(lower)) {
    return 'help';
  }
  
  return 'general';
}

// ============================================================================
// CONVERSATIONAL CONTEXT - Types, pronoun detection, TTL
// ============================================================================

interface ConversationContext {
  pending_action?: any; // existing, for AWAITING_CONFIRMATION
  last_referenced_entity?: {
    type: 'task' | 'event';
    id: string;
    summary: string;
    due_date?: string;
    list_id?: string;
    priority?: string;
  };
  entity_referenced_at?: string; // ISO timestamp for TTL
  conversation_history?: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }>;
  // Numbered list tracking for ordinal references ("the first one", "the third one")
  last_displayed_list?: Array<{ id: string; summary: string; position: number }>;
  list_displayed_at?: string; // ISO timestamp for TTL
}

// ============================================================================
// AI-POWERED INTENT CLASSIFICATION
// Replaces regex-based determineIntent() with Gemini structured output
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

const intentClassificationSchema = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      enum: ['search', 'create', 'complete', 'set_priority', 'set_due', 'delete', 'move', 'assign', 'remind', 'expense', 'chat', 'contextual_ask', 'merge'],
    },
    target_task_id: { type: Type.STRING, nullable: true },
    target_task_name: { type: Type.STRING, nullable: true },
    matched_skill_id: { type: Type.STRING, nullable: true },
    parameters: {
      type: Type.OBJECT,
      properties: {
        priority: { type: Type.STRING, nullable: true },
        due_date_expression: { type: Type.STRING, nullable: true },
        query_type: { type: Type.STRING, nullable: true, enum: ['urgent', 'today', 'tomorrow', 'this_week', 'recent', 'overdue', 'general'] },
        chat_type: { type: Type.STRING, nullable: true, enum: ['briefing', 'weekly_summary', 'daily_focus', 'productivity_tips', 'progress_check', 'motivation', 'planning', 'greeting', 'general'] },
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

async function classifyIntent(
  message: string,
  conversationHistory: Array<{ role: string; content: string; timestamp: string }>,
  recentOutboundMessages: string[],
  activeTasks: Array<{ id: string; summary: string; due_date: string | null; priority: string }>,
  userMemories: Array<{ title: string; content: string; category: string }>,
  activatedSkills: Array<{ skill_id: string; name: string }>,
  userLanguage: string
): Promise<ClassifiedIntent | null> {
  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GEMINI_API');
  if (!GEMINI_API_KEY) {
    console.warn('[classifyIntent] No GEMINI_API_KEY or GEMINI_API, falling back to regex');
    return null;
  }

  try {
    const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // Build conversation context (last 3 exchanges)
    const recentConvo = conversationHistory.slice(-6).map(msg =>
      `${msg.role === 'user' ? 'User' : 'Olive'}: ${msg.content}`
    ).join('\n');

    // Build task list (compact)
    const taskList = activeTasks.slice(0, 30).map(t =>
      `- [${t.id}] "${t.summary}" (due: ${t.due_date || 'none'}, priority: ${t.priority})`
    ).join('\n');

    // Build memory context (compact)
    const memoryList = userMemories.slice(0, 10).map(m =>
      `- [${m.category}] ${m.title}: ${m.content}`
    ).join('\n');

    // Build skills context (just names)
    const skillsList = activatedSkills.map(s => `- ${s.skill_id}: ${s.name}`).join('\n');

    // Build outbound context
    const outboundCtx = recentOutboundMessages.slice(0, 3).map(m => `- Olive said: "${m}"`).join('\n');

    const systemPrompt = `You are an intent classifier for Olive, a personal task assistant. Classify the user's WhatsApp message into exactly ONE intent. Return structured JSON.

## INTENTS:
- "search": User wants to see/find/list tasks (e.g., "what's urgent?", "show my tasks", "what's due today?")
- "create": User wants to create a new task/note (e.g., "buy milk", "call mom tomorrow")
- "complete": User wants to mark a task as done (e.g., "done with groceries", "finish the report")
- "set_priority": User wants to change a task's priority (e.g., "make it urgent", "set it to low priority")
- "set_due": User wants to change a task's due date/time (e.g., "change it to 7:30 AM", "postpone to Friday")
- "delete": User wants to remove a task (e.g., "delete the dentist task", "remove it")
- "move": User wants to move a task to a different list (e.g., "move it to groceries")
- "assign": User wants to assign a task to someone (e.g., "assign it to my partner")
- "remind": User wants to set a reminder (e.g., "remind me at 5 PM")
- "expense": User wants to log an expense (e.g., "spent $45 on dinner", "log $20 for gas")
- "chat": User wants to chat with Olive (e.g., "morning briefing", "give me tips", "how am I doing?")
- "contextual_ask": User is asking a question about their data (e.g., "when is dental?", "what did I save about restaurants?")
- "merge": User wants to merge recent tasks (exactly "merge")

## RULES:
1. Use CONVERSATION HISTORY to resolve pronouns ("it", "that", "this", "lo", "eso", "quello"). If the user says "change it to 7 AM" after discussing "Dental Milka", the target is "Dental Milka".
2. Use ACTIVE TASKS to identify which task the user refers to. Return the exact task UUID in target_task_id when you can match with high confidence.
3. Use MEMORIES to understand personal context: names, places, preferences, relationships. E.g., if memories mention "Milka is my dog", then "dental Milka" is a vet appointment.
4. If the user references a list name from memories, set list_name in parameters.
5. Use ACTIVATED SKILLS to detect domain-specific intents. If the message aligns with an activated skill, return its skill_id in matched_skill_id. Only match skills the user has enabled. Do NOT force skill matches.
6. For time/date expressions, preserve the EXACT user phrasing in due_date_expression (e.g., "7.30am", "tomorrow at 3 PM", "next Friday").
7. For expenses, extract amount and description from the message.
8. For search queries, set query_type based on what the user is looking for.
9. For chat messages, set chat_type based on the conversation style.
10. If the message is a new thought, idea, or brain-dump with no action intent, classify as "create".
11. Confidence: 0.9+ for clear intents, 0.7-0.9 for moderate confidence, 0.5-0.7 for uncertain.
12. The user's language is: ${userLanguage}. Understand messages in this language natively.
13. Messages containing "change", "modify", "update", "reschedule", "move" + a time/date expression should ALMOST ALWAYS be "set_due", not "create" or "chat". The word "change" implies modifying an existing entity, not creating a new one. E.g., "change it in the calendar at 7.30am" = "set_due", "move the appointment to Friday" = "set_due".
14. When the user says "change it to X" or "can you change it to X" after discussing a specific task, ALWAYS classify as "set_due" with the target being the previously discussed task. This is NOT a "chat" or "create" intent.

## CONVERSATION HISTORY:
${recentConvo || 'No previous conversation.'}

## RECENT OLIVE MESSAGES:
${outboundCtx || 'None.'}

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
    console.log('[classifyIntent] Raw response:', responseText);

    const result: ClassifiedIntent = JSON.parse(responseText);
    console.log(`[classifyIntent] intent=${result.intent}, confidence=${result.confidence}, task_id=${result.target_task_id}, skill=${result.matched_skill_id}, reasoning=${result.reasoning}`);

    return result;
  } catch (error) {
    console.error('[classifyIntent] Error, falling back to regex:', error);
    return null;
  }
}

// Bridge: Convert AI ClassifiedIntent → existing IntentResult format
function mapAIResultToIntentResult(
  ai: ClassifiedIntent
): IntentResult & { queryType?: string; chatType?: string; actionType?: string; actionTarget?: string; cleanMessage?: string; _aiTaskId?: string; _aiSkillId?: string } {
  const params = ai.parameters || {};

  switch (ai.intent) {
    case 'search':
      return {
        intent: 'SEARCH',
        queryType: params.query_type || 'general',
        cleanMessage: ai.target_task_name || undefined,
        _listName: params.list_name || undefined,
      };

    case 'complete':
      return {
        intent: 'TASK_ACTION',
        actionType: 'complete',
        actionTarget: ai.target_task_name || undefined,
        _aiTaskId: ai.target_task_id || undefined,
        _aiSkillId: ai.matched_skill_id || undefined,
      };

    case 'set_priority':
      return {
        intent: 'TASK_ACTION',
        actionType: 'set_priority',
        actionTarget: ai.target_task_name || undefined,
        cleanMessage: params.priority || undefined,
        _aiTaskId: ai.target_task_id || undefined,
        _aiSkillId: ai.matched_skill_id || undefined,
      };

    case 'set_due':
      return {
        intent: 'TASK_ACTION',
        actionType: 'set_due',
        actionTarget: ai.target_task_name || undefined,
        cleanMessage: params.due_date_expression || undefined,
        _aiTaskId: ai.target_task_id || undefined,
        _aiSkillId: ai.matched_skill_id || undefined,
      };

    case 'delete':
      return {
        intent: 'TASK_ACTION',
        actionType: 'delete',
        actionTarget: ai.target_task_name || undefined,
        _aiTaskId: ai.target_task_id || undefined,
        _aiSkillId: ai.matched_skill_id || undefined,
      };

    case 'move':
      return {
        intent: 'TASK_ACTION',
        actionType: 'move',
        actionTarget: ai.target_task_name || undefined,
        cleanMessage: params.list_name || undefined,
        _aiTaskId: ai.target_task_id || undefined,
        _aiSkillId: ai.matched_skill_id || undefined,
      };

    case 'assign':
      return {
        intent: 'TASK_ACTION',
        actionType: 'assign',
        actionTarget: ai.target_task_name || undefined,
        _aiTaskId: ai.target_task_id || undefined,
        _aiSkillId: ai.matched_skill_id || undefined,
      };

    case 'remind':
      return {
        intent: 'TASK_ACTION',
        actionType: 'set_due',
        actionTarget: ai.target_task_name || undefined,
        cleanMessage: params.due_date_expression || undefined,
        _aiTaskId: ai.target_task_id || undefined,
        _aiSkillId: ai.matched_skill_id || undefined,
      };

    case 'expense':
      return {
        intent: 'EXPENSE',
        cleanMessage: params.expense_description
          ? `${params.amount ? '$' + params.amount + ' ' : ''}${params.expense_description}`
          : undefined,
        _aiSkillId: ai.matched_skill_id || undefined,
      };

    case 'chat':
      return {
        intent: 'CHAT',
        chatType: params.chat_type || 'general',
        _aiSkillId: ai.matched_skill_id || undefined,
      };

    case 'contextual_ask':
      return {
        intent: 'CONTEXTUAL_ASK',
        cleanMessage: ai.target_task_name || undefined,
        _aiSkillId: ai.matched_skill_id || undefined,
      };

    case 'merge':
      return { intent: 'MERGE' };

    case 'create':
    default:
      return {
        intent: 'CREATE',
        isUrgent: params.is_urgent || false,
        _aiSkillId: ai.matched_skill_id || undefined,
      };
  }
}

// NOTE: detectPronounReference() and isContextExpired() were removed —
// AI-powered classifyIntent() handles pronoun resolution natively via
// conversation history + memories in the prompt. No regex needed.

function determineIntent(message: string, hasMedia: boolean): IntentResult & { queryType?: QueryType; chatType?: ChatType; actionType?: TaskActionType; actionTarget?: string } {
  const trimmed = message.trim();
  const normalized = normalizeText(trimmed);
  const lower = normalized.toLowerCase();
  
  console.log('[Intent Detection] Original:', trimmed);
  console.log('[Intent Detection] Normalized:', normalized);
  
  // ============================================================================
  // QUICK-SEARCH SYNTAX - Power user shortcuts
  // ============================================================================
  
  // Config-driven shortcut system
  const firstChar = normalized.charAt(0);
  if (SHORTCUTS[firstChar]) {
    const shortcut = SHORTCUTS[firstChar];
    console.log(`[Intent Detection] Matched: ${firstChar} prefix (${shortcut.label})`);
    return {
      intent: shortcut.intent as any,
      cleanMessage: normalized.slice(1).trim(),
      ...(shortcut.options || {}),
    };
  }
  
  // MERGE: exact match only
  if (lower === 'merge') {
    console.log('[Intent Detection] Matched: merge command');
    return { intent: 'MERGE' };
  }
  
  const isQuestion = lower.endsWith('?') || /^(what|where|when|who|how|why|can|do|does|is|are|which|any|recommend|suggest|so\s+what)\b/i.test(lower);
  
  // ============================================================================
  // QUESTION EARLY-EXIT: Skip task action patterns for questions.
  // ============================================================================
  if (!isQuestion) {
  // ============================================================================
  // TASK ACTION PATTERNS - Edit, complete, prioritize, assign
  // ============================================================================
  
  // Complete/Done patterns
  // First check if it's JUST "done!", "completed!", "finished!" with no task name
  // These bare completions need context awareness, so skip them if there's no target
  const bareCompletionMatch = lower.match(/^(?:done|complete|completed|finished|did it|got it)[!.]*$/i);
  if (bareCompletionMatch) {
    console.log('[Intent Detection] Matched: bare completion (no task target)');
    // Return TASK_ACTION with empty target — the handler will try context fallback
    return { intent: 'TASK_ACTION', actionType: 'complete', actionTarget: '' };
  }

  const completeMatch = lower.match(/^(?:done|complete|completed|finished|mark(?:ed)?\s+(?:it\s+)?(?:as\s+)?(?:done|complete)|checked? off)\s*(?:with\s+)?(?:the\s+)?(.+)?$/i);
  if (completeMatch) {
    const target = completeMatch[1]?.replace(/[!.]+$/, '').trim();
    console.log('[Intent Detection] Matched: complete action, target:', target);
    return { intent: 'TASK_ACTION', actionType: 'complete', actionTarget: target || '' };
  }
  
  // Priority patterns
  const priorityMatch = lower.match(/^(?:make|set|mark)\s+(.+?)\s+(?:as\s+)?(?:urgent|high\s*(?:priority)?|important|priority|low\s*(?:priority)?)/i) ||
                        lower.match(/^(?:prioritize|urgent)\s+(.+)/i);
  if (priorityMatch) {
    console.log('[Intent Detection] Matched: set priority action');
    return { intent: 'TASK_ACTION', actionType: 'set_priority', actionTarget: priorityMatch[1]?.trim() };
  }
  
  // Due date patterns
  const dueMatch = lower.match(/^(?:set|make|move)\s+(.+?)\s+(?:is\s+)?(?:due|for)\s+(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+week|\d+.+)/i) ||
                   lower.match(/^(.+?)\s+is\s+due\s+(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+week|\d+.+)/i);
  if (dueMatch) {
    console.log('[Intent Detection] Matched: set due date action');
    return { intent: 'TASK_ACTION', actionType: 'set_due', actionTarget: dueMatch[1]?.trim(), cleanMessage: dueMatch[2] };
  }

  // "Change/modify/update it to [time]" or "change it in the calendar at [time]" patterns
  // These should ALWAYS be set_due, not create. "Change" implies modifying existing, not creating new.
  const changeTimeMatch = lower.match(/^(?:can\s+you\s+)?(?:change|modify|update|reschedule|move)\s+(?:it\s+)?(?:to|at|in\s+(?:the\s+)?calendar\s*(?:to|at|for)?)\s*(.+)/i);
  if (changeTimeMatch) {
    console.log('[Intent Detection] Matched: change time pattern →', changeTimeMatch[1]);
    return { intent: 'TASK_ACTION', actionType: 'set_due', actionTarget: '', cleanMessage: changeTimeMatch[1] };
  }

  // "Postpone/delay X to [time]" patterns
  const postponeMatch = lower.match(/^(?:postpone|delay|push\s+back|push)\s+(?:it\s+)?(?:to|until|till)\s*(.+)/i);
  if (postponeMatch) {
    console.log('[Intent Detection] Matched: postpone pattern →', postponeMatch[1]);
    return { intent: 'TASK_ACTION', actionType: 'set_due', actionTarget: '', cleanMessage: postponeMatch[1] };
  }

  // Assign patterns
  const assignMatch = lower.match(/^(?:assign|give)\s+(.+?)\s+to\s+(partner|.+)/i);
  if (assignMatch) {
    console.log('[Intent Detection] Matched: assign action');
    return { intent: 'TASK_ACTION', actionType: 'assign', actionTarget: assignMatch[1]?.trim(), cleanMessage: assignMatch[2] };
  }
  
  // Delete patterns
  const deleteMatch = lower.match(/^(?:delete|remove|cancel)\s+(?:the\s+)?(?:task\s+)?(.+)/i);
  if (deleteMatch) {
    console.log('[Intent Detection] Matched: delete action');
    return { intent: 'TASK_ACTION', actionType: 'delete', actionTarget: deleteMatch[1]?.trim() };
  }
  
  // Move to list patterns
  const moveMatch = lower.match(/^(?:move|add)\s+(.+?)\s+to\s+(.+?)(?:\s+list)?$/i);
  if (moveMatch) {
    console.log('[Intent Detection] Matched: move action');
    return { intent: 'TASK_ACTION', actionType: 'move', actionTarget: moveMatch[1]?.trim(), cleanMessage: moveMatch[2] };
  }
  
  // Remind patterns
  const remindMatch = lower.match(/^(?:remind\s+(?:me|us)\s+(?:about\s+)?|set\s+(?:a\s+)?reminder\s+(?:for\s+)?)(.+)/i);
  if (remindMatch) {
    console.log('[Intent Detection] Matched: remind action');
    return { intent: 'TASK_ACTION', actionType: 'remind', actionTarget: remindMatch[1]?.trim() };
  }

  } // end !isQuestion guard
  
  // ============================================================================
  // CONTEXTUAL SEARCH PATTERNS - Semantic questions needing AI understanding
  // ============================================================================
  
  const contextualPatterns = [
    /\b(?:any|good|best|recommend|suggest|ideas?\s+for|options?\s+for)\b.*\b(?:in\s+my|from\s+my|saved)\b/i,
    /\bwhat\s+(?:books?|restaurants?|movies?|shows?|recipes?|ideas?|places?|items?)\s+(?:do\s+i|did\s+i|have\s+i)\s+(?:have|save)/i,
    /\bwhat(?:'s|s)?\s+(?:in\s+my|on\s+my)\b.*\b(?:list|saved|wishlist|reading|watch|bucket)/i,
    /\b(?:find|search|look)\s+(?:for\s+)?(?:something|anything)\b.*\b(?:in\s+my|from\s+my)\b/i,
    /\b(?:recommend|suggest)\s+(?:something|anything|a)\b.*\b(?:from|based on|in)\s+my\b/i,
    /\b(?:help\s+me\s+(?:find|pick|choose))\b.*\b(?:from\s+my|in\s+my)\b/i,
    /\bdo\s+i\s+have\s+(?:any|a)\b.*\b(?:saved|in\s+my\s+list)/i,
    /\b(?:what|which)\s+(?:restaurant|book|movie|place|idea)\s+(?:should|would)\s+(?:i|we)\b/i,
    /\bany\s+(?:restaurants?|books?|movies?|ideas?|recommendations?|suggestions?|places?|recipes?)\b.*(?:for|about|from)\b/i,
  ];
  
  if (contextualPatterns.some(p => p.test(lower)) && isQuestion) {
    console.log('[Intent Detection] Matched: CONTEXTUAL_ASK (semantic question about saved items)');
    return { intent: 'CONTEXTUAL_ASK', cleanMessage: normalized };
  }
  
  // ============================================================================
  // SIMPLE SEARCH PATTERNS - Listing items without semantic understanding
  // ============================================================================
  
  if (/what'?s?\s+(is\s+)?urgent/i.test(lower) || 
      /urgent\s*\?$/i.test(lower) || 
      /urgent\s+tasks?/i.test(lower) ||
      (lower.includes('urgent') && isQuestion)) {
    console.log('[Intent Detection] Matched: urgent query pattern');
    return { intent: 'SEARCH', queryType: 'urgent' };
  }
  
  if (/what'?s?\s+(on\s+my\s+day|due\s+today|for\s+today)/i.test(lower) || 
      /today'?s?\s+tasks?/i.test(lower) ||
      /due\s+today/i.test(lower)) {
    console.log('[Intent Detection] Matched: today query pattern');
    return { intent: 'SEARCH', queryType: 'today' };
  }
  
  // Tomorrow queries
  if (/what'?s?\s+(?:on\s+)?(?:my\s+)?(?:day|agenda|schedule|calendar|plate|plan)?\s*(?:for\s+)?tomorrow/i.test(lower) ||
      /what'?s?\s+(?:due\s+)?tomorrow/i.test(lower) ||
      /what'?s?\s+for\s+tomorrow/i.test(lower) ||
      /tomorrow'?s?\s+(?:tasks?|agenda|schedule|plan)/i.test(lower) ||
      /due\s+tomorrow/i.test(lower) ||
      /\b(?:what|which)\s+(?:tasks?|things?|items?)\s+.*(?:tomorrow|for\s+tomorrow)\b/i.test(lower) ||
      /\b(?:my|the)\s+(?:agenda|schedule|plan)\s+(?:for\s+)?tomorrow\b/i.test(lower) ||
      /\b(?:agenda|schedule|plan)\s+(?:for\s+)?tomorrow\b/i.test(lower) ||
      /\b(?:so\s+)?what(?:'s|s)?\s+(?:is\s+)?(?:on\s+)?(?:my\s+)?(?:agenda|schedule|calendar|day|plate|plan)\s+(?:for\s+)?(?:tomorrow)\b/i.test(lower)) {
    console.log('[Intent Detection] Matched: tomorrow query pattern');
    return { intent: 'SEARCH', queryType: 'tomorrow' };
  }
  
  // This week queries
  if (/\b(?:what'?s|whats)\s+(?:on\s+)?(?:my\s+)?(?:agenda|schedule|calendar|plan|plate)\s+(?:for\s+)?(?:this|the)\s+week\b/i.test(lower) ||
      /\b(?:anything|something|what'?s?)\s+(?:important|big|notable|coming\s+up)\s+(?:this|for the|for this)\s+week\b/i.test(lower) ||
      /\bthis\s+week(?:'?s)?\s+(?:tasks?|agenda|schedule|plan)\b/i.test(lower) ||
      /\bwhat(?:'s|s)?\s+(?:coming\s+up|ahead|happening)\s+(?:this\s+week|for the week)\b/i.test(lower) ||
      /\bhow(?:'s| is)\s+(?:this|the|my)\s+week\s+(?:looking|going|shaping)\b/i.test(lower) ||
      /\bweek\s+ahead\b/i.test(lower) ||
      /\bwhat\s+do\s+i\s+have\s+(?:this|for the|for this)\s+week\b/i.test(lower)) {
    console.log('[Intent Detection] Matched: this_week query pattern');
    return { intent: 'SEARCH', queryType: 'this_week' };
  }
  
  if (/what'?s?\s+recent/i.test(lower) || 
      /recent\s+tasks?/i.test(lower) || 
      /latest\s+tasks?/i.test(lower) ||
      /what\s+did\s+i\s+(add|save)/i.test(lower)) {
    console.log('[Intent Detection] Matched: recent query pattern');
    return { intent: 'SEARCH', queryType: 'recent' };
  }
  
  if (/what'?s?\s+overdue/i.test(lower) || 
      /overdue\s*\?$/i.test(lower) ||
      /overdue\s+tasks?/i.test(lower) ||
      (lower.includes('overdue') && isQuestion)) {
    console.log('[Intent Detection] Matched: overdue query pattern');
    return { intent: 'SEARCH', queryType: 'overdue' };
  }
  
  if (/what'?s?\s+pending/i.test(lower) || 
      /pending\s+tasks?/i.test(lower) ||
      (lower.includes('pending') && isQuestion)) {
    console.log('[Intent Detection] Matched: pending query pattern');
    return { intent: 'SEARCH', queryType: 'general' };
  }
  
  if (/what\s+(do\s+i\s+have|are\s+my\s+tasks?|tasks?\s+do\s+i)/i.test(lower)) {
    console.log('[Intent Detection] Matched: what do I have pattern');
    return { intent: 'SEARCH', queryType: 'general' };
  }
  
  // Simple list display commands
  const searchStarters = ['show', 'list', 'get'];
  if (searchStarters.some(s => lower.startsWith(s + ' ') || lower === s)) {
    console.log('[Intent Detection] Matched: search starter keyword');
    return { intent: 'SEARCH', queryType: 'general' };
  }
  
  // "Find" with specific list names = SEARCH
  if (/^find\s+(?:my\s+)?(\w+)\s+(?:list|tasks?)$/i.test(lower)) {
    console.log('[Intent Detection] Matched: find specific list pattern');
    return { intent: 'SEARCH', queryType: 'general' };
  }
  
  // "Search" command for specific items
  if (/^search\s+/i.test(lower)) {
    console.log('[Intent Detection] Matched: search command -> CONTEXTUAL_ASK');
    return { intent: 'CONTEXTUAL_ASK', cleanMessage: normalized };
  }
  
  // Simple "my tasks/list" queries
  if (/^(?:show\s+)?my\s+(tasks?|list|lists?|reminders?|items?|to-?do)$/i.test(lower)) {
    console.log('[Intent Detection] Matched: show my tasks pattern');
    return { intent: 'SEARCH', queryType: 'general' };
  }
  
  // Specific list requests
  if (/^(?:show|display|what'?s\s+(?:in|on))\s+(?:my\s+)?(\w+(?:\s+\w+)?)\s+(?:list|tasks?)$/i.test(lower)) {
    console.log('[Intent Detection] Matched: specific list request');
    return { intent: 'SEARCH', queryType: 'general' };
  }
  
  if (/^(how many|do i have|check my|see my)/i.test(lower)) {
    console.log('[Intent Detection] Matched: question about content');
    return { intent: 'SEARCH', queryType: 'general' };
  }
  
  // ============================================================================
  // CHAT INTENT - Conversational AI with subtype detection
  // ============================================================================
  if (isQuestion && !hasMedia) {
    const chatType = detectChatType(normalized);
    if (chatType === 'general') {
      console.log('[Intent Detection] General question -> CONTEXTUAL_ASK');
      return { intent: 'CONTEXTUAL_ASK', cleanMessage: normalized };
    }
    console.log('[Intent Detection] Matched: CHAT intent, type:', chatType);
    return { intent: 'CHAT', cleanMessage: normalized, chatType };
  }
  
  // Check for non-question chat patterns (statements that should trigger chat)
  const statementChatPatterns = [
    /^(hi|hello|hey)\b/i,
    /^good\s*(morning|afternoon|evening)(\s+olive)?\b/i,
    /^morning\s+olive\b/i,
    /^briefing\b/i,
    /^start\s+my\s+day\b/i,
    /^(motivate|encourage|inspire)\s+me/i,
    /\bi'?m\s+(stressed|overwhelmed|anxious)/i,
    /^(summarize|recap)\s+(my\s+)?week/i,
    /^plan\s+(my|the)\s+(day|week)/i,
    /^(prioritize|focus)\s+(my\s+)?/i,
    /^brief\s+me\b/i,
    /^catch\s+me\s+up\b/i,
    /^quick\s+update\b/i,
    /^give\s+me\s+(a\s+)?(quick\s+)?update\b/i,
    /^give\s+me\s+(the\s+)?highlights\b/i,
    /^give\s+me\s+(a\s+)?rundown\b/i
  ];
  
  if (statementChatPatterns.some(p => p.test(lower)) && !hasMedia) {
    const chatType = detectChatType(normalized);
    console.log('[Intent Detection] Matched: statement-based CHAT, type:', chatType);
    return { intent: 'CHAT', cleanMessage: normalized, chatType };
  }
  
  console.log('[Intent Detection] No pattern matched -> CREATE (default)');
  return { intent: 'CREATE' };
}

// Standardize phone number format - Meta sends raw numbers like "15551234567"
function standardizePhoneNumber(rawNumber: string): string {
  let cleaned = rawNumber.replace(/\D/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

/**
 * Format a date/time string into a friendly readable format
 * e.g. "Friday, February 20th at 12:00 PM"
 */
function formatFriendlyDate(dateStr: string, includeTime: boolean = true): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  const dayName = days[d.getUTCDay()];
  const monthName = months[d.getUTCMonth()];
  const dayNum = d.getUTCDate();
  const year = d.getUTCFullYear();

  // Ordinal suffix
  const suffix = (dayNum === 1 || dayNum === 21 || dayNum === 31) ? 'st'
    : (dayNum === 2 || dayNum === 22) ? 'nd'
    : (dayNum === 3 || dayNum === 23) ? 'rd' : 'th';

  let result = `${dayName}, ${monthName} ${dayNum}${suffix}`;

  // Include year if not current year
  const now = new Date();
  if (year !== now.getUTCFullYear()) {
    result += ` ${year}`;
  }

  // Include time if not midnight/noon placeholder
  if (includeTime) {
    const hours = d.getUTCHours();
    const minutes = d.getUTCMinutes();
    // Skip time display if it's exactly midnight (00:00) — likely date-only
    if (hours !== 0 || minutes !== 0) {
      const h12 = hours % 12 || 12;
      const ampm = hours < 12 ? 'AM' : 'PM';
      const minStr = minutes.toString().padStart(2, '0');
      result += ` at ${h12}:${minStr} ${ampm}`;
    }
  }

  return result;
}

// Call Lovable AI
async function callAI(systemPrompt: string, userMessage: string, temperature = 0.7): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature,
      max_tokens: 1000
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Lovable AI error:', response.status, errorText);
    throw new Error(`AI call failed: ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('No response from AI');
  return text;
}

// ============================================================================
// OLIVE SKILLS - Match and execute specialized skills based on triggers
// ============================================================================
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

async function matchUserSkills(
  supabase: any,
  userId: string,
  message: string,
  noteCategory?: string
): Promise<SkillMatch> {
  const lowerMessage = message.toLowerCase();
  
  try {
    const { data: userSkills } = await supabase
      .from('olive_user_skills')
      .select('skill_id, enabled')
      .eq('user_id', userId)
      .eq('enabled', true);
    
    const enabledSkillIds = new Set(userSkills?.map((s: any) => s.skill_id) || []);
    
    const { data: allSkills } = await supabase
      .from('olive_skills')
      .select('skill_id, name, content, category, triggers')
      .eq('is_active', true);
    
    if (!allSkills || allSkills.length === 0) {
      return { matched: false };
    }
    
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
              skill: {
                skill_id: skill.skill_id,
                name: skill.name,
                content: skill.content,
                category: skill.category || 'general'
              },
              trigger_type: 'keyword',
              matched_value: trigger.keyword
            };
          }
        }
        
        if (trigger.category && noteCategory) {
          if (noteCategory.toLowerCase() === trigger.category.toLowerCase()) {
            console.log(`[Skills] Matched skill "${skill.name}" via category "${trigger.category}"`);
            return {
              matched: true,
              skill: {
                skill_id: skill.skill_id,
                name: skill.name,
                content: skill.content,
                category: skill.category || 'general'
              },
              trigger_type: 'category',
              matched_value: trigger.category
            };
          }
        }
        
        if (trigger.command && lowerMessage.startsWith(trigger.command.toLowerCase())) {
          console.log(`[Skills] Matched skill "${skill.name}" via command "${trigger.command}"`);
          return {
            matched: true,
            skill: {
              skill_id: skill.skill_id,
              name: skill.name,
              content: skill.content,
              category: skill.category || 'general'
            },
            trigger_type: 'command',
            matched_value: trigger.command
          };
        }
      }
    }
    
    return { matched: false };
  } catch (error) {
    console.error('[Skills] Error matching skills:', error);
    return { matched: false };
  }
}

// Generate embedding for similarity search
async function generateEmbedding(text: string): Promise<number[] | null> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    console.error('LOVABLE_API_KEY not configured for embeddings');
    return null;
  }

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text
      })
    });

    if (!response.ok) {
      console.error('Embedding API error:', response.status);
      return null;
    }

    const data = await response.json();
    return data.data?.[0]?.embedding || null;
  } catch (error) {
    console.error('Error generating embedding:', error);
    return null;
  }
}

// ============================================================================
// META WHATSAPP CLOUD API - Send messages via Meta's direct API
// ============================================================================
async function sendWhatsAppReply(
  phoneNumberId: string,
  to: string,
  text: string,
  accessToken: string,
  mediaUrl?: string
): Promise<boolean> {
  try {
    const apiUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    
    let body: any;
    
    if (mediaUrl) {
      // Send image message
      body = {
        messaging_product: 'whatsapp',
        to,
        type: 'image',
        image: {
          link: mediaUrl,
          caption: text
        }
      };
    } else {
      // Send text message
      body = {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { 
          preview_url: true,
          body: text 
        }
      };
    }
    
    console.log('[Meta API] Sending message to:', to, 'length:', text.length);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Meta API] Send failed:', response.status, errorText);
      return false;
    }
    
    const result = await response.json();
    console.log('[Meta API] Message sent successfully, id:', result.messages?.[0]?.id);
    return true;
  } catch (error) {
    console.error('[Meta API] Error sending message:', error);
    return false;
  }
}

// Download media from Meta's API and upload to Supabase Storage
async function downloadAndUploadMetaMedia(
  mediaId: string,
  accessToken: string,
  supabase: any
): Promise<{ url: string; mimeType: string } | null> {
  try {
    // Step 1: Get the media URL from Meta
    const mediaInfoResponse = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    if (!mediaInfoResponse.ok) {
      console.error('[Meta Media] Failed to get media info:', mediaInfoResponse.status);
      const errText = await mediaInfoResponse.text();
      console.error('[Meta Media] Error:', errText);
      return null;
    }
    
    const mediaInfo = await mediaInfoResponse.json();
    const mediaDownloadUrl = mediaInfo.url;
    const mimeType = mediaInfo.mime_type || 'application/octet-stream';
    
    console.log('[Meta Media] Downloading from:', mediaDownloadUrl, 'type:', mimeType);
    
    // Step 2: Download the actual media file
    const mediaResponse = await fetch(mediaDownloadUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    if (!mediaResponse.ok) {
      console.error('[Meta Media] Failed to download media:', mediaResponse.status);
      return null;
    }
    
    const mediaBlob = await mediaResponse.blob();
    const arrayBuffer = await mediaBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Step 3: Upload to Supabase Storage
    const ext = mimeType.split('/')[1]?.split(';')[0] || 'bin';
    const timestamp = new Date().getTime();
    const randomStr = Math.random().toString(36).substring(7);
    const filename = `${timestamp}_${randomStr}.${ext}`;
    
    const { data, error } = await supabase.storage
      .from('whatsapp-media')
      .upload(filename, uint8Array, {
        contentType: mimeType,
        upsert: false
      });
    
    if (error) {
      console.error('[Meta Media] Failed to upload to Supabase:', error);
      return null;
    }
    
    // Get signed URL (1 year expiry)
    const { data: signedData, error: signedError } = await supabase.storage
      .from('whatsapp-media')
      .createSignedUrl(filename, 60 * 60 * 24 * 365);
    
    if (signedError || !signedData?.signedUrl) {
      console.error('[Meta Media] Failed to create signed URL:', signedError);
      return null;
    }
    
    console.log('[Meta Media] Successfully uploaded with signed URL');
    return { url: signedData.signedUrl, mimeType };
  } catch (error) {
    console.error('[Meta Media] Error:', error);
    return null;
  }
}

// Constants for input validation
const MAX_MESSAGE_LENGTH = 10000;
const MAX_MEDIA_COUNT = 10;

function isValidCoordinates(lat: string | null, lon: string | null): boolean {
  if (!lat || !lon) return true;
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lon);
  return !isNaN(latitude) && !isNaN(longitude) && 
         latitude >= -90 && latitude <= 90 && 
         longitude >= -180 && longitude <= 180;
}

// Parse natural language date/time expressions
function parseNaturalDate(expression: string, timezone: string = 'America/New_York'): { date: string | null; time: string | null; readable: string } {
  const now = new Date();
  const lowerExpr = expression.toLowerCase().trim();
  
  const formatDate = (d: Date): string => d.toISOString();
  
  const monthNames: Record<string, number> = {
    'january': 0, 'jan': 0, 'february': 1, 'feb': 1, 'march': 2, 'mar': 2,
    'april': 3, 'apr': 3, 'may': 4, 'june': 5, 'jun': 5, 'july': 6, 'jul': 6,
    'august': 7, 'aug': 7, 'september': 8, 'sep': 8, 'sept': 8,
    'october': 9, 'oct': 9, 'november': 10, 'nov': 10, 'december': 11, 'dec': 11
  };
  
  const getNextDayOfWeek = (dayName: string): Date => {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = days.indexOf(dayName.toLowerCase());
    if (targetDay === -1) return now;
    
    const result = new Date(now);
    const currentDay = result.getDay();
    let daysToAdd = targetDay - currentDay;
    if (daysToAdd <= 0) daysToAdd += 7;
    result.setDate(result.getDate() + daysToAdd);
    result.setHours(9, 0, 0, 0);
    return result;
  };
  
  let hours: number | null = null;
  let minutes: number = 0;
  
  const timeMatch = lowerExpr.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    const potentialHour = parseInt(timeMatch[1]);
    const meridiem = timeMatch[3]?.toLowerCase();
    
    if (meridiem || potentialHour <= 12) {
      hours = potentialHour;
      minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;
    }
  }
  
  if (lowerExpr.includes('morning')) { hours = hours ?? 9; }
  else if (lowerExpr.includes('noon') || lowerExpr.includes('midday')) { hours = hours ?? 12; }
  else if (lowerExpr.includes('afternoon')) { hours = hours ?? 14; }
  else if (lowerExpr.includes('evening')) { hours = hours ?? 18; }
  else if (lowerExpr.includes('night')) { hours = hours ?? 20; }
  
  let targetDate: Date | null = null;
  let readable = '';
  
  if (lowerExpr.includes('today')) {
    targetDate = new Date(now);
    readable = 'today';
  } else if (lowerExpr.includes('tomorrow')) {
    targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + 1);
    readable = 'tomorrow';
  } else if (lowerExpr.includes('day after tomorrow')) {
    targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + 2);
    readable = 'day after tomorrow';
  } else if (lowerExpr.includes('next week')) {
    targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + 7);
    readable = 'next week';
  } else if (lowerExpr.includes('in a week') || lowerExpr.includes('in 1 week')) {
    targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + 7);
    readable = 'in a week';
  }
  
  const inMinutesMatch = lowerExpr.match(/in\s+(\d+)\s*(?:min(?:ute)?s?)/i);
  const inHoursMatch = lowerExpr.match(/in\s+(\d+)\s*(?:hour?s?|hr?s?)/i);
  const inDaysMatch = lowerExpr.match(/in\s+(\d+)\s*days?/i);
  
  if (inMinutesMatch) {
    targetDate = new Date(now);
    targetDate.setMinutes(targetDate.getMinutes() + parseInt(inMinutesMatch[1]));
    readable = `in ${inMinutesMatch[1]} minutes`;
    hours = targetDate.getHours();
    minutes = targetDate.getMinutes();
  } else if (inHoursMatch) {
    targetDate = new Date(now);
    targetDate.setHours(targetDate.getHours() + parseInt(inHoursMatch[1]));
    readable = `in ${inHoursMatch[1]} hours`;
    hours = targetDate.getHours();
    minutes = targetDate.getMinutes();
  } else if (inDaysMatch) {
    targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + parseInt(inDaysMatch[1]));
    readable = `in ${inDaysMatch[1]} days`;
  }
  
  if (!targetDate) {
    for (const [monthWord, monthNum] of Object.entries(monthNames)) {
      const monthDayMatch = lowerExpr.match(new RegExp(`${monthWord}\\s+(\\d{1,2})(?:st|nd|rd|th)?`, 'i'));
      if (monthDayMatch) {
        const dayNum = parseInt(monthDayMatch[1]);
        if (dayNum >= 1 && dayNum <= 31) {
          targetDate = new Date(now.getFullYear(), monthNum, dayNum);
          if (hours !== null) {
            targetDate.setHours(hours, minutes, 0, 0);
          } else {
            targetDate.setHours(9, 0, 0, 0);
          }
          
          if (targetDate < now) {
            targetDate.setFullYear(targetDate.getFullYear() + 1);
          }
          
          const monthDisplayNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                                      'July', 'August', 'September', 'October', 'November', 'December'];
          readable = `${monthDisplayNames[monthNum]} ${dayNum}`;
        }
        break;
      }
    }
  }
  
  if (!targetDate) {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (const day of dayNames) {
      if (lowerExpr.includes(day) || lowerExpr.includes(day.substring(0, 3))) {
        targetDate = getNextDayOfWeek(day);
        readable = `next ${day.charAt(0).toUpperCase() + day.slice(1)}`;
        break;
      }
    }
  }
  
  if (targetDate && hours !== null) {
    targetDate.setHours(hours, minutes, 0, 0);
    readable += ` at ${hours > 12 ? hours - 12 : hours === 0 ? 12 : hours}:${minutes.toString().padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
  } else if (targetDate && hours === null) {
    targetDate.setHours(9, 0, 0, 0);
    readable += ' at 9:00 AM';
  }
  
  if (!targetDate) {
    return { date: null, time: null, readable: 'unknown' };
  }
  
  return {
    date: formatDate(targetDate),
    time: formatDate(targetDate),
    readable
  };
}

// Search for a task by keywords in summary
async function searchTaskByKeywords(
  supabase: any, 
  userId: string, 
  coupleId: string | null, 
  keywords: string[]
): Promise<any | null> {
  let query = supabase
    .from('clerk_notes')
    .select('id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time')
    .eq('completed', false)
    .order('created_at', { ascending: false })
    .limit(50);
  
  if (coupleId) {
    query = query.eq('couple_id', coupleId);
  } else {
    query = query.eq('author_id', userId);
  }
  
  const { data: tasks, error } = await query;
  
  if (error || !tasks || tasks.length === 0) {
    return null;
  }
  
  const scoredTasks = tasks.map((task: any) => {
    const summaryLower = task.summary.toLowerCase();
    let score = 0;
    
    for (const keyword of keywords) {
      const keywordLower = keyword.toLowerCase();
      if (keywordLower.length < 2) continue;
      
      if (summaryLower.includes(keywordLower)) {
        if (summaryLower.split(/\s+/).some((word: string) => word === keywordLower)) {
          score += 10;
        } else {
          score += 5;
        }
      }
    }
    
    return { ...task, score };
  });
  
  scoredTasks.sort((a: any, b: any) => b.score - a.score);
  
  if (scoredTasks[0]?.score > 0) {
    return scoredTasks[0];
  }
  
  return null;
}

// Semantic task search using hybrid_search_notes RPC (vector + full-text)
// Replaces searchTaskByKeywords for AI-routed flows
async function semanticTaskSearch(
  supabase: any,
  userId: string,
  coupleId: string | null,
  queryString: string
): Promise<any | null> {
  try {
    console.log('[semanticTaskSearch] Searching for:', queryString);

    // Generate embedding for semantic search
    const embedding = await generateEmbedding(queryString);

    if (embedding) {
      // Use hybrid search: 70% vector similarity + 30% full-text
      const { data, error } = await supabase.rpc('hybrid_search_notes', {
        p_user_id: userId,
        p_couple_id: coupleId,
        p_query: queryString,
        p_query_embedding: JSON.stringify(embedding),
        p_vector_weight: 0.7,
        p_limit: 5
      });

      if (!error && data && data.length > 0) {
        // Return first non-completed match
        const match = data.find((t: any) => !t.completed);
        if (match) {
          console.log('[semanticTaskSearch] Hybrid match:', match.summary, 'score:', match.score);
          return match;
        }
      }

      if (error) {
        console.warn('[semanticTaskSearch] Hybrid search error:', error);
      }
    }

    // Fallback: text-only search (vector_weight = 0.0)
    console.log('[semanticTaskSearch] Falling back to text-only search');
    const { data: textData, error: textError } = await supabase.rpc('hybrid_search_notes', {
      p_user_id: userId,
      p_couple_id: coupleId,
      p_query: queryString,
      p_query_embedding: JSON.stringify(new Array(1536).fill(0)),
      p_vector_weight: 0.0,
      p_limit: 5
    });

    if (!textError && textData && textData.length > 0) {
      const match = textData.find((t: any) => !t.completed);
      if (match) {
        console.log('[semanticTaskSearch] Text-only match:', match.summary, 'score:', match.score);
        return match;
      }
    }

    // Final fallback: use legacy keyword search
    console.log('[semanticTaskSearch] No semantic match, falling back to keyword search');
    const keywords = queryString.split(/\s+/).filter(w => w.length > 2);
    if (keywords.length > 0) {
      return await searchTaskByKeywords(supabase, userId, coupleId, keywords);
    }

    return null;
  } catch (error) {
    console.error('[semanticTaskSearch] Error:', error);
    // Fallback to keyword search on any error
    const keywords = queryString.split(/\s+/).filter(w => w.length > 2);
    if (keywords.length > 0) {
      return await searchTaskByKeywords(supabase, userId, coupleId, keywords);
    }
    return null;
  }
}

// Find similar notes using embedding similarity
async function findSimilarNotes(
  supabase: any,
  userId: string,
  coupleId: string | null | undefined,
  embedding: number[],
  excludeId: string
): Promise<{ id: string; summary: string; similarity: number } | null> {
  try {
    const { data, error } = await supabase.rpc('find_similar_notes', {
      p_user_id: userId,
      p_couple_id: coupleId,
      p_query_embedding: JSON.stringify(embedding),
      p_threshold: 0.85,
      p_limit: 5
    });

    if (error) {
      console.error('Error finding similar notes:', error);
      return null;
    }

    const matches = (data || []).filter((n: any) => n.id !== excludeId);
    
    if (matches.length > 0) {
      return {
        id: matches[0].id,
        summary: matches[0].summary,
        similarity: matches[0].similarity
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error in findSimilarNotes:', error);
    return null;
  }
}

// ============================================================================
// EXTRACT MESSAGE DATA FROM META WEBHOOK PAYLOAD
// ============================================================================
interface MetaMessageData {
  fromNumber: string;
  messageBody: string | null;
  mediaItems: Array<{ id: string; mimeType: string }>;
  latitude: string | null;
  longitude: string | null;
  phoneNumberId: string;
  messageId: string;
}

function extractMetaMessage(body: any): MetaMessageData | null {
  try {
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    
    if (!value?.messages || value.messages.length === 0) {
      console.log('[Meta] No messages in webhook (could be status update)');
      return null;
    }
    
    const message = value.messages[0];
    const phoneNumberId = value.metadata?.phone_number_id;
    const fromNumber = message.from; // Raw number like "15551234567"
    const messageId = message.id;
    
    let messageBody: string | null = null;
    let latitude: string | null = null;
    let longitude: string | null = null;
    const mediaItems: Array<{ id: string; mimeType: string }> = [];
    
    switch (message.type) {
      case 'text':
        messageBody = message.text?.body || null;
        break;
      case 'image':
        if (message.image) {
          mediaItems.push({ id: message.image.id, mimeType: message.image.mime_type || 'image/jpeg' });
          messageBody = message.image.caption || null;
        }
        break;
      case 'video':
        if (message.video) {
          mediaItems.push({ id: message.video.id, mimeType: message.video.mime_type || 'video/mp4' });
          messageBody = message.video.caption || null;
        }
        break;
      case 'audio':
        if (message.audio) {
          mediaItems.push({ id: message.audio.id, mimeType: message.audio.mime_type || 'audio/ogg' });
        }
        break;
      case 'document':
        if (message.document) {
          mediaItems.push({ id: message.document.id, mimeType: message.document.mime_type || 'application/pdf' });
          messageBody = message.document.caption || message.document.filename || null;
        }
        break;
      case 'location':
        latitude = String(message.location?.latitude || '');
        longitude = String(message.location?.longitude || '');
        messageBody = message.location?.name || message.location?.address || null;
        break;
      case 'contacts':
        messageBody = `Shared contact: ${message.contacts?.[0]?.name?.formatted_name || 'Unknown'}`;
        break;
      case 'interactive':
        // Handle button/list replies
        messageBody = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || null;
        break;
      default:
        console.log('[Meta] Unhandled message type:', message.type);
        messageBody = null;
    }
    
    return {
      fromNumber: fromNumber || '',
      messageBody,
      mediaItems,
      latitude: latitude || null,
      longitude: longitude || null,
      phoneNumberId: phoneNumberId || '',
      messageId: messageId || ''
    };
  } catch (error) {
    console.error('[Meta] Error extracting message:', error);
    return null;
  }
}

// ============================================================================
// MAIN WEBHOOK HANDLER
// ============================================================================
serve(async (req) => {
  const url = new URL(req.url);
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ========================================================================
  // META WEBHOOK VERIFICATION (GET request)
  // Meta sends a GET request to verify webhook ownership during setup.
  // We must reply with the hub.challenge value if the verify_token matches.
  // ========================================================================
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    
    const VERIFY_TOKEN = Deno.env.get('WHATSAPP_VERIFY_TOKEN');
    
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[Meta Webhook] Verification successful!');
      // MUST return the challenge string directly (not JSON) 
      return new Response(challenge, { 
        status: 200, 
        headers: { 'Content-Type': 'text/plain' } 
      });
    }
    
    console.warn('[Meta Webhook] Verification failed - token mismatch');
    return new Response('Forbidden', { status: 403 });
  }

  // ========================================================================
  // META WEBHOOK MESSAGE HANDLER (POST request)
  // ========================================================================
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN')!;
    const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse Meta webhook JSON body
    const webhookBody = await req.json();
    console.log('[Meta Webhook] Received:', JSON.stringify(webhookBody).substring(0, 500));
    
    // Extract message data from Meta's nested structure
    const messageData = extractMetaMessage(webhookBody);
    
    if (!messageData) {
      // This could be a status update (delivered, read, etc.) - acknowledge it
      console.log('[Meta Webhook] No message to process (status update or empty)');
      return new Response(JSON.stringify({ status: 'ok' }), { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
    
    const { fromNumber: rawFromNumber, messageBody: rawMessageBody, mediaItems, latitude, longitude, phoneNumberId, messageId } = messageData;
    const fromNumber = standardizePhoneNumber(rawFromNumber);
    
    // Mutable ref for userId so reply() can access it after auth
    let _authenticatedUserId: string | null = null;
    
    // Helper to send reply via Meta Cloud API
    const reply = async (text: string, mediaUrl?: string): Promise<Response> => {
      await sendWhatsAppReply(phoneNumberId || WHATSAPP_PHONE_NUMBER_ID, rawFromNumber, text, WHATSAPP_ACCESS_TOKEN, mediaUrl);
      
      // Save last_outbound_context so bare replies can reference it
      if (_authenticatedUserId) {
        try {
          await supabase
            .from('clerk_profiles')
            .update({
              last_outbound_context: {
                message_type: 'reply',
                content: text.substring(0, 500),
                sent_at: new Date().toISOString(),
                status: 'sent'
              }
            })
            .eq('id', _authenticatedUserId);
        } catch (ctxErr) {
          console.warn('[Context] Failed to save last_outbound_context:', ctxErr);
        }
      }
      
      return new Response(JSON.stringify({ status: 'ok' }), { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    };
    
    // Mark message as read
    try {
      await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId || WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId
        })
      });
    } catch (readErr) {
      console.warn('[Meta] Failed to mark message as read:', readErr);
    }
    
    // Validate message length
    if (rawMessageBody && rawMessageBody.length > MAX_MESSAGE_LENGTH) {
      console.warn('[Validation] Message too long:', rawMessageBody.length, 'chars');
      return reply('Your message is too long. Please keep messages under 10,000 characters.');
    }
    
    const messageBody = rawMessageBody?.trim() || null;
    
    // Validate coordinates
    if (!isValidCoordinates(latitude, longitude)) {
      console.warn('[Validation] Invalid coordinates:', { latitude, longitude });
      return reply('Invalid location data received. Please try sharing your location again.');
    }
    
    // Download and upload media from Meta
    const mediaUrls: string[] = [];
    const mediaTypes: string[] = [];
    let mediaDownloadFailed = false;
    
    if (mediaItems.length > MAX_MEDIA_COUNT) {
      console.warn('[Validation] Too many media attachments:', mediaItems.length);
      return reply(`Too many attachments (${mediaItems.length}). Please send up to ${MAX_MEDIA_COUNT} files at a time.`);
    }
    
    for (const media of mediaItems) {
      const result = await downloadAndUploadMetaMedia(media.id, WHATSAPP_ACCESS_TOKEN, supabase);
      if (result) {
        mediaUrls.push(result.url);
        mediaTypes.push(result.mimeType);
      } else {
        mediaDownloadFailed = true;
      }
    }

    console.log('Incoming WhatsApp message:', { 
      fromNumber, 
      messageBody: messageBody?.substring(0, 100),
      numMedia: mediaItems.length,
      uploadedMedia: mediaUrls.length
    });

    // Handle location sharing
    if (latitude && longitude && !messageBody && mediaUrls.length === 0) {
      return reply(`📍 Thanks for sharing your location! (${latitude}, ${longitude})\n\nYou can add a task with this location by sending a message like:\n"Buy groceries at this location"`);
    }

    // Handle media-only messages
    if (mediaUrls.length > 0 && !messageBody) {
      console.log('[WhatsApp] Processing media-only message');
    }

    if (!messageBody && mediaUrls.length === 0) {
      if (mediaItems.length > 0 && mediaDownloadFailed) {
        console.warn('[WhatsApp] User attached media but download failed');
        return reply(
          "I see you attached a photo or file, but I couldn't download it. " +
          "Please try sending it again, or add a short caption describing what you want to save."
        );
      }
      
      return reply('Please send a message, share your location 📍, or attach media 📎');
    }

    // Check for linking token
    const tokenMatch = messageBody?.match(/(?:My Olive Token is )?(LINK_[A-Z0-9]+)/i);
    if (tokenMatch) {
      const token = tokenMatch[1].toUpperCase();
      console.log('Processing linking token:', token);
      
      const { data: tokenData, error: tokenError } = await supabase
        .from('linking_tokens')
        .select('user_id')
        .eq('token', token)
        .gt('expires_at', new Date().toISOString())
        .is('used_at', null)
        .single();

      if (tokenError || !tokenData) {
        console.error('Token lookup error:', tokenError);
        return reply('Invalid or expired token. Please generate a new one from the Olive app.');
      }

      const { error: updateError } = await supabase
        .from('clerk_profiles')
        .update({ phone_number: fromNumber })
        .eq('id', tokenData.user_id);

      if (updateError) {
        console.error('Error linking WhatsApp:', updateError);
        return reply('Failed to link your account. Please try again.');
      }

      await supabase
        .from('linking_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('token', token);

      console.log('WhatsApp account linked successfully for user:', tokenData.user_id);

      return reply(
        '✅ Your Olive account is successfully linked!\n\nYou can now:\n• Send brain dumps to organize\n• Share locations 📍 with tasks\n• Ask about your tasks\n• Send images 📸 or voice notes 🎤'
      );
    }

    // Authenticate user by WhatsApp number
    const { data: profiles, error: profileError } = await supabase
      .from('clerk_profiles')
      .select('id, display_name, timezone, language_preference')
      .eq('phone_number', fromNumber)
      .limit(1);

    const profile = profiles?.[0];

    if (profileError || !profile) {
      console.error('Profile lookup error:', profileError);
      return reply(
        '👋 Hi! To use Olive via WhatsApp, please link your account first:\n\n' +
        '1️⃣ Open the Olive app\n' +
        '2️⃣ Go to Profile/Settings\n' +
        '3️⃣ Tap "Link WhatsApp"\n' +
        '4️⃣ Send the token here\n\n' +
        'Then I can help organize your tasks, locations, and more!'
      );
    }

    console.log('Authenticated user:', profile.id, profile.display_name);
    const userId = profile.id;
    _authenticatedUserId = userId; // Enable reply() to save outbound context
    const userLang = profile.language_preference || 'en';

    // Fetch recent outbound messages for conversation context (last 60 min)
    const recentOutbound = await getRecentOutboundMessages(supabase, userId);
    if (recentOutbound.length > 0) {
      console.log(`[Context] Found ${recentOutbound.length} recent outbound messages for user:`,
        recentOutbound.map(m => `[${m.source}:${m.type}] ${m.content?.substring(0, 80)}`));
    } else {
      console.log('[Context] No recent outbound messages found for user', userId);
    }

    // Track last user message timestamp for 24h template window
    try {
      await supabase
        .from('clerk_profiles')
        .update({ last_user_message_at: new Date().toISOString() })
        .eq('id', userId);
    } catch (e) {
      console.log('[Webhook] Could not update last_user_message_at (column may not exist yet):', e);
    }

    // Get or create session
    let { data: session } = await supabase
      .from('user_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (!session) {
      const { data: newSession, error: sessionError } = await supabase
        .from('user_sessions')
        .insert({ user_id: userId, conversation_state: 'IDLE' })
        .select()
        .single();

      if (sessionError) {
        console.error('Error creating session:', sessionError);
        return reply('Sorry, there was an error. Please try again.');
      }
      session = newSession;
    }

    // Get user's couple_id for shared notes
    const { data: coupleMember } = await supabase
      .from('clerk_couple_members')
      .select('couple_id')
      .eq('user_id', userId)
      .limit(1)
      .single();

    const coupleId = coupleMember?.couple_id || null;

    // ========================================================================
    // HELPER: Save referenced entity to session for pronoun resolution
    // ========================================================================
    async function saveReferencedEntity(
      task: { id: string; summary: string; due_date?: string; list_id?: string; priority?: string } | null,
      oliveResponse: string,
      displayedList?: Array<{ id: string; summary: string }>
    ) {
      try {
        const currentContext = (session.context_data || {}) as ConversationContext;
        const existingHistory = currentContext.conversation_history || [];
        const updatedHistory = [
          ...existingHistory,
          { role: 'user' as const, content: (messageBody || '').substring(0, 500), timestamp: new Date().toISOString() },
          { role: 'assistant' as const, content: oliveResponse.substring(0, 500), timestamp: new Date().toISOString() },
        ].slice(-6); // Keep last 3 exchanges

        const updatedContext: ConversationContext = {
          ...currentContext,
          conversation_history: updatedHistory,
        };

        // Only update entity if a task was identified
        if (task) {
          updatedContext.last_referenced_entity = {
            type: 'task',
            id: task.id,
            summary: task.summary,
            due_date: task.due_date,
            list_id: task.list_id,
            priority: task.priority,
          };
          updatedContext.entity_referenced_at = new Date().toISOString();
        }

        // Store numbered list for ordinal reference resolution ("the first one", "the third one")
        if (displayedList && displayedList.length > 0) {
          updatedContext.last_displayed_list = displayedList.map((t, i) => ({
            id: t.id,
            summary: t.summary,
            position: i,
          }));
          updatedContext.list_displayed_at = new Date().toISOString();
          console.log('[Context] Saved displayed list:', displayedList.length, 'items');
        }

        await supabase
          .from('user_sessions')
          .update({
            context_data: updatedContext,
            updated_at: new Date().toISOString(),
          })
          .eq('id', session.id);

        if (task) {
          console.log('[Context] Saved referenced entity:', task.summary);
        }
      } catch (e) {
        console.warn('[Context] Failed to save entity context:', e);
      }
    }

    // ========================================================================
    // HANDLE AWAITING_CONFIRMATION STATE
    // ========================================================================
    if (session.conversation_state === 'AWAITING_CONFIRMATION') {
      const contextData = session.context_data as any;
      const isAffirmative = /^(yes|yeah|yep|sure|ok|okay|confirm|si|sí|do it|go ahead|please|y)$/i.test(messageBody!.trim());
      const isNegative = /^(no|nope|nah|cancel|nevermind|never mind|n)$/i.test(messageBody!.trim());

      // Helper to clear pending state while preserving conversation context
      const clearPendingState = async () => {
        const preservedContext = (contextData || {}) as ConversationContext;
        await supabase
          .from('user_sessions')
          .update({
            conversation_state: 'IDLE',
            context_data: {
              last_referenced_entity: preservedContext.last_referenced_entity,
              entity_referenced_at: preservedContext.entity_referenced_at,
              conversation_history: preservedContext.conversation_history,
              // pending_action intentionally omitted (cleared)
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', session.id);
      };

      // Staleness check: if confirmation has been pending for >5 minutes, auto-cancel
      const sessionUpdatedAt = new Date(session.updated_at).getTime();
      const isStale = (Date.now() - sessionUpdatedAt) > 5 * 60 * 1000;

      if (isStale) {
        console.log('[AWAITING_CONFIRMATION] Stale confirmation (>5 min old), auto-cancelling and processing message normally');
        await clearPendingState();
        // Fall through to normal message processing below
      } else if (isNegative) {
        await clearPendingState();
        return reply(t('action_cancelled', userLang));
      } else if (isAffirmative) {
        await clearPendingState();

        // Execute the pending action
        const pendingAction = contextData?.pending_action;

        if (pendingAction?.type === 'assign') {
          const { error: updateError } = await supabase
            .from('clerk_notes')
            .update({
              task_owner: pendingAction.target_user_id,
              updated_at: new Date().toISOString()
            })
            .eq('id', pendingAction.task_id);

          if (updateError) {
            console.error('Error assigning task:', updateError);
            return reply('Sorry, I couldn\'t assign that task. Please try again.');
          }

          return reply(`✅ Done! I assigned "${pendingAction.task_summary}" to ${pendingAction.target_name}. 🎯`);
        } else if (pendingAction?.type === 'set_due_date') {
          await supabase
            .from('clerk_notes')
            .update({
              due_date: pendingAction.date,
              updated_at: new Date().toISOString()
            })
            .eq('id', pendingAction.task_id);

          return reply(`✅ Done! "${pendingAction.task_summary}" is now due ${pendingAction.readable}. 📅`);
        } else if (pendingAction?.type === 'set_reminder') {
          const updateData: any = {
            reminder_time: pendingAction.time,
            updated_at: new Date().toISOString()
          };

          if (!pendingAction.has_due_date) {
            updateData.due_date = pendingAction.time;
          }

          await supabase
            .from('clerk_notes')
            .update(updateData)
            .eq('id', pendingAction.task_id);

          return reply(`✅ Done! I'll remind you about "${pendingAction.task_summary}" ${pendingAction.readable}. ⏰`);
        } else if (pendingAction?.type === 'delete') {
          await supabase
            .from('clerk_notes')
            .delete()
            .eq('id', pendingAction.task_id);

          return reply(`🗑️ Done! "${pendingAction.task_summary}" has been deleted.`);
        } else if (pendingAction?.type === 'merge') {
          const { data: mergeResult, error: mergeError } = await supabase.rpc('merge_notes', {
            p_source_id: pendingAction.source_id,
            p_target_id: pendingAction.target_id
          });

          if (mergeError) {
            console.error('Error merging notes:', mergeError);
            return reply('Sorry, I couldn\'t merge those notes. Please try again.');
          }

          return reply(`✅ Merged! Combined your note into: "${pendingAction.target_summary}"\n\n🔗 Manage: https://witholive.app`);
        }

        return reply('Something went wrong with the confirmation. Please try again.');
      } else {
        // Non-confirmation message (not yes/no): auto-cancel pending action
        // and fall through to process the message normally
        console.log('[AWAITING_CONFIRMATION] Non-confirmation message received, auto-cancelling pending action, processing as new message:', messageBody?.substring(0, 50));
        await clearPendingState();
        // DO NOT RETURN — fall through to normal intent classification below
      }
    }

    // ========================================================================
    // CONTEXTUAL BARE-REPLY DETECTION
    // If user sends "Completed!", "Done!", "Finished!" etc. with no task name,
    // and Olive recently sent a reminder about a specific task, auto-complete it.
    // ========================================================================
    const bareReplyMatch = messageBody?.trim().match(
      /^(completed!?|done!?|finished!?|got it!?|did it!?|hecho!?|fatto!?|terminado!?|finito!?)$/i
    );
    if (bareReplyMatch && recentOutbound.length > 0) {
      // Find the most recent reminder-like message
      const recentReminder = recentOutbound.find(m =>
        m.type === 'reminder' || m.type === 'task_reminder' ||
        m.content.includes('Reminder:') || m.content.includes('⏰')
      );

      if (recentReminder) {
        const extractedTask = extractTaskFromOutbound(recentReminder);
        if (extractedTask) {
          console.log('[Context] Bare reply detected, matching to recent reminder task:', extractedTask);

          // Search for the task using semantic search
          const foundTask = await semanticTaskSearch(supabase, userId, coupleId, extractedTask);

          if (foundTask) {
            const { error } = await supabase
              .from('clerk_notes')
              .update({ completed: true, updated_at: new Date().toISOString() })
              .eq('id', foundTask.id);

            if (!error) {
              return reply(t('context_completed', userLang, { task: foundTask.summary }));
            }
          }
        }
      }

      // Also check if there's a recent briefing with tasks — complete the first one mentioned
      const recentBriefing = recentOutbound.find(m =>
        m.type === 'morning_briefing' || m.type === 'proactive_nudge' || m.type === 'overdue_nudge'
      );
      if (recentBriefing) {
        const extractedTask = extractTaskFromOutbound(recentBriefing);
        if (extractedTask) {
          console.log('[Context] Bare reply — trying briefing task:', extractedTask);
          const foundTask = await semanticTaskSearch(supabase, userId, coupleId, extractedTask);
          if (foundTask) {
            const { error } = await supabase
              .from('clerk_notes')
              .update({ completed: true, updated_at: new Date().toISOString() })
              .eq('id', foundTask.id);
            if (!error) {
              return reply(t('context_completed', userLang, { task: foundTask.summary }));
            }
          }
        }
      }
      // If no recent context found, fall through to normal intent detection
      console.log('[Context] Bare reply but no matching context found, continuing with normal routing');
    }

    // ========================================================================
    // AI-POWERED INTENT CLASSIFICATION (with regex fallback)
    // ========================================================================
    const sessionContext = (session.context_data || {}) as ConversationContext;
    const conversationHistory = sessionContext.conversation_history || [];

    // Fetch context for AI router (parallel lightweight queries)
    const [taskListResult, memoriesResult, skillsResult] = await Promise.all([
      // 30 most recent active tasks (id + summary + due_date + priority)
      supabase
        .from('clerk_notes')
        .select('id, summary, due_date, priority')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
        .eq('completed', false)
        .order('created_at', { ascending: false })
        .limit(30),
      // Top 10 memories by importance
      supabase
        .from('user_memories')
        .select('title, content, category')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('importance', { ascending: false })
        .limit(10),
      // User's activated skills (just id + name)
      supabase
        .from('olive_user_skills')
        .select('skill_id')
        .eq('user_id', userId)
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

    const activeTasks = taskListResult.data || [];
    const userMemories = memoriesResult.data || [];
    const activatedSkills = skillsResult.data || [];

    // Build outbound context strings for AI
    const outboundContextStrings = recentOutbound.map(m => m.content).filter(Boolean);

    // Call AI classifier
    const aiResult = await classifyIntent(
      messageBody || '',
      conversationHistory,
      outboundContextStrings,
      activeTasks,
      userMemories,
      activatedSkills,
      userLang
    );

    let intentResult: IntentResult & { queryType?: string; chatType?: string; actionType?: string; actionTarget?: string; cleanMessage?: string; _aiTaskId?: string; _aiSkillId?: string };

    if (aiResult && aiResult.confidence >= 0.5) {
      // AI classification succeeded with sufficient confidence
      intentResult = mapAIResultToIntentResult(aiResult);
      console.log(`[AI Router] Using AI result: intent=${intentResult.intent}, confidence=${aiResult.confidence}, aiTaskId=${intentResult._aiTaskId || 'none'}, skill=${intentResult._aiSkillId || 'none'}`);
    } else {
      // Fallback to deterministic regex routing
      if (aiResult) {
        console.log(`[AI Router] Low confidence (${aiResult.confidence}), falling back to regex. AI suggested: ${aiResult.intent}`);
      } else {
        console.log('[AI Router] AI classification failed, falling back to regex');
      }
      intentResult = determineIntent(messageBody || '', mediaUrls.length > 0);
    }

    const { intent, isUrgent, cleanMessage } = intentResult;
    const effectiveMessage = cleanMessage ?? messageBody;
    console.log('Final intent:', intent, 'isUrgent:', isUrgent, 'for message:', effectiveMessage?.substring(0, 50));

    // ========================================================================
    // MERGE COMMAND HANDLER
    // ========================================================================
    if (intent === 'MERGE') {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      
      const { data: recentNotes, error: recentError } = await supabase
        .from('clerk_notes')
        .select('id, summary, embedding, created_at')
        .eq('author_id', userId)
        .eq('completed', false)
        .gte('created_at', fiveMinutesAgo)
        .order('created_at', { ascending: false })
        .limit(1);

      if (recentError || !recentNotes || recentNotes.length === 0) {
        return reply('I don\'t see any recent tasks to merge. The Merge command works within 5 minutes of creating a task.');
      }

      const sourceNote = recentNotes[0];
      let targetNote: { id: string; summary: string } | null = null;

      if (sourceNote.embedding) {
        const similar = await findSimilarNotes(supabase, userId, coupleId, sourceNote.embedding, sourceNote.id);
        if (similar) {
          targetNote = { id: similar.id, summary: similar.summary };
        }
      }

      if (!targetNote) {
        const embedding = await generateEmbedding(sourceNote.summary);
        if (embedding) {
          const similar = await findSimilarNotes(supabase, userId, coupleId, embedding, sourceNote.id);
          if (similar) {
            targetNote = { id: similar.id, summary: similar.summary };
          }
        }
      }

      if (!targetNote) {
        return reply(`I couldn't find a similar task to merge "${sourceNote.summary}" with. The task remains as-is.`);
      }

      await supabase
        .from('user_sessions')
        .update({ 
          conversation_state: 'AWAITING_CONFIRMATION', 
          context_data: {
            pending_action: {
              type: 'merge',
              source_id: sourceNote.id,
              source_summary: sourceNote.summary,
              target_id: targetNote.id,
              target_summary: targetNote.summary
            }
          },
          updated_at: new Date().toISOString() 
        })
        .eq('id', session.id);

      return reply(`🔀 Merge "${sourceNote.summary}" into "${targetNote.summary}"?\n\nReply "yes" to confirm or "no" to cancel.`);
    }

    // ========================================================================
    // SEARCH INTENT - Consultation with Context-Aware Responses
    // ========================================================================
    if (intent === 'SEARCH') {
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

      const listIdToName = new Map(lists?.map(l => [l.id, l.name]) || []);

      // ================================================================
      // SMART LIST LOOKUP
      // ================================================================
      
      function normalizeListName(name: string): string {
        return name.toLowerCase()
          .replace(/\b(the|a|an|my|our)\b/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      }
      
      function singularize(word: string): string {
        if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
        if (word.endsWith('ves')) return word.slice(0, -3) + 'f';
        if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('zes') || word.endsWith('ches') || word.endsWith('shes')) {
          return word.slice(0, -2);
        }
        if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
        return word;
      }
      
      // Strip trailing punctuation for pattern matching (e.g., "What's on my travel list?")
      const cleanedMessage = (effectiveMessage || '').replace(/[?!.]+$/, '').trim();
      
      const listExtractionPatterns = [
        /(?:show|display|open|get|see)\s+(?:me\s+)?(?:the\s+|my\s+|our\s+)?(.+?)\s+(?:list|tasks?|items?)$/i,
        /(?:what'?s|whats)\s+(?:in|on)\s+(?:the\s+|my\s+|our\s+)?(.+?)\s+(?:list|tasks?|items?)$/i,
        /^list\s+(?:my\s+|the\s+|our\s+)?(.+?)$/i,
        /^(?:my|our)\s+(.+?)(?:\s+list)?$/i,
        /^(.+?)\s+list$/i,
        /(?:show|display|open|get|see|what'?s\s+in)\s+(?:me\s+)?(?:the\s+|my\s+|our\s+)?(.+?)$/i,
      ];
      
      let specificList: string | null = null;
      let matchedListName: string | null = null;
      
      // PRIORITY: Use AI-provided list_name if available (most reliable)
      const aiListName = (intentResult as any)._listName as string | undefined;
      if (aiListName) {
        const aiNormalized = normalizeListName(aiListName);
        const aiSingular = singularize(aiNormalized);
        console.log('[WhatsApp] AI provided list_name:', aiListName, '→ normalized:', aiNormalized);
        
        for (const [listId, listName] of listIdToName) {
          const nln = normalizeListName(listName as string);
          const nlnS = singularize(nln);
          if (nln === aiNormalized || nlnS === aiSingular || nln.includes(aiNormalized) || aiNormalized.includes(nln) || nlnS.includes(aiSingular) || aiSingular.includes(nlnS)) {
            specificList = listId;
            matchedListName = listName as string;
            console.log(`[WhatsApp] AI list match: "${aiListName}" → "${matchedListName}"`);
            break;
          }
        }
      }
      
      // FALLBACK: Regex extraction from cleaned message (no trailing punctuation)
      if (!specificList) {
        for (const pattern of listExtractionPatterns) {
          const match = cleanedMessage?.match(pattern);
          if (!match) continue;
          
          const rawExtracted = normalizeListName(match[1]);
          if (!rawExtracted || rawExtracted.length < 2) continue;
          
          const genericWords = new Set(['tasks', 'task', 'all', 'everything', 'stuff', 'things', 'my', 'me', 'the']);
          if (genericWords.has(rawExtracted)) continue;
          
          const extractedSingular = singularize(rawExtracted);
          
          for (const [listId, listName] of listIdToName) {
            const normalizedListName = normalizeListName(listName as string);
            const listNameSingular = singularize(normalizedListName);
            
            if (normalizedListName === rawExtracted || normalizedListName === extractedSingular) {
              specificList = listId;
              matchedListName = listName as string;
              break;
            }
            
            if (listNameSingular === extractedSingular) {
              specificList = listId;
              matchedListName = listName as string;
              break;
            }
            
            if (normalizedListName.includes(rawExtracted) || rawExtracted.includes(normalizedListName)) {
              specificList = listId;
              matchedListName = listName as string;
              break;
            }
            
            if (listNameSingular.includes(extractedSingular) || extractedSingular.includes(listNameSingular)) {
              specificList = listId;
              matchedListName = listName as string;
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
        const relevantTasks = tasks.filter(t => t.list_id === specificList && !t.completed);
        
        if (relevantTasks.length === 0) {
          const completedInList = tasks.filter(t => t.list_id === specificList && t.completed);
          const emptyMsg = completedInList.length > 0
            ? `Your ${matchedListName} list is all done! ✅ (${completedInList.length} completed item${completedInList.length > 1 ? 's' : ''})`
            : `Your ${matchedListName} list is empty! 🎉`;
          return reply(emptyMsg);
        }
        
        const itemsList = relevantTasks.map((t, i) => {
          const items = t.items && t.items.length > 0 ? `\n  ${t.items.join('\n  ')}` : '';
          const priority = t.priority === 'high' ? ' 🔥' : '';
          const dueInfo = t.due_date ? ` (Due: ${formatFriendlyDate(t.due_date)})` : '';
          return `${i + 1}. ${t.summary}${priority}${dueInfo}${items}`;
        }).join('\n\n');
        
        const searchListResponse = `📋 ${matchedListName} (${relevantTasks.length}):\n\n${itemsList}\n\n💡 Say "done with [task]" to complete items`;
        // Save the first task as referenced entity AND the full numbered list for ordinal references
        await saveReferencedEntity(relevantTasks[0], searchListResponse, relevantTasks.map(t => ({ id: t.id, summary: t.summary })));
        return reply(searchListResponse);
      }

      // General task summary
      if (!tasks || tasks.length === 0) {
        return reply('You don\'t have any tasks yet! Send me something to save like "Buy groceries tomorrow" 🛒');
      }

      const activeTasks = tasks.filter(t => !t.completed);
      const urgentTasks = activeTasks.filter(t => t.priority === 'high');
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
      
      const dueTodayTasks = activeTasks.filter(t => {
        if (!t.due_date) return false;
        const dueDate = new Date(t.due_date);
        return dueDate >= today && dueDate < tomorrow;
      });
      
      const overdueTasks = activeTasks.filter(t => {
        if (!t.due_date) return false;
        const dueDate = new Date(t.due_date);
        return dueDate < today;
      });
      
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const recentTasks = activeTasks.filter(t => new Date(t.created_at) >= oneDayAgo);

      // ================================================================
      // CONTEXTUAL QUERY RESPONSES
      // ================================================================
      
      if (queryType === 'urgent') {
        if (urgentTasks.length === 0) {
          return reply('🎉 Great news! You have no urgent tasks right now.\n\n💡 Use "!" prefix to mark tasks as urgent (e.g., "!call mom")');
        }
        
        const urgentList = urgentTasks.slice(0, 8).map((t, i) => {
          const dueInfo = t.due_date ? ` (Due: ${formatFriendlyDate(t.due_date)})` : '';
          return `${i + 1}. ${t.summary}${dueInfo}`;
        }).join('\n');
        
        const moreText = urgentTasks.length > 8 ? `\n\n...and ${urgentTasks.length - 8} more urgent tasks` : '';
        
        return reply(`🔥 ${urgentTasks.length} Urgent Task${urgentTasks.length === 1 ? '' : 's'}:\n\n${urgentList}${moreText}\n\n🔗 Manage: https://witholive.app`);
      }
      
      if (queryType === 'today') {
        if (dueTodayTasks.length === 0) {
          return reply('📅 Nothing due today! You\'re all caught up.\n\n💡 Try "what\'s urgent" to see high-priority tasks');
        }
        
        const todayList = dueTodayTasks.slice(0, 8).map((t, i) => {
          const priority = t.priority === 'high' ? ' 🔥' : '';
          return `${i + 1}. ${t.summary}${priority}`;
        }).join('\n');
        
        const moreText = dueTodayTasks.length > 8 ? `\n\n...and ${dueTodayTasks.length - 8} more` : '';
        
        return reply(`📅 ${dueTodayTasks.length} Task${dueTodayTasks.length === 1 ? '' : 's'} Due Today:\n\n${todayList}${moreText}\n\n🔗 Manage: https://witholive.app`);
      }
      
      if (queryType === 'tomorrow') {
        const dayAfterTomorrow = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000);
        const dueTomorrowTasks = activeTasks.filter(t => {
          if (!t.due_date) return false;
          const dueDate = new Date(t.due_date);
          return dueDate >= tomorrow && dueDate < dayAfterTomorrow;
        });
        
        let tomorrowCalendarEvents: string[] = [];
        try {
          const { data: calConnection } = await supabase
            .from('calendar_connections')
            .select('id')
            .eq('user_id', userId)
            .eq('is_active', true)
            .limit(1)
            .single();
          
          if (calConnection) {
            const { data: events } = await supabase
              .from('calendar_events')
              .select('title, start_time, all_day')
              .eq('connection_id', calConnection.id)
              .gte('start_time', tomorrow.toISOString())
              .lt('start_time', dayAfterTomorrow.toISOString())
              .order('start_time', { ascending: true })
              .limit(10);
            
            tomorrowCalendarEvents = (events || []).map(e => {
              if (e.all_day) return `• ${e.title} (all day)`;
              const time = new Date(e.start_time).toLocaleTimeString('en-US', { 
                hour: 'numeric', minute: '2-digit', hour12: true 
              });
              return `• ${time}: ${e.title}`;
            });
          }
        } catch (calErr) {
          console.warn('[WhatsApp] Calendar fetch error for tomorrow:', calErr);
        }
        
        if (dueTomorrowTasks.length === 0 && tomorrowCalendarEvents.length === 0) {
          return reply('📅 Nothing scheduled for tomorrow! Enjoy your free day.\n\n💡 Try "what\'s urgent" to see high-priority tasks');
        }
        
        let response = '📅 Tomorrow\'s Agenda:\n';
        
        if (tomorrowCalendarEvents.length > 0) {
          response += `\n🗓️ Calendar (${tomorrowCalendarEvents.length}):\n${tomorrowCalendarEvents.join('\n')}\n`;
        }
        
        if (dueTomorrowTasks.length > 0) {
          const tomorrowList = dueTomorrowTasks.slice(0, 8).map((t, i) => {
            const priority = t.priority === 'high' ? ' 🔥' : '';
            return `${i + 1}. ${t.summary}${priority}`;
          }).join('\n');
          const moreText = dueTomorrowTasks.length > 8 ? `\n...and ${dueTomorrowTasks.length - 8} more` : '';
          response += `\n📋 Tasks Due (${dueTomorrowTasks.length}):\n${tomorrowList}${moreText}\n`;
        }
        
        if (overdueTasks.length > 0) {
          response += `\n⚠️ Also: ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''} to catch up on`;
        }
        
        response += '\n\n🔗 Manage: https://witholive.app';
        
        return reply(response);
      }
      
      if (queryType === 'this_week') {
        const endOfWeek = new Date(today);
        const daysUntilSunday = 7 - endOfWeek.getDay();
        endOfWeek.setDate(endOfWeek.getDate() + (daysUntilSunday === 0 ? 7 : daysUntilSunday) + 1);
        
        const dueThisWeekTasks = activeTasks.filter(t => {
          if (!t.due_date) return false;
          const dueDate = new Date(t.due_date);
          return dueDate >= today && dueDate < endOfWeek;
        });
        
        let weekCalendarEvents: string[] = [];
        try {
          const { data: calConnection } = await supabase
            .from('calendar_connections')
            .select('id')
            .eq('user_id', userId)
            .eq('is_active', true)
            .limit(1)
            .single();
          
          if (calConnection) {
            const { data: events } = await supabase
              .from('calendar_events')
              .select('title, start_time, all_day')
              .eq('connection_id', calConnection.id)
              .gte('start_time', today.toISOString())
              .lt('start_time', endOfWeek.toISOString())
              .order('start_time', { ascending: true })
              .limit(15);
            
            weekCalendarEvents = (events || []).map(e => {
              const eventDate = new Date(e.start_time);
              const dayName = eventDate.toLocaleDateString('en-US', { weekday: 'short' });
              if (e.all_day) return `• ${dayName}: ${e.title} (all day)`;
              const time = eventDate.toLocaleTimeString('en-US', { 
                hour: 'numeric', minute: '2-digit', hour12: true 
              });
              return `• ${dayName} ${time}: ${e.title}`;
            });
          }
        } catch (calErr) {
          console.warn('[WhatsApp] Calendar fetch error for week:', calErr);
        }
        
        if (dueThisWeekTasks.length === 0 && weekCalendarEvents.length === 0) {
          return reply('📅 Nothing scheduled for this week! Looks like a clear week ahead.\n\n💡 Try "what\'s urgent" to see high-priority tasks');
        }
        
        let response = '📅 This Week\'s Overview:\n';
        
        if (weekCalendarEvents.length > 0) {
          response += `\n🗓️ Calendar (${weekCalendarEvents.length}):\n${weekCalendarEvents.join('\n')}\n`;
        }
        
        if (dueThisWeekTasks.length > 0) {
          const weekList = dueThisWeekTasks.slice(0, 10).map((t, i) => {
            const priority = t.priority === 'high' ? ' 🔥' : '';
            const dueDate = t.due_date ? formatFriendlyDate(t.due_date, false) : '';
            return `${i + 1}. ${t.summary}${priority}${dueDate ? ` (${dueDate})` : ''}`;
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
        
        return reply(response);
      }
      
      if (queryType === 'recent') {
        if (recentTasks.length === 0) {
          const lastFive = activeTasks.slice(0, 5);
          if (lastFive.length === 0) {
            return reply('No recent tasks found. Send me something to save!');
          }
          
          const recentList = lastFive.map((t, i) => `${i + 1}. ${t.summary}`).join('\n');
          const recentResponse = `📝 Your Latest Tasks:\n\n${recentList}\n\n🔗 Manage: https://witholive.app`;
          await saveReferencedEntity(lastFive[0], recentResponse, lastFive.map(t => ({ id: t.id, summary: t.summary })));
          return reply(recentResponse);
        }
        
        const displayedRecent = recentTasks.slice(0, 8);
        const recentList = displayedRecent.map((t, i) => {
          const priority = t.priority === 'high' ? ' 🔥' : '';
          return `${i + 1}. ${t.summary}${priority}`;
        }).join('\n');
        
        const moreText = recentTasks.length > 8 ? `\n\n...and ${recentTasks.length - 8} more` : '';
        
        const recentResponse = `🕐 ${recentTasks.length} Task${recentTasks.length === 1 ? '' : 's'} Added Recently:\n\n${recentList}${moreText}\n\n🔗 Manage: https://witholive.app`;
        await saveReferencedEntity(displayedRecent[0], recentResponse, displayedRecent.map(t => ({ id: t.id, summary: t.summary })));
        return reply(recentResponse);
      }
      
      if (queryType === 'overdue') {
        if (overdueTasks.length === 0) {
          return reply('✅ No overdue tasks! You\'re on track.\n\n💡 Try "what\'s due today" to see today\'s tasks');
        }
        
        const overdueList = overdueTasks.slice(0, 8).map((t, i) => {
          const dueDate = new Date(t.due_date!);
          const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000));
          return `${i + 1}. ${t.summary} (${daysOverdue}d overdue)`;
        }).join('\n');
        
        const moreText = overdueTasks.length > 8 ? `\n\n...and ${overdueTasks.length - 8} more` : '';
        
        return reply(`⚠️ ${overdueTasks.length} Overdue Task${overdueTasks.length === 1 ? '' : 's'}:\n\n${overdueList}${moreText}\n\n🔗 Manage: https://witholive.app`);
      }

      // Default: General task summary
      let summary = `📊 Your Tasks:\n`;
      summary += `• Active: ${activeTasks.length}\n`;
      if (urgentTasks.length > 0) summary += `• Urgent: ${urgentTasks.length} 🔥\n`;
      if (dueTodayTasks.length > 0) summary += `• Due today: ${dueTodayTasks.length}\n`;
      if (overdueTasks.length > 0) summary += `• Overdue: ${overdueTasks.length} ⚠️\n`;

      if (urgentTasks.length > 0) {
        summary += `\n⚡ Urgent:\n`;
        summary += urgentTasks.slice(0, 3).map((t, i) => `${i + 1}. ${t.summary}`).join('\n');
      } else if (activeTasks.length > 0) {
        summary += `\n📝 Recent:\n`;
        summary += activeTasks.slice(0, 5).map((t, i) => `${i + 1}. ${t.summary}`).join('\n');
      }

      summary += '\n\n💡 Try: "what\'s urgent", "what\'s due today", or "show my groceries list"';

      // Save the most prominent task as entity AND the displayed numbered list for ordinal resolution
      const prominentTask = urgentTasks[0] || dueTodayTasks[0] || activeTasks[0] || null;
      const displayedTasks = urgentTasks.length > 0 ? urgentTasks.slice(0, 3) : activeTasks.slice(0, 5);
      await saveReferencedEntity(prominentTask, summary, displayedTasks.map(t => ({ id: t.id, summary: t.summary })));
      return reply(summary);
    }

    // ========================================================================
    // TASK ACTION HANDLER
    // ========================================================================
    if (intent === 'TASK_ACTION') {
      const actionType = (intentResult as any).actionType as TaskActionType;
      const actionTarget = (intentResult as any).actionTarget as string;
      const aiTaskId = (intentResult as any)._aiTaskId as string | undefined;
      console.log('[WhatsApp] Processing TASK_ACTION:', actionType, 'target:', actionTarget, 'aiTaskId:', aiTaskId);

      // Task resolution: ordinal reference → AI-provided ID → semantic search → outbound context
      let foundTask = null;

      // 0. ORDINAL RESOLUTION: "the first one", "the third one", "number 2", "#3"
      const ordinalPatterns = [
        /(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|1st|2nd|3rd|4th|5th|6th|7th|8th)\s*(?:one|task|item)?/i,
        /(?:#|number\s+|no\.?\s*)(\d+)/i,
      ];
      let ordinalIndex = -1;
      for (const pat of ordinalPatterns) {
        const m = (messageBody || '').match(pat);
        if (!m) continue;
        const val = m[1].toLowerCase();
        const ordinalMap: Record<string, number> = {
          first: 0, second: 1, third: 2, fourth: 3, fifth: 4, sixth: 5, seventh: 6, eighth: 7,
          '1st': 0, '2nd': 1, '3rd': 2, '4th': 3, '5th': 4, '6th': 5, '7th': 6, '8th': 7,
        };
        if (ordinalMap[val] !== undefined) {
          ordinalIndex = ordinalMap[val];
        } else {
          const numMatch = val.match(/\d+/);
          if (numMatch) ordinalIndex = parseInt(numMatch[0]) - 1;
        }
        break;
      }

      if (ordinalIndex >= 0) {
        const sessionCtx = (session.context_data || {}) as ConversationContext;
        if (sessionCtx.last_displayed_list && sessionCtx.list_displayed_at) {
          const listAge = Date.now() - new Date(sessionCtx.list_displayed_at).getTime();
          if (listAge < 15 * 60 * 1000) { // 15 min TTL
            if (ordinalIndex < sessionCtx.last_displayed_list.length) {
              const listItem = sessionCtx.last_displayed_list[ordinalIndex];
              const { data: listTask } = await supabase
                .from('clerk_notes')
                .select('id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time')
                .eq('id', listItem.id)
                .maybeSingle();
              if (listTask) {
                foundTask = listTask;
                console.log(`[Context] Resolved ordinal #${ordinalIndex + 1} to task: ${listTask.summary}`);
              }
            } else {
              console.log(`[Context] Ordinal #${ordinalIndex + 1} out of range (list has ${sessionCtx.last_displayed_list.length} items)`);
            }
          } else {
            console.log('[Context] Displayed list is stale (>15 min)');
          }
        } else {
          console.log('[Context] No displayed list in session for ordinal resolution');
        }
      }

      // 1. If AI provided a specific task UUID, look it up directly (fastest, most accurate)
      if (aiTaskId) {
        const { data: directTask } = await supabase
          .from('clerk_notes')
          .select('id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time')
          .eq('id', aiTaskId)
          .maybeSingle();

        if (directTask) {
          console.log('[TASK_ACTION] Direct AI task match:', directTask.summary);
          foundTask = directTask;
        }
      }

      // Check if actionTarget is a pronoun (it, that, this, lo, eso, quello)
      const isPronoun = !actionTarget || /^(it|that|this|lo|eso|quello|la|esa|questa|quello)$/i.test(actionTarget.trim());

      // 2. If no direct match, use semantic search (skip if just a pronoun)
      if (!foundTask && actionTarget && !isPronoun) {
        foundTask = await semanticTaskSearch(supabase, userId, coupleId, actionTarget);
      }

      // 3. If still no match, check session's last_referenced_entity (pronoun resolution)
      if (!foundTask) {
        const sessionCtx = (session.context_data || {}) as ConversationContext;
        if (sessionCtx.last_referenced_entity) {
          const entityAge = sessionCtx.entity_referenced_at
            ? Date.now() - new Date(sessionCtx.entity_referenced_at).getTime()
            : Infinity;
          // Only use if referenced within last 10 minutes
          if (entityAge < 10 * 60 * 1000) {
            console.log('[Context] Resolving pronoun via session last_referenced_entity:', sessionCtx.last_referenced_entity.summary);
            const { data: entityTask } = await supabase
              .from('clerk_notes')
              .select('id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time')
              .eq('id', sessionCtx.last_referenced_entity.id)
              .eq('completed', false)
              .maybeSingle();
            if (entityTask) {
              foundTask = entityTask;
            }
          }
        }
      }

      // 4. If still no match, try using recent outbound context
      if (!foundTask && recentOutbound.length > 0) {
        console.log('[Context] No task found by target, checking recent outbound context...');
        for (const outMsg of recentOutbound) {
          const extracted = extractTaskFromOutbound(outMsg);
          if (extracted) {
            const contextTask = await semanticTaskSearch(supabase, userId, coupleId, extracted);
            if (contextTask) {
              console.log('[Context] Found task via outbound context:', contextTask.summary);
              foundTask = contextTask;
              break;
            }
          }
        }
      }

      if (!foundTask && !actionTarget) {
        return reply(t('task_need_target', userLang));
      }

      if (!foundTask) {
        return reply(t('task_not_found', userLang, { query: actionTarget }));
      }
      
      switch (actionType) {
        case 'complete': {
          const { error } = await supabase
            .from('clerk_notes')
            .update({ completed: true, updated_at: new Date().toISOString() })
            .eq('id', foundTask.id);

          if (error) {
            return reply(t('error_generic', userLang));
          }

          const completeResponse = t('task_completed', userLang, { task: foundTask.summary });
          await saveReferencedEntity(foundTask, completeResponse);
          return reply(completeResponse);
        }

        case 'set_priority': {
          const msgLower = (effectiveMessage || '').toLowerCase();
          const newPriority = msgLower.includes('low') ? 'low' : 'high';
          const { error } = await supabase
            .from('clerk_notes')
            .update({ priority: newPriority, updated_at: new Date().toISOString() })
            .eq('id', foundTask.id);

          if (error) {
            return reply(t('error_generic', userLang));
          }

          const emoji = newPriority === 'high' ? '🔥' : '📌';
          const priorityResponse = t('priority_updated', userLang, { emoji, task: foundTask.summary, priority: newPriority });
          await saveReferencedEntity({ ...foundTask, priority: newPriority }, priorityResponse);
          return reply(priorityResponse);
        }
        
        case 'set_due': {
          const dateExpr = effectiveMessage || 'tomorrow';
          const parsed = parseNaturalDate(dateExpr, profile.timezone || 'America/New_York');

          // Handle time-only updates: "change it to 7 AM" → keep existing date, update time
          if (!parsed.date && foundTask.due_date) {
            const timeOnlyMatch = dateExpr.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)/i);
            if (timeOnlyMatch) {
              const existingDate = new Date(foundTask.due_date);
              let hours = parseInt(timeOnlyMatch[1]);
              const mins = timeOnlyMatch[2] ? parseInt(timeOnlyMatch[2]) : 0;
              if (timeOnlyMatch[3].toLowerCase() === 'pm' && hours < 12) hours += 12;
              if (timeOnlyMatch[3].toLowerCase() === 'am' && hours === 12) hours = 0;
              existingDate.setUTCHours(hours, mins, 0, 0);
              parsed.date = existingDate.toISOString();
              parsed.readable = formatFriendlyDate(parsed.date);
              console.log('[Context] Time-only update: keeping date from task, setting time to', hours + ':' + mins);
            }
          }

          // If still no date and no existing due_date, try using today + parsed time
          if (!parsed.date) {
            const timeOnlyMatch = dateExpr.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)/i);
            if (timeOnlyMatch) {
              const today = new Date();
              let hours = parseInt(timeOnlyMatch[1]);
              const mins = timeOnlyMatch[2] ? parseInt(timeOnlyMatch[2]) : 0;
              if (timeOnlyMatch[3].toLowerCase() === 'pm' && hours < 12) hours += 12;
              if (timeOnlyMatch[3].toLowerCase() === 'am' && hours === 12) hours = 0;
              today.setHours(hours, mins, 0, 0);
              parsed.date = today.toISOString();
              parsed.readable = formatFriendlyDate(parsed.date);
              console.log('[Context] Time-only update: using today with time', hours + ':' + mins);
            }
          }

          if (!parsed.date) {
            return reply(`I couldn't understand the date "${dateExpr}". Try "tomorrow", "monday", or "next week".`);
          }

          // Preserve conversation context alongside pending_action
          const currentCtx = (session.context_data || {}) as ConversationContext;
          await supabase
            .from('user_sessions')
            .update({
              conversation_state: 'AWAITING_CONFIRMATION',
              context_data: {
                ...currentCtx,
                pending_action: {
                  type: 'set_due_date',
                  task_id: foundTask.id,
                  task_summary: foundTask.summary,
                  date: parsed.date,
                  readable: parsed.readable
                }
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', session.id);

          const setDueResponse = `📅 Set "${foundTask.summary}" due ${parsed.readable}?\n\nReply "yes" to confirm.`;
          return reply(setDueResponse);
        }
        
        case 'assign': {
          if (!coupleId) {
            return reply('You need to be in a shared space to assign tasks. Invite a partner from the app!');
          }
          
          const { data: partnerMember } = await supabase
            .from('clerk_couple_members')
            .select('user_id')
            .eq('couple_id', coupleId)
            .neq('user_id', userId)
            .limit(1)
            .single();
          
          if (!partnerMember) {
            return reply('I couldn\'t find your partner. Make sure they\'ve accepted your invite!');
          }
          
          const { data: coupleData } = await supabase
            .from('clerk_couples')
            .select('you_name, partner_name, created_by')
            .eq('id', coupleId)
            .single();
          
          const isCreator = coupleData?.created_by === userId;
          const partnerName = isCreator ? (coupleData?.partner_name || 'Partner') : (coupleData?.you_name || 'Partner');
          
          const assignCtx = (session.context_data || {}) as ConversationContext;
          await supabase
            .from('user_sessions')
            .update({
              conversation_state: 'AWAITING_CONFIRMATION',
              context_data: {
                ...assignCtx,
                pending_action: {
                  type: 'assign',
                  task_id: foundTask.id,
                  task_summary: foundTask.summary,
                  target_user_id: partnerMember.user_id,
                  target_name: partnerName
                }
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', session.id);

          return reply(`🤝 Assign "${foundTask.summary}" to ${partnerName}?\n\nReply "yes" to confirm.`);
        }

        case 'delete': {
          const deleteCtx = (session.context_data || {}) as ConversationContext;
          await supabase
            .from('user_sessions')
            .update({
              conversation_state: 'AWAITING_CONFIRMATION',
              context_data: {
                ...deleteCtx,
                pending_action: {
                  type: 'delete',
                  task_id: foundTask.id,
                  task_summary: foundTask.summary
                }
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', session.id);

          return reply(`🗑️ Delete "${foundTask.summary}"?\n\nReply "yes" to confirm or "no" to cancel.`);
        }
        
        case 'move': {
          const targetListName = effectiveMessage?.trim();
          
          const { data: existingList } = await supabase
            .from('clerk_lists')
            .select('id, name')
            .ilike('name', `%${targetListName}%`)
            .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
            .limit(1)
            .single();
          
          if (existingList) {
            const { error } = await supabase
              .from('clerk_notes')
              .update({ list_id: existingList.id, updated_at: new Date().toISOString() })
              .eq('id', foundTask.id);

            if (!error) {
              const moveResponse = `📂 Moved "${foundTask.summary}" to ${existingList.name}!`;
              await saveReferencedEntity({ ...foundTask, list_id: existingList.id }, moveResponse);
              return reply(moveResponse);
            }
          }
          
          const { data: newList, error: createError } = await supabase
            .from('clerk_lists')
            .insert({ 
              name: targetListName, 
              author_id: userId, 
              couple_id: coupleId,
              is_manual: true
            })
            .select('id, name')
            .single();
          
          if (newList) {
            await supabase
              .from('clerk_notes')
              .update({ list_id: newList.id, updated_at: new Date().toISOString() })
              .eq('id', foundTask.id);
            
            return reply(`📂 Created "${newList.name}" list and moved "${foundTask.summary}" there!`);
          }
          
          return reply('Sorry, I couldn\'t move that task. Please try again.');
        }
        
        case 'remind': {
          const reminderExpr = actionTarget;
          const parsed = parseNaturalDate(reminderExpr, profile.timezone || 'America/New_York');
          const remindCtx = (session.context_data || {}) as ConversationContext;

          if (parsed.date) {
            await supabase
              .from('user_sessions')
              .update({
                conversation_state: 'AWAITING_CONFIRMATION',
                context_data: {
                  ...remindCtx,
                  pending_action: {
                    type: 'set_reminder',
                    task_id: foundTask.id,
                    task_summary: foundTask.summary,
                    time: parsed.date,
                    readable: parsed.readable,
                    has_due_date: !!foundTask.due_date
                  }
                },
                updated_at: new Date().toISOString()
              })
              .eq('id', session.id);

            return reply(`⏰ Set reminder for "${foundTask.summary}" ${parsed.readable}?\n\nReply "yes" to confirm.`);
          }

          const tomorrowReminder = new Date();
          tomorrowReminder.setDate(tomorrowReminder.getDate() + 1);
          tomorrowReminder.setHours(9, 0, 0, 0);

          await supabase
            .from('user_sessions')
            .update({
              conversation_state: 'AWAITING_CONFIRMATION',
              context_data: {
                ...remindCtx,
                pending_action: {
                  type: 'set_reminder',
                  task_id: foundTask.id,
                  task_summary: foundTask.summary,
                  time: tomorrowReminder.toISOString(),
                  readable: 'tomorrow at 9:00 AM',
                  has_due_date: !!foundTask.due_date
                }
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', session.id);

          return reply(`⏰ Set reminder for "${foundTask.summary}" tomorrow at 9:00 AM?\n\nReply "yes" to confirm.`);
        }
        
        default:
          return reply('I didn\'t understand that action. Try "done with [task]", "make [task] urgent", or "assign [task] to partner".');
      }
    }

    // ========================================================================
    // EXPENSE HANDLER - Quick expense logging via $ prefix
    // ========================================================================
    if (intent === 'EXPENSE') {
      console.log('[WhatsApp] Processing EXPENSE:', effectiveMessage?.substring(0, 80));
      const expenseText = effectiveMessage || '';

      // If media attached with $ prefix, route to process-receipt
      if (mediaUrls.length > 0) {
        console.log('[Expense] Media attached — routing to process-receipt');
        try {
          const { data: receiptResult } = await supabase.functions.invoke('process-receipt', {
            body: {
              image_url: mediaUrls[0],
              user_id: userId,
              couple_id: coupleId,
              caption: expenseText || undefined,
            },
          });
          if (receiptResult?.transaction) {
            const tx = receiptResult.transaction;
            let response = t('expense_logged', userLang, {
              amount: `$${Number(tx.amount).toFixed(2)}`,
              merchant: tx.merchant || 'Unknown',
              category: tx.category || 'Other',
            });
            if (receiptResult.budget_status === 'over_limit') {
              response += '\n' + t('expense_over_budget', userLang, {
                category: tx.category,
                spent: `$${receiptResult.period_spending || '?'}`,
                limit: `$${receiptResult.budget_limit || '?'}`,
              });
            }
            return reply(response);
          }
          return reply(receiptResult?.message || t('error_generic', userLang));
        } catch (e) {
          console.error('[Expense] Receipt processing error:', e);
          return reply(t('error_generic', userLang));
        }
      }

      // Parse text-based expense: "$45.50 lunch at Chipotle"
      const expenseMatch = expenseText.match(/^(\d+\.?\d*)\s+(.+)$/);
      if (!expenseMatch) {
        return reply(t('expense_need_amount', userLang));
      }

      const amount = parseFloat(expenseMatch[1]);
      const description = expenseMatch[2].trim();

      // Use AI to categorize the expense
      let merchant = description;
      let category = 'other';
      try {
        const categorizationPrompt = `Extract the merchant name and expense category from this description.
Respond with ONLY valid JSON: {"merchant": "name", "category": "one_of_these"}
Categories: food, transport, shopping, entertainment, utilities, health, groceries, travel, personal, education, subscriptions, other

Description: "${description}"`;
        const aiResult = await callAI(categorizationPrompt, description, 0.3);
        const parsed = JSON.parse(aiResult.replace(/```json?|```/g, '').trim());
        if (parsed.merchant) merchant = parsed.merchant;
        if (parsed.category) category = parsed.category;
      } catch (e) {
        console.log('[Expense] AI categorization failed, using defaults:', e);
        // Simple heuristic: check for "at" to extract merchant
        const atMatch = description.match(/(?:at|from|@)\s+(.+)$/i);
        if (atMatch) {
          merchant = atMatch[1].trim();
        }
      }

      // Insert transaction
      try {
        const { data: txData, error: txError } = await supabase
          .from('transactions')
          .insert({
            user_id: userId,
            couple_id: coupleId,
            amount,
            merchant,
            category,
            transaction_date: new Date().toISOString(),
            confidence: 0.8,
            metadata: { source: 'whatsapp_shortcut', raw_text: expenseText },
          })
          .select()
          .single();

        if (txError) {
          console.error('[Expense] Insert error:', txError);
          return reply(t('error_generic', userLang));
        }

        let response = t('expense_logged', userLang, {
          amount: `$${amount.toFixed(2)}`,
          merchant,
          category,
        });

        // Check budget status
        try {
          const { data: budgetCheck } = await supabase.rpc('check_budget_status', {
            p_user_id: userId,
            p_category: category,
            p_amount: amount,
          });
          if (budgetCheck && budgetCheck.length > 0) {
            const budget = budgetCheck[0];
            if (budget.status === 'over_limit') {
              response += '\n' + t('expense_over_budget', userLang, {
                category,
                spent: `$${Number(budget.new_total).toFixed(2)}`,
                limit: `$${Number(budget.limit_amount).toFixed(2)}`,
              });
            } else if (budget.status === 'warning') {
              response += '\n' + t('expense_budget_warning', userLang, {
                category,
                percentage: String(Math.round(budget.percentage)),
                spent: `$${Number(budget.new_total).toFixed(2)}`,
                limit: `$${Number(budget.limit_amount).toFixed(2)}`,
              });
            }
          }
        } catch (e) {
          console.log('[Expense] Budget check skipped:', e);
        }

        response += '\n\n🔗 Manage: https://witholive.app';
        return reply(response);
      } catch (e) {
        console.error('[Expense] Error:', e);
        return reply(t('error_generic', userLang));
      }
    }

    // ========================================================================
    // CONTEXTUAL ASK HANDLER - AI-powered semantic search
    // ========================================================================
    if (intent === 'CONTEXTUAL_ASK') {
      console.log('[WhatsApp] Processing CONTEXTUAL_ASK for:', effectiveMessage?.substring(0, 50));
      
      const { data: allTasks } = await supabase
        .from('clerk_notes')
        .select('id, summary, category, list_id, items, tags, priority, due_date, completed')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
        .order('created_at', { ascending: false })
        .limit(200);
      
      const { data: lists } = await supabase
        .from('clerk_lists')
        .select('id, name, description')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`);
      
      const { data: memories } = await supabase
        .from('user_memories')
        .select('title, content, category')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(15);
      
      const listIdToName = new Map(lists?.map(l => [l.id, l.name]) || []);
      
      let savedItemsContext = '\n## USER\'S LISTS AND SAVED ITEMS:\n';
      
      const tasksByList = new Map<string, any[]>();
      const uncategorizedTasks: any[] = [];
      
      allTasks?.forEach(task => {
        if (task.list_id && listIdToName.has(task.list_id)) {
          const listName = listIdToName.get(task.list_id);
          if (!tasksByList.has(listName)) {
            tasksByList.set(listName, []);
          }
          tasksByList.get(listName)!.push(task);
        } else {
          uncategorizedTasks.push(task);
        }
      });
      
      tasksByList.forEach((tasks, listName) => {
        savedItemsContext += `\n### ${listName}:\n`;
        tasks.slice(0, 20).forEach(task => {
          const status = task.completed ? '✓' : '○';
          const priority = task.priority === 'high' ? ' 🔥' : '';
          const dueInfo = task.due_date ? ` (Due: ${formatFriendlyDate(task.due_date)})` : '';
          savedItemsContext += `- ${status} ${task.summary}${priority}${dueInfo}\n`;
          
          if (task.items && task.items.length > 0) {
            task.items.slice(0, 5).forEach((item: string) => {
              savedItemsContext += `  • ${item}\n`;
            });
          }
        });
        if (tasks.length > 20) {
          savedItemsContext += `  ...and ${tasks.length - 20} more items\n`;
        }
      });
      
      if (uncategorizedTasks.length > 0) {
        savedItemsContext += `\n### Uncategorized Tasks:\n`;
        uncategorizedTasks.slice(0, 10).forEach(task => {
          const status = task.completed ? '✓' : '○';
          savedItemsContext += `- ${status} ${task.summary}\n`;
        });
      }
      
      let memoryContext = '';
      if (memories && memories.length > 0) {
        memoryContext = '\n## USER MEMORIES & PREFERENCES:\n';
        memories.forEach(m => {
          memoryContext += `- ${m.title}: ${m.content}\n`;
        });
      }
      
      // Build conversation history context for pronoun resolution
      let conversationHistoryContext = '';
      if (sessionContext.conversation_history && sessionContext.conversation_history.length > 0) {
        conversationHistoryContext = '\n## RECENT CONVERSATION (for resolving references like "it", "that", "this task"):\n';
        sessionContext.conversation_history.forEach((msg) => {
          conversationHistoryContext += `${msg.role === 'user' ? 'User' : 'Olive'}: ${msg.content}\n`;
        });
      }

      // Entity context is now handled by AI router via conversation history
      const entityContext = '';

      let systemPrompt = `You are Olive, a friendly and intelligent AI assistant for the Olive app. The user is asking a question about their saved items.

CRITICAL INSTRUCTIONS:
1. You MUST answer based on the user's actual saved data provided below
2. Be specific - reference actual item names, lists, and details from their data
3. If they ask for recommendations, ONLY suggest items from their saved lists
4. If you can't find what they're looking for in their data, say so clearly
5. Be concise (max 400 chars for WhatsApp) but helpful
6. Use emojis sparingly for warmth
7. When mentioning dates, always include the day of the week and time if available (e.g. "Friday, February 20th at 12:00 PM"), never just a bare date
8. When the user uses pronouns like "it", "that", "this task", refer to the RECENT CONVERSATION and CURRENTLY REFERENCED ENTITY sections to understand what they mean

${savedItemsContext}
${memoryContext}
${conversationHistoryContext}
${entityContext}

USER'S QUESTION: ${effectiveMessage}

Respond with helpful, specific information from their saved items. If asking for a restaurant, book, or recommendation, check their lists first!`;

      // Inject language instruction
      const ctxLangName = LANG_NAMES[userLang] || LANG_NAMES[userLang.split('-')[0]] || 'English';
      if (ctxLangName !== 'English') {
        systemPrompt += `\n\nIMPORTANT: Respond entirely in ${ctxLangName}.`;
      }

      try {
        const response = await callAI(systemPrompt, effectiveMessage || '', 0.7);

        // Store conversation context: identify which task/event was discussed
        try {
          const questionLower = (effectiveMessage || '').toLowerCase();
          const matchingTask = allTasks?.find(task => {
            const summaryLower = task.summary.toLowerCase();
            // Check if the question contains significant words from the task summary
            const taskWords = summaryLower.split(/\s+/).filter((w: string) => w.length > 3);
            const matchCount = taskWords.filter((w: string) => questionLower.includes(w)).length;
            return matchCount >= Math.min(2, taskWords.length) ||
                   questionLower.includes(summaryLower);
          });

          await saveReferencedEntity(matchingTask || null, response);
        } catch (ctxErr) {
          console.warn('[Context] Error saving context after CONTEXTUAL_ASK:', ctxErr);
        }

        return reply(response.slice(0, 1500));
      } catch (error) {
        console.error('[WhatsApp] Contextual AI error:', error);

        const searchTerms = (effectiveMessage || '').toLowerCase().split(/\s+/);
        const matchingTasks = allTasks?.filter(t =>
          searchTerms.some(term =>
            t.summary.toLowerCase().includes(term) ||
            t.items?.some((i: string) => i.toLowerCase().includes(term))
          )
        ).slice(0, 5);

        if (matchingTasks && matchingTasks.length > 0) {
          const results = matchingTasks.map(t => `• ${t.summary}`).join('\n');
          return reply(`📋 Found these matching items:\n\n${results}\n\n🔗 Manage: https://witholive.app`);
        }

        return reply('I couldn\'t find matching items in your lists. Try "show my tasks" to see everything.');
      }
    }

    // ========================================================================
    // CHAT INTENT - Context-Aware Conversational AI Responses
    // ========================================================================
    if (intent === 'CHAT') {
      const chatType = (intentResult as any).chatType as ChatType || 'general';
      console.log('[WhatsApp] Processing CHAT intent, type:', chatType, 'message:', effectiveMessage?.substring(0, 50));
      
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
      
      const { data: allTasks } = await supabase
        .from('clerk_notes')
        .select('id, summary, due_date, completed, priority, category, list_id, items, created_at, updated_at, task_owner')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
        .order('created_at', { ascending: false })
        .limit(100);
      
      const { data: memories } = await supabase
        .from('user_memories')
        .select('title, content, category, importance')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('importance', { ascending: false })
        .limit(10);
      
      const { data: patterns } = await supabase
        .from('olive_patterns')
        .select('pattern_type, pattern_data, confidence')
        .eq('user_id', userId)
        .eq('is_active', true)
        .gte('confidence', 0.6)
        .limit(5);
      
      const { data: lists } = await supabase
        .from('clerk_lists')
        .select('id, name')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`);
      
      const listIdToName = new Map(lists?.map(l => [l.id, l.name]) || []);
      
      // ================================================================
      // PARTNER CONTEXT
      // ================================================================
      let partnerContext = '';
      let partnerName = '';
      
      if (coupleId) {
        try {
          const { data: coupleData } = await supabase
            .from('clerk_couples')
            .select('you_name, partner_name, created_by')
            .eq('id', coupleId)
            .single();
          
          if (coupleData) {
            const isCreator = coupleData.created_by === userId;
            partnerName = isCreator ? (coupleData.partner_name || 'Partner') : (coupleData.you_name || 'Partner');
            
            const { data: partnerMember } = await supabase
              .from('clerk_couple_members')
              .select('user_id')
              .eq('couple_id', coupleId)
              .neq('user_id', userId)
              .limit(1)
              .single();
            
            if (partnerMember?.user_id) {
              const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
              
              const { data: partnerRecentTasks } = await supabase
                .from('clerk_notes')
                .select('summary, created_at, priority')
                .eq('author_id', partnerMember.user_id)
                .eq('couple_id', coupleId)
                .gte('created_at', twoDaysAgo.toISOString())
                .order('created_at', { ascending: false })
                .limit(5);
              
              const { data: assignedByPartner } = await supabase
                .from('clerk_notes')
                .select('summary, due_date, priority')
                .eq('couple_id', coupleId)
                .eq('author_id', partnerMember.user_id)
                .eq('task_owner', userId)
                .eq('completed', false)
                .limit(3);
              
              const { data: assignedToPartner } = await supabase
                .from('clerk_notes')
                .select('summary, due_date, priority, completed')
                .eq('couple_id', coupleId)
                .eq('author_id', userId)
                .eq('task_owner', partnerMember.user_id)
                .eq('completed', false)
                .limit(3);
              
              const partnerRecentSummaries = partnerRecentTasks?.slice(0, 3).map(t => t.summary) || [];
              const assignedToMe = assignedByPartner?.map(t => t.summary) || [];
              const myAssignments = assignedToPartner?.map(t => t.summary) || [];
              
              if (partnerRecentSummaries.length > 0 || assignedToMe.length > 0 || myAssignments.length > 0) {
                partnerContext = `
## Partner Activity (${partnerName}):
${partnerRecentSummaries.length > 0 ? `- Recently added: ${partnerRecentSummaries.join(', ')}` : ''}
${assignedToMe.length > 0 ? `- Assigned to you: ${assignedToMe.join(', ')}` : ''}
${myAssignments.length > 0 ? `- You assigned to ${partnerName}: ${myAssignments.join(', ')}` : ''}
`;
              }
            }
          }
        } catch (partnerErr) {
          console.error('[WhatsApp Chat] Partner context fetch error (non-blocking):', partnerErr);
        }
      }
      
      // ================================================================
      // CALENDAR EVENTS
      // ================================================================
      let calendarContext = '';
      let todayEvents: Array<{ title: string; start_time: string; all_day: boolean }> = [];
      let tomorrowEvents: Array<{ title: string; start_time: string; all_day: boolean }> = [];
      
      const isTomorrowQuery = /\btomorrow\b/i.test(effectiveMessage || '');
      
      if (chatType === 'briefing') {
        try {
          const { data: calConnection } = await supabase
            .from('calendar_connections')
            .select('id, calendar_name')
            .eq('user_id', userId)
            .eq('is_active', true)
            .limit(1)
            .single();
          
          if (calConnection) {
            const todayStart = today.toISOString();
            const todayEnd = tomorrow.toISOString();
            
            const { data: events } = await supabase
              .from('calendar_events')
              .select('title, start_time, end_time, all_day, location')
              .eq('connection_id', calConnection.id)
              .gte('start_time', todayStart)
              .lt('start_time', todayEnd)
              .order('start_time', { ascending: true })
              .limit(10);
            
            todayEvents = events || [];
            
            const dayAfterTomorrow = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000);
            const { data: tmrwEvents } = await supabase
              .from('calendar_events')
              .select('title, start_time, end_time, all_day, location')
              .eq('connection_id', calConnection.id)
              .gte('start_time', tomorrow.toISOString())
              .lt('start_time', dayAfterTomorrow.toISOString())
              .order('start_time', { ascending: true })
              .limit(10);
            
            tomorrowEvents = tmrwEvents || [];
            
            const formatEvents = (evts: typeof todayEvents) => evts.map(e => {
              if (e.all_day) return `• ${e.title} (all day)`;
              const time = new Date(e.start_time).toLocaleTimeString('en-US', { 
                hour: 'numeric', minute: '2-digit', hour12: true 
              });
              return `• ${time}: ${e.title}`;
            }).join('\n');
            
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
          }
        } catch (calErr) {
          console.error('[WhatsApp Chat] Calendar fetch error (non-blocking):', calErr);
        }
      }
      
      // ================================================================
      // TASK ANALYTICS
      // ================================================================
      const activeTasks = allTasks?.filter(t => !t.completed) || [];
      const completedTasks = allTasks?.filter(t => t.completed) || [];
      const urgentTasks = activeTasks.filter(t => t.priority === 'high');
      const overdueTasks = activeTasks.filter(t => t.due_date && new Date(t.due_date) < today);
      const dueTodayTasks = activeTasks.filter(t => {
        if (!t.due_date) return false;
        const dueDate = new Date(t.due_date);
        return dueDate >= today && dueDate < tomorrow;
      });
      const dueTomorrowTasks = activeTasks.filter(t => {
        if (!t.due_date) return false;
        const dueDate = new Date(t.due_date);
        const dayAfterTomorrow = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000);
        return dueDate >= tomorrow && dueDate < dayAfterTomorrow;
      });
      
      const tasksCreatedThisWeek = allTasks?.filter(t => new Date(t.created_at) >= oneWeekAgo) || [];
      const tasksCompletedThisWeek = completedTasks.filter(t => 
        t.updated_at && new Date(t.updated_at) >= oneWeekAgo
      );
      
      const categoryCount: Record<string, number> = {};
      activeTasks.forEach(t => {
        const cat = t.category || 'uncategorized';
        categoryCount[cat] = (categoryCount[cat] || 0) + 1;
      });
      const topCategories = Object.entries(categoryCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cat, count]) => `${cat}: ${count}`);
      
      const listCount: Record<string, number> = {};
      activeTasks.forEach(t => {
        if (t.list_id) {
          const listName = listIdToName.get(t.list_id) || 'Unknown';
          listCount[listName] = (listCount[listName] || 0) + 1;
        }
      });
      const topLists = Object.entries(listCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([list, count]) => `${list}: ${count}`);
      
      const taskContext = {
        total_active: activeTasks.length,
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
          : 0
      };
      
      const memoryContext = memories?.map(m => `${m.title}: ${m.content}`).join('; ') || 'No personalization data yet.';
      
      const patternContext = patterns?.map(p => {
        const data = p.pattern_data as any;
        return `${p.pattern_type}: ${data.description || JSON.stringify(data)}`;
      }).join('; ') || 'No behavioral patterns detected yet.';
      
      const topUrgentTasks = urgentTasks.slice(0, 3).map(t => t.summary);
      const topOverdueTasks = overdueTasks.slice(0, 3).map(t => t.summary);
      const topTodayTasks = dueTodayTasks.slice(0, 3).map(t => t.summary);
      
      // ================================================================
      // OLIVE SKILLS MATCHING (AI-provided skill match preferred)
      // ================================================================
      const aiSkillId = (intentResult as any)._aiSkillId as string | undefined;
      let skillMatch: SkillMatch = { matched: false };

      if (aiSkillId) {
        // AI router identified a matching skill — direct lookup by ID
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
            trigger_type: 'keyword', // For tracking purposes
            matched_value: 'ai-router',
          };
        }
      }

      // Fallback to keyword-based skill matching if AI didn't provide a match
      if (!skillMatch.matched) {
        skillMatch = await matchUserSkills(supabase, userId, effectiveMessage || '');
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
              last_used_at: new Date().toISOString()
            }, {
              onConflict: 'user_id,skill_id'
            });
        } catch (trackErr) {
          console.warn('[Skills] Failed to track usage:', trackErr);
        }
      }
      
      // ================================================================
      // SPECIALIZED SYSTEM PROMPTS BY CHAT TYPE
      // ================================================================
      let systemPrompt: string;
      let userPromptEnhancement = '';
      
      const baseContext = `
## User Task Analytics:
- Active tasks: ${taskContext.total_active}
- Urgent (high priority): ${taskContext.urgent}
- Overdue: ${taskContext.overdue}
- Due today: ${taskContext.due_today}
- Due tomorrow: ${taskContext.due_tomorrow}
- Created this week: ${taskContext.created_this_week}
- Completed this week: ${taskContext.completed_this_week}
- Completion rate: ${taskContext.completion_rate}%
- Top categories: ${taskContext.top_categories.join(', ') || 'None'}
- Top lists: ${taskContext.top_lists.join(', ') || 'None'}

## User Memories/Preferences:
${memoryContext}

## Behavioral Patterns:
${patternContext}
${partnerContext}
${skillContext}
## Current Priorities:
- Urgent tasks: ${topUrgentTasks.join(', ') || 'None'}
- Overdue tasks: ${topOverdueTasks.join(', ') || 'None'}
- Due today: ${topTodayTasks.join(', ') || 'None'}
- Due tomorrow: ${dueTomorrowTasks.slice(0, 3).map(t => t.summary).join(', ') || 'None'}

## Recent Messages from Olive (last hour):
${recentOutbound.length > 0
  ? recentOutbound.map(m => {
      const ago = Math.round((Date.now() - new Date(m.sent_at).getTime()) / 60000);
      return `- [${ago}min ago, ${m.type}]: ${m.content.substring(0, 200)}`;
    }).join('\n')
  : 'No recent messages sent'}

## Recent Conversation History:
${sessionContext.conversation_history && sessionContext.conversation_history.length > 0
  ? sessionContext.conversation_history.map(msg => `${msg.role === 'user' ? 'User' : 'Olive'}: ${msg.content}`).join('\n')
  : 'No recent conversation'}
`;
      
      switch (chatType) {
        case 'briefing':
          const briefingCalendar = calendarContext || '\n## Today\'s Calendar:\nNo calendar connected - connect in settings to see events!\n';
          const briefingPartner = partnerContext || (coupleId ? '' : '');
          
          const briefingTimeframe = isTomorrowQuery ? 'tomorrow' : 'today';
          const briefingEmoji = isTomorrowQuery ? '📅' : '🌅';
          const briefingTitle = isTomorrowQuery ? 'Tomorrow\'s Preview' : 'Morning Briefing';
          
          systemPrompt = `You are Olive, providing a comprehensive ${briefingTitle} to help the user plan.

${baseContext}
${briefingCalendar}
${briefingPartner}
Your task: Deliver a complete but concise ${briefingTitle} focused on ${briefingTimeframe} (under 600 chars for WhatsApp).

Structure your response:
${briefingEmoji} **${briefingTitle}**

1. **Schedule Snapshot**: Mention ${briefingTimeframe}'s calendar events (if any) or note a clear schedule
2. **${isTomorrowQuery ? 'Tomorrow\'s' : 'Today\'s'} Focus**: Top 2-3 priorities ${isTomorrowQuery ? 'for tomorrow' : '(overdue first, then urgent, then due today)'}
3. **Quick Stats**: ${taskContext.total_active} active tasks, ${taskContext.urgent} urgent, ${taskContext.overdue} overdue, ${taskContext.due_tomorrow} due tomorrow
${partnerName ? `4. **${partnerName} Update**: Brief note on partner's recent activity or assignments (if any)` : ''}
5. **Encouragement**: One motivating line personalized to their situation

IMPORTANT: The user asked "${effectiveMessage}". If they ask about "tomorrow", focus on TOMORROW's tasks and events, not today's.

Be warm, organized, and actionable. Use emojis thoughtfully.`;
          userPromptEnhancement = isTomorrowQuery
            ? `\n\nGive me my complete preview for tomorrow.`
            : `\n\nGive me my complete morning briefing for today.`;
          break;
          
        case 'weekly_summary':
          systemPrompt = `You are Olive, a warm AI assistant providing a personalized weekly summary. 
          
${baseContext}

Your task: Provide a concise, encouraging weekly recap (under 400 chars for WhatsApp).
Include:
1. Tasks completed vs created (celebrate wins!)
2. Current workload snapshot
3. One actionable insight based on patterns
4. Brief motivational note

Use emojis thoughtfully. Be warm but concise.`;
          break;
          
        case 'daily_focus':
          systemPrompt = `You are Olive, helping the user prioritize their day.

${baseContext}

Your task: Suggest 2-3 specific tasks to focus on today (under 400 chars).
Prioritization logic:
1. FIRST: Overdue tasks (catch up!)
2. SECOND: Urgent/high-priority tasks  
3. THIRD: Tasks due today
4. Consider user's patterns and energy levels if known

Be specific - name actual tasks. Be encouraging but direct.`;
          userPromptEnhancement = `\n\nPlease recommend my top priorities for today based on my task data.`;
          break;
          
        case 'productivity_tips':
          systemPrompt = `You are Olive, providing personalized productivity advice.

${baseContext}

Your task: Give 2-3 specific, actionable productivity tips (under 500 chars).
Personalize based on:
- Their completion rate (${taskContext.completion_rate}%)
- Their overdue tasks (${taskContext.overdue})
- Their behavioral patterns
- Their categories/lists (what they're working on)

Avoid generic advice. Be specific to THEIR situation.`;
          break;
          
        case 'progress_check':
          systemPrompt = `You are Olive, giving an honest but supportive progress report.

${baseContext}

Your task: Provide a brief progress check (under 400 chars).
Include:
1. Completion rate assessment (${taskContext.completion_rate}%)
2. What's going well (celebrate!)
3. What needs attention (gently)
4. Quick tip for improvement

Be honest but encouraging. Never shame.`;
          break;
          
        case 'motivation':
          systemPrompt = `You are Olive, a supportive and understanding AI companion.

${baseContext}

The user seems stressed or needs motivation. Your task:
1. Acknowledge their feelings warmly
2. Put their workload in perspective
3. Suggest ONE small, achievable action
4. End with genuine encouragement

Keep under 400 chars. Be empathetic, not dismissive. No toxic positivity.`;
          break;
          
        case 'planning':
          systemPrompt = `You are Olive, helping the user plan ahead.

${baseContext}

Your task: Help them see what's coming and plan effectively (under 400 chars).
Consider:
- What's due soon (today, tomorrow, this week)
- What's overdue and needs rescheduling
- Suggest breaking down large tasks if needed

Be practical and forward-looking.`;
          break;
          
        case 'greeting':
          systemPrompt = `You are Olive, a warm and friendly AI assistant.

${baseContext}

The user is greeting you. Respond warmly (under 250 chars) with:
1. A friendly greeting back
2. A quick status hint (e.g., "You've got ${taskContext.urgent} urgent items" or "Looking good today!")
3. An offer to help

Be natural and personable.`;
          break;
          
        case 'help':
          // Return help text directly — no AI call needed
          return reply(t('help_text', userLang));
          
        default: // 'general'
          systemPrompt = `You are Olive, a warm and helpful AI assistant for personal organization.

${baseContext}

Guidelines:
- Be friendly, concise, and helpful (under 350 chars for WhatsApp)
- Use the context above to personalize your response
- If they ask something you can help with (tasks, productivity), do so
- If they ask about specific tasks, use the data above
- Suggest relevant commands if appropriate ("what's urgent", "summarize my week", etc.)
- Use emojis warmly but sparingly 🫒

IMPORTANT - TASK CAPABILITIES:
Olive CAN modify tasks. You are a full task management assistant, not just a chatbot. Supported actions:
- Complete tasks ("done with groceries")
- Change due dates/times ("set dental to 7:30am", "postpone meeting to Friday")
- Change priorities ("make it urgent", "set to low priority")
- Delete tasks ("delete the dentist task")
- Assign tasks ("assign groceries to my partner")
- Set reminders ("remind me at 5pm")
If the user asks to modify a task but the action didn't execute, guide them with the right phrasing:
- "Try: 'set [task name] to [time]'" for changing due dates
- "Try: 'make [task] urgent'" for priorities
- "Try: 'done with [task]'" for completing tasks
NEVER say you cannot modify tasks, change dates, or manage their calendar. You absolutely can.`;
      }
      
      try {
        const enhancedMessage = (effectiveMessage || '') + userPromptEnhancement;
        console.log('[WhatsApp Chat] Calling AI for chatType:', chatType, 'lang:', userLang);

        // Inject language instruction into AI prompt
        const langName = LANG_NAMES[userLang] || LANG_NAMES[userLang.split('-')[0]] || 'English';
        if (langName !== 'English') {
          systemPrompt += `\n\nIMPORTANT: Respond entirely in ${langName}.`;
        }

        const chatResponse = await callAI(systemPrompt, enhancedMessage, 0.7);

        // Save conversation history (no specific entity for CHAT)
        await saveReferencedEntity(null, chatResponse);

        return reply(chatResponse.slice(0, 1500));
      } catch (error) {
        console.error('[WhatsApp] Chat AI error:', error);
        
        let fallbackMessage: string;
        switch (chatType) {
          case 'briefing':
            const calEventCount = todayEvents.length;
            const calSummary = calEventCount > 0 
              ? `📅 ${calEventCount} event${calEventCount > 1 ? 's' : ''} today`
              : '📅 Clear calendar';
            const focusList = [
              ...topOverdueTasks.slice(0, 1).map(t => `⚠️ Overdue: ${t}`),
              ...topUrgentTasks.slice(0, 1).map(t => `🔥 Urgent: ${t}`),
              ...topTodayTasks.slice(0, 1).map(t => `📌 Due today: ${t}`)
            ].slice(0, 3);
            const partnerNote = partnerName ? `\n👥 ${partnerName}'s activity in the app` : '';
            
            fallbackMessage = `🌅 Morning Briefing\n\n${calSummary}\n\n🎯 Focus:\n${focusList.length > 0 ? focusList.join('\n') : '• No urgent items!'}\n\n📊 ${taskContext.total_active} active | ${taskContext.urgent} urgent | ${taskContext.overdue} overdue${partnerNote}\n\n✨ Have a great day!`;
            break;
          case 'weekly_summary':
            fallbackMessage = `📊 Your Week:\n• Created: ${taskContext.created_this_week} tasks\n• Completed: ${taskContext.completed_this_week}\n• Active: ${taskContext.total_active} (${taskContext.urgent} urgent)\n\n💡 Try "what's urgent?" for priorities`;
            break;
          case 'daily_focus':
            if (overdueTasks.length > 0) {
              fallbackMessage = `🎯 Focus Today:\n1. Clear overdue: ${topOverdueTasks[0] || 'Check your overdue items'}\n${topTodayTasks.length > 0 ? `2. Then: ${topTodayTasks[0]}` : ''}\n\n🔗 witholive.app`;
            } else if (dueTodayTasks.length > 0) {
              fallbackMessage = `🎯 Today's Priorities:\n${topTodayTasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n✨ You've got this!`;
            } else {
              fallbackMessage = `🎯 No urgent deadlines today! Consider tackling urgent tasks:\n${topUrgentTasks[0] || 'Check your task list'}\n\n💪 Stay proactive!`;
            }
            break;
          case 'motivation':
            fallbackMessage = `💚 You're doing great! ${taskContext.completed_this_week} tasks done this week.\n\nOne step at a time. Start with just one small task - momentum builds! 🫒`;
            break;
          default:
            fallbackMessage = '🫒 Hi! I\'m Olive.\n\nTry:\n• "Morning briefing"\n• "Summarize my week"\n• "What should I focus on?"\n• "What\'s urgent?"\n\nOr just tell me what\'s on your mind!';
        }
        
        return reply(fallbackMessage);
      }
    }

    // ========================================================================
    // CREATE INTENT (Default) - Capture First
    // ========================================================================
    const notePayload: any = { 
      text: effectiveMessage || '', 
      user_id: userId,
      couple_id: coupleId,
      timezone: profile.timezone || 'America/New_York',
      force_priority: isUrgent ? 'high' : undefined
    };
    
    if (latitude && longitude) {
      notePayload.location = { latitude, longitude };
      if (notePayload.text) {
        notePayload.text = `${notePayload.text} (Location: ${latitude}, ${longitude})`;
      }
    }
    
    if (mediaUrls.length > 0) {
      notePayload.media = mediaUrls;
      notePayload.mediaTypes = mediaTypes;
      console.log('[WhatsApp] Sending', mediaUrls.length, 'media file(s) for AI processing, types:', mediaTypes);
    }

    const { data: processData, error: processError } = await supabase.functions.invoke('process-note', {
      body: notePayload
    });

    if (processError) {
      console.error('Error processing note:', processError);
      return reply('Sorry, I had trouble processing that. Please try again.');
    }

    // Insert the processed note(s) into the database
    try {
      let insertedNoteId: string | null = null;
      let insertedNoteSummary: string = '';
      let insertedListId: string | null = null;
      
      const randomTips = [
        "Reply 'Make it urgent' to change priority",
        "Reply 'Show my tasks' to see your list",
        "You can send voice notes too! 🎤",
        "Reply 'Move to Work' to switch lists",
        "Use ! prefix for urgent tasks (e.g., !call mom)"
      ];
      const getRandomTip = () => randomTips[Math.floor(Math.random() * randomTips.length)];
      
      async function getListName(listId: string | null): Promise<string> {
        if (!listId) return 'Tasks';
        
        const { data: list } = await supabase
          .from('clerk_lists')
          .select('name')
          .eq('id', listId)
          .single();
        
        return list?.name || 'Tasks';
      }
      
      if (processData.multiple && Array.isArray(processData.notes)) {
        const notesToInsert = processData.notes.map((note: any) => ({
          author_id: userId,
          couple_id: coupleId,
          original_text: messageBody || note.summary || 'Media attachment',
          summary: note.summary,
          category: note.category || 'task',
          due_date: note.due_date,
          reminder_time: note.reminder_time,
          recurrence_frequency: note.recurrence_frequency,
          recurrence_interval: note.recurrence_interval,
          priority: isUrgent ? 'high' : (note.priority || 'medium'),
          tags: note.tags || [],
          items: note.items || [],
          task_owner: note.task_owner,
          list_id: note.list_id,
          location: latitude && longitude ? { latitude, longitude } : null,
          media_urls: mediaUrls.length > 0 ? mediaUrls : null,
          completed: false
        }));

        const { data: insertedNotes, error: insertError } = await supabase
          .from('clerk_notes')
          .insert(notesToInsert)
          .select('id, summary, list_id');

        if (insertError) throw insertError;

        const primaryListId = insertedNotes?.[0]?.list_id;
        const listName = await getListName(primaryListId);
        
        const count = processData.notes.length;
        const itemsList = insertedNotes?.slice(0, 3).map(n => `• ${n.summary}`).join('\n') || '';
        const moreText = count > 3 ? `\n...and ${count - 3} more` : '';
        
        return reply(`✅ Saved ${count} items!\n${itemsList}${moreText}\n\n📂 Added to: ${listName}\n\n🔗 Manage: https://witholive.app\n\n💡 ${getRandomTip()}`);
      } else {
        const noteData = {
          author_id: userId,
          couple_id: coupleId,
          original_text: messageBody || processData.summary || 'Media attachment',
          summary: processData.summary,
          category: processData.category || 'task',
          due_date: processData.due_date,
          reminder_time: processData.reminder_time,
          recurrence_frequency: processData.recurrence_frequency,
          recurrence_interval: processData.recurrence_interval,
          priority: isUrgent ? 'high' : (processData.priority || 'medium'),
          tags: processData.tags || [],
          items: processData.items || [],
          task_owner: processData.task_owner,
          list_id: processData.list_id,
          location: latitude && longitude ? { latitude, longitude } : null,
          media_urls: mediaUrls.length > 0 ? mediaUrls : null,
          completed: false
        };

        const { data: insertedNote, error: insertError } = await supabase
          .from('clerk_notes')
          .insert(noteData)
          .select('id, summary, list_id')
          .single();

        if (insertError) throw insertError;

        insertedNoteId = insertedNote.id;
        insertedNoteSummary = insertedNote.summary;
        insertedListId = insertedNote.list_id;

        const listName = await getListName(insertedListId);

        // ================================================================
        // POST-INSERTION: Background Duplicate Detection
        // ================================================================
        let duplicateWarning: { found: boolean; targetId: string; targetTitle: string } | null = null;

        try {
          const embedding = await generateEmbedding(insertedNoteSummary);
          
          if (embedding && insertedNoteId) {
            await supabase
              .from('clerk_notes')
              .update({ embedding: JSON.stringify(embedding) })
              .eq('id', insertedNoteId);

            const similarNote = (coupleId && typeof coupleId === 'string') ? await findSimilarNotes(supabase, userId, coupleId, embedding, insertedNoteId) : null;
            
            if (similarNote) {
              duplicateWarning = {
                found: true,
                targetId: similarNote.id,
                targetTitle: similarNote.summary
              };
              console.log('[Duplicate Detection] Found similar note:', similarNote.summary, 'similarity:', similarNote.similarity);
            }
          }
        } catch (dupError) {
          console.error('Duplicate detection error (non-blocking):', dupError);
        }

        // ================================================================
        // RICH RESPONSE BUILDER
        // ================================================================
        let confirmationMessage: string;
        
        if (duplicateWarning?.found) {
          confirmationMessage = [
            `✅ Saved: ${insertedNoteSummary}`,
            `📂 Added to: ${listName}`,
            ``,
            `⚠️ Similar task found: "${duplicateWarning.targetTitle}"`,
            `Reply "Merge" to combine them.`
          ].join('\n');
        } else {
          confirmationMessage = [
            `✅ Saved: ${insertedNoteSummary}`,
            `📂 Added to: ${listName}`,
            ``,
            `🔗 Manage: https://witholive.app`,
            ``,
            `💡 ${getRandomTip()}`
          ].join('\n');
        }

        // Store newly created task as referenced entity for context follow-ups
        if (insertedNoteId) {
          await saveReferencedEntity(
            { id: insertedNoteId, summary: insertedNoteSummary, list_id: insertedListId || undefined },
            confirmationMessage
          );
        }

        return reply(confirmationMessage);
      }
    } catch (insertError) {
      console.error('Database insertion error:', JSON.stringify(insertError));
      console.error('Insert error details:', (insertError as any)?.message, (insertError as any)?.details, (insertError as any)?.hint);
      return reply('I understood your task but had trouble saving it. Please try again.');
    }

  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    // For unexpected errors, we can't send a reply via Meta API since we may not have the user info
    return new Response(JSON.stringify({ status: 'error', message: 'Internal error' }), { 
      status: 200, // Meta requires 200 even on errors to prevent retries
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});

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

type IntentResult = { intent: 'SEARCH' | 'MERGE' | 'CREATE' | 'CHAT' | 'CONTEXTUAL_ASK' | 'TASK_ACTION' | 'EXPENSE' | 'PARTNER_MESSAGE'; isUrgent?: boolean; cleanMessage?: string };

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
  task_ambiguous: {
    en: '🤔 I found multiple tasks matching "{query}":\n\n{options}\n\nWhich one did you mean? Reply with the number.',
    'es': '🤔 Encontré varias tareas que coinciden con "{query}":\n\n{options}\n\n¿Cuál querías? Responde con el número.',
    'it': '🤔 Ho trovato più attività corrispondenti a "{query}":\n\n{options}\n\nQuale intendevi? Rispondi con il numero.',
  },
  partner_message_sent: {
    en: '✅ Done! I sent {partner} a message:\n\n"{message}"\n\nvia WhatsApp 💬',
    'es': '✅ ¡Hecho! Le envié a {partner} un mensaje:\n\n"{message}"\n\nvía WhatsApp 💬',
    'it': '✅ Fatto! Ho inviato a {partner} un messaggio:\n\n"{message}"\n\nvia WhatsApp 💬',
  },
  partner_message_and_task: {
    en: '✅ Done! I told {partner} and saved a task:\n\n📋 "{task}"\n📂 Assigned to: {partner}\n💬 Notified via WhatsApp',
    'es': '✅ ¡Hecho! Le dije a {partner} y guardé una tarea:\n\n📋 "{task}"\n📂 Asignado a: {partner}\n💬 Notificado vía WhatsApp',
    'it': '✅ Fatto! Ho detto a {partner} e salvato un\'attività:\n\n📋 "{task}"\n📂 Assegnato a: {partner}\n💬 Notificato via WhatsApp',
  },
  partner_no_phone: {
    en: '😕 I\'d love to message {partner}, but they haven\'t linked their WhatsApp yet.\n\nAsk them to open Olive → Profile → Link WhatsApp.',
    'es': '😕 Me encantaría enviarle un mensaje a {partner}, pero aún no ha vinculado su WhatsApp.\n\nPídele que abra Olive → Perfil → Vincular WhatsApp.',
    'it': '😕 Vorrei mandare un messaggio a {partner}, ma non ha ancora collegato il suo WhatsApp.\n\nChiedigli di aprire Olive → Profilo → Collega WhatsApp.',
  },
  partner_no_space: {
    en: 'You need to be in a shared space to send messages to your partner. Invite them from the app!',
    'es': 'Necesitas estar en un espacio compartido para enviar mensajes a tu pareja. ¡Invítale desde la app!',
    'it': 'Devi essere in uno spazio condiviso per inviare messaggi al tuo partner. Invitalo dall\'app!',
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

/**
 * Get outbound context with task_id (stored by send-reminders)
 * This is the most reliable way to resolve bare replies to reminders
 */
async function getOutboundContextWithTaskId(
  supabase: any,
  userId: string
): Promise<{ task_id: string; task_summary: string; all_task_ids?: Array<{ id: string; summary: string }> } | null> {
  try {
    const { data: profile } = await supabase
      .from('clerk_profiles')
      .select('last_outbound_context')
      .eq('id', userId)
      .single();

    const ctx = profile?.last_outbound_context;
    if (!ctx?.task_id) return null;

    // Only use if sent within last 60 minutes
    const sentAt = ctx.sent_at || '';
    if (sentAt && new Date(sentAt).getTime() < Date.now() - 60 * 60 * 1000) {
      console.log('[Context] Outbound context with task_id is stale (>60min)');
      return null;
    }

    return {
      task_id: ctx.task_id,
      task_summary: ctx.task_summary || '',
      all_task_ids: ctx.all_task_ids || undefined,
    };
  } catch (e) {
    console.error('[Context] Error reading outbound context task_id:', e);
    return null;
  }
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
// CHAT TYPE DETECTION - Lightweight fallback (AI handles this natively now)
// ============================================================================
function detectChatType(message: string): ChatType {
  const lower = message.toLowerCase();
  // Only handle the most obvious patterns as fallback — AI does the real work
  if (/^(who\s+are\s+you|what\s+can\s+you\s+do|help\b|commands)/i.test(lower)) return 'help';
  if (/^(hi|hello|hey)\s*[!.]?$/i.test(lower)) return 'greeting';
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
    partner_message_content: string | null;
    partner_action: string | null;
  };
  confidence: number;
  reasoning: string;
}

const intentClassificationSchema = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      enum: ['search', 'create', 'complete', 'set_priority', 'set_due', 'delete', 'move', 'assign', 'remind', 'expense', 'chat', 'contextual_ask', 'merge', 'partner_message'],
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

    const systemPrompt = `You are the intent classifier for Olive, an AI personal assistant that helps people manage their lives. You are the "brain" that decides what action to take. Classify the user's message into exactly ONE intent. Return structured JSON.

You are NOT a rigid command parser. You understand natural, conversational language — the user talks to you like a friend or personal assistant. Interpret the MEANING behind their words, not just keywords.

## INTENTS:
- "search": User wants to see/find/list their tasks, items, or lists (e.g., "what's urgent?", "show my tasks", "what's due today?", "groceries list", "my tasks")
- "create": User wants to save something new — a task, note, idea, or brain-dump (e.g., "buy milk", "call mom tomorrow", "reminder to pick up dry cleaning")
- "complete": User wants to mark a task as done (e.g., "done with groceries", "finished!", "the dentist one is done", "cancel the last task" when they mean it's done)
- "set_priority": User wants to change importance (e.g., "make it urgent", "this is important", "low priority")
- "set_due": User wants to change when something is due (e.g., "change it to 7:30 AM", "postpone to Friday", "move it to tomorrow", "reschedule", "can you set it for next week?")
- "delete": User wants to remove/cancel a task (e.g., "delete the dentist task", "never mind about that", "remove it", "cancel that")
- "move": User wants to move a task to a different list (e.g., "move it to groceries", "put it in the work list")
- "assign": User wants to assign a task to their partner (e.g., "give this to Marcus", "assign it to my partner", "let her handle it")
- "remind": User wants a reminder — EITHER on an existing task OR creating a new one with a reminder. Examples: "remind me at 5 PM" (existing context), "remind me about this tomorrow" (existing task), "Moonswatch - remind me to check it out on March 6th" (NEW item + reminder), "remind me to call the dentist next Monday" (NEW task + reminder). Use target_task_name for the subject/task name and due_date_expression for the time. The system will auto-create a new task if no existing one matches.
- "expense": User wants to log spending (e.g., "spent $45 on dinner", "$20 gas")
- "chat": User wants conversational interaction — briefings, motivation, planning, greetings (e.g., "good morning", "how am I doing?", "summarize my week", "what should I focus on?", "help me plan my day")
- "contextual_ask": User is asking a question about their saved data or wants AI-powered advice (e.g., "when is the dentist?", "what restaurants did I save?", "any date ideas?", "what books are on my list?")
- "merge": User wants to merge duplicate tasks (exactly "merge")
- "partner_message": User wants to send a message TO their partner via Olive (e.g., "remind Marco to buy lemons", "tell Almu to pick up the kids", "ask partner to call the dentist", "let Marcus know dinner is ready", "dile a Marco que compre limones", "ricorda a Marco di comprare i limoni"). The user is asking YOU to relay a message or task to their partner. Set partner_message_content to the message/task for the partner, and partner_action to the type (remind/tell/ask/notify).

## CRITICAL RULES:
1. **Conversational context is king.** Use CONVERSATION HISTORY to resolve "it", "that", "this", "the last one", pronouns in any language. If someone says "cancel it" after discussing a task, the target is that task.
2. **Match tasks PRECISELY.** Use ACTIVE TASKS to find which task the user refers to. The user's query words must closely match the task summary. If the user says "Dental Milka complete", match ONLY tasks whose summary contains BOTH "Dental" AND "Milka" — do NOT match tasks that only contain "Milka" (e.g., "Research The Happy Howl for Milka" is NOT a match for "Dental Milka"). Return the UUID in target_task_id. If multiple tasks match equally well (e.g., "Milka Dental" and "Dental Milka"), return target_task_id as null and set target_task_name to the user's query — the system will handle disambiguation.
3. **Use memories for personalization.** MEMORIES tell you who Marcus is, what Milka is (a dog?), dietary preferences, etc. Use this to disambiguate.
4. **"Cancel" is context-dependent.** "Cancel the dentist" = delete. "Cancel that" after a reminder = delete. But "cancel my subscription" = probably create (a task to cancel).
5. **Time expressions = set_due, not create.** "Change it to 7am", "move it to Friday", "postpone", "reschedule" → always set_due. The word "change/move/postpone" implies modifying existing, never creating.
6. **Relative references.** "Last task", "the latest one", "previous task", "l'ultima attività", "última tarea" → preserve the EXACT phrase in target_task_name. The system resolves it. These are action intents, never "create".
7. **Questions about data = contextual_ask.** "When is X?", "What did I save about Y?", "Do I have any Z?" → contextual_ask.
8. **Ambiguity → lean towards the most helpful intent.** If someone says "groceries" with no verb, check context: after "show me" → search. After nothing → probably search (they want to see their grocery list). Only classify as "create" if it clearly reads as a new item to save.
9. **Language:** The user speaks ${userLanguage}. Understand their message natively in that language.
10. **Confidence:** 0.9+ clear, 0.7-0.9 moderate, 0.5-0.7 uncertain, <0.5 very ambiguous.
11. For chat_type, use: briefing, weekly_summary, daily_focus, productivity_tips, progress_check, motivation, planning, greeting, general.

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
): IntentResult & { queryType?: string; chatType?: string; actionType?: string; actionTarget?: string; cleanMessage?: string; _aiTaskId?: string; _aiSkillId?: string; _listName?: string; _partnerAction?: string } {
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
        actionType: 'remind',
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

    case 'partner_message':
      return {
        intent: 'PARTNER_MESSAGE',
        cleanMessage: params.partner_message_content || ai.target_task_name || undefined,
        _partnerAction: params.partner_action || 'tell',
      };

    case 'create':
    default:
      return {
        intent: 'CREATE',
        isUrgent: params.is_urgent || false,
        _aiSkillId: ai.matched_skill_id || undefined,
      };
  }
}

// ============================================================================
// MINIMAL DETERMINISTIC FALLBACK
// Only handles: shortcuts (+, !, $, ?, /, @), "merge", "help", and bare greetings.
// Everything else defaults to CREATE — the AI classifier handles all natural language.
// ============================================================================
function determineIntent(message: string, hasMedia: boolean): IntentResult & { queryType?: QueryType; chatType?: ChatType; actionType?: TaskActionType; actionTarget?: string } {
  const normalized = normalizeText(message.trim());
  const lower = normalized.toLowerCase();

  console.log('[Intent Fallback] Message:', normalized.substring(0, 80));

  // 1. Shortcut prefixes (+, !, $, ?, /, @)
  const firstChar = normalized.charAt(0);
  if (SHORTCUTS[firstChar]) {
    const shortcut = SHORTCUTS[firstChar];
    console.log(`[Intent Fallback] Shortcut: ${firstChar} → ${shortcut.label}`);
    return {
      intent: shortcut.intent as any,
      cleanMessage: normalized.slice(1).trim(),
      ...(shortcut.options || {}),
    };
  }

  // 2. Exact commands
  if (lower === 'merge') return { intent: 'MERGE' };
  if (/^(help|commands|what can you do)\s*[?!.]?$/i.test(lower)) {
    return { intent: 'CHAT', chatType: 'help', cleanMessage: normalized };
  }

  // 3. Bare greetings (no AI call needed)
  if (/^(hi|hello|hey)\s*[!.]?$/i.test(lower)) {
    return { intent: 'CHAT', chatType: 'greeting', cleanMessage: normalized };
  }

  // 4. Everything else → CREATE (default). The AI classifier should have caught
  //    all natural language intents before reaching this fallback.
  console.log('[Intent Fallback] No shortcut matched → CREATE (default)');
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

  // Word-to-number map for natural language ("in one hour", "in two minutes")
  const wordToNum: Record<string, number> = {
    'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11,
    'twelve': 12, 'fifteen': 15, 'twenty': 20, 'thirty': 30, 'forty': 40,
    'forty-five': 45, 'forty five': 45, 'sixty': 60, 'ninety': 90,
    // Spanish
    'un': 1, 'una': 1, 'uno': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
    'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10, 'quince': 15,
    'veinte': 20, 'treinta': 30, 'media': 0.5,
    // Italian
    'un\'': 1, 'mezza': 0.5, 'mezz\'ora': 0.5, 'due': 2, 'tre_it': 3, 'quattro': 4,
    'cinque': 5, 'sei': 6, 'sette': 7, 'otto': 8, 'nove': 9, 'dieci': 10,
    'quindici': 15, 'venti': 20, 'trenta': 30,
  };

  // Helper: resolve a number token (digit string or word)
  function resolveNumber(token: string): number | null {
    const n = parseInt(token);
    if (!isNaN(n)) return n;
    return wordToNum[token.toLowerCase()] ?? null;
  }
  
  const monthNames: Record<string, number> = {
    'january': 0, 'jan': 0, 'february': 1, 'feb': 1, 'march': 2, 'mar': 2,
    'april': 3, 'apr': 3, 'may': 4, 'june': 5, 'jun': 5, 'july': 6, 'jul': 6,
    'august': 7, 'aug': 7, 'september': 8, 'sep': 8, 'sept': 8,
    'october': 9, 'oct': 9, 'november': 10, 'nov': 10, 'december': 11, 'dec': 11,
    // Spanish
    'enero': 0, 'febrero': 1, 'marzo': 2, 'abril': 3, 'mayo': 4, 'junio': 5,
    'julio': 6, 'agosto': 7, 'septiembre': 8, 'octubre': 9, 'noviembre': 10, 'diciembre': 11,
    // Italian
    'gennaio': 0, 'febbraio': 1, 'marzo_it': 2, 'aprile': 3, 'maggio': 4, 'giugno': 5,
    'luglio': 6, 'settembre': 8, 'ottobre': 9, 'novembre': 10, 'dicembre': 11,
  };
  
  const getNextDayOfWeek = (dayName: string): Date => {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    // Also handle Spanish/Italian day names
    const dayMap: Record<string, number> = {
      'sunday': 0, 'sun': 0, 'monday': 1, 'mon': 1, 'tuesday': 2, 'tue': 2, 'wednesday': 3, 'wed': 3,
      'thursday': 4, 'thu': 4, 'friday': 5, 'fri': 5, 'saturday': 6, 'sat': 6,
      // Spanish
      'domingo': 0, 'lunes': 1, 'martes': 2, 'miércoles': 3, 'miercoles': 3, 'jueves': 4, 'viernes': 5, 'sábado': 6, 'sabado': 6,
      // Italian
      'domenica': 0, 'lunedì': 1, 'lunedi': 1, 'martedì': 2, 'martedi': 2, 'mercoledì': 3, 'mercoledi': 3,
      'giovedì': 4, 'giovedi': 4, 'venerdì': 5, 'venerdi': 5, 'sabato_it': 6,
    };
    const targetDay = dayMap[dayName.toLowerCase()] ?? days.indexOf(dayName.toLowerCase());
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
  
  // Parse explicit time (e.g., "3pm", "10:30 AM", "15:00")
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
  
  // Named time-of-day keywords (multilingual)
  if (lowerExpr.includes('morning') || lowerExpr.includes('mañana') || lowerExpr.includes('mattina')) { hours = hours ?? 9; }
  else if (/\bnoon\b/.test(lowerExpr) || /\bmidday\b/.test(lowerExpr) || /\bmezzogiorno\b/.test(lowerExpr) || /\bmediodía\b/.test(lowerExpr) || /\bmediodia\b/.test(lowerExpr)) { hours = hours ?? 12; minutes = 0; }
  else if (lowerExpr.includes('afternoon') || lowerExpr.includes('pomeriggio') || lowerExpr.includes('tarde')) { hours = hours ?? 14; }
  else if (lowerExpr.includes('evening') || lowerExpr.includes('sera') || lowerExpr.includes('noche')) { hours = hours ?? 18; }
  else if (lowerExpr.includes('night') || lowerExpr.includes('notte')) { hours = hours ?? 20; }
  else if (lowerExpr.includes('midnight') || lowerExpr.includes('mezzanotte') || lowerExpr.includes('medianoche')) { hours = hours ?? 0; minutes = 0; }
  
  let targetDate: Date | null = null;
  let readable = '';
  
  // === RELATIVE TIME EXPRESSIONS (highest priority) ===
  // "in X minutes/hours/days" with digits or words
  const relativePatterns = [
    // "in 30 minutes", "in one hour", "in a minute"
    /in\s+([\w'-]+(?:\s+[\w'-]+)?)\s*(?:min(?:ute)?s?|minuto?s?|minut[io])/i,
    /in\s+([\w'-]+(?:\s+[\w'-]+)?)\s*(?:hours?|hrs?|or[ae]s?|or[ae])/i,
    /in\s+([\w'-]+(?:\s+[\w'-]+)?)\s*(?:days?|días?|dias?|giorn[io])/i,
    // "half an hour", "half hour", "mezz'ora", "media hora"  
    /(?:half\s+(?:an?\s+)?hour|mezz'?ora|media\s+hora)/i,
  ];

  const halfHourMatch = lowerExpr.match(relativePatterns[3]);
  if (halfHourMatch) {
    targetDate = new Date(now);
    targetDate.setMinutes(targetDate.getMinutes() + 30);
    readable = 'in 30 minutes';
    hours = targetDate.getHours();
    minutes = targetDate.getMinutes();
  }

  if (!targetDate) {
    const minMatch = lowerExpr.match(relativePatterns[0]);
    if (minMatch) {
      const num = resolveNumber(minMatch[1].trim());
      if (num !== null) {
        targetDate = new Date(now);
        targetDate.setMinutes(targetDate.getMinutes() + Math.round(num));
        readable = `in ${Math.round(num)} minutes`;
        hours = targetDate.getHours();
        minutes = targetDate.getMinutes();
      }
    }
  }

  if (!targetDate) {
    const hrMatch = lowerExpr.match(relativePatterns[1]);
    if (hrMatch) {
      const num = resolveNumber(hrMatch[1].trim());
      if (num !== null) {
        targetDate = new Date(now);
        if (num === 0.5) {
          targetDate.setMinutes(targetDate.getMinutes() + 30);
          readable = 'in 30 minutes';
        } else {
          targetDate.setHours(targetDate.getHours() + Math.round(num));
          readable = `in ${Math.round(num)} hour${num > 1 ? 's' : ''}`;
        }
        hours = targetDate.getHours();
        minutes = targetDate.getMinutes();
      }
    }
  }

  if (!targetDate) {
    const dayMatch = lowerExpr.match(relativePatterns[2]);
    if (dayMatch) {
      const num = resolveNumber(dayMatch[1].trim());
      if (num !== null) {
        targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + Math.round(num));
        readable = `in ${Math.round(num)} day${num > 1 ? 's' : ''}`;
      }
    }
  }

  // === NAMED DATE EXPRESSIONS ===
  if (!targetDate) {
    if (lowerExpr.includes('today') || lowerExpr.includes('hoy') || lowerExpr.includes('oggi')) {
      targetDate = new Date(now);
      readable = 'today';
    } else if (lowerExpr.includes('tomorrow') || /\bmañana\b/.test(lowerExpr) || lowerExpr.includes('domani')) {
      targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + 1);
      readable = 'tomorrow';
    } else if (lowerExpr.includes('day after tomorrow') || lowerExpr.includes('pasado mañana') || lowerExpr.includes('dopodomani')) {
      targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + 2);
      readable = 'day after tomorrow';
    } else if (lowerExpr.includes('next week') || lowerExpr.includes('próxima semana') || lowerExpr.includes('prossima settimana') || lowerExpr.includes('la semana que viene') || lowerExpr.includes('settimana prossima')) {
      targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + 7);
      readable = 'next week';
    } else if (lowerExpr.includes('in a week') || lowerExpr.includes('in 1 week') || lowerExpr.includes('en una semana') || lowerExpr.includes('tra una settimana') || lowerExpr.includes('fra una settimana')) {
      targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + 7);
      readable = 'in a week';
    } else if (lowerExpr.includes('this weekend') || lowerExpr.includes('este fin de semana') || lowerExpr.includes('questo weekend') || lowerExpr.includes('questo fine settimana')) {
      targetDate = new Date(now);
      const currentDay = targetDate.getDay();
      const daysUntilSaturday = currentDay === 6 ? 0 : (6 - currentDay);
      targetDate.setDate(targetDate.getDate() + daysUntilSaturday);
      readable = 'this weekend';
    } else if (lowerExpr.includes('next month') || lowerExpr.includes('próximo mes') || lowerExpr.includes('prossimo mese') || lowerExpr.includes('il mese prossimo')) {
      targetDate = new Date(now);
      targetDate.setMonth(targetDate.getMonth() + 1);
      readable = 'next month';
    }
  }

  // === MONTH + DAY EXPRESSIONS ===
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
  
  // === DAY-OF-WEEK ===
  if (!targetDate) {
    const allDayNames = [
      'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
      'sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat',
      'domingo', 'lunes', 'martes', 'miércoles', 'miercoles', 'jueves', 'viernes', 'sábado', 'sabado',
      'domenica', 'lunedì', 'lunedi', 'martedì', 'martedi', 'mercoledì', 'mercoledi', 'giovedì', 'giovedi', 'venerdì', 'venerdi',
    ];
    for (const day of allDayNames) {
      if (lowerExpr.includes(day)) {
        targetDate = getNextDayOfWeek(day);
        const displayDay = day.charAt(0).toUpperCase() + day.slice(1);
        readable = `next ${displayDay}`;
        break;
      }
    }
  }

  // === STANDALONE TIME (no date) → default to TODAY ===
  // This handles "at noon", "at 3pm", "at 10:30", etc.
  // IMPORTANT: Compare in the user's local timezone, not UTC
  if (!targetDate && hours !== null) {
    targetDate = new Date(now);
    
    // Get the current hour/minute in the user's timezone to compare correctly
    let localHour: number, localMinute: number;
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric', minute: 'numeric', hour12: false
      }).formatToParts(now);
      localHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
      localMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
    } catch {
      localHour = now.getHours();
      localMinute = now.getMinutes();
    }
    
    const proposedMinutes = hours * 60 + minutes;
    const currentMinutes = localHour * 60 + localMinute;
    
    if (proposedMinutes <= currentMinutes) {
      // Time has already passed today in the user's timezone → tomorrow
      targetDate.setDate(targetDate.getDate() + 1);
      readable = 'tomorrow';
    } else {
      readable = 'today';
    }
  }
  
  // === APPLY TIME (timezone-aware) ===
  // Convert user's intended local time to the correct UTC time
  if (targetDate && hours !== null) {
    // First set the hours naively
    targetDate.setHours(hours, minutes, 0, 0);
    
    // Now adjust for timezone offset: the user means this time in THEIR timezone
    // Calculate the offset between UTC and user's timezone
    try {
      const utcStr = targetDate.toLocaleString('en-US', { timeZone: 'UTC' });
      const tzStr = targetDate.toLocaleString('en-US', { timeZone: timezone });
      const utcDate = new Date(utcStr);
      const tzDate = new Date(tzStr);
      const offsetMs = utcDate.getTime() - tzDate.getTime();
      // Shift targetDate so that when stored as UTC, it represents the correct local time
      targetDate = new Date(targetDate.getTime() + offsetMs);
    } catch {
      // If timezone conversion fails, keep as-is
    }
    
    // Only add time to readable if it wasn't already set by relative time parsing
    if (!readable.includes('minute') && !readable.includes('hour')) {
      readable += ` at ${hours > 12 ? hours - 12 : hours === 0 ? 12 : hours}:${minutes.toString().padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
    }
  } else if (targetDate && hours === null) {
    // For relative time (in X minutes/hours), hours are already set
    if (!readable.includes('minute') && !readable.includes('hour')) {
      // Default to 9 AM in user's timezone
      targetDate.setHours(9, 0, 0, 0);
      try {
        const utcStr = targetDate.toLocaleString('en-US', { timeZone: 'UTC' });
        const tzStr = targetDate.toLocaleString('en-US', { timeZone: timezone });
        const utcDate = new Date(utcStr);
        const tzDate = new Date(tzStr);
        const offsetMs = utcDate.getTime() - tzDate.getTime();
        targetDate = new Date(targetDate.getTime() + offsetMs);
      } catch { /* keep as-is */ }
      readable += ' at 9:00 AM';
    }
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

// ============================================================================
// RELATIVE REFERENCE RESOLUTION
// Handles: "last task", "the last one", "latest task", "previous task",
//          "most recent task", "that task I just added", etc.
// Returns the most recently created active task for the user.
// ============================================================================
const RELATIVE_REFERENCE_PATTERNS = [
  /^(?:the\s+)?(?:last|latest|most\s+recent|previous|newest|recent)\s+(?:task|one|item|note|thing)$/i,
  /^(?:the\s+)?(?:last|latest|most\s+recent|previous|newest|recent)\s+(?:task|one|item|note|thing)\s+(?:i\s+)?(?:added|created|saved|sent|made)$/i,
  /^(?:that|the)\s+(?:task|one|item|note|thing)\s+(?:i\s+)?(?:just\s+)?(?:added|created|saved|sent|made)$/i,
  /^(?:the\s+)?(?:one|task|item|note)\s+(?:i\s+)?(?:just\s+)?(?:added|created|saved|sent)$/i,
  /^(?:l'ultima|l'ultimo|ultima|ultimo)\s*(?:attività|compito|nota|cosa)?$/i, // Italian
  /^(?:la\s+)?(?:última|ultimo|reciente)\s*(?:tarea|nota|cosa)?$/i, // Spanish
];

function isRelativeReference(target: string): boolean {
  if (!target) return false;
  return RELATIVE_REFERENCE_PATTERNS.some(p => p.test(target.trim()));
}

async function resolveRelativeReference(
  supabase: any,
  userId: string,
  coupleId: string | null,
  completedFilter: boolean = false
): Promise<any | null> {
  try {
    let query = supabase
      .from('clerk_notes')
      .select('id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time, list_id, created_at')
      .eq('completed', completedFilter)
      .order('created_at', { ascending: false })
      .limit(1);

    if (coupleId) {
      query = query.eq('couple_id', coupleId);
    } else {
      query = query.eq('author_id', userId);
    }

    const { data, error } = await query;
    if (error || !data || data.length === 0) return null;

    console.log('[RelativeRef] Resolved "last task" to:', data[0].summary, '(id:', data[0].id, ')');
    return data[0];
  } catch (e) {
    console.error('[RelativeRef] Error:', e);
    return null;
  }
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

// ============================================================================
// MATCH QUALITY VERIFICATION
// Checks if a found task actually matches the user's query well enough.
// Uses normalized word overlap to prevent false positives.
// ============================================================================
function computeMatchQuality(query: string, taskSummary: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const queryWords = new Set(normalize(query).split(/\s+/).filter(w => w.length > 1));
  const taskWords = new Set(normalize(taskSummary).split(/\s+/).filter(w => w.length > 1));
  
  if (queryWords.size === 0) return 0;
  
  let matchedWords = 0;
  for (const qw of queryWords) {
    for (const tw of taskWords) {
      if (tw === qw || tw.includes(qw) || qw.includes(tw)) {
        matchedWords++;
        break;
      }
    }
  }
  
  // What fraction of query words matched?
  return matchedWords / queryWords.size;
}

// Semantic task search using hybrid_search_notes RPC (vector + full-text)
// Returns multiple candidates for ambiguity detection
interface TaskCandidate {
  id: string;
  summary: string;
  priority: string;
  completed: boolean;
  task_owner: string | null;
  author_id: string;
  couple_id: string | null;
  due_date: string | null;
  reminder_time: string | null;
  score?: number;
  matchQuality?: number;
}

async function semanticTaskSearchMulti(
  supabase: any,
  userId: string,
  coupleId: string | null,
  queryString: string,
  limit: number = 5
): Promise<TaskCandidate[]> {
  try {
    console.log('[semanticTaskSearch] Searching for:', queryString);

    const embedding = await generateEmbedding(queryString);
    let candidates: TaskCandidate[] = [];

    if (embedding) {
      const { data, error } = await supabase.rpc('hybrid_search_notes', {
        p_user_id: userId,
        p_couple_id: coupleId,
        p_query: queryString,
        p_query_embedding: JSON.stringify(embedding),
        p_vector_weight: 0.7,
        p_limit: limit
      });

      if (!error && data && data.length > 0) {
        candidates = data.filter((t: any) => !t.completed).map((t: any) => ({
          ...t,
          matchQuality: computeMatchQuality(queryString, t.summary),
        }));
      }

      if (error) {
        console.warn('[semanticTaskSearch] Hybrid search error:', error);
      }
    }

    // Fallback: text-only search
    if (candidates.length === 0) {
      console.log('[semanticTaskSearch] Falling back to text-only search');
      const { data: textData, error: textError } = await supabase.rpc('hybrid_search_notes', {
        p_user_id: userId,
        p_couple_id: coupleId,
        p_query: queryString,
        p_query_embedding: JSON.stringify(new Array(1536).fill(0)),
        p_vector_weight: 0.0,
        p_limit: limit
      });

      if (!textError && textData && textData.length > 0) {
        candidates = textData.filter((t: any) => !t.completed).map((t: any) => ({
          ...t,
          matchQuality: computeMatchQuality(queryString, t.summary),
        }));
      }
    }

    // Final fallback: keyword search (return all scored > 0)
    if (candidates.length === 0) {
      console.log('[semanticTaskSearch] No semantic match, falling back to keyword search');
      const keywords = queryString.split(/\s+/).filter(w => w.length > 2);
      if (keywords.length > 0) {
        let query = supabase
          .from('clerk_notes')
          .select('id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time')
          .eq('completed', false)
          .order('created_at', { ascending: false })
          .limit(50);
        if (coupleId) { query = query.eq('couple_id', coupleId); }
        else { query = query.eq('author_id', userId); }
        const { data: tasks } = await query;
        if (tasks) {
          candidates = tasks
            .map((task: any) => {
              const mq = computeMatchQuality(queryString, task.summary);
              return { ...task, matchQuality: mq, score: mq };
            })
            .filter((t: any) => t.matchQuality > 0)
            .sort((a: any, b: any) => b.matchQuality - a.matchQuality)
            .slice(0, limit);
        }
      }
    }

    // Log candidates
    for (const c of candidates.slice(0, 5)) {
      console.log(`[semanticTaskSearch] Candidate: "${c.summary}" score=${c.score?.toFixed(3)} matchQ=${c.matchQuality?.toFixed(2)}`);
    }

    return candidates;
  } catch (error) {
    console.error('[semanticTaskSearch] Error:', error);
    return [];
  }
}

// Legacy single-result wrapper (used by outbound context resolution etc.)
async function semanticTaskSearch(
  supabase: any,
  userId: string,
  coupleId: string | null,
  queryString: string
): Promise<any | null> {
  const candidates = await semanticTaskSearchMulti(supabase, userId, coupleId, queryString, 5);
  if (candidates.length === 0) return null;
  
  // Only return if match quality is decent (>= 50% word overlap)
  const best = candidates[0];
  if ((best.matchQuality ?? 1) < 0.4) {
    console.log(`[semanticTaskSearch] Best match "${best.summary}" has low quality ${best.matchQuality?.toFixed(2)}, rejecting`);
    return null;
  }
  return best;
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

  // ==========================================================================
  // ASYNC ACKNOWLEDGMENT PATTERN
  // Meta requires 200 OK within ~3 seconds or it retries the webhook.
  // Our LLM processing takes 5-30s. Solution:
  //   1. Parse the JSON payload (fast, <1ms)
  //   2. Return 200 "EVENT_RECEIVED" immediately
  //   3. Use EdgeRuntime.waitUntil() to process in the background
  // ==========================================================================

  let webhookBody: any;
  try {
    webhookBody = await req.json();
  } catch (parseErr) {
    console.error('[Meta Webhook] Failed to parse JSON body:', parseErr);
    return new Response('EVENT_RECEIVED', { status: 200 });
  }

  console.log('[Meta Webhook] Received:', JSON.stringify(webhookBody).substring(0, 500));

  // Extract message data from Meta's nested structure
  const messageData = extractMetaMessage(webhookBody);

  if (!messageData) {
    // Status update (delivered, read, etc.) — nothing to process
    console.log('[Meta Webhook] No message to process (status update or empty)');
    return new Response('EVENT_RECEIVED', { status: 200 });
  }

  // ── Acknowledge Meta IMMEDIATELY — processing continues in background ──
  console.log('[Meta Webhook] ✅ Webhook Acknowledged — returning 200 to Meta');

  // Declare the background processing promise
  const backgroundProcessing = (async () => {
    console.log('[Meta Webhook] 🔄 Background Processing Started');

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN')!;
    const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { fromNumber: rawFromNumber, messageBody: rawMessageBody, mediaItems, latitude, longitude, phoneNumberId, messageId } = messageData;
    const fromNumber = standardizePhoneNumber(rawFromNumber);

    // Mutable ref for userId so reply() can access it after auth
    let _authenticatedUserId: string | null = null;

    // Helper to send reply via Meta Cloud API
    // NOTE: In async-ack mode, reply() just sends the WhatsApp message —
    // the HTTP response (200) was already returned to Meta above.
    const reply = async (text: string, mediaUrl?: string): Promise<void> => {
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

    // Handle media-only messages — route directly to CREATE via process-note
    // Audio messages get transcribed via ElevenLabs STT first
    if (mediaUrls.length > 0 && !messageBody) {
      console.log('[WhatsApp] Processing media-only message — routing directly to CREATE');

      // Authenticate user first (need userId, coupleId for note creation)
      const { data: mediaProfiles, error: mediaProfileError } = await supabase
        .from('clerk_profiles')
        .select('id, display_name, timezone, language_preference')
        .eq('phone_number', fromNumber)
        .limit(1);

      const mediaProfile = mediaProfiles?.[0];
      if (mediaProfileError || !mediaProfile) {
        console.error('Profile lookup error for media message:', mediaProfileError);
        return reply(
          '👋 Hi! To use Olive via WhatsApp, please link your account first:\n\n' +
          '1️⃣ Open the Olive app\n2️⃣ Go to Profile/Settings\n3️⃣ Tap "Link WhatsApp"\n4️⃣ Send the token here'
        );
      }

      const mediaUserId = mediaProfile.id;
      _authenticatedUserId = mediaUserId;

      // Track last user message timestamp
      try {
        await supabase
          .from('clerk_profiles')
          .update({ last_user_message_at: new Date().toISOString() })
          .eq('id', mediaUserId);
      } catch (e) { /* non-critical */ }

      // Get couple_id
      const { data: mediaCoupleM } = await supabase
        .from('clerk_couple_members')
        .select('couple_id')
        .eq('user_id', mediaUserId)
        .limit(1)
        .single();
      const mediaCoupleId = mediaCoupleM?.couple_id || null;

      // ====================================================================
      // AUDIO TRANSCRIPTION via ElevenLabs Batch STT
      // If the media is audio (voice note), transcribe it to text first,
      // then route the transcribed text through process-note like a normal message.
      // ====================================================================
      const isAudio = mediaTypes.some(mt => mt.startsWith('audio/'));

      if (isAudio) {
        console.log('[WhatsApp] Audio message detected — transcribing via ElevenLabs STT');

        const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
        if (!ELEVENLABS_API_KEY) {
          console.error('[STT] ELEVENLABS_API_KEY not configured');
          return reply('Sorry, voice note processing is not configured yet. Please send a text message instead.');
        }

        let transcribedText = '';

        try {
          // Find the first audio media item — download raw bytes from Meta directly
          // (We already uploaded to storage, but we need the raw bytes for STT)
          const audioMediaItem = mediaItems.find(m => m.mimeType.startsWith('audio/'));
          if (!audioMediaItem) throw new Error('No audio media item found');

          // Download raw audio from Meta
          const metaInfoRes = await fetch(`https://graph.facebook.com/v21.0/${audioMediaItem.id}`, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}` }
          });
          if (!metaInfoRes.ok) throw new Error(`Meta media info failed: ${metaInfoRes.status}`);
          const metaInfo = await metaInfoRes.json();

          const audioRes = await fetch(metaInfo.url, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}` }
          });
          if (!audioRes.ok) throw new Error(`Meta audio download failed: ${audioRes.status}`);

          const audioBlob = await audioRes.blob();
          console.log('[STT] Audio blob size:', audioBlob.size, 'type:', audioBlob.type || audioMediaItem.mimeType);

          // Send to ElevenLabs Batch STT
          const sttFormData = new FormData();
          const audioFile = new File([audioBlob], 'voice_note.ogg', { type: audioMediaItem.mimeType });
          sttFormData.append('file', audioFile);
          sttFormData.append('model_id', 'scribe_v2');
          // Auto-detect language
          sttFormData.append('tag_audio_events', 'false');
          sttFormData.append('diarize', 'false');

          const sttResponse = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
            method: 'POST',
            headers: {
              'xi-api-key': ELEVENLABS_API_KEY,
            },
            body: sttFormData,
          });

          if (!sttResponse.ok) {
            const sttErr = await sttResponse.text();
            console.error('[STT] ElevenLabs STT failed:', sttResponse.status, sttErr);
            throw new Error(`STT failed: ${sttResponse.status}`);
          }

          const sttResult = await sttResponse.json();
          transcribedText = sttResult.text?.trim() || '';
          console.log('[STT] Transcribed text:', transcribedText.substring(0, 200));

        } catch (sttError) {
          console.error('[STT] Transcription error:', sttError);
          // Fallback: save as generic media note
          transcribedText = '';
        }

        if (transcribedText) {
          // Route the transcribed text through process-note just like a text message
          console.log('[WhatsApp] Routing transcribed audio to process-note as text');

          const audioPayload = {
            text: transcribedText,
            user_id: mediaUserId,
            couple_id: mediaCoupleId,
            timezone: mediaProfile.timezone || 'America/New_York',
            media: mediaUrls, // Keep the audio URL as attachment
            mediaTypes: mediaTypes,
          };

          const { data: processData, error: processError } = await supabase.functions.invoke('process-note', {
            body: audioPayload
          });

          if (processError) {
            console.error('Error processing transcribed audio note:', processError);
            return reply('Sorry, I heard your voice note but had trouble processing it. Please try again.');
          }

          // Insert the processed note
          try {
            const noteData = {
              author_id: mediaUserId,
              couple_id: mediaCoupleId,
              original_text: transcribedText,
              summary: processData.summary || transcribedText,
              category: processData.category || 'task',
              due_date: processData.due_date || null,
              reminder_time: processData.reminder_time || null,
              recurrence_frequency: processData.recurrence_frequency || null,
              recurrence_interval: processData.recurrence_interval || null,
              priority: processData.priority || 'medium',
              tags: processData.tags || [],
              items: processData.items || [],
              task_owner: processData.task_owner || null,
              list_id: processData.list_id || null,
              media_urls: mediaUrls,
              completed: false,
            };

            const { data: insertedNote, error: insertError } = await supabase
              .from('clerk_notes')
              .insert(noteData)
              .select('id, summary, list_id')
              .single();

            if (insertError) throw insertError;

            let listName = 'Tasks';
            if (insertedNote.list_id) {
              const { data: listData } = await supabase
                .from('clerk_lists')
                .select('name')
                .eq('id', insertedNote.list_id)
                .single();
              listName = listData?.name || 'Tasks';
            }

            const confirmMsg = `🎤 Voice note transcribed:\n"${transcribedText.substring(0, 200)}${transcribedText.length > 200 ? '...' : ''}"\n\n✅ Saved: ${insertedNote.summary}\n📂 Added to: ${listName}`;
            return reply(confirmMsg);
          } catch (insertErr) {
            console.error('Database insertion error for audio note:', insertErr);
            return reply('I transcribed your voice note but had trouble saving it. Please try again.');
          }
        } else {
          // Transcription failed or empty — save as generic media note with fallback text
          console.log('[WhatsApp] Audio transcription empty, saving as media attachment');
        }
        // Fall through to image/document processing below if transcription was empty
      }

      // ====================================================================
      // IMAGE / DOCUMENT processing via process-note (non-audio, or audio fallback)
      // ====================================================================
      const mediaPayload: any = {
        text: '',
        user_id: mediaUserId,
        couple_id: mediaCoupleId,
        timezone: mediaProfile.timezone || 'America/New_York',
        media: mediaUrls,
        mediaTypes: mediaTypes,
      };

      console.log('[WhatsApp] Sending media-only to process-note:', mediaUrls.length, 'files, types:', mediaTypes);

      const { data: processData, error: processError } = await supabase.functions.invoke('process-note', {
        body: mediaPayload
      });

      if (processError) {
        console.error('Error processing media note:', processError);
        return reply('Sorry, I had trouble processing that image. Please try again or add a caption describing what you want to save.');
      }

      // Insert the processed note
      try {
        const noteData = {
          author_id: mediaUserId,
          couple_id: mediaCoupleId,
          original_text: processData.summary || 'Media attachment',
          summary: processData.summary || 'Media attachment',
          category: processData.category || 'task',
          due_date: processData.due_date || null,
          reminder_time: processData.reminder_time || null,
          recurrence_frequency: processData.recurrence_frequency || null,
          recurrence_interval: processData.recurrence_interval || null,
          priority: processData.priority || 'medium',
          tags: processData.tags || [],
          items: processData.items || [],
          task_owner: processData.task_owner || null,
          list_id: processData.list_id || null,
          media_urls: mediaUrls,
          completed: false,
        };

        const { data: insertedNote, error: insertError } = await supabase
          .from('clerk_notes')
          .insert(noteData)
          .select('id, summary, list_id')
          .single();

        if (insertError) throw insertError;

        let listName = 'Tasks';
        if (insertedNote.list_id) {
          const { data: listData } = await supabase
            .from('clerk_lists')
            .select('name')
            .eq('id', insertedNote.list_id)
            .single();
          listName = listData?.name || 'Tasks';
        }

        const confirmMsg = `✅ Saved: ${insertedNote.summary}\n📂 Added to: ${listName}\n\n🔗 Manage: https://witholive.app`;
        return reply(confirmMsg);
      } catch (insertErr) {
        console.error('Database insertion error for media note:', insertErr);
        return reply('I analyzed your image but had trouble saving it. Please try again.');
      }
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
    // HANDLE AWAITING_DISAMBIGUATION STATE
    // User was shown a numbered list of ambiguous tasks, waiting for their pick
    // ========================================================================
    if (session.conversation_state === 'AWAITING_DISAMBIGUATION') {
      const contextData = session.context_data as any;
      const pendingAction = contextData?.pending_action;
      const candidates = pendingAction?.candidates as Array<{ id: string; summary: string }> | undefined;
      
      // Staleness check
      const sessionUpdatedAt = new Date(session.updated_at).getTime();
      const isStale = (Date.now() - sessionUpdatedAt) > 5 * 60 * 1000;
      
      const clearDisambigState = async () => {
        const preservedContext = (contextData || {}) as ConversationContext;
        await supabase
          .from('user_sessions')
          .update({
            conversation_state: 'IDLE',
            context_data: {
              last_referenced_entity: preservedContext.last_referenced_entity,
              entity_referenced_at: preservedContext.entity_referenced_at,
              conversation_history: preservedContext.conversation_history,
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', session.id);
      };
      
      if (isStale) {
        console.log('[DISAMBIGUATION] Stale (>5 min), auto-cancelling');
        await clearDisambigState();
        // Fall through to normal processing
      } else if (candidates && messageBody) {
        const isCancel = /^(no|nope|cancel|nevermind|never mind|n)$/i.test(messageBody.trim());
        if (isCancel) {
          await clearDisambigState();
          return reply(t('action_cancelled', userLang));
        }
        
        // Try to parse a number from the response
        const numMatch = messageBody.trim().match(/^(\d+)\.?$/);
        const selectedIndex = numMatch ? parseInt(numMatch[1]) - 1 : -1;
        
        if (selectedIndex >= 0 && selectedIndex < candidates.length) {
          const selectedTask = candidates[selectedIndex];
          console.log(`[DISAMBIGUATION] User selected #${selectedIndex + 1}: "${selectedTask.summary}"`);
          
          await clearDisambigState();
          
          // Fetch full task data
          const { data: fullTask } = await supabase
            .from('clerk_notes')
            .select('id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time')
            .eq('id', selectedTask.id)
            .maybeSingle();
          
          if (!fullTask) {
            return reply(t('task_not_found', userLang, { query: selectedTask.summary }));
          }
          
          // Execute the original action type
          const originalActionType = pendingAction.type as TaskActionType;
          
          if (originalActionType === 'complete') {
            const { error } = await supabase
              .from('clerk_notes')
              .update({ completed: true, updated_at: new Date().toISOString() })
              .eq('id', fullTask.id);
            if (!error) {
              const completeResponse = t('task_completed', userLang, { task: fullTask.summary });
              await saveReferencedEntity(fullTask, completeResponse);
              return reply(completeResponse);
            }
            return reply(t('error_generic', userLang));
          } else if (originalActionType === 'delete') {
            // Enter confirmation for delete
            const deleteCtx = (session.context_data || {}) as ConversationContext;
            await supabase
              .from('user_sessions')
              .update({
                conversation_state: 'AWAITING_CONFIRMATION',
                context_data: {
                  ...deleteCtx,
                  pending_action: {
                    type: 'delete',
                    task_id: fullTask.id,
                    task_summary: fullTask.summary
                  }
                },
                updated_at: new Date().toISOString()
              })
              .eq('id', session.id);
            return reply(`🗑️ Delete "${fullTask.summary}"?\n\nReply "yes" to confirm or "no" to cancel.`);
          } else if (originalActionType === 'set_priority') {
            const msgLower = (pendingAction.original_query || '').toLowerCase();
            const newPriority = msgLower.includes('low') ? 'low' : 'high';
            await supabase
              .from('clerk_notes')
              .update({ priority: newPriority, updated_at: new Date().toISOString() })
              .eq('id', fullTask.id);
            const emoji = newPriority === 'high' ? '🔥' : '📌';
            return reply(t('priority_updated', userLang, { emoji, task: fullTask.summary, priority: newPriority }));
          } else {
            // For other actions (remind, set_due, move, assign), mark the task as found
            // and store as referenced entity so the user can follow up
            await saveReferencedEntity(fullTask, `Selected: ${fullTask.summary}`);
            // Re-process with the resolved task — for now, confirm selection
            const completeResponse = t('task_completed', userLang, { task: fullTask.summary });
            const { error } = await supabase
              .from('clerk_notes')
              .update({ completed: true, updated_at: new Date().toISOString() })
              .eq('id', fullTask.id);
            if (!error) {
              await saveReferencedEntity(fullTask, completeResponse);
              return reply(completeResponse);
            }
            return reply(t('error_generic', userLang));
          }
        } else {
          // Invalid selection — cancel and process as new message
          console.log('[DISAMBIGUATION] Invalid selection, processing as new message:', messageBody?.substring(0, 50));
          await clearDisambigState();
          // Fall through to normal processing
        }
      } else {
        await clearDisambigState();
        // Fall through
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
      /^(complete[d]?!?|done!?|finished!?|got it!?|did it!?|hecho!?|fatto!?|terminado!?|finito!?|listo!?|ok!?|yes!?|sí!?|si!?)$/i
    );
    if (bareReplyMatch && recentOutbound.length > 0) {
      // Find the most recent reminder-like message
      const recentReminder = recentOutbound.find(m =>
        m.type === 'reminder' || m.type === 'task_reminder' ||
        m.content.includes('Reminder:') || m.content.includes('⏰')
      );

      if (recentReminder) {
        // PRIORITY 1: Use task_id from outbound context if available (stored by send-reminders)
        // This is the most reliable method — no semantic search needed
        const outboundCtx = await getOutboundContextWithTaskId(supabase, userId);
        if (outboundCtx?.task_id) {
          console.log('[Context] Bare reply — using task_id from outbound context:', outboundCtx.task_id, outboundCtx.task_summary);
          const { data: directTask, error: directErr } = await supabase
            .from('clerk_notes')
            .select('id, summary, completed')
            .eq('id', outboundCtx.task_id)
            .single();

          if (!directErr && directTask && !directTask.completed) {
            const { error } = await supabase
              .from('clerk_notes')
              .update({ completed: true, updated_at: new Date().toISOString() })
              .eq('id', directTask.id);

            if (!error) {
              return reply(t('context_completed', userLang, { task: directTask.summary }));
            }
          }
        }

        // PRIORITY 2: Fall back to extracting task name and semantic search
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

    if (aiResult && aiResult.confidence >= 0.3) {
      // AI classification succeeded — trust the AI for all natural language
      intentResult = mapAIResultToIntentResult(aiResult);
      console.log(`[AI Router] Using AI result: intent=${intentResult.intent}, confidence=${aiResult.confidence}, aiTaskId=${intentResult._aiTaskId || 'none'}, skill=${intentResult._aiSkillId || 'none'}`);
    } else {
      // Fallback to minimal deterministic routing (shortcuts + defaults only)
      if (aiResult) {
        console.log(`[AI Router] Very low confidence (${aiResult.confidence}), falling back to shortcuts. AI suggested: ${aiResult.intent}`);
      } else {
        console.log('[AI Router] AI classification failed, falling back to shortcuts');
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

      // Task resolution: relative ref → ordinal → AI UUID → semantic search → session context → outbound context
      let foundTask = null;

      // 0a. RELATIVE REFERENCE RESOLUTION: "last task", "the latest one", "previous task", etc.
      if (actionTarget && isRelativeReference(actionTarget)) {
        console.log('[TASK_ACTION] Detected relative reference:', actionTarget);
        foundTask = await resolveRelativeReference(supabase, userId, coupleId);
        if (foundTask) {
          console.log('[TASK_ACTION] Resolved relative reference to:', foundTask.summary);
        }
      }
      // Also check the full message for relative references when actionTarget is extracted oddly
      if (!foundTask && messageBody && isRelativeReference(messageBody.replace(/^(?:cancel|delete|remove|complete|done\s+with|finish|mark\s+(?:as\s+)?done)\s+/i, '').trim())) {
        console.log('[TASK_ACTION] Detected relative reference in cleaned message');
        foundTask = await resolveRelativeReference(supabase, userId, coupleId);
      }

      // 0b. ORDINAL RESOLUTION: "the first one", "the third one", "number 2", "#3"
      if (!foundTask) {
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
      }

      // 1. If AI provided a specific task UUID, look it up directly (fastest, most accurate)
      if (!foundTask && aiTaskId) {
        const { data: directTask } = await supabase
          .from('clerk_notes')
          .select('id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time')
          .eq('id', aiTaskId)
          .maybeSingle();

        if (directTask) {
          // Post-match verification: ensure the AI-provided UUID actually matches the user's query
          const matchQuality = actionTarget ? computeMatchQuality(actionTarget, directTask.summary) : 1;
          if (matchQuality >= 0.4 || !actionTarget) {
            console.log('[TASK_ACTION] Direct AI task match:', directTask.summary, 'matchQ:', matchQuality.toFixed(2));
            foundTask = directTask;
          } else {
            console.log(`[TASK_ACTION] AI UUID match "${directTask.summary}" REJECTED — matchQ ${matchQuality.toFixed(2)} for query "${actionTarget}"`);
          }
        }
      }

      // Check if actionTarget is a pronoun (it, that, this, lo, eso, quello)
      const isPronoun = !actionTarget || /^(it|that|this|lo|eso|quello|la|esa|questa|quello)$/i.test(actionTarget.trim());

      // 2. If no direct match, use semantic search WITH ambiguity detection
      if (!foundTask && actionTarget && !isPronoun && !isRelativeReference(actionTarget)) {
        const candidates = await semanticTaskSearchMulti(supabase, userId, coupleId, actionTarget, 5);
        
        if (candidates.length > 0) {
          const best = candidates[0];
          const bestMQ = best.matchQuality ?? 0;
          
          // Check for ambiguity: are there multiple high-quality matches?
          const AMBIGUITY_THRESHOLD = 0.15; // If top 2 scores are within 15% of each other
          const MIN_MATCH_QUALITY = 0.4;    // Minimum word overlap to accept a match
          
          if (bestMQ < MIN_MATCH_QUALITY) {
            // Best match is too weak — don't use it
            console.log(`[TASK_ACTION] Best match "${best.summary}" quality ${bestMQ.toFixed(2)} below threshold, skipping`);
          } else if (candidates.length >= 2) {
            const secondMQ = candidates[1].matchQuality ?? 0;
            const scoreDiff = bestMQ - secondMQ;
            
            // Both are high quality and close in score → ambiguous
            if (secondMQ >= MIN_MATCH_QUALITY && scoreDiff < AMBIGUITY_THRESHOLD) {
              console.log(`[TASK_ACTION] AMBIGUOUS: "${best.summary}" (${bestMQ.toFixed(2)}) vs "${candidates[1].summary}" (${secondMQ.toFixed(2)})`);
              
              // Build numbered options list for disambiguation
              const ambiguousCandidates = candidates.filter(c => (c.matchQuality ?? 0) >= MIN_MATCH_QUALITY).slice(0, 4);
              const optionsList = ambiguousCandidates.map((c, i) => `${i + 1}. ${c.summary}`).join('\n');
              
              // Save disambiguation state in session
              const disambigCtx = (session.context_data || {}) as ConversationContext;
              await supabase
                .from('user_sessions')
                .update({
                  conversation_state: 'AWAITING_DISAMBIGUATION',
                  context_data: {
                    ...disambigCtx,
                    pending_action: {
                      type: actionType,
                      candidates: ambiguousCandidates.map(c => ({ id: c.id, summary: c.summary })),
                      original_query: actionTarget,
                    }
                  },
                  updated_at: new Date().toISOString()
                })
                .eq('id', session.id);
              
              return reply(t('task_ambiguous', userLang, { query: actionTarget, options: optionsList }));
            } else {
              // Clear winner
              foundTask = best;
              console.log(`[TASK_ACTION] Clear match: "${best.summary}" (${bestMQ.toFixed(2)}) vs next (${secondMQ.toFixed(2)})`);
            }
          } else {
            // Only one candidate and it's good enough
            foundTask = best;
            console.log(`[TASK_ACTION] Single match: "${best.summary}" (${bestMQ.toFixed(2)})`);
          }
        }
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

      // ================================================================
      // COMPOUND CREATE+REMIND: If remind intent but no existing task found,
      // create a new note first, then set the reminder on it.
      // ================================================================
      if (!foundTask && actionType === 'remind') {
        console.log('[TASK_ACTION] Remind intent but no existing task found — creating new note first');
        
        // Extract the task description from the original message, stripping reminder phrases
        let taskDescription = messageBody || actionTarget || '';
        // Remove common reminder phrases to get the clean task description
        taskDescription = taskDescription
          .replace(/\s*[-–—]\s*remind\s+me\s+(?:to\s+)?(?:check\s+(?:it\s+)?out\s+)?(?:on|at|in|tomorrow|next|this).*$/i, '')
          .replace(/\s*[-–—]\s*ricordami\s+(?:di\s+)?.*$/i, '')
          .replace(/\s*[-–—]\s*recuérdame\s+(?:de\s+)?.*$/i, '')
          .replace(/\s*remind\s+me\s+(?:about\s+)?(?:this\s+)?(?:on|at|in|tomorrow|next|this).*$/i, '')
          .replace(/\s*remind\s+me\s+(?:to\s+)?(?:check\s+(?:it\s+)?out\s+)?(?:on|at|in|tomorrow|next|this).*$/i, '')
          .replace(/\s*ricordami\s+(?:di\s+)?.*$/i, '')
          .replace(/\s*recuérdame\s+(?:de\s+)?.*$/i, '')
          .trim();
        
        // If stripping left nothing, use the actionTarget or original message
        if (!taskDescription) {
          taskDescription = actionTarget || messageBody || 'New reminder';
        }
        
        console.log('[TASK_ACTION] Creating note with description:', taskDescription);
        
        try {
          // Process through the AI note processor for smart categorization
          const { data: processData, error: processError } = await supabase.functions.invoke('process-note', {
            body: {
              text: taskDescription,
              user_id: userId,
              couple_id: coupleId,
              timezone: profile.timezone || 'America/New_York',
            }
          });
          
          if (processError) {
            console.error('[TASK_ACTION] process-note error:', processError);
            return reply(t('error_generic', userLang));
          }
          
          // Parse the reminder date from the original message
          const reminderExpr = effectiveMessage || messageBody || '';
          const parsed = parseNaturalDate(reminderExpr, profile.timezone || 'America/New_York');
          
          // Insert the new note with reminder already set
          const noteData: any = {
            author_id: userId,
            couple_id: coupleId,
            original_text: messageBody || taskDescription,
            summary: processData.summary || taskDescription,
            category: processData.category || 'Task',
            due_date: parsed.date || processData.due_date || null,
            reminder_time: parsed.date || null,
            priority: processData.priority || 'medium',
            tags: processData.tags || [],
            items: processData.items || [],
            list_id: processData.list_id || null,
            media_urls: mediaUrls.length > 0 ? mediaUrls : null,
            completed: false,
          };
          
          const { data: insertedNote, error: insertError } = await supabase
            .from('clerk_notes')
            .insert(noteData)
            .select('id, summary, list_id')
            .single();
          
          if (insertError) {
            console.error('[TASK_ACTION] Insert error:', insertError);
            return reply(t('error_generic', userLang));
          }
          
          // Get list name for response
          let listName = 'Tasks';
          if (insertedNote.list_id) {
            const { data: list } = await supabase
              .from('clerk_lists')
              .select('name')
              .eq('id', insertedNote.list_id)
              .single();
            if (list) listName = list.name;
          }
          
          const friendlyDate = parsed.date ? formatFriendlyDate(parsed.date) : 'tomorrow at 9:00 AM';
          
          const confirmationMessage = [
            `✅ Saved: ${insertedNote.summary}`,
            `📂 Added to: ${listName}`,
            `⏰ Reminder set for ${friendlyDate}`,
            ``,
            `🔗 Manage: https://witholive.app`,
          ].join('\n');
          
          // Store as referenced entity for follow-up
          await saveReferencedEntity(
            { id: insertedNote.id, summary: insertedNote.summary, list_id: insertedNote.list_id || undefined },
            confirmationMessage
          );
          
          return reply(confirmationMessage);
        } catch (createErr) {
          console.error('[TASK_ACTION] Create+remind error:', createErr);
          return reply(t('error_generic', userLang));
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
          // Use the due_date_expression (cleanMessage/effectiveMessage) for time, NOT the task name (actionTarget)
          const reminderExpr = effectiveMessage || actionTarget || messageBody || '';
          console.log('[remind] reminderExpr:', reminderExpr, '| actionTarget:', actionTarget, '| effectiveMessage:', effectiveMessage);
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
      // PARTNER WELLNESS (opt-in, gentle, privacy-first)
      // ================================================================
      let partnerWellnessContext = '';
      if (coupleId && chatType === 'briefing') {
        try {
          // Find partner's user_id
          const { data: partnerMemberForWellness } = await supabase
            .from('clerk_couple_members')
            .select('user_id')
            .eq('couple_id', coupleId)
            .neq('user_id', userId)
            .limit(1)
            .maybeSingle();

          if (partnerMemberForWellness?.user_id) {
            // Check if partner has opted in to share wellness
            const { data: partnerOuraConn } = await supabase
              .from('oura_connections')
              .select('share_wellness_with_partner')
              .eq('user_id', partnerMemberForWellness.user_id)
              .eq('is_active', true)
              .maybeSingle();

            if (partnerOuraConn?.share_wellness_with_partner) {
              const todayStr = today.toISOString().split('T')[0];
              const yesterdayStr = new Date(today.getTime() - 86400000).toISOString().split('T')[0];
              const { data: partnerHealth } = await supabase
                .from('oura_daily_data')
                .select('day, readiness_score, sleep_score')
                .eq('user_id', partnerMemberForWellness.user_id)
                .in('day', [todayStr, yesterdayStr])
                .order('day', { ascending: false })
                .limit(1)
                .maybeSingle();

              // Only surface if readiness is notably low (<65) — qualitative signal only, no scores
              if (partnerHealth?.readiness_score && partnerHealth.readiness_score < 65) {
                partnerWellnessContext = `\nNote: ${partnerName || 'Your partner'} had a rough night and may appreciate some extra help today.\n`;
                console.log('[WhatsApp Chat] Partner wellness signal included (low readiness)');
              }
            }
          }
        } catch (pwErr) {
          // Non-blocking — partner wellness is a bonus
          console.warn('[WhatsApp Chat] Partner wellness fetch error (non-blocking):', pwErr);
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
      // OURA RING HEALTH DATA (enhanced with stress, resilience, trends)
      // ================================================================
      let ouraContext = '';
      if (chatType === 'briefing') {
        try {
          const { data: ouraConn } = await supabase
            .from('oura_connections')
            .select('id, last_sync_time, share_wellness_with_partner')
            .eq('user_id', userId)
            .eq('is_active', true)
            .maybeSingle();

          if (ouraConn) {
            // Pre-briefing auto-sync: if data is stale (>4h), trigger a fresh sync
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

            const todayStr = today.toISOString().split('T')[0];
            const yesterdayStr = new Date(today.getTime() - 86400000).toISOString().split('T')[0];
            const sevenDaysAgoStr = new Date(today.getTime() - 7 * 86400000).toISOString().split('T')[0];

            // Fetch last 7 days for averages and trend detection
            const { data: ouraWeek } = await supabase
              .from('oura_daily_data')
              .select('day, sleep_score, sleep_duration_seconds, readiness_score, activity_score, steps, stress_day_summary, stress_high_minutes, resilience_level')
              .eq('user_id', userId)
              .gte('day', sevenDaysAgoStr)
              .order('day', { ascending: false })
              .limit(7);

            if (ouraWeek && ouraWeek.length > 0) {
              const ouraToday = ouraWeek.find((r: any) => r.day === todayStr);
              const ouraYesterday = ouraWeek.find((r: any) => r.day === yesterdayStr);
              const ouraDay = ouraToday || ouraYesterday;
              const isYesterday = !ouraToday && !!ouraYesterday;

              if (ouraDay) {
                const sleepHours = ouraDay.sleep_duration_seconds ? (ouraDay.sleep_duration_seconds / 3600).toFixed(1) : null;

                // Compute 7-day averages
                const rowsWithSleep = ouraWeek.filter((r: any) => r.sleep_score);
                const rowsWithReadiness = ouraWeek.filter((r: any) => r.readiness_score);
                const avgSleep = rowsWithSleep.length ? Math.round(rowsWithSleep.reduce((s: number, r: any) => s + r.sleep_score, 0) / rowsWithSleep.length) : null;
                const avgReadiness = rowsWithReadiness.length ? Math.round(rowsWithReadiness.reduce((s: number, r: any) => s + r.readiness_score, 0) / rowsWithReadiness.length) : null;

                ouraContext = `\n## Health & Wellness (Oura Ring${isYesterday ? ' — yesterday\'s data' : ''}):\n`;
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

                // Advisory note for the AI
                if (ouraDay.readiness_score && ouraDay.readiness_score < 65) {
                  ouraContext += `Advisory: Readiness is low — suggest a lighter, recovery-focused day.\n`;
                } else if (ouraDay.readiness_score && ouraDay.readiness_score >= 85) {
                  ouraContext += `Advisory: Readiness is high — great day to tackle demanding tasks.\n`;
                }

                console.log('[WhatsApp Chat] Enhanced Oura data included in briefing');
              }
            }

            // Partner wellness context (gentle, opt-in only)
            if (coupleId && ouraConn.share_wellness_with_partner) {
              // This user opted in to share — but we need to check the *partner's* opt-in
              // We'll inject partner wellness in the partner context section below
            }
          }
        } catch (ouraErr) {
          console.error('[WhatsApp Chat] Oura fetch error (non-blocking):', ouraErr);
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
          const briefingPartner = (partnerContext || '') + partnerWellnessContext;
          
          const briefingTimeframe = isTomorrowQuery ? 'tomorrow' : 'today';
          const briefingEmoji = isTomorrowQuery ? '📅' : '🌅';
          const briefingTitle = isTomorrowQuery ? 'Tomorrow\'s Preview' : 'Morning Briefing';
          
          systemPrompt = `You are Olive, providing a comprehensive ${briefingTitle} to help the user plan.

${baseContext}
${briefingCalendar}
${briefingPartner}
${ouraContext}
Your task: Deliver a complete but concise ${briefingTitle} focused on ${briefingTimeframe} (under 600 chars for WhatsApp).

Structure your response:
${briefingEmoji} **${briefingTitle}**

1. **Schedule Snapshot**: Mention ${briefingTimeframe}'s calendar events (if any) or note a clear schedule
${ouraContext ? `2. **Wellness Check**: Mention sleep and readiness in a warm, advisory tone. If readiness is low, gently suggest a lighter day ("your body is still recovering"). If readiness is high, be encouraging ("great energy today"). Include stress/resilience only if notable. Never be clinical — be a caring friend, not a doctor.` : ''}
${ouraContext ? '3' : '2'}. **${isTomorrowQuery ? 'Tomorrow\'s' : 'Today\'s'} Focus**: Top 2-3 priorities ${isTomorrowQuery ? 'for tomorrow' : '(overdue first, then urgent, then due today)'}
${ouraContext ? '4' : '3'}. **Quick Stats**: ${taskContext.total_active} active tasks, ${taskContext.urgent} urgent, ${taskContext.overdue} overdue, ${taskContext.due_tomorrow} due tomorrow
${partnerName ? `${ouraContext ? '5' : '4'}. **${partnerName} Update**: Brief note on partner's recent activity or assignments (if any)` : ''}
${ouraContext ? '6' : '5'}. **Encouragement**: One motivating line personalized to their situation

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
    // PARTNER MESSAGE HANDLER - Send messages to partner via WhatsApp
    // Triggered by: "remind Marco to buy lemons", "tell Almu to pick up kids",
    //   "dile a Marco que...", "ricorda a Marco di..."
    // ========================================================================
    if (intent === 'PARTNER_MESSAGE') {
      const partnerAction = (intentResult as any)._partnerAction || 'tell';
      const partnerMessageContent = cleanMessage || effectiveMessage || '';
      console.log('[WhatsApp] Processing PARTNER_MESSAGE:', partnerAction, '→', partnerMessageContent?.substring(0, 80));

      // 1. Verify couple space exists
      if (!coupleId) {
        return reply(t('partner_no_space', userLang));
      }

      // 2. Get couple data + resolve partner (prefer partner WITH a phone number)
      const { data: coupleData } = await supabase
        .from('clerk_couples')
        .select('you_name, partner_name, created_by')
        .eq('id', coupleId)
        .single();

      if (!coupleData) {
        return reply('I couldn\'t find your shared space. Make sure it\'s set up correctly!');
      }

      // Get ALL other members in the couple (there may be >1 due to test/stale accounts)
      const { data: otherMembers } = await supabase
        .from('clerk_couple_members')
        .select('user_id')
        .eq('couple_id', coupleId)
        .neq('user_id', userId);

      if (!otherMembers || otherMembers.length === 0) {
        return reply('I couldn\'t find your partner in the shared space. Make sure they\'ve accepted your invite!');
      }

      // Look up profiles for ALL other members and pick the one with a phone number
      const otherUserIds = otherMembers.map(m => m.user_id);
      const { data: candidateProfiles } = await supabase
        .from('clerk_profiles')
        .select('id, phone_number, display_name, last_user_message_at')
        .in('id', otherUserIds);

      // Prefer the member who has a phone number linked
      const partnerProfile = candidateProfiles?.find(p => p.phone_number)
        || candidateProfiles?.[0]
        || null;

      if (!partnerProfile) {
        return reply('I couldn\'t find your partner in the shared space. Make sure they\'ve accepted your invite!');
      }

      const partnerId = partnerProfile.id;
      const isCreator = coupleData.created_by === userId;
      const partnerName = isCreator ? (coupleData.partner_name || partnerProfile.display_name || 'Partner') : (coupleData.you_name || partnerProfile.display_name || 'Partner');
      const senderName = isCreator ? (coupleData.you_name || 'Your partner') : (coupleData.partner_name || 'Your partner');

      if (!partnerProfile.phone_number) {
        return reply(t('partner_no_phone', userLang, { partner: partnerName }));
      }

      // 4. Determine if this is a task to save or just a message to relay
      const isTaskLike = /\b(buy|get|pick up|call|book|make|schedule|clean|fix|do|send|bring|take|comprar|llamar|hacer|enviar|traer|comprare|chiamare|fare|inviare|portare)\b/i.test(partnerMessageContent);

      let savedTask: { id: string; summary: string } | null = null;

      if (isTaskLike) {
        // Save as a task assigned to partner
        try {
          const { data: processData } = await supabase.functions.invoke('process-note', {
            body: {
              text: partnerMessageContent,
              user_id: userId,
              couple_id: coupleId,
              timezone: profile.timezone || 'America/New_York',
            }
          });

          const noteData = {
            author_id: userId,
            couple_id: coupleId,
            original_text: partnerMessageContent,
            summary: processData?.summary || partnerMessageContent,
            category: processData?.category || 'task',
            due_date: processData?.due_date || null,
            reminder_time: processData?.reminder_time || null,
            priority: processData?.priority || 'medium',
            tags: processData?.tags || [],
            items: processData?.items || [],
            task_owner: partnerId,
            list_id: processData?.list_id || null,
            completed: false,
          };

          const { data: insertedNote } = await supabase
            .from('clerk_notes')
            .insert(noteData)
            .select('id, summary')
            .single();

          if (insertedNote) {
            savedTask = { id: insertedNote.id, summary: insertedNote.summary };
            console.log('[PARTNER_MESSAGE] Created task for partner:', insertedNote.summary);
          }
        } catch (taskErr) {
          console.error('[PARTNER_MESSAGE] Error creating task (non-blocking):', taskErr);
        }
      }

      // 5. Compose the WhatsApp message to partner
      const actionEmoji: Record<string, string> = {
        remind: '⏰',
        tell: '💬',
        ask: '❓',
        notify: '📢',
      };
      const emoji = actionEmoji[partnerAction] || '💬';

      let partnerWhatsAppMsg = '';
      if (partnerAction === 'remind') {
        partnerWhatsAppMsg = `${emoji} Reminder from ${senderName}:\n\n${savedTask?.summary || partnerMessageContent}\n\nReply "done" when finished 🫒`;
      } else if (partnerAction === 'ask') {
        partnerWhatsAppMsg = `${emoji} ${senderName} is asking:\n\n${partnerMessageContent}\n\nReply to let them know 🫒`;
      } else {
        partnerWhatsAppMsg = `${emoji} Message from ${senderName}:\n\n${savedTask?.summary || partnerMessageContent}\n\n🫒 Olive`;
      }

      // 6. Send via gateway (handles 24h window + template fallback)
      try {
        const { data: gatewayResult, error: gatewayError } = await supabase.functions.invoke('whatsapp-gateway', {
          body: {
            action: 'send',
            message: {
              user_id: partnerId,
              message_type: 'partner_notification',
              content: partnerWhatsAppMsg,
              priority: 'normal',
              metadata: {
                from_user_id: userId,
                from_name: senderName,
                action: partnerAction,
                task_id: savedTask?.id || null,
              },
            },
          },
        });

        if (gatewayError || !gatewayResult?.success) {
          console.error('[PARTNER_MESSAGE] Gateway error:', gatewayError || gatewayResult?.error);

          // Fallback: try direct Meta API send
          const cleanNumber = partnerProfile.phone_number.replace(/\D/g, '');
          const directResult = await sendWhatsAppReply(
            Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')!,
            cleanNumber,
            partnerWhatsAppMsg,
            Deno.env.get('WHATSAPP_ACCESS_TOKEN')!
          );

          if (!directResult) {
            // Task was still saved even if message failed
            if (savedTask) {
              return reply(`📋 I saved "${savedTask.summary}" and assigned it to ${partnerName}, but couldn't send the WhatsApp notification right now.\n\nThey'll see it in the app!`);
            }
            return reply(`Sorry, I couldn't reach ${partnerName} on WhatsApp right now. Please try again later.`);
          }
        }

        console.log('[PARTNER_MESSAGE] Message sent successfully to', partnerName);
      } catch (sendErr) {
        console.error('[PARTNER_MESSAGE] Send error:', sendErr);
        if (savedTask) {
          return reply(`📋 I saved "${savedTask.summary}" for ${partnerName}, but couldn't send the WhatsApp notification. They'll see it in the app!`);
        }
        return reply(t('error_generic', userLang));
      }

      // 7. Respond to sender with confirmation
      if (savedTask) {
        const confirmResponse = t('partner_message_and_task', userLang, {
          partner: partnerName,
          task: savedTask.summary,
        });
        await saveReferencedEntity(savedTask, confirmResponse);
        return reply(confirmResponse);
      } else {
        return reply(t('partner_message_sent', userLang, {
          partner: partnerName,
          message: partnerMessageContent.substring(0, 200),
        }));
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
    console.error('[Meta Webhook] ❌ Background processing error:', error);
    // Try to notify the user if we have enough context
    try {
      const { fromNumber: rawFromNumber, phoneNumberId } = messageData;
      const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN')!;
      const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')!;
      await sendWhatsAppReply(
        phoneNumberId || WHATSAPP_PHONE_NUMBER_ID,
        rawFromNumber,
        'Sorry, something went wrong. Please try again.',
        WHATSAPP_ACCESS_TOKEN
      );
    } catch (replyErr) {
      console.error('[Meta Webhook] Failed to send error reply:', replyErr);
    }
  }

  console.log('[Meta Webhook] 🏁 Background Processing Finished');
  })(); // end of background processing IIFE

  // Use EdgeRuntime.waitUntil() to keep the function alive for background processing
  // while we return 200 immediately to Meta
  // @ts-ignore — EdgeRuntime is a Supabase Deno runtime global
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
    EdgeRuntime.waitUntil(backgroundProcessing);
  }

  // Return 200 immediately — Meta gets its response in <100ms
  return new Response('EVENT_RECEIVED', { status: 200 });
});

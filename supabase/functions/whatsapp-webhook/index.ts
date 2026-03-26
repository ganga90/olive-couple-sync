import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.0.0";
import { encryptNoteFields, isEncryptionAvailable } from "../_shared/encryption.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ============================================================================
// DETERMINISTIC ROUTING - "Strict Gatekeeper"
// ============================================================================
// SEARCH: starts with Show, Find, List, Search, Get, ?, or contains "my tasks/list/reminders"
// MERGE: message is exactly "merge" (case-insensitive)  
// CREATE: Everything else (default)
// ============================================================================

type IntentResult = { intent: 'SEARCH' | 'MERGE' | 'CREATE' | 'CHAT' | 'CONTEXTUAL_ASK' | 'WEB_SEARCH' | 'TASK_ACTION' | 'EXPENSE' | 'PARTNER_MESSAGE' | 'CREATE_LIST' | 'LIST_RECAP'; isUrgent?: boolean; cleanMessage?: string };

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
  partner_message_existing_task: {
    en: '✅ Done! I reminded {partner} about an existing task:\n\n📋 "{task}"\n💬 Notified via WhatsApp\n\nℹ️ No duplicate created — task already tracked.',
    'es': '✅ ¡Hecho! Le recordé a {partner} sobre una tarea existente:\n\n📋 "{task}"\n💬 Notificado vía WhatsApp\n\nℹ️ No se creó duplicado — tarea ya registrada.',
    'it': '✅ Fatto! Ho ricordato a {partner} un\'attività esistente:\n\n📋 "{task}"\n💬 Notificato via WhatsApp\n\nℹ️ Nessun duplicato creato — attività già tracciata.',
  },
  partner_no_phone: {
    en: '😕 I\'d love to message {partner}, but they haven\'t linked their WhatsApp yet.\n\nAsk them to open Olive → Profile → Link WhatsApp.',
    'es': '😕 Me encantaría enviarle un mensaje a {partner}, pero aún no ha vinculado su WhatsApp.\n\nPídele que abra Olive → Perfil → Vincular WhatsApp.',
    'it': '😕 Vorrei mandare un messaggio a {partner}, ma non ha ancora collegato il suo WhatsApp.\n\nChiedigli di aprire Olive → Profilo → Collega WhatsApp.',
  },
  partner_no_space: {
    en: 'I couldn\'t find your partner in the shared space. Make sure they\'ve accepted your invite!\n\nTo invite someone: open Olive → Profile → Invite Partner 💚',
    'es': 'No encontré a tu pareja en el espacio compartido. ¡Asegúrate de que haya aceptado tu invitación!\n\nPara invitar: abre Olive → Perfil → Invitar Pareja 💚',
    'it': 'Non ho trovato il tuo partner nello spazio condiviso. Assicurati che abbia accettato il tuo invito!\n\nPer invitare qualcuno: apri Olive → Profilo → Invita Partner 💚',
  },
  // ── Note creation confirmation labels (localized) ──
  note_saved: {
    en: '✅ Saved: {summary}',
    'es': '✅ Guardado: {summary}',
    'it': '✅ Salvato: {summary}',
  },
  note_added_to: {
    en: '📂 Added to: {list}',
    'es': '📂 Añadido a: {list}',
    'it': '📂 Aggiunto a: {list}',
  },
  note_priority_high: {
    en: '🔥 Priority: High',
    'es': '🔥 Prioridad: Alta',
    'it': '🔥 Priorità: Alta',
  },
  note_manage: {
    en: '🔗 Manage: https://witholive.app',
    'es': '🔗 Gestionar: https://witholive.app',
    'it': '🔗 Gestisci: https://witholive.app',
  },
  note_multi_saved: {
    en: '✅ Saved {count} items!',
    'es': '✅ ¡Guardados {count} elementos!',
    'it': '✅ Salvati {count} elementi!',
  },
  note_similar_found: {
    en: '⚠️ Similar task found: "{task}"\nReply "Merge" to combine them.',
    'es': '⚠️ Tarea similar encontrada: "{task}"\nResponde "Merge" para combinarlas.',
    'it': '⚠️ Attività simile trovata: "{task}"\nRispondi "Merge" per unirle.',
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
  | 'assistant'           // "help me draft an email", "write a message for me"
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
// EXPENSE TEXT PARSER - Robust multi-format amount extraction
// Supports: "$57.85 Amazon", "Amazon $57.85", "57.85 Amazon", "€45 groceries",
//           "lunch at Chipotle 25", "25 lunch", "coffee £4.50", etc.
// ============================================================================
function parseExpenseText(text: string): { amount: number; description: string; currency: string } | null {
  const cleaned = text.trim();
  if (!cleaned) return null;

  let amount: number | null = null;
  let description = '';
  let currency = 'USD';

  // Pattern 1: Currency symbol + amount at the START: "$57.85 Amazon", "€45 groceries"
  const startMatch = cleaned.match(/^([£€$])\s*(\d+\.?\d*)\s+(.+)$/);
  if (startMatch) {
    currency = startMatch[1] === '€' ? 'EUR' : startMatch[1] === '£' ? 'GBP' : 'USD';
    amount = parseFloat(startMatch[2]);
    description = startMatch[3].trim();
  }

  // Pattern 2: Amount (no symbol) at the START: "57.85 Amazon", "25 lunch at Chipotle"
  if (amount === null) {
    const numStartMatch = cleaned.match(/^(\d+\.?\d*)\s+(.+)$/);
    if (numStartMatch) {
      amount = parseFloat(numStartMatch[1]);
      description = numStartMatch[2].trim();
    }
  }

  // Pattern 3: Currency symbol + amount at the END or MIDDLE: "Amazon $57.85", "coffee €4.50"
  if (amount === null) {
    const endMatch = cleaned.match(/^(.+?)\s+([£€$])\s*(\d+\.?\d*)\s*$/);
    if (endMatch) {
      description = endMatch[1].trim();
      currency = endMatch[2] === '€' ? 'EUR' : endMatch[2] === '£' ? 'GBP' : 'USD';
      amount = parseFloat(endMatch[3]);
    }
  }

  // Pattern 4: Amount (no symbol) at the END: "Amazon 57.85", "lunch 25"
  if (amount === null) {
    const numEndMatch = cleaned.match(/^(.+?)\s+(\d+\.?\d*)$/);
    if (numEndMatch && parseFloat(numEndMatch[2]) > 0) {
      description = numEndMatch[1].trim();
      amount = parseFloat(numEndMatch[2]);
    }
  }

  // Pattern 5: Inline currency+amount: "Bought coffee for $4.50 at Starbucks"
  if (amount === null) {
    const inlineMatch = cleaned.match(/([£€$])\s*(\d+\.?\d*)/);
    if (inlineMatch) {
      currency = inlineMatch[1] === '€' ? 'EUR' : inlineMatch[1] === '£' ? 'GBP' : 'USD';
      amount = parseFloat(inlineMatch[2]);
      description = cleaned.replace(inlineMatch[0], '').replace(/\s{2,}/g, ' ').trim();
    }
  }

  if (amount === null || amount <= 0 || !description) return null;

  return { amount, description, currency };
}

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
  // Store last user message for "schedule it" / "then create it" context resolution
  last_user_message?: string;
  last_user_message_at?: string;
}

// ============================================================================
// SHARED INTENT CLASSIFIER (imported from _shared/intent-classifier.ts)
// ============================================================================
// Uses gemini-2.5-flash-lite for fast JSON classification.
// Both whatsapp-webhook and ask-olive-individual share this module.
// See _shared/intent-classifier.ts for the full implementation.

// Type re-export for local usage
type ClassifiedIntent = import("../_shared/intent-classifier.ts").ClassifiedIntent;

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

    case 'web_search':
      return {
        intent: 'WEB_SEARCH',
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

    case 'create_list':
      return {
        intent: 'CREATE_LIST',
        cleanMessage: params.list_name || ai.target_task_name || undefined,
        _listName: params.list_name || undefined,
        _initialItems: params.partner_message_content || undefined, // repurposed for initial items
      };

    case 'list_recap':
      return {
        intent: 'LIST_RECAP',
        cleanMessage: ai.target_task_name || undefined,
        _listName: params.list_name || undefined,
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

  // 2b. "Create a list" — deterministic interceptor for explicit list creation
  const createListMatch = lower.match(/^(?:create|make|start|new)\s+(?:a\s+)?list\s+(?:about|for|of|called|named|:)\s*(.+)$/i)
    || lower.match(/^(?:create|make|start|new)\s+(?:a\s+)?list\s+(.+)$/i)
    || lower.match(/^(?:crea|crear|inizia|nueva?|nuova?)\s+(?:una?\s+)?list[ae]?\s+(?:sobre|per|di|de|chiamata|llamada|:)\s*(.+)$/i)
    || lower.match(/^(?:crea|crear|inizia|nueva?|nuova?)\s+(?:una?\s+)?list[ae]?\s+(.+)$/i);
  if (createListMatch) {
    const listName = createListMatch[1].trim();
    console.log('[Intent Fallback] Create list detected:', listName);
    return { intent: 'CREATE_LIST' as any, cleanMessage: listName, _listName: listName } as any;
  }

  // 3. Bare greetings (no AI call needed)
  if (/^(hi|hello|hey)\s*[!.]?$/i.test(lower)) {
    return { intent: 'CHAT', chatType: 'greeting', cleanMessage: normalized };
  }

  // 4. URL detection — messages containing links are brain-dumps to save, NOT web searches
  if (/https?:\/\/\S+/i.test(normalized)) {
    console.log('[Intent Fallback] URL detected → CREATE (link save)');
    return { intent: 'CREATE', cleanMessage: normalized };
  }

  // 5. Everything else → CREATE (default). The AI classifier should have caught
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
 * 
 * When timezone is provided, the UTC date is converted to the user's local time
 * for display. This is critical because reminder_time is stored in UTC but the
 * user expects to see their local time.
 */
function formatFriendlyDate(dateStr: string, includeTime: boolean = true, timezone?: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;

  // If timezone provided, format in user's local time; otherwise use UTC
  let dayOfWeek: number, month: number, dayNum: number, year: number, hours: number, mins: number;
  
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', hour12: false,
      }).formatToParts(d);
      
      const get = (type: string) => parts.find(p => p.type === type)?.value || '0';
      month = parseInt(get('month')) - 1;
      dayNum = parseInt(get('day'));
      year = parseInt(get('year'));
      hours = parseInt(get('hour'));
      mins = parseInt(get('minute'));
      
      // Get day of week via a separate formatter
      const dowStr = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(d);
      const dowMap: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
      dayOfWeek = dowMap[dowStr] ?? d.getUTCDay();
    } catch {
      // Fallback to UTC
      dayOfWeek = d.getUTCDay(); month = d.getUTCMonth(); dayNum = d.getUTCDate();
      year = d.getUTCFullYear(); hours = d.getUTCHours(); mins = d.getUTCMinutes();
    }
  } else {
    dayOfWeek = d.getUTCDay(); month = d.getUTCMonth(); dayNum = d.getUTCDate();
    year = d.getUTCFullYear(); hours = d.getUTCHours(); mins = d.getUTCMinutes();
  }

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  const dayName = days[dayOfWeek];
  const monthName = months[month];

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
    // Skip time display if it's exactly midnight (00:00) — likely date-only
    if (hours !== 0 || mins !== 0) {
      const h12 = hours % 12 || 12;
      const ampm = hours < 12 ? 'AM' : 'PM';
      const minStr = mins.toString().padStart(2, '0');
      result += ` at ${h12}:${minStr} ${ampm}`;
    }
  }

  return result;
}

// Call Gemini AI — uses GEMINI_API directly via GoogleGenAI SDK
// Supports dynamic model tier selection: "lite" | "standard" | "pro"
async function callAI(systemPrompt: string, userMessage: string, temperature = 0.7, tier: string = "standard"): Promise<string> {
  const { GEMINI_KEY, getModel } = await import("../_shared/gemini.ts");
  if (!GEMINI_KEY) throw new Error('GEMINI_API not configured');

  const model = getModel(tier as any);
  console.log(`[callAI] Using ${model} (tier=${tier})`);

  const genai = new GoogleGenAI({ apiKey: GEMINI_KEY });
  const response = await genai.models.generateContent({
    model,
    contents: userMessage,
    config: {
      systemInstruction: systemPrompt,
      temperature,
      maxOutputTokens: tier === "pro" ? 2000 : 1000,
    },
  });

  const text = response.text;
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
    
    // Step 2: Download the actual media file (with 30s timeout)
    const downloadController = new AbortController();
    const downloadTimeout = setTimeout(() => downloadController.abort(), 30000);
    
    let mediaResponse: Response;
    try {
      mediaResponse = await fetch(mediaDownloadUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        signal: downloadController.signal,
      });
    } catch (fetchErr) {
      clearTimeout(downloadTimeout);
      console.error('[Meta Media] Download timed out or failed:', fetchErr);
      return null;
    }
    clearTimeout(downloadTimeout);
    
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
    'un\'': 1, 'mezza': 0.5, 'mezz\'ora': 0.5, 'due': 2, 'tre': 3, 'quattro': 4,
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
    // Italian (marzo already covered by Spanish entry above — same month index 2)
    'gennaio': 0, 'febbraio': 1, 'aprile': 3, 'maggio': 4, 'giugno': 5,
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
      'giovedì': 4, 'giovedi': 4, 'venerdì': 5, 'venerdi': 5, 'sabato': 6,
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
    // Handle "DD-Mon" or "DD Mon" format (e.g., "20-Mar", "15 Jan", "3-abril")
    const ddMonMatch = lowerExpr.match(/(\d{1,2})[\s-]+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|gennaio|febbraio|aprile|maggio|giugno|luglio|settembre|ottobre|novembre|dicembre)/i);
    if (ddMonMatch) {
      const dayNum = parseInt(ddMonMatch[1]);
      const monthWord = ddMonMatch[2].toLowerCase();
      // Map abbreviated/full month names to month number
      const abbrMonthMap: Record<string, number> = {
        'jan': 0, 'january': 0, 'feb': 1, 'february': 1, 'mar': 2, 'march': 2,
        'apr': 3, 'april': 3, 'may': 4, 'jun': 5, 'june': 5, 'jul': 6, 'july': 6,
        'aug': 7, 'august': 7, 'sep': 8, 'sept': 8, 'september': 8,
        'oct': 9, 'october': 9, 'nov': 10, 'november': 10, 'dec': 11, 'december': 11,
        // Spanish
        'enero': 0, 'febrero': 1, 'marzo': 2, 'abril': 3, 'mayo': 4, 'junio': 5,
        'julio': 6, 'agosto': 7, 'septiembre': 8, 'octubre': 9, 'noviembre': 10, 'diciembre': 11,
        // Italian
        'gennaio': 0, 'febbraio': 1, 'aprile': 3, 'maggio': 4, 'giugno': 5,
        'luglio': 6, 'settembre': 8, 'ottobre': 9, 'novembre': 10,
      };
      const monthNum = abbrMonthMap[monthWord] ?? monthNames[monthWord];
      if (monthNum !== undefined && dayNum >= 1 && dayNum <= 31) {
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
    }

    // Handle "Month DD" format (original)
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

    // Include BOTH personal tasks (couple_id IS NULL, author_id = userId) AND couple tasks
    if (coupleId) {
      query = query.or(`couple_id.eq.${coupleId},and(author_id.eq.${userId},couple_id.is.null)`);
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
  
  // Include BOTH personal tasks (couple_id IS NULL) AND couple tasks
  if (coupleId) {
    query = query.or(`couple_id.eq.${coupleId},and(author_id.eq.${userId},couple_id.is.null)`);
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
        // Include BOTH personal and couple tasks
        if (coupleId) { query = query.or(`couple_id.eq.${coupleId},and(author_id.eq.${userId},couple_id.is.null)`); }
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
    // Track the most recently referenced task for outbound context enrichment
    let _lastReferencedTaskId: string | null = null;
    let _lastReferencedTaskSummary: string | null = null;

    // Helper to send reply via Meta Cloud API
    // NOTE: In async-ack mode, reply() just sends the WhatsApp message —
    // the HTTP response (200) was already returned to Meta above.
    const reply = async (text: string, mediaUrl?: string): Promise<void> => {
      await sendWhatsAppReply(phoneNumberId || WHATSAPP_PHONE_NUMBER_ID, rawFromNumber, text, WHATSAPP_ACCESS_TOKEN, mediaUrl);

      // Save last_outbound_context WITH task_id so follow-up commands resolve correctly
      if (_authenticatedUserId) {
        try {
          const outboundCtx: any = {
            message_type: 'reply',
            content: text.substring(0, 500),
            sent_at: new Date().toISOString(),
            status: 'sent'
          };
          // Attach task reference if one was recently created/modified
          if (_lastReferencedTaskId) {
            outboundCtx.task_id = _lastReferencedTaskId;
            outboundCtx.task_summary = _lastReferencedTaskSummary || '';
          }
          await supabase
            .from('clerk_profiles')
            .update({ last_outbound_context: outboundCtx })
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
    
    let messageBody = rawMessageBody?.trim() || null;
    
    // 🔒 Sensitive note detection — strip prefix and set flag
    let isSensitiveNote = false;
    if (messageBody && (messageBody.startsWith('🔒') || messageBody.startsWith('🔒 '))) {
      isSensitiveNote = true;
      messageBody = messageBody.replace(/^🔒\s*/, '').trim() || null;
      console.log('[WhatsApp] 🔒 Sensitive note detected, flag set');
    }
    
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

    // ======================================================================
    // AUDIO TRANSCRIPTION — Payload Replacement Pattern
    // If the message is audio (voice note), transcribe via ElevenLabs STT
    // with Gemini fallback. Replace the empty messageBody BEFORE any routing.
    // This lets voice notes flow through the full intent pipeline (search,
    // create, complete, expense, etc.) just like typed text.
    // ======================================================================
    const isAudioMessage = mediaItems.some(m => m.mimeType.startsWith('audio/'));

    if (isAudioMessage && !messageBody) {
      console.log('[STT] Audio message detected — starting transcription pipeline');

      try {
        // Step 1: Find the audio media item
        const audioMediaItem = mediaItems.find(m => m.mimeType.startsWith('audio/'));
        if (!audioMediaItem) throw new Error('No audio media item found in mediaItems');

        // Step 2: Re-use already-downloaded bytes from downloadAndUploadMetaMedia
        // The media was already downloaded and uploaded to Supabase Storage above.
        // We download from Supabase Storage (signed URL) to avoid a second Meta API call.
        const audioSignedUrl = mediaUrls.find((_, i) => mediaTypes[i]?.startsWith('audio/'));
        
        let audioBlob: Blob;
        if (audioSignedUrl) {
          console.log('[STT] Re-using audio from Supabase Storage (avoiding double Meta download)');
          const storageRes = await fetch(audioSignedUrl);
          if (!storageRes.ok) throw new Error(`Supabase storage fetch failed: ${storageRes.status}`);
          audioBlob = await storageRes.blob();
        } else {
          // Fallback: download from Meta if storage URL not available
          console.log('[STT] Fallback: downloading audio from Meta directly');
          const metaInfoRes = await fetch(`https://graph.facebook.com/v21.0/${audioMediaItem.id}`, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}` }
          });
          if (!metaInfoRes.ok) throw new Error(`Meta media info failed: ${metaInfoRes.status}`);
          const metaInfo = await metaInfoRes.json();
          const audioRes = await fetch(metaInfo.url, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}` }
          });
          if (!audioRes.ok) throw new Error(`Meta audio download failed: ${audioRes.status}`);
          audioBlob = await audioRes.blob();
        }
        console.log('[STT] Audio ready:', audioBlob.size, 'bytes, type:', audioBlob.type || audioMediaItem.mimeType);

        if (audioBlob.size === 0) throw new Error('Audio blob is empty (0 bytes)');

        let transcribedText = '';

        // ── Strategy 1: ElevenLabs STT ──
        const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
        if (ELEVENLABS_API_KEY) {
          try {
            const sttFormData = new FormData();
            const audioFile = new File([audioBlob], 'voice_note.ogg', { type: audioMediaItem.mimeType });
            sttFormData.append('file', audioFile);
            sttFormData.append('model_id', 'scribe_v2');
            sttFormData.append('tag_audio_events', 'false');
            sttFormData.append('diarize', 'false');

            const sttResponse = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
              method: 'POST',
              headers: { 'xi-api-key': ELEVENLABS_API_KEY },
              body: sttFormData,
            });

            if (!sttResponse.ok) {
              const sttErr = await sttResponse.text().catch(() => '');
              console.warn(`[STT] ElevenLabs failed (${sttResponse.status}): ${sttErr.substring(0, 200)}`);
              throw new Error(`ElevenLabs STT failed: ${sttResponse.status}`);
            }

            const sttResult = await sttResponse.json();
            transcribedText = sttResult.text?.trim() || '';
            if (transcribedText) {
              console.log('[STT] ✅ ElevenLabs transcription succeeded:', transcribedText.substring(0, 200));
            } else {
              throw new Error('ElevenLabs returned empty text');
            }
          } catch (elError) {
            console.warn('[STT] ElevenLabs unavailable, falling back to Gemini:', (elError as Error).message);
          }
        } else {
          console.log('[STT] No ELEVENLABS_API_KEY, using Gemini directly');
        }

        // ── Strategy 2: Gemini STT fallback ──
        if (!transcribedText) {
          const GEMINI_API_KEY = Deno.env.get('GEMINI_API');
          if (!GEMINI_API_KEY) {
            throw new Error('Neither ElevenLabs nor Gemini API keys are configured for STT');
          }

          console.log('[STT] Using Gemini Flash for audio transcription...');
          
          // Convert audio blob to base64 for Gemini inline_data
          const audioArrayBuffer = await audioBlob.arrayBuffer();
          const audioUint8 = new Uint8Array(audioArrayBuffer);
          let binaryStr = '';
          for (let i = 0; i < audioUint8.length; i++) {
            binaryStr += String.fromCharCode(audioUint8[i]);
          }
          const audioBase64 = btoa(binaryStr);

          const geminiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

          const geminiResult = await geminiClient.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: audioMediaItem.mimeType || 'audio/ogg',
                    data: audioBase64,
                  }
                },
                {
                  text: 'Transcribe this audio message exactly as spoken. Return ONLY the transcribed text, nothing else. No quotes, no labels, no prefixes. If the audio is in a language other than English, transcribe in that original language.'
                }
              ]
            }]
          });

          transcribedText = (geminiResult as any)?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() 
            || (geminiResult as any)?.text?.trim()
            || '';
          
          if (transcribedText) {
            console.log('[STT] ✅ Gemini transcription succeeded:', transcribedText.substring(0, 200));
          } else {
            throw new Error('Gemini transcription returned empty text');
          }
        }

        if (!transcribedText) {
          throw new Error('All transcription strategies returned empty text');
        }

        // Step 4: PAYLOAD REPLACEMENT — inject transcribed text as messageBody
        messageBody = transcribedText;
        console.log('[STT] ✅ Payload replaced — voice note will flow through normal text pipeline');

      } catch (sttError) {
        console.error('[STT] ❌ Transcription pipeline failed:', sttError);
        return reply('I received your voice note, but my audio processor is temporarily down. Please try again or type your message.');
      }
    }

    console.log('Incoming WhatsApp message:', {
      fromNumber,
      messageBody: messageBody?.substring(0, 100),
      numMedia: mediaItems.length,
      uploadedMedia: mediaUrls.length,
      wasTranscribed: isAudioMessage && !!messageBody,
    });

    // Handle location sharing
    if (latitude && longitude && !messageBody && mediaUrls.length === 0) {
      return reply(`📍 Thanks for sharing your location! (${latitude}, ${longitude})\n\nYou can add a task with this location by sending a message like:\n"Buy groceries at this location"`);
    }

    // Handle media-only messages (images, documents) — route directly to CREATE
    // NOTE: Audio voice notes never reach here — they were transcribed above
    // and injected into messageBody, so they flow through the normal text pipeline.
    if (mediaUrls.length > 0 && !messageBody) {
      console.log('[WhatsApp] Processing media-only message — routing directly to CREATE');

      // Authenticate user first (need userId, coupleId for note creation)
      const { data: mediaProfiles, error: mediaProfileError } = await supabase
        .from('clerk_profiles')
        .select('id, display_name, timezone, language_preference, default_privacy')
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
      
      // Respect user's default privacy preference
      const mediaDefaultPrivacy = mediaProfile.default_privacy || 'shared';
      const mediaEffectiveCoupleId = mediaDefaultPrivacy === 'private' ? null : mediaCoupleId;

      // ====================================================================
      // IMAGE / DOCUMENT processing via process-note (non-audio media only)
      // Audio messages were already transcribed above via payload replacement
      // and will flow through the normal text pipeline instead of hitting here.
      // ====================================================================
      const mediaPayload: any = {
        text: '',
        user_id: mediaUserId,
        couple_id: mediaEffectiveCoupleId,
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

      // ====================================================================
      // Handle both single and multiple notes from process-note
      // ====================================================================
      const userMediaLang = (mediaProfile.language_preference || 'en').replace(/-.*/, ''); // 'it-IT' → 'it'
      
      try {
        const isMultiple = processData.multiple === true && Array.isArray(processData.notes) && processData.notes.length > 0;
        const notesToInsert = isMultiple ? processData.notes : [processData];

        const insertedNotes: Array<{ id: string; summary: string; list_id: string | null }> = [];

        for (const note of notesToInsert) {
          const noteSummary = note.summary || processData.summary || 'Media attachment';
          const noteData = {
            author_id: mediaUserId,
            couple_id: mediaEffectiveCoupleId,
            original_text: note.original_text || noteSummary,
            summary: noteSummary,
            category: note.category || processData.category || 'task',
            due_date: note.due_date || null,
            reminder_time: note.reminder_time || null,
            recurrence_frequency: note.recurrence_frequency || null,
            recurrence_interval: note.recurrence_interval || null,
            priority: note.priority || 'medium',
            tags: note.tags || [],
            items: note.items || [],
            task_owner: note.task_owner || null,
            list_id: note.list_id || processData.list_id || null,
            media_urls: mediaUrls,
            completed: false,
          };

          const { data: insertedNote, error: insertError } = await supabase
            .from('clerk_notes')
            .insert(noteData)
            .select('id, summary, list_id')
            .single();

          if (insertError) {
            console.error('[WhatsApp] Insert error for media note:', insertError);
            continue; // Skip failed inserts, try the rest
          }
          insertedNotes.push(insertedNote);
        }

        if (insertedNotes.length === 0) {
          throw new Error('All note insertions failed');
        }

        // Resolve list name from the first note
        let listName = 'Tasks';
        const firstListId = insertedNotes[0].list_id;
        if (firstListId) {
          const { data: listData } = await supabase
            .from('clerk_lists')
            .select('name')
            .eq('id', firstListId)
            .single();
          listName = listData?.name || 'Tasks';
        }

        // Build multilingual confirmation message
        let confirmMsg: string;
        if (insertedNotes.length === 1) {
          confirmMsg = `✅ ${
            userMediaLang === 'it' ? 'Salvato' : userMediaLang === 'es' ? 'Guardado' : 'Saved'
          }: ${insertedNotes[0].summary}\n📂 ${
            userMediaLang === 'it' ? 'Aggiunto a' : userMediaLang === 'es' ? 'Añadido a' : 'Added to'
          }: ${listName}\n\n🔗 Manage: https://witholive.app`;
        } else {
          const itemList = insertedNotes.map((n, i) => `  ${i + 1}. ${n.summary}`).join('\n');
          confirmMsg = `✅ ${
            userMediaLang === 'it' ? `Salvati ${insertedNotes.length} elementi` 
            : userMediaLang === 'es' ? `Guardados ${insertedNotes.length} elementos` 
            : `Saved ${insertedNotes.length} items`
          }:\n${itemList}\n📂 ${
            userMediaLang === 'it' ? 'Aggiunti a' : userMediaLang === 'es' ? 'Añadidos a' : 'Added to'
          }: ${listName}\n\n🔗 Manage: https://witholive.app`;
        }

        // Store last note as referenced entity (safe — session may not exist yet)
        try {
          const lastNote = insertedNotes[insertedNotes.length - 1];
          await saveReferencedEntity(
            { id: lastNote.id, summary: lastNote.summary, list_id: lastNote.list_id || undefined },
            confirmMsg
          );
        } catch (refErr) {
          console.warn('[WhatsApp] Could not save referenced entity (session not initialized):', (refErr as Error).message);
        }

        return reply(confirmMsg);
      } catch (insertErr) {
        console.error('Database insertion error for media note:', insertErr);
        return reply(
          userMediaLang === 'it' ? 'Ho analizzato la tua immagine ma non sono riuscito a salvarla. Riprova.'
          : userMediaLang === 'es' ? 'Analicé tu imagen pero tuve problemas al guardarla. Inténtalo de nuevo.'
          : 'I analyzed your image but had trouble saving it. Please try again.'
        );
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
      .select('id, display_name, timezone, language_preference, default_privacy')
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
    // Detect language: prefer profile setting, then auto-detect from message content
    let userLang = profile.language_preference || '';
    if (!userLang || userLang === 'en') {
      // Auto-detect language from message content for users who haven't set preference
      const msgLower = (messageBody || '').toLowerCase();
      const italianSignals = /\b(ciao|buon(?:giorno|asera)|grazie|per favore|ricordami|mostra|fatto|attività|promemoria|cosa|quali|sono|che|il|la|le|gli|del|della|delle|dei|degli|nel|nella|nelle|nei|agli|alle|quanto|quando|perch[eé]|anche|molto|questo|questa|questi|queste|quel[lo]?|come)\b/i;
      const spanishSignals = /\b(hola|buenos?\s*d[ií]as|gracias|por favor|recu[ée]rdame|muestra|hecho|tareas|recordatorio|qu[ée]|cu[aá]les|son|los|las|del|de la|de los|en el|en la|cu[aá]nto|cu[aá]ndo|tambi[ée]n|mucho|este|esta|estos|estas|aquel|como)\b/i;
      if (italianSignals.test(msgLower)) {
        userLang = 'it';
        // Auto-save detected language for future messages
        try {
          await supabase.from('clerk_profiles').update({ language_preference: 'it-IT' }).eq('id', profile.id);
        } catch (_) { /* non-blocking */ }
      } else if (spanishSignals.test(msgLower)) {
        userLang = 'es';
        try {
          await supabase.from('clerk_profiles').update({ language_preference: 'es-ES' }).eq('id', profile.id);
        } catch (_) { /* non-blocking */ }
      } else {
        userLang = userLang || 'en';
      }
    }

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

    // Respect user's default privacy preference for note creation
    // 'private' → couple_id = null; 'shared' (default) → couple_id = coupleId
    const defaultPrivacy = profile.default_privacy || 'shared';
    const effectiveCoupleId = defaultPrivacy === 'private' ? null : coupleId;
    console.log(`[Privacy] default_privacy=${defaultPrivacy}, coupleId=${coupleId}, effectiveCoupleId=${effectiveCoupleId}`);

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
        ].slice(-20); // Keep last 10 exchanges (20 messages)

        const updatedContext: ConversationContext = {
          ...currentContext,
          conversation_history: updatedHistory,
          // Always store the current user message for "schedule it" / "then create it" fallback
          last_user_message: (messageBody || '').substring(0, 1000),
          last_user_message_at: new Date().toISOString(),
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
          // Also set the outbound task reference for reply() to persist
          _lastReferencedTaskId = task.id;
          _lastReferencedTaskSummary = task.summary;
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

          const dueSetLocalized: Record<string, string> = {
            en: `✅ Done! "${pendingAction.task_summary}" is now due ${pendingAction.readable}. 📅`,
            es: `✅ ¡Hecho! "${pendingAction.task_summary}" ahora vence ${pendingAction.readable}. 📅`,
            it: `✅ Fatto! "${pendingAction.task_summary}" ora è previsto ${pendingAction.readable}. 📅`,
          };
          const sl = (userLang || 'en').split('-')[0];
          return reply(dueSetLocalized[sl] || dueSetLocalized.en);
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

          const reminderSetLocalized: Record<string, string> = {
            en: `✅ Done! I'll remind you about "${pendingAction.task_summary}" ${pendingAction.readable}. ⏰`,
            es: `✅ ¡Hecho! Te recordaré "${pendingAction.task_summary}" ${pendingAction.readable}. ⏰`,
            it: `✅ Fatto! Ti ricorderò "${pendingAction.task_summary}" ${pendingAction.readable}. ⏰`,
          };
          return reply(reminderSetLocalized[sl] || reminderSetLocalized.en);
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
    // PRE-CLASSIFICATION: Shortcut prefix interception
    // Shortcuts (+, !, $, ?, /, @) are deterministic — skip AI entirely.
    // ========================================================================
    const trimmedMsg = (messageBody || '').trim();
    const firstChar = trimmedMsg.charAt(0);
    const shortcutDef = SHORTCUTS[firstChar];
    
    if (shortcutDef && trimmedMsg.length > 1) {
      const shortcutClean = trimmedMsg.slice(1).trim();
      console.log(`[Shortcut] Pre-classification intercept: "${firstChar}" → ${shortcutDef.label}, clean="${shortcutClean.substring(0, 50)}"`);
      
      const shortcutIntent: any = {
        intent: shortcutDef.intent,
        cleanMessage: shortcutClean,
        ...(shortcutDef.options || {}),
      };
      
      // For shortcuts, skip AI classification entirely — jump to intent handling
      const { routeIntent } = await import("../_shared/model-router.ts");
      const hasMedia = mediaUrls.length > 0;
      const route = routeIntent(shortcutDef.intent.toLowerCase(), undefined, hasMedia);
      
      // Set up session context for conversation history
      const sessionContext = (session.context_data || {}) as ConversationContext;
      const conversationHistory = sessionContext.conversation_history || [];
      
      // Update conversation history
      conversationHistory.push({ role: 'user', content: messageBody || '', timestamp: new Date().toISOString() });
      if (conversationHistory.length > 20) conversationHistory.splice(0, conversationHistory.length - 20);
      
      const { intent, isUrgent, cleanMessage } = shortcutIntent;
      const effectiveMessage = cleanMessage ?? messageBody;
      console.log('Final intent (shortcut):', intent, 'isUrgent:', isUrgent, 'for message:', effectiveMessage?.substring(0, 50));
      
      // Router telemetry — non-blocking
      try {
        const { logRouterDecision } = await import("../_shared/router-logger.ts");
        const { getModel } = await import("../_shared/gemini.ts");
        logRouterDecision(supabase, {
          userId,
          source: "whatsapp",
          rawText: messageBody || '',
          classifiedIntent: intent.toLowerCase(),
          confidence: 1.0,
          chatType: undefined,
          classificationModel: 'shortcut',
          responseModel: getModel(route.responseTier as any),
          routeReason: `Shortcut prefix: ${firstChar}`,
          classificationLatencyMs: 0,
          totalLatencyMs: 0,
          mediaPresent: hasMedia,
        });
      } catch (logErr) {
        console.warn('[RouterLogger] Non-blocking error:', logErr);
      }
      
      // Jump to the appropriate handler based on shortcut intent
      // We need to handle this inline since we're skipping the normal flow
      if (intent === 'SEARCH') {
        // Fall through to normal flow with the shortcut result
      } else if (intent === 'CREATE') {
        // Process note creation with the clean message
        console.log(`[Shortcut→CREATE] Processing: "${effectiveMessage?.substring(0, 80)}"`);
        try {
          const processResponse = await supabase.functions.invoke('process-note', {
            body: {
              text: effectiveMessage,
              user_id: userId,
              couple_id: effectiveCoupleId || undefined,
              timezone: profile?.timezone || 'America/New_York',
              source: 'whatsapp',
              isUrgent: isUrgent || false,
            },
          });
          
          if (processResponse.error) {
            console.error('[Shortcut→CREATE] process-note error:', processResponse.error);
            return reply(t('error_generic', userLang));
          }
          
          const noteData = processResponse.data?.note || processResponse.data;
          const summary = noteData?.summary || effectiveMessage;
          const newNoteId = noteData?.id;
          const insertedListId = noteData?.list_id;
          
          // Resolve list name consistently with main CREATE path
          let listName = 'Tasks';
          if (insertedListId) {
            const { data: listRow } = await supabase
              .from('clerk_lists')
              .select('name')
              .eq('id', insertedListId)
              .single();
            if (listRow?.name) listName = listRow.name;
          } else if (noteData?.category && noteData.category !== 'task') {
            listName = noteData.category;
          }

          // Build rich confirmation matching main CREATE path
          const shortcutTips: Record<string, string[]> = {
            en: [
              "Reply 'Make it urgent' to change priority",
              "Reply 'Show my tasks' to see your list",
              "You can send voice notes too! 🎤",
              "Reply 'Move to Work' to switch lists",
              "Use ! prefix for urgent tasks (e.g., !call mom)",
              "Use $ to log expenses (e.g., $25 lunch)",
              "Use ? to search your tasks (e.g., ?groceries)",
              "Use @ to assign to partner (e.g., @partner pick up kids)",
              "Send a photo of a receipt to log it automatically 📸",
              "Say 'Remind me tomorrow at 9am' to set reminders",
              "Ask 'What's overdue?' to see pending tasks",
              "Say 'Summarize my week' for a weekly recap",
              "Use / to chat with Olive (e.g., /what should I focus on?)",
              "Send a comma-separated list to create multiple tasks at once",
              "Say 'done with X' to mark a task complete",
            ],
            es: [
              "Responde 'Hazlo urgente' para cambiar la prioridad",
              "Responde 'Mostrar mis tareas' para ver tu lista",
              "¡También puedes enviar notas de voz! 🎤",
              "Responde 'Mover a Trabajo' para cambiar de lista",
              "Usa ! para tareas urgentes (ej. !llamar mamá)",
              "Usa $ para registrar gastos (ej. $25 almuerzo)",
              "Usa ? para buscar tareas (ej. ?compras)",
              "Usa @ para asignar a tu pareja (ej. @pareja recoger niños)",
              "Envía una foto de un recibo para registrarlo automáticamente 📸",
              "Di 'Recuérdame mañana a las 9am' para poner recordatorios",
              "Pregunta '¿Qué está vencido?' para ver tareas pendientes",
              "Di 'Resumen de mi semana' para un recap semanal",
              "Usa / para chatear con Olive (ej. /¿en qué debo enfocarme?)",
              "Envía una lista separada por comas para crear varias tareas",
              "Di 'hecho con X' para completar una tarea",
            ],
            it: [
              "Rispondi 'Rendilo urgente' per cambiare la priorità",
              "Rispondi 'Mostra le mie attività' per vedere la lista",
              "Puoi anche inviare note vocali! 🎤",
              "Rispondi 'Sposta in Lavoro' per cambiare lista",
              "Usa ! per attività urgenti (es. !chiamare mamma)",
              "Usa $ per registrare spese (es. $25 pranzo)",
              "Usa ? per cercare attività (es. ?spesa)",
              "Usa @ per assegnare al partner (es. @partner prendere i bambini)",
              "Invia una foto di uno scontrino per registrarlo automaticamente 📸",
              "Di 'Ricordami domani alle 9' per impostare promemoria",
              "Chiedi 'Cosa è scaduto?' per vedere le attività in ritardo",
              "Di 'Riassunto della settimana' per un recap settimanale",
              "Usa / per chattare con Olive (es. /su cosa dovrei concentrarmi?)",
              "Invia una lista separata da virgole per creare più attività",
              "Di 'fatto con X' per completare un'attività",
            ],
          };
          const langTips = shortcutTips[userLang.split('-')[0]] || shortcutTips.en;
          const tip = langTips[Math.floor(Math.random() * langTips.length)];

          let confirmMsg: string;
          if (isUrgent) {
            confirmMsg = [
              t('note_saved', userLang, { summary }),
              t('note_added_to', userLang, { list: listName }),
              t('note_priority_high', userLang),
              ``,
              t('note_manage', userLang),
              ``,
              `💡 ${tip}`
            ].join('\n');
          } else {
            confirmMsg = [
              t('note_saved', userLang, { summary }),
              t('note_added_to', userLang, { list: listName }),
              ``,
              t('note_manage', userLang),
              ``,
              `💡 ${tip}`
            ].join('\n');
          }
          
          // Update session with entity reference
          if (newNoteId) {
            const updatedContext: any = { ...sessionContext, conversation_history: conversationHistory };
            updatedContext.last_referenced_entity = newNoteId;
            updatedContext.entity_referenced_at = new Date().toISOString();
            updatedContext.last_user_message = messageBody;
            await supabase
              .from('olive_gateway_sessions')
              .update({ conversation_context: updatedContext, last_activity: new Date().toISOString() })
              .eq('id', session.id);
            
            // Store outbound context
            await supabase
              .from('clerk_profiles')
              .update({ last_outbound_context: { type: 'task_created', task_id: newNoteId, task_summary: summary, timestamp: new Date().toISOString() } })
              .eq('id', userId);
          }
          
          return reply(confirmMsg);
        } catch (err) {
          console.error('[Shortcut→CREATE] Error:', err);
          return reply(t('error_generic', userLang));
        }
      } else if (intent === 'EXPENSE') {
        // Handle expense inline — do NOT fall through to AI classifier
        console.log(`[Shortcut→EXPENSE] Processing: "${effectiveMessage?.substring(0, 80)}"`);
        
        // If media attached with $ prefix, route to process-receipt
        if (mediaUrls.length > 0) {
          console.log('[Shortcut→EXPENSE] Media attached — routing to process-receipt');
          try {
            const { data: receiptResult } = await supabase.functions.invoke('process-receipt', {
              body: {
                image_url: mediaUrls[0],
                user_id: userId,
                couple_id: effectiveCoupleId,
                caption: effectiveMessage || undefined,
              },
            });
            if (receiptResult?.transaction) {
              const tx = receiptResult.transaction;
              let response = t('expense_logged', userLang, {
                amount: `$${Number(tx.amount).toFixed(2)}`,
                merchant: tx.merchant || 'Unknown',
                category: tx.category || 'Other',
              });
              return reply(response);
            }
            return reply(receiptResult?.message || t('error_generic', userLang));
          } catch (e) {
            console.error('[Shortcut→EXPENSE] Receipt processing error:', e);
            return reply(t('error_generic', userLang));
          }
        }

        // Parse expense text with robust multi-format parser
        const parsedExpense = parseExpenseText(effectiveMessage || '');
        if (!parsedExpense) {
          return reply(t('expense_need_amount', userLang));
        }

        // Use AI to categorize
        let merchant = parsedExpense.description;
        let category = 'other';
        try {
          const categorizationPrompt = `Extract the merchant name and expense category from this description.
Respond with ONLY valid JSON: {"merchant": "name", "category": "one_of_these"}
Categories: food, transport, shopping, entertainment, utilities, health, groceries, travel, personal, education, subscriptions, other

Description: "${parsedExpense.description}"`;
          const categResult = await callAI(categorizationPrompt, parsedExpense.description, 0.3, "lite");
          const parsed = JSON.parse(categResult.replace(/```json?|```/g, '').trim());
          if (parsed.merchant) merchant = parsed.merchant;
          if (parsed.category) category = parsed.category;
        } catch (e) {
          console.log('[Shortcut→EXPENSE] AI categorization fallback:', e);
          const atMatch = parsedExpense.description.match(/(?:at|from|@)\s+(.+)$/i);
          if (atMatch) merchant = atMatch[1].trim();
        }

        // Insert into expenses table
        try {
          const { error: txError } = await supabase
            .from('expenses')
            .insert({
              user_id: userId,
              couple_id: effectiveCoupleId || null,
              amount: parsedExpense.amount,
              name: merchant,
              category,
              currency: parsedExpense.currency,
              paid_by: userId,
              split_type: 'individual',
              expense_date: new Date().toISOString().split('T')[0],
              is_shared: false,
              original_text: messageBody || effectiveMessage,
            });

          if (txError) {
            console.error('[Shortcut→EXPENSE] Insert error:', txError);
            return reply(t('error_generic', userLang));
          }

          const currencySymbol = parsedExpense.currency === 'EUR' ? '€' : parsedExpense.currency === 'GBP' ? '£' : '$';
          let response = t('expense_logged', userLang, {
            amount: `${currencySymbol}${parsedExpense.amount.toFixed(2)}`,
            merchant,
            category,
          });
          response += '\n\n🔗 Manage: https://witholive.app';
          return reply(response);
        } catch (e) {
          console.error('[Shortcut→EXPENSE] Error:', e);
          return reply(t('error_generic', userLang));
        }
      } else if (intent === 'CHAT') {
        // Fall through to normal flow
      }
      // For intents that need the full flow (SEARCH, EXPENSE, CHAT, TASK_ACTION),
      // we set intentResult and let it fall through below
      // But for CREATE we already handled it above and returned
    }

    // ========================================================================
    // AI-POWERED INTENT CLASSIFICATION (with regex fallback)
    // ========================================================================
    const sessionContext = (session.context_data || {}) as ConversationContext;
    const conversationHistory = sessionContext.conversation_history || [];

    // Fetch context for AI router (parallel lightweight queries)
    const [taskListResult, memoriesResult, skillsResult, listsResult] = await Promise.all([
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
      // User's list names for classifier disambiguation
      supabase
        .from('clerk_lists')
        .select('name')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
        .limit(20),
    ]);

    const activeTasks = taskListResult.data || [];
    const userMemories = memoriesResult.data || [];
    const activatedSkills = skillsResult.data || [];
    const userLists = listsResult.data || [];

    // Build outbound context strings for AI
    const outboundContextStrings = recentOutbound.map(m => m.content).filter(Boolean);

    // Call shared AI classifier (from _shared/intent-classifier.ts)
    const { classifyIntent: sharedClassifyIntent } = await import("../_shared/intent-classifier.ts");
    const classificationResult = await sharedClassifyIntent({
      message: messageBody || '',
      conversationHistory: conversationHistory.map(m => ({ role: m.role, content: m.content })),
      recentOutboundMessages: outboundContextStrings,
      activeTasks,
      userMemories,
      activatedSkills,
      userLists,
      userLanguage: userLang,
      hasMedia: mediaUrls.length > 0,
    });
    const aiResult = classificationResult.intent;
    const classificationLatencyMs = classificationResult.latencyMs;

    // Route intent → model tier (from _shared/model-router.ts)
    const { routeIntent } = await import("../_shared/model-router.ts");
    const hasMedia = mediaUrls.length > 0;
    const route = routeIntent(
      aiResult?.intent || 'chat',
      aiResult?.parameters?.chat_type || undefined,
      hasMedia,
    );
    console.log(`[Router] intent=${aiResult?.intent} → tier=${route.responseTier} reason=${route.reason} hasMedia=${hasMedia}`);

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

    // ========================================================================
    // POST-CLASSIFICATION SAFETY NET #0: Media+caption override
    // If media is attached and intent is NOT create/expense, force CREATE.
    // Users sending images/docs with captions are ALWAYS saving something.
    // ========================================================================
    if (mediaUrls.length > 0 && messageBody && !['CREATE', 'EXPENSE'].includes(intentResult.intent)) {
      console.log(`[SafetyNet#0] ⚡ Overriding ${intentResult.intent} → CREATE (media+caption always = save)`);
      intentResult = { ...intentResult, intent: 'CREATE' };
    }

    // ========================================================================
    // POST-CLASSIFICATION SAFETY NET #0.5: Long conversational messages with
    // email addresses or assistive requests misclassified as PARTNER_MESSAGE
    // or CREATE should be routed to CHAT (assistant).
    // ========================================================================
    if ((intentResult.intent === 'PARTNER_MESSAGE' || intentResult.intent === 'CREATE') && messageBody) {
      const msgLower = messageBody.toLowerCase();
      const hasEmailAddress = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(messageBody);
      const isLongConversational = messageBody.length > 100;
      
      // Broad assistive signal detection (EN/ES/IT)
      const hasAssistiveSignals = /\b(draft|compose|write|prepare|bozza|redigi|scrivi|prepara|aiutami|help me|ci pensi tu|puoi|can you|could you|me ayudas|ayúdame|plan|brainstorm|think through|figure out|compare|advise|suggest|recommend|analyze|summarize|break down|talking points|come up with|what do you think|what should i|give me ideas|help me decide|help me plan|help me write|help me draft|handle this|take care of|pensaci tu|ocupate|encárgate)\b/i.test(msgLower);
      
      // Detect "help me with X" style messages even if shorter
      const isHelpRequest = /\b(help me|aiutami|ayúdame|ci pensi tu|puoi.*per me|can you.*for me|could you.*for me)\b/i.test(msgLower);
      
      if (hasEmailAddress && (isLongConversational || hasAssistiveSignals)) {
        console.log(`[SafetyNet#0.5] Overriding ${intentResult.intent} → CHAT (assistant) — email address + assistive signals`);
        intentResult = { ...intentResult, intent: 'CHAT', chatType: 'assistant' } as any;
      } else if (isLongConversational && hasAssistiveSignals) {
        console.log(`[SafetyNet#0.5] Overriding ${intentResult.intent} → CHAT (assistant) — long assistive message`);
        intentResult = { ...intentResult, intent: 'CHAT', chatType: 'assistant' } as any;
      } else if (isHelpRequest && messageBody.length > 60) {
        console.log(`[SafetyNet#0.5] Overriding ${intentResult.intent} → CHAT (assistant) — explicit help request`);
        intentResult = { ...intentResult, intent: 'CHAT', chatType: 'assistant' } as any;
      }
    }

    //
    // POST-CLASSIFICATION SAFETY NET: Catch misclassified follow-up actions
    // If the AI classified as CREATE but the message is clearly a follow-up
    // action (change/update/move/delete/remind + pronoun), override to TASK_ACTION
    // ========================================================================
    const sessionCtxForOverride = (session.context_data || {}) as ConversationContext;
    const hasRecentEntity = sessionCtxForOverride.last_referenced_entity &&
      sessionCtxForOverride.entity_referenced_at &&
      (Date.now() - new Date(sessionCtxForOverride.entity_referenced_at).getTime()) < 10 * 60 * 1000;

    if (intentResult.intent === 'CREATE' && hasRecentEntity && messageBody) {
      const msgLower = messageBody.toLowerCase();
      // Detect action verbs + pronouns in EN/ES/IT
      const actionPronounPatterns = [
        // English
        /\b(change|update|modify|move|set|reschedule|postpone|delete|remove|cancel|remind)\b.*\b(that|it|this|the reminder|for that|for it|for this)\b/i,
        /\b(that|it|this|for that|for it)\b.*\b(change|update|modify|move|set|reschedule|postpone|delete|remove|cancel|remind)\b/i,
        // "change the reminder for that"
        /\bchange\s+the\s+reminder\b/i,
        /\bset\s+(?:a\s+)?reminder\s+for\s+(?:that|it|this)\b/i,
        /\bremind\s+me\s+(?:about\s+)?(?:that|it|this)\b/i,
        // Spanish
        /\b(cambi[aeo]|modific[aeo]|mueve?|establec[eé]|pospon|elimin[aeo]|borr[aeo]|cancel[aeo]|recuérd[aeo]me)\b.*\b(eso|esa|esto|esta|lo|la)\b/i,
        // Italian  
        /\b(cambi[ao]|modific[ao]|spost[ao]|impost[ao]|cancel+[ao]|elimin[ao]|ricordami)\b.*\b(quello|quella|questo|questa|lo|la)\b/i,
      ];
      
      const isFollowUpAction = actionPronounPatterns.some(p => p.test(msgLower));
      
      if (isFollowUpAction) {
        console.log('[SafetyNet] ⚡ Overriding CREATE → TASK_ACTION (follow-up action with pronoun detected)');
        
        // Determine the specific action type from the message
        let overrideActionType: string = 'remind';
        if (/\b(change|set|update)\s+(?:the\s+)?reminder\b/i.test(msgLower) || /\bremind\b/i.test(msgLower)) {
          overrideActionType = 'remind';
        } else if (/\b(change|update|modify|reschedule|postpone|move.*to)\s+(it|that|this)?\s*(to|for)?\s/i.test(msgLower)) {
          // Check if it has a time expression → set_due; otherwise → move
          const hasTimeExpr = /\b(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+week|at\s+\d|am\b|pm\b|\d{1,2}:\d{2}|mañana|domani)\b/i.test(msgLower);
          overrideActionType = hasTimeExpr ? 'set_due' : 'move';
        } else if (/\b(delete|remove|cancel|elimin|borr|cancel)\b/i.test(msgLower)) {
          overrideActionType = 'delete';
        } else if (/\b(set_priority|urgent|priority|importante|urgente)\b/i.test(msgLower)) {
          overrideActionType = 'set_priority';
        }
        
        // Extract the time expression for remind/set_due
        const timeExprMatch = msgLower.match(/(?:to|at|for)\s+(tomorrow\s+at\s+\d+\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm)|tomorrow|today|next\s+\w+|monday|tuesday|wednesday|thursday|friday|saturday|sunday|in\s+\d+\s+\w+|mañana|domani)/i);
        const timeExpr = timeExprMatch ? timeExprMatch[1] : undefined;
        
        intentResult = {
          intent: 'TASK_ACTION',
          actionType: overrideActionType,
          actionTarget: 'that', // Let pronoun resolution handle it
          cleanMessage: timeExpr || messageBody,
          _aiTaskId: undefined,
        } as any;
      }
    }

    // ========================================================================
    // POST-CLASSIFICATION SAFETY NET #2: Follow-up detection
    // If AI classified as CREATE but conversation history shows Olive just
    // answered a contextual_ask or web_search, and the message looks like a
    // follow-up question/clarification, override to the appropriate intent.
    // ========================================================================
    if (intentResult.intent === 'CREATE' && messageBody) {
      const recentHistory = conversationHistory.slice(-10); // last 5 exchanges
      const lastOliveMsgs = recentHistory.filter(m => m.role === 'assistant');
      const lastOliveMsg = lastOliveMsgs.length > 0 ? lastOliveMsgs[lastOliveMsgs.length - 1].content : '';
      
      // Detect if Olive recently answered a contextual/search query (check last 2 assistant messages)
      const checkMessages = lastOliveMsgs.slice(-2).map(m => m.content).join(' ');
      const oliveJustSearched = 
        // Explicit search/query response patterns
        /🔍|📋\s*Found|Here'?s what I found|in your list|following\b|Found these|Cuisine|Rating/i.test(checkMessages) ||
        // Contains a URL (web search results)
        /\bhttps?:\/\/\S+/.test(checkMessages) ||
        // Listed items (numbered or bulleted)
        /^\s*[\d•\-]\s*.+$/m.test(checkMessages) ||
        // Answer to a question (starts with "You have", "There are", "Based on", etc.)
        /^(you have|there are|based on|i found|here are|according to|looking at)/im.test(checkMessages) ||
        // Olive provided details about a saved item (restaurant, booking, event)
        /\b(address|location|phone|website|rating|hours|reservation|booking|check-in|check.out|arrival|departure)\b/i.test(checkMessages);
      
      // Detect if current message is a follow-up (question, clarification, continuation)
      const msgLower = messageBody.toLowerCase();
      const isFollowUp = /\b(do they|does it|is it|are they|can i|can you|how do i|where is|what about|i meant|not that|the restaurant|search for|find me|book|reserve|look up|more info|more details|tell me more|what else|which one|how much|when do|where do|how long|do you know|give me|show me|any other)\b/i.test(msgLower) ||
        msgLower.endsWith('?') ||
        /^(no[, ]|i meant|not that|the \w+ one|what about|and |also )/i.test(msgLower) ||
        // Spanish/Italian follow-ups
        /\b(me puedes|puedes|sabes|dime|y |también|cuánto|cómo|dónde|mi puoi|puoi|sai|dimmi|anche|quanto|dove)\b/i.test(msgLower);
      
      // Check if message was sent within 5 minutes of last exchange
      const lastTimestamp = recentHistory.length > 0 ? recentHistory[recentHistory.length - 1].timestamp : null;
      const isRecent = lastTimestamp && (Date.now() - new Date(lastTimestamp).getTime()) < 5 * 60 * 1000;
      
      if (oliveJustSearched && isFollowUp && isRecent) {
        // Determine whether to route to web_search or contextual_ask
        const wantsExternalInfo = /\b(book|reserve|reservation|table|link|website|directions|address|phone|hours|open|menu|price|review|search|find|look up|prenotare|reservar|buscar|cercare|trovare|prenota|reserva)\b/i.test(msgLower);
        const newIntent = wantsExternalInfo ? 'WEB_SEARCH' : 'CONTEXTUAL_ASK';
        console.log(`[SafetyNet#2] ⚡ Overriding CREATE → ${newIntent} (follow-up after search/contextual answer, window=5min)`);
        intentResult = {
          ...intentResult,
          intent: newIntent as any,
        };
      }
    }

    let { intent, isUrgent, cleanMessage } = intentResult;
    const effectiveMessage = cleanMessage ?? messageBody;
    console.log('Final intent:', intent, 'isUrgent:', isUrgent, 'for message:', effectiveMessage?.substring(0, 50));

    // Router telemetry — non-blocking, fire-and-forget
    try {
      const { logRouterDecision } = await import("../_shared/router-logger.ts");
      const { getModel } = await import("../_shared/gemini.ts");
      logRouterDecision(supabase, {
        userId,
        source: "whatsapp",
        rawText: messageBody || '',
        classifiedIntent: aiResult?.intent || intent.toLowerCase(),
        confidence: aiResult?.confidence || 0,
        chatType: aiResult?.parameters?.chat_type || undefined,
        classificationModel: getModel("lite"),
        responseModel: getModel(route.responseTier as any),
        routeReason: route.reason,
        classificationLatencyMs: classificationLatencyMs,
        totalLatencyMs: classificationLatencyMs,
        mediaPresent: hasMedia,
      });
    } catch (logErr) {
      console.warn('[RouterLogger] Non-blocking error:', logErr);
    }

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
        
        const urgentResponse = `🔥 ${urgentTasks.length} Urgent Task${urgentTasks.length === 1 ? '' : 's'}:\n\n${urgentList}${moreText}\n\n🔗 Manage: https://witholive.app`;
        const displayedUrgent = urgentTasks.slice(0, 8);
        await saveReferencedEntity(displayedUrgent[0], urgentResponse, displayedUrgent.map(t => ({ id: t.id, summary: t.summary })));
        return reply(urgentResponse);
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
        
        const todayResponse = `📅 ${dueTodayTasks.length} Task${dueTodayTasks.length === 1 ? '' : 's'} Due Today:\n\n${todayList}${moreText}\n\n🔗 Manage: https://witholive.app`;
        const displayedToday = dueTodayTasks.slice(0, 8);
        await saveReferencedEntity(displayedToday[0], todayResponse, displayedToday.map(t => ({ id: t.id, summary: t.summary })));
        return reply(todayResponse);
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
        
        const displayedTomorrow = dueTomorrowTasks.slice(0, 8);
        if (displayedTomorrow.length > 0) {
          await saveReferencedEntity(displayedTomorrow[0], response, displayedTomorrow.map(t => ({ id: t.id, summary: t.summary })));
        }
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
        
        const displayedWeek = dueThisWeekTasks.slice(0, 10);
        if (displayedWeek.length > 0) {
          await saveReferencedEntity(displayedWeek[0], response, displayedWeek.map(t => ({ id: t.id, summary: t.summary })));
        }
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
        
        const overdueResponse = `⚠️ ${overdueTasks.length} Overdue Task${overdueTasks.length === 1 ? '' : 's'}:\n\n${overdueList}${moreText}\n\n🔗 Manage: https://witholive.app`;
        const displayedOverdue = overdueTasks.slice(0, 8);
        await saveReferencedEntity(displayedOverdue[0], overdueResponse, displayedOverdue.map(t => ({ id: t.id, summary: t.summary })));
        return reply(overdueResponse);
      }

      // ================================================================
      // SMART ESCALATION: If the user asked a content QUESTION (not a
      // dashboard command) and we couldn't match a specific list, escalate
      // to CONTEXTUAL_ASK which uses AI to search all saved data.
      // ================================================================
      const questionPatterns = /^(which|what|where|who|how|do i|did i|any |are there|have i|cuál|qué|dónde|quién|cómo|tengo|hay|quali|cosa|dove|chi|come|ho )\b/i;
      const isQuestionMark = (effectiveMessage || '').trim().endsWith('?');
      const isContentQuestion = questionPatterns.test((effectiveMessage || '').trim()) || isQuestionMark;
      
      if (isContentQuestion && queryType === 'general') {
        console.log('[WhatsApp] SEARCH escalating to CONTEXTUAL_ASK — question detected:', effectiveMessage?.substring(0, 60));
        // Re-route: jump to CONTEXTUAL_ASK handler by overriding intent
        intent = 'CONTEXTUAL_ASK' as any;
        // Fall through — the CONTEXTUAL_ASK handler below will pick it up
      } else {
        // Default: General task summary (dashboard)
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

        const prominentTask = urgentTasks[0] || dueTodayTasks[0] || activeTasks[0] || null;
        const displayedTasks = urgentTasks.length > 0 ? urgentTasks.slice(0, 3) : activeTasks.slice(0, 5);
        await saveReferencedEntity(prominentTask, summary, displayedTasks.map(t => ({ id: t.id, summary: t.summary })));
        return reply(summary);
      }
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
            // Fallback: check last_outbound_context.all_task_ids (set by agent-runner)
            try {
              const outboundCtx = await getOutboundContextWithTaskId(supabase, userId);
              if (outboundCtx?.all_task_ids && ordinalIndex < outboundCtx.all_task_ids.length) {
                const taskRef = outboundCtx.all_task_ids[ordinalIndex];
                const { data: outboundTask } = await supabase
                  .from('clerk_notes')
                  .select('id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time')
                  .eq('id', taskRef.id)
                  .maybeSingle();
                if (outboundTask) {
                  foundTask = outboundTask;
                  console.log(`[Context] Resolved ordinal #${ordinalIndex + 1} from outbound context: ${outboundTask.summary}`);
                }
              }
            } catch (outboundErr) {
              console.warn('[Context] Outbound context ordinal fallback failed:', outboundErr);
            }
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
              couple_id: effectiveCoupleId,
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
          const eventDueDate = parsed.date || processData.due_date || null;
          
          // Compute smart reminder time based on event date
          let reminderTime = parsed.date || null;
          if (!reminderTime && eventDueDate) {
            // If we have a due date but no explicit reminder time, compute smart reminder
            const eventDate = new Date(eventDueDate);
            const hoursUntilEvent = (eventDate.getTime() - Date.now()) / (1000 * 60 * 60);
            
            if (hoursUntilEvent <= 4) {
              reminderTime = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min from now
            } else if (hoursUntilEvent <= 24) {
              reminderTime = new Date(eventDate.getTime() - 2 * 60 * 60 * 1000).toISOString(); // 2h before
            } else {
              // Morning of event day (9 AM user timezone)
              const morningOf = new Date(eventDate);
              morningOf.setUTCHours(9, 0, 0, 0);
              try {
                const utcStr = morningOf.toLocaleString('en-US', { timeZone: 'UTC' });
                const tzStr = morningOf.toLocaleString('en-US', { timeZone: profile.timezone || 'America/New_York' });
                const utcDate = new Date(utcStr);
                const tzDate = new Date(tzStr);
                const offsetMs = utcDate.getTime() - tzDate.getTime();
                reminderTime = new Date(morningOf.getTime() + offsetMs).toISOString();
              } catch {
                reminderTime = morningOf.toISOString();
              }
            }
          }
          
          const noteData: any = {
            author_id: userId,
            couple_id: effectiveCoupleId,
            original_text: messageBody || taskDescription,
            summary: processData.summary || taskDescription,
            category: processData.category || 'Task',
            due_date: eventDueDate,
            reminder_time: reminderTime,
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
          
          const userTz = profile.timezone || 'America/New_York';
          const friendlyDate = reminderTime ? formatFriendlyDate(reminderTime, true, userTz) : (eventDueDate ? formatFriendlyDate(eventDueDate, true, userTz) : 'tomorrow at 9:00 AM');
          
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
              parsed.readable = formatFriendlyDate(parsed.date, true, profile.timezone || 'America/New_York');
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
              parsed.readable = formatFriendlyDate(parsed.date, true, profile.timezone || 'America/New_York');
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
          const targetListName = (effectiveMessage || '').trim();
          
          if (!targetListName) {
            return reply('Which list should I move this task to? Please provide a list name.');
          }
          
          // ROBUST LIST MATCHING: exact name match (case-insensitive), scoped to user's lists
          // Step 1: Fetch all lists the user has access to
          let listsQuery = supabase
            .from('clerk_lists')
            .select('id, name');
          
          if (coupleId) {
            // User has a couple — fetch both personal and couple lists
            listsQuery = listsQuery.or(`author_id.eq.${userId},couple_id.eq.${coupleId}`);
          } else {
            listsQuery = listsQuery.eq('author_id', userId);
          }
          
          const { data: allLists } = await listsQuery;
          
          // Step 2: Find best match — prefer exact match, then case-insensitive, then partial
          let existingList: { id: string; name: string } | null = null;
          const targetLower = targetListName.toLowerCase().trim();
          
          if (allLists && allLists.length > 0) {
            // Priority 1: Exact case-insensitive match
            existingList = allLists.find(l => l.name.toLowerCase().trim() === targetLower) || null;
            
            // Priority 2: Starts-with match (e.g., "Tasks" matches "Tasks & Projects")
            if (!existingList) {
              existingList = allLists.find(l => l.name.toLowerCase().trim().startsWith(targetLower)) || null;
            }
            
            // Priority 3: Target contains list name or vice versa
            if (!existingList) {
              existingList = allLists.find(l => {
                const listLower = l.name.toLowerCase().trim();
                return listLower.includes(targetLower) || targetLower.includes(listLower);
              }) || null;
            }
          }
          
          console.log(`[MOVE] Target: "${targetListName}" | Found: ${existingList ? `"${existingList.name}" (${existingList.id})` : 'NONE'} | Total lists: ${allLists?.length || 0}`);
          
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
          
          // No existing list found — create a new one
          const { data: newList, error: createError } = await supabase
            .from('clerk_lists')
            .insert({ 
              name: targetListName, 
              author_id: userId, 
              couple_id: effectiveCoupleId,
              is_manual: true
            })
            .select('id, name')
            .single();
          
          if (newList) {
            await supabase
              .from('clerk_notes')
              .update({ list_id: newList.id, updated_at: new Date().toISOString() })
              .eq('id', foundTask.id);
            
            const moveResponse = `📂 Created "${newList.name}" list and moved "${foundTask.summary}" there!`;
            await saveReferencedEntity({ ...foundTask, list_id: newList.id }, moveResponse);
            return reply(moveResponse);
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

          // SMART REMINDER DEFAULTS: Based on task's due_date or event time
          const taskDueDate = foundTask.due_date ? new Date(foundTask.due_date) : null;
          let smartReminderDate: Date;
          let smartReadable: string;

          if (taskDueDate && taskDueDate.getTime() > Date.now()) {
            const hoursUntilDue = (taskDueDate.getTime() - Date.now()) / (1000 * 60 * 60);
            const dueHour = taskDueDate.getUTCHours();

            if (hoursUntilDue <= 4) {
              // Due very soon: remind in 30 minutes
              smartReminderDate = new Date(Date.now() + 30 * 60 * 1000);
              smartReadable = 'in 30 minutes';
            } else if (hoursUntilDue <= 24) {
              // Due today: remind 2 hours before
              smartReminderDate = new Date(taskDueDate.getTime() - 2 * 60 * 60 * 1000);
              smartReadable = '2 hours before it\'s due';
            } else {
              // Due in future: remind morning of the event day (9 AM user timezone)
              smartReminderDate = new Date(taskDueDate);
              smartReminderDate.setUTCHours(9, 0, 0, 0);
              // Adjust for timezone
              try {
                const utcStr = smartReminderDate.toLocaleString('en-US', { timeZone: 'UTC' });
                const tzStr = smartReminderDate.toLocaleString('en-US', { timeZone: profile.timezone || 'America/New_York' });
                const utcDate = new Date(utcStr);
                const tzDate = new Date(tzStr);
                const offsetMs = utcDate.getTime() - tzDate.getTime();
                smartReminderDate = new Date(smartReminderDate.getTime() + offsetMs);
              } catch { /* keep as-is */ }

              // If the event is in the afternoon (after 1pm), also consider evening-before reminder
              if (dueHour >= 13) {
                // Set reminder to evening before at 8 PM
                const eveningBefore = new Date(taskDueDate);
                eveningBefore.setDate(eveningBefore.getDate() - 1);
                eveningBefore.setUTCHours(20, 0, 0, 0);
                try {
                  const utcStr = eveningBefore.toLocaleString('en-US', { timeZone: 'UTC' });
                  const tzStr = eveningBefore.toLocaleString('en-US', { timeZone: profile.timezone || 'America/New_York' });
                  const utcDate = new Date(utcStr);
                  const tzDate = new Date(tzStr);
                  const offsetMs = utcDate.getTime() - tzDate.getTime();
                  smartReminderDate = new Date(eveningBefore.getTime() + offsetMs);
                } catch { /* keep as-is */ }
                smartReadable = 'the evening before (8:00 PM) + morning of (9:00 AM)';
              } else {
                smartReadable = 'the morning of (9:00 AM)';
              }
            }
          } else {
            // No due date: default to tomorrow 9am
            smartReminderDate = new Date();
            smartReminderDate.setDate(smartReminderDate.getDate() + 1);
            smartReminderDate.setHours(9, 0, 0, 0);
            smartReadable = 'tomorrow at 9:00 AM';
          }

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
                  time: smartReminderDate.toISOString(),
                  readable: smartReadable,
                  has_due_date: !!foundTask.due_date
                }
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', session.id);

          return reply(`⏰ Set reminder for "${foundTask.summary}" ${smartReadable}?\n\nReply "yes" to confirm.`);
        }
        
        default:
          return reply('I didn\'t understand that action. Try "done with [task]", "make [task] urgent", or "assign [task] to partner".');
      }
    }

    // ========================================================================
    // EXPENSE HANDLER - AI-classified expense (natural language)
    // ========================================================================
    if (intent === 'EXPENSE') {
      console.log('[WhatsApp] Processing EXPENSE (AI-classified):', effectiveMessage?.substring(0, 80));
      const expenseText = effectiveMessage || messageBody || '';

      // If media attached, route to process-receipt
      if (mediaUrls.length > 0) {
        console.log('[Expense] Media attached — routing to process-receipt');
        try {
          const { data: receiptResult } = await supabase.functions.invoke('process-receipt', {
            body: {
              image_url: mediaUrls[0],
              user_id: userId,
              couple_id: effectiveCoupleId,
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

      // Use robust multi-format parser
      const parsedExpense = parseExpenseText(expenseText);
      if (!parsedExpense) {
        return reply(t('expense_need_amount', userLang));
      }

      // Use AI to categorize the expense
      let merchant = parsedExpense.description;
      let category = 'other';
      try {
        const categorizationPrompt = `Extract the merchant name and expense category from this description.
Respond with ONLY valid JSON: {"merchant": "name", "category": "one_of_these"}
Categories: food, transport, shopping, entertainment, utilities, health, groceries, travel, personal, education, subscriptions, other

Description: "${parsedExpense.description}"`;
        const categResult = await callAI(categorizationPrompt, parsedExpense.description, 0.3, "lite");
        const parsed = JSON.parse(categResult.replace(/```json?|```/g, '').trim());
        if (parsed.merchant) merchant = parsed.merchant;
        if (parsed.category) category = parsed.category;
      } catch (e) {
        console.log('[Expense] AI categorization failed, using defaults:', e);
        const atMatch = parsedExpense.description.match(/(?:at|from|@)\s+(.+)$/i);
        if (atMatch) {
          merchant = atMatch[1].trim();
        }
      }

      // Insert into expenses table (correct schema)
      try {
        const { error: txError } = await supabase
          .from('expenses')
          .insert({
            user_id: userId,
            couple_id: effectiveCoupleId || null,
            amount: parsedExpense.amount,
            name: merchant,
            category,
            currency: parsedExpense.currency,
            paid_by: userId,
            split_type: 'individual',
            expense_date: new Date().toISOString().split('T')[0],
            is_shared: false,
            original_text: messageBody || expenseText,
          });

        if (txError) {
          console.error('[Expense] Insert error:', txError);
          return reply(t('error_generic', userLang));
        }

        const currencySymbol = parsedExpense.currency === 'EUR' ? '€' : parsedExpense.currency === 'GBP' ? '£' : '$';
        let response = t('expense_logged', userLang, {
          amount: `${currencySymbol}${parsedExpense.amount.toFixed(2)}`,
          merchant,
          category,
        });

        // Check budget status
        try {
          const { data: budgetCheck } = await supabase.rpc('check_budget_status', {
            p_user_id: userId,
            p_category: category,
            p_amount: parsedExpense.amount,
          });
          if (budgetCheck && budgetCheck.length > 0) {
            const budget = budgetCheck[0];
            if (budget.status === 'over_limit') {
              response += '\n' + t('expense_over_budget', userLang, {
                category,
                spent: `${currencySymbol}${Number(budget.new_total).toFixed(2)}`,
                limit: `${currencySymbol}${Number(budget.limit_amount).toFixed(2)}`,
              });
            } else if (budget.status === 'warning') {
              response += '\n' + t('expense_budget_warning', userLang, {
                category,
                percentage: String(Math.round(budget.percentage)),
                spent: `${currencySymbol}${Number(budget.new_total).toFixed(2)}`,
                limit: `${currencySymbol}${Number(budget.limit_amount).toFixed(2)}`,
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
      
      // Fetch notes WITH original_text for full detail access
      const { data: allTasks } = await supabase
        .from('clerk_notes')
        .select('id, summary, original_text, category, list_id, items, tags, priority, due_date, reminder_time, completed, created_at')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
        .order('created_at', { ascending: false })
        .limit(200);
      
      const { data: lists } = await supabase
        .from('clerk_lists')
        .select('id, name, description')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`);
      
      // Fetch calendar events for the next 30 days
      let calendarContext = '';
      try {
        const { data: calConnections } = await supabase
          .from('calendar_connections')
          .select('id')
          .eq('user_id', userId)
          .eq('is_active', true);
        
        if (calConnections && calConnections.length > 0) {
          const connIds = calConnections.map(c => c.id);
          const now = new Date();
          const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
          
          const { data: calEvents } = await supabase
            .from('calendar_events')
            .select('title, start_time, end_time, location, description, all_day')
            .in('connection_id', connIds)
            .gte('start_time', now.toISOString())
            .lte('start_time', thirtyDaysFromNow.toISOString())
            .order('start_time', { ascending: true })
            .limit(30);
          
          if (calEvents && calEvents.length > 0) {
            calendarContext = '\n## UPCOMING CALENDAR EVENTS:\n';
            calEvents.forEach(ev => {
              const start = new Date(ev.start_time);
              const end = ev.end_time ? new Date(ev.end_time) : null;
              const dayStr = start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
              const timeStr = ev.all_day ? 'All day' : start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
              const endStr = end && !ev.all_day ? ` - ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : '';
              const loc = ev.location ? ` | 📍 ${ev.location}` : '';
              calendarContext += `- ${ev.title}: ${dayStr} at ${timeStr}${endStr}${loc}\n`;
              if (ev.description) calendarContext += `  Details: ${ev.description}\n`;
            });
          }
        }
      } catch (calErr) {
        console.warn('[WhatsApp] Calendar fetch error (non-blocking):', calErr);
      }
      
      const { data: memories } = await supabase
        .from('olive_memory_chunks')
        .select('content, chunk_type')
        .eq('user_id', userId)
        .order('importance', { ascending: false })
        .limit(15);
      
      const listIdToName = new Map(lists?.map(l => [l.id, l.name]) || []);
      
      // ---- Smart relevance: find items most relevant to the question ----
      const questionLower = (effectiveMessage || '').toLowerCase();
      const questionWords = questionLower.split(/\s+/).filter(w => w.length > 2);
      
      // Score each task by relevance to the question
      const scoredTasks = (allTasks || []).map(task => {
        const summaryLower = task.summary.toLowerCase();
        const originalLower = (task.original_text || '').toLowerCase();
        const combined = `${summaryLower} ${originalLower}`;
        
        let score = 0;
        questionWords.forEach(w => {
          if (combined.includes(w)) score += 1;
          if (summaryLower.includes(w)) score += 1; // bonus for summary match
        });
        return { ...task, relevanceScore: score };
      });
      
      // Separate highly relevant items (show full detail) from the rest (show summary only)
      const relevantTasks = scoredTasks.filter(t => t.relevanceScore >= 2).sort((a, b) => b.relevanceScore - a.relevanceScore);
      const otherTasks = scoredTasks.filter(t => t.relevanceScore < 2);
      
      // Build context: FULL DETAILS for relevant items
      let savedItemsContext = '';
      
      if (relevantTasks.length > 0) {
        savedItemsContext += '\n## MOST RELEVANT SAVED ITEMS (full details):\n';
        relevantTasks.slice(0, 10).forEach(task => {
          const listName = task.list_id && listIdToName.has(task.list_id) ? listIdToName.get(task.list_id) : task.category;
          const status = task.completed ? '✓' : '○';
          const dueInfo = task.due_date ? ` | Due: ${formatFriendlyDate(task.due_date)}` : '';
          const reminderInfo = task.reminder_time ? ` | Reminder: ${formatFriendlyDate(task.reminder_time)}` : '';
          savedItemsContext += `\n📌 ${status} "${task.summary}" [${listName}]${dueInfo}${reminderInfo}\n`;
          // Include original_text for full details (addresses, times, flight info, etc.)
          if (task.original_text && task.original_text !== task.summary) {
            savedItemsContext += `   Full details: ${task.original_text.substring(0, 800)}\n`;
          }
          if (task.items && task.items.length > 0) {
            task.items.forEach((item: string) => {
              savedItemsContext += `   • ${item}\n`;
            });
          }
        });
      }
      
      // Build summary context for remaining items (grouped by list)
      savedItemsContext += '\n## ALL LISTS AND SAVED ITEMS:\n';
      const tasksByList = new Map<string, any[]>();
      const uncategorizedTasks: any[] = [];
      
      otherTasks.forEach(task => {
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
        tasks.slice(0, 15).forEach(task => {
          const status = task.completed ? '✓' : '○';
          const priority = task.priority === 'high' ? ' 🔥' : '';
          const dueInfo = task.due_date ? ` (Due: ${formatFriendlyDate(task.due_date)})` : '';
          savedItemsContext += `- ${status} ${task.summary}${priority}${dueInfo}\n`;
        });
        if (tasks.length > 15) savedItemsContext += `  ...and ${tasks.length - 15} more items\n`;
      });
      
      if (uncategorizedTasks.length > 0) {
        savedItemsContext += `\n### Other Items:\n`;
        uncategorizedTasks.slice(0, 10).forEach(task => {
          const status = task.completed ? '✓' : '○';
          savedItemsContext += `- ${status} ${task.summary}\n`;
        });
      }
      
      let memoryContext = '';
      if (memories && memories.length > 0) {
        memoryContext = '\n## USER MEMORIES & PREFERENCES:\n';
        memories.forEach(m => {
          memoryContext += `- [${m.chunk_type}] ${m.content}\n`;
        });
      }

      // Fetch recent agent insights + dynamic memory files (parallel)
      let agentInsightsContext = '';
      let ctxAskMemoryFileContext = '';
      try {
        const { fetchAgentInsightsContext, fetchDynamicMemoryContext } = await import("../_shared/orchestrator.ts");
        const [agentCtx, memFileCtx] = await Promise.all([
          fetchAgentInsightsContext(supabase, userId),
          fetchDynamicMemoryContext(supabase, userId, coupleId),
        ]);
        agentInsightsContext = agentCtx ? '\n' + agentCtx : '';
        ctxAskMemoryFileContext = memFileCtx;
      } catch (ctxErr) {
        console.warn('[WhatsApp] Dynamic context fetch error (non-blocking):', ctxErr);
      }

      // Build conversation history context for pronoun resolution
      let conversationHistoryContext = '';
      if (sessionContext.conversation_history && sessionContext.conversation_history.length > 0) {
        conversationHistoryContext = '\n## RECENT CONVERSATION (for resolving references like "it", "that", "this task"):\n';
        sessionContext.conversation_history.forEach((msg) => {
          conversationHistoryContext += `${msg.role === 'user' ? 'User' : 'Olive'}: ${msg.content}\n`;
        });
      }

      const entityContext = '';

      let systemPrompt = `You are Olive, a friendly and intelligent AI assistant for the Olive app. The user is asking a question about their saved items, calendar, or personal data.

CRITICAL INSTRUCTIONS:
1. You MUST answer based on the user's actual saved data provided below — including the "Full details" field which contains rich information like addresses, flight arrival/departure times, booking references, ingredients, etc.
2. Be SPECIFIC and PRECISE — if the user asks "when do I land?", look at the full details for arrival time; if they ask for an address, extract it from the details.
3. If you find a relevant saved item, extract the EXACT answer from its full details, don't just repeat the summary.
4. If they ask for recommendations, ONLY suggest items from their saved lists.
5. If you can't find what they're looking for in their data, say so clearly.
6. Be concise (max 500 chars for WhatsApp) but include all key details the user asked for.
7. Use emojis sparingly for warmth.
8. When mentioning dates, always include the day of the week and time if available (e.g. "Friday, February 20th at 12:00 PM").
9. When the user uses pronouns like "it", "that", "this task", refer to the RECENT CONVERSATION section to understand what they mean.
10. Check CALENDAR EVENTS when questions involve timing, scheduling, or "when" questions.

${savedItemsContext}
${calendarContext}
${memoryContext}
${ctxAskMemoryFileContext}
${agentInsightsContext}
${conversationHistoryContext}
${entityContext}

USER'S QUESTION: ${effectiveMessage}

Respond with helpful, specific information extracted from their saved data. Answer the EXACT question asked — don't just describe what you found, give the precise answer.`;

      // Inject language instruction
      const ctxLangName = LANG_NAMES[userLang] || LANG_NAMES[userLang.split('-')[0]] || 'English';
      if (ctxLangName !== 'English') {
        systemPrompt += `\n\nIMPORTANT: Respond entirely in ${ctxLangName}.`;
      }

      try {
        // Dynamic model selection — standard for most contextual asks
        let response: string;
        try {
          response = await callAI(systemPrompt, effectiveMessage || '', 0.7, route.responseTier);
        } catch (escalationErr) {
          if (route.responseTier === 'pro') {
            console.warn('[Router] Pro failed for CONTEXTUAL_ASK, falling back to standard:', escalationErr);
            response = await callAI(systemPrompt, effectiveMessage || '', 0.7, 'standard');
          } else {
            throw escalationErr;
          }
        }

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
    // WEB SEARCH HANDLER - Perplexity-powered external web search
    // ========================================================================
    if (intent === 'WEB_SEARCH') {
      console.log('[WhatsApp] Processing WEB_SEARCH for:', effectiveMessage?.substring(0, 80));

      try {
        const PERPLEXITY_KEY = Deno.env.get('OLIVE_PERPLEXITY');
        if (!PERPLEXITY_KEY) {
          console.error('[WebSearch] OLIVE_PERPLEXITY not configured');
          return reply('🔍 Web search is not available right now. Please try again later.');
        }

        // ── Context-Aware Query Rewriter ────────────────────────────
        // Produces TWO outputs:
        //   1. searchQuery  — optimized for Perplexity (entity + location + topic)
        //   2. userQuestion — the SPECIFIC question the user wants answered
        // This ensures follow-ups like "Are they open on Sundays?" become
        // searchQuery: "KeBo Restaurant Key Biscayne Sunday hours"
        // userQuestion: "Is KeBo Restaurant open on Sundays?"
        // ──────────────────────────────────────────────────────────────
        let searchQuery = effectiveMessage || '';
        let userQuestion = effectiveMessage || ''; // the specific question to answer
        let savedItemContext = '';

        if (sessionContext.conversation_history && sessionContext.conversation_history.length > 0) {
          const recentMessages = sessionContext.conversation_history.slice(-12);
          const conversationContext = recentMessages.map(m => `${m.role === 'user' ? 'User' : 'Olive'}: ${m.content.substring(0, 400)}`).join('\n');

          try {
            const rewriterResult = await callAI(
              `You are a context-aware query rewriter for web search. Given a conversation and the user's latest message, produce TWO things on separate lines:

LINE 1 (SEARCH_QUERY): A concise web search query optimized for a search engine. Include the full entity name (resolved from conversation), location if known, and the specific topic. Max 15 words.
LINE 2 (USER_QUESTION): The user's actual question rewritten as a complete, self-contained sentence with all pronouns resolved. This should be answerable by reading search results.

RULES:
- Resolve ALL pronouns ("they", "it", "their", "that place") using conversation history.
- If the user asks a specific factual question (hours, menu, price, etc.), the SEARCH_QUERY must target that specific fact.
- Do NOT produce a broad query when the user asks something specific.

EXAMPLES:
- Conversation mentions "KeBo Restaurant, Key Biscayne" → User says "Are they open on Sundays?"
  SEARCH_QUERY: KeBo Restaurant Key Biscayne Sunday opening hours
  USER_QUESTION: Is KeBo Restaurant in Key Biscayne open on Sundays?

- Conversation mentions booking at "Nobu Miami" → User says "Do they have valet?"
  SEARCH_QUERY: Nobu Miami valet parking
  USER_QUESTION: Does Nobu Miami offer valet parking?

- User says "Search for Italian restaurants near me" (no prior context)
  SEARCH_QUERY: best Italian restaurants nearby
  USER_QUESTION: What are the best Italian restaurants nearby?

CONVERSATION:
${conversationContext}

USER'S LATEST MESSAGE: "${searchQuery}"

Respond with exactly two lines starting with SEARCH_QUERY: and USER_QUESTION:`,
              searchQuery,
              0.1,
              'lite'
            );
            if (rewriterResult) {
              const sqMatch = rewriterResult.match(/SEARCH_QUERY:\s*(.+)/i);
              const uqMatch = rewriterResult.match(/USER_QUESTION:\s*(.+)/i);
              if (sqMatch?.[1]?.trim()) {
                searchQuery = sqMatch[1].trim();
              }
              if (uqMatch?.[1]?.trim()) {
                userQuestion = uqMatch[1].trim();
              }
              console.log('[WebSearch] Rewriter: query="' + searchQuery + '" | question="' + userQuestion + '"');
            }
          } catch (resolveErr) {
            console.warn('[WebSearch] Query rewriter failed, using original:', resolveErr);
          }
        }

        // Check saved items for disambiguation context
        const { data: matchingItems } = await supabase
          .from('clerk_notes')
          .select('summary, items, category, original_text')
          .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
          .eq('completed', false)
          .order('created_at', { ascending: false })
          .limit(100);

        if (matchingItems) {
          const searchLower = searchQuery.toLowerCase();
          const originalLower = (effectiveMessage || '').toLowerCase();
          const relevant = matchingItems.filter(item => {
            const summaryLower = item.summary.toLowerCase();
            const queryWords = searchLower.split(/\s+/).filter(w => w.length > 2);
            const originalWords = originalLower.split(/\s+/).filter(w => w.length > 2);
            const allWords = [...new Set([...queryWords, ...originalWords])];
            return allWords.some(w => summaryLower.includes(w));
          }).slice(0, 5);

          if (relevant.length > 0) {
            savedItemContext = '\n\nUser has these related saved items (use to disambiguate):\n';
            relevant.forEach(item => {
              savedItemContext += `- ${item.summary}`;
              if (item.items && item.items.length > 0) {
                savedItemContext += ` [${item.items.slice(0, 3).join(', ')}]`;
              }
              savedItemContext += '\n';
            });
          }
        }

        // Call Perplexity with the focused search query
        console.log('[WebSearch] Perplexity query:', searchQuery, '| question:', userQuestion);
        const perplexityResponse = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${PERPLEXITY_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'sonar',
            messages: [
              {
                role: 'system',
                content: `You are a precise search assistant. The user has a SPECIFIC question. Answer ONLY that question with factual details. Do not dump unrelated information. Include relevant links, hours, phone numbers, or addresses ONLY if they are part of the answer.${savedItemContext}`
              },
              {
                role: 'user',
                content: `Question: ${userQuestion}\n\nSearch for: ${searchQuery}`
              }
            ],
            temperature: 0.1,
          }),
        });

        if (!perplexityResponse.ok) {
          const errText = await perplexityResponse.text();
          console.error('[WebSearch] Perplexity API error:', perplexityResponse.status, errText);
          // Fallback: try to answer from saved data
          return reply(`🔍 Web search temporarily unavailable. Try asking "what do I have saved about ${searchQuery.split(' ').slice(0, 3).join(' ')}?" to check your saved items.`);
        }

        const perplexityData = await perplexityResponse.json();
        const searchResult = perplexityData.choices?.[0]?.message?.content || '';
        const citations = perplexityData.citations || [];

        if (!searchResult) {
          return reply('🔍 I couldn\'t find relevant results. Try rephrasing your search.');
        }

        // Use AI to format the Perplexity result for WhatsApp  
        const ctxLangName = LANG_NAMES[userLang] || LANG_NAMES[userLang.split('-')[0]] || 'English';
        let formattedResponse: string;
        try {
          formattedResponse = await callAI(
            `You are Olive, a friendly AI assistant. The user asked a SPECIFIC question. Answer THAT question directly using the search results below. Format for WhatsApp (max 1200 chars). Be warm but concise. Only include details that answer the question. If links are relevant to the answer, include them.${ctxLangName !== 'English' ? `\n\nIMPORTANT: Respond entirely in ${ctxLangName}.` : ''}

USER'S SPECIFIC QUESTION: ${userQuestion}

WEB SEARCH RESULTS:
${searchResult}

${citations.length > 0 ? 'SOURCES:\n' + citations.map((c: string, i: number) => `[${i+1}] ${c}`).join('\n') : ''}

Format a helpful, concise WhatsApp response with the key information and links:`,
            searchResult,
            0.5,
            'lite'
          );
        } catch (formatErr) {
          console.warn('[WebSearch] Formatting failed, using raw result');
          formattedResponse = `🔍 Here's what I found:\n\n${searchResult.slice(0, 1200)}`;
          if (citations.length > 0) {
            formattedResponse += `\n\n🔗 ${citations[0]}`;
          }
        }

        // Save conversation context
        try {
          await saveReferencedEntity(null, formattedResponse);
        } catch (ctxErr) {
          console.warn('[Context] Error saving context after WEB_SEARCH:', ctxErr);
        }

        return reply(formattedResponse.slice(0, 1500));
      } catch (webSearchErr) {
        console.error('[WebSearch] Unexpected error:', webSearchErr);
        return reply('🔍 Sorry, I had trouble searching the web. Please try again.');
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
        .select('id, summary, due_date, completed, priority, category, list_id, items, created_at, updated_at, task_owner, author_id')
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
          // Use get_space_members RPC for multi-member resolution
          const { data: spaceMembers } = await supabase.rpc('get_space_members', {
            p_couple_id: coupleId,
          });

          if (spaceMembers && spaceMembers.length > 0) {
            const otherMembers = spaceMembers.filter((m: any) => m.user_id !== userId);
            partnerName = otherMembers.map((m: any) => m.display_name).join(', ') || 'Partner';

            // Get recent activity from ALL other members
            const otherUserIds = otherMembers.map((m: any) => m.user_id);
            
            if (otherUserIds.length > 0) {
              const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
              
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
              
              const partnerRecentSummaries = partnerRecentTasks?.slice(0, 3).map(t => t.summary) || [];
              const assignedToMe = assignedByPartner?.map(t => t.summary) || [];
              const myAssignments = assignedToPartner?.map(t => t.summary) || [];
              
              if (partnerRecentSummaries.length > 0 || assignedToMe.length > 0 || myAssignments.length > 0) {
                partnerContext = `
## Member Activity (${partnerName}):
${partnerRecentSummaries.length > 0 ? `- Recently added: ${partnerRecentSummaries.join(', ')}` : ''}
${assignedToMe.length > 0 ? `- Assigned to you: ${assignedToMe.join(', ')}` : ''}
${myAssignments.length > 0 ? `- You assigned to them: ${myAssignments.join(', ')}` : ''}
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
      
      // Distinguish between user's own tasks and total space tasks
      const yourTasks = activeTasks.filter(t => t.author_id === userId || t.task_owner === userId);
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
      // DYNAMIC CONTEXT: Agent Insights + Memory Files (parallel fetch)
      // ================================================================
      let chatAgentInsightsContext = '';
      let dynamicMemoryFileContext = '';
      try {
        const { fetchAgentInsightsContext, fetchDynamicMemoryContext } = await import("../_shared/orchestrator.ts");
        const [fullAgentCtx, memFileCtx] = await Promise.all([
          fetchAgentInsightsContext(supabase, userId),
          fetchDynamicMemoryContext(supabase, userId, coupleId),
        ]);
        chatAgentInsightsContext = fullAgentCtx
          .replace(/^## Recent Agent Insights.*\n/m, '')
          .trim();
        dynamicMemoryFileContext = memFileCtx;
      } catch (ctxErr) {
        console.warn('[WhatsApp Chat] Dynamic context fetch error (non-blocking):', ctxErr);
      }

      // ================================================================
      // SPECIALIZED SYSTEM PROMPTS BY CHAT TYPE
      // ================================================================
      let systemPrompt: string;
      let userPromptEnhancement = '';

      const baseContext = `
## User Task Analytics:
- Your active tasks: ${taskContext.your_active}
- Total in shared space: ${taskContext.total_active}
- Urgent (high priority): ${taskContext.urgent}
- Overdue: ${taskContext.overdue}
- Due today: ${taskContext.due_today}
- Due tomorrow: ${taskContext.due_tomorrow}
- Created this week: ${taskContext.created_this_week}
- Completed this week: ${taskContext.completed_this_week}
- Completion rate: ${taskContext.completion_rate}%
- Top categories: ${taskContext.top_categories.join(', ') || 'None'}
- Top lists: ${taskContext.top_lists.join(', ') || 'None'}
IMPORTANT: When telling the user how many tasks they have, use "Your active tasks" (${taskContext.your_active}), NOT the total space count. Only mention "shared space" count if explicitly asked about partner/couple tasks.

## User Memories/Preferences:
${memoryContext}

## Behavioral Patterns:
${patternContext}
${partnerContext}
${skillContext}
${dynamicMemoryFileContext}
${chatAgentInsightsContext ? `## Recent Agent Insights (Background AI analysis):\n${chatAgentInsightsContext}\n` : ''}
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
          
        case 'assistant':
          systemPrompt = `You are Olive, a world-class AI personal assistant. The user is asking you to HELP THEM accomplish something — drafting content, planning, brainstorming, advising, analyzing, or any collaborative task.

${baseContext}

## YOUR ROLE — PRODUCE, DON'T JUST DESCRIBE:
You are their brilliant, proactive personal assistant. Your job is to DELIVER results, not just talk about delivering them. When they ask for help:

### CONTENT CREATION (emails, messages, letters, posts):
1. **Produce the full draft immediately** — don't just describe what you'd write
2. Format emails with: **Subject:** / **Body** / Sign-off
3. Format messages as ready-to-copy text
4. Use the appropriate tone based on context (formal for work, warm for friends, etc.)
5. Incorporate ALL context they provide — names, details, background from their memories and tasks
6. If the recipient speaks a different language than the user, write the DRAFT in the recipient's language but your commentary in the user's language

### PLANNING & STRATEGY (trips, events, decisions, projects):
1. Produce a **structured plan** with clear steps, timelines, and actionable items
2. Use their existing tasks, calendar, and memories to ground the plan in reality
3. Proactively identify gaps or considerations they might miss
4. Offer to save key action items as tasks

### BRAINSTORMING & IDEAS:
1. Generate **concrete, specific suggestions** — not vague categories
2. Personalize using their memories (dietary preferences, interests, partner's likes, budget, etc.)
3. Present options in a scannable format (numbered list or short descriptions)
4. Offer your top recommendation with a brief reason why

### ADVICE & ANALYSIS:
1. Present a **clear, structured comparison** when asked to choose
2. Give your honest recommendation backed by reasoning
3. Use their context (budget, preferences, priorities) to tailor advice
4. Be direct — they trust your judgment

## CRITICAL RULES:
- **ACTION OVER DESCRIPTION**: Never say "I can draft that for you" — just DRAFT IT. Never say "I'll help you plan" — just START PLANNING. The user asked for help, so DELIVER immediately.
- **PROACTIVE CONTEXT USE**: Mine their memories, recent tasks, partner info, and conversation history. Reference specific details to show you truly know them. Example: if they ask for dinner ideas and you know from memories they're vegetarian, suggest only vegetarian options.
- **MINIMAL PREAMBLE**: Skip "Of course!" or "Sure, I'd be happy to help!" — go straight to the content. One brief warm line maximum before the output.
- **ASK ONLY WHEN CRITICAL**: If 80% of what they need is clear, produce the draft and note what you assumed. Only ask for clarification on truly ambiguous critical details.
- **ITERATIVE READINESS**: End with a brief offer to refine ("Want me to adjust the tone?" / "Should I make it shorter?") — never just end cold.
- **WhatsApp-FRIENDLY**: Keep total response under 1400 chars. For longer content, deliver the most important part and offer to send the rest.

## LANGUAGE:
Respond in the same language the user wrote in. Draft content in the language appropriate for the recipient.`;
          break;

        default: // 'general'
          systemPrompt = `You are Olive, a warm, intelligent, and deeply contextual AI assistant. You are the user's trusted personal companion for organization AND conversation.

${baseContext}

## CONVERSATION STYLE:
- Be GENUINELY conversational — like texting a smart friend who knows your life
- Respond naturally to the actual message. If they're sharing a thought, engage with it. If they're venting, empathize. If they're excited, share their energy.
- Use the user's memories, preferences, and patterns to personalize EVERY response
- Reference their actual tasks, lists, and context when relevant — show you know them
- Keep responses focused but don't artificially truncate. Match the depth of their message (short question → short answer; thoughtful message → thoughtful response). Aim for under 500 chars unless the content warrants more.
- Use emojis naturally, not excessively 🫒

## CAPABILITIES — YOU CAN DO ALL OF THIS:
- Create, complete, delete, reschedule, and prioritize tasks
- Move tasks between lists and assign to partners
- Set reminders, log expenses, send messages to partners
- Search saved data, provide briefings, weekly summaries
- Chat about anything — life, ideas, plans, feelings
- Help draft emails, compose messages, brainstorm ideas
If the user asks to modify a task but the action didn't execute, guide them with the right phrasing.
NEVER say you cannot modify tasks or manage their data. You absolutely can.

## MULTI-TURN AWARENESS:
Pay close attention to RECENT CONVERSATION HISTORY. If the user says "yes", "ok", "do it", "sounds good" — connect it to what Olive last said/asked. If they ask a follow-up about a topic Olive discussed, continue that thread naturally.

## ASSISTIVE DETECTION:
If the user's message is long and conversational — asking for help with something, requesting you to draft content, compose a message, or perform a creative task — DO IT. Don't save it as a task. Help them accomplish what they're asking for.`;
      }
      
      try {
        const enhancedMessage = (effectiveMessage || '') + userPromptEnhancement;
        console.log('[WhatsApp Chat] Calling AI for chatType:', chatType, 'lang:', userLang);

        // Inject language instruction into AI prompt
        const langName = LANG_NAMES[userLang] || LANG_NAMES[userLang.split('-')[0]] || 'English';
        if (langName !== 'English') {
          systemPrompt += `\n\nIMPORTANT: Respond entirely in ${langName}.`;
        }

        // Dynamic model selection — Pro for weekly_summary/planning, standard for rest
        let chatResponse: string;
        try {
          chatResponse = await callAI(systemPrompt, enhancedMessage, 0.7, route.responseTier);
        } catch (escalationErr) {
          if (route.responseTier === 'pro') {
            console.warn('[Router] Pro failed for CHAT, falling back to standard:', escalationErr);
            chatResponse = await callAI(systemPrompt, enhancedMessage, 0.7, 'standard');
          } else {
            throw escalationErr;
          }
        }

        // Save conversation history (no specific entity for CHAT)
        await saveReferencedEntity(null, chatResponse);

        // Auto-evolve profile from conversation (non-blocking, fire-and-forget)
        try {
          const { evolveProfileFromConversation } = await import("../_shared/orchestrator.ts");
          evolveProfileFromConversation(supabase, userId, effectiveMessage || '', chatResponse)
            .catch(e => console.warn('[ProfileEvolution] Non-blocking error:', e));
        } catch {}

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
      console.log('[PARTNER_MESSAGE] Processing:', partnerAction, '→', partnerMessageContent?.substring(0, 80));

      // 1. Verify couple space exists
      if (!coupleId) {
        return reply(t('partner_no_space', userLang));
      }

      // 2. Resolve all members via RPC for proper multi-member support
      const { data: spaceMembers } = await supabase.rpc('get_space_members', {
        p_couple_id: coupleId,
      });

      if (!spaceMembers || spaceMembers.length === 0) {
        return reply(t('partner_no_space', userLang));
      }

      const currentMember = spaceMembers.find((m: any) => m.user_id === userId);
      const otherMembers = spaceMembers.filter((m: any) => m.user_id !== userId);

      if (otherMembers.length === 0) {
        return reply(t('partner_no_space', userLang));
      }

      // Look up profiles for ALL other members and pick the one with a phone number
      const otherUserIds = otherMembers.map((m: any) => m.user_id);
      console.log('[PARTNER_MESSAGE] Other members found:', otherUserIds.length, 'IDs:', otherUserIds.join(', '));

      const { data: candidateProfiles } = await supabase
        .from('clerk_profiles')
        .select('id, phone_number, display_name, last_user_message_at')
        .in('id', otherUserIds);

      console.log('[PARTNER_MESSAGE] Candidate profiles:', candidateProfiles?.map(p => ({
        id: p.id?.substring(0, 15),
        hasPhone: !!p.phone_number,
        phone_last4: p.phone_number ? '...' + p.phone_number.slice(-4) : 'none',
        lastMsg: p.last_user_message_at || 'never',
      })));

      // Prefer the member who has a phone number linked
      const partnerProfile = candidateProfiles?.find(p => p.phone_number)
        || candidateProfiles?.[0]
        || null;

      if (!partnerProfile) {
        return reply(t('partner_no_space', userLang));
      }

      const partnerId = partnerProfile.id;
      // Use member display_name from the RPC for accurate name resolution
      const partnerMemberRecord = otherMembers.find((m: any) => m.user_id === partnerId);
      const partnerName = partnerMemberRecord?.display_name || partnerProfile.display_name || 'Partner';
      const senderName = currentMember?.display_name || 'Your partner';

      console.log('[PARTNER_MESSAGE] Resolved: sender=' + senderName + ', partner=' + partnerName + ', partnerId=' + partnerId?.substring(0, 15));

      if (!partnerProfile.phone_number) {
        return reply(t('partner_no_phone', userLang, { partner: partnerName }));
      }

      const partnerPhone = partnerProfile.phone_number;
      const partnerPhoneLast4 = partnerPhone.slice(-4);
      console.log('[PARTNER_MESSAGE] Partner phone ends in:', partnerPhoneLast4);

      // 3. Determine if this is a task to save or just a message to relay
      // "remind" and "notify" actions ALWAYS create tasks. For "tell"/"ask", use
      // a broad action-verb regex to detect task-like content — when in doubt, create.
      const isActionAlwaysTask = partnerAction === 'remind' || partnerAction === 'notify';
      const isTaskLike = isActionAlwaysTask || /\b(buy|get|pick\s*up|call|book|make|schedule|clean|fix|do|send|bring|take|remind|check|prepare|pay|return|cancel|organize|plan|cook|wash|set\s*up|drop\s*off|arrange|confirm|order|submit|review|renew|update|finish|complete|collect|deliver|move|pack|comprar|llamar|hacer|enviar|traer|pagar|limpiar|cocinar|preparar|organizar|recoger|devolver|comprare|chiamare|fare|inviare|portare|pagare|pulire|cucinare|preparare|organizzare|raccogliere|restituire)\b/i.test(partnerMessageContent);

      console.log('[PARTNER_MESSAGE] isTaskLike:', isTaskLike, '| isActionAlwaysTask:', isActionAlwaysTask, '| partnerAction:', partnerAction);

      let savedTask: { id: string; summary: string } | null = null;
      let existingTaskFound = false;

      if (isTaskLike) {
        try {
          // ── STEP 3a: Duplicate detection ──────────────────────────────────
          // Before creating a new task, check if one already exists that
          // matches what the partner is being reminded about.
          // Uses a 2-layer approach: vector similarity → keyword fallback.
          // ────────────────────────────────────────────────────────────────────

          let duplicateNote: { id: string; summary: string } | null = null;

          // Layer 1: Semantic / vector similarity (threshold 0.80, slightly
          // lower than dedup's 0.85 to catch paraphrased reminders)
          try {
            const queryEmbedding = await generateEmbedding(partnerMessageContent);
            if (queryEmbedding) {
              const { data: similar } = await supabase.rpc('find_similar_notes', {
                p_user_id: userId,
                p_couple_id: coupleId,
                p_query_embedding: JSON.stringify(queryEmbedding),
                p_threshold: 0.80,
                p_limit: 3,
              });

              if (similar && similar.length > 0) {
                duplicateNote = { id: similar[0].id, summary: similar[0].summary };
                console.log('[PARTNER_MESSAGE] 🔍 Vector duplicate found:', similar[0].summary, '| similarity:', similar[0].similarity);
              }
            }
          } catch (vecErr) {
            console.error('[PARTNER_MESSAGE] Vector duplicate check failed (non-blocking):', vecErr);
          }

          // Layer 2: Keyword fallback — extract significant words and search
          if (!duplicateNote) {
            try {
              const stopWords = new Set(['a','an','the','to','of','in','for','and','or','is','it','my','me','i','that','this','her','his','our','un','una','il','la','le','lo','di','da','per','che','del','al','el','de','en','por','su','con']);
              const keywords = partnerMessageContent
                .toLowerCase()
                .replace(/[^\w\sáéíóúñàèìòù]/g, '')
                .split(/\s+/)
                .filter(w => w.length > 2 && !stopWords.has(w));

              if (keywords.length > 0) {
                // Search for incomplete tasks in the couple space matching keywords
                // Use 'websearch' type so OR is properly interpreted (plainto_tsquery
                // treats everything as AND, which fails when extra words like "check"
                // are present in the query but not in the stored summary).
                const searchQuery = keywords.slice(0, 4).join(' OR ');
                const { data: keywordMatches } = await supabase
                  .from('clerk_notes')
                  .select('id, summary, original_text')
                  .eq('completed', false)
                  .or(`couple_id.eq.${coupleId},and(author_id.eq.${userId},couple_id.is.null)`)
                  .textSearch('summary', searchQuery, { type: 'websearch' })
                  .limit(5);

                if (keywordMatches && keywordMatches.length > 0) {
                  // Score by word overlap
                  // Score by word overlap — compare task words against the
                  // user's original keywords, ignoring action verbs that
                  // appear in the relay command but not in the task itself
                  // (e.g., "check" in "tell X to check renew Mazda registration").
                  const actionVerbs = new Set(['check','remind','tell','ask','notify','make','do','get','send','dile','ricorda','dì','chiedi']);
                  const contentKeywords = keywords.filter(k => !actionVerbs.has(k));
                  const matchKeywords = contentKeywords.length >= 2 ? contentKeywords : keywords;

                  const bestMatch = keywordMatches
                    .map(m => {
                      const mWords = new Set((m.summary + ' ' + (m.original_text || '')).toLowerCase().split(/\s+/).map((w: string) => w.replace(/[^\w]/g, '')));
                      const overlap = matchKeywords.filter(k => mWords.has(k)).length;
                      return { ...m, overlap, ratio: overlap / matchKeywords.length };
                    })
                    .sort((a, b) => b.ratio - a.ratio)[0];

                  if (bestMatch && bestMatch.ratio >= 0.4) {
                    duplicateNote = { id: bestMatch.id, summary: bestMatch.summary };
                    console.log('[PARTNER_MESSAGE] 🔍 Keyword duplicate found:', bestMatch.summary, '| overlap:', bestMatch.ratio);
                  }
                }
              }
            } catch (kwErr) {
              console.error('[PARTNER_MESSAGE] Keyword duplicate check failed (non-blocking):', kwErr);
            }
          }

          // ── STEP 3b: Create or skip ──────────────────────────────────────
          if (duplicateNote) {
            // Task already exists — skip creation, just relay the message
            savedTask = duplicateNote;
            existingTaskFound = true;
            console.log('[PARTNER_MESSAGE] ⏭️ Skipping creation — existing task:', duplicateNote.summary);
          } else {
            // No duplicate — create new task via process-note
            const { data: processData, error: processErr } = await supabase.functions.invoke('process-note', {
              body: {
                text: partnerMessageContent,
                user_id: userId,
                couple_id: coupleId, // Partner tasks are always shared
                timezone: profile.timezone || 'America/New_York',
                source: 'whatsapp',
              }
            });

            if (processErr) {
              console.error('[PARTNER_MESSAGE] process-note error:', processErr);
            }

            const noteData = {
              author_id: userId,
              couple_id: coupleId, // Partner tasks are always shared
              original_text: partnerMessageContent,
              summary: processData?.summary || partnerMessageContent,
              category: processData?.category || 'task',
              due_date: processData?.due_date || null,
              reminder_time: processData?.reminder_time || null,
              recurrence_frequency: processData?.recurrence_frequency || null,
              recurrence_interval: processData?.recurrence_interval || null,
              priority: processData?.priority || 'medium',
              tags: processData?.tags || [],
              items: processData?.items || [],
              task_owner: partnerId,
              list_id: processData?.list_id || null,
              source: 'whatsapp',
              source_ref: `partner_relay:${partnerAction}`,
              completed: false,
            };

            const { data: insertedNote, error: insertErr } = await supabase
              .from('clerk_notes')
              .insert(noteData)
              .select('id, summary, list_id')
              .single();

            if (insertErr) {
              console.error('[PARTNER_MESSAGE] Note insert error:', insertErr.message, insertErr.details);
            } else if (insertedNote) {
              savedTask = { id: insertedNote.id, summary: insertedNote.summary };
              console.log('[PARTNER_MESSAGE] ✅ Created task for partner:', insertedNote.summary, '| list_id:', insertedNote.list_id);

              // Generate embedding for semantic search (non-blocking)
              try {
                const embedding = await generateEmbedding(insertedNote.summary);
                if (embedding) {
                  await supabase
                    .from('clerk_notes')
                    .update({ embedding: JSON.stringify(embedding) })
                    .eq('id', insertedNote.id);
                  console.log('[PARTNER_MESSAGE] Embedding saved for task:', insertedNote.id);
                }
              } catch (embErr) {
                console.error('[PARTNER_MESSAGE] Embedding error (non-blocking):', embErr);
              }
            }
          }
        } catch (taskErr) {
          console.error('[PARTNER_MESSAGE] Error creating task (non-blocking):', taskErr);
        }
      }

      // 4. Compose the WhatsApp message to partner
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

      // 5. Send DIRECTLY via Meta API (no gateway intermediary)
      //    This eliminates function-to-function latency/failure points
      const PARTNER_WA_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN')!;
      const PARTNER_WA_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')!;
      const cleanPartnerNumber = partnerPhone.replace(/\D/g, '');

      let messageSent = false;
      let sendError = '';

      // Check if partner is within 24h window
      const partnerLastMsg = partnerProfile.last_user_message_at;
      const partnerIn24h = partnerLastMsg && (Date.now() - new Date(partnerLastMsg).getTime()) < 24 * 60 * 60 * 1000;
      console.log('[PARTNER_MESSAGE] Partner 24h window:', partnerIn24h ? 'INSIDE' : 'OUTSIDE', '| lastMsg:', partnerLastMsg || 'never');

      // 5a. Try free-form text first (free, works inside 24h window)
      try {
        const apiUrl = `https://graph.facebook.com/v21.0/${PARTNER_WA_PHONE_ID}/messages`;
        const freeFormPayload = {
          messaging_product: 'whatsapp',
          to: cleanPartnerNumber,
          type: 'text',
          text: { preview_url: true, body: partnerWhatsAppMsg }
        };

        console.log('[PARTNER_MESSAGE] Attempting free-form send to:', cleanPartnerNumber);
        const freeFormRes = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${PARTNER_WA_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(freeFormPayload),
        });

        const freeFormBody = await freeFormRes.text();
        console.log('[PARTNER_MESSAGE] Free-form response:', freeFormRes.status, freeFormBody.substring(0, 300));

        if (freeFormRes.ok) {
          const freeFormData = JSON.parse(freeFormBody);
          const msgId = freeFormData.messages?.[0]?.id || '';
          console.log('[PARTNER_MESSAGE] ✅ Free-form sent! Meta message_id:', msgId);
          messageSent = true;
        } else {
          // Check for specific Meta errors
          const errorData = JSON.parse(freeFormBody);
          const errorCode = errorData?.error?.code;
          const errorSubcode = errorData?.error?.error_subcode;
          console.log('[PARTNER_MESSAGE] Free-form failed. Code:', errorCode, 'Subcode:', errorSubcode);

          // 131047 = outside 24h window → try template
          if (errorCode === 131047 || errorSubcode === 131047 || freeFormBody.includes('131047')) {
            console.log('[PARTNER_MESSAGE] Outside 24h window → trying template message');

            // Try olive_task_reminder template: {{1}} = title, {{2}} = details
            const templatePayload = {
              messaging_product: 'whatsapp',
              to: cleanPartnerNumber,
              type: 'template',
              template: {
                name: 'olive_task_reminder',
                language: { code: 'en' },
                components: [{
                  type: 'body',
                  parameters: [
                    { type: 'text', text: `Message from ${senderName}` },
                    { type: 'text', text: (savedTask?.summary || partnerMessageContent).substring(0, 800) },
                  ],
                }],
              },
            };

            const templateRes = await fetch(apiUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${PARTNER_WA_TOKEN}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(templatePayload),
            });

            const templateBody = await templateRes.text();
            console.log('[PARTNER_MESSAGE] Template response:', templateRes.status, templateBody.substring(0, 300));

            if (templateRes.ok) {
              const templateData = JSON.parse(templateBody);
              console.log('[PARTNER_MESSAGE] ✅ Template sent! Meta message_id:', templateData.messages?.[0]?.id);
              messageSent = true;
            } else {
              sendError = `Template failed (${templateRes.status}): ${templateBody.substring(0, 200)}`;
              console.error('[PARTNER_MESSAGE] ❌ Template also failed:', sendError);
            }
          } else {
            sendError = `Free-form failed (${freeFormRes.status}): ${freeFormBody.substring(0, 200)}`;
            console.error('[PARTNER_MESSAGE] ❌ Non-window error:', sendError);
          }
        }
      } catch (sendErr) {
        sendError = `Send exception: ${String(sendErr)}`;
        console.error('[PARTNER_MESSAGE] ❌ Exception during send:', sendErr);
      }

      // 6. Log the outbound message for tracking
      try {
        await supabase.from('olive_outbound_queue').insert({
          user_id: partnerId,
          message_type: 'partner_notification',
          content: partnerWhatsAppMsg,
          status: messageSent ? 'sent' : 'failed',
          sent_at: messageSent ? new Date().toISOString() : null,
          error_message: messageSent ? null : sendError,
          priority: 'normal',
        });
      } catch (logErr) {
        console.error('[PARTNER_MESSAGE] Log insert error (non-critical):', logErr);
      }

      // 7. Respond to sender with confirmation or error
      if (!messageSent) {
        if (savedTask) {
          return reply(`📋 I saved "${savedTask.summary}" and assigned it to ${partnerName}, but couldn't reach them on WhatsApp right now (phone ...${partnerPhoneLast4}).\n\nThey'll see it in the app!`);
        }
        return reply(`😕 I couldn't reach ${partnerName} on WhatsApp right now (phone ...${partnerPhoneLast4}). ${sendError ? 'Error: ' + sendError.substring(0, 100) : 'Please try again later.'}`);
      }

      if (savedTask) {
        const templateKey = existingTaskFound ? 'partner_message_existing_task' : 'partner_message_and_task';
        const confirmResponse = t(templateKey, userLang, {
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
    // CREATE LIST HANDLER - Create a new organizational list from WhatsApp
    // ========================================================================
    if (intent === 'CREATE_LIST') {
      const listName = (intentResult as any)._listName || cleanMessage || '';
      const initialItemsRaw = (intentResult as any)._initialItems || '';
      console.log('[CREATE_LIST] Creating list:', listName, '| initial items:', initialItemsRaw?.substring(0, 80));

      if (!listName || listName.trim().length < 2) {
        return reply('📋 What should I name the list? Try: "Create a list about [topic]"');
      }

      // Check if a list with this name already exists (case-insensitive)
      const { data: existingLists } = await supabase
        .from('clerk_lists')
        .select('id, name')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`);

      const normalizedNewName = listName.toLowerCase().trim();
      const existingMatch = existingLists?.find(l => l.name.toLowerCase().trim() === normalizedNewName);

      if (existingMatch) {
        // List already exists — inform the user
        const { data: existingItems } = await supabase
          .from('clerk_notes')
          .select('id')
          .eq('list_id', existingMatch.id)
          .eq('completed', false);

        const count = existingItems?.length || 0;
        return reply(`📋 A list named "${existingMatch.name}" already exists with ${count} active item${count !== 1 ? 's' : ''}.\n\nSend items to add to it, or say "show my ${existingMatch.name} list" to view it.`);
      }

      // Format list name to Title Case
      const formattedName = listName.trim()
        .split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');

      // Create the list
      const { data: newList, error: createError } = await supabase
        .from('clerk_lists')
        .insert({
          name: formattedName,
          author_id: userId,
          couple_id: effectiveCoupleId,
          is_manual: true,
          description: `Created via WhatsApp`,
        })
        .select('id, name')
        .single();

      if (createError || !newList) {
        console.error('[CREATE_LIST] Insert error:', createError);
        return reply('Sorry, I couldn\'t create that list. Please try again.');
      }

      console.log('[CREATE_LIST] Created list:', newList.name, newList.id);

      // If initial items were provided, create notes for each
      let itemsCreated = 0;
      if (initialItemsRaw && initialItemsRaw.trim().length > 0) {
        // Split by commas, semicolons, or newlines
        const items = initialItemsRaw
          .split(/[,;\n]+/)
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 1);

        if (items.length > 0) {
          const notesToInsert = items.map((item: string) => ({
            author_id: userId,
            couple_id: effectiveCoupleId,
            original_text: item,
            summary: item,
            category: formattedName.toLowerCase().replace(/\s+/g, '_'),
            list_id: newList.id,
            priority: 'medium',
            completed: false,
            tags: [],
            items: [],
          }));

          const { error: itemsError } = await supabase
            .from('clerk_notes')
            .insert(notesToInsert);

          if (!itemsError) {
            itemsCreated = items.length;
          } else {
            console.error('[CREATE_LIST] Items insert error:', itemsError);
          }
        }
      }

      let response = `📋 Created list: *${newList.name}*\n`;
      if (itemsCreated > 0) {
        response += `✅ Added ${itemsCreated} item${itemsCreated > 1 ? 's' : ''}\n`;
      }
      response += `\n💡 Now just send items and they'll be automatically sorted here!\n`;
      response += `📂 Say "show my ${newList.name} list" to view it\n`;
      response += `🔗 Manage: https://witholive.app`;

      await saveReferencedEntity(null, response);
      return reply(response);
    }

    // ========================================================================
    // LIST RECAP HANDLER - AI-generated detailed review of a specific list
    // ========================================================================
    if (intent === 'LIST_RECAP') {
      const targetListName = (intentResult as any)._listName || cleanMessage || effectiveMessage || '';
      console.log('[LIST_RECAP] Generating recap for list:', targetListName);

      // Fetch all user lists for matching
      const { data: allLists } = await supabase
        .from('clerk_lists')
        .select('id, name, description, created_at')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`);

      if (!allLists || allLists.length === 0) {
        return reply('📋 You don\'t have any lists yet! Try "create a list about [topic]" to get started.');
      }

      // Smart list matching (same logic as SEARCH)
      function normalizeForRecap(name: string): string {
        return name.toLowerCase().replace(/\b(the|a|an|my|our)\b/g, '').replace(/\s+/g, ' ').trim();
      }
      function singularizeForRecap(word: string): string {
        if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
        if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
        return word;
      }

      const searchNormalized = normalizeForRecap(targetListName);
      const searchSingular = singularizeForRecap(searchNormalized);
      let matchedList: { id: string; name: string; description: string | null; created_at: string } | null = null;

      for (const list of allLists) {
        const nln = normalizeForRecap(list.name);
        const nlnS = singularizeForRecap(nln);
        if (nln === searchNormalized || nlnS === searchSingular || nln.includes(searchNormalized) || searchNormalized.includes(nln) || nlnS.includes(searchSingular) || searchSingular.includes(nlnS)) {
          matchedList = list;
          break;
        }
      }

      if (!matchedList) {
        // Suggest available lists
        const listNames = allLists.slice(0, 8).map(l => `• ${l.name}`).join('\n');
        return reply(`📋 I couldn't find a list matching "${targetListName}".\n\nYour lists:\n${listNames}\n\nTry: "recap my [list name]"`);
      }

      // Fetch ALL items in this list (including completed)
      const { data: listItems } = await supabase
        .from('clerk_notes')
        .select('id, summary, original_text, category, priority, due_date, reminder_time, completed, created_at, items, tags, task_owner')
        .eq('list_id', matchedList.id)
        .order('completed', { ascending: true })
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(50);

      if (!listItems || listItems.length === 0) {
        return reply(`📋 *${matchedList.name}* is empty!\n\nSend items to add to it, or say "create a list about [topic]" to start a new one.`);
      }

      const activeItems = listItems.filter(i => !i.completed);
      const completedItems = listItems.filter(i => i.completed);
      const urgentItems = activeItems.filter(i => i.priority === 'high');
      const overdueItems = activeItems.filter(i => i.due_date && new Date(i.due_date) < new Date());
      const withDueDate = activeItems.filter(i => i.due_date);

      // Build rich context for AI recap
      let itemsContext = '';
      listItems.forEach((item, i) => {
        const status = item.completed ? '✅' : '⬜';
        const priority = item.priority === 'high' ? ' 🔥' : '';
        const dueInfo = item.due_date ? ` | Due: ${formatFriendlyDate(item.due_date)}` : '';
        const reminderInfo = item.reminder_time ? ` | ⏰ ${formatFriendlyDate(item.reminder_time)}` : '';
        const owner = item.task_owner ? ` | Assigned: ${item.task_owner}` : '';
        itemsContext += `${i + 1}. ${status} ${item.summary}${priority}${dueInfo}${reminderInfo}${owner}\n`;
        if (item.original_text && item.original_text !== item.summary) {
          itemsContext += `   Details: ${item.original_text.substring(0, 300)}\n`;
        }
        if (item.items && item.items.length > 0) {
          item.items.forEach((sub: string) => {
            itemsContext += `   • ${sub}\n`;
          });
        }
      });

      // Generate AI recap
      const recapPrompt = `You are Olive, generating a detailed recap/review of the user's "${matchedList.name}" list.

## LIST DATA:
- List: ${matchedList.name}
- Description: ${matchedList.description || 'None'}
- Total items: ${listItems.length} (${activeItems.length} active, ${completedItems.length} completed)
- Urgent items: ${urgentItems.length}
- Overdue items: ${overdueItems.length}
- Items with due dates: ${withDueDate.length}
- Created: ${new Date(matchedList.created_at).toLocaleDateString()}

## ALL ITEMS:
${itemsContext}

## YOUR TASK:
Generate a DETAILED, organized recap that includes:
1. **Overview** — Quick status summary (total, active, completed, urgent)
2. **Active Items** — List each active item with full details, due dates, and priorities
3. **Action Needed** — Highlight overdue or urgent items that need attention NOW
4. **Completed** — Brief mention of what's been done (count and optionally names)
5. **Insights** — Any patterns or suggestions (e.g., "3 items are overdue", "most items have no due date set")

FORMAT for WhatsApp (max 1500 chars):
- Use *bold* for headers
- Use emojis for visual clarity
- Be concise but thorough
- Group items logically
- End with an actionable suggestion`;

      // Inject language instruction
      const recapLangName = LANG_NAMES[userLang] || LANG_NAMES[userLang.split('-')[0]] || 'English';
      const fullRecapPrompt = recapLangName !== 'English'
        ? recapPrompt + `\n\nIMPORTANT: Respond entirely in ${recapLangName}.`
        : recapPrompt;

      try {
        const recapResponse = await callAI(fullRecapPrompt, `Recap my ${matchedList.name} list`, 0.7, 'standard');

        // Save context for follow-ups
        const displayedItems = activeItems.slice(0, 10);
        if (displayedItems.length > 0) {
          await saveReferencedEntity(displayedItems[0], recapResponse, displayedItems.map(t => ({ id: t.id, summary: t.summary })));
        } else {
          await saveReferencedEntity(null, recapResponse);
        }

        return reply(recapResponse.slice(0, 1500));
      } catch (aiError) {
        console.error('[LIST_RECAP] AI error, using fallback:', aiError);

        // Fallback: structured text recap
        let fallback = `📋 *${matchedList.name}* Recap\n\n`;
        fallback += `📊 ${activeItems.length} active | ${completedItems.length} done`;
        if (urgentItems.length > 0) fallback += ` | ${urgentItems.length} urgent 🔥`;
        if (overdueItems.length > 0) fallback += ` | ${overdueItems.length} overdue ⚠️`;
        fallback += '\n\n';

        if (urgentItems.length > 0) {
          fallback += `🔥 *Urgent:*\n`;
          urgentItems.slice(0, 5).forEach((item, i) => {
            fallback += `${i + 1}. ${item.summary}\n`;
          });
          fallback += '\n';
        }

        if (overdueItems.length > 0) {
          fallback += `⚠️ *Overdue:*\n`;
          overdueItems.slice(0, 5).forEach((item, i) => {
            const days = Math.floor((Date.now() - new Date(item.due_date!).getTime()) / 86400000);
            fallback += `${i + 1}. ${item.summary} (${days}d overdue)\n`;
          });
          fallback += '\n';
        }

        const regularItems = activeItems.filter(i => i.priority !== 'high' && !(i.due_date && new Date(i.due_date) < new Date()));
        if (regularItems.length > 0) {
          fallback += `📝 *Active:*\n`;
          regularItems.slice(0, 8).forEach((item, i) => {
            const due = item.due_date ? ` (${formatFriendlyDate(item.due_date, false)})` : '';
            fallback += `${i + 1}. ${item.summary}${due}\n`;
          });
          if (regularItems.length > 8) fallback += `...and ${regularItems.length - 8} more\n`;
        }

        fallback += `\n🔗 Manage: https://witholive.app`;

        const displayedFallback = activeItems.slice(0, 10);
        if (displayedFallback.length > 0) {
          await saveReferencedEntity(displayedFallback[0], fallback, displayedFallback.map(t => ({ id: t.id, summary: t.summary })));
        }
        return reply(fallback);
      }
    }

    // ========================================================================
    // CREATE INTENT (Default) - Capture First
    // ========================================================================
    
    // CONTEXT RESOLUTION: If the user says "schedule it", "then create it",
    // "save that", etc. and the effective message is just a pronoun/short phrase,
    // pull the previous user message from session context to use as the actual content.
    let createMessage = effectiveMessage || '';
    const isPronounOnlyCreate = /^(then\s+)?(schedule|create|save|add|set|do|make)\s+(it|that|this|lo|eso|esto|quello|questo)\s*[.!]?$/i.test(createMessage.trim());
    if (isPronounOnlyCreate) {
      const prevMsg = sessionContext.last_user_message;
      const prevMsgAt = sessionContext.last_user_message_at;
      const isRecent = prevMsgAt && (Date.now() - new Date(prevMsgAt).getTime()) < 10 * 60 * 1000; // 10 min TTL
      
      if (prevMsg && isRecent) {
        console.log('[CREATE] Pronoun-only create detected, using previous message:', prevMsg.substring(0, 80));
        createMessage = prevMsg;
      } else {
        console.log('[CREATE] Pronoun-only but no recent context, proceeding with original message');
      }
    }

    const notePayload: any = { 
      text: createMessage, 
      user_id: userId,
      couple_id: effectiveCoupleId,
      timezone: profile.timezone || 'America/New_York',
      source: 'whatsapp',
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
      
      const randomTipsLocalized: Record<string, string[]> = {
        en: [
          "Reply 'Make it urgent' to change priority",
          "Reply 'Show my tasks' to see your list",
          "You can send voice notes too! 🎤",
          "Use ! prefix for urgent tasks (e.g., !call mom)",
          "Use $ to log expenses (e.g., $25 lunch)",
          "Use ? to search your tasks (e.g., ?groceries)",
          "Send a photo of a receipt to log it automatically 📸",
          "Say 'Remind me tomorrow at 9am' to set reminders",
          "Say 'done with X' to mark a task complete",
          "Send a comma-separated list to create multiple tasks at once",
        ],
        es: [
          "Responde 'Hazlo urgente' para cambiar prioridad",
          "Responde 'Mostrar mis tareas' para ver tu lista",
          "¡También puedes enviar notas de voz! 🎤",
          "Usa ! para tareas urgentes (ej. !llamar a mamá)",
          "Usa $ para registrar gastos (ej. $25 almuerzo)",
          "Usa ? para buscar tareas (ej. ?compras)",
          "Envía una foto de un recibo para registrarlo automáticamente 📸",
          "Di 'Recuérdame mañana a las 9am' para establecer recordatorios",
          "Di 'hecho con X' para completar una tarea",
          "Envía una lista separada por comas para crear varias tareas a la vez",
        ],
        it: [
          "Rispondi 'Rendilo urgente' per cambiare priorità",
          "Rispondi 'Mostra le mie attività' per vedere la tua lista",
          "Puoi anche inviare note vocali! 🎤",
          "Usa ! per attività urgenti (es. !chiamare mamma)",
          "Usa $ per registrare spese (es. $25 pranzo)",
          "Usa ? per cercare attività (es. ?spesa)",
          "Invia una foto di uno scontrino per registrarlo automaticamente 📸",
          "Di 'Ricordami domani alle 9' per impostare promemoria",
          "Di 'fatto con X' per completare un'attività",
          "Invia una lista separata da virgole per creare più attività",
        ],
      };
      const shortLang = (userLang || 'en').split('-')[0];
      const tips = randomTipsLocalized[shortLang] || randomTipsLocalized.en;
      const getRandomTip = () => tips[Math.floor(Math.random() * tips.length)];
      
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
        // For multi-note: encrypt each note if sensitive
        const notesToInsert = await Promise.all(processData.notes.map(async (note: any) => {
          const rawText = messageBody || note.summary || 'Media attachment';
          const rawSum = note.summary;
          let encFields = {
            original_text: rawText,
            summary: rawSum,
            encrypted_original_text: null as string | null,
            encrypted_summary: null as string | null,
            is_sensitive: isSensitiveNote || !!processData.is_sensitive,
          };
          
          if (encFields.is_sensitive && isEncryptionAvailable()) {
            try {
              encFields = await encryptNoteFields(rawText, rawSum, userId, true);
            } catch (e) { /* fallback to plaintext */ }
          }
          
          return {
            author_id: userId,
            couple_id: effectiveCoupleId,
            ...encFields,
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
          };
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
        const moreCount = count > 3 ? count - 3 : 0;
        const moreTextLocalized: Record<string, string> = {
          en: `\n...and ${moreCount} more`,
          es: `\n...y ${moreCount} más`,
          it: `\n...e altri ${moreCount}`,
        };
        const sl = (userLang || 'en').split('-')[0];
        const moreText = moreCount > 0 ? (moreTextLocalized[sl] || moreTextLocalized.en) : '';
        
        return reply(`${t('note_multi_saved', userLang, { count: String(count) })}\n${itemsList}${moreText}\n\n${t('note_added_to', userLang, { list: listName })}\n\n${t('note_manage', userLang)}\n\n💡 ${getRandomTip()}`);
      } else {
        // Build note data with optional encryption for sensitive notes
        const rawOriginalText = messageBody || processData.summary || 'Media attachment';
        const rawSummary = processData.summary;
        
        let encryptionFields = {
          original_text: rawOriginalText,
          summary: rawSummary,
          encrypted_original_text: null as string | null,
          encrypted_summary: null as string | null,
          is_sensitive: isSensitiveNote || !!processData.is_sensitive,
        };
        
        if (encryptionFields.is_sensitive && isEncryptionAvailable()) {
          try {
            encryptionFields = await encryptNoteFields(rawOriginalText, rawSummary, userId, true);
            console.log('[WhatsApp] 🔐 Note fields encrypted for sensitive note');
          } catch (encErr) {
            console.warn('[WhatsApp] Encryption failed, storing as plaintext:', encErr);
          }
        }
        
        const noteData = {
          author_id: userId,
          couple_id: effectiveCoupleId,
          ...encryptionFields,
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
        // RICH RESPONSE BUILDER (LOCALIZED)
        // ================================================================
        let confirmationMessage: string;
        
        if (duplicateWarning?.found) {
          confirmationMessage = [
            t('note_saved', userLang, { summary: insertedNoteSummary }),
            t('note_added_to', userLang, { list: listName }),
            ``,
            t('note_similar_found', userLang, { task: duplicateWarning.targetTitle }),
          ].join('\n');
        } else {
          const sensitiveLabel = encryptionFields.is_sensitive ? '\n🔒 Encrypted at rest' : '';
          confirmationMessage = [
            t('note_saved', userLang, { summary: rawSummary }),
            t('note_added_to', userLang, { list: listName }),
            sensitiveLabel,
            ``,
            t('note_manage', userLang),
            ``,
            `💡 ${getRandomTip()}`
          ].filter(Boolean).join('\n');
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
  if (typeof (globalThis as any).EdgeRuntime !== 'undefined' && (globalThis as any).EdgeRuntime.waitUntil) {
    (globalThis as any).EdgeRuntime.waitUntil(backgroundProcessing);
  }

  // Return 200 immediately — Meta gets its response in <100ms
  return new Response('EVENT_RECEIVED', { status: 200 });
});

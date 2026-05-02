import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.0.0";
import { encryptNoteFields, isEncryptionAvailable } from "../_shared/encryption.ts";
import { createLLMTracker, type LLMTracker } from "../_shared/llm-tracker.ts";
import {
  getWAChatPromptVersion,
  WA_CONTEXTUAL_ASK_PROMPT_VERSION,
  WA_HYBRID_ASK_PROMPT_VERSION,
  WA_CLASSIFICATION_PROMPT_VERSION,
  WA_EXPENSE_CATEGORIZATION_PROMPT_VERSION,
  WA_REWRITER_PROMPT_VERSION,
  WA_STT_PROMPT_VERSION,
  WA_WEB_SEARCH_FORMAT_PROMPT_VERSION,
  WA_LIST_RECAP_PROMPT_VERSION,
} from "../_shared/prompts/whatsapp-prompts.ts";
import { parseNaturalDate } from "../_shared/natural-date-parser.ts";
import {
  isRelativeReference,
  resolveRelativeReference,
  searchTaskByKeywords,
  computeMatchQuality,
  semanticTaskSearchMulti,
  semanticTaskSearch,
  findSimilarNotes,
  type TaskCandidate,
} from "../_shared/task-search.ts";
import {
  standardizePhoneNumber,
  formatFriendlyDate,
  sendWhatsAppReply,
  downloadAndUploadMetaMedia,
} from "../_shared/whatsapp-messaging.ts";
import {
  formatDateForZone,
  formatTimeForZone,
  getNextWeekBoundaryUtc,
  getRelativeDayWindowUtc,
  getTimeZoneParts,
  isBeforeUtc,
  isInUtcRange,
  parseStoredTimestamp,
  toUtcFromLocalParts,
} from "../_shared/timezone-calendar.ts";
import { parseExpenseText } from "../_shared/expense-detector.ts";
import { captureReplyReflection } from "../_shared/reflection-capture.ts";
import { checkTrustForAction } from "../_shared/trust-gate-check.ts";
import { assembleContextSoul } from "../_shared/context-soul/index.ts";
import {
  classifyConfirmationReply,
  isBadTitle,
  isPendingOfferFresh,
  looksLikeConfirmation,
  type PendingOffer,
} from "../_shared/pending-offer.ts";
import { resolveQuotedTask } from "../_shared/quoted-message.ts";
import { extractTimeOnly } from "../_shared/time-only-parser.ts";
import {
  type BufferedEvent,
  CLUSTER_WINDOW_MS,
  bufferEvent,
  claimCluster,
  hasActiveCluster,
  isClusterTrigger,
  isStillLeader,
  sleep,
} from "../_shared/inbound-cluster.ts";
import {
  combineCluster,
  decideClusterIntent,
} from "../_shared/inbound-cluster-processor.ts";

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

type IntentResult = { intent: 'SEARCH' | 'MERGE' | 'CREATE' | 'CHAT' | 'CONTEXTUAL_ASK' | 'WEB_SEARCH' | 'WEB_RESEARCH' | 'SCHEDULE_CALENDAR' | 'TASK_ACTION' | 'EXPENSE' | 'PARTNER_MESSAGE' | 'CREATE_LIST' | 'LIST_RECAP' | 'SAVE_ARTIFACT' | 'SAVE_MEMORY'; isUrgent?: boolean; cleanMessage?: string };

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
  memory_saved: {
    en: '🧠 Got it! I\'ll remember: "{content}"\n\nYou can always ask me about it later 🫒',
    'es': '🧠 ¡Entendido! Recordaré: "{content}"\n\nPuedes preguntarme sobre esto después 🫒',
    'it': '🧠 Capito! Ricorderò: "{content}"\n\nPuoi chiedermi in qualsiasi momento 🫒',
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
  artifact_saved: {
    en: '✅ Saved! "{title}"{list}\n\n📝 You can find it in your notes on the app.\n\n🔗 witholive.app',
    'es': '✅ ¡Guardado! "{title}"{list}\n\n📝 Puedes encontrarlo en tus notas en la app.\n\n🔗 witholive.app',
    'it': '✅ Salvato! "{title}"{list}\n\n📝 Puoi trovarlo nelle tue note nell\'app.\n\n🔗 witholive.app',
  },
  artifact_none: {
    en: "I don't have a recent draft or output to save. Ask me to help you with something first, then say \"save it\" 🫒",
    'es': 'No tengo un borrador reciente para guardar. Pídeme ayuda con algo primero y luego di "guárdalo" 🫒',
    'it': 'Non ho una bozza recente da salvare. Chiedimi aiuto con qualcosa prima, poi di "salvalo" 🫒',
  },
  artifact_save_error: {
    en: "Sorry, I couldn't save that. Please try again 🫒",
    'es': 'Lo siento, no pude guardarlo. Inténtalo de nuevo 🫒',
    'it': 'Scusa, non sono riuscita a salvarlo. Riprova 🫒',
  },
  artifact_offer_declined: {
    en: '🌿 No worries — skipped.',
    'es': '🌿 Sin problema — lo dejo pasar.',
    'it': '🌿 Nessun problema — lascio stare.',
  },
  // ── Reminder/due-date confirmation OFFERS (system asks; user replies yes/no) ──
  // Placeholders: {task}, {when}, {partner}, {source}, {target}
  // Inserted as a unit by t() — keep the punctuation/structure consistent
  // across locales so the AWAITING_CONFIRMATION classifier (which still
  // accepts yes/sí/sì/ok) works without per-locale tweaks.
  note_reminder_set: {
    en: '⏰ Reminder set for {date}',
    'es': '⏰ Recordatorio para {date}',
    'it': '⏰ Promemoria per {date}',
  },
  confirm_set_due: {
    en: '📅 Set "{task}" due {when}?\n\nReply "yes" to confirm.',
    'es': '📅 ¿Establecer "{task}" para {when}?\n\nResponde "sí" para confirmar.',
    'it': '📅 Imposto "{task}" per {when}?\n\nRispondi "sì" per confermare.',
  },
  confirm_set_reminder: {
    en: '⏰ Set reminder for "{task}" {when}?\n\nReply "yes" to confirm.',
    'es': '⏰ ¿Recordatorio para "{task}" {when}?\n\nResponde "sí" para confirmar.',
    'it': '⏰ Promemoria per "{task}" {when}?\n\nRispondi "sì" per confermare.',
  },
  confirm_assign: {
    en: '🤝 Assign "{task}" to {partner}?\n\nReply "yes" to confirm.',
    'es': '🤝 ¿Asignar "{task}" a {partner}?\n\nResponde "sí" para confirmar.',
    'it': '🤝 Assegnare "{task}" a {partner}?\n\nRispondi "sì" per confermare.',
  },
  confirm_delete: {
    en: '🗑️ Delete "{task}"?\n\nReply "yes" to confirm or "no" to cancel.',
    'es': '🗑️ ¿Eliminar "{task}"?\n\nResponde "sí" para confirmar o "no" para cancelar.',
    'it': '🗑️ Eliminare "{task}"?\n\nRispondi "sì" per confermare o "no" per annullare.',
  },
  confirm_merge: {
    en: '🔀 Merge "{source}" into "{target}"?\n\nReply "yes" to confirm or "no" to cancel.',
    'es': '🔀 ¿Fusionar "{source}" en "{target}"?\n\nResponde "sí" para confirmar o "no" para cancelar.',
    'it': '🔀 Unire "{source}" in "{target}"?\n\nRispondi "sì" per confermare o "no" per annullare.',
  },
  // ── Post-confirmation DONE messages (system confirms after user said yes) ──
  done_set_due: {
    en: '✅ Done! "{task}" is now due {when}. 📅',
    'es': '✅ ¡Hecho! "{task}" ahora vence {when}. 📅',
    'it': '✅ Fatto! "{task}" ora è previsto per {when}. 📅',
  },
  done_set_reminder: {
    en: "✅ Done! I'll remind you about \"{task}\" {when}. ⏰",
    'es': '✅ ¡Hecho! Te recordaré "{task}" {when}. ⏰',
    'it': '✅ Fatto! Ti ricorderò "{task}" {when}. ⏰',
  },
  done_assign: {
    en: '✅ Done! I assigned "{task}" to {partner}. 🎯',
    'es': '✅ ¡Hecho! Asigné "{task}" a {partner}. 🎯',
    'it': '✅ Fatto! Ho assegnato "{task}" a {partner}. 🎯',
  },
  done_delete: {
    en: '🗑️ Done! "{task}" has been deleted.',
    'es': '🗑️ ¡Hecho! "{task}" ha sido eliminada.',
    'it': '🗑️ Fatto! "{task}" è stata eliminata.',
  },
  done_merge: {
    en: '✅ Merged! Combined your note into: "{target}"\n\n🔗 Manage: https://witholive.app',
    'es': '✅ ¡Fusionado! Combiné tu nota en: "{target}"\n\n🔗 Gestionar: https://witholive.app',
    'it': '✅ Unito! Ho combinato la tua nota in: "{target}"\n\n🔗 Gestisci: https://witholive.app',
  },
  // ── Date/time validation errors ──
  date_unparseable: {
    en: 'I couldn\'t understand the date "{expr}". Try "tomorrow", "monday", or "next week".',
    'es': 'No entendí la fecha "{expr}". Prueba "mañana", "lunes" o "próxima semana".',
    'it': 'Non ho capito la data "{expr}". Prova "domani", "lunedì" o "la prossima settimana".',
  },
  // ── Smart-reminder default phrasings (used when user gives no explicit time) ──
  smart_reminder_30min: {
    en: 'in 30 minutes',
    'es': 'en 30 minutos',
    'it': 'tra 30 minuti',
  },
  smart_reminder_2h_before: {
    en: '2 hours before it\'s due',
    'es': '2 horas antes de la fecha límite',
    'it': '2 ore prima della scadenza',
  },
  smart_reminder_evening_morning: {
    en: 'the evening before (8:00 PM) + morning of (9:00 AM)',
    'es': 'la noche anterior (20:00) + la mañana del día (9:00)',
    'it': 'la sera prima (20:00) + la mattina (09:00)',
  },
  smart_reminder_morning_of: {
    en: 'the morning of (9:00 AM)',
    'es': 'la mañana del día (9:00)',
    'it': 'la mattina (09:00)',
  },
  smart_reminder_tomorrow_9am: {
    en: 'tomorrow at 9:00 AM',
    'es': 'mañana a las 9:00',
    'it': 'domani alle 09:00',
  },
  // ── Move-task error messages (hardcoded English replaced) ──
  move_need_list_name: {
    en: 'Which list should I move this task to? Please provide a list name.',
    'es': '¿A qué lista quieres que mueva esta tarea? Indícame el nombre.',
    'it': 'In quale lista vuoi che sposti l\'attività? Indicami il nome.',
  },
  move_failed: {
    en: 'Sorry, I couldn\'t move that task. Please try again.',
    'es': 'Lo siento, no pude mover esa tarea. Inténtalo de nuevo.',
    'it': 'Mi dispiace, non sono riuscita a spostare quell\'attività. Riprova.',
  },
  // ── TASK_ACTION default fallback (unrecognized action) ──
  task_action_unknown: {
    en: 'I didn\'t understand that action. Try "done with [task]", "make [task] urgent", or "assign [task] to partner".',
    'es': 'No entendí esa acción. Prueba "hecho con [tarea]", "hacer urgente [tarea]" o "asignar [tarea] a pareja".',
    'it': 'Non ho capito quell\'azione. Prova "fatto con [attività]", "rendi urgente [attività]" o "assegna [attività] al partner".',
  },
  // ── MERGE intent flow ──
  merge_no_recent: {
    en: 'I don\'t see any recent tasks to merge. The Merge command works within 5 minutes of creating a task.',
    'es': 'No veo tareas recientes para fusionar. El comando Merge funciona dentro de los 5 minutos posteriores a la creación.',
    'it': 'Non vedo attività recenti da unire. Il comando Merge funziona entro 5 minuti dalla creazione di un\'attività.',
  },
  merge_no_similar: {
    en: 'I couldn\'t find a similar task to merge "{task}" with. The task remains as-is.',
    'es': 'No encontré una tarea similar para fusionar con "{task}". La tarea queda igual.',
    'it': 'Non ho trovato un\'attività simile da unire a "{task}". L\'attività resta com\'è.',
  },
  // ── PR6: Due-date / Reminder-time inline labels in numbered task lists ──
  // Used by search results, urgent-tasks list, this-week recap, and any
  // user-facing list that shows ` (Due: …) ` next to a task summary.
  // The English form keeps the leading space so concatenation stays
  // syntactically clean at call sites.
  label_task_due_paren: {
    en: ' (Due: {date})',
    'es': ' (Vence: {date})',
    'it': ' (Scadenza: {date})',
  },
  // ── PR8: Brief ack sent on the FIRST cluster-triggering event so the
  // user sees Olive received their drop while the 7s debounce window
  // runs. The full reply (Saved/Added/Reminder) follows once the
  // cluster flushes. Subsequent events in the same cluster are silent.
  cluster_brief_ack: {
    en: '🌿 Got it, processing…',
    'es': '🌿 Recibido, procesando…',
    'it': '🌿 Ricevuto, sto elaborando…',
  },
  // ── PR8: confirmation when a cluster's leader quotes an existing
  // task (TASK_ACTION/augment path). The user dropped media/text
  // while quoting a previous Olive bubble — we attach to the existing
  // note rather than creating a new one.
  cluster_augmented_task: {
    en: '📎 Added to "{task}"',
    'es': '📎 Añadido a "{task}"',
    'it': '📎 Aggiunto a "{task}"',
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
/**
 * Phase 1-D — WhatsApp thread instrumentation
 * Increment per-thread and lifetime message counters for the user's gateway
 * session. Creates the gateway session row if it doesn't exist (for users
 * that message Olive for the first time via WhatsApp).
 *
 * Returns the new counters so downstream logic can decide when to compact.
 * Fire-and-forget — failures are logged and swallowed so a telemetry problem
 * never blocks the actual message-handling flow.
 */
async function touchGatewaySession(
  supabase: any,
  userId: string
): Promise<{ messageCount: number; totalMessagesEver: number } | null> {
  try {
    // Step 1: Ensure a session row exists. Use select+insert rather than
    // upsert because there's no unique constraint on (user_id, channel).
    const { data: existing } = await supabase
      .from('olive_gateway_sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('channel', 'whatsapp')
      .eq('is_active', true)
      .order('last_activity', { ascending: false })
      .limit(1)
      .maybeSingle();

    let sessionId: string | null = existing?.id ?? null;

    if (!sessionId) {
      const { data: created, error: insertErr } = await supabase
        .from('olive_gateway_sessions')
        .insert({
          user_id: userId,
          channel: 'whatsapp',
          is_active: true,
          conversation_context: {},
        })
        .select('id')
        .single();
      if (insertErr) {
        console.warn('[GatewaySession] Insert failed (non-blocking):', insertErr.message);
        return null;
      }
      sessionId = created.id;
    }

    // Step 2: Atomic increment via RPC (avoids TOCTOU races).
    const { data: incRows, error: rpcErr } = await supabase.rpc(
      'increment_gateway_session_message',
      { p_session_id: sessionId }
    );
    if (rpcErr || !incRows || incRows.length === 0) {
      if (rpcErr) console.warn('[GatewaySession] RPC failed (non-blocking):', rpcErr.message);
      return null;
    }

    const row = incRows[0];
    return {
      messageCount: row.message_count,
      totalMessagesEver: row.total_messages_ever,
    };
  } catch (err: any) {
    console.warn('[GatewaySession] touchGatewaySession error (non-blocking):', err?.message);
    return null;
  }
}

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
      // Skip error replies — they carry no useful conversational context
      // and would confuse the AI in the next turn (e.g., "Sorry, I had trouble...")
      if (ctx.is_error || ctx.message_type === 'error') {
        console.log('[Context] Skipping error reply from outbound context');
      } else if (sentAt && new Date(sentAt).getTime() > Date.now() - 60 * 60 * 1000) {
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

// PR4 / Block C — `resolveQuotedTask` lives in
// `_shared/quoted-message.ts` so its logic is unit-testable in
// isolation from the 7,800-line webhook module.

// ============================================================================
// PR8 / Phase 2 — Cluster processors
// ============================================================================
// These two functions handle the side effects (DB inserts, reply
// formatting) when an inbound cluster flushes. The combine + intent-
// decision logic is in `_shared/inbound-cluster-processor.ts` (pure
// data); these handlers are top-level so the per-request dispatch
// block can call them without closure capture, and they accept the
// per-request `reply` and `saveReferencedEntity` callbacks as
// parameters since those depend on the request scope.

import type { CombinedCluster } from "../_shared/inbound-cluster-processor.ts";

/**
 * CREATE path: combine the cluster into one process-note invocation,
 * insert the resulting note(s), send a single localized reply.
 *
 * Mirrors the existing media-only branch's shape (auth → mediaPayload
 * → process-note → insert loop → confirmation message) but reads
 * media + text from the combined cluster instead of the single
 * inbound event.
 */
async function createNoteFromCluster(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  effectiveCoupleId: string | null,
  // deno-lint-ignore no-explicit-any
  profile: any,
  userLang: string,
  combined: CombinedCluster,
  reply: (text: string, mediaUrl?: string) => Promise<void>,
  // deno-lint-ignore no-explicit-any
  saveReferencedEntity: (task: any, oliveResponse: string, displayedList?: any) => Promise<void>,
): Promise<void> {
  // Build the process-note payload. The combined text and media flow
  // through the same fields process-note already understands.
  const payload: Record<string, unknown> = {
    text: combined.text,
    user_id: userId,
    couple_id: effectiveCoupleId,
    timezone: profile.timezone || "America/New_York",
    language: profile.language_preference || "en",
    source: "whatsapp",
  };
  if (combined.media_urls.length > 0) {
    payload.media = combined.media_urls;
    payload.mediaTypes = combined.media_types;
  }
  if (combined.latitude && combined.longitude) {
    payload.location = { latitude: combined.latitude, longitude: combined.longitude };
  }

  console.log(
    "[Cluster CREATE] invoking process-note: text-len=" + combined.text.length,
    "media=" + combined.media_urls.length,
    "events=" + combined.source_event_count,
  );

  const { data: processData, error: processError } = await supabase.functions.invoke("process-note", {
    body: payload,
  });
  if (processError) {
    console.error("[Cluster CREATE] process-note error:", processError);
    await reply(t("error_generic", userLang));
    return;
  }

  // Handle both single-note and multiple-notes shapes from process-note.
  const isMultiple = processData?.multiple === true && Array.isArray(processData?.notes) && processData.notes.length > 0;
  // deno-lint-ignore no-explicit-any
  const notesToInsert: any[] = isMultiple ? processData.notes : [processData];

  const insertedNotes: Array<{ id: string; summary: string; list_id: string | null }> = [];
  for (const note of notesToInsert) {
    const noteSummary = note?.summary || processData?.summary || "Saved capture";
    const noteData = {
      author_id: userId,
      couple_id: effectiveCoupleId,
      original_text: note?.original_text || combined.text || noteSummary,
      summary: noteSummary,
      category: note?.category || processData?.category || "task",
      due_date: note?.due_date || null,
      reminder_time: note?.reminder_time || null,
      recurrence_frequency: note?.recurrence_frequency || null,
      recurrence_interval: note?.recurrence_interval || null,
      priority: note?.priority || "medium",
      tags: note?.tags || [],
      items: note?.items || [],
      task_owner: note?.task_owner || null,
      list_id: note?.list_id || processData?.list_id || null,
      media_urls: combined.media_urls.length > 0 ? combined.media_urls : null,
      completed: false,
    };
    const { data: insertedNote, error: insertError } = await supabase
      .from("clerk_notes")
      .insert(noteData)
      .select("id, summary, list_id")
      .single();
    if (insertError) {
      console.error("[Cluster CREATE] insert error:", insertError);
      continue;
    }
    insertedNotes.push(insertedNote);
  }

  if (insertedNotes.length === 0) {
    await reply(t("error_generic", userLang));
    return;
  }

  // Resolve list name for the localized confirmation.
  let listName = "Tasks";
  const firstListId = insertedNotes[0].list_id;
  if (firstListId) {
    const { data: listData } = await supabase
      .from("clerk_lists")
      .select("name")
      .eq("id", firstListId)
      .single();
    listName = listData?.name || "Tasks";
  }

  // Build the localized full reply. Mirrors the existing pattern:
  // note_saved + note_added_to + note_manage. For multi-note clusters
  // (rare — process-note rarely splits a clustered batch into many),
  // we use note_multi_saved.
  let confirmMsg: string;
  if (insertedNotes.length === 1) {
    const lines = [
      t("note_saved", userLang, { summary: insertedNotes[0].summary }),
      t("note_added_to", userLang, { list: listName }),
      "",
      t("note_manage", userLang),
    ];
    confirmMsg = lines.join("\n");
  } else {
    const itemList = insertedNotes.map((n, i) => `  ${i + 1}. ${n.summary}`).join("\n");
    const lines = [
      t("note_multi_saved", userLang, { count: String(insertedNotes.length) }),
      itemList,
      t("note_added_to", userLang, { list: listName }),
      "",
      t("note_manage", userLang),
    ];
    confirmMsg = lines.join("\n");
  }

  // Stash referenced entity for follow-up resolution.
  try {
    const lastNote = insertedNotes[insertedNotes.length - 1];
    await saveReferencedEntity(
      { id: lastNote.id, summary: lastNote.summary, list_id: lastNote.list_id || undefined },
      confirmMsg,
    );
  } catch (refErr) {
    console.warn("[Cluster CREATE] saveReferencedEntity failed (non-blocking):", refErr);
  }

  await reply(confirmMsg);
}

/**
 * TASK_ACTION (augment) path: the cluster's leader event quoted a
 * previous Olive bubble that resolves to an existing task. Instead
 * of creating a new note, attach the cluster's media to the existing
 * one and append the cluster's text to its `original_text` field.
 *
 * Per the Phase 2 plan, we do NOT re-run the AI here — the user's
 * intent was clearly "add to that thing", not "re-categorize". The
 * existing summary, due_date, reminder, list, etc. all stay put.
 */
async function augmentTaskFromCluster(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  taskId: string,
  taskSummary: string,
  combined: CombinedCluster,
  reply: (text: string, mediaUrl?: string) => Promise<void>,
  userLang: string,
  // deno-lint-ignore no-explicit-any
  saveReferencedEntity: (task: any, oliveResponse: string, displayedList?: any) => Promise<void>,
): Promise<void> {
  // Fetch existing media_urls + original_text so we can append.
  const { data: existing, error: fetchErr } = await supabase
    .from("clerk_notes")
    .select("id, summary, list_id, media_urls, original_text")
    .eq("id", taskId)
    .eq("author_id", userId)  // defense: only augment notes the user owns
    .maybeSingle();

  if (fetchErr || !existing) {
    console.warn("[Cluster AUGMENT] target note not found, falling back to error reply:", fetchErr);
    await reply(t("error_generic", userLang));
    return;
  }

  const mergedMediaUrls = Array.from(
    new Set<string>([...(existing.media_urls || []), ...combined.media_urls]),
  );

  // Append cluster text to original_text, separated by a newline so
  // it's readable when the user views the note in the app.
  const mergedOriginalText = combined.text
    ? [existing.original_text || "", combined.text].filter((s) => s && s.trim().length > 0).join("\n")
    : (existing.original_text || "");

  const { error: updateErr } = await supabase
    .from("clerk_notes")
    .update({
      media_urls: mergedMediaUrls.length > 0 ? mergedMediaUrls : null,
      original_text: mergedOriginalText,
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId);

  if (updateErr) {
    console.error("[Cluster AUGMENT] update error:", updateErr);
    await reply(t("error_generic", userLang));
    return;
  }

  const confirmMsg = t("cluster_augmented_task", userLang, { task: taskSummary });

  try {
    await saveReferencedEntity(
      { id: existing.id, summary: existing.summary, list_id: existing.list_id || undefined },
      confirmMsg,
    );
  } catch (refErr) {
    console.warn("[Cluster AUGMENT] saveReferencedEntity failed (non-blocking):", refErr);
  }

  await reply(confirmMsg);
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

// parseExpenseText → imported from _shared/expense-detector.ts
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
  // Store last assistant-produced artifact (email draft, plan, etc.) for "save this" follow-ups
  last_assistant_output?: string;
  last_assistant_output_at?: string;
  last_assistant_request?: string; // The user's original request that triggered the output
  // Structured Capture → Offer → Confirm → Execute state.
  // Set when Olive proposes an action ("Want me to save this?") and waits for confirmation.
  // Survives intermediate CHAT turns so a delayed "yes" still resolves to the right artifact.
  pending_offer?: PendingOffer | null;
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
): IntentResult & { queryType?: string; chatType?: string; actionType?: string; actionTarget?: string; cleanMessage?: string; _aiTaskId?: string; _aiSkillId?: string; _listName?: string; _partnerAction?: string; _initialItems?: string } {
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

    case 'save_memory':
      return {
        intent: 'SAVE_MEMORY',
        cleanMessage: ai.target_task_name || undefined,
      };

    case 'web_research':
      return {
        intent: 'WEB_RESEARCH',
        cleanMessage: ai.target_task_name || undefined,
        _aiSkillId: ai.matched_skill_id || undefined,
      };

    case 'schedule_calendar':
      return {
        intent: 'SCHEDULE_CALENDAR',
        cleanMessage: ai.target_task_name || undefined,
        _aiSkillId: ai.matched_skill_id || undefined,
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

// standardizePhoneNumber, formatFriendlyDate → imported from _shared/whatsapp-messaging.ts

// Call Gemini AI — uses GEMINI_API directly via GoogleGenAI SDK
// Supports dynamic model tier selection: "lite" | "standard" | "pro"
// Phase 6F: Added optional LLM tracker + prompt version for observability
// Supports optional multimodal media payloads (images, videos, PDFs)
// Supports native Gemini Function Calling via the Skills Engine (_shared/skills/)
async function callAI(
  systemPrompt: string,
  userMessage: string,
  temperature = 0.7,
  tier: string = "standard",
  tracker?: LLMTracker | null,
  promptVersion?: string,
  mediaUrls?: string[],
  userId?: string,
): Promise<string> {
  const { GEMINI_KEY, getModel } = await import("../_shared/gemini.ts");
  if (!GEMINI_KEY) throw new Error('GEMINI_API not configured');

  const model = getModel(tier as any);
  console.log(`[callAI] Using ${model} (tier=${tier})${promptVersion ? ` [${promptVersion}]` : ''}${mediaUrls?.length ? `, media=${mediaUrls.length} files` : ''}`);

  const startTime = performance.now();
  const genai = new GoogleGenAI({ apiKey: GEMINI_KEY });

  // Import skills registry for function calling
  const { getSkillDeclarations, executeSkill, MAX_TOOL_CALLS } = await import("../_shared/skills/registry.ts");
  const skillDeclarations = getSkillDeclarations();

  // Build multimodal payload if media is present
  let contents: any;
  let effectiveSystemPrompt = systemPrompt;

  // ─── Soul integration ─────────────────────────────────────────────
  // When the caller passes a userId (CHAT, CONTEXTUAL_ASK, etc. — the
  // user-facing reply paths), prepend the soul stack so tone, verbosity,
  // emoji_level, response_style, and domain knowledge come from the
  // user's soul, not from a hardcoded "You are Olive..." string. Utility
  // calls without userId (expense categorization, rewriter, formatter,
  // recap, classifier) stay unaffected. Fail-soft: any error logs and
  // we fall back to the un-personalized prompt.
  if (userId) {
    try {
      const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
        const { createClient: createSoulClient } = await import("https://esm.sh/@supabase/supabase-js@2");
        const { assembleSoulContext } = await import("../_shared/soul.ts");
        const sb = createSoulClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const soulResult = await assembleSoulContext(sb, { userId });
        if (soulResult.hasSoul) {
          effectiveSystemPrompt = `${soulResult.prompt}\n\n---\n\n${effectiveSystemPrompt}`;
          console.log(`[callAI] Soul loaded: ${soulResult.layersLoaded.join(',')} tokens=${soulResult.tokensUsed}`);
        }
      }
    } catch (err) {
      console.warn('[callAI] Soul assembly failed (non-blocking):', err);
    }
  }

  if (mediaUrls && mediaUrls.length > 0) {
    const { downloadMediaToBase64, MULTIMODAL_SYSTEM_PROMPT_SUFFIX } = await import("../_shared/media-utils.ts");
    const parts: any[] = [{ text: userMessage || 'Analyze this media.' }];

    for (const url of mediaUrls) {
      try {
        const media = await downloadMediaToBase64(url);
        if (media) {
          parts.push({ inlineData: { mimeType: media.mimeType, data: media.base64 } });
        }
      } catch (e) {
        console.warn('[callAI] Media download failed for URL:', url.substring(0, 60), e);
      }
    }

    // Use structured contents array for multimodal
    contents = [{ role: "user", parts }];
    effectiveSystemPrompt += MULTIMODAL_SYSTEM_PROMPT_SUFFIX;
  } else {
    // Backward-compatible: plain string for text-only calls
    contents = userMessage;
  }

  const config: any = {
    systemInstruction: effectiveSystemPrompt,
    temperature,
    maxOutputTokens: tier === "pro" ? 4000 : 1000,
  };

  // Add function calling tools if skills are registered
  if (skillDeclarations.length > 0) {
    config.tools = [{ functionDeclarations: skillDeclarations }];
  }

  let response = await genai.models.generateContent({ model, contents, config });

  // ── Function Calling Loop (bounded to MAX_TOOL_CALLS) ──────────
  // If Gemini decides to call a tool (e.g., scrape_website), execute it,
  // append the result as a functionResponse, and re-call Gemini so it can
  // formulate its final answer using the tool's output.
  let toolCallCount = 0;
  while (response.functionCalls && response.functionCalls.length > 0 && toolCallCount < MAX_TOOL_CALLS) {
    toolCallCount++;
    const fc = response.functionCalls[0];
    console.log(`[callAI] Tool call #${toolCallCount}: ${fc.name}(${JSON.stringify(fc.args).substring(0, 100)})`);

    // Execute the matched skill
    let toolResult: string;
    try {
      toolResult = await executeSkill(fc.name, fc.args || {}, userId || '');
    } catch (e: any) {
      toolResult = `Error executing ${fc.name}: ${e.message || 'Unknown error'}`;
    }
    console.log(`[callAI] Tool result (${toolResult.length} chars): ${toolResult.substring(0, 200)}...`);

    // Normalize contents to array format for conversation history
    const historyContents = Array.isArray(contents)
      ? contents
      : [{ role: "user", parts: [{ text: contents }] }];

    // Append the model's function call + our function response to the history
    contents = [
      ...historyContents,
      { role: "model", parts: [{ functionCall: { name: fc.name, args: fc.args } }] },
      { role: "user", parts: [{ functionResponse: { name: fc.name, response: { result: toolResult } } }] },
    ];

    // Re-call Gemini with the updated conversation history
    response = await genai.models.generateContent({ model, contents, config });
  }

  // Phase 6F: Track the LLM call (fire-and-forget)
  if (tracker) {
    tracker.trackRawCall(model, startTime, response, {
      promptVersion: promptVersion || undefined,
    });
  }

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

// Generate embedding for similarity search using Gemini Embedding API
async function generateEmbedding(text: string): Promise<number[] | null> {
  const GEMINI_API_KEY = Deno.env.get('GEMINI_API') || Deno.env.get('GEMINI_API_KEY');
  if (!GEMINI_API_KEY) {
    console.error('No Gemini API key configured for embeddings');
    return null;
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          outputDimensionality: 768,
        }),
      }
    );

    if (!response.ok) {
      console.error('Gemini embedding API error:', response.status);
      return null;
    }

    const data = await response.json();
    return data.embedding?.values || null;
  } catch (error) {
    console.error('Error generating embedding:', error);
    return null;
  }
}

// sendWhatsAppReply, downloadAndUploadMetaMedia → imported from _shared/whatsapp-messaging.ts

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

// ============================================================================
// parseNaturalDate, isRelativeReference, resolveRelativeReference,
// searchTaskByKeywords, computeMatchQuality, semanticTaskSearchMulti,
// semanticTaskSearch, findSimilarNotes → imported from _shared modules
// ============================================================================

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
  /**
   * PR4 / Block C — WAMID of the message the user is "replying to" /
   * quoting in WhatsApp's UI. Present only when `message.context.id` is
   * delivered by Meta. Used to disambiguate which task the user means
   * in follow-up corrections (resolves via `resolveQuotedTask`).
   */
  quotedMessageId: string | null;
  /**
   * PR8 / Phase 2 — Meta's own timestamp for the message, normalized
   * to ISO string. Used by the inbound cluster buffer for ordering.
   * Falls back to "now" if Meta didn't deliver one.
   */
  receivedAtIso: string;
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

    // PR4 / Block C — quoted-message awareness.
    //
    // When the user "replies to" / "quotes" one of Olive's previous
    // messages, Meta delivers `message.context.id` containing the WAMID
    // of the quoted message. Olive uses this to disambiguate which
    // memory/task the user is referring to in their follow-up — without
    // it, we fall back to "most recently referenced" which races
    // dangerously when text+image arrive within seconds.
    //
    // We also capture `context.from` for completeness/logging, though
    // the WAMID alone is sufficient for resolution.
    const quotedMessageId: string | null = message.context?.id ?? null;
    if (quotedMessageId) {
      console.log("[Meta] Inbound quotes WAMID:", quotedMessageId);
    }

    // PR8 / Phase 2 — Capture Meta's own timestamp for the message.
    // Meta delivers `message.timestamp` as a Unix-seconds string.
    // The clustering buffer uses this for ordering — trusting Meta's
    // clock prevents per-server drift from mis-ordering events that
    // arrive in concurrent webhooks. Falls back to "now" if missing.
    const metaTimestampSec = message.timestamp ? parseInt(String(message.timestamp), 10) : NaN;
    const receivedAtIso: string = Number.isFinite(metaTimestampSec)
      ? new Date(metaTimestampSec * 1000).toISOString()
      : new Date().toISOString();

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
      messageId: messageId || '',
      quotedMessageId,
      receivedAtIso,
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
    const { fromNumber: rawFromNumber, messageBody: rawMessageBody, mediaItems, latitude, longitude, phoneNumberId, messageId, quotedMessageId, receivedAtIso } = messageData;
    const fromNumber = standardizePhoneNumber(rawFromNumber);

    // Mutable ref for userId so reply() can access it after auth
    let _authenticatedUserId: string | null = null;
    // Track the most recently referenced task for outbound context enrichment
    let _lastReferencedTaskId: string | null = null;
    let _lastReferencedTaskSummary: string | null = null;

    // Helper to send reply via Meta Cloud API
    // NOTE: In async-ack mode, reply() just sends the WhatsApp message —
    // the HTTP response (200) was already returned to Meta above.
    //
    // PR4 / Block C — capture the outbound WAMID so the next inbound turn
    // can resolve a quoted-reply (`message.context.id`) back to the task
    // we acted on. We maintain a small sliding window of the last
    // RECENT_OUTBOUND_WINDOW entries inside `last_outbound_context.recent_outbound`
    // to survive the text+image race (two reply()s within ~1 second).
    const RECENT_OUTBOUND_WINDOW = 10;
    const reply = async (text: string, mediaUrl?: string): Promise<void> => {
      const wamid = await sendWhatsAppReply(
        phoneNumberId || WHATSAPP_PHONE_NUMBER_ID,
        rawFromNumber,
        text,
        WHATSAPP_ACCESS_TOKEN,
        mediaUrl,
      );

      // Save last_outbound_context WITH task_id so follow-up commands resolve correctly
      if (_authenticatedUserId) {
        try {
          // Detect if this is an error/fallback reply — tag it so context retrieval
          // can skip stale errors and not confuse the AI in the next turn
          const isErrorReply = /sorry.*trouble|try again|couldn't process|failed to/i.test(text);

          const sentAt = new Date().toISOString();
          const outboundCtx: any = {
            message_type: isErrorReply ? 'error' : 'reply',
            content: text.substring(0, 500),
            sent_at: sentAt,
            status: 'sent',
            is_error: isErrorReply,
            wa_message_id: wamid, // PR4 — for context.id resolution
          };
          // Attach task reference if one was recently created/modified
          if (_lastReferencedTaskId) {
            outboundCtx.task_id = _lastReferencedTaskId;
            outboundCtx.task_summary = _lastReferencedTaskSummary || '';
          }

          // Read the existing window so we can append (not replace).
          // Failures here are non-blocking — we still write the top-level
          // fields below for back-compat with code that reads single-slot.
          let window: any[] = [];
          try {
            const { data: existing } = await supabase
              .from('clerk_profiles')
              .select('last_outbound_context')
              .eq('id', _authenticatedUserId)
              .single();
            const existingWindow = existing?.last_outbound_context?.recent_outbound;
            if (Array.isArray(existingWindow)) window = existingWindow;
          } catch (winErr) {
            console.warn('[Context] Could not read existing recent_outbound window:', winErr);
          }

          // Append the new entry, keep newest-last, cap at window size.
          // Only entries with a WAMID are useful for quote resolution —
          // we still store entries without one so non-error context stays
          // chronologically complete (some Meta failures yield null wamid
          // but the message did go out).
          const newEntry = {
            wa_message_id: wamid,
            task_id: _lastReferencedTaskId,
            task_summary: _lastReferencedTaskSummary,
            message_type: outboundCtx.message_type,
            sent_at: sentAt,
            is_error: isErrorReply,
          };
          const updatedWindow = [...window, newEntry].slice(-RECENT_OUTBOUND_WINDOW);
          outboundCtx.recent_outbound = updatedWindow;

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

          // Phase 6F: Track STT call (user not yet authenticated, so no userId)
          const sttTracker = createLLMTracker(supabase, "whatsapp-webhook-stt");
          const sttStartTime = performance.now();
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
          sttTracker.trackRawCall('gemini-2.5-flash', sttStartTime, geminiResult, {
            promptVersion: WA_STT_PROMPT_VERSION,
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

    // ========================================================================
    // VISUAL PRE-ANALYSIS — "The Eyes" (Epic 5) — ROUTING-ONLY MODE
    // ------------------------------------------------------------------------
    // For media without a caption, we run a quick classifier to detect
    // RECEIPT vs TASK vs TEXT — but we do NOT inject the description into
    // messageBody. Doing that previously caused regressions where a truncated
    // AI summary (e.g. "TASK: This is a") became the user's "caption" and
    // poisoned downstream extraction with a fake/garbled title.
    //
    // Instead, the routing hint is stored in `mediaRoutingHint` and the
    // message flows through the dedicated media-only branch below, which
    // calls process-note with text:'' and lets the full multimodal pipeline
    // do high-quality extraction (handwriting OCR, event detection, etc.).
    // ========================================================================
    // ========================================================================
    // PR8 / Phase 2 — Inbound clustering (feature-flag gated)
    // ========================================================================
    // When FEATURE_INBOUND_CLUSTERING=true, cluster-triggering events
    // (media drops, link drops) are buffered for ~7 seconds. A trailing
    // text/voice/image within that window joins the cluster and the
    // whole batch is processed as ONE capture with ONE reply. The user
    // sees a brief ack on the first event so they know Olive received
    // their drop while the debounce runs.
    //
    // When the flag is OFF (default), this entire block is skipped and
    // the existing fast-path runs unchanged. Rolling back is one env
    // var change — no redeploy needed.
    //
    // See `_shared/inbound-cluster.ts` and the PR8 plan for the
    // tail-leader debounce protocol.
    const FEATURE_INBOUND_CLUSTERING = Deno.env.get("FEATURE_INBOUND_CLUSTERING") === "true";
    if (FEATURE_INBOUND_CLUSTERING) {
      // Auth lookup is duplicated here from the existing media-only
      // path — keeping a self-contained block means the cluster can
      // be lifted out (or rolled back) without touching the rest.
      const { data: clusterProfiles } = await supabase
        .from("clerk_profiles")
        .select("id, display_name, timezone, language_preference, default_privacy")
        .eq("phone_number", fromNumber)
        .limit(1);
      const clusterProfile = clusterProfiles?.[0];

      if (clusterProfile) {
        const clusterUserId = clusterProfile.id;
        const clusterUserLang = (clusterProfile.language_preference || "en").replace(/-.*/, "");

        // Decide whether this event participates in clustering:
        //   - Media or link → ALWAYS triggers a cluster.
        //   - Plain text  → only joins if there's already an active cluster.
        const triggerEvent = isClusterTrigger({
          message_body: messageBody,
          media_urls: mediaUrls,
        });
        const activeClusterExists = triggerEvent
          ? false  // optimization: trigger events always cluster, no need to check
          : await hasActiveCluster(supabase, clusterUserId, null);

        if (triggerEvent || activeClusterExists) {
          // Mark the user authenticated so reply()'s outbound context
          // capture (PR4 sliding window) gets attached correctly.
          _authenticatedUserId = clusterUserId;

          const buffered = await bufferEvent(supabase, {
            user_id: clusterUserId,
            wa_message_id: messageId,
            message_body: messageBody,
            media_urls: mediaUrls,
            media_types: mediaTypes,
            latitude,
            longitude,
            quoted_message_id: quotedMessageId,
            received_at: receivedAtIso,
          });

          if (!buffered) {
            // DB insert failed (e.g., transient connection error). Fall
            // through to the existing fast path — better to deliver a
            // possibly-imperfect reply than to drop the message.
            console.warn("[Cluster] bufferEvent returned null; falling through to fast path");
          } else if (buffered.isDuplicate) {
            // Meta retried the webhook for a message we've already
            // buffered. The original webhook is in flight; this one
            // bails so we don't double-process or send a second ack.
            console.log("[Cluster] Meta retry (duplicate WAMID); exiting silently");
            return;
          } else {
            // Brief ack only on the first event of a new cluster. We
            // exclude our own row from the active-cluster check —
            // otherwise the just-buffered row would always count as
            // "active" and we'd never ack.
            const otherActive = await hasActiveCluster(supabase, clusterUserId, buffered.id);
            if (!otherActive) {
              try {
                await reply(t("cluster_brief_ack", clusterUserLang));
              } catch (ackErr) {
                // Brief ack failure is non-blocking — the full reply
                // at flush is the contract; the ack is a courtesy.
                console.warn("[Cluster] brief ack failed (non-blocking):", ackErr);
              }
            }

            // Debounce window. EdgeRuntime.waitUntil keeps the
            // function alive past the response (already used in this
            // file for the async-ack pattern) so the await actually
            // resolves before the runtime kills us.
            await sleep(CLUSTER_WINDOW_MS);

            // After the wait, am I still the latest unflushed event?
            const stillLeader = await isStillLeader(supabase, clusterUserId, receivedAtIso);
            if (!stillLeader) {
              console.log("[Cluster] Yielding leadership to a newer event for user", clusterUserId);
              return;
            }

            // Atomic claim. FOR UPDATE SKIP LOCKED in the RPC ensures
            // a concurrent racer that ALSO passed isStillLeader gets
            // an empty result and exits below.
            const clusterId = crypto.randomUUID();
            const claimed = await claimCluster(supabase, clusterUserId, clusterId);
            if (claimed.length === 0) {
              console.log("[Cluster] Race lost — nothing to claim. Exiting.");
              return;
            }

            // Combine and decide intent.
            const combined = combineCluster(claimed);
            const resolvedQuotedTask = combined.leader_quoted_message_id
              ? await resolveQuotedTask(supabase, clusterUserId, combined.leader_quoted_message_id)
              : null;
            const intent = decideClusterIntent(combined, resolvedQuotedTask);

            console.log(
              "[Cluster] flushing cluster",
              clusterId,
              "events:", claimed.length,
              "intent:", intent.kind,
              "media:", combined.media_urls.length,
              "text-len:", combined.text.length,
            );

            // Resolve user's couple_id for note ownership.
            const { data: clusterCoupleM } = await supabase
              .from("clerk_couple_members")
              .select("couple_id")
              .eq("user_id", clusterUserId)
              .limit(1)
              .single();
            const clusterCoupleId = clusterCoupleM?.couple_id || null;
            const clusterDefaultPrivacy = clusterProfile.default_privacy || "shared";
            const clusterEffectiveCoupleId = clusterDefaultPrivacy === "private" ? null : clusterCoupleId;

            try {
              if (intent.kind === "task_action") {
                await augmentTaskFromCluster(
                  supabase,
                  clusterUserId,
                  intent.task_id,
                  intent.task_summary,
                  combined,
                  reply,
                  clusterUserLang,
                  saveReferencedEntity,
                );
              } else {
                await createNoteFromCluster(
                  supabase,
                  clusterUserId,
                  clusterEffectiveCoupleId,
                  clusterProfile,
                  clusterUserLang,
                  combined,
                  reply,
                  saveReferencedEntity,
                );
              }
            } catch (clusterErr) {
              console.error("[Cluster] flush error:", clusterErr);
              try {
                await reply(t("error_generic", clusterUserLang));
              } catch (_) { /* swallow */ }
            }
            return; // skip the rest of the webhook
          }
        }
      }
      // If we get here: feature flag on but the event didn't qualify
      // for clustering (plain text, no active cluster). Fall through
      // to the existing fast path. Zero added latency.
    }

    let mediaRoutingHint: 'receipt' | 'task' | 'text' | 'other' | null = null;
    if (mediaUrls.length > 0 && !messageBody) {
      try {
        const { downloadMediaToBase64, getMediaType } = await import("../_shared/media-utils.ts");
        const firstMediaType = getMediaType(mediaUrls[0], mediaTypes[0]);

        if (firstMediaType === 'image' || firstMediaType === 'video') {
          const media = await downloadMediaToBase64(mediaUrls[0]);
          if (media) {
            const { GEMINI_KEY } = await import("../_shared/gemini.ts");
            const genaiVision = new GoogleGenAI({ apiKey: GEMINI_KEY });

            const descResponse = await genaiVision.models.generateContent({
              model: "gemini-2.5-flash",
              contents: [{ role: "user", parts: [
                { text: "Classify this media into ONE word ONLY. Reply with exactly one of: RECEIPT (if it's a receipt/invoice/bill), TASK (if it shows a to-do, reminder, or actionable item like an event), TEXT (if it's a screenshot of text/document), or OTHER. No explanation, just the single label." },
                { inlineData: { mimeType: media.mimeType, data: media.base64 } }
              ]}],
              config: { temperature: 0, maxOutputTokens: 10 }
            });

            const label = (descResponse.text || '').trim().toUpperCase();
            if (label.startsWith('RECEIPT')) mediaRoutingHint = 'receipt';
            else if (label.startsWith('TASK')) mediaRoutingHint = 'task';
            else if (label.startsWith('TEXT')) mediaRoutingHint = 'text';
            else mediaRoutingHint = 'other';
            console.log('[WhatsApp] Media routing hint:', mediaRoutingHint, '(raw:', label.substring(0, 30) + ')');
          }
        }
      } catch (preAnalyzeErr) {
        console.warn('[WhatsApp] Media pre-analysis failed, falling back to process-note:', preAnalyzeErr);
        // mediaRoutingHint stays null → media-only branch below handles it
      }
    }

    // Handle media-only messages (images, documents) — route directly to CREATE
    // NOTE: Audio voice notes never reach here — they were transcribed above
    // and injected into messageBody, so they flow through the normal text pipeline.
    // NOTE: Images/videos that were successfully pre-analyzed above now have
    // messageBody set, so they skip this block and flow through intent classification.
    if (mediaUrls.length > 0 && !messageBody) {
      console.log('[WhatsApp] Processing media-only message — routing directly to CREATE (hint:', mediaRoutingHint || 'none', ')');

      // Receipt fast-path: if pre-analysis confidently classified the image
      // as a receipt, route to process-receipt for expense extraction.
      // Falls through to normal note creation on any failure.
      if (mediaRoutingHint === 'receipt') {
        try {
          const { data: receiptResult } = await supabase.functions.invoke('process-receipt', {
            body: { image_url: mediaUrls[0], from_number: fromNumber, source: 'whatsapp' },
          });
          if (receiptResult?.transaction) {
            const tx = receiptResult.transaction;
            const response = `✅ Expense logged: $${Number(tx.amount).toFixed(2)} — ${tx.merchant || 'Unknown'} (${tx.category || 'Other'})`;
            return reply(response);
          }
        } catch (e) {
          console.warn('[WhatsApp] Receipt fast-path failed, falling back to note:', e);
        }
      }

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
        // Language flows through to process-note so AI-extracted summary,
        // category, items, tags come back in the user's language.
        language: mediaProfile.language_preference || 'en',
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

    // ─── Reflection capture (Phase C-1.a) ──────────────────────────
    // If this inbound message is a strong-signal reaction ("thanks",
    // "stop", "perfect", etc.) AND there's a recent proactive outbound
    // to anchor against, write an `olive_reflections` row. Feeds the
    // OBSERVE → REFLECT → EVOLVE loop with natural-signal data that
    // until now was being thrown away. Fire-and-forget — never blocks
    // the user-facing reply path.
    if (messageBody) {
      captureReplyReflection(supabase, userId, messageBody)
        .then((res) => {
          if (res.captured) {
            console.log(`[ReflectionCapture] outcome=${res.outcome} for user=${userId}`);
          }
        })
        .catch((err) => console.warn('[ReflectionCapture] error (non-blocking):', err));
    }

    // Phase 1-D: Increment thread counters on olive_gateway_sessions.
    // Fire-and-forget — never blocks message handling. Used by Phase 2
    // thread-compaction to decide when a session needs summarization.
    touchGatewaySession(supabase, userId).then((counters) => {
      if (counters) {
        console.log(
          `[GatewaySession] user=${userId} message_count=${counters.messageCount} total_ever=${counters.totalMessagesEver}`
        );
      }
    });

    // Phase 6F: Create LLM tracker for observability on all AI calls in this request
    const tracker = createLLMTracker(supabase, "whatsapp-webhook", userId);
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

    // PR4 / Block C — pre-resolve the task referenced by a quoted reply.
    // If the inbound carries `context.id` (the user explicitly quoted one
    // of Olive's earlier messages), look up that WAMID in the sliding
    // window. When matched, this becomes a high-priority candidate for
    // every task-targeting handler (TASK_ACTION, complete, set_due, etc.)
    // — strictly more reliable than "most recent task" semantic search.
    let quotedTaskCtx: { task_id: string; task_summary: string; sent_at: string } | null = null;
    if (quotedMessageId) {
      quotedTaskCtx = await resolveQuotedTask(supabase, userId, quotedMessageId);
      if (quotedTaskCtx) {
        console.log(
          '[Quote] User quoted', quotedMessageId, '→ task_id', quotedTaskCtx.task_id,
          `("${quotedTaskCtx.task_summary?.substring(0, 60)}")`,
        );
      }
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
            return reply(t('confirm_delete', userLang, { task: fullTask.summary }));
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
            return reply(t('error_generic', userLang));
          }

          return reply(t('done_assign', userLang, { task: pendingAction.task_summary, partner: pendingAction.target_name }));
        } else if (pendingAction?.type === 'set_due_date') {
          await supabase
            .from('clerk_notes')
            .update({
              due_date: pendingAction.date,
              updated_at: new Date().toISOString()
            })
            .eq('id', pendingAction.task_id);

          // Note: pendingAction.readable was localized at offer time (set_due
          // case localizes via parseNaturalDate / formatFriendlyDate using
          // userLang). It's already in the right language here.
          return reply(t('done_set_due', userLang, { task: pendingAction.task_summary, when: pendingAction.readable }));
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

          return reply(t('done_set_reminder', userLang, { task: pendingAction.task_summary, when: pendingAction.readable }));
        } else if (pendingAction?.type === 'delete') {
          await supabase
            .from('clerk_notes')
            .delete()
            .eq('id', pendingAction.task_id);

          return reply(t('done_delete', userLang, { task: pendingAction.task_summary }));
        } else if (pendingAction?.type === 'merge') {
          const { data: mergeResult, error: mergeError } = await supabase.rpc('merge_notes', {
            p_source_id: pendingAction.source_id,
            p_target_id: pendingAction.target_id
          });

          if (mergeError) {
            console.error('Error merging notes:', mergeError);
            return reply(t('error_generic', userLang));
          }

          return reply(t('done_merge', userLang, { target: pendingAction.target_summary }));
        }

        return reply(t('error_generic', userLang));
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
      // PR4 / Block C — PRIORITY 0: if the user QUOTED a specific reminder
      // and replied "fatto" / "done" / etc., honor the quote directly
      // instead of guessing from "most recent reminder". Critical when
      // multiple reminders fired in close succession.
      if (quotedTaskCtx?.task_id) {
        const { data: quotedTask, error: qErr } = await supabase
          .from('clerk_notes')
          .select('id, summary, completed')
          .eq('id', quotedTaskCtx.task_id)
          .single();
        if (!qErr && quotedTask && !quotedTask.completed) {
          const { error } = await supabase
            .from('clerk_notes')
            .update({ completed: true, updated_at: new Date().toISOString() })
            .eq('id', quotedTask.id);
          if (!error) {
            console.log('[Context] Bare reply via quoted-message context:', quotedTask.summary);
            return reply(t('context_completed', userLang, { task: quotedTask.summary }));
          }
        }
      }

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
          const foundTask = await semanticTaskSearch(supabase, userId, coupleId, extractedTask, generateEmbedding);

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
          const foundTask = await semanticTaskSearch(supabase, userId, coupleId, extractedTask, generateEmbedding);
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
              language: userLang,
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
          const categResult = await callAI(categorizationPrompt, parsedExpense.description, 0.3, "lite", tracker, WA_EXPENSE_CATEGORIZATION_PROMPT_VERSION);
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

    // ========================================================================
    // Phase 2 Task 2-A: Pending-question early path
    // ------------------------------------------------------------------------
    // If Olive has an unanswered question for this user (currently only
    // contradiction_resolve), try to interpret this message as the answer.
    // - Resolved → send confirmation, return (done).
    // - Not classified → leave question open, fall through to normal routing.
    // - No media messages: attachments aren't answers to A/B questions.
    // ========================================================================
    if (messageBody && messageBody.trim().length > 0 && mediaUrls.length === 0) {
      try {
        const {
          findActivePendingQuestion,
          tryResolvePendingQuestion,
          formatResolutionConfirmation,
        } = await import("../_shared/contradiction-resolver.ts");

        const pending = await findActivePendingQuestion(supabase, userId, 'whatsapp');
        if (pending) {
          console.log(
            `[PendingQuestion] Found pending ${pending.question_type} (id=${pending.id}, ` +
            `asked ${Math.round((Date.now() - new Date(pending.asked_at).getTime()) / 60000)}m ago)`
          );
          const outcome = await tryResolvePendingQuestion(supabase, pending, messageBody);
          if (outcome.resolved) {
            const confirmation = formatResolutionConfirmation(
              outcome.decision,
              pending.payload as any
            );
            console.log(
              `[PendingQuestion] Resolved: winner=${outcome.decision.winner} ` +
              `applied=${outcome.applied} reason=${outcome.reason || 'ok'}`
            );
            await reply(confirmation);
            return new Response(JSON.stringify({ ok: true, resolved_pending: true }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          console.log(
            `[PendingQuestion] Not classified (${outcome.reason}) — falling through to normal routing; ` +
            `question stays open until expiry`
          );
        }
      } catch (pendingErr) {
        console.warn(
          '[PendingQuestion] early-path error (non-blocking):',
          pendingErr instanceof Error ? pendingErr.message : pendingErr
        );
      }
    }

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
    // Pass hasMedia flag for Pro escalation on image/video messages
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

      // Phase 1 Task 1-E: Per-intent confidence floor for destructive actions.
      // If the classifier says "delete/complete/set_due/..." but below the
      // floor, redirect to CHAT (assistant) so Olive asks for confirmation
      // instead of silently executing.
      const { checkConfidenceFloor } = await import("../_shared/model-router.ts");
      const floorCheck = checkConfidenceFloor(aiResult.intent, aiResult.confidence);
      if (!floorCheck.passes) {
        console.log(`[Confidence Floor] ⚠️ ${floorCheck.reason} — redirecting to CHAT (assistant) for clarification`);
        intentResult = {
          ...intentResult,
          intent: 'CHAT',
          chatType: 'assistant',
          // Preserve what the AI thought so the clarification prompt can reference it.
          _belowFloorIntent: aiResult.intent,
          _belowFloorTarget: aiResult.target_task_name || undefined,
          _belowFloorConfidence: aiResult.confidence,
          _belowFloorRequired: floorCheck.floor,
        } as any;
      }
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
    // POST-CLASSIFICATION SAFETY NET #1.4: Honor pending offers (Capture → Offer → Confirm → Execute)
    // When Olive's previous turn ended with a save offer ("Want me to save this?"),
    // a short affirm reply ("yes please", "sì", "do it") MUST resolve to that offer
    // rather than fall through to CHAT and trigger a confused clarification turn.
    // This is the structural fix for the brand contract: Olive proposes, user confirms,
    // Olive executes — never a clarification round-trip on a clear yes/no.
    // ========================================================================
    if (messageBody) {
      const sessionCtxOffer = (session.context_data || {}) as ConversationContext;
      const offer = sessionCtxOffer.pending_offer;
      if (isPendingOfferFresh(offer)) {
        const confirmation = classifyConfirmationReply(messageBody);
        if (confirmation === 'affirm' && offer.type === 'save_artifact') {
          console.log(`[SafetyNet#1.4] Pending save_artifact offer + affirm reply ("${messageBody.substring(0, 40)}") → SAVE_ARTIFACT`);
          intentResult = {
            intent: 'SAVE_ARTIFACT' as any,
            cleanMessage: messageBody,
          } as any;
        } else if (confirmation === 'deny' && offer.type === 'save_artifact') {
          console.log(`[SafetyNet#1.4] Pending save_artifact offer + deny reply → declining offer`);
          // Clear the offer so it can't be revived by accident, then send a brief ack.
          try {
            await supabase
              .from('user_sessions')
              .update({
                context_data: { ...sessionCtxOffer, pending_offer: null },
                updated_at: new Date().toISOString(),
              })
              .eq('id', session.id);
          } catch (clearErr) {
            console.warn('[SafetyNet#1.4] Failed to clear pending_offer on deny (non-critical):', clearErr);
          }
          return reply(t('artifact_offer_declined', userLang));
        }
        // No match → fall through. The offer stays alive until TTL or next save offer
        // overwrites it; meanwhile the message is classified normally.
      }
    }

    // ========================================================================
    // POST-CLASSIFICATION SAFETY NET #1.5: "Save this" / "Save it as a note"
    // If the user asks to save something and Olive recently produced an assistant
    // output (email draft, plan, etc.), override to SAVE_ARTIFACT intent.
    // ========================================================================
    if (messageBody) {
      const msgLower = messageBody.toLowerCase();
      // Comprehensive multilingual "save this" detection
      const saveArtifactPatterns = /\b(save\s+(?:this|it|that)(?:\s+(?:as|in|to|for)\s+\w+)?|keep\s+(?:this|it|that)(?:\s+for\s+(?:me|later))?|salva(?:lo|la|melo|re\s+(?:questo|questa|tutto))?|guarda(?:lo|la|melo)?|metti(?:lo|la|melo)?\s+(?:nelle?\s+note|nei?\s+task|nelle?\s+attività|nella\s+lista)|aggiungi(?:lo|la|melo)?\s+(?:alle?\s+note|ai?\s+task|alla\s+lista)|save\s+(?:as|in|to)\s+(?:a\s+)?(?:note|task|list|my\s+list|notes)|add\s+(?:this|it|that)\s+(?:to|as|in)\s+(?:a\s+)?(?:note|task|list|my\s+list|notes)|guárdalo|guárdamelo|añade(?:lo)?\s+(?:a|como|en)\s+(?:mis?\s+)?(?:notas?|tareas?|lista)|guardar(?:lo)?\s+(?:como|en)\s+(?:una?\s+)?(?:nota|tarea|lista))\b/i.test(msgLower);

      if (saveArtifactPatterns) {
        const sessionCtxSave = (session.context_data || {}) as ConversationContext;
        const hasRecentOutput = sessionCtxSave.last_assistant_output &&
          sessionCtxSave.last_assistant_output_at &&
          (Date.now() - new Date(sessionCtxSave.last_assistant_output_at).getTime()) < 30 * 60 * 1000; // 30 min window
        
        if (hasRecentOutput) {
          console.log(`[SafetyNet#1.5] Overriding ${intentResult.intent} → SAVE_ARTIFACT — user wants to save recent assistant output`);
          intentResult = {
            intent: 'SAVE_ARTIFACT' as any,
            cleanMessage: messageBody,
          } as any;
        }
      }
    }

    // ========================================================================
    // POST-CLASSIFICATION SAFETY NET #1.6: Help/How-to about Olive features
    // If the user is asking HOW to use Olive (not asking Olive to DO something),
    // override to CHAT with chatType 'help_about_olive' for contextual help.
    // ========================================================================
    if (messageBody && !['SAVE_ARTIFACT'].includes(intentResult.intent)) {
      const msgLower = messageBody.toLowerCase();
      const isOliveHelpQuestion = /\b(how\s+(?:do\s+i|can\s+i|to)\s+(?:use|connect|invite|create|add|set|change|export|link|share|assign|delete|complete|track|sync|make|find|search|configure|setup|manage|enable|disable)|come\s+(?:faccio|posso|si\s+fa)\s+(?:a|per)\s+|como\s+(?:hago|puedo|se\s+hace)\s+(?:para|a)\s+|what\s+(?:is|are|does|can)\s+(?:olive|my\s+day|background\s+agents?|lists?|memories|skills|shortcuts)|che\s+cos[''']?[èe]\s+|qué\s+(?:es|son|hace)\s+|how\s+does\s+(?:olive|the\s+(?:app|calendar|expense|whatsapp|sharing|privacy|reminder|list)))\b/i.test(msgLower);
      
      // Also catch direct feature questions
      const isFeatureQuestion = /\b(how\s+(?:do|does|can)\s+(?:i|olive|it|this|the)\b.{0,40}\b(?:work|function|operate)|what\s+(?:features?|can\s+olive|commands?|shortcuts?)|show\s+me\s+(?:how|what)|explain\s+(?:how|what)|tell\s+me\s+(?:how|about)\s+(?:olive|the\s+app|features?))\b/i.test(msgLower);
      
      if (isOliveHelpQuestion || isFeatureQuestion) {
        console.log(`[SafetyNet#1.6] Overriding ${intentResult.intent} → CHAT (help_about_olive) — user asking about Olive features`);
        intentResult = { ...intentResult, intent: 'CHAT', chatType: 'help_about_olive' } as any;
      }
    }

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
    // SAVE MEMORY HANDLER — via shared action executor
    // ========================================================================
    if (intent === 'SAVE_MEMORY' && aiResult && aiResult.confidence >= 0.5) {
      try {
        const { executeAction } = await import("../_shared/action-executor.ts");
        const memResult = await executeAction(supabase, aiResult, userId, coupleId, messageBody);
        if (memResult?.success) {
          return reply(t('memory_saved', userLang, { content: memResult.details?.saved || messageBody?.substring(0, 80) || '' }));
        }
      } catch (memErr) {
        console.error('[SaveMemory] Error:', memErr);
      }
      // If save_memory failed, fall through to CREATE as fallback
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
        return reply(t('merge_no_recent', userLang));
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
        return reply(t('merge_no_similar', userLang, { task: sourceNote.summary }));
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

      return reply(t('confirm_merge', userLang, { source: sourceNote.summary, target: targetNote.summary }));
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
        // ── Fix 7: targeted list fetch (do NOT rely on the 100-recency window) ──
        // The outer `tasks` array is `LIMIT 100 ORDER BY created_at DESC`. Heavy users
        // (hundreds of notes spanning months) have lists like "Books" whose items are
        // older than the 100-most-recent slice — those items get filtered out and the
        // user sees "Your Books list is empty!" even though the list has 12 items.
        // Solution: when we have a specific list, fetch its contents directly with no
        // recency cap, scoped by user/couple to respect RLS-equivalent visibility.
        const { data: listTasksDirect } = await supabase
          .from('clerk_notes')
          .select('id, summary, due_date, completed, priority, category, list_id, items, task_owner, original_text')
          .eq('list_id', specificList)
          .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
          .order('created_at', { ascending: false });

        const allListTasks = listTasksDirect || [];
        const relevantTasks = allListTasks.filter(t => !t.completed);
        const completedInList = allListTasks.filter(t => t.completed);

        console.log('[WhatsApp/SEARCH] Targeted list fetch:', matchedListName, '→', allListTasks.length, 'total |', relevantTasks.length, 'active');

        if (relevantTasks.length === 0) {
          const emptyMsg = completedInList.length > 0
            ? `Your ${matchedListName} list is all done! ✅ (${completedInList.length} completed item${completedInList.length > 1 ? 's' : ''})`
            : `Your ${matchedListName} list is empty! 🎉`;
          return reply(emptyMsg);
        }

        // PR6 — rename loop var (was `t`, shadowing the t() translation
        // function so we couldn't call t() inside the callback) and
        // wire the localized "Due:" label.
        const itemsList = relevantTasks.map((task, i) => {
          const items = task.items && task.items.length > 0 ? `\n  ${task.items.join('\n  ')}` : '';
          const priority = task.priority === 'high' ? ' 🔥' : '';
          const dueInfo = task.due_date
            ? t('label_task_due_paren', userLang, { date: formatFriendlyDate(task.due_date, true, profile.timezone, userLang) })
            : '';
          return `${i + 1}. ${task.summary}${priority}${dueInfo}${items}`;
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
      const userTimezone = profile.timezone || 'UTC';
      const todayWindow = getRelativeDayWindowUtc(now, userTimezone, 0);
      const tomorrowWindow = getRelativeDayWindowUtc(now, userTimezone, 1);
      
      const dueTodayTasks = activeTasks.filter(t => {
        return isInUtcRange(t.due_date, todayWindow.start, todayWindow.end);
      });
      
      const overdueTasks = activeTasks.filter(t => {
        return isBeforeUtc(t.due_date, todayWindow.start);
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
        
        // PR6 — rename `t` → `task` so we can call t() inside the callback.
        const urgentList = urgentTasks.slice(0, 8).map((task, i) => {
          const dueInfo = task.due_date
            ? t('label_task_due_paren', userLang, { date: formatFriendlyDate(task.due_date, true, profile.timezone, userLang) })
            : '';
          return `${i + 1}. ${task.summary}${dueInfo}`;
        }).join('\n');
        
        const moreText = urgentTasks.length > 8 ? `\n\n...and ${urgentTasks.length - 8} more urgent tasks` : '';
        
        const urgentResponse = `🔥 ${urgentTasks.length} Urgent Task${urgentTasks.length === 1 ? '' : 's'}:\n\n${urgentList}${moreText}\n\n🔗 Manage: https://witholive.app`;
        const displayedUrgent = urgentTasks.slice(0, 8);
        await saveReferencedEntity(displayedUrgent[0], urgentResponse, displayedUrgent.map(t => ({ id: t.id, summary: t.summary })));
        return reply(urgentResponse);
      }
      
      if (queryType === 'today') {
        // Fetch today's calendar events (matching the pattern used in 'tomorrow' and 'this_week')
        let todayCalendarEvents: string[] = [];
        try {
          const { data: calConnections } = await supabase
            .from('calendar_connections')
            .select('id')
            .eq('user_id', userId)
            .eq('is_active', true);
          
          if (calConnections && calConnections.length > 0) {
            const connIds = calConnections.map(c => c.id);
            const { data: events } = await supabase
              .from('calendar_events')
              .select('title, start_time, all_day')
              .in('connection_id', connIds)
              .gte('start_time', todayWindow.start.toISOString())
              .lt('start_time', todayWindow.end.toISOString())
              .order('start_time', { ascending: true })
              .limit(10);
            
            todayCalendarEvents = (events || []).map(e => {
              if (e.all_day) return `• ${e.title} (all day)`;
              const time = formatTimeForZone(e.start_time, userTimezone);
              return `• ${time}: ${e.title}`;
            });
          }
        } catch (calErr) {
          console.warn('[WhatsApp] Calendar fetch error for today:', calErr);
        }
        
        if (dueTodayTasks.length === 0 && todayCalendarEvents.length === 0) {
          return reply('📅 Nothing due today! You\'re all caught up.\n\n💡 Try "what\'s urgent" to see high-priority tasks');
        }
        
        let response = `📅 Today's Agenda:\n`;
        
        if (todayCalendarEvents.length > 0) {
          response += `\n🗓️ Calendar (${todayCalendarEvents.length}):\n${todayCalendarEvents.join('\n')}\n`;
        }
        
        if (dueTodayTasks.length > 0) {
          const todayList = dueTodayTasks.slice(0, 8).map((t, i) => {
            const priority = t.priority === 'high' ? ' 🔥' : '';
            return `${i + 1}. ${t.summary}${priority}`;
          }).join('\n');
          const moreText = dueTodayTasks.length > 8 ? `\n...and ${dueTodayTasks.length - 8} more` : '';
          response += `\n📋 Tasks Due (${dueTodayTasks.length}):\n${todayList}${moreText}\n`;
        }
        
        if (overdueTasks.length > 0) {
          response += `\n⚠️ Also: ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''} to catch up on`;
        }
        
        response += '\n\n🔗 Manage: https://witholive.app';
        
        const displayedToday = dueTodayTasks.slice(0, 8);
        if (displayedToday.length > 0) {
          await saveReferencedEntity(displayedToday[0], response, displayedToday.map(t => ({ id: t.id, summary: t.summary })));
        }
        return reply(response);
      }
      
      if (queryType === 'tomorrow') {
        const dueTomorrowTasks = activeTasks.filter(t => {
          return isInUtcRange(t.due_date, tomorrowWindow.start, tomorrowWindow.end);
        });
        
        let tomorrowCalendarEvents: string[] = [];
        try {
          const { data: calConnections } = await supabase
            .from('calendar_connections')
            .select('id')
            .eq('user_id', userId)
            .eq('is_active', true);
          
          if (calConnections && calConnections.length > 0) {
            const connIds = calConnections.map(c => c.id);
            const { data: events } = await supabase
              .from('calendar_events')
              .select('title, start_time, all_day')
              .in('connection_id', connIds)
              .gte('start_time', tomorrowWindow.start.toISOString())
              .lt('start_time', tomorrowWindow.end.toISOString())
              .order('start_time', { ascending: true })
              .limit(10);
            
            tomorrowCalendarEvents = (events || []).map(e => {
              if (e.all_day) return `• ${e.title} (all day)`;
              const time = formatTimeForZone(e.start_time, userTimezone);
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
        const endOfWeek = getNextWeekBoundaryUtc(now, userTimezone);
        
        const dueThisWeekTasks = activeTasks.filter(t => {
          return isInUtcRange(t.due_date, todayWindow.start, endOfWeek);
        });
        
        let weekCalendarEvents: string[] = [];
        try {
          const { data: calConnections } = await supabase
            .from('calendar_connections')
            .select('id')
            .eq('user_id', userId)
            .eq('is_active', true);
          
          if (calConnections && calConnections.length > 0) {
            const connIds = calConnections.map(c => c.id);
            const { data: events } = await supabase
              .from('calendar_events')
              .select('title, start_time, all_day')
              .in('connection_id', connIds)
              .gte('start_time', todayWindow.start.toISOString())
              .lt('start_time', endOfWeek.toISOString())
              .order('start_time', { ascending: true })
              .limit(15);
            
            weekCalendarEvents = (events || []).map(e => {
              const dayName = formatDateForZone(e.start_time, userTimezone, { weekday: 'short' });
              if (e.all_day) return `• ${dayName}: ${e.title} (all day)`;
              const time = formatTimeForZone(e.start_time, userTimezone);
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
          // PR6 — rename `t` → `task` (shadowing fix) + pass userLang to
          // formatter so the date string itself ("Friday, May 4th" vs
          // "venerdì 4 maggio" vs "viernes 4 de mayo") matches the user's
          // locale. No "Due:" label here — date already inside parens.
          const weekList = dueThisWeekTasks.slice(0, 10).map((task, i) => {
            const priority = task.priority === 'high' ? ' 🔥' : '';
            const dueDate = task.due_date ? formatFriendlyDate(task.due_date, false, profile.timezone, userLang) : '';
            return `${i + 1}. ${task.summary}${priority}${dueDate ? ` (${dueDate})` : ''}`;
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
          const dueDate = parseStoredTimestamp(t.due_date);
          const daysOverdue = dueDate
            ? Math.max(1, Math.floor((todayWindow.start.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000)))
            : 1;
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
      const dashboardQueryTypes = new Set(['urgent', 'today', 'tomorrow', 'this_week', 'overdue', 'recent']);

      // Escalate any content question that did not match a dashboard slot to CONTEXTUAL_ASK.
      // Previously gated on queryType === 'general', which silently dropped questions when the
      // classifier set queryType to null/undefined or any non-dashboard value — leading to
      // generic dashboard summaries for content questions like "What's my Waymo discount code?".
      if (isContentQuestion && !dashboardQueryTypes.has(queryType as string)) {
        console.log('[WhatsApp] SEARCH escalating to CONTEXTUAL_ASK — question detected:', effectiveMessage?.substring(0, 60), 'queryType:', queryType);
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

      // Task resolution priority (PR4):
      //   0a. Quoted-message context (the user EXPLICITLY pointed at a previous Olive reply)
      //   0b. Relative reference ("last task", "the latest one")
      //   0c. Ordinal ("the first one", "#3") — see below
      //   1.  AI-supplied UUID
      //   2.  Semantic search
      //   3.  Session context / outbound context
      let foundTask: any = null;

      // 0a. QUOTED-MESSAGE RESOLUTION (HIGHEST priority).
      // If the user's inbound carried `context.id` (WhatsApp "reply to"
      // / quote a previous message), we already pre-resolved which task
      // that message was about in `quotedTaskCtx`. Use it directly —
      // this is strictly more reliable than any heuristic below.
      if (quotedTaskCtx?.task_id) {
        const { data: quotedTask } = await supabase
          .from('clerk_notes')
          .select('id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time')
          .eq('id', quotedTaskCtx.task_id)
          .maybeSingle();
        if (quotedTask) {
          foundTask = quotedTask;
          console.log('[TASK_ACTION] Resolved via quoted-message context:', quotedTask.summary);
        } else {
          console.warn(
            '[TASK_ACTION] Quoted task_id', quotedTaskCtx.task_id,
            'no longer in DB — falling back to other resolution paths',
          );
        }
      }

      // 0b. RELATIVE REFERENCE RESOLUTION: "last task", "the latest one", "previous task", etc.
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
        const candidates = await semanticTaskSearchMulti(supabase, userId, coupleId, actionTarget, generateEmbedding, 5);
        
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
            const contextTask = await semanticTaskSearch(supabase, userId, coupleId, extracted, generateEmbedding);
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
              language: userLang,
            }
          });

          if (processError) {
            console.error('[TASK_ACTION] process-note error:', processError);
            return reply(t('error_generic', userLang));
          }

          // Parse the reminder date from the original message
          const reminderExpr = effectiveMessage || messageBody || '';
          const parsed = parseNaturalDate(reminderExpr, profile.timezone || 'America/New_York', userLang);
          
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
          const friendlyDate = reminderTime
            ? formatFriendlyDate(reminderTime, true, userTz, userLang)
            : eventDueDate
              ? formatFriendlyDate(eventDueDate, true, userTz, userLang)
              : parseNaturalDate('tomorrow', userTz, userLang).readable;

          const confirmationMessage = [
            t('note_saved', userLang, { summary: insertedNote.summary }),
            t('note_added_to', userLang, { list: listName }),
            t('note_reminder_set', userLang, { date: friendlyDate }),
            ``,
            t('note_manage', userLang),
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
          const userTz = profile.timezone || 'America/New_York';
          const parsed = parseNaturalDate(dateExpr, userTz, userLang);

          // PR4 / Block C — `extractTimeOnly` is now in
          // `_shared/time-only-parser.ts` so it's unit-testable.
          // Handle time-only updates: "fai alle 8" / "change it to 7 AM"
          // → keep existing date, update time-of-day in user's timezone.
          //
          // PR4 fix: previously used `existingDate.setUTCHours(...)` which
          // sets the UTC hour, so for a Rome user typing "alle 8" the
          // reminder landed at 08:00 UTC = 10:00 Rome (or worse, 09:00
          // depending on DST). New flow: get the date's parts in the
          // user's timezone, replace just hour/minute, then convert
          // back to UTC via toUtcFromLocalParts which is DST-safe.
          if (!parsed.date && foundTask.due_date) {
            const t = extractTimeOnly(dateExpr);
            if (t) {
              const existingDate = new Date(foundTask.due_date);
              const localParts = getTimeZoneParts(existingDate, userTz);
              const newDate = toUtcFromLocalParts(
                { ...localParts, hour: t.hours, minute: t.minutes, second: 0 },
                userTz,
              );
              parsed.date = newDate.toISOString();
              parsed.readable = formatFriendlyDate(parsed.date, true, userTz, userLang);
              console.log(
                '[Context] Time-only update: keeping date, setting time to',
                `${t.hours.toString().padStart(2, '0')}:${t.minutes.toString().padStart(2, '0')}`,
                `(${userTz})`,
              );
            }
          }

          // If still no date and no existing due_date, try using today + parsed time
          // (also TZ-aware — same fix as the existing-date branch).
          if (!parsed.date) {
            const t = extractTimeOnly(dateExpr);
            if (t) {
              const todayLocal = getTimeZoneParts(new Date(), userTz);
              const newDate = toUtcFromLocalParts(
                { ...todayLocal, hour: t.hours, minute: t.minutes, second: 0 },
                userTz,
              );
              parsed.date = newDate.toISOString();
              parsed.readable = formatFriendlyDate(parsed.date, true, userTz, userLang);
              console.log(
                '[Context] Time-only update: using today with time',
                `${t.hours.toString().padStart(2, '0')}:${t.minutes.toString().padStart(2, '0')}`,
                `(${userTz})`,
              );
            }
          }

          if (!parsed.date) {
            return reply(t('date_unparseable', userLang, { expr: dateExpr }));
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

          return reply(t('confirm_set_due', userLang, { task: foundTask.summary, when: parsed.readable }));
        }
        
        case 'assign': {
          if (!coupleId) {
            return reply(t('partner_no_space', userLang));
          }

          const { data: partnerMember } = await supabase
            .from('clerk_couple_members')
            .select('user_id')
            .eq('couple_id', coupleId)
            .neq('user_id', userId)
            .limit(1)
            .single();

          if (!partnerMember) {
            return reply(t('partner_no_space', userLang));
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

          return reply(t('confirm_assign', userLang, { task: foundTask.summary, partner: partnerName }));
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

          return reply(t('confirm_delete', userLang, { task: foundTask.summary }));
        }
        
        case 'move': {
          const targetListName = (effectiveMessage || '').trim();

          if (!targetListName) {
            return reply(t('move_need_list_name', userLang));
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
          
          return reply(t('move_failed', userLang));
        }

        case 'remind': {
          // Use the due_date_expression (cleanMessage/effectiveMessage) for time, NOT the task name (actionTarget)
          const reminderExpr = effectiveMessage || actionTarget || messageBody || '';
          console.log('[remind] reminderExpr:', reminderExpr, '| actionTarget:', actionTarget, '| effectiveMessage:', effectiveMessage);
          const parsed = parseNaturalDate(reminderExpr, profile.timezone || 'America/New_York', userLang);
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

            return reply(t('confirm_set_reminder', userLang, { task: foundTask.summary, when: parsed.readable }));
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
              smartReadable = t('smart_reminder_30min', userLang);
            } else if (hoursUntilDue <= 24) {
              // Due today: remind 2 hours before
              smartReminderDate = new Date(taskDueDate.getTime() - 2 * 60 * 60 * 1000);
              smartReadable = t('smart_reminder_2h_before', userLang);
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
                smartReadable = t('smart_reminder_evening_morning', userLang);
              } else {
                smartReadable = t('smart_reminder_morning_of', userLang);
              }
            }
          } else {
            // No due date: default to tomorrow 9am
            smartReminderDate = new Date();
            smartReminderDate.setDate(smartReminderDate.getDate() + 1);
            smartReminderDate.setHours(9, 0, 0, 0);
            smartReadable = t('smart_reminder_tomorrow_9am', userLang);
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

          return reply(t('confirm_set_reminder', userLang, { task: foundTask.summary, when: smartReadable }));
        }

        default:
          return reply(t('task_action_unknown', userLang));
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
        const categResult = await callAI(categorizationPrompt, parsedExpense.description, 0.3, "lite", tracker, WA_EXPENSE_CATEGORIZATION_PROMPT_VERSION);
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
    if (intent === 'CONTEXTUAL_ASK' || intent === 'WEB_RESEARCH' || intent === 'SCHEDULE_CALENDAR') {
      console.log(`[WhatsApp] Processing ${intent} for:`, effectiveMessage?.substring(0, 50));
      
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
        const userTimezone = profile.timezone || 'UTC';
        const { data: calConnections } = await supabase
          .from('calendar_connections')
          .select('id')
          .eq('user_id', userId)
          .eq('is_active', true);
        
        if (calConnections && calConnections.length > 0) {
          const connIds = calConnections.map(c => c.id);
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
          
          if (calEvents && calEvents.length > 0) {
            calendarContext = '\n## UPCOMING CALENDAR EVENTS:\n';
            calEvents.forEach(ev => {
              const eventTimeZone = ev.timezone || userTimezone;
              const dayStr = formatDateForZone(ev.start_time, eventTimeZone, { weekday: 'long', month: 'long', day: 'numeric' });
              const timeStr = ev.all_day ? 'All day' : formatTimeForZone(ev.start_time, eventTimeZone);
              const endStr = ev.end_time && !ev.all_day ? ` - ${formatTimeForZone(ev.end_time, eventTimeZone)}` : '';
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

      // ---- Fix 3: Anchor on the named list when the user references one ----
      // Use the same matcher as SEARCH (singularize + normalize + AI hint priority).
      // This guarantees that "What's in my book list?" anchors on the user's
      // "Books" list even if their book titles never contain the word "book".
      let anchoredListMatch: { listId: string; listName: string; matchedVia: string } | null = null;
      try {
        const { findUserList } = await import("../_shared/list-matcher.ts");
        const aiListNameHint = (intentResult as any)._listName as string | undefined;
        anchoredListMatch = findUserList(
          effectiveMessage || '',
          (lists || []).map(l => ({ id: l.id, name: l.name as string, description: (l as any).description })),
          aiListNameHint,
        );
        if (anchoredListMatch) {
          console.log('[CONTEXTUAL_ASK] Anchored on list:', anchoredListMatch.listName, 'via:', anchoredListMatch.matchedVia);
        }
      } catch (matcherErr) {
        console.warn('[CONTEXTUAL_ASK] list-matcher import failed (non-blocking):', matcherErr);
      }

      // ---- Fix 4: Semantic retrieval via embeddings ----
      // The word-overlap scorer below is brittle: "What's my Waymo discount code?" works
      // because notes contain the word "waymo", but "What's the address of the place
      // Maria mentioned?" misses entirely. Add embedding similarity as a parallel signal.
      // The find_similar_notes RPC already exists (used by dedup at line ~6286), and
      // clerk_notes.embedding is populated on insert. This is purely additive.
      const semanticHits = new Map<string, number>(); // task_id -> similarity score
      try {
        const queryEmbedding = await generateEmbedding(effectiveMessage || '');
        if (queryEmbedding) {
          const { data: vectorMatches } = await supabase.rpc('find_similar_notes', {
            p_user_id: userId,
            p_couple_id: coupleId,
            p_query_embedding: JSON.stringify(queryEmbedding),
            p_threshold: 0.55,
            p_limit: 8,
          });
          if (vectorMatches && Array.isArray(vectorMatches)) {
            for (const m of vectorMatches as Array<{ id: string; similarity: number }>) {
              semanticHits.set(m.id, m.similarity);
            }
            console.log('[CONTEXTUAL_ASK] Semantic retrieval found', semanticHits.size, 'matches');
          }
        }
      } catch (vecErr) {
        // Non-blocking — fall back to word-overlap scoring alone
        console.warn('[CONTEXTUAL_ASK] Semantic retrieval failed (non-blocking):', vecErr);
      }

      // ---- Smart relevance: find items most relevant to the question ----
      const questionLower = (effectiveMessage || '').toLowerCase();
      const questionWords = questionLower.split(/\s+/).filter(w => w.length > 2);

      // Score each task by relevance to the question (combines: word overlap +
      // semantic similarity + anchored list boost). Each signal contributes
      // independently, so a hit on any one is enough to surface the item.
      const scoredTasks = (allTasks || []).map(task => {
        const summaryLower = task.summary.toLowerCase();
        const originalLower = (task.original_text || '').toLowerCase();
        const combined = `${summaryLower} ${originalLower}`;

        let score = 0;
        questionWords.forEach(w => {
          if (combined.includes(w)) score += 1;
          if (summaryLower.includes(w)) score += 1; // bonus for summary match
        });
        // Semantic similarity contribution (Fix 4): scale 0.55–1.0 → 2–5 points.
        // Threshold 0.55 → 2 pts (just above relevant cutoff), 1.0 → 5 pts.
        const sim = semanticHits.get(task.id);
        if (typeof sim === 'number' && sim >= 0.55) {
          score += Math.round(2 + (sim - 0.55) * (3 / 0.45));
        }
        // Boost: items in the anchored list win, regardless of word overlap.
        // This is the structural fix for "book list" failures — the user's
        // saved books may not contain the word "book", but they *are* in the
        // Books list, and that's what the user asked about.
        if (anchoredListMatch && task.list_id === anchoredListMatch.listId) {
          score += 5;
        }
        return { ...task, relevanceScore: score };
      });

      // Separate highly relevant items (show full detail) from the rest (show summary only)
      const relevantTasks = scoredTasks.filter(t => t.relevanceScore >= 2).sort((a, b) => b.relevanceScore - a.relevanceScore);
      const otherTasks = scoredTasks.filter(t => t.relevanceScore < 2);

      // Build context: FULL DETAILS for relevant items
      let savedItemsContext = '';

      // ---- Fix 3 (cont.) + Fix 8: Inject the anchored list at the TOP of context ----
      // The LLM now sees a clearly labeled section with the exact list the user
      // asked about — full contents, no truncation, before any scoring noise.
      //
      // Fix 8: targeted list fetch. The outer `allTasks` is `LIMIT 200 ORDER BY
      // created_at DESC`. Heavy users (hundreds of notes spanning months) have lists
      // like "Books" whose items predate the 200-recency window — those items get
      // dropped, the section comes out empty, and the LLM correctly says "I don't
      // have that yet" per the OLIVE_IDENTITY_RULES. Fetch the list directly here
      // with no recency cap, scoped to user/couple.
      if (anchoredListMatch) {
        const { data: listTasksDirect } = await supabase
          .from('clerk_notes')
          .select('id, summary, original_text, due_date, completed, priority, items, reminder_time, created_at')
          .eq('list_id', anchoredListMatch.listId)
          .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
          .order('created_at', { ascending: false });

        const listTasks = listTasksDirect || [];
        const activeListTasks = listTasks.filter(t => !t.completed);
        const completedListTasks = listTasks.filter(t => t.completed);
        console.log('[CONTEXTUAL_ASK] Targeted list fetch:', anchoredListMatch.listName, '→', listTasks.length, 'total |', activeListTasks.length, 'active');

        savedItemsContext += `\n## YOU ASKED ABOUT THE "${anchoredListMatch.listName}" LIST (${activeListTasks.length} active, ${completedListTasks.length} completed):\n`;
        if (activeListTasks.length === 0 && completedListTasks.length === 0) {
          savedItemsContext += `(this list exists but has no items yet)\n`;
        } else {
          activeListTasks.forEach((task, idx) => {
            // PR6: pass userLang so the date string itself is in the
            // user's locale. Labels (Due:) stay English here because
            // the surrounding text is an AI prompt, not user-facing.
            const dueInfo = task.due_date ? ` | Due: ${formatFriendlyDate(task.due_date, true, profile.timezone, userLang)}` : '';
            savedItemsContext += `\n${idx + 1}. ○ ${task.summary}${dueInfo}\n`;
            if (task.original_text && task.original_text !== task.summary) {
              savedItemsContext += `   Full details: ${task.original_text.substring(0, 800)}\n`;
            }
            if (task.items && task.items.length > 0) {
              task.items.forEach((item: string) => {
                savedItemsContext += `   • ${item}\n`;
              });
            }
          });
          if (completedListTasks.length > 0 && completedListTasks.length <= 5) {
            savedItemsContext += `\nCompleted items: ${completedListTasks.map(t => t.summary).join(', ')}\n`;
          }
        }
      }

      if (relevantTasks.length > 0) {
        savedItemsContext += '\n## MOST RELEVANT SAVED ITEMS (full details):\n';
        relevantTasks.slice(0, 10).forEach(task => {
          const listName = task.list_id && listIdToName.has(task.list_id) ? listIdToName.get(task.list_id) : task.category;
          const status = task.completed ? '✓' : '○';
          // PR6: pass userLang to formatter (AI prompt context).
          const dueInfo = task.due_date ? ` | Due: ${formatFriendlyDate(task.due_date, true, profile.timezone, userLang)}` : '';
          const reminderInfo = task.reminder_time ? ` | Reminder: ${formatFriendlyDate(task.reminder_time, true, profile.timezone, userLang)}` : '';
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
          const dueInfo = task.due_date ? ` (Due: ${formatFriendlyDate(task.due_date, true, profile.timezone, userLang)})` : '';
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

      // ── HYBRID DETECTION: Is this a general knowledge question? ──
      // If so, supplement with Perplexity web search results
      const msgLowerForHybrid = (effectiveMessage || '').toLowerCase();
      const isGeneralKnowledgeQ = (
        // "What are the best X" patterns
        /\b(what\s+(?:are|is)\s+the\s+(?:best|top|most|greatest|nicest|popular|famous|recommended)|best\s+(?:cities|restaurants?|hotels?|places?|things?|activities|spots?|bars?|cafes?|neighborhoods?|beaches?|parks?|museums?|shops?|attractions?|destinations?)|top\s+\d+|recommend\s+(?:a|some|me)|where\s+(?:should|can|do)\s+(?:i|we)\s+(?:go|visit|eat|stay|travel|explore)|what\s+(?:should|can|do)\s+(?:i|we)\s+(?:do|see|visit|try|eat|cook|watch|read|buy)\s+(?:in|at|near|around|for))\b/i.test(msgLowerForHybrid) ||
        // General factual questions not about "my" data
        /\b(how\s+(?:much|many|far|long|old|big|tall|deep|wide)\s+(?:is|are|does|do|did|was|were)\s+(?:the|a|an|it)?|what\s+(?:is|are|was|were)\s+(?:the\s+)?(?:capital|population|currency|language|weather|temperature|distance|cost|price|height|meaning|definition|history|origin|difference))\b/i.test(msgLowerForHybrid) ||
        // Recommendation/opinion questions (not about saved data)
        (/\b(good|great|nice|cool|fun|interesting|amazing)\s+(?:places?|things?|restaurants?|cities|spots?|ideas?|activities)\b/i.test(msgLowerForHybrid) && !/\b(my|saved|list|tasks?|notes?)\b/i.test(msgLowerForHybrid))
      );

      let webSearchContext = '';
      if (isGeneralKnowledgeQ) {
        console.log('[CONTEXTUAL_ASK] General knowledge detected — augmenting with Perplexity');
        try {
          const PERPLEXITY_KEY = Deno.env.get('OLIVE_PERPLEXITY');
          if (PERPLEXITY_KEY) {
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
                  { role: 'user', content: effectiveMessage || '' }
                ],
                temperature: 0.2,
              }),
            });
            if (perplexityRes.ok) {
              const pData = await perplexityRes.json();
              const searchResult = pData.choices?.[0]?.message?.content || '';
              const citations = pData.citations || [];
              if (searchResult) {
                webSearchContext = `\n## WEB SEARCH RESULTS (authoritative external knowledge):\n${searchResult}\n`;
                if (citations.length > 0) {
                  webSearchContext += `\nSources: ${citations.slice(0, 3).join(', ')}\n`;
                }
              }
              console.log('[CONTEXTUAL_ASK] Perplexity augmentation successful, length:', searchResult.length);
            }
          }
        } catch (searchErr) {
          console.warn('[CONTEXTUAL_ASK] Perplexity augmentation failed (non-blocking):', searchErr);
        }
      }

      // ─── Layer 4 Context Soul (Phase C-4.c) ────────────────────────
      // Per-intent retrieval planner. Currently gated behind the
      // CONTEXT_SOUL_ROLLOUT env flag so we can ship the wiring without
      // changing production behavior until we explicitly enable it.
      // The dispatcher itself is fail-soft: any planner error returns
      // an empty string, and the existing retrieval path (savedItemsContext)
      // is unmodified — Layer 4 is purely additive when active.
      let contextSoulBlock = "";
      if (Deno.env.get("CONTEXT_SOUL_ROLLOUT") === "true") {
        try {
          // In whatsapp-webhook the only space identifier available
          // is `coupleId` (couple-typed spaces share their UUID with
          // the space row via the sync trigger). We pass it as both
          // spaceId (for note-scope filtering) and coupleId (for the
          // find_similar_notes RPC's p_couple_id arg).
          const csResult = await assembleContextSoul(supabase, "CONTEXTUAL_ASK", {
            userId,
            spaceId: coupleId ?? null,
            coupleId: coupleId ?? null,
            query: effectiveMessage || messageBody || "",
            generateEmbedding,
          });
          if (csResult.prompt && csResult.prompt.trim().length > 0) {
            contextSoulBlock = `\n\n${csResult.prompt}`;
            console.log(
              `[ContextSoul] CONTEXTUAL_ASK loaded sections=${csResult.sectionsLoaded.join(",")}`
                + ` tokens=${csResult.tokensUsed}`,
            );
          }
        } catch (csErr) {
          // Defense in depth — the dispatcher already wraps planners in
          // try/catch. This catches anything that escapes (e.g. import
          // errors at module load time in pathological deploys).
          console.warn("[ContextSoul] CONTEXTUAL_ASK assembly failed (non-blocking):", csErr);
        }
      }

      // Build system prompt — HYBRID when web search context is available
      const isHybridResponse = webSearchContext.length > 0;

      // ── Identity & no-guess guard rails (shared by both prompt variants) ──
      // These prevent the failure mode where Gemini, given a thin context block,
      // hallucinates references to unrelated apps ("Olive Tree app", "My Book List app")
      // or invents data not present in the user's saved items.
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

USER'S QUESTION: ${effectiveMessage}

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

USER'S QUESTION: ${effectiveMessage}

Respond with helpful, specific information extracted from their saved data. Answer the EXACT question asked.`;

      // Inject language instruction
      const ctxLangName = LANG_NAMES[userLang] || LANG_NAMES[userLang.split('-')[0]] || 'English';
      if (ctxLangName !== 'English') {
        systemPrompt += `\n\nIMPORTANT: Respond entirely in ${ctxLangName}.`;
      }

      // ── Prompt-audit log (Fix 6) ──
      // Without this, when a user reports "Olive gave me a generic answer for X", we have no
      // way to tell whether retrieval starved the LLM or the LLM ignored what it had.
      try {
        console.log('[CONTEXTUAL_ASK_PROMPT_AUDIT]', JSON.stringify({
          user_id: userId,
          q: (effectiveMessage || '').substring(0, 120),
          intent_q_type: (intentResult as any).queryType ?? null,
          hybrid: isHybridResponse,
          relevant_count: relevantTasks.length,
          other_count: otherTasks.length,
          lists_count: lists?.length || 0,
          ai_list_name: (intentResult as any)._listName ?? null,
          saved_chars: savedItemsContext.length,
          web_chars: webSearchContext.length,
          mem_chars: memoryContext.length + ctxAskMemoryFileContext.length,
          cal_chars: calendarContext.length,
          total_prompt_chars: systemPrompt.length,
        }));
      } catch (auditErr) {
        // Non-blocking — never fail a user reply on a logging issue
        console.warn('[CONTEXTUAL_ASK_PROMPT_AUDIT] log failed:', auditErr);
      }

      try {
        // Dynamic model selection — standard for most, Pro if media attached
        const ctxMediaUrls = mediaUrls.length > 0 ? mediaUrls : undefined;
        let response: string;
        const effectiveTier = isHybridResponse ? 'standard' : route.responseTier;
        const ctxAskPromptVersion = isHybridResponse ? WA_HYBRID_ASK_PROMPT_VERSION : WA_CONTEXTUAL_ASK_PROMPT_VERSION;
        try {
          response = await callAI(systemPrompt, effectiveMessage || '', 0.7, effectiveTier, tracker, ctxAskPromptVersion, ctxMediaUrls, userId);
        } catch (escalationErr) {
          if (effectiveTier === 'pro') {
            console.warn('[Router] Pro failed for CONTEXTUAL_ASK, falling back to standard:', escalationErr);
            response = await callAI(systemPrompt, effectiveMessage || '', 0.7, 'standard', tracker, ctxAskPromptVersion, ctxMediaUrls, userId);
          } else {
            throw escalationErr;
          }
        }

        // Store conversation context + artifact for "save this" follow-ups
        try {
          const questionLower = (effectiveMessage || '').toLowerCase();
          const matchingTask = allTasks?.find(task => {
            const summaryLower = task.summary.toLowerCase();
            const taskWords = summaryLower.split(/\s+/).filter((w: string) => w.length > 3);
            const matchCount = taskWords.filter((w: string) => questionLower.includes(w)).length;
            return matchCount >= Math.min(2, taskWords.length) ||
                   questionLower.includes(summaryLower);
          });

          await saveReferencedEntity(matchingTask || null, response);

          // Store output so user can "save this" later, plus structured pending_offer
          // when the response actually carries the save tail (so confirmation replies
          // can be unambiguously resolved even after intervening CHAT turns).
          const currentCtxCA = (session.context_data || {}) as ConversationContext;
          const nowIsoCA = new Date().toISOString();
          const requestForSaveCA = (effectiveMessage || '').substring(0, 500);
          const offeredArtifactCA = response.substring(0, 4000);
          const responseSuggestsSaveCA = /\b(save\s+this|save\s+it|salvar(?:lo|la)|guardar(?:lo|la)|salvarlo|guardarlo)\b/i.test(response);
          const pendingOfferCA: PendingOffer | null = responseSuggestsSaveCA
            ? {
                type: 'save_artifact',
                artifact_content: offeredArtifactCA,
                artifact_request: requestForSaveCA,
                artifact_kind: 'contextual_ask',
                offered_at: nowIsoCA,
              }
            : null;

          await supabase
            .from('user_sessions')
            .update({
              context_data: {
                ...currentCtxCA,
                last_assistant_output: offeredArtifactCA,
                last_assistant_output_at: nowIsoCA,
                last_assistant_request: requestForSaveCA,
                pending_offer: pendingOfferCA,
              },
              updated_at: nowIsoCA,
            })
            .eq('id', session.id);
          console.log(`[CONTEXTUAL_ASK] Stored output for save-artifact follow-up — pending_offer=${pendingOfferCA ? 'yes' : 'no'}`);
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
              'lite',
              tracker,
              WA_REWRITER_PROMPT_VERSION,
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

        // Fetch personal context to blend into web search results
        let personalContext = '';
        try {
          const { data: userMems } = await supabase
            .from('user_memories')
            .select('title, content, category')
            .eq('user_id', userId)
            .eq('is_active', true)
            .order('importance', { ascending: false })
            .limit(10);
          if (userMems && userMems.length > 0) {
            personalContext = `\nUSER'S PERSONAL CONTEXT (weave in naturally if relevant):\n${userMems.map(m => `- [${m.category}] ${m.title}: ${m.content}`).join('\n')}\n`;
          }
        } catch (_) { /* non-blocking */ }

        // Use AI to format the Perplexity result for WhatsApp  
        const ctxLangName = LANG_NAMES[userLang] || LANG_NAMES[userLang.split('-')[0]] || 'English';
        let formattedResponse: string;
        try {
          formattedResponse = await callAI(
            `You are Olive, a world-class AI assistant — like a brilliant friend who knows the world AND the user's life. The user asked a question. Answer it comprehensively using the search results, and if any personal context is relevant, weave it in naturally. Format for WhatsApp (max 1200 chars). Be warm, specific, and genuinely helpful. Use emojis sparingly 🫒${ctxLangName !== 'English' ? `\n\nIMPORTANT: Respond entirely in ${ctxLangName}.` : ''}

USER'S QUESTION: ${userQuestion}
${savedItemContext}
${personalContext}
WEB SEARCH RESULTS:
${searchResult}

${citations.length > 0 ? 'SOURCES:\n' + citations.map((c: string, i: number) => `[${i+1}] ${c}`).join('\n') : ''}

Answer the question thoroughly, then briefly mention any relevant personal connections. End with "Want me to save this?" if the response contains useful recommendations.`,
            searchResult,
            0.5,
            'lite',
            tracker,
            WA_WEB_SEARCH_FORMAT_PROMPT_VERSION,
          );
        } catch (formatErr) {
          console.warn('[WebSearch] Formatting failed, using raw result');
          formattedResponse = `🔍 Here's what I found:\n\n${searchResult.slice(0, 1200)}`;
          if (citations.length > 0) {
            formattedResponse += `\n\n🔗 ${citations[0]}`;
          }
        }

        // Save conversation context + artifact for "save this" follow-ups
        try {
          await saveReferencedEntity(null, formattedResponse);

          // Store output so user can "save this" later, AND register a structured
          // pending_offer so a delayed/short confirmation ("yes", "sì", "do it")
          // routes to the right artifact even if a CHAT turn happens in between.
          const currentCtxWS = (session.context_data || {}) as ConversationContext;
          const nowIsoWS = new Date().toISOString();
          const requestForSave = (effectiveMessage || '').substring(0, 500);
          const offeredArtifact = formattedResponse.substring(0, 4000);
          const responseSuggestsSave = /\b(save\s+this|save\s+it|salvar(?:lo|la)|guardar(?:lo|la)|salvarlo|guardarlo)\b/i.test(formattedResponse);
          const pendingOfferWS: PendingOffer | null = responseSuggestsSave
            ? {
                type: 'save_artifact',
                artifact_content: offeredArtifact,
                artifact_request: requestForSave,
                artifact_kind: 'web_search',
                offered_at: nowIsoWS,
              }
            : null;

          await supabase
            .from('user_sessions')
            .update({
              context_data: {
                ...currentCtxWS,
                last_assistant_output: offeredArtifact,
                last_assistant_output_at: nowIsoWS,
                last_assistant_request: requestForSave,
                pending_offer: pendingOfferWS,
              },
              updated_at: nowIsoWS,
            })
            .eq('id', session.id);
          console.log(`[WEB_SEARCH] Stored output for save-artifact follow-up — pending_offer=${pendingOfferWS ? 'yes' : 'no'}`);
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
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const userTimezone = profile.timezone || 'UTC';
      const todayWindow = getRelativeDayWindowUtc(now, userTimezone, 0);
      const tomorrowWindow = getRelativeDayWindowUtc(now, userTimezone, 1);
      
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
          const { data: calConnections } = await supabase
            .from('calendar_connections')
            .select('id, calendar_name')
            .eq('user_id', userId)
            .eq('is_active', true);
          
          if (calConnections && calConnections.length > 0) {
            const connIds = calConnections.map(c => c.id);
            const todayStart = todayWindow.start.toISOString();
            const todayEnd = todayWindow.end.toISOString();
            
            const { data: events } = await supabase
              .from('calendar_events')
              .select('title, start_time, end_time, all_day, location, timezone')
              .in('connection_id', connIds)
              .gte('start_time', todayStart)
              .lt('start_time', todayEnd)
              .order('start_time', { ascending: true })
              .limit(10);
            
            todayEvents = events || [];
            
            const { data: tmrwEvents } = await supabase
              .from('calendar_events')
              .select('title, start_time, end_time, all_day, location, timezone')
              .in('connection_id', connIds)
              .gte('start_time', tomorrowWindow.start.toISOString())
              .lt('start_time', tomorrowWindow.end.toISOString())
              .order('start_time', { ascending: true })
              .limit(10);
            
            tomorrowEvents = tmrwEvents || [];
            
            const formatEvents = (evts: typeof todayEvents) => evts.map(e => {
              if (e.all_day) return `• ${e.title} (all day)`;
              const time = formatTimeForZone(e.start_time, (e as any).timezone || userTimezone);
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
      const overdueTasks = activeTasks.filter(t => isBeforeUtc(t.due_date, todayWindow.start));
      const dueTodayTasks = activeTasks.filter(t => isInUtcRange(t.due_date, todayWindow.start, todayWindow.end));
      const dueTomorrowTasks = activeTasks.filter(t => isInUtcRange(t.due_date, tomorrowWindow.start, tomorrowWindow.end));
      
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
      // Phase 2 Task 2-B: Compact conversation summary (if present)
      // ----------------------------------------------------------------
      // Earlier turns that have been rolled into a summary by the thread
      // compactor live on `olive_gateway_sessions.compact_summary`. We
      // fetch the most-recent active session for this user+channel and
      // inject the summary ABOVE the verbatim recent turns so the model
      // sees the long-thread arc without blowing the HISTORY budget.
      // ================================================================
      let compactSummary: string | null = null;
      try {
        const { data: gwRow } = await supabase
          .from('olive_gateway_sessions')
          .select('compact_summary, last_compacted_at')
          .eq('user_id', userId)
          .eq('channel', 'whatsapp')
          .eq('is_active', true)
          .order('last_activity', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (gwRow?.compact_summary && gwRow.compact_summary.trim().length > 0) {
          compactSummary = gwRow.compact_summary.trim();
          console.log(
            `[CompactSummary] loaded (${compactSummary.length} chars, ` +
            `last_compacted_at=${gwRow.last_compacted_at || 'never'})`
          );
        }
      } catch (csErr) {
        console.warn('[CompactSummary] load error (non-blocking):', csErr);
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

${compactSummary ? `## Earlier in this thread (compacted summary):\n${compactSummary}\n\n` : ''}## Recent Conversation History:
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
          
        case 'general':
          // User is asking HOW to use Olive features — inject help KB into AI context
          systemPrompt = `You are Olive, helping the user understand how to use your features.

${baseContext}

## OLIVE HELP KNOWLEDGE BASE:
You have comprehensive knowledge about all Olive features. Use the information below to answer the user's question accurately and helpfully.

### 🚀 Getting Started
Q: What is Olive?
A: Olive is an AI-powered personal assistant for organizing life — tasks, lists, reminders, expenses, and more. Use it through the web/mobile app or WhatsApp. Send notes in natural language and Olive auto-categorizes, organizes, and reminds you.

Q: How do I create a note/task?
A: Tap the + button on home screen and type anything. On WhatsApp, just send a message directly. Olive's AI auto-detects type, sets dates, and splits multi-item lists.

Q: Voice notes?
A: Tap the microphone icon to record. On WhatsApp, send voice notes — Olive transcribes and processes them in any language.

### 📝 Notes & Tasks
Q: Due dates/reminders?
A: Open a note → tap date chip or bell icon. Or include dates in text naturally: "Call dentist tomorrow at 3pm". On WhatsApp, include time in message.

Q: Complete/delete tasks?
A: Swipe right to complete, swipe left to delete. Or open task and tap Complete/Delete. On WhatsApp: "done with [task]" or "delete [task]".

Q: Multiple tasks at once?
A: Yes! Brain dumps work: "Buy milk, call dentist, book flights, pick up dry cleaning" — Olive splits them automatically.

### 📋 Lists
Q: Create a list?
A: Lists tab → + button. On WhatsApp: "create a list called [name]". Tasks auto-route to matching lists.

Q: Add to specific list?
A: Mention the list: "Add eggs to my groceries list". On WhatsApp: "add tomatoes to grocery list".

### 💑 Partner & Sharing
Q: Invite partner?
A: Settings → My Profile & Household → Partner Connection → Invite Partner. Share the invite link via WhatsApp, email, or text.

Q: Shared vs private notes?
A: Default follows your privacy setting. Toggle per-note with lock icon. On WhatsApp prefix with "private:" to force private.

Q: Assign tasks to partner?
A: Use @ prefix: "@partner pick up kids". Or open task and change Owner field.

### 🔗 Integrations
Q: Connect WhatsApp?
A: Settings → Integrations → WhatsApp. Follow setup to scan QR/tap link. Then send notes, voice, photos, docs directly.

Q: Connect Google Calendar?
A: Settings → Integrations → Google Services → Connect Google Calendar. Events sync to Calendar tab.

Q: Connect email?
A: Settings → Olive's Intelligence → Automation Hub → Background Agents → Email Triage → Connect Email.

### 🫒 Olive Assistant
Q: What can Olive do?
A: Draft emails, plan trips, brainstorm, compare options, advise, summarize tasks, analyze week. On WhatsApp start with / or "help me". In app use "Ask Olive" chat.

Q: Save Olive's output?
A: Tap "Save as note" button in chat. On WhatsApp: "save this" or "salvalo". Content goes to note details for easy copy-paste.

Q: WhatsApp shortcuts?
A: + task, ! urgent, $ expense, ? search, / chat, @ assign. Natural language also works.

### 💰 Expenses
Q: Track expenses?
A: WhatsApp: "$45 lunch at Chipotle". App: Expenses tab. Photo receipts auto-extracted. Auto-split with partner.

### 📅 Calendar
Q: Add task to Google Calendar?
A: Open task with due date → tap calendar icon. Needs Google Calendar connected first.

### 🔒 Privacy
Q: Make note private?
A: Toggle privacy switch when creating. Or Settings → Default Privacy. WhatsApp: prefix "private:".

### ⚙️ Account
Q: Change language?
A: Settings → System → Regional Format. Supports English, Spanish, Italian.

Q: Export data?
A: Settings → Integrations → Data Export. CSV format.

Q: Background Agents?
A: Automated helpers: Stale Task Strategist, Birthday Gift Agent, Email Triage. Manage in Settings → Olive's Intelligence → Automation Hub.

Q: Memories/personalization?
A: Settings → Olive's Intelligence → Memories. Add personal facts for better AI recommendations.

## RULES:
- Answer the user's specific question concisely and accurately using the knowledge above
- If the question maps to a specific feature, give step-by-step instructions
- Mention BOTH app and WhatsApp methods when applicable
- Keep response under 1200 chars for WhatsApp readability
- Use the user's language
- Be warm and helpful — never say "I don't know how" for features listed above
- If the question is NOT about Olive features, route normally (don't force help)`;
          break;
          
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
If the user's message is long and conversational — asking for help with something, requesting you to draft content, compose a message, plan something, brainstorm, or perform a creative/analytical task — DO IT. Produce the content immediately. Don't save it as a task. Don't describe what you could do — DELIVER the result. You are a brilliant personal assistant.`;
      }
      
      try {
        const enhancedMessage = (effectiveMessage || '') + userPromptEnhancement;
        console.log('[WhatsApp Chat] Calling AI for chatType:', chatType, 'lang:', userLang);

        // Inject language instruction into AI prompt
        const langName = LANG_NAMES[userLang] || LANG_NAMES[userLang.split('-')[0]] || 'English';
        if (langName !== 'English') {
          systemPrompt += `\n\nIMPORTANT: Respond entirely in ${langName}.`;
        }

        // Dynamic model selection — Pro for weekly_summary/planning or media, standard for rest
        const chatPromptVersion = getWAChatPromptVersion(chatType);
        const chatMediaUrls = mediaUrls.length > 0 ? mediaUrls : undefined;
        let chatResponse: string;
        try {
          chatResponse = await callAI(systemPrompt, enhancedMessage, 0.7, route.responseTier, tracker, chatPromptVersion, chatMediaUrls, userId);
        } catch (escalationErr) {
          if (route.responseTier === 'pro') {
            console.warn('[Router] Pro failed for CHAT, falling back to standard:', escalationErr);
            chatResponse = await callAI(systemPrompt, enhancedMessage, 0.7, 'standard', tracker, chatPromptVersion, chatMediaUrls, userId);
          } else {
            throw escalationErr;
          }
        }

        // Save conversation history (no specific entity for CHAT)
        // For assistant-type responses, also store the full output for "save this" follow-ups
        await saveReferencedEntity(null, chatResponse);

        // Store output for ALL chat types so user can "save this" later.
        // Critical: if a fresh pending_offer is alive (e.g. a prior WEB_SEARCH offered
        // to save and the user is mid-conversation about it), DO NOT overwrite the
        // saved request/output — that's what previously caused titles like
        // "Clarification Request for 'Yes Please'". The offer takes priority and
        // its frozen artifact_request stays the source of truth for SAVE_ARTIFACT.
        try {
          const currentCtx = (session.context_data || {}) as ConversationContext;
          const offerStillAlive = isPendingOfferFresh(currentCtx.pending_offer);
          const nowIsoChat = new Date().toISOString();
          const nextCtx: ConversationContext = offerStillAlive
            ? {
                // Preserve the offer's frozen artifact + original request.
                // Do NOT overwrite last_assistant_output / last_assistant_request.
                ...currentCtx,
              }
            : {
                ...currentCtx,
                last_assistant_output: chatResponse.substring(0, 4000),
                last_assistant_output_at: nowIsoChat,
                last_assistant_request: (effectiveMessage || '').substring(0, 500),
              };

          await supabase
            .from('user_sessions')
            .update({
              context_data: nextCtx,
              updated_at: nowIsoChat,
            })
            .eq('id', session.id);
          console.log(`[CHAT/${chatType}] Stored output for save-artifact follow-up — pending_offer_alive=${offerStillAlive}`);
        } catch (storeErr) {
          console.warn(`[CHAT/${chatType}] Failed to store output (non-blocking):`, storeErr);
        }

        // Phase 3: Auto-evolve memory from conversation (non-blocking, fire-and-forget)
        // Tier 1 (regex) + Tier 2 (AI) fact extraction runs in background
        try {
          const { evolveProfileFromConversation } = await import("../_shared/orchestrator.ts");
          evolveProfileFromConversation(supabase, userId, effectiveMessage || '', chatResponse)
            .catch(e => console.warn('[ConvMemory] Non-blocking error:', e));
        } catch {}

        // Also log this conversation turn to daily memory for compilation (fire-and-forget, no await)
        try {
          const turnSummary = `[${chatType}] User: ${(effectiveMessage || '').substring(0, 120)} → Olive responded`;
          void supabase.rpc('append_to_daily_log', {
            p_user_id: userId,
            p_content: turnSummary,
            p_source: 'chat',
          }).then(() => console.log('[ConvMemory] Daily log appended'), (e: any) => console.warn('[ConvMemory] Daily log append failed:', e));
        } catch {}

        return reply(chatResponse.slice(0, chatType === 'assistant' ? 2000 : 1500));
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
                language: userLang,
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

      // ─── Trust gate (Phase C-2.a) ──────────────────────────────────
      // Messaging another human on the user's behalf is the textbook
      // externally-visible action: it affects someone else, with the
      // user's name attached. Olive must ask first unless the user has
      // explicitly granted autonomy on `send_whatsapp_to_partner`.
      // Gated on soul_enabled inside the helper. Fail-soft: a gate
      // error allows the send to proceed (better than silently dropping
      // a relay the user just asked for).
      const partnerTrust = await checkTrustForAction(supabase, {
        userId,
        actionType: 'send_whatsapp_to_partner',
        spaceId: coupleId || undefined,
        actionPayload: {
          partner_id: partnerId,
          partner_name: partnerName,
          message_preview: partnerWhatsAppMsg.slice(0, 200),
          saved_task_id: savedTask?.id || null,
        },
        actionDescription: `send a WhatsApp to ${partnerName}: "${partnerMessageContent.slice(0, 100)}"`,
        triggerType: 'reactive',
      });

      if (!partnerTrust.allowed) {
        console.log(
          `[PARTNER_MESSAGE] Trust gate ${partnerTrust.trust_level_name} blocked send`
            + ` — queued as ${partnerTrust.action_id}`,
        );
        // The task (if task-like) was already saved above. Confirm to
        // the user that the relay is pending their approval — they'll
        // see a card in the app and can approve there.
        if (savedTask) {
          return reply(
            `📋 I saved "${savedTask.summary}" and queued a message to ${partnerName}`
              + ` for your approval. Open Olive to confirm — or reply "do it"`
              + ` and I'll send it now.`,
          );
        }
        return reply(
          `✋ I've queued a message to ${partnerName} for your approval.`
            + ` Open Olive to confirm — or reply "do it" and I'll send it now.`,
        );
      }

      if (partnerTrust.failed_open) {
        console.warn('[PARTNER_MESSAGE] Trust gate failed open — proceeding with send');
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
    // SAVE ARTIFACT HANDLER - Save Olive's assistant output as a note/task
    // Triggered when user says "save this", "save it as a note", etc.
    // after Olive produced content (email draft, plan, brainstorm, etc.)
    // ========================================================================
    if (intent === 'SAVE_ARTIFACT') {
      console.log('[SAVE_ARTIFACT] User wants to save assistant output as note');

      const sessionCtxArtifact = (session.context_data || {}) as ConversationContext;
      // Prefer the structured pending_offer (frozen at offer time, immune to CHAT clobber).
      // Fall back to last_assistant_* for legacy / "save this" flows where no offer was set.
      const freshOffer = isPendingOfferFresh(sessionCtxArtifact.pending_offer)
        ? sessionCtxArtifact.pending_offer
        : null;
      const artifactContent = freshOffer?.artifact_content || sessionCtxArtifact.last_assistant_output;
      const artifactRequest = freshOffer?.artifact_request || sessionCtxArtifact.last_assistant_request || '';

      if (!artifactContent) {
        return reply(t('artifact_none', userLang));
      }

      try {
        // Use AI to generate a proper title and category for the artifact.
        // Critical: the title must describe the CONTENT, not paraphrase the user's
        // confirmation message ("yes please", "save it"). The original_request is
        // supplementary context only — useful when the content is open-ended, but it
        // must NEVER become the title when it's a short confirmation.
        const classifyResult = await callAI(
          `You classify saved content into a structured note. Return JSON with:
- "title": A concise, descriptive title (max 8 words) that captures the TOPIC of the FULL ARTIFACT CONTENT. NEVER base the title on the original request when that request is a short confirmation (e.g. "yes", "yes please", "save it", "ok", "do it", "sì", "sì grazie", "sí", "vale", "claro"). NEVER use generic titles ("Save Note", "Saved Draft", "Clarification Request"). Instead describe what the CONTENT is about. Good examples: "Best Cities to Visit in Italy", "Megaformer Studios — What They Are", "Email Draft to Boss About Vacation", "Gift Ideas for Sara's Birthday".
- "category": One of: task, work, personal, travel, finance, health, shopping, entertainment, recipes, general
- "tags": Array of 1-3 relevant tags drawn from the CONTENT topic.

Return ONLY valid JSON, no markdown.`,
          `ORIGINAL USER REQUEST (context only — do NOT title from this if it looks like a confirmation): "${artifactRequest.substring(0, 500)}"\n\nFULL ARTIFACT CONTENT (title MUST describe this):\n${artifactContent.substring(0, 2000)}`,
          0.1,
          'lite',
          tracker,
          WA_CLASSIFICATION_PROMPT_VERSION,
        );
        
        let title = 'Saved draft';
        let category = 'task';
        let tags: string[] = ['olive-draft'];

        try {
          const parsed = JSON.parse(classifyResult.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
          if (parsed.title && !isBadTitle(parsed.title)) title = parsed.title;
          category = parsed.category || category;
          tags = [...(parsed.tags || []), 'olive-draft'];
        } catch {
          // Fallback: extract first line of the CONTENT as title (never the user request,
          // which might be a confirmation phrase).
          const firstLine = artifactContent.split('\n')[0]?.replace(/[*#]/g, '').trim();
          if (firstLine && firstLine.length < 80) title = firstLine;
        }

        // Final fallback: derive title from user request — but ONLY if the request
        // doesn't itself look like a confirmation. Otherwise extract a topic line
        // from the content body.
        if (isBadTitle(title)) {
          const requestIsConfirmation = looksLikeConfirmation(artifactRequest);
          if (artifactRequest && !requestIsConfirmation) {
            const requestTitle = artifactRequest.replace(/^(can you |please |help me |tell me |what are |what is |search (?:for|what is|what's) )/i, '').substring(0, 60).trim();
            if (requestTitle.length > 5) title = requestTitle.charAt(0).toUpperCase() + requestTitle.slice(1);
          } else {
            // Pull the first substantive line from the content itself.
            const contentLine = artifactContent
              .split('\n')
              .map((l: string) => l.replace(/[*#>_`]/g, '').trim())
              .find((l: string) => l.length >= 6 && l.length <= 80);
            if (contentLine) title = contentLine;
          }
        }
        
        // Build note data — artifact goes into items (details section) for easy copy/paste
        // original_text keeps only the user's request for context
        const artifactLines = artifactContent
          .split('\n')
          .map((l: string) => l.trim())
          .filter((l: string) => l.length > 0);
        
        const noteData: any = {
          author_id: userId,
          couple_id: effectiveCoupleId,
          original_text: (artifactRequest || 'Saved from Olive chat').substring(0, 2000),
          summary: title,
          category: category.toLowerCase().replace(/\s+/g, '_'),
          priority: 'medium',
          tags: tags,
          items: artifactLines.length > 0 ? artifactLines : [artifactContent.substring(0, 4000)],
          completed: false,
          source: 'olive-chat',
        };
        
        // If user mentioned a specific list, try to find it (multi-word support)
        const msgLower = (messageBody || '').toLowerCase();
        const listMention = msgLower.match(/(?:in|to|on|nella|nella\s+lista|en\s+(?:mi\s+)?lista|alla\s+lista)\s+(?:my\s+)?[""""]?([^""""\n]{2,30})[""""]?\s*(?:list|lista)?/i);
        if (listMention) {
          const { data: matchedLists } = await supabase
            .from('clerk_lists')
            .select('id, name, couple_id')
            .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`);
          
          const targetName = listMention[1].toLowerCase().trim();
          // Try exact match first, then partial
          const matched = matchedLists?.find(l => l.name.toLowerCase() === targetName)
            || matchedLists?.find(l => l.name.toLowerCase().includes(targetName))
            || matchedLists?.find(l => targetName.includes(l.name.toLowerCase()));
          if (matched) {
            noteData.list_id = matched.id;
            noteData.couple_id = matched.couple_id ?? effectiveCoupleId;
          }
        }
        
        const { data: savedNote, error: saveError } = await supabase
          .from('clerk_notes')
          .insert(noteData)
          .select('id, summary, list_id')
          .single();
        
        if (saveError || !savedNote) {
          console.error('[SAVE_ARTIFACT] Insert error:', saveError);
          return reply(t('artifact_save_error', userLang));
        }
        
        // Generate embedding for the saved note (non-blocking)
        try {
          const embedding = await generateEmbedding(title + ' ' + artifactContent.substring(0, 500));
          if (embedding) {
            await supabase
              .from('clerk_notes')
              .update({ embedding })
              .eq('id', savedNote.id);
          }
        } catch {}
        
        // Clear the stored artifact AND the pending_offer from session — this
        // closes the Capture → Offer → Confirm → Execute loop atomically.
        try {
          await supabase
            .from('user_sessions')
            .update({
              context_data: {
                ...sessionCtxArtifact,
                last_assistant_output: null,
                last_assistant_output_at: null,
                last_assistant_request: null,
                pending_offer: null,
              },
              updated_at: new Date().toISOString(),
            })
            .eq('id', session.id);
        } catch {}
        
        // Get list name for confirmation
        let listConfirm = '';
        if (savedNote.list_id) {
          const { data: listInfo } = await supabase
            .from('clerk_lists')
            .select('name')
            .eq('id', savedNote.list_id)
            .single();
          if (listInfo) listConfirm = ` in your *${listInfo.name}* list`;
        }
        
        const saveConfirm = t('artifact_saved', userLang, { title: savedNote.summary, list: listConfirm });
        await saveReferencedEntity(savedNote, saveConfirm);
        return reply(saveConfirm);
        
      } catch (artifactErr) {
        console.error('[SAVE_ARTIFACT] Error:', artifactErr);
        return reply(t('artifact_save_error', userLang));
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

      // Check if a list with this name already exists with the SAME privacy scope
      // Users CAN have "Work" (private) and "Work" (shared) as separate lists
      const { data: existingLists } = await supabase
        .from('clerk_lists')
        .select('id, name, couple_id')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`);

      const normalizedNewName = listName.toLowerCase().trim();
      // Only match if same name AND same privacy scope
      const existingMatch = existingLists?.find(l => {
        const nameMatch = l.name.toLowerCase().trim() === normalizedNewName;
        if (!nameMatch) return false;
        const existingIsShared = l.couple_id !== null;
        const newIsShared = effectiveCoupleId !== null;
        return existingIsShared === newIsShared;
      });

      if (existingMatch) {
        // List already exists with same privacy — inform the user
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
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
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
        // PR6: AI prompt context — date strings localized, labels stay English.
        const dueInfo = item.due_date ? ` | Due: ${formatFriendlyDate(item.due_date, true, profile.timezone, userLang)}` : '';
        const reminderInfo = item.reminder_time ? ` | ⏰ ${formatFriendlyDate(item.reminder_time, true, profile.timezone, userLang)}` : '';
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
        const recapResponse = await callAI(fullRecapPrompt, `Recap my ${matchedList.name} list`, 0.7, 'standard', tracker, WA_LIST_RECAP_PROMPT_VERSION);

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
            // PR6: user-facing fallback — pass userLang so the date is
            // in the user's locale (no label here, just date in parens).
            const due = item.due_date ? ` (${formatFriendlyDate(item.due_date, false, profile.timezone, userLang)})` : '';
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
      language: userLang,
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
          
          // If note has a list_id, inherit the list's couple_id (shared list → shared note)
          const noteListId = note.list_id;
          let noteCoupleId = effectiveCoupleId;
          if (noteListId) {
            const { data: noteListData } = await supabase
              .from('clerk_lists')
              .select('couple_id')
              .eq('id', noteListId)
              .single();
            if (noteListData) {
              noteCoupleId = noteListData.couple_id ?? effectiveCoupleId;
            }
          }
          
          return {
            author_id: userId,
            couple_id: noteCoupleId,
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
        
        // If note has a list_id, inherit the list's couple_id (shared list → shared note)
        let singleNoteCoupleId = effectiveCoupleId;
        if (processData.list_id) {
          const { data: listData } = await supabase
            .from('clerk_lists')
            .select('couple_id')
            .eq('id', processData.list_id)
            .single();
          if (listData) {
            singleNoteCoupleId = listData.couple_id ?? effectiveCoupleId;
          }
        }
        
        const noteData = {
          author_id: userId,
          couple_id: singleNoteCoupleId,
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

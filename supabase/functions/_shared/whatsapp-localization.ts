// WhatsApp i18n response templates + helpers.
//
// Why this module exists
//   Extracted from supabase/functions/whatsapp-webhook/index.ts (TASK-10X-Phase8a).
//   The monolith embedded ~650 lines of inline RESPONSES dict + the t() lookup
//   function. Moving them to _shared/ has three wins:
//     1. Shrinks the webhook module by ~6.5% with zero behaviour change.
//     2. Makes the templates testable in isolation (no need to load the
//        whole 10k-line webhook to assert key parity or runtime behaviour).
//     3. Lets other edge functions (process-note, send-reminders, etc.)
//        reuse the same template registry instead of duplicating strings.
//
// Conventions
//   * Each key has three locales: `en`, `es`, `it`. The t() helper
//     normalises BCP-47 codes (`es-ES`, `it-IT`) to the short forms via
//     the leading subtag split. Falls back to `en`, then to the key name.
//   * Placeholders use the `{var}` syntax. Every locale for a given key
//     MUST use the same placeholder set — the static-parse test in
//     supabase/functions/whatsapp-webhook/responses-i18n.test.ts enforces
//     this; a runtime t() test in this file's co-located test enforces
//     end-to-end substitution.
//
// If you ADD a key, also add it to the NEW_PR1_PR2_KEYS list in
// responses-i18n.test.ts so the parity check covers it.

// ============================================================================
export const LANG_NAMES: Record<string, string> = {
  'en': 'English',
  'es-ES': 'Spanish',
  'es': 'Spanish',
  'it-IT': 'Italian',
  'it': 'Italian',
};

export const RESPONSES: Record<string, Record<string, string>> = {
  task_completed: {
    en: '🌿 Done — "{task}" is complete.',
    'es': '🌿 Listo — "{task}" completada.',
    'it': '🌿 Fatto — "{task}" completata.',
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
  // Soft version of task_not_found when the user used a pronoun ("it",
  // "that", "this") and we don't have a fresh focal entity to bind it
  // to. Hard-quoting "it" reads robotic — better to ask which task they
  // mean.
  task_pronoun_unclear: {
    en: '🌿 I\'m not sure which task you mean. Tell me the name or say "show my tasks" and I\'ll pull up the list.',
    'es': '🌿 No estoy segura de qué tarea es. Dime el nombre o "mostrar mis tareas" y te enseño la lista.',
    'it': '🌿 Non sono sicura di quale attività intendi. Dimmi il nome o "mostra le mie attività" e te le mostro.',
  },
  // Brand-voice empty-state replies. Previously hardcoded inline.
  // Per skill voice: warm but not saccharine — no "Great news!" / "all
  // caught up!", just say what's true and offer one bridge.
  empty_no_urgent: {
    en: '🌿 No urgent tasks right now. Want me to show what\'s coming up today?',
    'es': '🌿 No hay nada urgente ahora mismo. ¿Te muestro lo que tienes hoy?',
    'it': '🌿 Niente di urgente al momento. Vuoi vedere cosa hai oggi?',
  },
  empty_no_today: {
    en: '🌿 Nothing due today. Want me to check tomorrow or this week?',
    'es': '🌿 Nada vence hoy. ¿Te muestro mañana o esta semana?',
    'it': '🌿 Niente in scadenza oggi. Vuoi che controlli domani o questa settimana?',
  },
  empty_no_date: {
    en: '🌿 Nothing scheduled for {date}.',
    'es': '🌿 Nada programado para {date}.',
    'it': '🌿 Niente in programma per {date}.',
  },
  empty_no_recent: {
    en: '🌿 No recent tasks. Send me something to save.',
    'es': '🌿 No hay tareas recientes. Envíame algo para guardar.',
    'it': '🌿 Nessuna attività recente. Mandami qualcosa da salvare.',
  },
  // Soft offer for weak-match TASK_ACTION queries (similarity 0.2–0.4):
  // instead of "I couldn't find a task matching X", offer the closest
  // candidate and accept "yes" or "1" to confirm.
  task_did_you_mean: {
    en: '🌿 Did you mean "{task}"? Reply "yes" to do it, or send the full task name.',
    'es': '🌿 ¿Te refieres a "{task}"? Responde "sí" para hacerlo, o envía el nombre completo.',
    'it': '🌿 Intendi "{task}"? Rispondi "sì" per farlo, o invia il nome completo.',
  },
  // Offer the focal entity as a candidate when the user named a short
  // word that didn't match anything. Friendlier than dead-end "not found".
  task_focal_offer: {
    en: '🌿 Did you mean "{task}" — the one we just talked about? Reply "yes" and I\'ll {action} it.',
    'es': '🌿 ¿Te refieres a "{task}" — la que acabamos de hablar? Responde "sí" y la {action}.',
    'it': '🌿 Intendi "{task}" — quella di cui abbiamo appena parlato? Rispondi "sì" e la {action}.',
  },
  // ── Input / format errors ──
  error_message_too_long: {
    en: '🌿 That message is too long. Keep it under 10,000 characters and send again.',
    'es': '🌿 Ese mensaje es demasiado largo. Mantenlo bajo 10.000 caracteres e inténtalo de nuevo.',
    'it': '🌿 Quel messaggio è troppo lungo. Mantienilo sotto i 10.000 caratteri e riprova.',
  },
  error_invalid_location: {
    en: '🌿 I didn\'t catch your location. Try sharing it again.',
    'es': '🌿 No capté tu ubicación. Compártela de nuevo.',
    'it': '🌿 Non ho ricevuto la tua posizione. Riprova a condividerla.',
  },
  error_too_many_attachments: {
    en: '🌿 That\'s a lot at once ({count}). Send up to {max} files at a time.',
    'es': '🌿 Es mucho a la vez ({count}). Envía hasta {max} archivos por vez.',
    'it': '🌿 Sono troppi insieme ({count}). Inviane fino a {max} alla volta.',
  },
  error_voice_unavailable: {
    en: '🌿 Got your voice note, but my audio processor is down right now. Try again or type your message.',
    'es': '🌿 Recibí tu nota de voz, pero mi procesador de audio está caído. Reintenta o escríbeme.',
    'it': '🌿 Ho ricevuto il vocale, ma il mio audio è giù in questo momento. Riprova o scrivi il messaggio.',
  },
  error_image_processing: {
    en: '🌿 I had trouble with that image. Try again or add a caption describing what to save.',
    'es': '🌿 Tuve problemas con esa imagen. Reintenta o añade una descripción de qué guardar.',
    'it': '🌿 Ho avuto problemi con l\'immagine. Riprova o aggiungi una didascalia con cosa salvare.',
  },
  error_empty_input: {
    en: '🌿 Send me a message, share your location 📍, or attach media 📎.',
    'es': '🌿 Envíame un mensaje, comparte tu ubicación 📍, o adjunta archivos 📎.',
    'it': '🌿 Mandami un messaggio, condividi la tua posizione 📍, o allega un file 📎.',
  },
  location_shared: {
    en: '🌿 Got your location ({lat}, {lon}). Send a message like "Buy groceries at this location" to save a task here.',
    'es': '🌿 Recibí tu ubicación ({lat}, {lon}). Envía algo como "Comprar groceries en esta ubicación" para guardar una tarea aquí.',
    'it': '🌿 Posizione ricevuta ({lat}, {lon}). Mandami qualcosa tipo "Comprare la spesa qui" per salvare un\'attività in questo posto.',
  },
  // ── Account linking / token ──
  error_invalid_token: {
    en: '🌿 That token is invalid or expired. Generate a new one in the Olive app.',
    'es': '🌿 Ese token no es válido o expiró. Genera uno nuevo en la app de Olive.',
    'it': '🌿 Quel token non è valido o è scaduto. Generane uno nuovo nell\'app Olive.',
  },
  error_link_failed: {
    en: '🌿 I couldn\'t link your account. Try again.',
    'es': '🌿 No pude vincular tu cuenta. Inténtalo de nuevo.',
    'it': '🌿 Non sono riuscita a collegare il tuo account. Riprova.',
  },
  // ── Web search ──
  web_search_unavailable: {
    en: '🌿 Web search is offline right now. Try again in a bit.',
    'es': '🌿 La búsqueda web está apagada por ahora. Reintenta en un rato.',
    'it': '🌿 La ricerca web è offline al momento. Riprova tra un po\'.',
  },
  web_search_unavailable_hint: {
    en: '🌿 Web search is offline. Want me to check your saved items for "{hint}"?',
    'es': '🌿 La búsqueda web está apagada. ¿Reviso tus elementos guardados sobre "{hint}"?',
    'it': '🌿 La ricerca web è offline. Vuoi che controlli i tuoi elementi salvati su "{hint}"?',
  },
  web_search_error: {
    en: '🌿 Something went wrong searching the web. Try again?',
    'es': '🌿 Algo salió mal al buscar en la web. ¿Intentamos de nuevo?',
    'it': '🌿 Qualcosa è andato storto cercando sul web. Riproviamo?',
  },
  search_found_items: {
    en: '📋 Found these:\n\n{results}\n\n🔗 Manage: https://witholive.app',
    'es': '📋 Encontré esto:\n\n{results}\n\n🔗 Gestionar: https://witholive.app',
    'it': '📋 Ho trovato questi:\n\n{results}\n\n🔗 Gestisci: https://witholive.app',
  },
  // ── Partner relay edge cases ──
  partner_reached_partial: {
    en: '🌿 Saved "{task}" and assigned it to {partner}, but I couldn\'t reach them on WhatsApp (phone ...{last4}). They\'ll see it in the app.',
    'es': '🌿 Guardé "{task}" y se la asigné a {partner}, pero no pude contactarle por WhatsApp (teléfono ...{last4}). La verá en la app.',
    'it': '🌿 Salvato "{task}" e assegnato a {partner}, ma non sono riuscita a contattarlo su WhatsApp (telefono ...{last4}). Lo vedrà nell\'app.',
  },
  partner_unreachable: {
    en: '🌿 I couldn\'t reach {partner} on WhatsApp (phone ...{last4}). {detail}',
    'es': '🌿 No pude contactar a {partner} por WhatsApp (teléfono ...{last4}). {detail}',
    'it': '🌿 Non sono riuscita a contattare {partner} su WhatsApp (telefono ...{last4}). {detail}',
  },
  // ── List management ──
  list_no_name: {
    en: '🌿 What should I name the list? Try: "Create a list about [topic]".',
    'es': '🌿 ¿Cómo llamamos la lista? Prueba: "Crea una lista sobre [tema]".',
    'it': '🌿 Come la chiamiamo la lista? Prova: "Crea una lista su [argomento]".',
  },
  list_already_exists: {
    en: '🌿 "{list}" already exists with {count} active item{plural}. Send items to add, or say "show my {list} list".',
    'es': '🌿 "{list}" ya existe con {count} elemento{plural} activo{plural}. Envía elementos para añadir, o di "muestra mi lista {list}".',
    'it': '🌿 "{list}" esiste già con {count} elemento{plural} attivo{plural}. Mandami elementi da aggiungere, o di\' "mostra la mia lista {list}".',
  },
  list_not_found: {
    en: '🌿 I couldn\'t find a list matching "{query}".\n\nYour lists:\n{lists}\n\nTry: "recap my [list name]".',
    'es': '🌿 No encontré una lista que coincida con "{query}".\n\nTus listas:\n{lists}\n\nPrueba: "resumen de mi [nombre de lista]".',
    'it': '🌿 Non ho trovato una lista che corrisponda a "{query}".\n\nLe tue liste:\n{lists}\n\nProva: "riassumi la mia [nome lista]".',
  },
  list_empty: {
    en: '🌿 "{list}" is empty. Send items to add, or say "create a list about [topic]" to start a new one.',
    'es': '🌿 "{list}" está vacía. Envía elementos, o di "crea una lista sobre [tema]" para empezar una nueva.',
    'it': '🌿 "{list}" è vuota. Mandami elementi, o di\' "crea una lista su [argomento]" per iniziarne una nuova.',
  },
  // ── Catch-all ──
  error_save_failed: {
    en: '🌿 I understood the task, but had trouble saving it. Try again?',
    'es': '🌿 Entendí la tarea, pero tuve problemas al guardarla. ¿Probamos de nuevo?',
    'it': '🌿 Ho capito l\'attività, ma ho avuto problemi a salvarla. Riproviamo?',
  },
  // ── Proactive bridge (opt-in) — appended to brain-dump confirmations
  // when the saved task has no due_date or reminder_time. ONE offer,
  // 5-min TTL, no compounding. The "💡 tip" line is replaced by this so
  // we don't pile two prompts onto the same confirmation.
  proactive_date_offer: {
    en: '💡 Want me to set a date? Reply with one (e.g. "tomorrow at 5pm").',
    'es': '💡 ¿Le pongo una fecha? Respóndeme con una (ej. "mañana a las 17").',
    'it': '💡 Vuoi che le metta una data? Rispondi con una (es. "domani alle 17").',
  },
  proactive_date_applied: {
    en: '🌿 Set "{task}" for {when}.',
    'es': '🌿 "{task}" programada para {when}.',
    'it': '🌿 "{task}" impostata per {when}.',
  },
  proactive_date_skipped: {
    en: '🌿 No worries — saved as is.',
    'es': '🌿 Sin problema — guardado tal cual.',
    'it': '🌿 Nessun problema — salvato così com\'è.',
  },
  context_completed: {
    en: '🌿 Done — "{task}" is complete (from your recent reminder).',
    'es': '🌿 Listo — "{task}" completada (de tu recordatorio reciente).',
    'it': '🌿 Fatto — "{task}" completata (dal tuo promemoria recente).',
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
    en: '🌿 Cancelled.',
    'es': '🌿 Cancelado.',
    'it': '🌿 Annullato.',
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
    en: '🌿 Something went wrong on my end. Try again?',
    'es': '🌿 Algo falló por mi parte. ¿Lo intentamos de nuevo?',
    'it': '🌿 Qualcosa è andato storto da parte mia. Riproviamo?',
  },
  task_ambiguous: {
    en: '🌿 A few tasks match "{query}":\n\n{options}\n\nWhich one? Reply with the number.',
    'es': '🌿 Varias tareas coinciden con "{query}":\n\n{options}\n\n¿Cuál? Responde con el número.',
    'it': '🌿 Più attività corrispondono a "{query}":\n\n{options}\n\nQuale? Rispondi con il numero.',
  },
  partner_message_sent: {
    en: '🌿 Sent to {partner}:\n\n"{message}"',
    'es': '🌿 Enviado a {partner}:\n\n"{message}"',
    'it': '🌿 Inviato a {partner}:\n\n"{message}"',
  },
  partner_message_and_task: {
    en: '🌿 Told {partner} and saved:\n\n📋 "{task}"\n📂 Assigned to {partner}',
    'es': '🌿 Le dije a {partner} y guardé:\n\n📋 "{task}"\n📂 Asignado a {partner}',
    'it': '🌿 Detto a {partner} e salvato:\n\n📋 "{task}"\n📂 Assegnato a {partner}',
  },
  partner_message_existing_task: {
    en: '🌿 Reminded {partner} about an existing task:\n\n📋 "{task}"',
    'es': '🌿 Le recordé a {partner} una tarea existente:\n\n📋 "{task}"',
    'it': '🌿 Ricordato a {partner} un\'attività esistente:\n\n📋 "{task}"',
  },
  partner_no_phone: {
    en: '🌿 {partner} hasn\'t linked WhatsApp yet. Ask them to open Olive → Profile → Link WhatsApp.',
    'es': '🌿 {partner} aún no ha vinculado WhatsApp. Pídele que abra Olive → Perfil → Vincular WhatsApp.',
    'it': '🌿 {partner} non ha ancora collegato WhatsApp. Chiedigli di aprire Olive → Profilo → Collega WhatsApp.',
  },
  partner_no_space: {
    en: '🌿 Looks like your partner hasn\'t accepted the invite yet. Open Olive → Profile → Invite Partner.',
    'es': '🌿 Parece que tu pareja aún no ha aceptado la invitación. Abre Olive → Perfil → Invitar Pareja.',
    'it': '🌿 Sembra che il tuo partner non abbia ancora accettato l\'invito. Apri Olive → Profilo → Invita Partner.',
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
  // ─── Phase 1 WhatsApp port: edit_* + undo strings ─────────────────
  confirm_edit_title: {
    en: '✏️ Rename "{task}" → "{new_title}"?\n\nReply "yes" to confirm.',
    'es': '✏️ ¿Renombrar "{task}" → "{new_title}"?\n\nResponde "sí" para confirmar.',
    'it': '✏️ Rinominare "{task}" → "{new_title}"?\n\nRispondi "sì" per confermare.',
  },
  done_edit_title: {
    en: '✅ Done. "{task}" is now called "{new_title}".',
    'es': '✅ Hecho. "{task}" ahora se llama "{new_title}".',
    'it': '✅ Fatto. "{task}" ora si chiama "{new_title}".',
  },
  confirm_edit_location: {
    en: '📍 Update location of "{task}" to "{new_location}"?\n\nReply "yes" to confirm.',
    'es': '📍 ¿Actualizar la ubicación de "{task}" a "{new_location}"?\n\nResponde "sí".',
    'it': '📍 Aggiornare la posizione di "{task}" a "{new_location}"?\n\nRispondi "sì".',
  },
  done_edit_location: {
    en: '✅ Done. Location updated to "{new_location}".',
    'es': '✅ Hecho. Ubicación actualizada a "{new_location}".',
    'it': '✅ Fatto. Posizione aggiornata a "{new_location}".',
  },
  confirm_edit_description: {
    en: '📝 Update notes on "{task}" to: "{new_description}"?\n\nReply "yes" to confirm.',
    'es': '📝 ¿Actualizar notas de "{task}" a: "{new_description}"?\n\nResponde "sí".',
    'it': '📝 Aggiornare le note di "{task}" a: "{new_description}"?\n\nRispondi "sì".',
  },
  done_edit_description: {
    en: '✅ Done. Notes on "{task}" updated.',
    'es': '✅ Hecho. Notas de "{task}" actualizadas.',
    'it': '✅ Fatto. Note di "{task}" aggiornate.',
  },
  confirm_edit_duration: {
    en: '⏱️ Make "{task}" a {minutes}-minute event?\n\nReply "yes" to confirm.',
    'es': '⏱️ ¿Hacer "{task}" un evento de {minutes} minutos?\n\nResponde "sí".',
    'it': '⏱️ Rendere "{task}" un evento da {minutes} minuti?\n\nRispondi "sì".',
  },
  done_edit_duration: {
    en: '✅ Done. "{task}" is now {minutes} minutes.',
    'es': '✅ Hecho. "{task}" ahora dura {minutes} minutos.',
    'it': '✅ Fatto. "{task}" ora dura {minutes} minuti.',
  },
  // The "reply undo within 5 min" suffix appended to mutation success
  // messages. Keeps WhatsApp parity with the web confirmation flow.
  undo_hint: {
    en: ' Reply "undo" within 5 min to revert.',
    'es': ' Responde "deshacer" en 5 min para revertir.',
    'it': ' Rispondi "annulla" entro 5 min per ripristinare.',
  },
  done_undo_reschedule: {
    en: '↩️ Reverted "{task}" to its prior time.',
    'es': '↩️ "{task}" vuelve a su hora anterior.',
    'it': '↩️ "{task}" tornata all\'orario precedente.',
  },
  done_undo_delete: {
    en: '↩️ Brought "{task}" back.',
    'es': '↩️ "{task}" recuperada.',
    'it': '↩️ "{task}" ripristinata.',
  },
  done_undo_edit: {
    en: '↩️ Reverted "{task}".',
    'es': '↩️ "{task}" revertida.',
    'it': '↩️ "{task}" ripristinata.',
  },
  undo_nothing: {
    en: "🌿 Nothing to undo — I haven't done anything in the last 5 minutes.",
    'es': "🌿 Nada que deshacer — no he hecho nada en los últimos 5 minutos.",
    'it': "🌿 Niente da annullare — non ho fatto nulla negli ultimi 5 minuti.",
  },
  undo_failed: {
    en: "🌿 Couldn't undo this one — {detail}",
    'es': "🌿 No pude deshacer esto — {detail}",
    'it': "🌿 Non sono riuscita ad annullare — {detail}",
  },
  edit_need_value: {
    en: '🌿 I need to know what to change. Try "rename X to Y" or "set location of X to Y".',
    'es': '🌿 Necesito saber qué cambiar. Prueba "renombra X a Y" o "ubicación de X en Y".',
    'it': '🌿 Devo sapere cosa cambiare. Prova "rinomina X in Y" o "posizione di X a Y".',
  },
  // ─── Phase 3.2 — bulk reschedule strings ─────────────────────────
  // {n} = count, {from} = source day name, {to} = target day name,
  // {preview} = bullet-list of up to 5 tasks (newline separated),
  // {more} = "and N more" tail or empty.
  confirm_bulk_reschedule: {
    en: '🌿 Move {n} {tasks_word} from {from} to {to}:\n{preview}{more}\n\nReply "yes" to confirm.',
    'es': '🌿 Mover {n} {tasks_word} de {from} a {to}:\n{preview}{more}\n\nResponde "sí" para confirmar.',
    'it': '🌿 Sposta {n} {tasks_word} dal {from} al {to}:\n{preview}{more}\n\nRispondi "sì" per confermare.',
  },
  bulk_no_candidates: {
    en: '🌿 No tasks scheduled on {from} — nothing to move.',
    'es': '🌿 No hay tareas para el {from} — nada que mover.',
    'it': '🌿 Nessuna attività di {from} — niente da spostare.',
  },
  done_bulk_all: {
    en: '✅ Moved {n} {tasks_word} to {to}.',
    'es': '✅ Movidas {n} {tasks_word} a {to}.',
    'it': '✅ Spostate {n} {tasks_word} a {to}.',
  },
  done_bulk_partial: {
    en: '✅ Moved {succeeded} of {attempted}. {failed} couldn\'t be saved.',
    'es': '✅ Movidas {succeeded} de {attempted}. {failed} no se pudieron guardar.',
    'it': '✅ Spostate {succeeded} su {attempted}. {failed} non sono state salvate.',
  },
  bulk_calendar_all: {
    en: ' 📅 Synced to your Google Calendar.',
    'es': ' 📅 Sincronizadas con Google Calendar.',
    'it': ' 📅 Sincronizzate con Google Calendar.',
  },
  bulk_calendar_partial: {
    en: ' ⚠️ Some didn\'t reach Google Calendar — I\'ll keep trying in the background.',
    'es': ' ⚠️ Algunas no llegaron a Google Calendar — seguiré intentándolo.',
    'it': ' ⚠️ Alcune non sono arrivate a Google Calendar — continuerò a riprovare.',
  },
  bulk_calendar_none: {
    en: ' ⚠️ Saved in Olive — but Google Calendar didn\'t respond.',
    'es': ' ⚠️ Guardadas en Olive — pero Google Calendar no respondió.',
    'it': ' ⚠️ Salvate in Olive — ma Google Calendar non ha risposto.',
  },
  done_undo_bulk: {
    en: '↩️ Reverted the bulk move ({n} {tasks_word}).',
    'es': '↩️ Revertido el cambio masivo ({n} {tasks_word}).',
    'it': '↩️ Annullato lo spostamento massivo ({n} {tasks_word}).',
  },
};

export function t(key: string, lang: string, vars?: Record<string, string>): string {
  // Normalize language code: es-ES → es, it-IT → it, en → en
  const shortLang = lang.split('-')[0];
  const template = RESPONSES[key]?.[lang] || RESPONSES[key]?.[shortLang] || RESPONSES[key]?.['en'] || key;
  if (!vars) return template;
  return Object.entries(vars).reduce((s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, 'g'), v), template);
}

/**
 * Resolve a BCP-47 language code to a human-readable language name
 * (e.g. "es-ES" → "Spanish"). Used by AI-prompt context blocks to
 * tell the LLM which language to respond in.
 *
 * Falls back from full code (`es-ES`) to short code (`es`) to
 * "English" for unknown locales — matching the t() helper's
 * fallback ladder for consistency.
 *
 * Extracted from four identical repeated patterns in
 * whatsapp-webhook/index.ts (lines 7339, 7624, 8604, 9419 before
 * this extraction).
 */
export function langName(userLang: string): string {
  return LANG_NAMES[userLang] || LANG_NAMES[userLang.split('-')[0]] || 'English';
}

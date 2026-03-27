/**
 * Olive Help Knowledge Base
 * ============================================================================
 * Comprehensive FAQ and feature documentation for in-app help and AI-powered
 * help responses. Used by:
 * 1. Settings Help & FAQ section (searchable UI)
 * 2. WhatsApp HELP_ABOUT_OLIVE intent (injected into AI context)
 * 3. Web chat help responses (injected into ask-olive-stream)
 */

export interface HelpArticle {
  id: string;
  category: 'getting-started' | 'notes-tasks' | 'lists' | 'partner' | 'integrations' | 'assistant' | 'expenses' | 'calendar' | 'privacy' | 'account';
  question: {
    en: string;
    es: string;
    it: string;
  };
  answer: {
    en: string;
    es: string;
    it: string;
  };
  keywords: string[];
}

export const HELP_CATEGORIES = {
  'getting-started': {
    en: 'Getting Started',
    es: 'Primeros Pasos',
    it: 'Per Iniziare',
    icon: '🚀',
  },
  'notes-tasks': {
    en: 'Notes & Tasks',
    es: 'Notas y Tareas',
    it: 'Note e Attività',
    icon: '📝',
  },
  'lists': {
    en: 'Lists',
    es: 'Listas',
    it: 'Liste',
    icon: '📋',
  },
  'partner': {
    en: 'Partner & Sharing',
    es: 'Pareja y Compartir',
    it: 'Partner e Condivisione',
    icon: '💑',
  },
  'integrations': {
    en: 'Integrations',
    es: 'Integraciones',
    it: 'Integrazioni',
    icon: '🔗',
  },
  'assistant': {
    en: 'Olive Assistant',
    es: 'Asistente Olive',
    it: 'Assistente Olive',
    icon: '🫒',
  },
  'expenses': {
    en: 'Expenses',
    es: 'Gastos',
    it: 'Spese',
    icon: '💰',
  },
  'calendar': {
    en: 'Calendar',
    es: 'Calendario',
    it: 'Calendario',
    icon: '📅',
  },
  'privacy': {
    en: 'Privacy & Security',
    es: 'Privacidad y Seguridad',
    it: 'Privacy e Sicurezza',
    icon: '🔒',
  },
  'account': {
    en: 'Account & Settings',
    es: 'Cuenta y Configuración',
    it: 'Account e Impostazioni',
    icon: '⚙️',
  },
} as const;

export type HelpCategoryKey = keyof typeof HELP_CATEGORIES;

export const HELP_ARTICLES: HelpArticle[] = [
  // ── Getting Started ──
  {
    id: 'gs-1',
    category: 'getting-started',
    question: {
      en: 'What is Olive and how does it work?',
      es: '¿Qué es Olive y cómo funciona?',
      it: "Cos'è Olive e come funziona?",
    },
    answer: {
      en: 'Olive is your AI-powered personal assistant for organizing life — tasks, lists, reminders, expenses, and more. You can use Olive through the web/mobile app or via WhatsApp. Just send notes in natural language and Olive will automatically categorize, organize, and remind you.',
      es: 'Olive es tu asistente personal con IA para organizar la vida: tareas, listas, recordatorios, gastos y más. Puedes usar Olive a través de la app web/móvil o vía WhatsApp. Solo envía notas en lenguaje natural y Olive las categorizará, organizará y te recordará automáticamente.',
      it: "Olive è il tuo assistente personale con IA per organizzare la vita — attività, liste, promemoria, spese e altro. Puoi usare Olive tramite l'app web/mobile o via WhatsApp. Basta inviare note in linguaggio naturale e Olive le categorizzerà, organizzerà e ti ricorderà automaticamente.",
    },
    keywords: ['what', 'olive', 'how', 'work', 'start', 'begin', 'intro'],
  },
  {
    id: 'gs-2',
    category: 'getting-started',
    question: {
      en: 'How do I create my first note or task?',
      es: '¿Cómo creo mi primera nota o tarea?',
      it: 'Come creo la mia prima nota o attività?',
    },
    answer: {
      en: "Tap the + button on the home screen and type anything — e.g., 'Buy groceries tomorrow' or 'Plan trip to Italy'. Olive's AI will automatically detect the type of note, categorize it, set due dates, and even split multi-item lists. On WhatsApp, just send a message directly to Olive.",
      es: "Toca el botón + en la pantalla de inicio y escribe lo que quieras — por ejemplo, 'Comprar comida mañana' o 'Planear viaje a Italia'. La IA de Olive detectará automáticamente el tipo de nota, la categorizará, establecerá fechas y dividirá listas de varios elementos. En WhatsApp, simplemente envía un mensaje directo a Olive.",
      it: "Tocca il pulsante + nella schermata principale e scrivi qualsiasi cosa — es. 'Comprare spesa domani' o 'Pianificare viaggio in Italia'. L'IA di Olive rileverà automaticamente il tipo di nota, la categorizzerà, imposterà le date e dividerà le liste a più elementi. Su WhatsApp, invia semplicemente un messaggio diretto a Olive.",
    },
    keywords: ['create', 'first', 'note', 'task', 'add', 'new', 'start'],
  },
  {
    id: 'gs-3',
    category: 'getting-started',
    question: {
      en: 'How do I use voice notes?',
      es: '¿Cómo uso las notas de voz?',
      it: 'Come uso le note vocali?',
    },
    answer: {
      en: "Tap the microphone icon in the note input to record a voice note. Olive will transcribe it automatically and process it like a text note. You can also send voice notes on WhatsApp — Olive transcribes and processes them in any language.",
      es: "Toca el icono del micrófono en la entrada de notas para grabar una nota de voz. Olive la transcribirá automáticamente y la procesará como una nota de texto. También puedes enviar notas de voz en WhatsApp — Olive las transcribe y procesa en cualquier idioma.",
      it: "Tocca l'icona del microfono nell'input delle note per registrare una nota vocale. Olive la trascriverà automaticamente e la processerà come una nota di testo. Puoi anche inviare note vocali su WhatsApp — Olive le trascrive e processa in qualsiasi lingua.",
    },
    keywords: ['voice', 'microphone', 'audio', 'speak', 'record', 'voce', 'voz'],
  },

  // ── Notes & Tasks ──
  {
    id: 'nt-1',
    category: 'notes-tasks',
    question: {
      en: 'How do I set a due date or reminder?',
      es: '¿Cómo establezco una fecha límite o recordatorio?',
      it: 'Come imposto una scadenza o un promemoria?',
    },
    answer: {
      en: "Open any note and tap the date chip to set a due date, or tap the bell icon to set a reminder. You can also include dates naturally in your note text — e.g., 'Call dentist tomorrow at 3pm' and Olive will detect them automatically. On WhatsApp, just include the time in your message.",
      es: "Abre cualquier nota y toca el chip de fecha para establecer una fecha límite, o toca el icono de campana para configurar un recordatorio. También puedes incluir fechas naturalmente en el texto — por ejemplo, 'Llamar al dentista mañana a las 3pm' y Olive las detectará automáticamente. En WhatsApp, simplemente incluye la hora en tu mensaje.",
      it: "Apri qualsiasi nota e tocca il chip della data per impostare una scadenza, o tocca l'icona della campana per impostare un promemoria. Puoi anche includere le date naturalmente nel testo — es. 'Chiamare il dentista domani alle 15' e Olive le rileverà automaticamente. Su WhatsApp, includi semplicemente l'ora nel messaggio.",
    },
    keywords: ['due', 'date', 'reminder', 'time', 'when', 'schedule', 'deadline', 'scadenza', 'promemoria', 'recordatorio'],
  },
  {
    id: 'nt-2',
    category: 'notes-tasks',
    question: {
      en: 'How do I complete or delete a task?',
      es: '¿Cómo completo o elimino una tarea?',
      it: 'Come completo o elimino un\'attività?',
    },
    answer: {
      en: "Swipe right on a task to complete it, or open the task and tap 'Complete'. To delete, swipe left or use the delete option in the task detail page. On WhatsApp, say 'done with [task]' or 'delete [task]'.",
      es: "Desliza a la derecha sobre una tarea para completarla, o ábrela y toca 'Completar'. Para eliminar, desliza a la izquierda o usa la opción de eliminar en la página de detalle. En WhatsApp, di 'hecho con [tarea]' o 'eliminar [tarea]'.",
      it: "Scorri a destra su un'attività per completarla, o aprila e tocca 'Completa'. Per eliminare, scorri a sinistra o usa l'opzione elimina nella pagina di dettaglio. Su WhatsApp, di 'fatto [attività]' o 'elimina [attività]'.",
    },
    keywords: ['complete', 'done', 'finish', 'delete', 'remove', 'swipe', 'completare', 'eliminar'],
  },
  {
    id: 'nt-3',
    category: 'notes-tasks',
    question: {
      en: 'How does Olive categorize my notes?',
      es: '¿Cómo categoriza Olive mis notas?',
      it: 'Come categorizza Olive le mie note?',
    },
    answer: {
      en: "Olive uses AI to automatically detect the category of your note — Groceries, Work, Travel, Health, etc. You can always change the category manually by opening the note and editing it. As you use Olive more, it learns your patterns and routes tasks to the right lists automatically.",
      es: "Olive usa IA para detectar automáticamente la categoría de tu nota — Compras, Trabajo, Viaje, Salud, etc. Siempre puedes cambiar la categoría manualmente abriendo la nota y editándola. A medida que uses Olive más, aprende tus patrones y enruta tareas a las listas correctas automáticamente.",
      it: "Olive usa l'IA per rilevare automaticamente la categoria della tua nota — Spesa, Lavoro, Viaggio, Salute, ecc. Puoi sempre cambiare la categoria manualmente aprendo la nota e modificandola. Man mano che usi Olive, impara i tuoi pattern e indirizza le attività alle liste giuste automaticamente.",
    },
    keywords: ['category', 'categorize', 'organize', 'type', 'sort', 'auto', 'AI', 'categoria'],
  },
  {
    id: 'nt-4',
    category: 'notes-tasks',
    question: {
      en: 'Can I send multiple tasks at once?',
      es: '¿Puedo enviar varias tareas a la vez?',
      it: 'Posso inviare più attività contemporaneamente?',
    },
    answer: {
      en: "Yes! Olive supports 'brain dumps' — send a message with multiple items separated by commas, 'and', or line breaks. For example: 'Buy milk, call dentist, book flights to Rome, and pick up dry cleaning'. Olive will split them into separate tasks automatically.",
      es: "¡Sí! Olive soporta 'brain dumps' — envía un mensaje con múltiples elementos separados por comas, 'y', o saltos de línea. Por ejemplo: 'Comprar leche, llamar al dentista, reservar vuelos a Roma, y recoger la ropa de la tintorería'. Olive los dividirá en tareas separadas automáticamente.",
      it: "Sì! Olive supporta 'brain dump' — invia un messaggio con più elementi separati da virgole, 'e', o a capo. Ad esempio: 'Comprare latte, chiamare dentista, prenotare voli per Roma e ritirare vestiti dalla lavanderia'. Olive li dividerà in attività separate automaticamente.",
    },
    keywords: ['multiple', 'many', 'brain dump', 'bulk', 'several', 'batch', 'più', 'varias'],
  },

  // ── Lists ──
  {
    id: 'li-1',
    category: 'lists',
    question: {
      en: 'How do I create a custom list?',
      es: '¿Cómo creo una lista personalizada?',
      it: 'Come creo una lista personalizzata?',
    },
    answer: {
      en: "Go to the Lists tab and tap the + button to create a new list. Give it a name and optional description. New tasks will be automatically routed to matching lists based on their content. You can also create lists on WhatsApp by saying 'create a list called [name]'.",
      es: "Ve a la pestaña Listas y toca el botón + para crear una nueva lista. Dale un nombre y descripción opcional. Las nuevas tareas se enrutarán automáticamente a las listas correspondientes según su contenido. También puedes crear listas en WhatsApp diciendo 'crear una lista llamada [nombre]'.",
      it: "Vai alla scheda Liste e tocca il pulsante + per creare una nuova lista. Dagli un nome e una descrizione opzionale. Le nuove attività verranno indirizzate automaticamente alle liste corrispondenti in base al contenuto. Puoi anche creare liste su WhatsApp dicendo 'crea una lista chiamata [nome]'.",
    },
    keywords: ['list', 'create', 'new', 'custom', 'make', 'lista', 'creare'],
  },
  {
    id: 'li-2',
    category: 'lists',
    question: {
      en: 'How do I add a task to a specific list?',
      es: '¿Cómo agrego una tarea a una lista específica?',
      it: 'Come aggiungo un\'attività a una lista specifica?',
    },
    answer: {
      en: "When creating a note, you can specify the list — e.g., 'Add eggs to my groceries list'. Olive will match it to the right list. You can also open any task, edit it, and change the list assignment. On WhatsApp, mention the list name: 'add tomatoes to grocery list'.",
      es: "Al crear una nota, puedes especificar la lista — por ejemplo, 'Añade huevos a mi lista de compras'. Olive la emparejará con la lista correcta. También puedes abrir cualquier tarea, editarla y cambiar la asignación de lista. En WhatsApp, menciona el nombre de la lista: 'añadir tomates a la lista de compras'.",
      it: "Quando crei una nota, puoi specificare la lista — es. 'Aggiungi uova alla mia lista della spesa'. Olive la abbinerà alla lista giusta. Puoi anche aprire qualsiasi attività, modificarla e cambiare l'assegnazione della lista. Su WhatsApp, menziona il nome della lista: 'aggiungi pomodori alla lista della spesa'.",
    },
    keywords: ['add', 'task', 'list', 'specific', 'assign', 'route', 'put', 'aggiungere', 'añadir'],
  },

  // ── Partner & Sharing ──
  {
    id: 'pa-1',
    category: 'partner',
    question: {
      en: 'How do I invite my partner to Olive?',
      es: '¿Cómo invito a mi pareja a Olive?',
      it: 'Come invito il mio partner su Olive?',
    },
    answer: {
      en: "Go to Settings → My Profile & Household → Partner Connection and tap 'Invite Partner'. You can share the invite link directly or send it via WhatsApp, email, or text. Once they accept, you'll be able to share tasks, lists, and expenses together.",
      es: "Ve a Configuración → Mi Perfil y Hogar → Conexión con Pareja y toca 'Invitar Pareja'. Puedes compartir el enlace de invitación directamente o enviarlo por WhatsApp, correo electrónico o mensaje de texto. Una vez que acepten, podrán compartir tareas, listas y gastos juntos.",
      it: "Vai su Impostazioni → Il Mio Profilo e Casa → Connessione Partner e tocca 'Invita Partner'. Puoi condividere il link d'invito direttamente o inviarlo via WhatsApp, email o messaggio. Una volta accettato, potrete condividere attività, liste e spese insieme.",
    },
    keywords: ['invite', 'partner', 'couple', 'share', 'join', 'connect', 'pareja', 'invitare', 'invitar'],
  },
  {
    id: 'pa-2',
    category: 'partner',
    question: {
      en: 'How do shared vs private notes work?',
      es: '¿Cómo funcionan las notas compartidas vs privadas?',
      it: 'Come funzionano le note condivise vs private?',
    },
    answer: {
      en: "By default, notes follow your privacy setting (Settings → Default Privacy). 'Shared' notes are visible to your partner; 'Private' notes are only for you. You can toggle privacy per note using the lock/unlock icon. On WhatsApp, use the prefix 'private:' to force a note to be private.",
      es: "Por defecto, las notas siguen tu configuración de privacidad (Configuración → Privacidad Predeterminada). Las notas 'Compartidas' son visibles para tu pareja; las notas 'Privadas' son solo para ti. Puedes alternar la privacidad por nota usando el icono de candado. En WhatsApp, usa el prefijo 'privado:' para forzar una nota como privada.",
      it: "Per impostazione predefinita, le note seguono la tua impostazione di privacy (Impostazioni → Privacy Predefinita). Le note 'Condivise' sono visibili al tuo partner; le note 'Private' sono solo per te. Puoi alternare la privacy per nota usando l'icona del lucchetto. Su WhatsApp, usa il prefisso 'privato:' per forzare una nota come privata.",
    },
    keywords: ['shared', 'private', 'privacy', 'partner', 'visible', 'personal', 'condiviso', 'privado', 'privata'],
  },
  {
    id: 'pa-3',
    category: 'partner',
    question: {
      en: 'How do I assign a task to my partner?',
      es: '¿Cómo asigno una tarea a mi pareja?',
      it: 'Come assegno un\'attività al mio partner?',
    },
    answer: {
      en: "When creating a task, mention your partner — e.g., '@partner pick up kids'. You can also open any task and change the 'Owner' field. On WhatsApp, use the @ prefix with your partner's name to assign tasks.",
      es: "Al crear una tarea, menciona a tu pareja — por ejemplo, '@pareja recoger a los niños'. También puedes abrir cualquier tarea y cambiar el campo 'Propietario'. En WhatsApp, usa el prefijo @ con el nombre de tu pareja para asignar tareas.",
      it: "Quando crei un'attività, menziona il tuo partner — es. '@partner prendere i bambini'. Puoi anche aprire qualsiasi attività e cambiare il campo 'Proprietario'. Su WhatsApp, usa il prefisso @ con il nome del tuo partner per assegnare attività.",
    },
    keywords: ['assign', 'partner', 'owner', 'delegate', 'asignar', 'assegnare'],
  },

  // ── Integrations ──
  {
    id: 'in-1',
    category: 'integrations',
    question: {
      en: 'How do I connect WhatsApp?',
      es: '¿Cómo conecto WhatsApp?',
      it: 'Come collego WhatsApp?',
    },
    answer: {
      en: "Go to Settings → Integrations → WhatsApp and follow the setup steps. You'll scan a QR code or tap a link to start chatting with Olive on WhatsApp. Once connected, you can send notes, tasks, voice messages, photos, and documents directly from WhatsApp.",
      es: "Ve a Configuración → Integraciones → WhatsApp y sigue los pasos de configuración. Escanearás un código QR o tocarás un enlace para empezar a chatear con Olive en WhatsApp. Una vez conectado, puedes enviar notas, tareas, mensajes de voz, fotos y documentos directamente desde WhatsApp.",
      it: "Vai su Impostazioni → Integrazioni → WhatsApp e segui i passaggi di configurazione. Scannerizzerai un codice QR o toccherai un link per iniziare a chattare con Olive su WhatsApp. Una volta connesso, puoi inviare note, attività, messaggi vocali, foto e documenti direttamente da WhatsApp.",
    },
    keywords: ['whatsapp', 'connect', 'link', 'setup', 'collegare', 'conectar'],
  },
  {
    id: 'in-2',
    category: 'integrations',
    question: {
      en: 'How do I connect Google Calendar?',
      es: '¿Cómo conecto Google Calendar?',
      it: 'Come collego Google Calendar?',
    },
    answer: {
      en: "Go to Settings → Integrations → Google Services and tap 'Connect Google Calendar'. You'll sign in with your Google account and authorize access. Once connected, your calendar events will appear in the Calendar tab and Olive can automatically create events from your tasks.",
      es: "Ve a Configuración → Integraciones → Servicios de Google y toca 'Conectar Google Calendar'. Iniciarás sesión con tu cuenta de Google y autorizarás el acceso. Una vez conectado, tus eventos del calendario aparecerán en la pestaña Calendario y Olive puede crear eventos automáticamente desde tus tareas.",
      it: "Vai su Impostazioni → Integrazioni → Servizi Google e tocca 'Connetti Google Calendar'. Accederai con il tuo account Google e autorizzerai l'accesso. Una volta connesso, i tuoi eventi del calendario appariranno nella scheda Calendario e Olive può creare eventi automaticamente dalle tue attività.",
    },
    keywords: ['google', 'calendar', 'connect', 'sync', 'events', 'calendario', 'collegare'],
  },
  {
    id: 'in-3',
    category: 'integrations',
    question: {
      en: 'How do I connect Google Tasks?',
      es: '¿Cómo conecto Google Tasks?',
      it: 'Come collego Google Tasks?',
    },
    answer: {
      en: "Google Tasks is automatically available once you connect Google Calendar. Open any task in Olive, and you'll see a Google Tasks icon button. Tap it to sync that task to your Google Tasks list.",
      es: "Google Tasks está disponible automáticamente una vez que conectas Google Calendar. Abre cualquier tarea en Olive y verás un botón con el icono de Google Tasks. Tócalo para sincronizar esa tarea con tu lista de Google Tasks.",
      it: "Google Tasks è automaticamente disponibile una volta connesso Google Calendar. Apri qualsiasi attività in Olive e vedrai un pulsante con l'icona di Google Tasks. Toccalo per sincronizzare quell'attività con la tua lista di Google Tasks.",
    },
    keywords: ['google', 'tasks', 'sync', 'connect'],
  },
  {
    id: 'in-4',
    category: 'integrations',
    question: {
      en: 'How do I connect my email for triage?',
      es: '¿Cómo conecto mi correo para clasificación?',
      it: 'Come collego la mia email per il triage?',
    },
    answer: {
      en: "Go to Settings → Olive's Intelligence → Automation Hub → Background Agents. The Email Triage agent lets you connect your email so Olive can scan for action items and convert them into tasks. Tap 'Connect Email' to set it up.",
      es: "Ve a Configuración → Inteligencia de Olive → Centro de Automatización → Agentes en Segundo Plano. El agente de Clasificación de Email te permite conectar tu correo para que Olive pueda escanear elementos de acción y convertirlos en tareas. Toca 'Conectar Email' para configurarlo.",
      it: "Vai su Impostazioni → Intelligenza di Olive → Hub Automazione → Agenti in Background. L'agente Email Triage ti permette di collegare la tua email così Olive può scansionare gli elementi d'azione e convertirli in attività. Tocca 'Connetti Email' per configurarlo.",
    },
    keywords: ['email', 'triage', 'connect', 'inbox', 'scan', 'correo', 'collegare'],
  },

  // ── Olive Assistant ──
  {
    id: 'as-1',
    category: 'assistant',
    question: {
      en: 'What can I ask Olive to do?',
      es: '¿Qué puedo pedirle a Olive?',
      it: 'Cosa posso chiedere a Olive?',
    },
    answer: {
      en: "Olive can help you with almost anything! Draft emails, plan trips, brainstorm ideas, compare options, give advice, summarize your tasks, analyze your week, and much more. Just ask naturally — on WhatsApp start with / or 'help me' or on the app use the 'Ask Olive' chat. Olive can also save any content it produces as a note for future reference.",
      es: "¡Olive puede ayudarte con casi todo! Redactar correos, planificar viajes, generar ideas, comparar opciones, dar consejos, resumir tus tareas, analizar tu semana y mucho más. Solo pregunta naturalmente — en WhatsApp empieza con / o 'ayúdame' o en la app usa el chat 'Pregunta a Olive'. Olive también puede guardar cualquier contenido que produzca como nota para referencia futura.",
      it: "Olive può aiutarti con quasi tutto! Redigere email, pianificare viaggi, generare idee, confrontare opzioni, dare consigli, riassumere le tue attività, analizzare la tua settimana e molto altro. Chiedi in modo naturale — su WhatsApp inizia con / o 'aiutami' o nell'app usa la chat 'Chiedi a Olive'. Olive può anche salvare qualsiasi contenuto prodotto come nota per riferimento futuro.",
    },
    keywords: ['ask', 'olive', 'help', 'what', 'can', 'capabilities', 'features', 'cosa', 'qué'],
  },
  {
    id: 'as-2',
    category: 'assistant',
    question: {
      en: 'How do I save something Olive created as a note?',
      es: '¿Cómo guardo algo que Olive creó como nota?',
      it: 'Come salvo qualcosa che Olive ha creato come nota?',
    },
    answer: {
      en: "When Olive produces content (email drafts, plans, etc.), you'll see a 'Save as note' button in the chat. Tap it to save the content to your notes with proper categorization. On WhatsApp, just say 'save this' or 'save it as a note' after Olive produces something. The content will be saved in the note's details section for easy copy-paste.",
      es: "Cuando Olive produce contenido (borradores de correo, planes, etc.), verás un botón 'Guardar como nota' en el chat. Tócalo para guardar el contenido en tus notas con categorización adecuada. En WhatsApp, simplemente di 'guárdalo' o 'guárdalo como nota' después de que Olive produzca algo. El contenido se guardará en la sección de detalles de la nota para fácil copiar y pegar.",
      it: "Quando Olive produce contenuto (bozze email, piani, ecc.), vedrai un pulsante 'Salva come nota' nella chat. Toccalo per salvare il contenuto nelle tue note con categorizzazione appropriata. Su WhatsApp, di semplicemente 'salvalo' o 'salvalo come nota' dopo che Olive ha prodotto qualcosa. Il contenuto verrà salvato nella sezione dettagli della nota per facile copia-incolla.",
    },
    keywords: ['save', 'note', 'draft', 'content', 'keep', 'salvare', 'guardar'],
  },
  {
    id: 'as-3',
    category: 'assistant',
    question: {
      en: 'What are WhatsApp shortcuts?',
      es: '¿Cuáles son los atajos de WhatsApp?',
      it: 'Quali sono le scorciatoie di WhatsApp?',
    },
    answer: {
      en: "Use these prefixes on WhatsApp for quick actions:\n• + New task: '+Buy milk tomorrow'\n• ! Urgent: '!Call doctor now'\n• $ Expense: '$45 lunch at Chipotle'\n• ? Search: '?groceries'\n• / Chat: '/what should I focus on?'\n• @ Assign: '@partner pick up kids'\n\nYou can also just type naturally — Olive understands plain language too!",
      es: "Usa estos prefijos en WhatsApp para acciones rápidas:\n• + Nueva tarea: '+Comprar leche mañana'\n• ! Urgente: '!Llamar al doctor'\n• $ Gasto: '$45 almuerzo'\n• ? Buscar: '?compras'\n• / Chat: '/¿en qué debo enfocarme?'\n• @ Asignar: '@pareja recoger niños'\n\n¡También puedes escribir naturalmente — Olive entiende lenguaje natural!",
      it: "Usa questi prefissi su WhatsApp per azioni rapide:\n• + Nuova attività: '+Comprare latte domani'\n• ! Urgente: '!Chiamare dottore'\n• $ Spesa: '$45 pranzo'\n• ? Cerca: '?spesa'\n• / Chat: '/su cosa dovrei concentrarmi?'\n• @ Assegna: '@partner prendere bambini'\n\nPuoi anche scrivere naturalmente — Olive capisce il linguaggio naturale!",
    },
    keywords: ['shortcuts', 'prefix', 'commands', 'whatsapp', 'quick', 'scorciatoie', 'atajos'],
  },

  // ── Expenses ──
  {
    id: 'ex-1',
    category: 'expenses',
    question: {
      en: 'How do I track expenses?',
      es: '¿Cómo registro gastos?',
      it: 'Come registro le spese?',
    },
    answer: {
      en: "On WhatsApp, use the $ prefix — e.g., '$45 lunch at Chipotle'. In the app, go to the Expenses tab to view, add, and manage expenses. Olive automatically categorizes expenses and can split them with your partner. You can also take a photo of a receipt and Olive will extract the details.",
      es: "En WhatsApp, usa el prefijo $ — por ejemplo, '$45 almuerzo en Chipotle'. En la app, ve a la pestaña Gastos para ver, agregar y gestionar gastos. Olive categoriza automáticamente los gastos y puede dividirlos con tu pareja. También puedes tomar una foto del recibo y Olive extraerá los detalles.",
      it: "Su WhatsApp, usa il prefisso $ — es. '$45 pranzo da Chipotle'. Nell'app, vai alla scheda Spese per visualizzare, aggiungere e gestire le spese. Olive categorizza automaticamente le spese e può dividerle con il tuo partner. Puoi anche fare una foto dello scontrino e Olive estrarrà i dettagli.",
    },
    keywords: ['expense', 'track', 'money', 'cost', 'receipt', 'split', 'gasto', 'spesa'],
  },
  {
    id: 'ex-2',
    category: 'expenses',
    question: {
      en: 'How do I split expenses with my partner?',
      es: '¿Cómo divido gastos con mi pareja?',
      it: 'Come divido le spese con il mio partner?',
    },
    answer: {
      en: "Go to Settings → Expense Tracking and configure your default split type (50/50, custom, etc.). When you log an expense, it's automatically marked as shared if you have a partner connected. You can also change the split on individual expenses.",
      es: "Ve a Configuración → Registro de Gastos y configura tu tipo de división predeterminado (50/50, personalizado, etc.). Cuando registras un gasto, se marca automáticamente como compartido si tienes una pareja conectada. También puedes cambiar la división en gastos individuales.",
      it: "Vai su Impostazioni → Registro Spese e configura il tuo tipo di divisione predefinito (50/50, personalizzato, ecc.). Quando registri una spesa, viene automaticamente segnata come condivisa se hai un partner connesso. Puoi anche cambiare la divisione su spese individuali.",
    },
    keywords: ['split', 'expense', 'partner', 'share', 'divide', 'dividir', 'dividere'],
  },

  // ── Calendar ──
  {
    id: 'ca-1',
    category: 'calendar',
    question: {
      en: 'How do I add a task to my Google Calendar?',
      es: '¿Cómo agrego una tarea a mi Google Calendar?',
      it: 'Come aggiungo un\'attività al mio Google Calendar?',
    },
    answer: {
      en: "Open any task with a due date and tap the calendar icon button. This will create a Google Calendar event for that task. You need to have Google Calendar connected first (Settings → Integrations → Google Services).",
      es: "Abre cualquier tarea con fecha límite y toca el botón del icono de calendario. Esto creará un evento de Google Calendar para esa tarea. Necesitas tener Google Calendar conectado primero (Configuración → Integraciones → Servicios de Google).",
      it: "Apri qualsiasi attività con una scadenza e tocca il pulsante dell'icona del calendario. Questo creerà un evento di Google Calendar per quell'attività. Devi avere Google Calendar connesso prima (Impostazioni → Integrazioni → Servizi Google).",
    },
    keywords: ['calendar', 'google', 'event', 'add', 'sync', 'create', 'calendario'],
  },

  // ── Privacy & Security ──
  {
    id: 'pr-1',
    category: 'privacy',
    question: {
      en: 'How do I make a note private?',
      es: '¿Cómo hago una nota privada?',
      it: 'Come rendo una nota privata?',
    },
    answer: {
      en: "When creating a note, toggle the privacy switch to 'Private'. You can also change the default privacy setting in Settings → Default Privacy. On WhatsApp, prefix your message with 'private:' to force a note as private. Private notes are only visible to you, never shared with your partner.",
      es: "Al crear una nota, activa el interruptor de privacidad a 'Privado'. También puedes cambiar la configuración de privacidad predeterminada en Configuración → Privacidad Predeterminada. En WhatsApp, prefija tu mensaje con 'privado:' para forzar una nota como privada. Las notas privadas son solo visibles para ti, nunca se comparten con tu pareja.",
      it: "Quando crei una nota, attiva l'interruttore privacy su 'Privato'. Puoi anche cambiare l'impostazione di privacy predefinita in Impostazioni → Privacy Predefinita. Su WhatsApp, prefissa il messaggio con 'privato:' per forzare una nota come privata. Le note private sono visibili solo a te, mai condivise con il partner.",
    },
    keywords: ['private', 'privacy', 'secret', 'hide', 'sensitive', 'privata', 'privado'],
  },
  {
    id: 'pr-2',
    category: 'privacy',
    question: {
      en: 'What does Olive do with my data?',
      es: '¿Qué hace Olive con mis datos?',
      it: 'Cosa fa Olive con i miei dati?',
    },
    answer: {
      en: "Your data is stored securely and used only to provide the Olive service. We never sell your data. Sensitive notes can be encrypted end-to-end. You can export all your data anytime from Settings → Data Export. Read our full Privacy Policy in Settings → Legal & Support.",
      es: "Tus datos se almacenan de forma segura y se usan solo para proporcionar el servicio de Olive. Nunca vendemos tus datos. Las notas sensibles pueden cifrarse de extremo a extremo. Puedes exportar todos tus datos en cualquier momento desde Configuración → Exportar Datos. Lee nuestra Política de Privacidad completa en Configuración → Legal y Soporte.",
      it: "I tuoi dati sono archiviati in modo sicuro e utilizzati solo per fornire il servizio Olive. Non vendiamo mai i tuoi dati. Le note sensibili possono essere crittografate end-to-end. Puoi esportare tutti i tuoi dati in qualsiasi momento da Impostazioni → Esportazione Dati. Leggi la nostra Informativa sulla Privacy completa in Impostazioni → Legale e Supporto.",
    },
    keywords: ['data', 'privacy', 'security', 'encrypt', 'safe', 'datos', 'dati'],
  },

  // ── Account & Settings ──
  {
    id: 'ac-1',
    category: 'account',
    question: {
      en: 'How do I change the app language?',
      es: '¿Cómo cambio el idioma de la app?',
      it: "Come cambio la lingua dell'app?",
    },
    answer: {
      en: "Go to Settings → System → Regional Format and select your preferred language (English, Spanish, or Italian). The entire app, including Olive's responses and notifications, will switch to your selected language.",
      es: "Ve a Configuración → Sistema → Formato Regional y selecciona tu idioma preferido (Inglés, Español o Italiano). Toda la app, incluyendo las respuestas de Olive y las notificaciones, cambiará a tu idioma seleccionado.",
      it: "Vai su Impostazioni → Sistema → Formato Regionale e seleziona la tua lingua preferita (Inglese, Spagnolo o Italiano). Tutta l'app, incluse le risposte di Olive e le notifiche, cambierà nella lingua selezionata.",
    },
    keywords: ['language', 'change', 'english', 'spanish', 'italian', 'idioma', 'lingua'],
  },
  {
    id: 'ac-2',
    category: 'account',
    question: {
      en: 'How do I set my timezone?',
      es: '¿Cómo configuro mi zona horaria?',
      it: 'Come imposto il mio fuso orario?',
    },
    answer: {
      en: "Go to Settings → System → Regional Format and set your timezone. This ensures reminders, calendar events, and Olive's daily briefings are sent at the right local time.",
      es: "Ve a Configuración → Sistema → Formato Regional y establece tu zona horaria. Esto asegura que los recordatorios, eventos del calendario y los briefings diarios de Olive se envíen a la hora local correcta.",
      it: "Vai su Impostazioni → Sistema → Formato Regionale e imposta il tuo fuso orario. Questo assicura che i promemoria, gli eventi del calendario e i briefing giornalieri di Olive vengano inviati all'ora locale corretta.",
    },
    keywords: ['timezone', 'time', 'zone', 'clock', 'zona', 'fuso', 'orario'],
  },
  {
    id: 'ac-3',
    category: 'account',
    question: {
      en: 'How do I export my data?',
      es: '¿Cómo exporto mis datos?',
      it: 'Come esporto i miei dati?',
    },
    answer: {
      en: "Go to Settings → Integrations → Data Export. You can export all your notes, tasks, and lists as a CSV file for backup or to use in other apps.",
      es: "Ve a Configuración → Integraciones → Exportar Datos. Puedes exportar todas tus notas, tareas y listas como un archivo CSV para respaldo o para usar en otras apps.",
      it: "Vai su Impostazioni → Integrazioni → Esportazione Dati. Puoi esportare tutte le tue note, attività e liste come file CSV per backup o per usarle in altre app.",
    },
    keywords: ['export', 'data', 'download', 'csv', 'backup', 'exportar', 'esportare'],
  },
  {
    id: 'ac-4',
    category: 'account',
    question: {
      en: 'What is My Day?',
      es: '¿Qué es Mi Día?',
      it: "Cos'è Il Mio Giorno?",
    },
    answer: {
      en: "My Day is a focused view that shows you today's tasks, upcoming reminders, and calendar events in one place. It helps you plan your day at a glance. Access it from the bottom navigation bar.",
      es: "Mi Día es una vista enfocada que te muestra las tareas de hoy, los próximos recordatorios y los eventos del calendario en un solo lugar. Te ayuda a planificar tu día de un vistazo. Accede desde la barra de navegación inferior.",
      it: "Il Mio Giorno è una vista concentrata che ti mostra le attività di oggi, i prossimi promemoria e gli eventi del calendario in un unico posto. Ti aiuta a pianificare la giornata a colpo d'occhio. Accedi dalla barra di navigazione inferiore.",
    },
    keywords: ['my day', 'today', 'daily', 'focus', 'plan', 'mi día', 'giorno'],
  },
  {
    id: 'ac-5',
    category: 'account',
    question: {
      en: 'How do I set up Olive\'s memories and personalization?',
      es: '¿Cómo configuro las memorias y personalización de Olive?',
      it: 'Come configuro le memorie e la personalizzazione di Olive?',
    },
    answer: {
      en: "Go to Settings → Olive's Intelligence → Memories. Here you can add personal facts (dietary needs, family members, preferences) that help Olive give better recommendations and organize tasks more accurately. Olive also learns automatically from your notes over time.",
      es: "Ve a Configuración → Inteligencia de Olive → Memorias. Aquí puedes agregar datos personales (necesidades dietéticas, miembros de la familia, preferencias) que ayudan a Olive a dar mejores recomendaciones y organizar tareas con más precisión. Olive también aprende automáticamente de tus notas con el tiempo.",
      it: "Vai su Impostazioni → Intelligenza di Olive → Memorie. Qui puoi aggiungere fatti personali (esigenze dietetiche, membri della famiglia, preferenze) che aiutano Olive a dare raccomandazioni migliori e organizzare le attività con maggiore precisione. Olive impara anche automaticamente dalle tue note nel tempo.",
    },
    keywords: ['memory', 'memories', 'personalize', 'personalization', 'learn', 'preferences', 'memorias', 'memorie'],
  },
  {
    id: 'ac-6',
    category: 'account',
    question: {
      en: 'What are Background Agents?',
      es: '¿Qué son los Agentes en Segundo Plano?',
      it: 'Cosa sono gli Agenti in Background?',
    },
    answer: {
      en: "Background Agents are automated helpers that work behind the scenes. They include the Stale Task Strategist (reminds you of forgotten tasks), Birthday Gift Agent (suggests gift ideas), Email Triage (extracts action items from emails), and more. Manage them in Settings → Olive's Intelligence → Automation Hub.",
      es: "Los Agentes en Segundo Plano son ayudantes automatizados que trabajan detrás de escena. Incluyen el Estratega de Tareas Abandonadas (te recuerda tareas olvidadas), Agente de Regalos de Cumpleaños (sugiere ideas de regalos), Clasificación de Email (extrae elementos de acción de correos), y más. Gestiónalos en Configuración → Inteligencia de Olive → Centro de Automatización.",
      it: "Gli Agenti in Background sono assistenti automatizzati che lavorano dietro le quinte. Includono lo Stratega Attività Stagnanti (ti ricorda attività dimenticate), l'Agente Regali di Compleanno (suggerisce idee regalo), Triage Email (estrae elementi d'azione dalle email) e altro. Gestiscili in Impostazioni → Intelligenza di Olive → Hub Automazione.",
    },
    keywords: ['agent', 'background', 'automation', 'auto', 'bot', 'agente', 'automatización'],
  },
];

/**
 * Search help articles by query string
 * Returns relevant articles sorted by relevance
 */
export function searchHelpArticles(query: string, lang: 'en' | 'es' | 'it' = 'en'): HelpArticle[] {
  if (!query || query.trim().length < 2) return [];
  
  const q = query.toLowerCase().trim();
  const words = q.split(/\s+/).filter(w => w.length > 1);
  
  const scored = HELP_ARTICLES.map(article => {
    let score = 0;
    
    // Check keywords
    for (const keyword of article.keywords) {
      if (q.includes(keyword.toLowerCase())) score += 3;
      for (const word of words) {
        if (keyword.toLowerCase().includes(word)) score += 1;
      }
    }
    
    // Check question text
    const questionText = article.question[lang].toLowerCase();
    for (const word of words) {
      if (questionText.includes(word)) score += 2;
    }
    
    // Check answer text
    const answerText = article.answer[lang].toLowerCase();
    for (const word of words) {
      if (answerText.includes(word)) score += 0.5;
    }
    
    return { article, score };
  })
  .filter(item => item.score > 0)
  .sort((a, b) => b.score - a.score)
  .map(item => item.article);
  
  return scored.slice(0, 5);
}

/**
 * Generate a formatted help knowledge base string for AI context injection.
 * Used in WhatsApp and web chat when a help question is detected.
 */
export function getHelpKnowledgeForAI(lang: 'en' | 'es' | 'it' = 'en'): string {
  const sections = Object.entries(HELP_CATEGORIES).map(([key, cat]) => {
    const articles = HELP_ARTICLES.filter(a => a.category === key);
    if (articles.length === 0) return '';
    
    const qaPairs = articles.map(a => 
      `Q: ${a.question[lang]}\nA: ${a.answer[lang]}`
    ).join('\n\n');
    
    return `### ${cat.icon} ${cat[lang]}\n\n${qaPairs}`;
  }).filter(Boolean).join('\n\n---\n\n');
  
  return sections;
}

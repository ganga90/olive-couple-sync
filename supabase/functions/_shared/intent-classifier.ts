/**
 * Shared Intent Classifier
 * ========================
 * Single source of truth for intent classification across all channels.
 * Both whatsapp-webhook and ask-olive-individual import this instead of
 * duplicating classification logic.
 *
 * Uses Gemini 2.5 Flash-Lite with forced JSON schema for fast,
 * deterministic classification.
 */

import { GoogleGenAI, Type } from "https://esm.sh/@google/genai@1.0.0";
import { GEMINI_KEY, getModel } from "./gemini.ts";

// ─── Input / Output Types ──────────────────────────────────────

export interface ClassificationInput {
  message: string;
  conversationHistory: Array<{ role: string; content: string }>;
  recentOutboundMessages?: string[]; // WhatsApp passes these; in-app can omit
  activeTasks: Array<{
    id: string;
    summary: string;
    due_date: string | null;
    priority: string;
  }>;
  userMemories: Array<{ title: string; content: string; category: string }>;
  activatedSkills: Array<{ skill_id: string; name: string }>;
  userLists?: Array<{ name: string }>; // User's existing list names for disambiguation
  userLanguage?: string; // defaults to "en"
  hasMedia?: boolean; // Whether media (image, document, PDF) is attached
}

export interface ClassifiedIntent {
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

export interface ClassificationResult {
  intent: ClassifiedIntent | null;
  latencyMs: number;
}

// ─── JSON Schema (Gemini structured output) ────────────────────

const INTENT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      enum: [
        "search",
        "create",
        "complete",
        "set_priority",
        "set_due",
        "delete",
        "move",
        "assign",
        "remind",
        "expense",
        "chat",
        "contextual_ask",
        "web_search",
        "merge",
        "partner_message",
        "create_list",
        "list_recap",
      ],
    },
    target_task_id: { type: Type.STRING, nullable: true },
    target_task_name: { type: Type.STRING, nullable: true },
    matched_skill_id: { type: Type.STRING, nullable: true },
    parameters: {
      type: Type.OBJECT,
      properties: {
        priority: { type: Type.STRING, nullable: true },
        due_date_expression: { type: Type.STRING, nullable: true },
        query_type: {
          type: Type.STRING,
          nullable: true,
          enum: [
            "urgent",
            "today",
            "tomorrow",
            "this_week",
            "recent",
            "overdue",
            "general",
          ],
        },
        chat_type: {
          type: Type.STRING,
          nullable: true,
          enum: [
            "briefing",
            "weekly_summary",
            "daily_focus",
            "productivity_tips",
            "progress_check",
            "motivation",
            "planning",
            "greeting",
            "general",
          ],
        },
        list_name: { type: Type.STRING, nullable: true },
        amount: { type: Type.NUMBER, nullable: true },
        expense_description: { type: Type.STRING, nullable: true },
        is_urgent: { type: Type.BOOLEAN, nullable: true },
        partner_message_content: { type: Type.STRING, nullable: true },
        partner_action: {
          type: Type.STRING,
          nullable: true,
          enum: ["remind", "tell", "ask", "notify"],
        },
      },
      required: [],
    },
    confidence: { type: Type.NUMBER },
    reasoning: { type: Type.STRING },
  },
  required: ["intent", "confidence", "reasoning"],
};

// ─── System Prompt Builder ─────────────────────────────────────

function buildClassificationPrompt(input: ClassificationInput): string {
  const userLanguage = input.userLanguage || "en";
  const hasMedia = input.hasMedia || false;

  // Build conversation context (last 10 exchanges = 20 messages)
  const recentConvo = input.conversationHistory
    .slice(-20)
    .map((msg) => `${msg.role === "user" ? "User" : "Olive"}: ${msg.content}`)
    .join("\n");

  // Build task list (compact, up to 30)
  const taskList = input.activeTasks
    .slice(0, 30)
    .map(
      (t) =>
        `- [${t.id}] "${t.summary}" (due: ${t.due_date || "none"}, priority: ${t.priority})`
    )
    .join("\n");

  // Build memory context (compact, up to 10)
  const memoryList = input.userMemories
    .slice(0, 10)
    .map((m) => `- [${m.category}] ${m.title}: ${m.content}`)
    .join("\n");

  // Build skills context (just names)
  const skillsList = input.activatedSkills
    .map((s) => `- ${s.skill_id}: ${s.name}`)
    .join("\n");

  // Build outbound context (WhatsApp only, optional)
  const outboundCtx = (input.recentOutboundMessages || [])
    .slice(0, 3)
    .map((m) => `- Olive said: "${m}"`)
    .join("\n");

  // Build user's list names (for disambiguation between create/search/list_recap)
  const listNamesCtx = (input.userLists || [])
    .slice(0, 20)
    .map((l) => `- ${l.name}`)
    .join("\n");

  return `You are the intent classifier for Olive, an AI personal assistant that helps people manage their lives. You are the "brain" that decides what action to take. Classify the user's message into exactly ONE intent. Return structured JSON.

You are NOT a rigid command parser. You understand natural, conversational language — the user talks to you like a friend or personal assistant. Interpret the MEANING behind their words, not just keywords.

## SHORTCUT PREFIXES (highest priority):
Messages starting with these characters are ALWAYS the indicated intent — no ambiguity:
- "+" → ALWAYS "create" (e.g., "+Buy milk tomorrow" = create task "Buy milk tomorrow")
- "!" → ALWAYS "create" with is_urgent=true (e.g., "!Call doctor now" = urgent task)
- "$" → ALWAYS "expense" (e.g., "$45 lunch at Chipotle")
- "?" → ALWAYS "search" (e.g., "?groceries")
- "/" → ALWAYS "chat" (e.g., "/what should I focus on?")
- "@" → ALWAYS task action assign (e.g., "@partner pick up kids")
If a shortcut prefix is present, strip it from the content for processing. Set confidence to 0.95.

## INTENTS:
- "search": User wants a DASHBOARD VIEW of their tasks — a summary or filtered list. Use ONLY for: "show my tasks", "what's urgent?", "what's due today?", "my tasks", "show groceries list", "what's overdue?". The key signal is that the user wants to SEE a list/dashboard, not ask a QUESTION about content. Single-word list names like "groceries" or "shopping" are search. "show my X list" is search.
- "contextual_ask": User is asking a QUESTION about their EXISTING saved data, agent results, or wants AI-powered advice. This is the intent for ANY question-form message about saved content. Examples: "which restaurants I have in my list?", "when is the dentist?", "what restaurants did I save?", "any date ideas?", "what books are on my list?", "do I have any travel plans?", "what did my agents find?", "how many tasks do I have in shopping?". CRITICAL DISTINCTION from "search": if the user asks a QUESTION (starts with which/what/where/when/who/how/do/did/any/have, or ends with "?") about specific CONTENT in their data → contextual_ask. If they want to VIEW a list/dashboard → search.
- "create": User wants to save something new — a task, note, idea, or brain-dump. CRITICAL: Any message that describes a NEW event, appointment, or task with specific details (date, time, location, person) is ALWAYS "create", NOT "contextual_ask". Examples: "Oliva vet visit at Banfield on 20-Mar at 5pm" = CREATE (new appointment), "buy milk", "call mom tomorrow", "dinner reservation at 8pm Friday", "dentist appointment March 15". If the message has a date/time AND describes something that doesn't already exist in the user's tasks, it's a CREATE.
- "complete": User wants to mark a task as done (e.g., "done with groceries", "finished!", "the dentist one is done", "cancel the last task" when they mean it's done)
- "set_priority": User wants to change importance (e.g., "make it urgent", "this is important", "low priority")
- "set_due": User wants to change when something is due (e.g., "change it to 7:30 AM", "postpone to Friday", "move it to tomorrow", "reschedule", "can you set it for next week?")
- "delete": User wants to remove/cancel a task (e.g., "delete the dentist task", "never mind about that", "remove it", "cancel that")
- "move": User wants to move a task to a different list (e.g., "move it to groceries", "put it in the work list")
- "assign": User wants to assign a task to their partner (e.g., "give this to Marcus", "assign it to my partner", "let her handle it")
- "remind": User wants a reminder — EITHER on an existing task OR creating a new one with a reminder. Examples: "remind me at 5 PM" (existing context), "remind me about this tomorrow" (existing task), "Moonswatch - remind me to check it out on March 6th" (NEW item + reminder), "remind me to call the dentist next Monday" (NEW task + reminder). Use target_task_name for the subject/task name and due_date_expression for the time. The system will auto-create a new task if no existing one matches.
- "expense": User wants to log spending/money. CRITICAL: Any message that contains a currency symbol ($, €, £) followed by a number, OR a number followed by a currency symbol, OR mentions spending/paying at a specific merchant with an amount, is ALWAYS an expense. Examples: "spent $45 on dinner", "$20 gas", "Amazon $57.85", "$57.85 Amazon", "€30 groceries", "coffee £4.50", "paid 25 at Walmart", "Starbucks $5.75", "Uber €12", "lunch 15". Set amount and expense_description parameters. If the message is JUST a merchant name + amount (e.g., "Amazon $57.85"), it is ALWAYS expense, never create.
- "chat": User wants conversational interaction — briefings, motivation, planning, greetings (e.g., "good morning", "how am I doing?", "summarize my week", "what should I focus on?", "help me plan my day")
- "contextual_ask": (ALREADY DEFINED ABOVE — see intents list). IMPORTANT: If the message describes a NEW item/event/appointment (especially with a date, time, or location), it is NOT contextual_ask — it is "create". Only use contextual_ask when the user is clearly querying/asking about data they already saved.
- "web_search": User wants EXTERNAL information from the web — booking links, reviews, directions, prices, availability, or any information NOT already in their saved data. Examples: "can you give me the link to book it?", "search for more information on X", "find me reviews for Y", "what's the address of Z?", "how do I get there?", "is it open now?", "find me a link", "look it up online", "search the web for X". IMPORTANT: If the user asks about something they already saved BUT wants ADDITIONAL external info (booking link, website, directions), classify as "web_search" NOT "contextual_ask". The key signal is that they want info from the INTERNET, not from their saved items.
- "merge": User wants to merge duplicate tasks (exactly "merge")
- "create_list": User EXPLICITLY asks to CREATE A NEW LIST — they must use words like "create a list", "make a list", "start a list", "new list" + a topic/name. Examples: "create a list about wedding planning", "make a list for our trip to Rome", "start a grocery list", "new list: Home Renovation". This is NOT for creating a task — it's specifically for creating a new organizational LIST/FOLDER. The list_name parameter should contain the desired list name extracted from the message. If the user also provides initial items (e.g., "create a list of books: Atomic Habits, Deep Work"), include them in the partner_message_content parameter (repurposed for initial items). Set confidence to 0.9+.
- "list_recap": User wants a DETAILED RECAP or REVIEW of a specific list — they want to see every item with full details, status, due dates, and an overall summary. Trigger words: "recap", "review", "summarize", "detail", "breakdown", "overview" combined with a list name. Examples: "recap my groceries list", "give me a detailed review of my travel list", "summarize my work list", "what's the status of my home improvement list?", "review everything in my books list". This is DIFFERENT from "search" (which shows a simple numbered list) — list_recap provides an AI-generated analytical summary with insights. Set list_name parameter to the target list name.
- "partner_message": User wants to send a message TO their partner via Olive (e.g., "remind Marco to buy lemons", "tell Almu to pick up the kids", "ask partner to call the dentist", "let Marcus know dinner is ready", "dile a Marco que compre limones", "ricorda a Marco di comprare i limoni"). The user is asking YOU to relay a message or task to their partner. Set partner_message_content to the message/task for the partner, and partner_action to the type (remind/tell/ask/notify).

## MEDIA ATTACHMENT:
${hasMedia ? '⚠️ **THIS MESSAGE HAS A MEDIA ATTACHMENT (image, document, or file).** Messages with media are ALMOST ALWAYS "create" — the user is saving a photo, document, receipt, or visual note. The caption text describes what the media is about. Examples: [image] + "Health info urologist" = CREATE (saving health document). [image] + "Sofa measures" = CREATE (saving measurements). [image] + "Receipt from dinner" = CREATE or expense. The ONLY exceptions: "$25 receipt" with image = expense. An image with NO caption was already handled separately. ALWAYS classify media+caption as "create" unless the caption is clearly an expense with $ amount.' : 'No media attached.'}

## CRITICAL RULES:

### RULE 0: BRAIN DUMP DEFAULT — CREATE UNLESS PROVEN OTHERWISE
The PRIMARY use case of this app is brain-dumping: users send quick thoughts, tasks, ideas, and the system saves them. When in doubt, classify as "create". A message like "Review taxes in 2 hours" or "Check flights to Rome" or "Pack lunch for tomorrow" is ALWAYS a new task creation — the user is telling Olive what they need to do, NOT asking about existing tasks.

**THE URL/LINK RULE (highest priority):** If the message contains a URL (http:// or https://), it is ALMOST ALWAYS "create" — the user is bookmarking/saving a link with optional context. Examples: "Olive improvements Perplexity APIs https://docs.perplexity.ai/..." = CREATE (saving a link with a note). "Check this out https://example.com" = CREATE. "https://recipe.com/pasta" = CREATE. The ONLY exception is if the user explicitly asks Olive to search or look something up AND includes a URL as context (e.g., "search for reviews about https://..."). But a plain URL or URL + descriptive text = ALWAYS create.

**THE VERB TRAP:** Verbs like "review", "check", "pack", "prepare", "plan", "organize", "call", "schedule", "book", "research", "look into", "figure out", "set up" at the START of a message are INSTRUCTIONS to create a new task. They are NOT search queries. "Review taxes" = CREATE a task to review taxes. "Check the dentist appointment" = could be contextual_ask ONLY if it's phrased as a question ("when is the dentist?"). But "Check dentist appointment on Thursday" with a time = definitely CREATE.

**TIME EXPRESSIONS = STRONG CREATE SIGNAL:** Messages containing relative time expressions like "in 2 hours", "in 30 minutes", "tomorrow", "tonight", "this weekend", "next week", "at 3pm", "by Friday" are almost ALWAYS new tasks being brain-dumped. The user is saying WHEN they need to do something, which means they're creating a task with a deadline. Do NOT search for existing tasks — create a new one. Set due_date_expression to the time component.

**KEY TEST:** Ask yourself: "Is the user TELLING Olive about something new to track, or ASKING about something already saved?" If telling → create. If asking → contextual_ask or search.

1. **Conversational context is king.** Use CONVERSATION HISTORY to resolve "it", "that", "this", "the last one", pronouns in any language. If someone says "cancel it" after discussing a task, the target is that task. If someone says "then schedule it" or "then create it" or "schedule that", they want to CREATE a task based on what they just said in the previous message — classify as "create" with confidence 0.9.
2. **CRITICAL: Follow-up ACTIONS on recently discussed items are NEVER "create".** If the conversation history shows Olive just confirmed saving/creating a task (e.g., "✅ Saved: X"), and the user's next message asks to MODIFY that item (change reminder, change due date, move, delete, set priority, reschedule, postpone), this is ALWAYS the corresponding action intent ("remind", "set_due", "move", "delete", "set_priority") — NEVER "create". The words "change", "update", "modify", "reschedule", "postpone", "move", "set" combined with "that", "it", "this", "for that", "for it" are STRONG signals of a MODIFICATION intent. Set target_task_name to "that" or the pronoun used — the system resolves it via session context.
3. **Match tasks PRECISELY — but DON'T over-match for CREATE messages.** Use ACTIVE TASKS to find which task the user refers to ONLY when the intent is clearly an ACTION (complete, delete, set_priority, set_due, move, assign, remind) or a SEARCH. For brain-dump style messages (verb + content + optional time), do NOT try to match against existing tasks — it's a new item. Only match if the user uses explicit action language like "done with X", "delete X", "mark X complete", "show me X". The user says "Review taxes in 2 hours" → this is a NEW task, NOT a search for existing tasks containing "review". The user says "done with review taxes" → this IS an action on an existing task.
4. **Use memories for personalization.** MEMORIES tell you who Marcus is, what Milka is (a dog?), dietary preferences, etc. Use this to disambiguate.
5. **"Cancel" is context-dependent.** "Cancel the dentist" = delete. "Cancel that" after a reminder = delete. But "cancel my subscription" = probably create (a task to cancel).
6. **Time expressions = set_due, not create — ONLY for modifications.** "Change it to 7am", "move it to Friday", "postpone", "reschedule" → always set_due because these words imply modifying an EXISTING task. But "Call doctor at 7am" or "Review taxes in 2 hours" → CREATE with due_date_expression, because there's no modification verb.
7. **Relative references.** "Last task", "the latest one", "previous task", "l'ultima attività", "última tarea" → preserve the EXACT phrase in target_task_name. The system resolves it. These are action intents, never "create".
8. **Questions about data = contextual_ask, NOT search.** "When is X?", "What did I save about Y?", "Do I have any Z?", "Which restaurants I have?", "What's in my travel list?" → contextual_ask. The word "search" is reserved for DASHBOARD commands like "show my tasks" or "what's urgent". If the user is asking a QUESTION (interrogative) about specific content → contextual_ask. If they want a dashboard/summary view → search.
9. **New items with details = create.** If the message contains a date, time, location, or appointment-like details AND does NOT use modification verbs (change, update, postpone, reschedule, move), it is always "create". Example: "Oliva vet visit at Banfield on 20-Mar at 5pm" → CREATE.
10. **Ambiguity → lean towards CREATE for imperative/statement forms, contextual_ask for question forms.** If someone says "groceries" with no verb → probably search (dashboard). If someone says "Review taxes in 2 hours" → definitely CREATE (imperative + time). If someone says "which restaurants?" or "what books do I have?" → contextual_ask (question about content). Only use "search" for explicit dashboard requests.
11. **Language:** The user speaks ${userLanguage}. Understand their message natively in that language.
12. **Confidence:** 0.9+ clear, 0.7-0.9 moderate, 0.5-0.7 uncertain, <0.5 very ambiguous.
13. For chat_type, use: briefing, weekly_summary, daily_focus, productivity_tips, progress_check, motivation, planning, greeting, general.
14. **SINGLE-WORD LIST MATCH:** If the user's message is a SINGLE WORD (or a very short phrase with no verb) that exactly matches one of their EXISTING LISTS (see USER'S EXISTING LISTS below), classify as "search" — they want to see that list. Examples: user has a list "Groceries" and sends "groceries" → search. User has "Books" list and sends "books" → search. But "buy groceries" → create (has a verb).
15. **"ADD X TO Y" PATTERN:** "Add milk to groceries", "put this in my work list", "aggiungi latte alla spesa" → ALWAYS "create" (NOT create_list). The system routes the item to the correct list automatically. "create_list" is ONLY for when the user wants to make a BRAND NEW list that doesn't exist yet.
16. **REMIND-CREATE HYBRID:** "Remind me to buy milk tomorrow" or "Remind me about the meeting at 5pm" — if the subject IS a new task (buy milk, call doctor, etc.), classify as "remind" with target_task_name set to the task description (e.g., "buy milk") and due_date_expression to the time (e.g., "tomorrow"). The system will auto-create the task AND set the reminder. Do NOT classify as "create" — use "remind" so the reminder is set automatically.
17. **CONVERSATION CONTINUITY — NEVER break the thread.** If the conversation history shows Olive just answered a contextual_ask or web_search (e.g., listed restaurants, gave booking info, showed search results), and the user sends a follow-up message about the SAME topic (e.g., "do they offer reservations?", "what about the second one?", "can you find me a link?", "I meant the restaurant one"), this MUST be classified as:
   - "web_search" if they want EXTERNAL info (reservations, booking, directions, link, website, reviews, hours, phone)
   - "contextual_ask" if they want info from their SAVED data about the same topic
   - NEVER "create" for follow-up questions/clarifications. A follow-up question is NOT a brain dump.
   The KEY TEST: Does the conversation history show Olive recently answered a question or showed search results? If yes, and the user's message continues that thread → web_search or contextual_ask, NOT create.
18. **Clarifications and corrections are ALWAYS continuations.** Messages like "I meant X", "no, the Y one", "not that one", "the restaurant", "I was asking about Z" are ALWAYS follow-ups to the previous turn. Route them the same way as the previous Olive response (web_search → web_search, contextual_ask → contextual_ask). NEVER classify these as "create".

## LIST MANAGEMENT EXAMPLES (CRITICAL — distinguish from search/create):
- "Create a list about wedding planning" → create_list (list_name="Wedding Planning")
- "Make a list for our trip to Rome" → create_list (list_name="Trip to Rome")
- "Start a grocery list" → create_list (list_name="Groceries")
- "New list: Home Renovation" → create_list (list_name="Home Renovation")
- "Create a list of books to read: Atomic Habits, Deep Work" → create_list (list_name="Books to Read", items in partner_message_content)
- "Crea una lista per la spesa" → create_list (list_name="Spesa")
- "Crea una lista sobre viajes" → create_list (list_name="Viajes")
- "Show my groceries list" → search (dashboard view of existing list)
- "What's in my travel list?" → search or contextual_ask (querying existing data)
- "Recap my work list" → list_recap (detailed analytical review)
- "Review my groceries" → list_recap (detailed review with insights)
- "Summarize my travel list" → list_recap (AI-generated summary)
- "Give me a breakdown of my home improvement list" → list_recap
- "What's the status of my books list?" → list_recap (status review)
- "Riassumi la mia lista della spesa" → list_recap
- "Resume mi lista de viajes" → list_recap
- "Buy groceries" → CREATE (new task, NOT create_list)
- "Add milk to groceries" → CREATE (new task routed to groceries list)

## DISAMBIGUATION EXAMPLES (to prevent common mistakes):
- "Review taxes in 2 hours" → CREATE (brain dump with deadline, NOT a search)
- "Check flights to Rome" → CREATE (new task to check flights)
- "Pack lunch for tomorrow" → CREATE (new task with time)
- "Call mom at 3pm" → CREATE (new task with time)
- "Prepare presentation by Friday" → CREATE (new task with deadline)
- "When is the dentist?" → contextual_ask (question about existing data)
- "Which restaurants I have in my list?" → contextual_ask (question about saved content)
- "What books are on my reading list?" → contextual_ask (question about saved content)
- "Do I have any travel plans?" → contextual_ask (question about saved data)
- "Any date ideas?" → contextual_ask (asking for suggestions from saved data)
- "¿Qué restaurantes tengo guardados?" → contextual_ask (Spanish question about saved data)
- "Quali ristoranti ho nella mia lista?" → contextual_ask (Italian question about saved data)
- "Show my tasks" → search (dashboard request)
- "What's urgent?" → search (dashboard filter)
- "What's due today?" → search (dashboard filter)
- "Groceries" → search (single-word list name, show dashboard)
- "Show my groceries list" → search (explicit list view request)
- "Done with taxes" → complete (action on existing task)
- "Fix the leaky faucet this weekend" → CREATE
- "Schedule haircut for Saturday" → CREATE
- "Revisar impuestos en 2 horas" → CREATE (Spanish brain dump)
- "Controllare le tasse tra 2 ore" → CREATE (Italian brain dump)

## URL/LINK EXAMPLES (CRITICAL — URLs = save/bookmark, NOT web_search):
- "Olive improvements Perplexity APIs https://docs.perplexity.ai/docs/getting-started/overview" → CREATE (saving a link with descriptive text)
- "https://example.com/recipe" → CREATE (saving a bare link)
- "Check this out https://youtube.com/watch?v=abc" → CREATE (brain dump with link)
- "Great article on AI https://blog.example.com/ai-trends" → CREATE (bookmarking)
- "https://airbnb.com/rooms/12345 for our trip" → CREATE (saving a link for travel)
- "Search for reviews about https://restaurant.com" → web_search (explicit search request WITH a URL — rare exception)

## EXPENSE EXAMPLES (CRITICAL — any message with a currency amount + merchant = expense):
- "Amazon $57.85" → expense (amount=57.85, expense_description="Amazon")
- "$57.85 Amazon" → expense (amount=57.85, expense_description="Amazon")
- "Starbucks $5.75" → expense (amount=5.75, expense_description="Starbucks")
- "€30 groceries" → expense (amount=30, expense_description="groceries")
- "coffee £4.50" → expense (amount=4.50, expense_description="coffee")
- "Uber 12" → expense (amount=12, expense_description="Uber") — even without currency symbol, a known merchant + number = expense
- "spent $45 on dinner" → expense (amount=45, expense_description="dinner")
- "paid 25 at Walmart" → expense (amount=25, expense_description="Walmart")
- "lunch at Chipotle $15" → expense (amount=15, expense_description="lunch at Chipotle")
- "gasolina €40" → expense (amount=40, expense_description="gasolina")
- "pranzo €12" → expense (amount=12, expense_description="pranzo")
- "Buy groceries" → CREATE (no amount = task, NOT expense)
- "Amazon package arrived" → CREATE (no amount = task, NOT expense)

- [After Olive listed restaurants] "Do they offer reservations?" → web_search (follow-up wanting external info)
- [After Olive listed restaurants] "Search for a table at Kebo" → web_search (wanting to book/find external info)
- [After Olive showed search results] "I meant the restaurant Kebo" → web_search (clarification, continue same thread)
- [After Olive answered a question] "Can you give me more details?" → contextual_ask or web_search (continuation)
- [After Olive showed booking info] "Book it" → web_search (wants booking link)
- [After Olive discussed a task] "What about the other one?" → contextual_ask (follow-up about saved data)
- [After ANY Olive response] "No, I meant X" → same intent as previous (clarification, NEVER create)
- [After ANY Olive response] "Not that, the Y one" → same intent as previous (correction, NEVER create)

## CONVERSATION HISTORY:
${recentConvo || "No previous conversation."}

## RECENT OLIVE MESSAGES:
${outboundCtx || "None."}

## USER'S ACTIVE TASKS:
${taskList || "No active tasks."}

## USER'S MEMORIES:
${memoryList || "No memories stored."}

## USER'S ACTIVATED SKILLS:
${skillsList || "No skills activated."}

## USER'S EXISTING LISTS (use to disambiguate list names in create/search/list_recap/move):
${listNamesCtx || "No lists yet."}`;
}

// ─── Main Classification Function ─────────────────────────────

export async function classifyIntent(
  input: ClassificationInput
): Promise<ClassificationResult> {
  if (!GEMINI_KEY) {
    console.warn("[SharedClassifier] No GEMINI_API env var, falling back to regex");
    return { intent: null, latencyMs: 0 };
  }

  const t0 = Date.now();
  try {
    const genai = new GoogleGenAI({ apiKey: GEMINI_KEY });

    const response = await genai.models.generateContent({
      model: getModel("lite"), // gemini-2.5-flash-lite — fast, cheap, structured output
      contents: input.hasMedia 
        ? `Classify this message (sent WITH a media attachment — image, document, or file): "${input.message}"`
        : `Classify this message: "${input.message}"`,
      config: {
        systemInstruction: buildClassificationPrompt(input),
        responseMimeType: "application/json",
        responseSchema: INTENT_SCHEMA,
        temperature: 0.1,
        maxOutputTokens: 500,
      },
    });

    const latencyMs = Date.now() - t0;
    const responseText = response.text || "";
    const result: ClassifiedIntent = JSON.parse(responseText);

    console.log(
      `[SharedClassifier] intent=${result.intent}, confidence=${result.confidence}, task_id=${result.target_task_id}, skill=${result.matched_skill_id}, latency=${latencyMs}ms, reasoning=${result.reasoning}`
    );

    return { intent: result, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - t0;
    console.error("[SharedClassifier] Error, falling back to regex:", error);
    return { intent: null, latencyMs };
  }
}

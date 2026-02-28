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
  userLanguage?: string; // defaults to "en"
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
        "merge",
        "partner_message",
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

  // Build conversation context (last 3 exchanges = 6 messages)
  const recentConvo = input.conversationHistory
    .slice(-6)
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

  return `You are the intent classifier for Olive, an AI personal assistant that helps people manage their lives. You are the "brain" that decides what action to take. Classify the user's message into exactly ONE intent. Return structured JSON.

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
- "contextual_ask": User is asking a question about their saved data, agent results, or wants AI-powered advice (e.g., "when is the dentist?", "what restaurants did I save?", "any date ideas?", "what books are on my list?", "what did my agents find?", "any agent insights?", "what did olive analyze?")
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
${recentConvo || "No previous conversation."}

## RECENT OLIVE MESSAGES:
${outboundCtx || "None."}

## USER'S ACTIVE TASKS:
${taskList || "No active tasks."}

## USER'S MEMORIES:
${memoryList || "No memories stored."}

## USER'S ACTIVATED SKILLS:
${skillsList || "No skills activated."}`;
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
      contents: `Classify this message: "${input.message}"`,
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

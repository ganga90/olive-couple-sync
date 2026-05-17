import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
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
  detectSetDueRefinement,
  detectMisroutedPartnerRelay,
} from "../_shared/conversation-continuity.ts";
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
import {
  insertNote,
  insertNotesBatch,
  whatsappSourceFromMessageType,
  type NoteSource,
} from "../_shared/note-insert.ts";
// TASK-10X-Phase8a — i18n response templates + helpers extracted here.
// The inline RESPONSES dict, LANG_NAMES, t(), and langName() helpers
// moved to _shared/whatsapp-localization.ts. Behaviour is identical;
// other edge functions can now reuse the registry instead of duplicating
// strings.
import {
  t,
  langName,
  RESPONSES,
  LANG_NAMES,
} from "../_shared/whatsapp-localization.ts";
// TASK-10X-Phase8b — touchGatewaySession extracted from this file.
import { touchGatewaySession } from "../_shared/whatsapp-session.ts";
// TASK-10X-Phase8c — outbound-context helpers extracted from this file.
import {
  getRecentOutboundMessages,
  extractTaskFromOutbound,
  getOutboundContextWithTaskId,
  type RecentOutbound,
} from "../_shared/whatsapp-outbound-context.ts";
import { assembleContextSoul } from "../_shared/context-soul/index.ts";
import { resolveAddendum } from "../_shared/prompt-evolution/ab-router.ts";
// TASK-10X-Phase8d — Meta webhook payload parser + coordinate guard
// + size caps extracted from this file.
import {
  extractMetaMessage,
  isValidCoordinates,
  MAX_MESSAGE_LENGTH,
  MAX_MEDIA_COUNT,
  type MetaMessageData,
} from "../_shared/whatsapp-meta-parser.ts";
import {
  isBadTitle,
  isPendingOfferFresh,
  looksLikeConfirmation,
  type PendingOffer,
} from "../_shared/pending-offer.ts";
// Change 3 — topical follow-up: silent-attach a sub-detail
// ("Email: foo@bar.com") to a recent parent note when the user types
// "Email for <Topic>\n<value>" within the look-back window. The user
// can undo within the offer TTL by replying "undo" / "no" / "split".
import {
  attachToParent,
  findFollowupParent,
} from "../_shared/topical-followup.ts";
// Initiative 1.2 of OLIVE_REFACTOR_PLAN.md — first handler extracted
// from this monolith. SAVE_ARTIFACT now lives in handlers/save-artifact.ts
// with co-located unit tests. The dispatch site below builds a
// HandlerContext, calls the handler, applies the returned Reply.
import { makeSaveArtifactHandler } from "./handlers/save-artifact.ts";
// Initiative 1.3 — the three pending-offer SafetyNets (#1.4, #1.4b,
// #1.4c) collapsed into a single dispatcher in handlers/confirmation.ts.
// Returns a `ConfirmationOutcome`; the call site applies the right
// effect (override intent / send reply / pass through).
import { makeConfirmationDispatcher } from "./handlers/confirmation.ts";
// Initiative 1.4 — CHAT handler (the largest single intent, ~1,000 lines)
// extracted from this monolith. Owns 11 chat-type prompts, context
// assembly, Pro→Flash fallback, and the 3 after-reply side-effects
// (session write, memory evolution, daily log append).
import { makeChatHandler } from "./handlers/chat.ts";
import type { HandlerContext as SharedHandlerContext } from "../_shared/types.ts";
// Phase 1 WhatsApp port: shared with web Ask Olive.
import {
  buildWhatsAppCalendarSuffix,
  whatsappCalendarDelete,
  whatsappCalendarUpdate,
} from "../_shared/whatsapp-calendar-sync.ts";
import {
  isLastActionUndoable,
  looksLikeUndoCommand,
  type LastAction,
} from "../_shared/web-session.ts";
import { executeUndo } from "../_shared/action-executor-offers.ts";
// Phase 3.1 — conflict detection at offer time.
import { findConflicts, type ConflictSummary } from "../_shared/conflict-detector.ts";
import { buildWhatsAppConflictSuffix } from "../_shared/whatsapp-conflict-copy.ts";
// Phase 3.5 — pattern learning.
import {
  findMatchingPatterns,
  recordReschedulePattern,
  type MatchedPattern,
} from "../_shared/pattern-detector.ts";
import { buildWhatsAppPatternSuffix } from "../_shared/whatsapp-pattern-copy.ts";
// Phase 3.2 — bulk reschedule helpers (resolver + shifter).
import { resolveWeekdayCandidates, shiftToWeekday } from "../_shared/bulk-resolver.ts";

// Phase 3.2 — small locale helpers used by bulk offer + confirmation
// copy. Kept inline in the webhook because they only matter for
// WhatsApp's t()-templated voice and don't share the offer-copy.ts
// markdown style.
const BULK_DAY_NAMES_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const BULK_DAY_NAMES_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const BULK_DAY_NAMES_IT = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

function bulkDayName(dow: number, lang: string): string {
  const idx = Math.max(0, Math.min(6, dow));
  const short = (lang || "en").split("-")[0];
  if (short === "es") return BULK_DAY_NAMES_ES[idx];
  if (short === "it") return BULK_DAY_NAMES_IT[idx];
  return BULK_DAY_NAMES_EN[idx];
}

function tasksWord(n: number, lang: string): string {
  const short = (lang || "en").split("-")[0];
  if (short === "es") return n === 1 ? "tarea" : "tareas";
  // Italian plural of "attività" is invariant.
  if (short === "it") return "attività";
  return n === 1 ? "task" : "tasks";
}
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

// `RecentOutbound` interface moved to _shared/whatsapp-outbound-context.ts
// (TASK-10X-Phase8c); re-imported above.

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


// _shared/whatsapp-outbound-context.ts owns the helpers above (Phase 8c)

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
  // Bucket 3 — source attribution. Threaded from the IIFE handler scope
  // so every clerk_notes insert in this path is tagged with the upstream
  // WhatsApp message id and the derived channel.
  inboundNoteSource: NoteSource,
  wamid: string,
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
    const { data: insertedNote, error: insertError } = await insertNote(supabase, {
      author_id: userId,
      couple_id: effectiveCoupleId,
      source: inboundNoteSource,
      source_ref: wamid,
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
    });
    if (insertError || !insertedNote) {
      console.error("[Cluster CREATE] insert error:", insertError);
      continue;
    }
    insertedNotes.push({
      id: insertedNote.id,
      summary: insertedNote.summary ?? "",
      list_id: insertedNote.list_id,
    });
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
  | 'complete'           // "done with X", "mark X complete"
  | 'set_priority'       // "make X urgent", "prioritize X"
  | 'set_due'            // "X is due tomorrow"
  | 'assign'             // "assign X to partner"
  | 'edit'               // legacy generic edit (pre-1.2)
  // Phase 1.2 WhatsApp port — generic edit intents from the shared
  // classifier. Each carries its specific new_* value via cleanMessage.
  | 'edit_title'         // "rename X to Y"
  | 'edit_location'      // "set location of X to Y"
  | 'edit_description'   // "update notes on X to Y"
  | 'edit_duration'      // "make X a 30-minute event"
  | 'delete'             // "delete X", "remove X"
  | 'move'               // "move X to groceries list"
  | 'remind'             // "remind me about X tomorrow"
  // Phase 3.2 — bulk operations. v1 is weekday shift.
  | 'bulk_reschedule_weekday';

type QueryType = 'urgent' | 'today' | 'tomorrow' | 'this_week' | 'recent' | 'overdue' | 'general' | undefined;

// Chat subtypes for specialized AI handling — owned by handlers/chat.ts
// (Initiative 1.4). Re-imported here so the dispatcher + classifier still
// type-check the chatType field they emit before handing off to the handler.
import type { ChatType } from "./handlers/chat.ts";

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
// detectChatType → moved to handlers/chat.ts (Initiative 1.4)
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
): IntentResult & { queryType?: string; chatType?: string; actionType?: string; actionTarget?: string; cleanMessage?: string; _aiTaskId?: string; _aiSkillId?: string; _listName?: string; _partnerAction?: string; _initialItems?: string; _fromDow?: number; _toDow?: number } {
  const params = ai.parameters || {};

  switch (ai.intent) {
    case 'search':
      return {
        intent: 'SEARCH',
        queryType: params.query_type || 'general',
        cleanMessage: ai.target_task_name || undefined,
        _listName: params.list_name || undefined,
        // Carry an explicit date expression for SEARCH so follow-ups
        // like "And for Friday?" after a calendar query render a
        // Friday-scoped agenda instead of defaulting to today's.
        _dueDateExpr: params.due_date_expression || undefined,
      } as any;

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

    // Phase 1.2 WhatsApp port — generic edit intents. The classifier emits
    // the new_* parameter alongside `target_task_name`; we forward it via
    // `cleanMessage` for the action handler to read.
    case 'edit_title':
      return {
        intent: 'TASK_ACTION',
        actionType: 'edit_title',
        actionTarget: ai.target_task_name || undefined,
        cleanMessage: params.new_title || undefined,
        _aiTaskId: ai.target_task_id || undefined,
        _aiSkillId: ai.matched_skill_id || undefined,
      };

    case 'edit_location':
      return {
        intent: 'TASK_ACTION',
        actionType: 'edit_location',
        actionTarget: ai.target_task_name || undefined,
        cleanMessage: params.new_location || undefined,
        _aiTaskId: ai.target_task_id || undefined,
        _aiSkillId: ai.matched_skill_id || undefined,
      };

    case 'edit_description':
      return {
        intent: 'TASK_ACTION',
        actionType: 'edit_description',
        actionTarget: ai.target_task_name || undefined,
        cleanMessage: params.new_description || undefined,
        _aiTaskId: ai.target_task_id || undefined,
        _aiSkillId: ai.matched_skill_id || undefined,
      };

    case 'edit_duration':
      return {
        intent: 'TASK_ACTION',
        actionType: 'edit_duration',
        actionTarget: ai.target_task_name || undefined,
        cleanMessage: params.new_duration_minutes != null ? String(params.new_duration_minutes) : undefined,
        _aiTaskId: ai.target_task_id || undefined,
        _aiSkillId: ai.matched_skill_id || undefined,
      };

    // Phase 3.2 — bulk weekday reschedule. No actionTarget (the
    // resolver picks the candidate set from the from_dow predicate).
    case 'bulk_reschedule_weekday':
      return {
        intent: 'TASK_ACTION',
        actionType: 'bulk_reschedule_weekday',
        _fromDow: typeof params.from_dow === 'number' ? params.from_dow : undefined,
        _toDow: typeof params.to_dow === 'number' ? params.to_dow : undefined,
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

// OLIVE SKILLS — SkillMatch + matchUserSkills moved to handlers/chat.ts (Initiative 1.4).

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

// _shared/whatsapp-meta-parser.ts owns the Meta webhook parser, MetaMessageData, isValidCoordinates, MAX_MESSAGE_LENGTH, MAX_MEDIA_COUNT (Phase 8d).

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

    // Mutable refs declared OUTSIDE the try so the top-level catch can
    // attribute the error to a user when authentication had already
    // completed. The try body assigns these once we know who's calling.
    let _authenticatedUserId: string | null = null;

  try {
    const { fromNumber: rawFromNumber, messageBody: rawMessageBody, mediaItems, latitude, longitude, phoneNumberId, messageId, messageType, quotedMessageId, receivedAtIso } = messageData;
    const fromNumber = standardizePhoneNumber(rawFromNumber);

    // Source attribution (Bucket 3): derived once at handler scope and reused
    // at every clerk_notes insert site. `wamid` is Meta's per-message id
    // (already destructured above as `messageId`); aliased for clarity at
    // call sites.
    const wamid: string = messageId;
    const inboundNoteSource: NoteSource = whatsappSourceFromMessageType(messageType);

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
      return reply(t('error_message_too_long', userLang));
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
      return reply(t('error_invalid_location', userLang));
    }
    
    // Download and upload media from Meta
    const mediaUrls: string[] = [];
    const mediaTypes: string[] = [];
    let mediaDownloadFailed = false;
    
    if (mediaItems.length > MAX_MEDIA_COUNT) {
      console.warn('[Validation] Too many media attachments:', mediaItems.length);
      return reply(t('error_too_many_attachments', userLang, { count: String(mediaItems.length), max: String(MAX_MEDIA_COUNT) }));
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
        return reply(t('error_voice_unavailable', userLang));
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
      return reply(t('location_shared', userLang, { lat: String(latitude), lon: String(longitude) }));
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
                  inboundNoteSource,
                  wamid,
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

    let mediaRoutingHint: 'receipt' | 'task' | 'text' | 'contact' | 'other' | null = null;
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
                { text: "Classify this media into ONE word ONLY. Reply with exactly one of: RECEIPT (a receipt/invoice/bill), CONTACT (a business card, contact card, or photo of someone's name + phone/email/title/organization), TASK (a to-do, reminder, or actionable item), TEXT (a screenshot of text/document), or OTHER. No explanation, just the single label." },
                { inlineData: { mimeType: media.mimeType, data: media.base64 } }
              ]}],
              config: { temperature: 0, maxOutputTokens: 10 }
            });

            const label = (descResponse.text || '').trim().toUpperCase();
            if (label.startsWith('RECEIPT')) mediaRoutingHint = 'receipt';
            else if (label.startsWith('CONTACT')) mediaRoutingHint = 'contact';
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
        // Pre-classification hint from the cheap vision check above. Lets
        // process-note bias toward the right shape (a business card becomes
        // ONE contact note with all sub-details, never multiple stub notes).
        media_hint: mediaRoutingHint ?? undefined,
      };

      console.log('[WhatsApp] Sending media-only to process-note:', mediaUrls.length, 'files, types:', mediaTypes);

      const { data: processData, error: processError } = await supabase.functions.invoke('process-note', {
        body: mediaPayload
      });

      if (processError) {
        console.error('Error processing media note:', processError);
        return reply(t('error_image_processing', userLang));
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
          const { data: insertedNote, error: insertError } = await insertNote(supabase, {
            author_id: mediaUserId,
            couple_id: mediaEffectiveCoupleId,
            source: 'whatsapp-media',
            source_ref: wamid,
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
          });

          if (insertError || !insertedNote) {
            console.error('[WhatsApp] Insert error for media note:', insertError);
            continue; // Skip failed inserts, try the rest
          }
          insertedNotes.push({ id: insertedNote.id, summary: insertedNote.summary ?? '', list_id: insertedNote.list_id });
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
      
      return reply(t('error_empty_input', userLang));
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
        return reply(t('error_invalid_token', userLang));
      }

      const { error: updateError } = await supabase
        .from('clerk_profiles')
        .update({ phone_number: fromNumber })
        .eq('id', tokenData.user_id);

      if (updateError) {
        console.error('Error linking WhatsApp:', updateError);
        return reply(t('error_link_failed', userLang));
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
        return reply(t('error_generic', userLang));
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

    // Resolve the partner's display name (if any) so the intent classifier
    // can validate "text/tell/remind <NAME>" verbs against the actual
    // partner. Without this, the classifier had no way to tell that
    // "Text Jacopo Amazon" was a brain-dump task — not a partner relay
    // to Almu. Read once per request; failure is non-fatal (we just pass
    // null to the classifier, which falls back to safer "create" bias).
    let resolvedPartnerName: string | null = null;
    let resolvedSelfName: string | null = null;
    if (coupleId) {
      try {
        const { data: coupleRow } = await supabase
          .from('clerk_couples')
          .select('you_name, partner_name, created_by')
          .eq('id', coupleId)
          .maybeSingle();
        if (coupleRow) {
          const isCreator = coupleRow.created_by === userId;
          resolvedPartnerName = (isCreator ? coupleRow.partner_name : coupleRow.you_name) || null;
          resolvedSelfName = (isCreator ? coupleRow.you_name : coupleRow.partner_name) || null;
        }
      } catch (couplenameErr) {
        console.warn(
          '[Couple] partner-name lookup failed (non-fatal):',
          couplenameErr instanceof Error ? couplenameErr.message : couplenameErr,
        );
      }
    }

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
        let selectedIndex = numMatch ? parseInt(numMatch[1]) - 1 : -1;

        // Single-candidate "Did you mean X?" offer also accepts "yes"
        // (multilingual) as pick #1. Without this, the user has to type
        // "1" which feels unnatural when there's only one option.
        if (selectedIndex === -1 && candidates.length === 1) {
          const isAffirmSingle = /^(yes|yeah|yep|sure|ok|okay|confirm|si|sí|sì|do it|go ahead|please|y)$/i
            .test(messageBody.trim());
          if (isAffirmSingle) {
            selectedIndex = 0;
          }
        }

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

      // Helper to clear pending state while preserving conversation context.
      // last_action is preserved across this so a user who cancels an
      // offer still has their previous successful mutation undo-able.
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
              last_action: (preservedContext as any).last_action,
              // pending_action intentionally omitted (cleared)
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', session.id);
      };

      // Phase 1.4 — stamp last_action after every confirmed mutation.
      // Atomically:
      //   - clears pending_action (we're past the confirmation point)
      //   - flips state to IDLE
      //   - writes the new last_action for the 5-minute undo window
      //   - preserves the small set of context fields we care about
      // Errors are non-fatal: a missing stamp just means undo won't
      // catch this turn. The mutation itself is already committed.
      const stampLastAction = async (
        _sb: SupabaseClient,
        _sessionId: string,
        _ctxData: any,
        action: LastAction,
      ) => {
        const preserved = (contextData || {}) as ConversationContext;
        try {
          await supabase
            .from('user_sessions')
            .update({
              conversation_state: 'IDLE',
              context_data: {
                last_referenced_entity: preserved.last_referenced_entity,
                entity_referenced_at: preserved.entity_referenced_at,
                conversation_history: preserved.conversation_history,
                last_action: action,
              },
              updated_at: new Date().toISOString(),
            })
            .eq('id', session.id);
        } catch (stampErr) {
          console.warn('[stampLastAction] non-fatal:', stampErr);
        }
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

          // Phase 1 WhatsApp port — propagate to Google Calendar. Errors
          // never block the reply; sync state flows back via the suffix.
          // We treat the stored ISO as all-day if it ends in midnight UTC
          // and is exactly 10 chars or T00:00 — the offer builder hands
          // us the parser's output verbatim, which preserves whether a
          // time was specified.
          const dueIso: string = pendingAction.date;
          const allDay = typeof dueIso === 'string' && (dueIso.length <= 10 || /T00:00:00(\.000)?Z?$/.test(dueIso));
          const calSync = await whatsappCalendarUpdate(supabase, {
            user_id: userId,
            note_id: pendingAction.task_id,
            start_time: dueIso,
            all_day: allDay,
            timezone: pendingAction.timezone || profile.timezone || 'America/New_York',
          });
          const calSuffix = buildWhatsAppCalendarSuffix(calSync, userLang);

          // Stamp last_action for undo. Done in the same write that
          // clears pending_action so we never end up in a half-state.
          await stampLastAction(supabase, session.id, session.context_data, {
            kind: 'reschedule_task',
            task_id: pendingAction.task_id,
            task_summary: pendingAction.task_summary,
            prior_due_date: pendingAction.prior_due_date ?? null,
            prior_reminder_time: pendingAction.prior_reminder_time ?? null,
            new_due_date: dueIso,
            new_reminder_time: null,
            calendar_synced: calSync.status === 'updated',
            executed_at: new Date().toISOString(),
          });

          // Phase 3.5 — record the (prior, new) so the pattern store
          // accumulates user habits. Non-blocking.
          await recordReschedulePattern(supabase, {
            userId,
            priorIso: pendingAction.prior_reminder_time || pendingAction.prior_due_date || null,
            newIso: dueIso,
            timezone: pendingAction.timezone || profile.timezone || 'America/New_York',
          });

          return reply(
            t('done_set_due', userLang, { task: pendingAction.task_summary, when: pendingAction.readable })
            + calSuffix
            + t('undo_hint', userLang),
          );
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

          // Calendar sync: reminder is always a timed event.
          const calSync = await whatsappCalendarUpdate(supabase, {
            user_id: userId,
            note_id: pendingAction.task_id,
            start_time: pendingAction.time,
            all_day: false,
            timezone: pendingAction.timezone || profile.timezone || 'America/New_York',
          });
          const calSuffix = buildWhatsAppCalendarSuffix(calSync, userLang);

          await stampLastAction(supabase, session.id, session.context_data, {
            kind: 'reschedule_task',
            task_id: pendingAction.task_id,
            task_summary: pendingAction.task_summary,
            prior_due_date: pendingAction.prior_due_date ?? null,
            prior_reminder_time: pendingAction.prior_reminder_time ?? null,
            new_due_date: pendingAction.has_due_date ? null : pendingAction.time,
            new_reminder_time: pendingAction.time,
            calendar_synced: calSync.status === 'updated',
            executed_at: new Date().toISOString(),
          });

          // Phase 3.5 — record the (prior, new) so the pattern store
          // accumulates user habits. Non-blocking.
          await recordReschedulePattern(supabase, {
            userId,
            priorIso: pendingAction.prior_reminder_time || pendingAction.prior_due_date || null,
            newIso: pendingAction.time,
            timezone: pendingAction.timezone || profile.timezone || 'America/New_York',
          });

          return reply(
            t('done_set_reminder', userLang, { task: pendingAction.task_summary, when: pendingAction.readable })
            + calSuffix
            + t('undo_hint', userLang),
          );
        } else if (pendingAction?.type === 'delete') {
          // Tear down Google Calendar event FIRST. The FK on
          // calendar_events.note_id is ON DELETE SET NULL, so deleting
          // the note first would orphan the calendar row with no way
          // back. Errors are non-fatal.
          const calSync = await whatsappCalendarDelete(supabase, {
            user_id: userId,
            note_id: pendingAction.task_id,
          });
          const calSuffix = buildWhatsAppCalendarSuffix(calSync, userLang);

          await supabase
            .from('clerk_notes')
            .delete()
            .eq('id', pendingAction.task_id);

          await stampLastAction(supabase, session.id, session.context_data, {
            kind: 'delete_task',
            task_summary: pendingAction.task_summary,
            restored_row: pendingAction.restored_row ?? {},
            google_event_id: pendingAction.google_event_id ?? null,
            executed_at: new Date().toISOString(),
          });

          return reply(
            t('done_delete', userLang, { task: pendingAction.task_summary })
            + calSuffix
            + t('undo_hint', userLang),
          );
        } else if (pendingAction?.type === 'edit_title') {
          await supabase
            .from('clerk_notes')
            .update({ summary: pendingAction.new_title, updated_at: new Date().toISOString() })
            .eq('id', pendingAction.task_id);
          const calSync = await whatsappCalendarUpdate(supabase, {
            user_id: userId,
            note_id: pendingAction.task_id,
            title: pendingAction.new_title,
            timezone: pendingAction.timezone || profile.timezone || 'America/New_York',
          });
          await stampLastAction(supabase, session.id, session.context_data, {
            kind: 'edit_task',
            task_id: pendingAction.task_id,
            task_summary: pendingAction.task_summary,
            prior: { summary: pendingAction.prior_summary, description: null },
            new: { summary: pendingAction.new_title },
            calendar_synced: calSync.status === 'updated',
            executed_at: new Date().toISOString(),
          });
          return reply(
            t('done_edit_title', userLang, { task: pendingAction.task_summary, new_title: pendingAction.new_title })
            + buildWhatsAppCalendarSuffix(calSync, userLang)
            + t('undo_hint', userLang),
          );
        } else if (pendingAction?.type === 'edit_location') {
          // Location lives only on calendar_events, not clerk_notes.
          const calSync = await whatsappCalendarUpdate(supabase, {
            user_id: userId,
            note_id: pendingAction.task_id,
            location: pendingAction.new_location,
            timezone: pendingAction.timezone || profile.timezone || 'America/New_York',
          });
          await stampLastAction(supabase, session.id, session.context_data, {
            kind: 'edit_task',
            task_id: pendingAction.task_id,
            task_summary: pendingAction.task_summary,
            // No clerk_notes prior to restore — location undo is calendar-only.
            prior: { summary: pendingAction.task_summary, description: null },
            new: {},
            calendar_synced: calSync.status === 'updated',
            executed_at: new Date().toISOString(),
          });
          return reply(
            t('done_edit_location', userLang, { new_location: pendingAction.new_location })
            + buildWhatsAppCalendarSuffix(calSync, userLang),
          );
        } else if (pendingAction?.type === 'edit_description') {
          await supabase
            .from('clerk_notes')
            .update({ original_text: pendingAction.new_description, updated_at: new Date().toISOString() })
            .eq('id', pendingAction.task_id);
          const calSync = await whatsappCalendarUpdate(supabase, {
            user_id: userId,
            note_id: pendingAction.task_id,
            description: pendingAction.new_description,
            timezone: pendingAction.timezone || profile.timezone || 'America/New_York',
          });
          await stampLastAction(supabase, session.id, session.context_data, {
            kind: 'edit_task',
            task_id: pendingAction.task_id,
            task_summary: pendingAction.task_summary,
            prior: { summary: pendingAction.task_summary, description: pendingAction.prior_description ?? null },
            new: { description: pendingAction.new_description },
            calendar_synced: calSync.status === 'updated',
            executed_at: new Date().toISOString(),
          });
          return reply(
            t('done_edit_description', userLang, { task: pendingAction.task_summary })
            + buildWhatsAppCalendarSuffix(calSync, userLang)
            + t('undo_hint', userLang),
          );
        } else if (pendingAction?.type === 'edit_duration') {
          const calSync = await whatsappCalendarUpdate(supabase, {
            user_id: userId,
            note_id: pendingAction.task_id,
            duration_minutes: pendingAction.new_duration_minutes,
            timezone: pendingAction.timezone || profile.timezone || 'America/New_York',
          });
          // Duration changes don't touch clerk_notes — calendar-only.
          await stampLastAction(supabase, session.id, session.context_data, {
            kind: 'edit_task',
            task_id: pendingAction.task_id,
            task_summary: pendingAction.task_summary,
            prior: { summary: pendingAction.task_summary, description: null },
            new: {},
            calendar_synced: calSync.status === 'updated',
            executed_at: new Date().toISOString(),
          });
          return reply(
            t('done_edit_duration', userLang, { task: pendingAction.task_summary, minutes: String(pendingAction.new_duration_minutes) })
            + buildWhatsAppCalendarSuffix(calSync, userLang),
          );
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
        } else if (pendingAction?.type === 'bulk_reschedule_weekday') {
          // Phase 3.2 — execute the bulk move. Loop through the
          // pre-computed candidates, write per-task, sync each to
          // Google. Per-task failures don't abort the loop; we
          // aggregate calendar outcome into one suffix for the reply.
          const bulkTz = pendingAction.timezone || profile.timezone || 'America/New_York';
          const cands = (pendingAction.candidates || []) as Array<{
            task_id: string;
            task_summary: string;
            prior_due_date: string | null;
            prior_reminder_time: string | null;
            new_iso: string;
            has_time: boolean;
          }>;
          let succeeded = 0;
          let failed = 0;
          let calendarSyncedCount = 0;
          let calendarUnlinkedCount = 0;
          let calendarConnectedSeen = false;
          const undoEntries: Array<{
            task_id: string;
            task_summary: string;
            prior_due_date: string | null;
            prior_reminder_time: string | null;
            new_due_date: string | null;
            new_reminder_time: string | null;
            calendar_synced: boolean;
          }> = [];

          for (const c of cands) {
            const updateFields: Record<string, any> = { updated_at: new Date().toISOString() };
            if (c.has_time) {
              updateFields.reminder_time = c.new_iso;
              updateFields.due_date = c.new_iso.split('T')[0];
            } else {
              updateFields.due_date = c.new_iso.split('T')[0];
              updateFields.reminder_time = null;
            }
            const { error } = await supabase
              .from('clerk_notes')
              .update(updateFields)
              .eq('id', c.task_id);
            if (error) {
              failed++;
              continue;
            }
            const calSync = await whatsappCalendarUpdate(supabase, {
              user_id: userId,
              note_id: c.task_id,
              start_time: c.has_time ? c.new_iso : updateFields.due_date,
              all_day: !c.has_time,
              timezone: bulkTz,
            });
            const synced = calSync.status === 'updated';
            if (synced) calendarSyncedCount++;
            if (calSync.status === 'no_linked_event') calendarUnlinkedCount++;
            if (calSync.status !== 'not_connected') calendarConnectedSeen = true;
            succeeded++;
            undoEntries.push({
              task_id: c.task_id,
              task_summary: c.task_summary,
              prior_due_date: c.prior_due_date,
              prior_reminder_time: c.prior_reminder_time,
              new_due_date: updateFields.due_date || null,
              new_reminder_time: updateFields.reminder_time || null,
              calendar_synced: synced,
            });
            // Phase 3.5 — record per-task pattern. Non-blocking.
            await recordReschedulePattern(supabase, {
              userId,
              priorIso: c.prior_reminder_time || c.prior_due_date,
              newIso: c.new_iso,
              timezone: bulkTz,
            });
          }

          // Stamp last_action for bulk undo.
          await stampLastAction(supabase, session.id, session.context_data, {
            kind: 'bulk_reschedule_task',
            from_dow: pendingAction.from_dow,
            to_dow: pendingAction.to_dow,
            entries: undoEntries,
            executed_at: new Date().toISOString(),
          });

          // Aggregate calendar outcome → suffix.
          let calSuffixKey: string;
          if (!calendarConnectedSeen) {
            calSuffixKey = '';
          } else if (succeeded === 0) {
            calSuffixKey = 'bulk_calendar_none';
          } else if (calendarUnlinkedCount === succeeded) {
            calSuffixKey = '';
          } else if (calendarSyncedCount === succeeded - calendarUnlinkedCount) {
            calSuffixKey = 'bulk_calendar_all';
          } else if (calendarSyncedCount === 0) {
            calSuffixKey = 'bulk_calendar_none';
          } else {
            calSuffixKey = 'bulk_calendar_partial';
          }
          const calSuffix = calSuffixKey ? t(calSuffixKey, userLang) : '';

          const toName = bulkDayName(pendingAction.to_dow, userLang);
          const replyText = failed === 0
            ? t('done_bulk_all', userLang, {
                n: String(succeeded),
                tasks_word: tasksWord(succeeded, userLang),
                to: toName,
              })
            : t('done_bulk_partial', userLang, {
                succeeded: String(succeeded),
                attempted: String(cands.length),
                failed: String(failed),
              });

          return reply(replyText + calSuffix + (succeeded > 0 ? t('undo_hint', userLang) : ''));
        }

        return reply(t('error_generic', userLang));
      } else {
        // Before discarding the pending proposal, try to interpret the
        // message as a REFINEMENT of the same action. The natural
        // conversational pattern is "Olive proposes X → user replies
        // with a tweak rather than yes/no". For `set_due_date`, this
        // means the user is giving a different date — we update the
        // proposal and re-prompt instead of cancelling.
        let retargeted: { updated: any; replyText: string } | null = null;
        try {
          const pending = contextData?.pending_action;
          const tz = (pending as any)?.timezone || profile.timezone || 'America/New_York';
          const refined = detectSetDueRefinement(pending, messageBody, tz, userLang);
          if (refined) {
            retargeted = {
              updated: refined.updated,
              replyText: t('confirm_set_due', userLang, {
                task: refined.updated.task_summary,
                when: refined.parsedReadable,
              }),
            };
          }
        } catch (refineErr) {
          console.warn(
            '[AWAITING_CONFIRMATION] Re-target attempt failed (non-fatal):',
            refineErr instanceof Error ? refineErr.message : refineErr,
          );
        }

        if (retargeted) {
          const preservedCtx = (contextData || {}) as ConversationContext;
          await supabase
            .from('user_sessions')
            .update({
              conversation_state: 'AWAITING_CONFIRMATION',
              context_data: {
                ...preservedCtx,
                pending_action: retargeted.updated,
              },
              updated_at: new Date().toISOString(),
            })
            .eq('id', session.id);
          console.log(
            '[AWAITING_CONFIRMATION] Re-targeted pending set_due_date →',
            retargeted.updated.readable,
          );
          return reply(retargeted.replyText);
        }

        // Non-confirmation message (not yes/no, not a refinement):
        // auto-cancel pending action and fall through to normal processing.
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
    // PRE-CLASSIFICATION: Undo command (Phase 1.4 WhatsApp port)
    // ========================================================================
    // "undo" / "deshacer" / "annulla" — reverses the user's last mutation
    // when it's inside the 5-minute window. Runs BEFORE the shortcut
    // interception and BEFORE intent classification so the classifier
    // can never fight the explicit undo phrasing.
    if (looksLikeUndoCommand(messageBody)) {
      const sessCtx = (session.context_data || {}) as ConversationContext;
      const lastAction = (sessCtx as any).last_action as LastAction | undefined;
      if (isLastActionUndoable(lastAction)) {
        try {
          const undoRes = await executeUndo(
            { supabase, userId, invokedFrom: 'whatsapp-webhook' },
            lastAction,
          );
          // Clear last_action so the user can't double-undo.
          await supabase
            .from('user_sessions')
            .update({
              context_data: { ...sessCtx, last_action: null },
              updated_at: new Date().toISOString(),
            })
            .eq('id', session.id);

          const summary = 'task_summary' in lastAction ? lastAction.task_summary : '';
          if (!undoRes.reverted) {
            return reply(t('undo_failed', userLang, { detail: undoRes.detail || '' }));
          }
          // Phase 3.2 — bulk undo has a different shape (a count, not
          // a single task summary). Handle it separately so the
          // confirmation reads correctly.
          if (undoRes.kind === 'bulk_reschedule_task' && lastAction.kind === 'bulk_reschedule_task') {
            const n = lastAction.entries.length;
            return reply(
              t('done_undo_bulk', userLang, { n: String(n), tasks_word: tasksWord(n, userLang) })
              + (undoRes.detail ? ` (${undoRes.detail})` : ''),
            );
          }
          const doneKey =
            undoRes.kind === 'reschedule_task' ? 'done_undo_reschedule'
            : undoRes.kind === 'delete_task' ? 'done_undo_delete'
            : 'done_undo_edit';
          return reply(t(doneKey, userLang, { task: summary }));
        } catch (undoErr) {
          console.warn('[undo] failed:', undoErr);
          return reply(t('undo_failed', userLang, { detail: 'unexpected error' }));
        }
      }
      // No undoable action available — tell the user honestly. Don't fall
      // through and risk the classifier inventing an action for the
      // word "undo".
      return reply(t('undo_nothing', userLang));
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
      partnerName: resolvedPartnerName,
      selfName: resolvedSelfName,
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

    // ========================================================================
    // POST-CLASSIFICATION SAFETY NET #0.6: PARTNER_MESSAGE → CREATE when the
    // target name is NOT the partner.
    //
    // The classifier prompt now warns about this, but we keep a server-side
    // guardrail because (a) defensive, (b) the AI may still miss it. If the
    // user says "text/tell/remind/ask/message <NAME> ..." and <NAME> is
    // clearly not the partner, treat it as a brain-dump task instead of
    // routing the wrong message to the partner over WhatsApp.
    // ========================================================================
    if (intentResult.intent === 'PARTNER_MESSAGE' && messageBody) {
      const misroutedTarget = detectMisroutedPartnerRelay(
        messageBody,
        resolvedPartnerName,
        resolvedSelfName,
      );
      if (misroutedTarget) {
        const partnerFirst = (resolvedPartnerName || '').split(/\s+/)[0];
        console.log(
          `[SafetyNet#0.6] PARTNER_MESSAGE → CREATE — target name "${misroutedTarget}" ≠ partner "${partnerFirst || '(unknown)'}"`,
        );
        intentResult = { ...intentResult, intent: 'CREATE' } as any;
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

    // Pending-offer confirmation dispatcher — Initiative 1.3.
    // Handles the three pending_offer variants (save_artifact,
    // date_for_recent_task, attached_to_parent). Unit tests live in
    // handlers/confirmation.test.ts. Other variants pass through to
    // the legacy AWAITING_CONFIRMATION state handler.
    {
      // Read cleanMessage off intentResult directly. The destructured
      // `let cleanMessage` lives ~100 lines below this block; referencing
      // the bare name here trips the JS Temporal Dead Zone and throws
      // `Cannot access 'cleanMessage' before initialization` at runtime.
      const _ctxCleanMessage = (intentResult as { cleanMessage?: string }).cleanMessage ?? '';
      const _confirmCtx: SharedHandlerContext = {
        supabase, userId, userLang, userTimezone: profile.timezone || 'America/New_York',
        profile: profile as any, coupleId, effectiveCoupleId, session: session as any,
        messageBody, cleanMessage: _ctxCleanMessage, effectiveMessage: _ctxCleanMessage, mediaUrls, mediaTypes,
        wamid, inboundNoteSource, quotedMessageId: quotedMessageId ?? null,
        receivedAtIso: receivedAtIso ?? new Date().toISOString(),
        tracker, intentResult: intentResult as any, members: null,
      };
      const _conf = await makeConfirmationDispatcher({
        t,
        invokeProcessNote: (body) => supabase.functions.invoke('process-note', { body }),
      })(_confirmCtx);
      if (_conf.kind === 'reply') return reply(_conf.reply.text);
      if (_conf.kind === 'override-intent') {
        intentResult = { intent: _conf.intent as any, cleanMessage: _conf.cleanMessage } as any;
      }
      // pass-through → continue normal classification below.
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

      // Arbitrary-date agenda (e.g., "And for Friday?" as a follow-up to
      // "What's on my calendar for tomorrow?"). The classifier carries
      // the date forward in `due_date_expression`; we compute the same
      // (tasks + calendar) window the today/tomorrow paths use.
      //
      // Gates:
      //   - The expression parses to a concrete date via parseNaturalDate
      //   - The parsed date isn't already covered by today/tomorrow (those
      //     have richer hand-tuned copy and we don't want to displace them)
      const dueDateExpr = (intentResult as any)._dueDateExpr as string | undefined;
      if (dueDateExpr && (!queryType || queryType === 'general')) {
        try {
          const parsedDate = parseNaturalDate(dueDateExpr, userTimezone, userLang);
          if (parsedDate.date) {
            const targetIso = parsedDate.date; // already absolute UTC
            const target = new Date(targetIso);
            // Compute a day-window in the user's timezone for that date.
            // We diff against today (UTC-day-of-target − UTC-day-of-today)
            // and call getRelativeDayWindowUtc with that day-offset so
            // the window math stays in one helper (handles DST + locale).
            const msPerDay = 24 * 60 * 60 * 1000;
            const todayMs = todayWindow.start.getTime();
            const targetDayStart = new Date(target);
            targetDayStart.setUTCHours(0, 0, 0, 0);
            const dayOffset = Math.round((targetDayStart.getTime() - todayMs) / msPerDay);

            // Don't shadow the dedicated today/tomorrow paths.
            if (dayOffset !== 0 && dayOffset !== 1) {
              const dateWindow = getRelativeDayWindowUtc(now, userTimezone, dayOffset);

              const dueOnDateTasks = activeTasks.filter(t =>
                isInUtcRange(t.due_date, dateWindow.start, dateWindow.end),
              );

              let dateCalendarEvents: string[] = [];
              try {
                const { data: dateConnections } = await supabase
                  .from('calendar_connections')
                  .select('id')
                  .eq('user_id', userId)
                  .eq('is_active', true);
                if (dateConnections && dateConnections.length > 0) {
                  const connIds = dateConnections.map(c => c.id);
                  const { data: events } = await supabase
                    .from('calendar_events')
                    .select('title, start_time, all_day')
                    .in('connection_id', connIds)
                    .gte('start_time', dateWindow.start.toISOString())
                    .lt('start_time', dateWindow.end.toISOString())
                    .order('start_time', { ascending: true })
                    .limit(10);
                  dateCalendarEvents = (events || []).map(e => {
                    if (e.all_day) return `• ${e.title} (all day)`;
                    const time = formatTimeForZone(e.start_time, userTimezone);
                    return `• ${time}: ${e.title}`;
                  });
                }
              } catch (calErr) {
                console.warn('[WhatsApp/SEARCH date] Calendar fetch error:', calErr);
              }

              // Friendly date label (no time component — it's a day query).
              const dateLabel = formatFriendlyDate(
                dateWindow.start.toISOString(),
                false,
                profile.timezone,
                userLang,
              );

              if (dueOnDateTasks.length === 0 && dateCalendarEvents.length === 0) {
                return reply(t('empty_no_date', userLang, { date: dateLabel }));
              }

              let response = `📅 Agenda for ${dateLabel}:\n`;
              if (dateCalendarEvents.length > 0) {
                response += `\n🗓️ Calendar (${dateCalendarEvents.length}):\n${dateCalendarEvents.join('\n')}\n`;
              }
              if (dueOnDateTasks.length > 0) {
                const list = dueOnDateTasks.slice(0, 8).map((t2, i) => {
                  const priority = t2.priority === 'high' ? ' 🔥' : '';
                  return `${i + 1}. ${t2.summary}${priority}`;
                }).join('\n');
                const moreText = dueOnDateTasks.length > 8 ? `\n...and ${dueOnDateTasks.length - 8} more` : '';
                response += `\n📋 Tasks Due (${dueOnDateTasks.length}):\n${list}${moreText}\n`;
              }
              response += '\n\n🔗 Manage: https://witholive.app';

              const displayedDate = dueOnDateTasks.slice(0, 8);
              if (displayedDate.length > 0) {
                await saveReferencedEntity(
                  displayedDate[0],
                  response,
                  displayedDate.map(t2 => ({ id: t2.id, summary: t2.summary })),
                );
              }
              return reply(response);
            }
          }
        } catch (dateBranchErr) {
          console.warn(
            '[WhatsApp/SEARCH date] Date-scoped branch failed (non-fatal, falling through):',
            dateBranchErr instanceof Error ? dateBranchErr.message : dateBranchErr,
          );
        }
      }

      if (queryType === 'urgent') {
        if (urgentTasks.length === 0) {
          return reply(t('empty_no_urgent', userLang));
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
          return reply(t('empty_no_today', userLang));
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
            return reply(t('empty_no_recent', userLang));
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

      // Phase 3.2 — bulk weekday reschedule. Short-circuits the
      // single-task resolution path because it has its own
      // predicate-based resolver (no foundTask needed).
      if (actionType === 'bulk_reschedule_weekday') {
        const fromDow = (intentResult as any)._fromDow as number | undefined;
        const toDow = (intentResult as any)._toDow as number | undefined;
        const bulkTz = profile.timezone || 'America/New_York';
        if (typeof fromDow !== 'number' || typeof toDow !== 'number' || fromDow === toDow) {
          // Defensive — classifier should have set both; if it didn't,
          // fall through to chat-style help instead of attempting
          // a bulk with garbage inputs.
          return reply(t('edit_need_value', userLang));
        }
        const raw = await resolveWeekdayCandidates(supabase, {
          userId,
          spaceId: coupleId || null,
          fromDow,
          timezone: bulkTz,
        });
        if (raw.length === 0) {
          return reply(t('bulk_no_candidates', userLang, { from: bulkDayName(fromDow, userLang) }));
        }

        // Pre-compute the per-candidate new ISO at offer time so
        // confirmation is deterministic. Mirror of the web planner.
        const candidates = [] as Array<{
          task_id: string;
          task_summary: string;
          prior_due_date: string | null;
          prior_reminder_time: string | null;
          new_iso: string;
          has_time: boolean;
        }>;
        for (const r of raw) {
          const anchor = r.reminder_time || r.due_date;
          if (!anchor) continue;
          const newIso = shiftToWeekday(anchor, toDow, bulkTz);
          if (!newIso) continue;
          candidates.push({
            task_id: r.id,
            task_summary: r.summary,
            prior_due_date: r.due_date,
            prior_reminder_time: r.reminder_time,
            new_iso: newIso,
            has_time: !!r.reminder_time,
          });
        }
        if (candidates.length === 0) {
          return reply(t('bulk_no_candidates', userLang, { from: bulkDayName(fromDow, userLang) }));
        }

        // Build the preview list (≤5 inline, summarize the rest).
        const previewN = Math.min(5, candidates.length);
        const previewLines = candidates.slice(0, previewN).map((c) => `• ${c.task_summary}`).join('\n');
        const moreCount = candidates.length - previewN;
        const moreTail = moreCount > 0
          ? '\n…' + (userLang.startsWith('es') ? `y ${moreCount} más` : userLang.startsWith('it') ? `e ${moreCount} in più` : `and ${moreCount} more`)
          : '';

        const bulkCtx = (session.context_data || {}) as ConversationContext;
        await supabase
          .from('user_sessions')
          .update({
            conversation_state: 'AWAITING_CONFIRMATION',
            context_data: {
              ...bulkCtx,
              pending_action: {
                type: 'bulk_reschedule_weekday',
                from_dow: fromDow,
                to_dow: toDow,
                timezone: bulkTz,
                candidates,
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', session.id);

        return reply(
          t('confirm_bulk_reschedule', userLang, {
            n: String(candidates.length),
            tasks_word: tasksWord(candidates.length, userLang),
            from: bulkDayName(fromDow, userLang),
            to: bulkDayName(toDow, userLang),
            preview: previewLines,
            more: moreTail,
          }),
        );
      }

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
      // Also captures a weak candidate (quality 0.2–0.4) so we can offer a
      // "Did you mean X?" prompt instead of dead-ending with task_not_found.
      let weakCandidate: TaskCandidate | null = null;
      if (!foundTask && actionTarget && !isPronoun && !isRelativeReference(actionTarget)) {
        const candidates = await semanticTaskSearchMulti(supabase, userId, coupleId, actionTarget, generateEmbedding, 5);

        if (candidates.length > 0) {
          const best = candidates[0];
          const bestMQ = best.matchQuality ?? 0;

          // Check for ambiguity: are there multiple high-quality matches?
          const AMBIGUITY_THRESHOLD = 0.15; // If top 2 scores are within 15% of each other
          const MIN_MATCH_QUALITY = 0.4;    // Minimum word overlap to accept a match
          const WEAK_CANDIDATE_FLOOR = 0.2; // Below this we don't even offer

          if (bestMQ < MIN_MATCH_QUALITY) {
            // Best match is too weak to AUTO-USE, but if it's at least
            // WEAK_CANDIDATE_FLOOR we'll offer it via "Did you mean X?"
            // instead of dead-ending. Cheap UX win.
            if (bestMQ >= WEAK_CANDIDATE_FLOOR) {
              weakCandidate = best;
              console.log(`[TASK_ACTION] Weak candidate "${best.summary}" quality ${bestMQ.toFixed(2)} — will offer as "did you mean?"`);
            } else {
              console.log(`[TASK_ACTION] Best match "${best.summary}" quality ${bestMQ.toFixed(2)} below threshold, skipping`);
            }
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
          
          const { data: insertedNote, error: insertError } = await insertNote(supabase, {
            author_id: userId,
            couple_id: effectiveCoupleId,
            source: inboundNoteSource,
            source_ref: wamid,
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
          });

          if (insertError || !insertedNote) {
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

          const insertedSummary = insertedNote.summary ?? '';
          const confirmationMessage = [
            t('note_saved', userLang, { summary: insertedSummary }),
            t('note_added_to', userLang, { list: listName }),
            t('note_reminder_set', userLang, { date: friendlyDate }),
            ``,
            t('note_manage', userLang),
          ].join('\n');

          // Store as referenced entity for follow-up
          await saveReferencedEntity(
            { id: insertedNote.id, summary: insertedSummary, list_id: insertedNote.list_id || undefined },
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
        // Natural-conversation upgrade: if the user used a pronoun
        // ("it"/"that"/"this") and we had no focal entity to bind it
        // to, the hard-quoted error reads robotic ("couldn't find a
        // task matching 'it'"). Use the softer prompt instead. We
        // already detected pronouns up front at the `isPronoun` check.
        if (isPronoun) {
          return reply(t('task_pronoun_unclear', userLang));
        }
        // "Did you mean X?" — if semantic search returned a weak-but-
        // not-zero candidate, offer it as a single-option pick via the
        // existing AWAITING_DISAMBIGUATION machinery. User says "1" or
        // "yes" → handler runs the action on that task. This kills
        // dead-end "I couldn't find" replies when there's a clear
        // neighbor (e.g. user said "set the hotel booking" but the
        // task is "Book hotel for Mallorca").
        if (weakCandidate) {
          const offerCtx = (session.context_data || {}) as ConversationContext;
          await supabase
            .from('user_sessions')
            .update({
              conversation_state: 'AWAITING_DISAMBIGUATION',
              context_data: {
                ...offerCtx,
                pending_action: {
                  type: actionType,
                  candidates: [{ id: weakCandidate.id, summary: weakCandidate.summary }],
                  original_query: actionTarget,
                },
              },
              updated_at: new Date().toISOString(),
            })
            .eq('id', session.id);
          console.log(
            `[TASK_ACTION] Offered weak candidate "${weakCandidate.summary}" via AWAITING_DISAMBIGUATION`,
          );
          return reply(t('task_did_you_mean', userLang, { task: weakCandidate.summary }));
        }
        return reply(t('task_not_found', userLang, { query: actionTarget }));
      }

      // Conversation continuity: stamp the resolved task as the session's
      // focal entity so the next turn's pronouns ("it"/"that") resolve
      // here. Survives auto-cancellation of AWAITING_CONFIRMATION because
      // both clearPendingState and stampLastAction preserve this field.
      // Idempotent — downstream pending writes spread `...currentCtx` so
      // the stamp lives through them too.
      try {
        const _stampCtx = (session.context_data || {}) as ConversationContext;
        const _stampedCtx: ConversationContext = {
          ..._stampCtx,
          last_referenced_entity: {
            type: 'task',
            id: foundTask.id,
            summary: foundTask.summary,
            due_date: (foundTask as any).due_date ?? undefined,
            list_id: (foundTask as any).list_id ?? undefined,
            priority: (foundTask as any).priority ?? undefined,
          },
          entity_referenced_at: new Date().toISOString(),
        };
        session.context_data = _stampedCtx;
        await supabase
          .from('user_sessions')
          .update({ context_data: _stampedCtx, updated_at: new Date().toISOString() })
          .eq('id', session.id);
        _lastReferencedTaskId = foundTask.id;
        _lastReferencedTaskSummary = foundTask.summary;
      } catch (stampErr) {
        console.warn(
          '[TASK_ACTION] focal-entity stamp failed (non-fatal):',
          stampErr instanceof Error ? stampErr.message : stampErr,
        );
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
          // Phase 3.1 — detect calendar conflicts on the proposed time
          // BEFORE storing the offer. Errors are non-fatal; absence of
          // conflicts data is the same as the pre-3.1 behavior.
          const setDueTz = profile.timezone || 'America/New_York';
          let setDueConflicts: ConflictSummary[] = [];
          try {
            // 1-hour default window for timed events; 0 (which buildEventTiming
            // expands to all-day) for date-only.
            const setDueHasTime = /\d{1,2}:\d{2}|\bat\s+\d/i.test(parsed.readable || '');
            const setDueEnd = setDueHasTime
              ? new Date(new Date(parsed.date).getTime() + 60 * 60 * 1000).toISOString()
              : parsed.date;
            setDueConflicts = await findConflicts(supabase, {
              userId,
              proposedStart: parsed.date,
              proposedEnd: setDueEnd,
              proposedAllDay: !setDueHasTime,
              excludeNoteId: foundTask.id,
            });
          } catch (cfErr) {
            console.warn('[set_due] conflict detection failed (non-fatal):', cfErr);
          }

          // Phase 3.5 — look up strong patterns matching the proposed
          // day. Non-blocking; absence = no hint.
          let setDuePatterns: MatchedPattern[] = [];
          try {
            setDuePatterns = await findMatchingPatterns(supabase, {
              userId,
              proposedIso: parsed.date,
              timezone: setDueTz,
            });
          } catch (pErr) {
            console.warn('[set_due] pattern lookup failed (non-fatal):', pErr);
          }

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
                  readable: parsed.readable,
                  // Phase 1.4 — captured for undo. We snapshot prior
                  // values BEFORE the user confirms so the post-execute
                  // last_action stamp is built from a trusted value, not
                  // a re-read of the row (which would already be the
                  // updated value by then).
                  prior_due_date: foundTask.due_date || null,
                  prior_reminder_time: foundTask.reminder_time || null,
                  // Phase 1 WhatsApp port: timezone needed for calendar
                  // sync — read at offer time to avoid an extra profile
                  // lookup at confirmation time.
                  timezone: setDueTz
                }
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', session.id);

          return reply(
            t('confirm_set_due', userLang, { task: foundTask.summary, when: parsed.readable })
            + buildWhatsAppConflictSuffix(setDueConflicts, userLang, setDueTz)
            + buildWhatsAppPatternSuffix(setDuePatterns, userLang),
          );
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

        // Phase 1.2 WhatsApp port — generic edit offers. Each builds a
        // pending_action and waits for the user's "yes" before mutating
        // anything. Capture/Offer/Confirm/Execute is the rule, no
        // exceptions.

        case 'edit_title': {
          const newTitle = (effectiveMessage || '').trim();
          if (!newTitle) {
            return reply(t('edit_need_value', userLang));
          }
          const editCtx = (session.context_data || {}) as ConversationContext;
          await supabase
            .from('user_sessions')
            .update({
              conversation_state: 'AWAITING_CONFIRMATION',
              context_data: {
                ...editCtx,
                pending_action: {
                  type: 'edit_title',
                  task_id: foundTask.id,
                  task_summary: foundTask.summary,
                  new_title: newTitle,
                  prior_summary: foundTask.summary,
                  timezone: profile.timezone || 'America/New_York',
                },
              },
              updated_at: new Date().toISOString(),
            })
            .eq('id', session.id);
          return reply(t('confirm_edit_title', userLang, { task: foundTask.summary, new_title: newTitle }));
        }

        case 'edit_location': {
          const newLocation = (effectiveMessage || '').trim();
          if (!newLocation) {
            return reply(t('edit_need_value', userLang));
          }
          const editCtx = (session.context_data || {}) as ConversationContext;
          await supabase
            .from('user_sessions')
            .update({
              conversation_state: 'AWAITING_CONFIRMATION',
              context_data: {
                ...editCtx,
                pending_action: {
                  type: 'edit_location',
                  task_id: foundTask.id,
                  task_summary: foundTask.summary,
                  new_location: newLocation,
                  timezone: profile.timezone || 'America/New_York',
                },
              },
              updated_at: new Date().toISOString(),
            })
            .eq('id', session.id);
          return reply(t('confirm_edit_location', userLang, { task: foundTask.summary, new_location: newLocation }));
        }

        case 'edit_description': {
          const newDescription = (effectiveMessage || '').trim();
          if (!newDescription) {
            return reply(t('edit_need_value', userLang));
          }
          const editCtx = (session.context_data || {}) as ConversationContext;
          await supabase
            .from('user_sessions')
            .update({
              conversation_state: 'AWAITING_CONFIRMATION',
              context_data: {
                ...editCtx,
                pending_action: {
                  type: 'edit_description',
                  task_id: foundTask.id,
                  task_summary: foundTask.summary,
                  new_description: newDescription,
                  prior_description: foundTask.original_text ?? null,
                  timezone: profile.timezone || 'America/New_York',
                },
              },
              updated_at: new Date().toISOString(),
            })
            .eq('id', session.id);
          return reply(t('confirm_edit_description', userLang, {
            task: foundTask.summary,
            new_description: newDescription.length > 60 ? newDescription.slice(0, 60) + '…' : newDescription,
          }));
        }

        case 'edit_duration': {
          const raw = (effectiveMessage || '').trim();
          const parsedMinutes = parseInt(raw, 10);
          if (!parsedMinutes || parsedMinutes <= 0) {
            return reply(t('edit_need_value', userLang));
          }
          const editCtx = (session.context_data || {}) as ConversationContext;
          await supabase
            .from('user_sessions')
            .update({
              conversation_state: 'AWAITING_CONFIRMATION',
              context_data: {
                ...editCtx,
                pending_action: {
                  type: 'edit_duration',
                  task_id: foundTask.id,
                  task_summary: foundTask.summary,
                  new_duration_minutes: parsedMinutes,
                  timezone: profile.timezone || 'America/New_York',
                },
              },
              updated_at: new Date().toISOString(),
            })
            .eq('id', session.id);
          return reply(t('confirm_edit_duration', userLang, {
            task: foundTask.summary,
            minutes: String(parsedMinutes),
          }));
        }

        case 'delete': {
          const deleteCtx = (session.context_data || {}) as ConversationContext;

          // Phase 1.4 — capture full restorable row so undo can re-insert
          // it. We pick a whitelisted column set to avoid resurrecting
          // search vectors / embeddings that triggers will regenerate.
          let restoredRow: Record<string, unknown> | null = null;
          try {
            const { data: rowSnap } = await supabase
              .from('clerk_notes')
              .select('id, author_id, space_id, summary, original_text, due_date, reminder_time, priority, list_id, completed, category, is_sensitive, created_at')
              .eq('id', foundTask.id)
              .maybeSingle();
            restoredRow = rowSnap || null;
          } catch (snapErr) {
            console.warn('[delete-offer] failed to snapshot row for undo:', snapErr);
          }

          // Also remember which Google event was linked at offer time —
          // undo doesn't recreate the event, but we keep the id for
          // observability and a future Phase 2 recreate path.
          let linkedGoogleEventId: string | null = null;
          try {
            const { data: cal } = await supabase
              .from('calendar_events')
              .select('google_event_id')
              .eq('note_id', foundTask.id)
              .maybeSingle();
            linkedGoogleEventId = cal?.google_event_id ?? null;
          } catch { /* ignore */ }

          await supabase
            .from('user_sessions')
            .update({
              conversation_state: 'AWAITING_CONFIRMATION',
              context_data: {
                ...deleteCtx,
                pending_action: {
                  type: 'delete',
                  task_id: foundTask.id,
                  task_summary: foundTask.summary,
                  prior_due_date: foundTask.due_date || null,
                  prior_reminder_time: foundTask.reminder_time || null,
                  restored_row: restoredRow,
                  google_event_id: linkedGoogleEventId,
                  timezone: profile.timezone || 'America/New_York'
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
            // Phase 3.1 — conflict detection on the reminder window.
            // Reminders are timed by definition, so we always treat as
            // a 1-hour window. Errors are non-fatal.
            const remindTz = profile.timezone || 'America/New_York';
            let remindConflicts: ConflictSummary[] = [];
            try {
              const remindEnd = new Date(new Date(parsed.date).getTime() + 60 * 60 * 1000).toISOString();
              remindConflicts = await findConflicts(supabase, {
                userId,
                proposedStart: parsed.date,
                proposedEnd: remindEnd,
                excludeNoteId: foundTask.id,
              });
            } catch (cfErr) {
              console.warn('[remind] conflict detection failed (non-fatal):', cfErr);
            }

            // Phase 3.5 — pattern hint for the reminder offer.
            let remindPatterns: MatchedPattern[] = [];
            try {
              remindPatterns = await findMatchingPatterns(supabase, {
                userId,
                proposedIso: parsed.date,
                timezone: remindTz,
              });
            } catch (pErr) {
              console.warn('[remind] pattern lookup failed (non-fatal):', pErr);
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
                    time: parsed.date,
                    readable: parsed.readable,
                    has_due_date: !!foundTask.due_date,
                    // Phase 1.4 — captured for undo.
                    prior_due_date: foundTask.due_date || null,
                    prior_reminder_time: foundTask.reminder_time || null,
                    timezone: remindTz
                  }
                },
                updated_at: new Date().toISOString()
              })
              .eq('id', session.id);

            return reply(
              t('confirm_set_reminder', userLang, { task: foundTask.summary, when: parsed.readable })
              + buildWhatsAppConflictSuffix(remindConflicts, userLang, remindTz)
              + buildWhatsAppPatternSuffix(remindPatterns, userLang),
            );
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
      const ctxLangName = langName(userLang);
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
          return reply(t('search_found_items', userLang, { results }));
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
          return reply(t('web_search_unavailable', userLang));
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
          return reply(t('web_search_unavailable_hint', userLang, { hint: searchQuery.split(' ').slice(0, 3).join(' ') }));
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
        const ctxLangName = langName(userLang);
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
        return reply(t('web_search_error', userLang));
      }
    }

    // ========================================================================
    // CHAT INTENT — handler in ./handlers/chat.ts (Initiative 1.4).
    // ========================================================================
    if (intent === 'CHAT') {
      const r = await makeChatHandler({ callAI, t })({
        supabase, userId, userLang, userTimezone: profile.timezone || 'America/New_York',
        profile: profile as any, coupleId, effectiveCoupleId, session: session as any,
        messageBody, cleanMessage, effectiveMessage, mediaUrls, mediaTypes,
        wamid, inboundNoteSource, quotedMessageId: quotedMessageId ?? null,
        receivedAtIso: receivedAtIso ?? new Date().toISOString(),
        tracker, intentResult: intentResult as any, members: null,
      } as SharedHandlerContext);
      r.after_reply?.forEach((cb) => cb().catch((e) => console.warn('[CHAT] after-reply:', e)));
      return reply(r.text.slice(0, r.max_length ?? 1500));
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

            // Bucket 3: this is a relay note created on the partner's behalf —
            // not a real user capture. Tagged `partner-relay` so it doesn't
            // pollute "captures from WhatsApp" analytics.
            const { data: insertedNote, error: insertErr } = await insertNote(supabase, {
              author_id: userId,
              couple_id: coupleId, // Partner tasks are always shared
              source: 'partner-relay',
              source_ref: `partner_relay:${partnerAction}`,
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
              completed: false,
            });

            if (insertErr) {
              console.error('[PARTNER_MESSAGE] Note insert error:', insertErr.message, insertErr.details);
            } else if (insertedNote) {
              const partnerSummary = insertedNote.summary ?? '';
              savedTask = { id: insertedNote.id, summary: partnerSummary };
              console.log('[PARTNER_MESSAGE] ✅ Created task for partner:', partnerSummary, '| list_id:', insertedNote.list_id);

              // Generate embedding for semantic search (non-blocking)
              try {
                const embedding = await generateEmbedding(partnerSummary);
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
          return reply(t('partner_reached_partial', userLang, { task: savedTask.summary, partner: partnerName, last4: partnerPhoneLast4 }));
        }
        return reply(t('partner_unreachable', userLang, { partner: partnerName, last4: partnerPhoneLast4, detail: sendError ? 'Error: ' + sendError.substring(0, 100) : 'Please try again later.' }));
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

    // SAVE_ARTIFACT — handler in ./handlers/save-artifact.ts (Initiative 1.2).
    if (intent === 'SAVE_ARTIFACT') {
      const r = await makeSaveArtifactHandler({
        callAI, generateEmbedding, t, promptVersion: WA_CLASSIFICATION_PROMPT_VERSION,
      })({
        supabase, userId, userLang, userTimezone: profile.timezone || 'America/New_York',
        profile: profile as any, coupleId, effectiveCoupleId, session: session as any,
        messageBody, cleanMessage, effectiveMessage: cleanMessage, mediaUrls, mediaTypes,
        wamid, inboundNoteSource, quotedMessageId: quotedMessageId ?? null,
        receivedAtIso: receivedAtIso ?? new Date().toISOString(),
        tracker, intentResult: intentResult as any, members: null,
      } as SharedHandlerContext);
      if (r.referenced_entity) {
        await saveReferencedEntity({ id: r.referenced_entity.id, summary: r.referenced_entity.summary, list_id: r.referenced_entity.list_id }, r.text);
      }
      r.after_reply?.forEach(cb => cb().catch(e => console.warn('[SAVE_ARTIFACT] after-reply:', e)));
      return reply(r.text);
    }

    // ========================================================================
    // CREATE LIST HANDLER - Create a new organizational list from WhatsApp
    // ========================================================================
    if (intent === 'CREATE_LIST') {
      const listName = (intentResult as any)._listName || cleanMessage || '';
      const initialItemsRaw = (intentResult as any)._initialItems || '';
      console.log('[CREATE_LIST] Creating list:', listName, '| initial items:', initialItemsRaw?.substring(0, 80));

      if (!listName || listName.trim().length < 2) {
        return reply(t('list_no_name', userLang));
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
        return reply(t('list_already_exists', userLang, { list: existingMatch.name, count: String(count), plural: count !== 1 ? 's' : '' }));
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
            source: inboundNoteSource,
            source_ref: wamid,
            original_text: item,
            summary: item,
            category: formattedName.toLowerCase().replace(/\s+/g, '_'),
            list_id: newList.id,
            priority: 'medium',
            completed: false,
            tags: [],
            items: [],
          }));

          const { error: itemsError } = await insertNotesBatch(supabase, notesToInsert);

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
        return reply(t('list_not_found', userLang, { query: targetListName, lists: listNames }));
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
        return reply(t('list_empty', userLang, { list: matchedList.name }));
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
      const recapLangName = langName(userLang);
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

    // ========================================================================
    // TOPICAL FOLLOW-UP CHECK (Change 3)
    //
    // Detect "Email/Phone/Address/Notes for <Topic>\n<value>" patterns
    // that refer to a parent note the user captured in the last 30
    // minutes, and silently attach the new field to that parent's
    // items[] array instead of creating a sibling row.
    //
    // The detector is conservative (≥ 0.7 confidence threshold,
    // required proper-noun anchor or multi-token overlap), and the
    // user can undo within 10 minutes by replying "undo" / "no" /
    // "split". So a false positive is recoverable in one short reply.
    //
    // Only attempt when:
    //   - We have a non-empty text message (not media-only).
    //   - This isn't a pronoun-resolved create (those run on a
    //     historical message and the follow-up signal wouldn't apply).
    //   - There's no fresh save-artifact / reschedule / other offer
    //     waiting; mixing offer types would confuse the user.
    // ========================================================================
    if (
      createMessage &&
      createMessage.trim().length > 0 &&
      mediaUrls.length === 0 &&
      !isPronounOnlyCreate &&
      !isPendingOfferFresh(sessionContext.pending_offer)
    ) {
      try {
        const followupMatch = await findFollowupParent(
          supabase,
          userId,
          coupleId,
          createMessage,
        );
        if (followupMatch) {
          console.log(
            `[CREATE] Topical follow-up detected — attaching to "${followupMatch.parentSummary}"`
            + ` (confidence=${followupMatch.confidence.toFixed(2)}, addition="${followupMatch.addition}")`,
          );
          // Snapshot the parent's prior items BEFORE the write so undo
          // can restore them exactly. nextItems already contains the
          // addition appended; subtract the last element to recover
          // priorItems without an extra round-trip.
          const priorItems = followupMatch.nextItems.slice(0, -1);
          const attached = await attachToParent(
            supabase,
            followupMatch.parentNoteId,
            followupMatch.nextItems,
          );
          if (attached) {
            // Persist an AttachedToParentOffer so a follow-up "undo"
            // reply within the offer TTL can reverse the attach AND
            // create a standalone note from the original message.
            const offer: PendingOffer = {
              type: 'attached_to_parent',
              parent_note_id: followupMatch.parentNoteId,
              parent_summary: followupMatch.parentSummary,
              prior_items: priorItems,
              addition: followupMatch.addition,
              original_message: createMessage,
              confidence: followupMatch.confidence,
              offered_at: new Date().toISOString(),
            };
            try {
              await supabase
                .from('user_sessions')
                .update({
                  context_data: { ...sessionContext, pending_offer: offer },
                  updated_at: new Date().toISOString(),
                })
                .eq('id', session.id);
            } catch (sessErr) {
              console.warn('[CREATE] Topical follow-up: session update failed (attach stays, undo unavailable):', sessErr);
            }

            // Build the localized confirmation with the undo hint. Voice
            // discipline per OLIVE_BRAND_BIBLE: direct, the 🌿 motif as
            // signature, no exclamation spam.
            const undoHintsLocalized: Record<string, string> = {
              en: `Reply "undo" to save it as a separate note.`,
              es: `Responde "deshacer" para guardarlo como nota aparte.`,
              it: `Rispondi "annulla" per salvarla come nota separata.`,
            };
            const sl = (userLang || 'en').split('-')[0];
            const undoHint = undoHintsLocalized[sl] || undoHintsLocalized.en;
            const verbLocalized: Record<string, string> = {
              en: 'Added to',
              es: 'Añadido a',
              it: 'Aggiunto a',
            };
            const verb = verbLocalized[sl] || verbLocalized.en;
            const followupReply =
              `🌿 ${verb} "${followupMatch.parentSummary}":\n` +
              `  • ${followupMatch.addition}\n\n` +
              `💡 ${undoHint}`;
            return reply(followupReply);
          }
          // attachToParent returned false (DB write failed). Fall
          // through to the standard CREATE path so the user's data
          // still lands somewhere.
          console.warn('[CREATE] Topical follow-up: attachToParent failed, falling back to standard create');
        }
      } catch (followupErr) {
        // Defensive: never let a follow-up detection bug break the
        // standard CREATE path. Log and continue.
        console.warn('[CREATE] Topical follow-up check threw (non-blocking):', followupErr);
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
      return reply(t('error_generic', userLang));
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
            source: inboundNoteSource,
            source_ref: wamid,
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

        const { data: insertedNotes, error: insertError } = await insertNotesBatch(supabase, notesToInsert);

        if (insertError) throw insertError;

        const primaryListId = insertedNotes?.[0]?.list_id ?? null;
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
        
        const { data: insertedNote, error: insertError } = await insertNote(supabase, {
          author_id: userId,
          couple_id: singleNoteCoupleId,
          source: inboundNoteSource,
          source_ref: wamid,
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
        });

        if (insertError || !insertedNote) throw insertError ?? new Error('Insert returned no row');

        insertedNoteId = insertedNote.id;
        insertedNoteSummary = insertedNote.summary ?? '';
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

        // Sub-items preview: when the saved note carries an items[] array
        // (either from sub-items-mode brain dumps or from saved entity
        // details like "Phone: …", "Address: …"), surface a short preview
        // so the user immediately sees what landed in the note. Without
        // this, a brain dump like "Examples for Hard Rock Stadium\n…"
        // confirms only "Saved: Hard Rock Stadium examples" and the
        // bullets feel invisible. We cap at 5 lines with a tail to keep
        // the message tight.
        const rawItems = Array.isArray(processData.items) ? processData.items : [];
        const stringItems = rawItems
          .map((it: any) => typeof it === 'string' ? it : (it && typeof it === 'object' && 'text' in it ? String(it.text) : ''))
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0);
        let itemsPreview = '';
        if (stringItems.length > 0) {
          const shown = stringItems.slice(0, 5);
          const overflow = stringItems.length - shown.length;
          const overflowLine: Record<string, string> = {
            en: `  …and ${overflow} more`,
            es: `  …y ${overflow} más`,
            it: `  …e altri ${overflow}`,
          };
          const sl = (userLang || 'en').split('-')[0];
          const overflowText = overflow > 0 ? '\n' + (overflowLine[sl] || overflowLine.en) : '';
          itemsPreview = '\n' + shown.map((s: string) => `  • ${s}`).join('\n') + overflowText;
        }

        // Proactive bridge (opt-in): if the saved note has NO due_date
        // AND NO reminder_time, AND the user opted in via
        // olive_user_preferences.proactive_bridge_enabled, append a
        // single bounded offer to set a date. ONE-shot, 5-min TTL.
        // Brand promise: capture frictionless → offer once → confirm
        // → execute. We REPLACE the random tip line with the offer so
        // the confirmation isn't bloated.
        let proactiveBridgeOffer: any = null;
        if (
          insertedNoteId &&
          !processData.due_date &&
          !processData.reminder_time &&
          !duplicateWarning?.found
        ) {
          try {
            const { data: prefRow } = await supabase
              .from('olive_user_preferences')
              .select('proactive_bridge_enabled')
              .eq('user_id', userId)
              .maybeSingle();
            if (prefRow?.proactive_bridge_enabled) {
              proactiveBridgeOffer = {
                type: 'date_for_recent_task',
                task_id: insertedNoteId,
                task_summary: insertedNoteSummary,
                timezone: profile.timezone || 'America/New_York',
                offered_at: new Date().toISOString(),
              };
            }
          } catch (prefErr) {
            console.warn(
              '[ProactiveBridge] preference lookup failed (non-fatal):',
              prefErr instanceof Error ? prefErr.message : prefErr,
            );
          }
        }

        if (duplicateWarning?.found) {
          confirmationMessage = [
            t('note_saved', userLang, { summary: insertedNoteSummary }) + itemsPreview,
            t('note_added_to', userLang, { list: listName }),
            ``,
            t('note_similar_found', userLang, { task: duplicateWarning.targetTitle }),
          ].join('\n');
        } else {
          const sensitiveLabel = encryptionFields.is_sensitive ? '\n🔒 Encrypted at rest' : '';
          const tailLine = proactiveBridgeOffer
            ? t('proactive_date_offer', userLang)
            : `💡 ${getRandomTip()}`;
          confirmationMessage = [
            t('note_saved', userLang, { summary: rawSummary }) + itemsPreview,
            t('note_added_to', userLang, { list: listName }),
            sensitiveLabel,
            ``,
            t('note_manage', userLang),
            ``,
            tailLine,
          ].filter(Boolean).join('\n');
        }

        // Store newly created task as referenced entity for context follow-ups
        if (insertedNoteId) {
          await saveReferencedEntity(
            { id: insertedNoteId, summary: insertedNoteSummary, list_id: insertedListId || undefined },
            confirmationMessage
          );
        }

        // Persist the proactive bridge offer in pending_offer (after
        // saveReferencedEntity, which doesn't touch pending_offer).
        // Single fire-and-forget write — non-fatal if it fails.
        if (proactiveBridgeOffer && insertedNoteId) {
          try {
            const { data: currentSession } = await supabase
              .from('user_sessions')
              .select('context_data')
              .eq('id', session.id)
              .maybeSingle();
            const currentCtx = (currentSession?.context_data || {}) as ConversationContext;
            await supabase
              .from('user_sessions')
              .update({
                context_data: { ...currentCtx, pending_offer: proactiveBridgeOffer },
                updated_at: new Date().toISOString(),
              })
              .eq('id', session.id);
            console.log(
              '[ProactiveBridge] offered date_for_recent_task for note',
              insertedNoteId,
            );
          } catch (offerErr) {
            console.warn(
              '[ProactiveBridge] offer persistence failed (non-fatal):',
              offerErr instanceof Error ? offerErr.message : offerErr,
            );
          }
        }

        return reply(confirmationMessage);
      }
    } catch (insertError) {
      console.error('Database insertion error:', JSON.stringify(insertError));
      console.error('Insert error details:', (insertError as any)?.message, (insertError as any)?.details, (insertError as any)?.hint);
      return reply(t('error_save_failed', userLang));
    }

  } catch (error) {
    console.error('[Meta Webhook] ❌ Background processing error:', error);

    // Persist the error so we can pinpoint root cause without re-running
    // the request. Service-role insert bypasses RLS; the table is gated
    // for SELECT to the owning user only.
    try {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack ?? null : null;
      await supabase.from('webhook_errors').insert({
        function_name: 'whatsapp-webhook',
        user_id: _authenticatedUserId,
        phone_number: messageData?.fromNumber ?? null,
        message_body: (messageData?.messageBody ?? '').substring(0, 2000) || null,
        error_message: errMsg.substring(0, 2000),
        error_stack: errStack ? errStack.substring(0, 8000) : null,
        metadata: {
          message_id: messageData?.messageId ?? null,
          message_type: messageData?.messageType ?? null,
          has_media: (messageData?.mediaItems?.length ?? 0) > 0,
        },
      });
    } catch (logErr) {
      console.error('[Meta Webhook] Failed to persist error to webhook_errors:', logErr);
    }

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

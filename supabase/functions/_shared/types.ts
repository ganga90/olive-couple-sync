/**
 * Shared Types for Omni-Channel Orchestration
 * =============================================
 * Universal input/output types that all message sources normalize into.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { LLMTracker } from "./llm-tracker.ts";
import type { NoteSource } from "./note-insert.ts";
import type { PendingOffer } from "./pending-offer.ts";

/**
 * Standardized inbound message from any channel.
 * WhatsApp webhook, in-app chat, and future channels (SMS, Slack)
 * all normalize their input into this format.
 */
export interface IInboundMessage {
  userId: string;
  source: "whatsapp" | "in_app_chat" | "api";
  messageType: "text" | "audio" | "image" | "video" | "document";
  rawText?: string;
  mediaUrl?: string;
  metadata?: Record<string, any>;
  coupleId?: string;
  partnerName?: string;
  userLang?: string;
}

// ============================================================================
// HANDLER CONTRACT — Initiative 1.1 of OLIVE_REFACTOR_PLAN.md
// ============================================================================
//
// Two types that together define the contract every intent handler must
// satisfy once Initiative 1 lands:
//
//   * `HandlerContext` — everything a handler needs to do its job. Built
//     once per inbound request by the webhook router and passed by reference.
//     Handlers READ from it; they never mutate it (treat as readonly).
//
//   * `Reply` — what a handler RETURNS instead of calling `reply()` directly.
//     The router translates a `Reply` into the side-effects: send the
//     WhatsApp message, persist conversation context, set referenced
//     entity, persist displayed list. Pulling the side-effects out is what
//     makes handlers unit-testable in isolation.
//
// Why these live in `_shared/types.ts` rather than the webhook:
// every channel that wants to share an intent handler (current WhatsApp,
// future in-app chat, future SMS) needs the same shape. A single source
// of truth keeps channels honest.
//
// This file is the FIRST shipped task. Subsequent tasks (1.2 … 1.10)
// migrate one intent at a time off the monolithic `reply()` plumbing and
// into this contract.

/**
 * Member display info — used both by the message-history helpers and by
 * the conversation-context attribution. Optional in `HandlerContext` for
 * 1:1 surfaces where the only member is the user.
 */
export interface MemberInfo {
  user_id: string;
  display_name: string | null;
  role?: string | null;
}

/**
 * Conversation state stored under `user_sessions.context_data`. Shape is
 * stable across both WhatsApp and in-app channels; new fields land here
 * as opt-in additions (no breaking changes to existing rows).
 */
export interface ConversationContext {
  pending_action?: unknown;
  last_referenced_entity?: {
    type: 'task' | 'event';
    id: string;
    summary: string;
    due_date?: string;
    list_id?: string;
    priority?: string;
  };
  entity_referenced_at?: string;
  conversation_history?: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }>;
  last_displayed_list?: Array<{ id: string; summary: string; position: number }>;
  list_displayed_at?: string;
  last_user_message?: string;
  last_user_message_at?: string;
  last_assistant_output?: string;
  last_assistant_output_at?: string;
  last_assistant_request?: string;
  pending_offer?: PendingOffer | null;
}

/**
 * Inbound classified intent. The discriminator union enables exhaustive
 * switch coverage at the router level — adding a new intent forces every
 * handler dispatch to be updated.
 */
export type WhatsAppIntent =
  | 'SEARCH'
  | 'MERGE'
  | 'CREATE'
  | 'CHAT'
  | 'CONTEXTUAL_ASK'
  | 'WEB_SEARCH'
  | 'WEB_RESEARCH'
  | 'SCHEDULE_CALENDAR'
  | 'TASK_ACTION'
  | 'EXPENSE'
  | 'PARTNER_MESSAGE'
  | 'CREATE_LIST'
  | 'LIST_RECAP'
  | 'SAVE_ARTIFACT'
  | 'SAVE_MEMORY';

export interface IntentResult {
  intent: WhatsAppIntent;
  isUrgent?: boolean;
  cleanMessage?: string;
  /**
   * Open-ended bag for intent-specific parameters the classifier emitted
   * (target task id, list name, action type, partner action, etc.). Every
   * handler that uses these reads them defensively with `as any` — the
   * concrete shape varies by intent. Future cleanup: per-intent
   * discriminated union with strict typing.
   */
  [extra: string]: unknown;
}

/**
 * Profile row loaded from `clerk_profiles` for the inbound user. Only the
 * fields handlers actually read are typed here — the row has many more.
 */
export interface HandlerProfile {
  id: string;
  display_name: string | null;
  phone_number: string | null;
  timezone: string | null;
  language_preference: string | null;
  default_privacy: 'private' | 'shared' | null;
}

/**
 * Session row loaded from `user_sessions`. Whatever handlers need.
 */
export interface HandlerSession {
  id: string;
  user_id: string;
  context_data: ConversationContext | null;
  conversation_state?: string | null;
}

/**
 * Everything an intent handler needs to do its job. Built once per
 * inbound request by the webhook router (`whatsapp-webhook/index.ts`)
 * and passed by reference.
 *
 * Handlers READ from this; they do not mutate it. The router owns
 * lifecycle (loading, saving, refreshing).
 */
export interface HandlerContext {
  // Supabase client. Service-role for edge functions — RLS is bypassed,
  // so handlers must enforce author_id / scope predicates themselves
  // where applicable.
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>;

  // ── User identity ─────────────────────────────────────────────────
  userId: string;
  userLang: string;
  userTimezone: string;
  profile: HandlerProfile;

  // ── Scope ─────────────────────────────────────────────────────────
  /** Raw couple_id from `clerk_couple_members` (may be null). */
  coupleId: string | null;
  /**
   * The couple_id Olive will actually attach to writes, after applying
   * the user's default_privacy preference. Null = personal scope.
   */
  effectiveCoupleId: string | null;

  // ── Session state ─────────────────────────────────────────────────
  session: HandlerSession;

  // ── Inbound message ───────────────────────────────────────────────
  /** Raw inbound text (may be null for media-only). */
  messageBody: string | null;
  /** Same as messageBody with WhatsApp shortcut prefix (?+!/$@) stripped. */
  cleanMessage: string;
  /**
   * The message the handler should actually operate on. Equals
   * cleanMessage except when a quoted-reply / cluster combined it with
   * earlier context.
   */
  effectiveMessage: string;
  mediaUrls: string[];
  mediaTypes: string[];
  /** Meta's per-message id (wamid). Use as `source_ref` on writes. */
  wamid: string;
  /** Pre-derived note source for the inbound channel (whatsapp,
   *  whatsapp-voice, whatsapp-media). Passed verbatim to `insertNote`. */
  inboundNoteSource: NoteSource;
  quotedMessageId: string | null;
  receivedAtIso: string;

  // ── LLM tracking ──────────────────────────────────────────────────
  tracker: LLMTracker | null;

  // ── Intent classification ─────────────────────────────────────────
  intentResult: IntentResult;

  // ── Optional members ──────────────────────────────────────────────
  /** Resolved member list for the current scope (couple or space).
   *  Null = personal context, no other members. */
  members?: MemberInfo[] | null;

  // ── Optional message-level extras ─────────────────────────────────
  // Added by Initiative 1.6 (CREATE handler). Most handlers ignore
  // these; CREATE writes `location` into note rows and applies
  // is_sensitive encryption from `isSensitive`.
  /** Latitude from a WhatsApp location share, when present. */
  latitude?: number | null;
  /** Longitude from a WhatsApp location share, when present. */
  longitude?: number | null;
  /** True if the user prefixed the message with `private:` or similar
   *  sensitivity marker. CREATE encrypts the note's original_text and
   *  summary at rest when this is set. */
  isSensitive?: boolean;

  /**
   * Pre-resolved task from a WhatsApp quoted-reply context. When the
   * user replies to one of Olive's earlier messages, the webhook looks
   * up the WAMID and resolves it to the underlying task here so
   * TASK_ACTION can use it as a high-priority candidate (strictly more
   * reliable than semantic search). Null when the inbound is not a
   * quoted reply or the quote points at a non-task message.
   * Added by Initiative 1.7b (TASK_ACTION extraction).
   */
  quotedTaskCtx?: { task_id: string; task_summary: string; sent_at: string } | null;
}

/**
 * A handler's output. The router translates this into the actual
 * side-effects (send WhatsApp message, update session context, set
 * referenced entity).
 *
 * Returning a Reply instead of calling `reply()` directly is what makes
 * handlers unit-testable: a test can assert on the returned object
 * without needing a working Meta Cloud API connection.
 */
export interface Reply {
  /**
   * The user-facing text. Sent verbatim via the channel's outbound
   * gateway. Empty string = silent (no outbound message; rare, used for
   * background-only operations).
   */
  text: string;

  /**
   * Optional task/event this reply references. The router persists it
   * to `session.context_data.last_referenced_entity` so follow-ups like
   * "move it to tomorrow" can resolve unambiguously.
   */
  referenced_entity?: {
    type?: 'task' | 'event';
    id: string;
    summary: string;
    list_id?: string;
    due_date?: string;
    priority?: string;
  } | null;

  /**
   * Optional ordered list shown to the user (numbered tasks, candidates,
   * etc.). The router persists it to
   * `session.context_data.last_displayed_list` so ordinal references
   * ("the first one", "the third one") can resolve to the right id.
   */
  displayed_list?: Array<{ id: string; summary: string }> | null;

  /**
   * Optional override for outbound truncation. The router defaults to
   * 1500 chars for WhatsApp; pass higher (up to ~2000) for assistant-
   * type CHAT responses that legitimately need more room.
   */
  max_length?: number;

  /**
   * Optional `PendingOffer` to freeze under `session.context_data
   * .pending_offer`. Set when this reply offers an action the next
   * inbound turn might confirm or deny.
   */
  pending_offer?: PendingOffer | null;

  /**
   * Optional fire-and-forget side-effects the router schedules AFTER
   * the outbound reply lands. Examples: embedding generation for a
   * saved note, daily-log append, conversation-memory evolution.
   * Failures here are non-blocking — the reply still ships.
   */
  after_reply?: Array<() => Promise<void>>;
}

/**
 * Sentinel — handlers that explicitly want NO outbound message return
 * `SILENT_REPLY`. Equivalent to `{ text: '' }` but more legible at the
 * return site.
 */
export const SILENT_REPLY: Reply = Object.freeze({ text: '' });

/**
 * Type guard — true iff this Reply will send an outbound message.
 */
export function isOutboundReply(reply: Reply): boolean {
  return reply.text.length > 0;
}

/**
 * The handler signature every Initiative-1 extraction must satisfy.
 * Pure async function: read from `ctx`, return a `Reply`, no
 * side-effects on the channel itself.
 */
export type Handler = (ctx: HandlerContext) => Promise<Reply>;

/**
 * Context assembled from all data sources before LLM call.
 * This is the "state" that feeds into the AI brain.
 */
export interface SystemContext {
  // Core user data
  memories: Array<{ title: string; content: string; category: string; importance?: number }>;
  skills: Array<{ skill_id: string; name: string; content: string; category: string }>;
  patterns: Array<{ pattern_type: string; pattern_data: any; confidence: number }>;

  // Agent insights (last 48h of background agent results)
  agentInsights: string;

  // Conversation continuity
  recentConversation: Array<{ role: string; content: string }>;
  recentOutbound: Array<{ type: string; content: string; sent_at: string }>;

  // Task state
  taskAnalytics: {
    total_active: number;
    urgent: number;
    overdue: number;
    due_today: number;
    due_tomorrow: number;
    completion_rate: number;
    top_categories: string[];
    top_lists: string[];
  };
  urgentTaskNames: string[];
  overdueTaskNames: string[];
  todayTaskNames: string[];

  // Optional enrichment
  partnerContext?: string;
  ouraContext?: string;
  calendarContext?: string;
}

/**
 * Classification result from the intent router.
 */
export interface IntentClassification {
  intent: string;
  confidence: number;
  reasoning?: string;
  parameters?: Record<string, any>;
}

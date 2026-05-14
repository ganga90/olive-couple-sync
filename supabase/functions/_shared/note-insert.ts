/**
 * Type-safe wrapper for inserting into clerk_notes.
 * ==================================================
 * Enforces `source` at compile time so the NULL-source bug can't recur.
 *
 * USE THIS for every new note insert. Direct .from("clerk_notes").insert(...)
 * calls are prohibited going forward (see Section 6 of SKILL.md).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/** Canonical channel attribution. Update both this list AND the
 * `clerk_notes_source_known` CHECK constraint (when applied) if you add a
 * new value. */
export const NOTE_SOURCES = [
  "whatsapp",         // user-typed WhatsApp message (text)
  "whatsapp-voice",   // WhatsApp voice note (Deepgram transcript)
  "whatsapp-media",   // WhatsApp image/document/video with caption
  "olive-chat",       // web-app chat UI
  "web",              // web-app direct note creation (Lists, Notes pages)
  "ios",              // iOS Capacitor app direct note creation
  "email",            // Gmail importer (olive-email-mcp)
  "receipt",          // process-receipt (image of receipt → expense)
  "save-link",        // save-link (URL → bookmarked note)
  "brain-dump",       // process-brain-dump
  "partner-relay",    // partner-message relay (internal, not a real capture)
  "system",           // system-generated notes (heartbeat-created, etc.)
] as const;

export type NoteSource = typeof NOTE_SOURCES[number];

/**
 * Required fields on every note insert. `source` is mandatory; the
 * underlying table allows arbitrary other columns, so `[extraColumn]`
 * keeps callers flexible without us re-typing every column.
 */
export interface InsertNoteInput {
  author_id: string;
  source: NoteSource;
  /**
   * Upstream message identifier. Strongly recommended for auto-captured
   * channels (whatsapp wamid, email message-id, receipt media url hash).
   * Null is acceptable for direct-create channels (web, ios).
   */
  source_ref?: string | null;
  couple_id?: string | null;
  space_id?: string | null;
  original_text?: string | null;
  summary?: string | null;
  category?: string | null;
  priority?: string | null;
  tags?: string[] | null;
  items?: unknown[] | null;
  completed?: boolean | null;
  media_urls?: string[] | null;
  due_date?: string | null;
  reminder_time?: string | null;
  list_id?: string | null;
  task_owner?: string | null;
  location?: unknown | null;
  assigned_to?: string | null;
  recurrence_frequency?: string | null;
  recurrence_interval?: number | null;
  is_sensitive?: boolean | null;
  encrypted_original_text?: string | null;
  encrypted_summary?: string | null;
  /** Pass-through for any other column not enumerated above. */
  [extraColumn: string]: unknown;
}

export interface InsertNoteResult {
  data: { id: string; summary: string | null; list_id: string | null } | null;
  error: { message: string; details?: string } | null;
}

/**
 * Single-note insert. Returns the inserted row's id + summary + list_id
 * (the shape used by most existing callers in whatsapp-webhook).
 */
export async function insertNote(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  input: InsertNoteInput,
): Promise<InsertNoteResult> {
  if (!input.source) {
    // TypeScript prevents this at the type level; defensive runtime guard
    // for JS callers, `as any` escapes, and missing-field bugs.
    return {
      data: null,
      error: {
        message: "insertNote: source is required (must be a NoteSource value)",
      },
    };
  }
  const { data, error } = await supabase
    .from("clerk_notes")
    .insert(input)
    .select("id, summary, list_id")
    .single();
  return {
    data,
    // deno-lint-ignore no-explicit-any
    error: error
      ? { message: error.message, details: (error as any).details }
      : null,
  };
}

export interface InsertNotesBatchResult {
  data:
    | Array<{ id: string; summary: string | null; list_id: string | null }>
    | null;
  error: { message: string } | null;
}

/**
 * Batch insert. Used for multi-item brain dumps and list-with-initial-items.
 * Every row must include `source`; we fail-fast at runtime if any row is
 * missing it (TypeScript catches this at compile-time too).
 */
export async function insertNotesBatch(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  inputs: InsertNoteInput[],
): Promise<InsertNotesBatchResult> {
  const missing = inputs.filter((r) => !r.source);
  if (missing.length > 0) {
    return {
      data: null,
      error: {
        message:
          `insertNotesBatch: ${missing.length}/${inputs.length} rows missing source`,
      },
    };
  }
  const { data, error } = await supabase
    .from("clerk_notes")
    .insert(inputs)
    .select("id, summary, list_id");
  return {
    data,
    error: error ? { message: error.message } : null,
  };
}

/**
 * Derive the WhatsApp note source from Meta's `message.type` field.
 * Centralized here so the wiring is consistent across whatsapp-webhook
 * insert sites and any future callers.
 */
export function whatsappSourceFromMessageType(
  messageType: string | null | undefined,
): NoteSource {
  if (messageType === "audio" || messageType === "voice") return "whatsapp-voice";
  if (
    messageType === "image" ||
    messageType === "document" ||
    messageType === "video" ||
    messageType === "sticker"
  ) {
    return "whatsapp-media";
  }
  return "whatsapp";
}

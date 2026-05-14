/**
 * Frontend NoteSource enum — mirrors `supabase/functions/_shared/note-insert.ts`
 * =============================================================================
 * Canonical Deno copy lives at
 *   supabase/functions/_shared/note-insert.ts
 * Both must stay in sync. If you add a value here, also:
 *   1. add it to the Deno NOTE_SOURCES array
 *   2. add it to the `clerk_notes_source_known` CHECK constraint (DB migration)
 *   3. add it to the `whatsappSourceFromMessageType` helper if WhatsApp-derived
 *
 * Why a redeclaration instead of a shared module: the Deno helper imports
 * `https://esm.sh/...` URL modules and uses `SupabaseClient` types that aren't
 * a clean fit for the Vite/React frontend bundle. The risk of drift is
 * mitigated by (a) the DB CHECK constraint and (b) keeping this list short.
 */

import { Capacitor } from "@capacitor/core";

export const NOTE_SOURCES = [
  "whatsapp",
  "whatsapp-voice",
  "whatsapp-media",
  "olive-chat",
  "web",
  "ios",
  "email",
  "receipt",
  "save-link",
  "brain-dump",
  "partner-relay",
  "system",
] as const;

export type NoteSource = typeof NOTE_SOURCES[number];

/**
 * Returns the correct platform-default source for direct user-initiated
 * note inserts from the React app (Lists, Notes pages, etc.):
 *   - `"ios"` when running inside the Capacitor iOS shell
 *   - `"web"` otherwise (Vercel-deployed web app, including localhost)
 *
 * Use this at the call site of `addNote()` (and similar hooks) when the
 * caller hasn't explicitly set a more specific source.
 */
export function defaultClientNoteSource(): NoteSource {
  return Capacitor.isNativePlatform() ? "ios" : "web";
}

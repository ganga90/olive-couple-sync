

# Server-Side Encryption for Sensitive Notes in Olive

## Summary

Add an `is_sensitive` flag to notes with server-side AES-256-GCM encryption. Sensitive notes are encrypted at rest in the database but decrypted in Edge Functions so all AI features continue to work. Users mark notes as sensitive via UI toggle or WhatsApp `🔒` prefix. Landing page and in-app UX communicate the security value proposition.

## What Changes for Users

- Lock toggle on note creation (SimpleNoteInput) and note detail page
- Lock badge on NoteCard for sensitive notes
- WhatsApp: prefix with `🔒` to auto-mark as sensitive
- All AI features (search, Ask Olive, briefings, tips, reminders) continue working
- New "Security & Privacy" section on landing page SuperpowersGrid
- Tooltip/callout when toggling sensitive explaining what it protects

## Architecture

```text
User → Edge Function (encrypt original_text + summary) → DB (ciphertext)
DB (ciphertext) → Edge Function (decrypt) → AI pipeline → response
DB (ciphertext) → decrypt-note endpoint → Client (plaintext rendered)
```

Key derivation: `HMAC-SHA256(ENCRYPTION_MASTER_KEY, user_id)` per-user key. AES-256-GCM with random IV per encryption.

## Implementation Plan

### 1. Add ENCRYPTION_MASTER_KEY Secret
- Prompt user to add a 64-char hex string as `ENCRYPTION_MASTER_KEY` Supabase secret

### 2. Database Migration
- Add `is_sensitive boolean NOT NULL DEFAULT false` to `clerk_notes`
- Add `encrypted_original_text text` and `encrypted_summary text` columns (nullable)

### 3. Create `supabase/functions/_shared/encryption.ts`
- `deriveUserKey(userId)` using HMAC-SHA256 + Web Crypto API
- `encrypt(plaintext, userId)` returns base64 `iv:ciphertext` string
- `decrypt(ciphertext, userId)` reverses it
- Graceful fallback if `ENCRYPTION_MASTER_KEY` is not set (no-op)

### 4. Create `supabase/functions/decrypt-note/index.ts`
- Accepts `note_id` and `user_id`
- Fetches the note via service role
- Validates user ownership (author_id match or couple member)
- Decrypts and returns plaintext fields
- Add to `config.toml`

### 5. Update `supabase/functions/process-note/index.ts`
- Import encryption module
- After AI processing, if `is_sensitive` flag is set in the request body, encrypt `original_text` and `summary` before DB insert
- Store `[ENCRYPTED]` placeholder in plaintext columns for basic visibility
- Real content goes in `encrypted_original_text` and `encrypted_summary`

### 6. Update `supabase/functions/whatsapp-webhook/index.ts`
- Detect `🔒` prefix in incoming messages
- Strip it before processing, set `is_sensitive: true` in process-note payload
- Add response template for sensitive note confirmation

### 7. Update `supabase/functions/send-reminders/index.ts`
- When building reminder messages, check `is_sensitive`
- If true, decrypt summary before sending WhatsApp message

### 8. Update `supabase/functions/ask-olive-individual/index.ts`
- When loading note context, decrypt sensitive notes in-memory before passing to LLM

### 9. Update `supabase/functions/olive-heartbeat/index.ts`
- Decrypt sensitive notes when building briefing/review content

### 10. Update `supabase/functions/generate-olive-tip/index.ts`
- Decrypt before tip generation

### 11. Frontend: Update `src/hooks/useSupabaseNotes.ts`
- For notes with `is_sensitive: true`, call `decrypt-note` endpoint to get plaintext
- Cache decrypted content in state (never persisted)

### 12. Frontend: Update `src/types/note.ts`
- Add `is_sensitive?: boolean` to `Note` interface

### 13. Frontend: Update `src/components/NoteCard.tsx`
- Show `Lock` icon badge when `is_sensitive === true`
- Subtle visual indicator (e.g., border or background tint)

### 14. Frontend: Update `src/pages/NoteDetails.tsx`
- Add toggle to mark/unmark note as sensitive
- Show callout explaining what encryption protects
- On toggle-on: call edge function to encrypt existing content
- On toggle-off: decrypt and store as plaintext

### 15. Frontend: Update `src/components/SimpleNoteInput.tsx`
- Add a small lock toggle button near the submit button
- When active, pass `is_sensitive: true` to note creation

### 16. Landing Page: Add Security Section
- Add a 4th "superpower" card to `SuperpowersGrid.tsx` about privacy/encryption with `Shield` icon
- Add translations to all 3 locale files (en, it-IT, es-ES) for the security messaging
- Copy: "Your data, locked tight" / "Sensitive notes are encrypted at rest with AES-256. Only you can unlock them."

### 17. i18n Updates
- Add translation keys for sensitive note UI across `notes.json`, `landing.json`, `profile.json` in all 3 locales
- Keys: `notes.sensitive.label`, `notes.sensitive.tooltip`, `notes.sensitive.badge`, `landing.superpowers.security.*`

### Files to Create
- `supabase/functions/_shared/encryption.ts`
- `supabase/functions/decrypt-note/index.ts`
- Migration SQL file

### Files to Edit
- `supabase/config.toml` (add decrypt-note)
- `supabase/functions/process-note/index.ts`
- `supabase/functions/whatsapp-webhook/index.ts`
- `supabase/functions/send-reminders/index.ts`
- `supabase/functions/ask-olive-individual/index.ts`
- `supabase/functions/olive-heartbeat/index.ts`
- `supabase/functions/generate-olive-tip/index.ts`
- `src/types/note.ts`
- `src/hooks/useSupabaseNotes.ts`
- `src/components/NoteCard.tsx`
- `src/components/SimpleNoteInput.tsx`
- `src/pages/NoteDetails.tsx`
- `src/components/landing/SuperpowersGrid.tsx`
- `public/locales/en/landing.json`, `public/locales/en/notes.json`
- `public/locales/it-IT/landing.json`, `public/locales/it-IT/notes.json`
- `public/locales/es-ES/landing.json`, `public/locales/es-ES/notes.json`


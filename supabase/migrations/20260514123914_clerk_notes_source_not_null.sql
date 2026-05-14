-- [TASK-SA-6] clerk_notes.source NOT NULL + enum CHECK constraint
-- ============================================================================
-- Final piece of the source-attribution work (Bucket 3 follow-up). Now that
-- (1) all backend insert sites use the type-safe insertNote() helper,
-- (2) the 2 frontend insert sites set `source` via defaultClientNoteSource()
--     and `'olive-chat'`, and
-- (3) the historical backfill script has driven the NULL count to zero,
-- the column can be declared NOT NULL and constrained to the known enum.
--
-- Prerequisite verified at apply time:
--   SELECT COUNT(*) FROM clerk_notes WHERE source IS NULL;
--   --> 0 (post-backfill, confirmed before applying this migration)
--
-- The CHECK constraint mirrors NOTE_SOURCES in
--   supabase/functions/_shared/note-insert.ts  AND
--   src/lib/note-source.ts
-- Adding a new source requires updating BOTH typed enums AND this constraint.
--
-- DOWN:
--   ALTER TABLE public.clerk_notes
--     DROP CONSTRAINT IF EXISTS clerk_notes_source_known;
--   ALTER TABLE public.clerk_notes
--     ALTER COLUMN source DROP NOT NULL;

ALTER TABLE public.clerk_notes
  ALTER COLUMN source SET NOT NULL;

ALTER TABLE public.clerk_notes
  ADD CONSTRAINT clerk_notes_source_known
  CHECK (source IN (
    'whatsapp', 'whatsapp-voice', 'whatsapp-media',
    'olive-chat', 'web', 'ios',
    'email', 'receipt', 'save-link', 'brain-dump',
    'partner-relay', 'system'
  ));

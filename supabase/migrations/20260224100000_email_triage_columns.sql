-- Add source tracking columns to clerk_notes for email triage agent
-- source: identifies where the note originated (e.g. 'email', 'manual', 'voice')
-- source_ref: external reference ID (e.g. Gmail message ID) for dedup

ALTER TABLE clerk_notes ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE clerk_notes ADD COLUMN IF NOT EXISTS source_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_clerk_notes_source_ref ON clerk_notes(author_id, source_ref) WHERE source_ref IS NOT NULL;

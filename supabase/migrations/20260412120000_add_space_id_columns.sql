-- Phase A: Add space_id alongside couple_id (Don't Replace)
-- =========================================================
-- Adds space_id columns to all content tables that currently use couple_id.
-- Backfills space_id from couple_id (they share the same UUIDs).
-- No columns are dropped. No existing queries break.

-- ─── clerk_notes ────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clerk_notes' AND column_name = 'space_id'
  ) THEN
    ALTER TABLE clerk_notes ADD COLUMN space_id UUID REFERENCES olive_spaces(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_notes_space_id ON clerk_notes (space_id) WHERE space_id IS NOT NULL;
  END IF;
END $$;

-- Backfill: space_id = couple_id (they use the same UUIDs from our migration)
UPDATE clerk_notes SET space_id = couple_id WHERE couple_id IS NOT NULL AND space_id IS NULL;

-- ─── lists ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'lists'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lists' AND column_name = 'space_id'
  ) THEN
    ALTER TABLE lists ADD COLUMN space_id UUID REFERENCES olive_spaces(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_lists_space_id ON lists (space_id) WHERE space_id IS NOT NULL;
  END IF;
END $$;

-- Backfill lists if couple_id column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lists' AND column_name = 'couple_id'
  ) THEN
    EXECUTE 'UPDATE lists SET space_id = couple_id WHERE couple_id IS NOT NULL AND space_id IS NULL';
  END IF;
END $$;

-- ─── transactions ───────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'transactions'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'space_id'
  ) THEN
    ALTER TABLE transactions ADD COLUMN space_id UUID REFERENCES olive_spaces(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_transactions_space_id ON transactions (space_id) WHERE space_id IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'couple_id'
  ) THEN
    EXECUTE 'UPDATE transactions SET space_id = couple_id::uuid WHERE couple_id IS NOT NULL AND space_id IS NULL';
  END IF;
END $$;

-- ─── budgets ────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'budgets'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'budgets' AND column_name = 'space_id'
  ) THEN
    ALTER TABLE budgets ADD COLUMN space_id UUID REFERENCES olive_spaces(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_budgets_space_id ON budgets (space_id) WHERE space_id IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'budgets' AND column_name = 'couple_id'
  ) THEN
    EXECUTE 'UPDATE budgets SET space_id = couple_id::uuid WHERE couple_id IS NOT NULL AND space_id IS NULL';
  END IF;
END $$;

-- ─── olive_memory_files ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'olive_memory_files' AND column_name = 'space_id'
  ) THEN
    ALTER TABLE olive_memory_files ADD COLUMN space_id TEXT;  -- TEXT to match couple_id type
    CREATE INDEX IF NOT EXISTS idx_memory_files_space_id ON olive_memory_files (space_id) WHERE space_id IS NOT NULL;
  END IF;
END $$;

UPDATE olive_memory_files SET space_id = couple_id WHERE couple_id IS NOT NULL AND space_id IS NULL;

-- ─── olive_patterns ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'olive_patterns' AND column_name = 'space_id'
  ) THEN
    ALTER TABLE olive_patterns ADD COLUMN space_id TEXT;  -- TEXT to match couple_id type
    CREATE INDEX IF NOT EXISTS idx_patterns_space_id ON olive_patterns (space_id) WHERE space_id IS NOT NULL;
  END IF;
END $$;

UPDATE olive_patterns SET space_id = couple_id WHERE couple_id IS NOT NULL AND space_id IS NULL;

-- ─── Dual-Write Trigger on clerk_notes ──────────────────────────
-- When couple_id is set on a note, auto-set space_id to match.
-- This ensures backward-compatible writes from old code also populate space_id.
CREATE OR REPLACE FUNCTION sync_note_couple_to_space()
RETURNS TRIGGER AS $$
BEGIN
  -- If couple_id changed and space_id wasn't explicitly set, sync
  IF NEW.couple_id IS DISTINCT FROM OLD.couple_id THEN
    NEW.space_id := NEW.couple_id;
  END IF;
  -- If space_id changed and couple_id wasn't explicitly set, sync back
  IF NEW.space_id IS DISTINCT FROM OLD.space_id AND NEW.couple_id IS NOT DISTINCT FROM OLD.couple_id THEN
    NEW.couple_id := NEW.space_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_note_couple_space ON clerk_notes;
CREATE TRIGGER trg_sync_note_couple_space
  BEFORE UPDATE ON clerk_notes
  FOR EACH ROW EXECUTE FUNCTION sync_note_couple_to_space();

-- Also handle inserts
CREATE OR REPLACE FUNCTION sync_note_couple_to_space_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.couple_id IS NOT NULL AND NEW.space_id IS NULL THEN
    NEW.space_id := NEW.couple_id;
  ELSIF NEW.space_id IS NOT NULL AND NEW.couple_id IS NULL THEN
    NEW.couple_id := NEW.space_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_note_couple_space_insert ON clerk_notes;
CREATE TRIGGER trg_sync_note_couple_space_insert
  BEFORE INSERT ON clerk_notes
  FOR EACH ROW EXECUTE FUNCTION sync_note_couple_to_space_insert();

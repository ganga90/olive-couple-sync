-- Phase 2: Collaboration Primitives
-- ====================================
-- Adds note threads (comments), reactions, @mentions, and
-- space activity feed. All tables are ADDITIVE — no existing
-- tables are modified or dropped.

-- ─── Note Threads (comments on notes) ──────────────────────────
CREATE TABLE IF NOT EXISTS note_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES clerk_notes(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,                    -- Clerk user ID
  body TEXT NOT NULL,                         -- comment text (max ~2000 chars)
  parent_id UUID REFERENCES note_threads(id) ON DELETE CASCADE,  -- for nested replies
  space_id UUID REFERENCES olive_spaces(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_note_threads_note ON note_threads (note_id, created_at);
CREATE INDEX IF NOT EXISTS idx_note_threads_author ON note_threads (author_id);
CREATE INDEX IF NOT EXISTS idx_note_threads_space ON note_threads (space_id) WHERE space_id IS NOT NULL;

-- ─── Note Reactions (emoji reactions on notes) ─────────────────
CREATE TABLE IF NOT EXISTS note_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES clerk_notes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,                      -- Clerk user ID
  emoji TEXT NOT NULL,                        -- emoji character (e.g. "👍", "❤️", "😂")
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(note_id, user_id, emoji)             -- one reaction per emoji per user per note
);

CREATE INDEX IF NOT EXISTS idx_note_reactions_note ON note_reactions (note_id);
CREATE INDEX IF NOT EXISTS idx_note_reactions_user ON note_reactions (user_id);

-- ─── Note Mentions (@mentions in notes and threads) ────────────
CREATE TABLE IF NOT EXISTS note_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID REFERENCES clerk_notes(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES note_threads(id) ON DELETE CASCADE,
  mentioned_user_id TEXT NOT NULL,            -- Clerk user ID being mentioned
  mentioned_by TEXT NOT NULL,                 -- Clerk user ID who mentioned
  space_id UUID REFERENCES olive_spaces(id) ON DELETE SET NULL,
  read_at TIMESTAMPTZ,                        -- null = unread
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- At least one of note_id or thread_id must be set
  CONSTRAINT mention_target CHECK (note_id IS NOT NULL OR thread_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_note_mentions_user ON note_mentions (mentioned_user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_note_mentions_note ON note_mentions (note_id) WHERE note_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_note_mentions_thread ON note_mentions (thread_id) WHERE thread_id IS NOT NULL;

-- ─── Space Activity Feed ───────────────────────────────────────
-- Denormalized activity log for fast feed rendering.
-- Events are written by triggers and edge functions.
CREATE TABLE IF NOT EXISTS space_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES olive_spaces(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,                     -- Clerk user ID who performed action
  action TEXT NOT NULL,                       -- action type enum below
  entity_type TEXT NOT NULL,                  -- 'note', 'thread', 'reaction', 'list', 'task', 'member', 'space'
  entity_id TEXT,                             -- UUID of the affected entity
  metadata JSONB NOT NULL DEFAULT '{}',       -- action-specific data (preview text, emoji, etc.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Valid action types:
-- note_created, note_updated, note_completed, note_assigned
-- thread_created, reaction_added, reaction_removed
-- member_joined, member_left
-- list_created, list_updated
-- mention_created

CREATE INDEX IF NOT EXISTS idx_space_activity_feed ON space_activity (space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_space_activity_actor ON space_activity (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_space_activity_entity ON space_activity (entity_type, entity_id);

-- ─── RLS Policies ──────────────────────────────────────────────
ALTER TABLE note_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_activity ENABLE ROW LEVEL SECURITY;

-- note_threads: users can see threads on notes they can see
-- (simplified: space members + personal note authors)
CREATE POLICY "Thread authors and space members can view threads"
  ON note_threads FOR SELECT
  USING (
    author_id = (auth.jwt() ->> 'sub')
    OR EXISTS (
      SELECT 1 FROM olive_space_members sm
      WHERE sm.space_id = note_threads.space_id AND sm.user_id = (auth.jwt() ->> 'sub')
    )
    OR EXISTS (
      SELECT 1 FROM clerk_notes n
      WHERE n.id = note_threads.note_id AND n.author_id = (auth.jwt() ->> 'sub')
    )
  );

CREATE POLICY "Authenticated users can create threads on accessible notes"
  ON note_threads FOR INSERT
  WITH CHECK (
    author_id = (auth.jwt() ->> 'sub')
  );

CREATE POLICY "Thread authors can update their threads"
  ON note_threads FOR UPDATE
  USING (author_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "Thread authors can delete their threads"
  ON note_threads FOR DELETE
  USING (author_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "Service role manages threads"
  ON note_threads FOR ALL
  USING (true) WITH CHECK (true);

-- note_reactions: similar pattern
CREATE POLICY "Space members and note authors can view reactions"
  ON note_reactions FOR SELECT
  USING (
    user_id = (auth.jwt() ->> 'sub')
    OR EXISTS (
      SELECT 1 FROM clerk_notes n
      LEFT JOIN olive_space_members sm ON sm.space_id = n.space_id
      WHERE n.id = note_reactions.note_id
        AND (n.author_id = (auth.jwt() ->> 'sub') OR sm.user_id = (auth.jwt() ->> 'sub'))
    )
  );

CREATE POLICY "Users can add reactions"
  ON note_reactions FOR INSERT
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "Users can remove own reactions"
  ON note_reactions FOR DELETE
  USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "Service role manages reactions"
  ON note_reactions FOR ALL
  USING (true) WITH CHECK (true);

-- note_mentions: users see their own mentions
CREATE POLICY "Users see mentions directed at them"
  ON note_mentions FOR SELECT
  USING (
    mentioned_user_id = (auth.jwt() ->> 'sub')
    OR mentioned_by = (auth.jwt() ->> 'sub')
  );

CREATE POLICY "Users can create mentions"
  ON note_mentions FOR INSERT
  WITH CHECK (mentioned_by = (auth.jwt() ->> 'sub'));

CREATE POLICY "Users can mark their mentions as read"
  ON note_mentions FOR UPDATE
  USING (mentioned_user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "Service role manages mentions"
  ON note_mentions FOR ALL
  USING (true) WITH CHECK (true);

-- space_activity: space members can see activity
CREATE POLICY "Space members can view activity"
  ON space_activity FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM olive_space_members sm
      WHERE sm.space_id = space_activity.space_id AND sm.user_id = (auth.jwt() ->> 'sub')
    )
  );

CREATE POLICY "Service role manages activity"
  ON space_activity FOR ALL
  USING (true) WITH CHECK (true);

-- ─── Activity Triggers ─────────────────────────────────────────

-- Auto-log thread creation to activity feed
CREATE OR REPLACE FUNCTION log_thread_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.space_id IS NOT NULL THEN
    INSERT INTO space_activity (space_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      NEW.space_id,
      NEW.author_id,
      'thread_created',
      'thread',
      NEW.id::text,
      jsonb_build_object(
        'note_id', NEW.note_id,
        'preview', left(NEW.body, 100)
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_log_thread_activity ON note_threads;
CREATE TRIGGER trg_log_thread_activity
  AFTER INSERT ON note_threads
  FOR EACH ROW EXECUTE FUNCTION log_thread_activity();

-- Auto-log reaction to activity feed
CREATE OR REPLACE FUNCTION log_reaction_activity()
RETURNS TRIGGER AS $$
DECLARE
  v_space_id UUID;
BEGIN
  -- Get space_id from the note
  SELECT space_id INTO v_space_id FROM clerk_notes WHERE id = NEW.note_id;

  IF v_space_id IS NOT NULL THEN
    INSERT INTO space_activity (space_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      v_space_id,
      NEW.user_id,
      'reaction_added',
      'reaction',
      NEW.id::text,
      jsonb_build_object(
        'note_id', NEW.note_id,
        'emoji', NEW.emoji
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_log_reaction_activity ON note_reactions;
CREATE TRIGGER trg_log_reaction_activity
  AFTER INSERT ON note_reactions
  FOR EACH ROW EXECUTE FUNCTION log_reaction_activity();

-- Auto-log note creation/completion to activity feed
CREATE OR REPLACE FUNCTION log_note_activity()
RETURNS TRIGGER AS $$
DECLARE
  v_space_id UUID;
BEGIN
  v_space_id := COALESCE(NEW.space_id, NEW.couple_id);

  IF v_space_id IS NULL THEN
    RETURN NEW; -- personal note, no activity log
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO space_activity (space_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      v_space_id,
      NEW.author_id,
      'note_created',
      'note',
      NEW.id::text,
      jsonb_build_object(
        'category', NEW.category,
        'preview', left(NEW.summary, 120)
      )
    );

  ELSIF TG_OP = 'UPDATE' THEN
    -- Log completion
    IF NEW.completed = true AND (OLD.completed IS NULL OR OLD.completed = false) THEN
      INSERT INTO space_activity (space_id, actor_id, action, entity_type, entity_id, metadata)
      VALUES (
        v_space_id,
        NEW.author_id,
        'note_completed',
        'note',
        NEW.id::text,
        jsonb_build_object(
          'category', NEW.category,
          'preview', left(NEW.summary, 120)
        )
      );
    END IF;

    -- Log assignment change
    IF NEW.task_owner IS DISTINCT FROM OLD.task_owner AND NEW.task_owner IS NOT NULL THEN
      INSERT INTO space_activity (space_id, actor_id, action, entity_type, entity_id, metadata)
      VALUES (
        v_space_id,
        NEW.author_id,
        'note_assigned',
        'note',
        NEW.id::text,
        jsonb_build_object(
          'assigned_to', NEW.task_owner,
          'preview', left(NEW.summary, 120)
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_log_note_activity ON clerk_notes;
CREATE TRIGGER trg_log_note_activity
  AFTER INSERT OR UPDATE ON clerk_notes
  FOR EACH ROW EXECUTE FUNCTION log_note_activity();

-- Auto-log member join/leave to activity feed
CREATE OR REPLACE FUNCTION log_member_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO space_activity (space_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      NEW.space_id,
      NEW.user_id,
      'member_joined',
      'member',
      NEW.user_id,
      jsonb_build_object('role', NEW.role::text)
    );

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO space_activity (space_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      OLD.space_id,
      OLD.user_id,
      'member_left',
      'member',
      OLD.user_id,
      jsonb_build_object('role', OLD.role::text)
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_log_member_activity ON olive_space_members;
CREATE TRIGGER trg_log_member_activity
  AFTER INSERT OR DELETE ON olive_space_members
  FOR EACH ROW EXECUTE FUNCTION log_member_activity();

-- ─── Extend clerk_notes for multi-member assignment ────────────
-- Add assigned_to column (Clerk user ID, more reliable than task_owner display name)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clerk_notes' AND column_name = 'assigned_to'
  ) THEN
    ALTER TABLE clerk_notes ADD COLUMN assigned_to TEXT;  -- Clerk user ID
    CREATE INDEX IF NOT EXISTS idx_clerk_notes_assigned ON clerk_notes (assigned_to) WHERE assigned_to IS NOT NULL;
  END IF;
END $$;

-- Sync assigned_to from task_owner for existing data where task_owner looks like a user ID
UPDATE clerk_notes
SET assigned_to = task_owner
WHERE task_owner IS NOT NULL
  AND assigned_to IS NULL
  AND task_owner LIKE 'user_%';

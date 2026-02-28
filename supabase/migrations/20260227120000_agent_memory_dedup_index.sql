-- Add partial unique index on user_memories for agent_insight dedup
-- This allows upsert on (user_id, title) WHERE category = 'agent_insight'
-- so daily agent results overwrite previous day's result for the same agent

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_memories_agent_dedup
  ON user_memories(user_id, title) WHERE category = 'agent_insight';

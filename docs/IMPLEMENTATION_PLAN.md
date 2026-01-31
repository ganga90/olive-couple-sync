# Olive Feature Implementation Plan
## 6 Phases: Memory → Gateway → Proactive → Skills → Search → Context

---

## Current State Summary

### Existing Infrastructure
| Component | Status | Notes |
|-----------|--------|-------|
| `user_memories` table | ✅ Exists | Has embeddings, importance scoring |
| `user_sessions` table | ✅ Exists | IDLE/AWAITING_CONFIRMATION states |
| WhatsApp webhook | ✅ Exists | 1400+ lines, Twilio-based |
| Gemini AI service | ✅ Exists | processBrainDump, askOlive |
| Embeddings | ✅ Exists | text-embedding-3-small |
| `search_user_memories` RPC | ✅ Exists | Vector similarity search |

### Gaps to Fill
| Feature | Current State | Target State |
|---------|--------------|--------------|
| Memory persistence | Session-only in WhatsApp | File-like structured memory |
| Proactive messaging | None | Heartbeat + cron triggers |
| Gateway architecture | Webhook (reactive) | Bidirectional gateway |
| Skills system | None | Extensible skill format |
| Hybrid search | Vector only | Vector + BM25 |
| Context management | Basic injection | Smart compaction + pruning |

---

## Phase 1: Persistent Memory System

### 1.1 Database Schema Updates

**New Tables:**

```sql
-- Structured memory files (Moltbot-style)
CREATE TABLE olive_memory_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  couple_id TEXT,
  file_type TEXT NOT NULL CHECK (file_type IN (
    'profile',      -- PROFILE.md - preferences, routines
    'daily',        -- daily/YYYY-MM-DD.md - daily interactions
    'patterns',     -- PATTERNS.md - learned behaviors
    'relationship', -- RELATIONSHIP.md - partner dynamics
    'household'     -- HOUSEHOLD.md - shared couple patterns
  )),
  file_date DATE,  -- For daily files only
  content TEXT NOT NULL DEFAULT '',
  embedding VECTOR(1536),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, file_type, file_date)
);

-- Memory chunks for granular retrieval
CREATE TABLE olive_memory_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_file_id UUID REFERENCES olive_memory_files(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  importance INTEGER DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pattern detection storage
CREATE TABLE olive_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  couple_id TEXT,
  pattern_type TEXT NOT NULL CHECK (pattern_type IN (
    'grocery_day',
    'reminder_preference',
    'task_assignment',
    'communication_style',
    'schedule_preference',
    'category_usage'
  )),
  pattern_data JSONB NOT NULL,
  confidence FLOAT DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  sample_count INTEGER DEFAULT 1,
  last_triggered TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX idx_memory_files_user ON olive_memory_files(user_id);
CREATE INDEX idx_memory_files_couple ON olive_memory_files(couple_id);
CREATE INDEX idx_memory_files_type ON olive_memory_files(file_type);
CREATE INDEX idx_patterns_user ON olive_patterns(user_id);
CREATE INDEX idx_patterns_type ON olive_patterns(pattern_type);
```

### 1.2 Memory Service (Supabase Function)

**File:** `supabase/functions/olive-memory/index.ts`

```typescript
// Actions:
// - read_file: Get memory file content
// - write_file: Update/create memory file
// - append_daily: Add to daily log
// - search_memories: Hybrid search across files
// - flush_context: Extract facts from conversation
// - get_user_context: Retrieve all relevant memory for AI
```

### 1.3 Memory Integration Points

1. **At session start** → Load PROFILE.md + today's daily log + yesterday's log
2. **During conversation** → Track important facts for later flush
3. **Near context limit** → Trigger silent memory flush
4. **After important actions** → Append to daily log

### 1.4 Deliverables
- [ ] Migration file for new tables
- [ ] `olive-memory` Supabase function
- [ ] `useOliveMemory` React hook
- [ ] Memory context injection in AI prompts
- [ ] Automatic memory flush mechanism

---

## Phase 2: WhatsApp Gateway Upgrade

### 2.1 Architecture Change

**Current:** Webhook (reactive only)
```
WhatsApp → Twilio → Webhook → Response
```

**Target:** Bidirectional Gateway
```
WhatsApp ↔ Twilio ↔ Gateway ↔ Olive AI
                       ↓
                  Session Manager
                       ↓
                  Proactive Queue
```

### 2.2 New Components

**Session Manager:**
```sql
CREATE TABLE olive_gateway_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_key TEXT UNIQUE NOT NULL, -- olive:user:{userId}:whatsapp
  user_id TEXT NOT NULL,
  couple_id TEXT,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  phone_number TEXT,
  transcript JSONB DEFAULT '[]',
  context_tokens INTEGER DEFAULT 0,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  reset_policy TEXT DEFAULT 'daily',
  next_reset TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE olive_outbound_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  message TEXT NOT NULL,
  priority INTEGER DEFAULT 5,
  scheduled_for TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.3 Outbound Messaging Service

**File:** `supabase/functions/olive-send-message/index.ts`

- Queue messages for delivery
- Rate limiting (max 5/day configurable)
- Quiet hours respect
- Priority handling

### 2.4 Deliverables
- [ ] Session management tables
- [ ] Outbound queue system
- [ ] `olive-send-message` function
- [ ] Twilio outbound integration
- [ ] Session transcript persistence

---

## Phase 3: Proactive Intelligence (Heartbeat)

### 3.1 Heartbeat Infrastructure

```sql
CREATE TABLE olive_heartbeat_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT UNIQUE NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN (
    'morning_briefing',
    'evening_review',
    'reminder_check',
    'pattern_trigger',
    'important_date',
    'partner_sync',
    'overdue_nudge'
  )),
  user_id TEXT,
  couple_id TEXT,
  schedule TEXT NOT NULL,  -- Cron expression
  timezone TEXT DEFAULT 'UTC',
  config JSONB DEFAULT '{}',
  is_enabled BOOLEAN DEFAULT true,
  next_run TIMESTAMPTZ,
  last_run TIMESTAMPTZ,
  last_result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE olive_heartbeat_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT REFERENCES olive_heartbeat_jobs(job_id),
  run_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL,
  result JSONB,
  messages_sent INTEGER DEFAULT 0
);
```

### 3.2 Heartbeat Jobs

| Job | Schedule | Description |
|-----|----------|-------------|
| `morning_briefing` | 08:00 user TZ | Today's tasks, reminders, important dates |
| `evening_review` | 20:00 user TZ | Unfinished items, tomorrow preview |
| `reminder_check` | Every 15 min | Due reminders |
| `pattern_trigger` | Varies | Pattern-based suggestions |
| `important_date` | 09:00 daily | Upcoming birthdays, anniversaries |
| `partner_sync` | Sunday 19:00 | Weekly couple coordination |
| `overdue_nudge` | 10:00 daily | Overdue task reminders |

### 3.3 Heartbeat Runner

**File:** `supabase/functions/olive-heartbeat/index.ts`

- Called by Supabase CRON or external scheduler
- Checks due jobs, executes, queues messages
- Updates patterns based on user responses

### 3.4 Deliverables
- [ ] Heartbeat tables migration
- [ ] `olive-heartbeat` function
- [ ] Job configuration UI
- [ ] Pattern detection engine
- [ ] User preference settings

---

## Phase 4: Skills System

### 4.1 Skills Format

```markdown
---
name: grocery-optimizer
version: 1.0.0
description: Optimizes grocery lists by store section
category: household
triggers:
  - keyword: "optimize groceries"
  - category: groceries
  - command: /groceries
requires:
  permissions: [read_notes, update_notes]
---

# Grocery Optimizer

When triggered, analyze the user's grocery list and:
1. Group items by store section (Produce, Dairy, Meat, Frozen, Pantry)
2. Check for common items that might be missing
3. Suggest deals if available

## Response Format
Return organized list with sections as headers.
```

### 4.2 Skills Storage

```sql
CREATE TABLE olive_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  category TEXT,
  content TEXT NOT NULL,  -- Full markdown
  triggers JSONB DEFAULT '[]',
  requires JSONB DEFAULT '{}',
  is_builtin BOOLEAN DEFAULT false,
  is_enabled BOOLEAN DEFAULT true,
  install_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE olive_user_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  skill_id TEXT REFERENCES olive_skills(skill_id),
  config JSONB DEFAULT '{}',
  is_enabled BOOLEAN DEFAULT true,
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, skill_id)
);
```

### 4.3 Core Skills

| Skill | Description |
|-------|-------------|
| `couple-coordinator` | Fair task assignment between partners |
| `meal-planner` | Weekly meal suggestions |
| `grocery-optimizer` | Organize shopping list |
| `calendar-optimizer` | Find best times |
| `gift-recommender` | Track preferences for gifts |
| `home-maintenance` | Recurring home tasks |
| `budget-tracker` | Spending patterns |

### 4.4 Deliverables
- [ ] Skills table migration
- [ ] Skills loader/parser
- [ ] Core skills implementation
- [ ] Skills UI in app
- [ ] Skill trigger matching

---

## Phase 5: Hybrid Search

### 5.1 Search Architecture

Combine:
- **Vector similarity** (70% weight) - Semantic understanding
- **BM25 full-text** (30% weight) - Exact matches

### 5.2 Implementation

```sql
-- Enable pg_bm25 extension (if available) or use ts_vector

-- Add full-text search column
ALTER TABLE clerk_notes ADD COLUMN IF NOT EXISTS
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(original_text, '') || ' ' || coalesce(summary, ''))
  ) STORED;

CREATE INDEX idx_notes_search ON clerk_notes USING GIN(search_vector);

-- Hybrid search function
CREATE OR REPLACE FUNCTION hybrid_search_notes(
  p_user_id TEXT,
  p_couple_id TEXT,
  p_query TEXT,
  p_query_embedding VECTOR(1536),
  p_vector_weight FLOAT DEFAULT 0.7,
  p_limit INTEGER DEFAULT 20
) RETURNS TABLE (
  id UUID,
  original_text TEXT,
  summary TEXT,
  category TEXT,
  score FLOAT
) AS $$
  WITH vector_results AS (
    SELECT id, 1 - (embedding <=> p_query_embedding) AS vector_score
    FROM clerk_notes
    WHERE (author_id = p_user_id OR couple_id = p_couple_id)
    ORDER BY embedding <=> p_query_embedding
    LIMIT p_limit * 2
  ),
  text_results AS (
    SELECT id, ts_rank(search_vector, plainto_tsquery('english', p_query)) AS text_score
    FROM clerk_notes
    WHERE (author_id = p_user_id OR couple_id = p_couple_id)
      AND search_vector @@ plainto_tsquery('english', p_query)
    LIMIT p_limit * 2
  ),
  combined AS (
    SELECT
      COALESCE(v.id, t.id) AS id,
      COALESCE(v.vector_score, 0) * p_vector_weight +
      COALESCE(t.text_score, 0) * (1 - p_vector_weight) AS combined_score
    FROM vector_results v
    FULL OUTER JOIN text_results t ON v.id = t.id
  )
  SELECT
    n.id, n.original_text, n.summary, n.category, c.combined_score AS score
  FROM combined c
  JOIN clerk_notes n ON n.id = c.id
  ORDER BY c.combined_score DESC
  LIMIT p_limit;
$$ LANGUAGE sql;
```

### 5.3 Memory Search Enhancement

Similar hybrid approach for `olive_memory_files` and `user_memories`.

### 5.4 Deliverables
- [ ] Full-text index migration
- [ ] `hybrid_search_notes` RPC
- [ ] `hybrid_search_memories` RPC
- [ ] Update `useSupabaseNotes` to use hybrid search
- [ ] Search UI improvements

---

## Phase 6: Context Management

### 6.1 Context Injection Strategy

```typescript
interface OliveContext {
  // Core (always loaded)
  userProfile: string;         // From PROFILE.md
  todayTasks: Note[];

  // Memory (conditional)
  dailyLog: string;            // Today's log
  yesterdayLog: string;        // Yesterday's log
  relevantMemories: Memory[];  // From hybrid search

  // Couple (if applicable)
  partnerContext: string;      // Partner summary
  householdMemory: string;     // HOUSEHOLD.md

  // Patterns
  activePatterns: Pattern[];   // Currently relevant patterns

  // Conversation
  recentHistory: Message[];    // Last N messages
}
```

### 6.2 Context Compaction

```typescript
// When context approaches limit (75% of window)
async function compactContext(session: Session): Promise<void> {
  // 1. Silent memory flush - extract important facts
  await flushToMemory(session.transcript);

  // 2. Summarize old messages
  const summary = await summarizeHistory(session.transcript.slice(0, -10));

  // 3. Replace old messages with summary
  session.transcript = [
    { role: 'system', content: `Previous conversation summary: ${summary}` },
    ...session.transcript.slice(-10)
  ];

  // 4. Prune old tool results
  session.transcript = pruneToolResults(session.transcript);
}
```

### 6.3 Token Monitoring

- Track tokens per session
- Warn at 60% usage
- Auto-compact at 75%
- Hard limit at 90%

### 6.4 Deliverables
- [ ] Context builder service
- [ ] Compaction algorithm
- [ ] Token tracking
- [ ] Memory flush integration
- [ ] Context inspection tools (`/status`, `/context`)

---

## Implementation Order

### Week 1-2: Phase 1 (Memory)
Foundation for everything else. Memory files enable proactive features.

### Week 3-4: Phase 5 (Hybrid Search)
Enhances memory retrieval immediately.

### Week 5-6: Phase 6 (Context)
Completes the memory → context → AI loop.

### Week 7-8: Phase 2 (Gateway)
Enables outbound messaging for proactive features.

### Week 9-10: Phase 3 (Heartbeat)
Requires gateway for message delivery.

### Week 11-12: Phase 4 (Skills)
Final extensibility layer.

---

## Questions for User

Before proceeding, I need to confirm:

1. **Supabase Access**: Do you have admin access to run migrations?

2. **Twilio Configuration**:
   - Current Twilio Account SID/Auth Token location?
   - Phone number for outbound messages?

3. **Embeddings**:
   - Current embedding API (Lovable proxy or direct OpenAI)?
   - API key/endpoint?

4. **Cron/Scheduling**:
   - Supabase pg_cron extension enabled?
   - Or external scheduler preference (Vercel Cron, etc.)?

5. **Environment Variables**: Current location of secrets?

6. **Rate Limits**:
   - Max proactive messages per user per day?
   - Quiet hours preference?

7. **Timezone Handling**:
   - User timezone stored in `clerk_profiles.timezone`?
   - Default timezone if not set?

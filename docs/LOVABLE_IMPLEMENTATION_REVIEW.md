# Lovable Agent Implementation Review Guide

## Overview

This document provides a structured review checklist for the Moltbot-inspired features implemented in Olive. The Lovable agent should verify each component is correctly integrated with the web app.

---

## 1. DATABASE MIGRATION REVIEW

### File: `supabase/migrations/20260129000001_olive_memory_system.sql`

**Required Extensions:**
```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

**Tables to Verify Exist:**

| Table Name | Purpose | Key Columns |
|------------|---------|-------------|
| `olive_memory_files` | Stores structured memory (profile, daily logs) | `user_id`, `file_type`, `content`, `embedding` |
| `olive_memory_chunks` | Granular memory for semantic search | `memory_file_id`, `content`, `chunk_type`, `importance`, `embedding` |
| `olive_patterns` | Behavioral patterns | `user_id`, `pattern_type`, `pattern_data`, `confidence` |
| `olive_gateway_sessions` | WhatsApp session management | `user_id`, `channel`, `conversation_context`, `is_active` |
| `olive_outbound_queue` | Outbound message queue | `user_id`, `message_type`, `content`, `status`, `scheduled_for` |
| `olive_heartbeat_jobs` | Scheduled proactive jobs | `user_id`, `job_type`, `scheduled_for`, `status` |
| `olive_heartbeat_log` | Execution history | `user_id`, `job_type`, `status`, `message_preview` |
| `olive_skills` | Skill definitions | `skill_id`, `name`, `triggers`, `content` |
| `olive_user_skills` | User-installed skills | `user_id`, `skill_id`, `enabled`, `config` |
| `olive_user_preferences` | User proactive settings | `user_id`, `proactive_enabled`, `quiet_hours_start/end` |

**RPC Functions to Verify:**
- `get_or_create_memory_file(p_user_id, p_file_type, p_file_date)`
- `append_to_daily_log(p_user_id, p_content, p_source)`
- `search_memory_chunks(p_user_id, p_query_embedding, p_limit, p_min_importance)`
- `get_user_memory_context(p_user_id, p_couple_id, p_include_daily)`
- `update_pattern(p_user_id, p_couple_id, p_pattern_type, p_observation)`
- `is_quiet_hours(p_user_id, p_timezone)`
- `can_send_proactive(p_user_id, p_timezone)`
- `hybrid_search_notes(p_user_id, p_couple_id, p_query, p_query_embedding, p_vector_weight, p_limit)`

**RLS Policies:**
- All tables have RLS enabled
- Users can only access their own data (`user_id = auth.jwt()->>'sub'`)
- Service role has bypass policies for edge functions

**Action Required:**
```bash
# Apply migration
supabase db push

# Or manually run in Supabase SQL Editor
```

---

## 2. EDGE FUNCTIONS REVIEW

### 2.1 `olive-memory` Function

**File:** `supabase/functions/olive-memory/index.ts`

**Actions Supported:**
| Action | Description | Required Params |
|--------|-------------|-----------------|
| `get_file` | Read a memory file | `file_type`, optional `file_date` |
| `read_file` | Alias for get_file | `file_type`, optional `file_date` |
| `write_file` | Create/update memory file | `file_type`, `content` |
| `append_daily` | Append to today's log | `content`, optional `source` |
| `add_chunk` | Add memory chunk with embedding | `file_type`, `content`, `chunk_type` |
| `search_chunks` | Semantic search | `query`, `limit` |
| `get_context` | Get full memory context for AI | optional `couple_id` |
| `flush_context` | Extract facts from conversation | `conversation` |
| `update_pattern` | Update behavioral pattern | `pattern_type`, `observation` |
| `get_patterns` | Get active patterns | optional `min_confidence` |
| `get_preferences` | Get user preferences | none |
| `update_preferences` | Update preferences | `preferences` object |
| `initialize_user` | Initialize memory for new user | none |

**Environment Variables Required:**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LOVABLE_API_KEY` (for embeddings)

**Deployment:**
```bash
supabase functions deploy olive-memory
```

---

### 2.2 `whatsapp-gateway` Function

**File:** `supabase/functions/whatsapp-gateway/index.ts`

**Actions Supported:**
| Action | Description | Required Params |
|--------|-------------|-----------------|
| `send` | Send message immediately | `message` object |
| `queue` | Queue message for later | `message` object |
| `process_queue` | Process pending messages | none |
| `get_session` | Get/create gateway session | `user_id` |
| `check_delivery` | Check Twilio delivery status | `message_id` |

**Message Object Structure:**
```typescript
{
  user_id: string;
  message_type: 'reminder' | 'proactive_nudge' | 'morning_briefing' |
                'evening_review' | 'weekly_summary' | 'task_update' |
                'partner_notification' | 'system_alert';
  content: string;
  media_url?: string;
  scheduled_for?: string;
  priority?: 'low' | 'normal' | 'high';
}
```

**Environment Variables Required:**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER` (default: +17542511999)

**Deployment:**
```bash
supabase functions deploy whatsapp-gateway
```

---

### 2.3 `olive-heartbeat` Function

**File:** `supabase/functions/olive-heartbeat/index.ts`

**Actions Supported:**
| Action | Description | Required Params |
|--------|-------------|-----------------|
| `tick` | Main heartbeat (call every 15 min) | none |
| `generate_briefing` | Generate morning briefing | `user_id` |
| `schedule_job` | Schedule a heartbeat job | `user_id`, `job_type` |
| `check_reminders` | Process task reminders | none |

**Job Types:**
- `morning_briefing` - Daily task summary
- `evening_review` - End of day review
- `weekly_summary` - Weekly productivity report
- `task_reminder` - Individual task reminders
- `overdue_nudge` - Overdue task notifications
- `pattern_suggestion` - AI-suggested improvements

**pg_cron Setup Required:**
```sql
-- Run in Supabase SQL Editor after enabling pg_cron
SELECT cron.schedule(
  'olive-heartbeat-tick',
  '*/15 * * * *',  -- Every 15 minutes
  $$
  SELECT net.http_post(
    url := 'https://wtfspzvcetxmcfftwonq.supabase.co/functions/v1/olive-heartbeat',
    body := '{"action": "tick"}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    )
  )
  $$
);
```

**Deployment:**
```bash
supabase functions deploy olive-heartbeat
```

---

### 2.4 `olive-skills` Function

**File:** `supabase/functions/olive-skills/index.ts`

**Actions Supported:**
| Action | Description | Required Params |
|--------|-------------|-----------------|
| `list_available` | List all skills | none |
| `list_installed` | List user's installed skills | `user_id` |
| `install` | Install a skill | `user_id`, `skill_id` |
| `uninstall` | Disable a skill | `user_id`, `skill_id` |
| `configure` | Update skill config | `user_id`, `skill_id`, `config` |
| `match` | Match message to skill | `user_id`, `message` |
| `execute` | Execute a skill | `user_id`, `skill_id`, `message` |
| `get_skill` | Get skill details | `skill_id` |

**Built-in Skills (auto-inserted by migration):**
1. `couple-coordinator` - Fair task assignment
2. `grocery-optimizer` - Shopping list organization
3. `meal-planner` - Weekly meal suggestions
4. `gift-recommender` - Gift tracking
5. `home-maintenance` - Recurring household tasks
6. `budget-tracker` - Spending analysis

**Deployment:**
```bash
supabase functions deploy olive-skills
```

---

### 2.5 `olive-search` Function

**File:** `supabase/functions/olive-search/index.ts`

**Actions Supported:**
| Action | Description | Required Params |
|--------|-------------|-----------------|
| `search_notes` | Hybrid search on notes | `user_id`, `query` |
| `search_memory` | Semantic search on memory | `user_id`, `query` |
| `search_all` | Search both sources | `user_id`, `query` |
| `generate_embedding` | Generate embedding for text | `query` |

**Search Options:**
```typescript
{
  filters?: {
    categories?: string[];
    date_from?: string;
    date_to?: string;
    priority?: string[];
    completed?: boolean;
    has_due_date?: boolean;
  };
  limit?: number;  // default: 20
  vector_weight?: number;  // default: 0.7 (70% vector, 30% BM25)
}
```

**Deployment:**
```bash
supabase functions deploy olive-search
```

---

## 3. REACT HOOKS REVIEW

### 3.1 `useOliveMemory` Hook

**File:** `src/hooks/useOliveMemory.ts`

**Exports:**
```typescript
// Main hook
useOliveMemory(): UseOliveMemoryReturn

// For AI conversations
useMemoryContext(): {
  trackMessage, shouldFlush, flush, buildContext, autoFlushIfNeeded
}

// Types
MemoryFileType, ChunkType, PatternType, MemoryFile, MemoryChunk,
Pattern, MemoryContext, UserPreferences
```

**Integration Points:**
- Import in components that need memory access
- Use `useMemoryContext` in chat/conversation components

---

### 3.2 `useWhatsAppGateway` Hook

**File:** `src/hooks/useWhatsAppGateway.ts`

**Exports:**
```typescript
useWhatsAppGateway(): {
  sendMessage, sendToUser, queueMessage, queueForUser,
  getSession, checkDelivery,
  // Helpers
  sendReminder, sendTaskUpdate, sendPartnerNotification
}
```

---

### 3.3 `useOliveHeartbeat` Hook

**File:** `src/hooks/useOliveHeartbeat.ts`

**Exports:**
```typescript
useOliveHeartbeat(): {
  preferences, updatePreferences, refreshPreferences,
  requestBriefing, requestEveningReview, requestWeeklySummary,
  scheduleJob, getPendingJobs, cancelJob,
  getRecentHistory, getStats
}
```

---

### 3.4 `useOliveSkills` Hook

**File:** `src/hooks/useOliveSkills.ts`

**Exports:**
```typescript
useOliveSkills(): {
  availableSkills, installedSkills, refreshSkills,
  installSkill, uninstallSkill, configureSkill,
  matchSkill, executeSkill,
  getSkillsByCategory, isSkillInstalled
}
```

---

### 3.5 `useOliveSearch` Hook

**File:** `src/hooks/useOliveSearch.ts`

**Exports:**
```typescript
useOliveSearch(): {
  isSearching, results, breakdown, searchMethod,
  search, searchNotes, searchMemory, searchAll,
  clearResults, generateEmbedding
}
```

---

### 3.6 `useOlive` (Unified Hook)

**File:** `src/hooks/useOlive.ts`

**This is the MAIN hook that combines all features:**

```typescript
useOlive(): {
  // Loading states
  isLoading, isMemoryLoading, isSearching,

  // Memory
  memoryContext, refreshMemory, updateProfile, appendToDaily,

  // AI Interaction
  ask(question, conversationHistory?),
  processBrainDump(input),

  // Search
  search(query, options?),
  searchWithMemory(query),

  // Skills
  matchSkill, executeSkill, installedSkills,

  // Proactive
  preferences, updatePreferences, requestBriefing,

  // WhatsApp
  sendWhatsAppMessage,

  // Utilities
  estimateTokens, flushConversationToMemory
}
```

**Recommended Usage:**
```tsx
import { useOlive } from '@/hooks/useOlive';

function MyComponent() {
  const { ask, memoryContext, search, preferences } = useOlive();

  const handleAsk = async (question: string) => {
    const response = await ask(question, conversationHistory);
    // response includes: answer, skillUsed, contextStats, shouldFlushContext
  };
}
```

---

## 4. TYPE DEFINITIONS REVIEW

**File:** `src/types/memory.ts`

**Types Exported:**
```typescript
// Memory file types
type MemoryFileType = 'profile' | 'daily' | 'patterns' | 'relationship' | 'household';
type ChunkType = 'fact' | 'event' | 'decision' | 'pattern' | 'interaction';
type PatternType = 'grocery_day' | 'reminder_preference' | 'task_assignment' |
                   'communication_style' | 'schedule_preference' | 'category_usage' |
                   'completion_time' | 'response_pattern' | 'partner_coordination' |
                   'shopping_frequency';

// Interfaces
interface MemoryFile { ... }
interface MemoryChunk { ... }
interface Pattern { ... }
interface MemoryContext { ... }
interface UserPreferences { ... }
interface ExtractedFact { ... }
interface DetectedPattern { ... }
```

---

## 5. AI SERVICE INTEGRATION REVIEW

**File:** `src/lib/ai/gemini-service.ts`

**Key Changes:**
1. Added `memoryContext?: MemoryContext` to `BrainDumpInput` and `AskOliveRequest`
2. New `buildMemorySection()` method for context injection
3. New `describePattern()` method for human-readable patterns
4. New methods:
   - `extractFactsFromConversation(conversation)` - Extract facts for memory
   - `summarizeActivity(activities)` - Create daily log summaries
   - `detectPatterns(data)` - Detect behavioral patterns

**Memory Context Injection:**
The `buildAskOlivePrompt` method now includes:
```
## User Memory Context
### Profile
[user profile content]

### Today's Activity
[today's log]

### Yesterday's Activity
[yesterday's log]

### Observed Patterns
- [pattern descriptions]
```

---

## 6. CONTEXT MANAGER REVIEW

**File:** `src/lib/context-manager.ts`

**Key Functions:**
```typescript
// Token estimation
estimateTokens(text: string): number

// Create context window from memory
createContextWindow(memoryContext, conversationHistory, additionalContext): ContextWindow

// Check thresholds
needsCompaction(window): boolean  // at 85%
shouldFlushMemory(window): boolean  // at 75%

// Compact context
compactContext(window): { window, result: CompactionResult }

// Build final prompt
buildPromptFromWindow(window, userMessage): string

// Get statistics
getWindowStats(window): ContextStats

// Main helper
createOptimizedContext(memoryContext, history, message, additional): {
  prompt, stats, wasCompacted, shouldFlush
}
```

**Constants:**
- `CHARS_PER_TOKEN = 4`
- `MAX_CONTEXT_TOKENS = 8000`
- `FLUSH_THRESHOLD = 0.75` (75%)
- `COMPACT_THRESHOLD = 0.85` (85%)

---

## 7. ENVIRONMENT VARIABLES CHECKLIST

**Required in Supabase Dashboard → Edge Functions → Secrets:**

| Variable | Purpose | Example |
|----------|---------|---------|
| `SUPABASE_URL` | Database URL | `https://wtfspzvcetxmcfftwonq.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key | (from Supabase settings) |
| `LOVABLE_API_KEY` | AI gateway for embeddings | (from Lovable) |
| `TWILIO_ACCOUNT_SID` | Twilio account | `AC...` (from Twilio console) |
| `TWILIO_AUTH_TOKEN` | Twilio auth | (from Twilio) |
| `TWILIO_PHONE_NUMBER` | WhatsApp number | `+17542511999` |

---

## 8. SUPABASE CONFIG REVIEW

**File:** `supabase/config.toml`

**Add/verify these function configurations:**
```toml
[functions.olive-memory]
verify_jwt = true

[functions.whatsapp-gateway]
verify_jwt = true

[functions.olive-heartbeat]
verify_jwt = false  # Called by pg_cron

[functions.olive-skills]
verify_jwt = true

[functions.olive-search]
verify_jwt = true
```

---

## 9. INTEGRATION VERIFICATION CHECKLIST

### Database
- [ ] Migration applied successfully
- [ ] All 10 tables created
- [ ] RLS policies active
- [ ] RPC functions working
- [ ] Vector extension enabled
- [ ] Full-text search index on `clerk_notes`

### Edge Functions
- [ ] `olive-memory` deployed and responding
- [ ] `whatsapp-gateway` deployed and responding
- [ ] `olive-heartbeat` deployed and responding
- [ ] `olive-skills` deployed and responding
- [ ] `olive-search` deployed and responding

### React Integration
- [ ] `useOlive` hook imports without errors
- [ ] Memory context loads on app start
- [ ] Search returns results
- [ ] Preferences can be updated

### AI Integration
- [ ] Memory context injected into prompts
- [ ] Skill matching works
- [ ] Context compaction triggers at threshold

### Proactive Features
- [ ] pg_cron job scheduled
- [ ] Morning briefing generates correctly
- [ ] Quiet hours respected
- [ ] Rate limiting works

---

## 10. TESTING COMMANDS

**Test Memory System:**
```typescript
const { getContext, appendToDaily, searchChunks } = useOliveMemory();

// Get context
const ctx = await getContext();
console.log('Memory context:', ctx);

// Append to daily log
await appendToDaily('Tested the memory system');

// Search
const results = await searchChunks('grocery shopping');
```

**Test Search:**
```typescript
const { searchAll } = useOliveSearch();

const results = await searchAll('urgent tasks', {
  filters: { completed: false },
  limit: 10
});
```

**Test Skills:**
```typescript
const { matchSkill, executeSkill } = useOliveSkills();

const match = await matchSkill('help me plan meals for the week');
if (match.matched) {
  const result = await executeSkill(match.skill.skill_id, 'plan meals');
}
```

**Test Heartbeat:**
```typescript
const { requestBriefing, getStats } = useOliveHeartbeat();

const briefing = await requestBriefing();
const stats = await getStats();
```

---

## 11. COMMON ISSUES & SOLUTIONS

### Issue: "relation does not exist"
**Solution:** Run the database migration
```bash
supabase db push
```

### Issue: "function not found"
**Solution:** Deploy edge functions
```bash
supabase functions deploy olive-memory
supabase functions deploy whatsapp-gateway
supabase functions deploy olive-heartbeat
supabase functions deploy olive-skills
supabase functions deploy olive-search
```

### Issue: Embeddings not generating
**Solution:** Check `LOVABLE_API_KEY` is set in Supabase secrets

### Issue: WhatsApp messages not sending
**Solution:** Verify Twilio credentials and phone number format

### Issue: Heartbeat not running
**Solution:** Set up pg_cron job (see Section 2.3)

---

## 12. FILE STRUCTURE SUMMARY

```
src/
├── hooks/
│   ├── useOlive.ts              # Unified hook (main entry point)
│   ├── useOliveMemory.ts        # Memory system
│   ├── useOliveHeartbeat.ts     # Proactive features
│   ├── useOliveSkills.ts        # Skills system
│   ├── useOliveSearch.ts        # Hybrid search
│   └── useWhatsAppGateway.ts    # WhatsApp messaging
├── lib/
│   ├── ai/
│   │   └── gemini-service.ts    # AI with memory integration
│   └── context-manager.ts       # Token optimization
└── types/
    └── memory.ts                # Type definitions

supabase/
├── functions/
│   ├── olive-memory/index.ts
│   ├── olive-heartbeat/index.ts
│   ├── olive-skills/index.ts
│   ├── olive-search/index.ts
│   └── whatsapp-gateway/index.ts
└── migrations/
    └── 20260129000001_olive_memory_system.sql

docs/
├── IMPLEMENTATION_PLAN.md
├── MOLTBOT_IMPLEMENTATION_SUMMARY.md
├── MOLTBOT_INSPIRED_IMPROVEMENTS.md
└── LOVABLE_IMPLEMENTATION_REVIEW.md
```

---

## 13. NEXT STEPS FOR LOVABLE AGENT

1. **Verify Database Migration**
   - Check Supabase dashboard for new tables
   - Run test queries on RPC functions

2. **Deploy Edge Functions**
   - Deploy all 5 functions
   - Set environment variables

3. **Set Up pg_cron**
   - Enable pg_cron extension
   - Schedule heartbeat job

4. **Create Settings UI**
   - Add proactive preferences screen
   - Add skills management screen

5. **Integrate with Existing Features**
   - Update Ask Olive to use `useOlive` hook
   - Update brain dump to include memory context
   - Add search to task list views

6. **Test End-to-End**
   - Test memory persistence across sessions
   - Test skill triggering
   - Test proactive notifications

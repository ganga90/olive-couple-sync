# Olive Improvement Recommendations
## Inspired by Moltbot/Clawdbot Architecture

This document outlines strategic improvements for Olive based on best practices from [Moltbot](https://docs.molt.bot) - one of the fastest-growing open-source AI projects (60k+ GitHub stars). These recommendations focus on **memory, persistence, context, availability, and integrations** as key pillars.

---

## Executive Summary

Moltbot's success comes from treating AI as an **always-available, context-aware assistant** that can proactively help users rather than just react to commands. For Olive, this means evolving from a "note-taking app with AI features" to a **proactive couple AI assistant** that maintains deep understanding of both partners' lives.

### Key Pillars for Olive

| Pillar | Current State | Moltbot-Inspired Future |
|--------|--------------|-------------------------|
| **Memory** | Session-based with limited persistence | File-based persistent memory with semantic search |
| **Persistence** | Notes stored, but no AI memory | Long-term AI memory of preferences, routines, patterns |
| **Context** | Single conversation context | Multi-channel unified context with compaction |
| **Availability** | App must be open | Always-on via WhatsApp/messaging with proactive alerts |
| **Integration** | Calendar, limited APIs | MCP-based extensible integrations with 700+ skills |

---

## 1. Persistent Memory System

### What Moltbot Does

Moltbot treats **files as the source of truth** for memory, not ephemeral RAM:

```
memory/
├── YYYY-MM-DD.md    # Daily logs (append-only)
├── MEMORY.md        # Long-term curated facts
├── USER.md          # User profile & preferences
└── SOUL.md          # Persona & behavioral rules
```

Key insight: *"The model only 'remembers' what gets written to disk"*

### Olive Implementation

**1.1 User Memory Files** (per user)
```
olive-memory/
├── [userId]/
│   ├── daily/
│   │   └── 2026-01-29.md     # Today's interactions, decisions
│   ├── PROFILE.md            # Preferences, routines, important dates
│   ├── PATTERNS.md           # Learned behavioral patterns
│   └── RELATIONSHIP.md       # Partner dynamics, shared preferences
```

**1.2 Couple Memory** (shared)
```
olive-memory/
├── [coupleId]/
│   ├── HOUSEHOLD.md          # Shared routines, grocery patterns
│   ├── CALENDAR_PATTERNS.md  # Scheduling preferences
│   ├── COMMUNICATION.md      # How they prefer to coordinate
│   └── IMPORTANT_DATES.md    # Birthdays, anniversaries, etc.
```

**1.3 Automatic Memory Flush**

Like Moltbot, implement a **silent memory turn** before context compaction:
- When conversation approaches token limit
- System triggers: "Write any important facts to memory files"
- No user-visible output

```typescript
// Example: Memory flush trigger
const MEMORY_FLUSH_THRESHOLD = 0.75; // 75% of context window

async function checkMemoryFlush(tokenCount: number, maxTokens: number) {
  if (tokenCount / maxTokens > MEMORY_FLUSH_THRESHOLD) {
    await triggerSilentMemoryTurn({
      prompt: "Review conversation for any preferences, decisions, or facts worth remembering. Write to appropriate memory file.",
      noReply: true
    });
  }
}
```

### Value for Olive

- **Olive remembers** that Sarah prefers morning reminders, Mike handles grocery shopping
- **Pattern recognition**: "You usually buy milk on Thursdays"
- **Proactive suggestions**: "Based on your patterns, should I add milk to tomorrow's list?"
- **Relationship awareness**: Knows who handles what without being told each time

---

## 2. Multi-Channel Availability (WhatsApp Gateway)

### What Moltbot Does

Moltbot runs a **Gateway daemon** that bridges messaging platforms to AI:
- WhatsApp, Telegram, Discord, iMessage, Signal
- Single long-lived process owns all connections
- Per-sender session isolation
- Group mention-based activation

### Olive Implementation

**2.1 Olive WhatsApp Gateway**

Transform Olive's existing WhatsApp webhook into a full bidirectional gateway:

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  WhatsApp   │────▶│    Olive     │────▶│   Supabase  │
│   (User)    │◀────│   Gateway    │◀────│   + AI      │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    │   Session   │
                    │   Manager   │
                    └─────────────┘
```

**2.2 Session Management**

Adapt Moltbot's session architecture:
- **DM sessions**: `olive:user:<userId>:dm`
- **Couple sessions**: `olive:couple:<coupleId>:shared`
- **Group sessions**: `olive:group:<groupId>`

```typescript
interface OliveSession {
  id: string;
  type: 'dm' | 'couple' | 'group';
  participantIds: string[];
  transcript: Message[];
  memoryContext: string[];
  lastActivity: Date;
  resetPolicy: 'daily' | 'idle' | 'manual';
}
```

**2.3 Proactive Messaging**

Enable Olive to **initiate conversations** (not just respond):

```typescript
// Proactive reminder example
const proactiveChecks = [
  {
    trigger: 'daily_morning',
    time: '08:00',
    action: async (user) => {
      const todayTasks = await getTodayTasks(user.id);
      if (todayTasks.length > 0) {
        await sendWhatsApp(user.phone,
          `Good morning! You have ${todayTasks.length} items today:\n` +
          todayTasks.map(t => `• ${t.text}`).join('\n')
        );
      }
    }
  },
  {
    trigger: 'grocery_pattern',
    check: async (user) => {
      const isGroceryDay = await checkGroceryPattern(user.id);
      const hasGroceryList = await hasUncheckedGroceries(user.id);
      return isGroceryDay && hasGroceryList;
    },
    action: async (user) => {
      await sendWhatsApp(user.phone,
        "Looks like it's your usual grocery day! Want me to send you the list?"
      );
    }
  }
];
```

### Value for Olive

- **True 24/7 availability**: Users interact via WhatsApp without opening app
- **Proactive assistant**: Olive reminds, suggests, coordinates
- **Natural integration**: Couples already use WhatsApp; Olive joins naturally
- **Offline resilience**: Gateway queues messages when app is closed

---

## 3. Skills & Extensibility System

### What Moltbot Does

700+ community skills extending capabilities:
- Skills are Markdown files with YAML frontmatter
- Three-tier loading: bundled → local → workspace
- Skills can inject context, tools, and behaviors

### Olive Implementation

**3.1 Olive Skills Format**

```markdown
---
name: grocery-optimizer
description: Optimizes grocery lists based on store layouts and deals
version: 1.0.0
category: household
requires:
  env: [STORE_API_KEY]
tools:
  - name: optimize_grocery_list
    description: Reorders items by store section
  - name: find_deals
    description: Searches weekly deals for list items
---

# Grocery Optimizer

When the user asks to optimize their grocery list, analyze items
and reorder by store section: Produce → Dairy → Meat → Frozen → Pantry.

Check for weekly deals on items and suggest alternatives.
```

**3.2 Core Olive Skills**

| Skill | Description |
|-------|-------------|
| `couple-coordinator` | Helps assign tasks fairly between partners |
| `meal-planner` | Suggests meals based on preferences and pantry |
| `calendar-optimizer` | Finds best times for couple activities |
| `budget-tracker` | Monitors spending patterns |
| `gift-recommender` | Remembers preferences for gift occasions |
| `home-maintenance` | Tracks and reminds about home tasks |
| `travel-planner` | Plans trips with both partners' preferences |

**3.3 Skills Registry**

Create `OliveHub` for community skills:
- Discovery and installation via CLI/app
- Verification and trust scores
- Usage analytics

### Value for Olive

- **Rapid feature expansion** without core app changes
- **Community contributions** extend capabilities
- **Personalization**: Users install skills they need
- **Enterprise opportunity**: Premium skill marketplace

---

## 4. Context Management & Compaction

### What Moltbot Does

- Automatic context pruning (old tool results removed)
- Silent compaction turns summarize history
- Workspace files injected at session start
- Token monitoring with `/status` command

### Olive Implementation

**4.1 Context Injection Strategy**

At each Olive AI session, inject:

```typescript
const contextInjection = {
  // Core context (always)
  userProfile: await getMemoryFile(userId, 'PROFILE.md'),
  todayTasks: await getTodayTasks(userId),

  // Couple context (if applicable)
  partnerContext: user.coupleId ? await getPartnerSummary(user.coupleId) : null,
  householdMemory: user.coupleId ? await getMemoryFile(coupleId, 'HOUSEHOLD.md') : null,

  // Daily context
  dailyLog: await getMemoryFile(userId, `daily/${today}.md`),
  yesterdayLog: await getMemoryFile(userId, `daily/${yesterday}.md`),

  // Relevant notes (semantic search)
  relevantNotes: await semanticSearchNotes(currentQuery, userId),
};
```

**4.2 Hybrid Search**

Implement Moltbot's hybrid search approach:

```typescript
// 70% vector similarity + 30% BM25 full-text
async function hybridSearch(query: string, userId: string) {
  const [vectorResults, textResults] = await Promise.all([
    vectorSimilaritySearch(query, userId),
    bm25Search(query, userId)
  ]);

  return combineResults(vectorResults, textResults, {
    vectorWeight: 0.7,
    textWeight: 0.3
  });
}
```

### Value for Olive

- **Smarter responses**: AI has full context of user's life
- **Efficient token usage**: Only relevant context loaded
- **Long conversations**: Compaction prevents context overflow
- **Cross-session intelligence**: Daily logs provide continuity

---

## 5. Proactive Intelligence (Heartbeat System)

### What Moltbot Does

- Cron-based scheduled checks
- Proactive notifications when thresholds met
- "Heartbeat Engine" wakes agent periodically

### Olive Implementation

**5.1 Olive Heartbeat Jobs**

```typescript
const oliveHeartbeats = [
  // Daily check-ins
  {
    id: 'morning-briefing',
    schedule: '0 8 * * *', // 8 AM daily
    condition: (user) => user.preferences.morningBriefing,
    action: async (user) => {
      const briefing = await generateMorningBriefing(user.id);
      await sendNotification(user.id, briefing);
    }
  },

  // Pattern-based triggers
  {
    id: 'forgot-to-add',
    schedule: '0 20 * * *', // 8 PM check
    condition: async (user) => {
      const mentions = await findUnprocessedMentions(user.id);
      return mentions.length > 0;
    },
    action: async (user, mentions) => {
      await sendWhatsApp(user.phone,
        `Hey! Earlier you mentioned: "${mentions[0]}". Want me to add it as a note?`
      );
    }
  },

  // Couple coordination
  {
    id: 'weekly-sync',
    schedule: '0 19 * * 0', // Sunday 7 PM
    condition: (couple) => couple.preferences.weeklySyncEnabled,
    action: async (couple) => {
      const summary = await generateWeeklySummary(couple.id);
      await sendToBothPartners(couple, summary);
    }
  },

  // Smart reminders
  {
    id: 'upcoming-important',
    schedule: '0 9 * * *',
    action: async (user) => {
      const upcoming = await getUpcomingImportantDates(user.id, 7);
      if (upcoming.length > 0) {
        const nearest = upcoming[0];
        await sendWhatsApp(user.phone,
          `📅 Reminder: ${nearest.title} is in ${nearest.daysAway} days!`
        );
      }
    }
  }
];
```

**5.2 Event-Driven Triggers**

```typescript
const eventTriggers = [
  // Grocery pattern detection
  {
    event: 'note_completed',
    condition: (note) => note.category === 'groceries',
    action: async (note, user) => {
      await updateGroceryPattern(user.id, note);
    }
  },

  // Task overdue
  {
    event: 'task_overdue',
    action: async (task, user) => {
      await sendWhatsApp(user.phone,
        `⏰ "${task.text}" was due ${formatRelative(task.dueDate)}. Still need to do it?`
      );
    }
  },

  // Partner coordination
  {
    event: 'task_assigned',
    condition: (task) => task.assignee === 'partner',
    action: async (task, couple) => {
      const partner = await getPartner(couple.id, task.createdBy);
      await sendWhatsApp(partner.phone,
        `${task.createdByName} assigned you: "${task.text}"`
      );
    }
  }
];
```

### Value for Olive

- **Proactive assistant**: Olive anticipates needs
- **Relationship helper**: Facilitates couple coordination
- **Never forget**: Important dates always remembered
- **Behavioral insights**: Patterns surface automatically

---

## 6. Multi-Agent Architecture (Future)

### What Moltbot Does

- Multiple isolated agents per gateway
- Per-agent workspaces, auth, and personas
- Deterministic routing based on context

### Olive Implementation (Future)

**6.1 Specialized Olive Agents**

```
┌─────────────────────────────────────────────────────────────┐
│                    Olive Gateway                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Olive     │  │   Olive     │  │   Olive     │        │
│  │   Daily     │  │   Planner   │  │   Memory    │        │
│  │   (Quick)   │  │   (Deep)    │  │   (Search)  │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│       │                │                 │                 │
│       └────────────────┼─────────────────┘                 │
│                        │                                   │
│              ┌─────────┴─────────┐                         │
│              │  Routing Engine   │                         │
│              └───────────────────┘                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

- **Olive Daily**: Fast responses for quick tasks (Haiku-class)
- **Olive Planner**: Deep thinking for meal plans, trips (Sonnet-class)
- **Olive Memory**: Specialized for recall and search

### Value for Olive

- **Cost optimization**: Simple queries use cheaper models
- **Specialized expertise**: Each agent excels at specific tasks
- **Parallel processing**: Multiple agents handle different aspects

---

## 7. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-4)
- [ ] Implement file-based memory system
- [ ] Add memory injection to AI prompts
- [ ] Create automatic memory flush mechanism
- [ ] Implement hybrid search for notes

### Phase 2: Availability (Weeks 5-8)
- [ ] Upgrade WhatsApp webhook to bidirectional gateway
- [ ] Implement session management
- [ ] Add proactive messaging capabilities
- [ ] Create heartbeat job system

### Phase 3: Intelligence (Weeks 9-12)
- [ ] Build pattern detection engine
- [ ] Implement couple coordination features
- [ ] Add context compaction
- [ ] Create proactive suggestion system

### Phase 4: Extensibility (Weeks 13-16)
- [ ] Design skills format and loader
- [ ] Create core Olive skills
- [ ] Build skills registry (OliveHub)
- [ ] Enable community contributions

### Phase 5: Scale (Weeks 17-20)
- [ ] Multi-agent architecture
- [ ] Model routing optimization
- [ ] Enterprise features
- [ ] Analytics and insights

---

## 8. Technical Architecture Changes

### 8.1 New Services

```
supabase/functions/
├── olive-gateway/           # WhatsApp bidirectional gateway
├── olive-memory/            # Memory file management
├── olive-heartbeat/         # Proactive job scheduler
├── olive-search/            # Hybrid semantic search
└── olive-skills/            # Skills loader and executor
```

### 8.2 New Database Tables

```sql
-- Memory storage
CREATE TABLE olive_memory_files (
  id UUID PRIMARY KEY,
  user_id TEXT,
  couple_id TEXT,
  file_path TEXT NOT NULL,
  content TEXT,
  embeddings VECTOR(1536),
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

-- Session management
CREATE TABLE olive_sessions (
  id UUID PRIMARY KEY,
  session_key TEXT UNIQUE,
  type TEXT CHECK (type IN ('dm', 'couple', 'group')),
  participant_ids TEXT[],
  transcript JSONB,
  memory_context JSONB,
  last_activity TIMESTAMPTZ,
  reset_policy TEXT
);

-- Heartbeat jobs
CREATE TABLE olive_heartbeat_jobs (
  id UUID PRIMARY KEY,
  job_id TEXT UNIQUE,
  schedule TEXT,
  next_run TIMESTAMPTZ,
  last_run TIMESTAMPTZ,
  user_id TEXT,
  couple_id TEXT,
  config JSONB
);

-- Pattern storage
CREATE TABLE olive_patterns (
  id UUID PRIMARY KEY,
  user_id TEXT,
  couple_id TEXT,
  pattern_type TEXT,
  pattern_data JSONB,
  confidence FLOAT,
  last_updated TIMESTAMPTZ
);
```

### 8.3 New Configuration

```typescript
// olive.config.ts
export const oliveConfig = {
  memory: {
    dailyLogRetention: 30, // days
    compactionThreshold: 0.75,
    embeddingModel: 'text-embedding-3-small',
    hybridSearchWeights: { vector: 0.7, text: 0.3 }
  },

  gateway: {
    sessionResetPolicy: 'daily',
    sessionResetTime: '04:00',
    idleTimeoutMinutes: 60,
    maxSessionsPerUser: 10
  },

  heartbeat: {
    enabled: true,
    morningBriefingTime: '08:00',
    eveningReviewTime: '20:00',
    timezone: 'user' // Use user's timezone
  },

  proactive: {
    enabled: true,
    maxDailyMessages: 5,
    quietHours: { start: '22:00', end: '07:00' }
  }
};
```

---

## 9. Value Summary

| Feature | User Benefit | Business Value |
|---------|--------------|----------------|
| **Persistent Memory** | "Olive knows me" | Higher retention, trust |
| **WhatsApp Gateway** | Always accessible | More engagement |
| **Proactive Alerts** | Never forget important things | Indispensable utility |
| **Pattern Detection** | Anticipates needs | Premium differentiator |
| **Couple Coordination** | Relationship helper | Unique market position |
| **Skills System** | Customizable experience | Platform ecosystem |
| **Multi-Agent** | Fast + smart responses | Cost efficiency |

---

## 10. Competitive Differentiation

With these improvements, Olive becomes:

> **"The AI that knows you as a couple"**

Unlike generic AI assistants:
- **Remembers** both partners' preferences
- **Coordinates** household tasks intelligently
- **Proactively** helps rather than just responds
- **Integrates** with your communication channels
- **Learns** patterns over time

This transforms Olive from a "shared note app" into an **intelligent household companion** that makes couples' lives easier every day.

---

## References

- [Moltbot Documentation](https://docs.molt.bot)
- [Moltbot Architecture](https://docs.molt.bot/architecture)
- [Moltbot Memory System](https://docs.molt.bot/concepts/memory)
- [Moltbot Skills](https://docs.molt.bot/skills)
- [Awesome Moltbot Skills](https://github.com/VoltAgent/awesome-moltbot-skills)
- [TechCrunch: Everything about Clawdbot/Moltbot](https://techcrunch.com/2026/01/27/everything-you-need-to-know-about-viral-personal-ai-assistant-clawdbot-now-moltbot/)

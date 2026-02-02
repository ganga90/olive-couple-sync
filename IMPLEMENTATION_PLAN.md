# Implementation Plan: Three New Olive Features

This document outlines the detailed implementation plan for three new features in the Olive app:
1. **Context-Aware Receipt Hunter** (Gemini Powered)
2. **Recall & Reframe Agent** (Opinionated RAG)
3. **Daily Pulse** (Expanded 24h Cron)

---

## Current Architecture Summary

### What We Have
- **Database**: Supabase with pgvector extension, clerk_notes with embeddings
- **Memory System**: olive_memory_files, olive_memory_chunks, olive_patterns (all with VECTOR(1536))
- **Edge Functions**: process-note, ask-olive, manage-memories, olive-heartbeat, whatsapp-webhook
- **Proactive System**: olive_heartbeat_jobs, olive_outbound_queue, quiet hours, daily limits
- **Media Processing**: Gemini Vision for images, ElevenLabs for audio
- **Skills System**: 6 builtin skills including Budget Tracker
- **WhatsApp Integration**: Full inbound/outbound with intent routing

---

## Feature 1: Context-Aware Receipt Hunter

### Overview
**Flow**: Image → Gemini Flash (JSON) → Supabase DB → Budget Logic Check → UI Feedback

### Database Schema Changes

```sql
-- New transactions table for financial tracking
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  couple_id UUID REFERENCES clerk_couples(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL,
  merchant TEXT NOT NULL,
  category TEXT NOT NULL,
  transaction_date TIMESTAMPTZ NOT NULL,
  image_url TEXT,
  source_note_id UUID REFERENCES clerk_notes(id) ON DELETE SET NULL,
  budget_status TEXT DEFAULT 'ok' CHECK (budget_status IN ('ok', 'warning', 'over_limit')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Budgets table for spending limits
CREATE TABLE budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  couple_id UUID REFERENCES clerk_couples(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  limit_amount NUMERIC(12, 2) NOT NULL,
  period TEXT DEFAULT 'monthly' CHECK (period IN ('weekly', 'monthly', 'yearly')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category, period)
);

-- Indexes for performance
CREATE INDEX idx_transactions_user_category ON transactions(user_id, category);
CREATE INDEX idx_transactions_date ON transactions(transaction_date);
CREATE INDEX idx_budgets_user ON budgets(user_id, is_active);

-- RLS Policies
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;

-- User can view own transactions or couple transactions
CREATE POLICY "Users can view own transactions"
  ON transactions FOR SELECT
  USING (
    user_id = auth.jwt()->>'sub'
    OR couple_id IN (
      SELECT couple_id FROM clerk_couple_members
      WHERE user_id = auth.jwt()->>'sub'
    )
  );

CREATE POLICY "Users can insert own transactions"
  ON transactions FOR INSERT
  WITH CHECK (user_id = auth.jwt()->>'sub');

-- Similar policies for budgets...
```

### Edge Function: `process-receipt`

**Location**: `supabase/functions/process-receipt/index.ts`

```typescript
// Key logic flow:

// 1. Receive image (base64 or URL)
const { image_url, base64_image, user_id, couple_id } = await req.json();

// 2. Process with Gemini Vision
const receiptData = await extractReceiptWithGemini(imageData);
// Returns: { merchant, amount, date, category, line_items }

// 3. Query current budget status
const budgetCheck = await checkBudgetStatus(
  supabase,
  user_id,
  couple_id,
  receiptData.category,
  receiptData.amount
);

// 4. Insert transaction with budget_status
const transaction = await insertTransaction(
  supabase,
  {
    ...receiptData,
    user_id,
    couple_id,
    budget_status: budgetCheck.status,
    image_url
  }
);

// 5. Return response with alert flag
return {
  success: true,
  transaction,
  alert: budgetCheck.status !== 'ok',
  message: budgetCheck.message,
  budget_summary: budgetCheck.summary
};
```

**Gemini System Prompt for Receipt Extraction**:
```
You are a precise receipt parser. Extract data from this receipt image and return ONLY valid JSON.

Required output format:
{
  "merchant": "Store name exactly as shown",
  "amount": 45.99,
  "date": "2024-02-01",
  "category": "one of: Groceries, Dining, Travel, Utilities, Entertainment, Shopping, Health, Transportation, Subscriptions, Other",
  "line_items": [
    {"name": "Item name", "quantity": 1, "price": 9.99}
  ],
  "payment_method": "card/cash/unknown",
  "confidence": 0.95
}

Rules:
- amount must be a number (no currency symbols)
- date must be ISO format YYYY-MM-DD
- If any field is unclear, use your best judgment
- line_items can be empty array if not readable
```

**Budget Check Logic**:
```typescript
async function checkBudgetStatus(
  supabase: SupabaseClient,
  userId: string,
  coupleId: string | null,
  category: string,
  newAmount: number
): Promise<BudgetCheck> {
  // Get budget for this category
  const { data: budget } = await supabase
    .from('budgets')
    .select('*')
    .eq('user_id', userId)
    .eq('category', category)
    .eq('is_active', true)
    .single();

  if (!budget) {
    return { status: 'ok', message: null, summary: null };
  }

  // Get current month's spending
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: transactions } = await supabase
    .from('transactions')
    .select('amount')
    .eq('user_id', userId)
    .eq('category', category)
    .gte('transaction_date', startOfMonth.toISOString());

  const currentSpend = transactions?.reduce((sum, t) => sum + t.amount, 0) || 0;
  const newTotal = currentSpend + newAmount;
  const limit = budget.limit_amount;
  const percentage = (newTotal / limit) * 100;

  if (newTotal > limit) {
    const overage = newTotal - limit;
    return {
      status: 'over_limit',
      message: `You are now $${overage.toFixed(2)} over your ${category} budget!`,
      summary: { spent: newTotal, limit, percentage, overage }
    };
  } else if (percentage >= 80) {
    const remaining = limit - newTotal;
    return {
      status: 'warning',
      message: `Heads up: You've used ${percentage.toFixed(0)}% of your ${category} budget. $${remaining.toFixed(2)} remaining.`,
      summary: { spent: newTotal, limit, percentage, remaining }
    };
  }

  return {
    status: 'ok',
    message: null,
    summary: { spent: newTotal, limit, percentage }
  };
}
```

### Integration with Existing process-note

The existing `process-note` already has receipt detection in media processing. We should:

1. **Enhance the receipt media prompt** to output structured JSON
2. **Add budget check** as post-processing step
3. **Create transaction record** when receipt is detected
4. **Return budget alert** in the response

**Changes to process-note**:
```typescript
// In processMedia function, after Gemini returns receipt data:
if (mediaType === 'receipt' || extractedData.is_receipt) {
  // Call process-receipt logic
  const receiptResult = await processReceipt(extractedData, user_id, couple_id);

  // Add budget warning to note response
  if (receiptResult.alert) {
    response.budget_warning = {
      alert: true,
      message: receiptResult.message,
      status: receiptResult.budget_status
    };
  }
}
```

### Frontend Components

**ReceiptCard Component** (`src/components/ReceiptCard.tsx`):
```typescript
interface ReceiptCardProps {
  transaction: Transaction;
  budgetWarning?: BudgetWarning;
}

export const ReceiptCard: React.FC<ReceiptCardProps> = ({
  transaction,
  budgetWarning
}) => {
  return (
    <Card className={cn(
      "overflow-hidden",
      budgetWarning?.alert && "border-2 border-red-500"
    )}>
      {budgetWarning?.alert && (
        <div className="bg-red-50 px-4 py-3 border-b border-red-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <span className="text-red-700 font-medium">
              {budgetWarning.message}
            </span>
          </div>
        </div>
      )}

      <div className="p-4">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-semibold">{transaction.merchant}</h3>
            <p className="text-sm text-muted-foreground">
              {format(new Date(transaction.transaction_date), 'PPP')}
            </p>
          </div>
          <span className="text-xl font-bold">
            ${transaction.amount.toFixed(2)}
          </span>
        </div>

        <Badge variant="secondary" className="mt-2">
          {transaction.category}
        </Badge>

        {transaction.line_items?.length > 0 && (
          <div className="mt-3 space-y-1">
            {transaction.line_items.map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span>{item.name}</span>
                <span>${item.price.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};
```

**Budget Management UI** (`src/components/BudgetManager.tsx`):
- View current budgets by category
- Set/edit budget limits
- View spending progress bars
- Monthly spending breakdown

### WhatsApp Integration

Update `whatsapp-webhook` to handle receipt images:
```typescript
// In media processing section:
if (mediaType === 'image') {
  // Detect if it's a receipt
  const isReceipt = await detectReceiptImage(imageData);

  if (isReceipt) {
    const result = await processReceiptFromWhatsApp(imageData, userId, coupleId);

    // Format response
    let responseMessage = `Receipt captured!\n\n`;
    responseMessage += `📍 ${result.merchant}\n`;
    responseMessage += `💰 $${result.amount}\n`;
    responseMessage += `📁 ${result.category}\n`;

    if (result.alert) {
      responseMessage += `\n⚠️ ${result.message}`;
    }

    return responseMessage;
  }
}
```

---

## Feature 2: Recall & Reframe Agent (Opinionated RAG)

### Overview
**Flow**: User Query → Dual Search (Facts + Memories) → LLM Synthesis → Answer with Citations

### Key Insight
Separate "Hard Facts" (saved links, documents, objective data) from "Soft Context" (memories, opinions, subjective experiences).

### Database Schema Changes

```sql
-- Saved links table for facts/documents
CREATE TABLE saved_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  couple_id UUID REFERENCES clerk_couples(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  content_summary TEXT, -- AI-generated summary of content
  domain TEXT,
  tags TEXT[],
  embedding VECTOR(1536),
  source_type TEXT DEFAULT 'link' CHECK (source_type IN ('link', 'document', 'article', 'recipe', 'product')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for vector search
CREATE INDEX saved_links_embedding_idx ON saved_links
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- RLS
ALTER TABLE saved_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own or couple links"
  ON saved_links FOR SELECT
  USING (
    user_id = auth.jwt()->>'sub'
    OR couple_id IN (
      SELECT couple_id FROM clerk_couple_members
      WHERE user_id = auth.jwt()->>'sub'
    )
  );
```

### Postgres Function: `match_documents`

```sql
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding VECTOR(1536),
  match_user_id TEXT,
  match_couple_id UUID DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  source_type TEXT,
  source_label TEXT,
  similarity FLOAT,
  created_at TIMESTAMPTZ,
  metadata JSONB
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  -- Facts from saved_links
  SELECT
    sl.id,
    COALESCE(sl.content_summary, sl.description, sl.title) as content,
    'fact' as source_type,
    'Link: ' || sl.domain as source_label,
    1 - (sl.embedding <=> query_embedding) as similarity,
    sl.created_at,
    jsonb_build_object('url', sl.url, 'title', sl.title) as metadata
  FROM saved_links sl
  WHERE (sl.user_id = match_user_id OR sl.couple_id = match_couple_id)
    AND sl.embedding IS NOT NULL
    AND 1 - (sl.embedding <=> query_embedding) > match_threshold

  UNION ALL

  -- Memories from olive_memory_chunks (subjective)
  SELECT
    mc.id,
    mc.content,
    'memory' as source_type,
    'Memory: ' || mc.chunk_type || ' from ' || mc.source_context as source_label,
    1 - (mc.embedding <=> query_embedding) as similarity,
    mc.created_at,
    jsonb_build_object(
      'chunk_type', mc.chunk_type,
      'importance', mc.importance,
      'source_context', mc.source_context
    ) as metadata
  FROM olive_memory_chunks mc
  WHERE mc.user_id = match_user_id
    AND mc.embedding IS NOT NULL
    AND 1 - (mc.embedding <=> query_embedding) > match_threshold

  ORDER BY similarity DESC
  LIMIT match_count * 2;  -- Get more to ensure mix of both types
END;
$$;
```

### Edge Function: Enhanced `ask-olive-individual`

**Location**: `supabase/functions/ask-olive-individual/index.ts`

```typescript
// Enhanced ask-olive with RAG retrieval

async function handleRecallQuery(
  supabase: SupabaseClient,
  userQuery: string,
  userId: string,
  coupleId: string | null
): Promise<RecallResponse> {

  // Step 1: Generate embedding for user query
  const queryEmbedding = await generateEmbedding(userQuery);

  // Step 2: Retrieve relevant documents (facts + memories)
  const { data: documents } = await supabase
    .rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_user_id: userId,
      match_couple_id: coupleId,
      match_threshold: 0.65,
      match_count: 10
    });

  // Step 3: Separate and format context
  const facts = documents.filter(d => d.source_type === 'fact');
  const memories = documents.filter(d => d.source_type === 'memory');

  const contextBlocks = [
    ...facts.map(f => `[FACT] ${f.content}\nSource: ${f.source_label}`),
    ...memories.map(m => `[MEMORY] ${m.content}\nSource: ${m.source_label}`)
  ].join('\n\n---\n\n');

  // Step 4: Generate response with Gemini
  const systemPrompt = buildRecallSystemPrompt();
  const response = await generateWithGemini(systemPrompt, contextBlocks, userQuery);

  // Step 5: Format citations
  const citations = documents.map(d => ({
    type: d.source_type,
    label: d.source_label,
    date: d.created_at,
    similarity: d.similarity
  }));

  return {
    answer: response,
    citations,
    sources_used: {
      facts: facts.length,
      memories: memories.length
    }
  };
}
```

**The Recall System Prompt**:
```typescript
function buildRecallSystemPrompt(): string {
  return `You are Olive, a thoughtful partner assistant with access to both objective facts and personal memories.

CONTEXT INTERPRETATION:
- [FACT] entries are objective truths (saved links, documents, bookings, products)
- [MEMORY] entries are subjective experiences (opinions, feelings, past decisions)

SYNTHESIS RULES:
1. When facts and memories align, combine them naturally
2. When a fact conflicts with a negative memory, PRIORITIZE THE WARNING
3. Always acknowledge the source of information in your response
4. Be conversational but informative

EXAMPLE SCENARIOS:

User: "Should we go back to Hotel Belvedere?"
Facts: Hotel Belvedere - 4 star, $200/night, downtown location
Memory: "The service was terrible and the bed was uncomfortable"
Response: "You saved Hotel Belvedere as an option - it's a 4-star downtown hotel at $200/night. However, you noted last time that the service was terrible and the bed was uncomfortable. I'd suggest looking for alternatives unless you want to give them another chance."

User: "What's that Thai restaurant we liked?"
Facts: Thai Orchid - 123 Main St, saved Jan 15
Memory: "Best pad thai in the city, cozy atmosphere"
Response: "That's Thai Orchid at 123 Main St! You saved it back in January and mentioned it has the best pad thai in the city with a cozy atmosphere."

User: "Any ideas for this weekend?"
Facts: Saturday weather forecast: Sunny, 72°F
Memory: "We wanted to try that hiking trail" (from 2 weeks ago)
Response: "The weather looks perfect for Saturday - sunny and 72°F! You mentioned a couple weeks ago wanting to try that hiking trail. Could be a great opportunity!"

Always be helpful, warm, and partner-aware (use "you both" or "you" appropriately).`;
}
```

### Integration with Existing AskOliveChatGlobal

Update `src/components/AskOliveChatGlobal.tsx`:

```typescript
// Add citation display to chat responses
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
}

// In the message rendering:
{message.citations && message.citations.length > 0 && (
  <div className="mt-3 pt-3 border-t border-border/50">
    <p className="text-xs text-muted-foreground mb-2">Sources:</p>
    <div className="flex flex-wrap gap-2">
      {message.citations.map((citation, i) => (
        <Badge
          key={i}
          variant={citation.type === 'fact' ? 'default' : 'secondary'}
          className="text-xs"
        >
          {citation.type === 'fact' ? '📄' : '💭'} {citation.label}
        </Badge>
      ))}
    </div>
  </div>
)}
```

### Link Saving Feature

**SaveLinkButton Component**:
```typescript
export const SaveLinkButton: React.FC = () => {
  const [url, setUrl] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSaveLink = async () => {
    setIsProcessing(true);

    // Call edge function to fetch, summarize, and embed
    const { data, error } = await supabase.functions.invoke('save-link', {
      body: { url }
    });

    if (data.success) {
      toast.success(`Saved: ${data.title}`);
    }

    setIsProcessing(false);
  };

  return (
    <div className="flex gap-2">
      <Input
        placeholder="Paste a link to save..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <Button onClick={handleSaveLink} disabled={isProcessing}>
        {isProcessing ? <Loader2 className="animate-spin" /> : <Link />}
        Save
      </Button>
    </div>
  );
};
```

**Edge Function: save-link**:
```typescript
// Fetch URL, extract content, generate summary and embedding
async function saveLink(url: string, userId: string, coupleId: string) {
  // 1. Fetch and parse URL
  const content = await fetchAndParseUrl(url);

  // 2. Generate summary with Gemini
  const summary = await generateSummary(content);

  // 3. Generate embedding
  const embedding = await generateEmbedding(summary);

  // 4. Store in database
  await supabase.from('saved_links').insert({
    user_id: userId,
    couple_id: coupleId,
    url,
    title: content.title,
    description: content.description,
    content_summary: summary,
    domain: new URL(url).hostname,
    embedding,
    source_type: detectSourceType(url, content)
  });
}
```

---

## Feature 3: Daily Pulse (Expanded 24h Cron)

### Overview
Transform the cron job into a "State Monitor" that identifies actionable deltas across multiple domains.

### Database Schema Changes

```sql
-- Wishlist table for price watching
CREATE TABLE wishlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  couple_id UUID REFERENCES clerk_couples(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  item_url TEXT,
  current_price NUMERIC(12, 2),
  target_price NUMERIC(12, 2),
  last_checked_at TIMESTAMPTZ,
  price_history JSONB DEFAULT '[]', -- [{date, price}]
  source TEXT, -- amazon, walmart, etc.
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Important dates table
CREATE TABLE important_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL, -- owner
  couple_id UUID REFERENCES clerk_couples(id) ON DELETE SET NULL,
  partner_user_id TEXT, -- partner to notify
  event_name TEXT NOT NULL,
  event_date DATE NOT NULL,
  event_type TEXT CHECK (event_type IN ('anniversary', 'birthday', 'holiday', 'custom')),
  recurrence TEXT DEFAULT 'yearly' CHECK (recurrence IN ('none', 'yearly')),
  reminder_days INT[] DEFAULT '{14, 3}', -- days before to remind
  last_reminded_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications table (centralized)
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL, -- price_drop, date_reminder, weather_suggestion, stale_task, etc.
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_url TEXT,
  priority INT DEFAULT 5, -- 1-10
  is_read BOOLEAN DEFAULT false,
  is_dismissed BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- System logs for debugging
CREATE TABLE system_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  module TEXT NOT NULL,
  status TEXT CHECK (status IN ('started', 'completed', 'failed', 'skipped')),
  details JSONB,
  user_ids_affected TEXT[],
  duration_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_wishlist_active ON wishlist(user_id, is_active);
CREATE INDEX idx_important_dates_upcoming ON important_dates(event_date);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC);
```

### Edge Function: `daily-pulse`

**Location**: `supabase/functions/daily-pulse/index.ts`

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

serve(async (req) => {
  const startTime = Date.now();
  const results = {
    wishlist: { processed: 0, alerts: 0 },
    dates: { processed: 0, alerts: 0 },
    weekend: { processed: 0, suggestions: 0 },
    staleTasks: { processed: 0, flagged: 0 }
  };

  try {
    // Run all modules in parallel
    const [wishlistResult, datesResult, weekendResult, staleResult] =
      await Promise.allSettled([
        runWishlistMonitor(supabase),
        runRelationshipRadar(supabase),
        runWeekendPlanner(supabase),
        runStaleTaskReaper(supabase)
      ]);

    // Log results
    await logPulseRun(supabase, 'daily-pulse', results, Date.now() - startTime);

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    await logPulseRun(supabase, 'daily-pulse', { error: error.message }, Date.now() - startTime, 'failed');
    throw error;
  }
});
```

### Module A: Wishlist Monitor

```typescript
async function runWishlistMonitor(supabase: SupabaseClient) {
  const log = await startModuleLog(supabase, 'wishlist_monitor');

  try {
    // Get active wishlist items
    const { data: items } = await supabase
      .from('wishlist')
      .select('*')
      .eq('is_active', true)
      .not('target_price', 'is', null);

    const alerts = [];

    for (const item of items || []) {
      // Check current price (using appropriate service)
      const currentPrice = await checkPrice(item.item_url, item.source);

      // Update price history
      await supabase
        .from('wishlist')
        .update({
          current_price: currentPrice,
          last_checked_at: new Date().toISOString(),
          price_history: [...(item.price_history || []), {
            date: new Date().toISOString(),
            price: currentPrice
          }].slice(-30) // Keep last 30 checks
        })
        .eq('id', item.id);

      // Check if price dropped below target
      if (currentPrice <= item.target_price) {
        alerts.push({
          user_id: item.user_id,
          type: 'price_drop',
          title: 'Price Drop Alert! 🎉',
          message: `${item.item_name} is now $${currentPrice} (target: $${item.target_price})`,
          action_url: item.item_url,
          priority: 8,
          metadata: {
            item_id: item.id,
            original_price: item.price_history?.[0]?.price,
            current_price: currentPrice,
            target_price: item.target_price
          }
        });
      }
    }

    // Batch insert notifications
    if (alerts.length > 0) {
      await supabase.from('notifications').insert(alerts);

      // Also queue for WhatsApp if enabled
      for (const alert of alerts) {
        await queueProactiveMessage(supabase, alert.user_id, alert.message, 'price_alert');
      }
    }

    await completeModuleLog(supabase, log.id, 'completed', {
      items_checked: items?.length || 0,
      alerts_created: alerts.length
    });

    return { processed: items?.length || 0, alerts: alerts.length };

  } catch (error) {
    await completeModuleLog(supabase, log.id, 'failed', { error: error.message });
    throw error;
  }
}
```

### Module B: Relationship Radar

```typescript
async function runRelationshipRadar(supabase: SupabaseClient) {
  const log = await startModuleLog(supabase, 'relationship_radar');

  try {
    const today = new Date();
    const notifications = [];

    // Get upcoming dates (14 days and 3 days out)
    const checkDays = [14, 3];

    for (const daysAhead of checkDays) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + daysAhead);
      const targetDateStr = targetDate.toISOString().split('T')[0];

      // Query for dates matching (considering yearly recurrence)
      const { data: dates } = await supabase
        .from('important_dates')
        .select(`
          *,
          couple:clerk_couples(you_name, partner_name)
        `)
        .or(`event_date.eq.${targetDateStr},and(recurrence.eq.yearly,event_date.like.%-${targetDateStr.slice(5)})`)
        .contains('reminder_days', [daysAhead]);

      for (const dateEvent of dates || []) {
        // Check if already reminded
        const lastReminded = dateEvent.last_reminded_at
          ? new Date(dateEvent.last_reminded_at)
          : null;

        if (lastReminded) {
          const daysSinceReminder = Math.floor(
            (today.getTime() - lastReminded.getTime()) / (1000 * 60 * 60 * 24)
          );
          if (daysSinceReminder < 1) continue; // Already reminded today
        }

        // Create notification for partner
        const targetUserId = dateEvent.partner_user_id || dateEvent.user_id;
        const eventOwner = dateEvent.couple?.you_name || 'your partner';

        notifications.push({
          user_id: targetUserId,
          type: 'date_reminder',
          title: `${dateEvent.event_type === 'birthday' ? '🎂' : '💝'} ${dateEvent.event_name} Coming Up!`,
          message: daysAhead === 14
            ? `Heads up! ${dateEvent.event_name} is in 2 weeks. Have you planned something special?`
            : `${dateEvent.event_name} is in 3 days! Don't forget to prepare.`,
          priority: daysAhead === 3 ? 9 : 6,
          metadata: {
            date_id: dateEvent.id,
            event_date: dateEvent.event_date,
            days_until: daysAhead
          }
        });

        // Update last reminded
        await supabase
          .from('important_dates')
          .update({ last_reminded_at: today.toISOString() })
          .eq('id', dateEvent.id);
      }
    }

    // Insert notifications
    if (notifications.length > 0) {
      await supabase.from('notifications').insert(notifications);

      // Queue WhatsApp messages
      for (const notif of notifications) {
        await queueProactiveMessage(supabase, notif.user_id, notif.message, 'date_reminder');
      }
    }

    await completeModuleLog(supabase, log.id, 'completed', {
      dates_checked: notifications.length,
      reminders_sent: notifications.length
    });

    return { processed: notifications.length, alerts: notifications.length };

  } catch (error) {
    await completeModuleLog(supabase, log.id, 'failed', { error: error.message });
    throw error;
  }
}
```

### Module C: Weekend Planner

```typescript
async function runWeekendPlanner(supabase: SupabaseClient) {
  const log = await startModuleLog(supabase, 'weekend_planner');

  try {
    // Only run on Thursdays
    const today = new Date();
    if (today.getDay() !== 4) { // 4 = Thursday
      await completeModuleLog(supabase, log.id, 'skipped', { reason: 'Not Thursday' });
      return { processed: 0, suggestions: 0 };
    }

    // Get all users with their preferences
    const { data: users } = await supabase
      .from('olive_user_preferences')
      .select('user_id, timezone')
      .eq('proactive_enabled', true);

    const suggestions = [];

    for (const user of users || []) {
      // Get user's location from profile
      const { data: profile } = await supabase
        .from('olive_memory_files')
        .select('content')
        .eq('user_id', user.user_id)
        .eq('file_type', 'profile')
        .single();

      const location = extractLocation(profile?.content);
      if (!location) continue;

      // Get weekend weather forecast
      const forecast = await getWeekendForecast(location);

      if (forecast.saturday.condition === 'sunny' || forecast.sunday.condition === 'sunny') {
        // Find outdoor tasks/ideas
        const { data: outdoorItems } = await supabase
          .from('clerk_notes')
          .select('*')
          .or(`user_id.eq.${user.user_id},couple_id.in.(SELECT couple_id FROM clerk_couple_members WHERE user_id = '${user.user_id}')`)
          .eq('completed', false)
          .or('tags.cs.{outdoor},tags.cs.{weekend},category.eq.date_night,category.eq.activity');

        if (outdoorItems && outdoorItems.length > 0) {
          const randomItem = outdoorItems[Math.floor(Math.random() * outdoorItems.length)];

          suggestions.push({
            user_id: user.user_id,
            type: 'weather_suggestion',
            title: '☀️ Perfect Weekend Weather!',
            message: `It's going to be ${forecast.saturday.condition} on Saturday (${forecast.saturday.temp}°). Great time to "${randomItem.summary}"!`,
            priority: 5,
            metadata: {
              forecast,
              suggested_note_id: randomItem.id,
              suggested_activity: randomItem.summary
            }
          });
        }
      }
    }

    if (suggestions.length > 0) {
      await supabase.from('notifications').insert(suggestions);

      for (const sugg of suggestions) {
        await queueProactiveMessage(supabase, sugg.user_id, sugg.message, 'weekend_suggestion');
      }
    }

    await completeModuleLog(supabase, log.id, 'completed', {
      users_checked: users?.length || 0,
      suggestions_made: suggestions.length
    });

    return { processed: users?.length || 0, suggestions: suggestions.length };

  } catch (error) {
    await completeModuleLog(supabase, log.id, 'failed', { error: error.message });
    throw error;
  }
}
```

### Module D: Stale Task Reaper

```typescript
async function runStaleTaskReaper(supabase: SupabaseClient) {
  const log = await startModuleLog(supabase, 'stale_task_reaper');

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Find stale incomplete tasks
    const { data: staleTasks } = await supabase
      .from('clerk_notes')
      .select('id, user_id, summary, created_at, couple_id')
      .eq('completed', false)
      .lt('created_at', thirtyDaysAgo.toISOString())
      .is('due_date', null) // No due date set
      .limit(100);

    const notifications = [];
    const groupedByUser = groupBy(staleTasks || [], 'user_id');

    for (const [userId, tasks] of Object.entries(groupedByUser)) {
      const taskList = tasks.slice(0, 5).map(t => `• ${t.summary}`).join('\n');

      notifications.push({
        user_id: userId,
        type: 'stale_task',
        title: '🧹 Time for a cleanup?',
        message: `You have ${tasks.length} task${tasks.length > 1 ? 's' : ''} over 30 days old:\n${taskList}\n\nWant to complete, reschedule, or remove them?`,
        priority: 3,
        metadata: {
          stale_task_ids: tasks.map(t => t.id),
          task_count: tasks.length
        }
      });
    }

    if (notifications.length > 0) {
      await supabase.from('notifications').insert(notifications);
    }

    await completeModuleLog(supabase, log.id, 'completed', {
      stale_tasks_found: staleTasks?.length || 0,
      users_notified: notifications.length
    });

    return { processed: staleTasks?.length || 0, flagged: notifications.length };

  } catch (error) {
    await completeModuleLog(supabase, log.id, 'failed', { error: error.message });
    throw error;
  }
}
```

### Scheduling with pg_cron

```sql
-- Schedule daily-pulse to run at 8:00 AM UTC
SELECT cron.schedule(
  'daily-pulse-job',
  '0 8 * * *', -- Every day at 8:00 AM
  $$
  SELECT net.http_post(
    url := 'https://your-project.supabase.co/functions/v1/daily-pulse',
    headers := '{"Authorization": "Bearer ' || current_setting('app.service_role_key') || '"}'::jsonb
  );
  $$
);
```

Or use Supabase Edge Function with scheduled invocation in `supabase/functions/daily-pulse/config.json`:
```json
{
  "schedule": "0 8 * * *"
}
```

### Frontend: Notifications Center

```typescript
// src/components/NotificationsCenter.tsx
export const NotificationsCenter: React.FC = () => {
  const { notifications, markAsRead, dismissAll } = useNotifications();

  const grouped = useMemo(() => ({
    priceDrops: notifications.filter(n => n.type === 'price_drop'),
    dateReminders: notifications.filter(n => n.type === 'date_reminder'),
    suggestions: notifications.filter(n => n.type === 'weather_suggestion'),
    staleTasks: notifications.filter(n => n.type === 'stale_task')
  }), [notifications]);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" className="relative">
          <Bell className="h-5 w-5" />
          {notifications.length > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0">
              {notifications.length}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Notifications</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 mt-4">
          {grouped.priceDrops.length > 0 && (
            <NotificationSection
              title="Price Drops"
              icon={<DollarSign />}
              items={grouped.priceDrops}
              color="green"
            />
          )}

          {grouped.dateReminders.length > 0 && (
            <NotificationSection
              title="Upcoming Dates"
              icon={<Heart />}
              items={grouped.dateReminders}
              color="pink"
            />
          )}

          {grouped.suggestions.length > 0 && (
            <NotificationSection
              title="Weekend Ideas"
              icon={<Sun />}
              items={grouped.suggestions}
              color="amber"
            />
          )}

          {grouped.staleTasks.length > 0 && (
            <NotificationSection
              title="Task Cleanup"
              icon={<Archive />}
              items={grouped.staleTasks}
              color="gray"
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
```

---

## Implementation Priority & Dependencies

### Phase 1: Foundation (Week 1-2)
1. Create new database tables (transactions, budgets, saved_links, important_dates, wishlist, notifications, system_logs)
2. Add RLS policies
3. Create match_documents function

### Phase 2: Receipt Hunter (Week 2-3)
1. Create process-receipt edge function
2. Integrate with existing process-note
3. Build ReceiptCard and BudgetManager UI
4. Add WhatsApp receipt handling

### Phase 3: Recall Agent (Week 3-4)
1. Enhance ask-olive-individual with RAG
2. Create save-link edge function
3. Build SaveLinkButton component
4. Add citations to chat UI

### Phase 4: Daily Pulse (Week 4-5)
1. Create daily-pulse edge function with all modules
2. Set up pg_cron scheduling
3. Build NotificationsCenter
4. Integrate with existing proactive system

### Phase 5: Testing & Polish (Week 5-6)
1. End-to-end testing
2. Error handling improvements
3. Performance optimization
4. User documentation

---

## Risk Mitigation

### Receipt Scanner
- **Risk**: Gemini may return malformed JSON
- **Mitigation**: Strict JSON validation, fallback parsing, confidence thresholds

### Recall Agent
- **Risk**: Mixed signals from facts vs memories
- **Mitigation**: Clear prioritization rules in prompt, user feedback loop

### Daily Pulse
- **Risk**: Too many notifications annoy users
- **Mitigation**: Respect quiet hours, daily limits, notification batching, easy dismiss

### General
- **Risk**: API rate limits (Gemini, Weather, Price checking)
- **Mitigation**: Caching, request batching, exponential backoff

---

## Metrics to Track

1. **Receipt Scanner**
   - Extraction accuracy
   - Budget alert engagement rate
   - Manual correction frequency

2. **Recall Agent**
   - Query satisfaction (thumbs up/down)
   - Citation click-through rate
   - Source balance (facts vs memories)

3. **Daily Pulse**
   - Notification open rate
   - Action taken rate
   - Opt-out rate per module

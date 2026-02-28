-- Router Telemetry Table
-- Logs every intent classification + model routing decision
-- for analytics and optimization of the multi-tier semantic router.

CREATE TABLE IF NOT EXISTS olive_router_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL,                -- 'whatsapp' | 'in_app_chat'
  raw_text text,                       -- First 200 chars of user message
  classified_intent text,              -- 'chat', 'create', 'search', etc.
  confidence float,                    -- 0.0 - 1.0
  chat_type text,                      -- 'briefing', 'planning', etc. (nullable)
  classification_model text,           -- 'gemini-2.5-flash-lite'
  response_model text,                 -- 'gemini-2.5-flash' | 'gemini-2.5-pro' | null
  route_reason text,                   -- 'complex_chat:planning', 'db_operation', etc.
  classification_latency_ms integer,   -- Time for classification alone
  total_latency_ms integer,            -- Total request processing time
  created_at timestamptz DEFAULT now()
);

-- Indexes for analytics queries
CREATE INDEX idx_router_log_user ON olive_router_log(user_id, created_at DESC);
CREATE INDEX idx_router_log_intent ON olive_router_log(classified_intent, created_at DESC);

-- RLS
ALTER TABLE olive_router_log ENABLE ROW LEVEL SECURITY;

-- Users can read their own logs
CREATE POLICY "Users see own router logs"
  ON olive_router_log FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can insert (edge functions use service key)
CREATE POLICY "Service role inserts router logs"
  ON olive_router_log FOR INSERT
  WITH CHECK (true);

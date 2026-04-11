-- Phase 6A: LLM Call Observability
-- Tracks every AI call: model, tokens, cost, latency, prompt version
-- Enables cost analytics, quality measurement, and prompt A/B testing

CREATE TABLE IF NOT EXISTS olive_llm_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  function_name TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT,
  tokens_in INT,
  tokens_out INT,
  latency_ms INT,
  cost_usd NUMERIC(10,6),
  status TEXT NOT NULL DEFAULT 'success',
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_calls_user ON olive_llm_calls(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_function ON olive_llm_calls(function_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_model ON olive_llm_calls(model, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_created ON olive_llm_calls(created_at DESC);

-- Analytics view: cost + latency per function per day
CREATE OR REPLACE VIEW olive_llm_analytics AS
SELECT
  date_trunc('day', created_at) AS day,
  function_name,
  model,
  COUNT(*) AS call_count,
  SUM(tokens_in) AS total_tokens_in,
  SUM(tokens_out) AS total_tokens_out,
  ROUND(AVG(latency_ms)) AS avg_latency_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,
  SUM(cost_usd) AS total_cost_usd,
  COUNT(*) FILTER (WHERE status = 'error') AS error_count
FROM olive_llm_calls
GROUP BY date_trunc('day', created_at), function_name, model
ORDER BY day DESC, function_name;

-- Auto-cleanup: delete LLM call records older than 90 days
-- (high volume table, don't need full history)
SELECT cron.schedule(
  'olive-llm-calls-cleanup',
  '0 4 * * 0',
  $$DELETE FROM olive_llm_calls WHERE created_at < now() - interval '90 days'$$
);

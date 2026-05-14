-- [TASK-MP-3] Add provider column to olive_llm_calls + update analytics view
-- ============================================================================
-- Bucket 2 introduces a multi-provider LLM dispatcher (Gemini → Cerebras →
-- Groq). To analyze per-provider behavior we need a `provider` column on
-- every log row. Defaults to 'gemini' so prior rows and existing callers of
-- tracker.generate() (which still target Gemini) keep working.
--
-- The `olive_llm_analytics` view is a regular view (relkind='v'), so we
-- recreate it via CREATE OR REPLACE VIEW to include `provider` in the
-- SELECT and GROUP BY.
--
-- DOWN (manual, no automated rollback):
--   CREATE OR REPLACE VIEW public.olive_llm_analytics AS
--     SELECT date_trunc('day', created_at) AS day,
--            function_name, model,
--            count(*) AS call_count,
--            sum(tokens_in) AS total_tokens_in,
--            sum(tokens_out) AS total_tokens_out,
--            round(avg(latency_ms)) AS avg_latency_ms,
--            percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms::float) AS p95_latency_ms,
--            sum(cost_usd) AS total_cost_usd,
--            count(*) FILTER (WHERE status='error') AS error_count
--     FROM olive_llm_calls
--     GROUP BY 1, function_name, model
--     ORDER BY 1 DESC, function_name;
--   DROP INDEX IF EXISTS public.idx_olive_llm_calls_provider_day;
--   ALTER TABLE public.olive_llm_calls DROP COLUMN IF EXISTS provider;

ALTER TABLE public.olive_llm_calls
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'gemini';

CREATE INDEX IF NOT EXISTS idx_olive_llm_calls_provider_day
  ON public.olive_llm_calls (provider, created_at);

-- Recreate the daily analytics view to include `provider` in the grouping.
-- CREATE OR REPLACE VIEW preserves existing column positions/types and only
-- permits appending new columns at the end — so `provider` lands after
-- `error_count`, not between `function_name` and `model`, even though that
-- would read more naturally. Downstream consumers can reorder in their own
-- queries.
CREATE OR REPLACE VIEW public.olive_llm_analytics AS
  SELECT
    date_trunc('day'::text, created_at) AS day,
    function_name,
    model,
    count(*) AS call_count,
    sum(tokens_in) AS total_tokens_in,
    sum(tokens_out) AS total_tokens_out,
    round(avg(latency_ms)) AS avg_latency_ms,
    percentile_cont(0.95::double precision)
      WITHIN GROUP (ORDER BY (latency_ms::double precision))
      AS p95_latency_ms,
    sum(cost_usd) AS total_cost_usd,
    count(*) FILTER (WHERE status = 'error'::text) AS error_count,
    provider
  FROM olive_llm_calls
  GROUP BY (date_trunc('day'::text, created_at)), function_name, model, provider
  ORDER BY (date_trunc('day'::text, created_at)) DESC, function_name;


-- 1. Enable RLS on olive_memory_contradictions
ALTER TABLE public.olive_memory_contradictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "olive_memory_contradictions_select"
  ON public.olive_memory_contradictions FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "olive_memory_contradictions_insert"
  ON public.olive_memory_contradictions FOR INSERT
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "olive_memory_contradictions_update"
  ON public.olive_memory_contradictions FOR UPDATE
  USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "olive_memory_contradictions_delete"
  ON public.olive_memory_contradictions FOR DELETE
  USING (user_id = (auth.jwt() ->> 'sub'));

-- 2. Enable RLS on olive_memory_maintenance_log
ALTER TABLE public.olive_memory_maintenance_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "olive_memory_maintenance_log_select"
  ON public.olive_memory_maintenance_log FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "olive_memory_maintenance_log_insert"
  ON public.olive_memory_maintenance_log FOR INSERT
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "olive_memory_maintenance_log_update"
  ON public.olive_memory_maintenance_log FOR UPDATE
  USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "olive_memory_maintenance_log_delete"
  ON public.olive_memory_maintenance_log FOR DELETE
  USING (user_id = (auth.jwt() ->> 'sub'));

-- 3. Tighten clerk_couple_members INSERT policy
DROP POLICY IF EXISTS "clerk_couple_members_insert" ON public.clerk_couple_members;

CREATE POLICY "clerk_couple_members_insert"
  ON public.clerk_couple_members FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (auth.jwt() ->> 'sub')
    AND (
      EXISTS (
        SELECT 1 FROM public.clerk_invites i
        WHERE i.couple_id = clerk_couple_members.couple_id
          AND i.accepted_by = (auth.jwt() ->> 'sub')
          AND i.accepted_at IS NOT NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.clerk_couples c
        WHERE c.id = clerk_couple_members.couple_id
          AND c.created_by = (auth.jwt() ->> 'sub')
      )
    )
  );

-- 4. Fix olive_llm_analytics view
DROP VIEW IF EXISTS public.olive_llm_analytics;

CREATE VIEW public.olive_llm_analytics
WITH (security_invoker = on) AS
SELECT
  date_trunc('day', created_at) AS day,
  function_name,
  model,
  count(*) AS call_count,
  sum(tokens_in) AS total_tokens_in,
  sum(tokens_out) AS total_tokens_out,
  round(avg(latency_ms)) AS avg_latency_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms::double precision) AS p95_latency_ms,
  sum(cost_usd) AS total_cost_usd,
  count(*) FILTER (WHERE status = 'error') AS error_count
FROM public.olive_llm_calls
GROUP BY date_trunc('day', created_at), function_name, model
ORDER BY date_trunc('day', created_at) DESC, function_name;

-- 5. Fix functions missing search_path
CREATE OR REPLACE FUNCTION public.normalize_category(raw_category text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = 'public'
AS $function$
DECLARE cleaned text;
BEGIN
  IF raw_category IS NULL THEN RETURN NULL; END IF;
  cleaned := lower(trim(raw_category));
  cleaned := regexp_replace(cleaned, '\s+', '_', 'g');
  CASE cleaned
    WHEN 'grocery' THEN RETURN 'groceries';
    WHEN 'tasks' THEN RETURN 'task';
    WHEN 'date_idea' THEN RETURN 'date_ideas';
    WHEN 'travel_idea' THEN RETURN 'travel';
    WHEN 'pets' THEN RETURN 'pet_care';
    WHEN 'pet_adoption' THEN RETURN 'pet_care';
    WHEN 'recipe' THEN RETURN 'recipes';
    WHEN 'meal_planning' THEN RETURN 'recipes';
    WHEN 'movies_tv' THEN RETURN 'entertainment';
    WHEN 'sports' THEN RETURN 'entertainment';
    WHEN 'homeimprovement' THEN RETURN 'home_improvement';
    WHEN 'home_maintenance' THEN RETURN 'home_improvement';
    WHEN 'dateideas' THEN RETURN 'date_ideas';
    WHEN 'stocks' THEN RETURN 'finance';
    WHEN 'app_features' THEN RETURN 'app_feedback';
    WHEN 'app_development' THEN RETURN 'app_feedback';
    WHEN 'olive_improvements' THEN RETURN 'app_feedback';
    WHEN 'olive_feature_requests' THEN RETURN 'app_feedback';
    WHEN 'olive_feature_request' THEN RETURN 'app_feedback';
    WHEN 'business_ideas' THEN RETURN 'business';
    WHEN 'errand' THEN RETURN 'errands';
    WHEN 'dry_cleaning' THEN RETURN 'errands';
    WHEN 'laundry' THEN RETURN 'errands';
    ELSE RETURN cleaned;
  END CASE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_normalize_category()
RETURNS trigger LANGUAGE plpgsql SET search_path = 'public'
AS $function$
BEGIN
  IF NEW.category IS NOT NULL THEN NEW.category := normalize_category(NEW.category); END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_active_compilation_users()
RETURNS TABLE(user_id text, note_count bigint) LANGUAGE sql STABLE SET search_path = 'public'
AS $function$
  SELECT author_id, count(*) FROM clerk_notes WHERE created_at >= now() - interval '90 days' GROUP BY author_id HAVING count(*) >= 10 ORDER BY count(*) DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_decay_candidates(p_user_id text, p_stale_days integer DEFAULT 90, p_limit integer DEFAULT 100)
RETURNS TABLE(id uuid, content text, importance integer, decay_factor double precision, last_accessed_at timestamp with time zone, created_at timestamp with time zone, days_stale integer)
LANGUAGE sql STABLE SET search_path = 'public'
AS $function$
  SELECT c.id, c.content, c.importance, c.decay_factor, c.last_accessed_at, c.created_at,
    EXTRACT(DAY FROM now() - COALESCE(c.last_accessed_at, c.created_at))::INT
  FROM olive_memory_chunks c
  WHERE c.user_id = p_user_id AND c.is_active = true AND c.importance <= 3
    AND COALESCE(c.last_accessed_at, c.created_at) < now() - (p_stale_days || ' days')::interval
  ORDER BY COALESCE(c.last_accessed_at, c.created_at) ASC LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.get_memory_health(p_user_id text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = 'public'
AS $function$
  SELECT jsonb_build_object(
    'total_chunks', (SELECT count(*) FROM olive_memory_chunks WHERE user_id = p_user_id),
    'active_chunks', (SELECT count(*) FROM olive_memory_chunks WHERE user_id = p_user_id AND is_active = true),
    'inactive_chunks', (SELECT count(*) FROM olive_memory_chunks WHERE user_id = p_user_id AND is_active = false),
    'avg_importance', (SELECT ROUND(AVG(importance)::numeric, 2) FROM olive_memory_chunks WHERE user_id = p_user_id AND is_active = true),
    'avg_decay', (SELECT ROUND(AVG(decay_factor)::numeric, 3) FROM olive_memory_chunks WHERE user_id = p_user_id AND is_active = true),
    'chunks_with_embeddings', (SELECT count(*) FROM olive_memory_chunks WHERE user_id = p_user_id AND is_active = true AND embedding IS NOT NULL),
    'chunks_without_embeddings', (SELECT count(*) FROM olive_memory_chunks WHERE user_id = p_user_id AND is_active = true AND embedding IS NULL),
    'unresolved_contradictions', (SELECT count(*) FROM olive_memory_contradictions WHERE user_id = p_user_id AND resolution = 'unresolved'),
    'total_memories', (SELECT count(*) FROM user_memories WHERE user_id = p_user_id AND is_active = true),
    'total_entities', (SELECT count(*) FROM olive_entities WHERE user_id = p_user_id),
    'total_relationships', (SELECT count(*) FROM olive_relationships WHERE user_id = p_user_id),
    'memory_files', (SELECT count(*) FROM olive_memory_files WHERE user_id = p_user_id),
    'last_maintenance', (SELECT jsonb_build_object('run_type', run_type, 'completed_at', completed_at, 'stats', stats) FROM olive_memory_maintenance_log WHERE user_id = p_user_id AND status = 'completed' ORDER BY completed_at DESC LIMIT 1),
    'last_compilation', (SELECT updated_at FROM olive_memory_files WHERE user_id = p_user_id AND file_type = 'profile' AND file_date IS NULL ORDER BY updated_at DESC LIMIT 1)
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_couple_compiled_files(p_couple_id uuid, p_file_types text[] DEFAULT ARRAY['profile', 'patterns', 'relationship', 'household'])
RETURNS TABLE(id uuid, user_id text, file_type text, content text, content_hash text, token_count integer, updated_at timestamp with time zone)
LANGUAGE sql STABLE SET search_path = 'public'
AS $function$
  SELECT f.id, f.user_id, f.file_type, f.content, f.content_hash, f.token_count, f.updated_at
  FROM olive_memory_files f JOIN clerk_couple_members m ON m.user_id = f.user_id
  WHERE m.couple_id = p_couple_id AND f.file_type = ANY(p_file_types) AND f.file_date IS NULL
  ORDER BY f.user_id, f.file_type;
$function$;

CREATE OR REPLACE FUNCTION public.find_shared_entities(p_couple_id uuid, p_min_similarity double precision DEFAULT 0.85)
RETURNS TABLE(entity_a_id uuid, entity_a_user text, entity_a_name text, entity_b_id uuid, entity_b_user text, entity_b_name text, entity_type text, name_similarity double precision)
LANGUAGE sql STABLE SET search_path = 'public'
AS $function$
  SELECT a.id, a.user_id, a.name, b.id, b.user_id, b.name, a.entity_type, similarity(LOWER(a.name), LOWER(b.name))::float
  FROM olive_entities a JOIN olive_entities b ON a.entity_type = b.entity_type AND a.user_id < b.user_id
  JOIN clerk_couple_members ma ON ma.user_id = a.user_id
  JOIN clerk_couple_members mb ON mb.user_id = b.user_id AND mb.couple_id = ma.couple_id
  WHERE ma.couple_id = p_couple_id AND similarity(LOWER(a.name), LOWER(b.name)) >= p_min_similarity;
$function$;

CREATE OR REPLACE FUNCTION public.get_partner_task_patterns(p_couple_id uuid, p_days integer DEFAULT 90)
RETURNS TABLE(user_id text, display_name text, category text, total_tasks bigint, completed_tasks bigint, completion_rate numeric)
LANGUAGE sql STABLE SET search_path = 'public'
AS $function$
  SELECT n.author_id, p.display_name, COALESCE(n.category, 'general'), COUNT(*),
    COUNT(*) FILTER (WHERE n.completed = true),
    ROUND(COUNT(*) FILTER (WHERE n.completed = true)::numeric / NULLIF(COUNT(*), 0), 2)
  FROM clerk_notes n JOIN clerk_couple_members m ON m.user_id = n.author_id
  JOIN clerk_profiles p ON p.id = n.author_id
  WHERE m.couple_id = p_couple_id AND n.created_at >= now() - (p_days || ' days')::interval
  GROUP BY n.author_id, p.display_name, COALESCE(n.category, 'general')
  HAVING COUNT(*) >= 2 ORDER BY n.author_id, COUNT(*) DESC;
$function$;

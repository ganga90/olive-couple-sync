-- Phase 2: Karpathy Second Brain compilation layer
-- Creates helper RPC and pg_cron job for daily memory compilation

-- Helper: find users with enough data to compile
CREATE OR REPLACE FUNCTION public.get_active_compilation_users()
RETURNS TABLE(user_id text, note_count bigint)
LANGUAGE sql STABLE
AS $$
  SELECT author_id AS user_id, count(*) AS note_count
  FROM clerk_notes
  WHERE created_at >= now() - interval '90 days'
  GROUP BY author_id
  HAVING count(*) >= 10
  ORDER BY count(*) DESC;
$$;

-- NULL-safe unique index for olive_memory_files upserts
-- PostgreSQL treats NULLs as distinct in UNIQUE constraints,
-- so we need COALESCE for upsert-by-select pattern to work correctly
CREATE UNIQUE INDEX IF NOT EXISTS olive_memory_files_user_type_date_nullsafe
ON olive_memory_files (user_id, file_type, COALESCE(file_date, '1970-01-01'::date));

-- Dynamic categories: replace rigid normalization with basic cleanup
-- Keeps only true duplicate fixes, allows any new category through
CREATE OR REPLACE FUNCTION public.normalize_category(raw_category text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $function$
DECLARE
  cleaned text;
BEGIN
  IF raw_category IS NULL THEN RETURN NULL; END IF;

  -- Basic cleanup: lowercase, trim, replace spaces with underscores
  cleaned := lower(trim(raw_category));
  cleaned := regexp_replace(cleaned, '\s+', '_', 'g');

  -- Only fix true duplicates (plural forms, common typos)
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
    ELSE RETURN cleaned;  -- Allow any new category through!
  END CASE;
END;
$function$;

-- pg_cron: daily memory compilation at 2am UTC
-- Note: schedule created via SQL, not migration, to support idempotent re-runs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'olive-compile-memory-daily'
  ) THEN
    PERFORM cron.schedule(
      'olive-compile-memory-daily',
      '0 2 * * *',
      $$
      SELECT net.http_post(
        url := current_setting('supabase_functions_endpoint') || '/olive-compile-memory',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('supabase.service_role_key')
        ),
        body := '{"action":"compile","force":false}'::jsonb
      );
      $$
    );
  END IF;
END $$;

-- Phase 0.2: Normalize category values in clerk_notes
-- Maps 41 category variants down to ~20 canonical categories

-- Create the normalization function (reusable in triggers and edge functions)
CREATE OR REPLACE FUNCTION public.normalize_category(raw_category text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $function$
BEGIN
  IF raw_category IS NULL THEN RETURN NULL; END IF;

  -- Lowercase and trim
  CASE lower(trim(raw_category))
    -- Groceries
    WHEN 'groceries' THEN RETURN 'groceries';
    WHEN 'grocery' THEN RETURN 'groceries';
    -- Task
    WHEN 'task' THEN RETURN 'task';
    WHEN 'tasks' THEN RETURN 'task';
    -- Shopping
    WHEN 'shopping' THEN RETURN 'shopping';
    -- Home Improvement
    WHEN 'home_improvement' THEN RETURN 'home_improvement';
    WHEN 'homeimprovement' THEN RETURN 'home_improvement';
    WHEN 'home improvement' THEN RETURN 'home_improvement';
    WHEN 'home_maintenance' THEN RETURN 'home_improvement';
    -- Date Ideas
    WHEN 'date_ideas' THEN RETURN 'date_ideas';
    WHEN 'date_idea' THEN RETURN 'date_ideas';
    WHEN 'dateideas' THEN RETURN 'date_ideas';
    -- Travel
    WHEN 'travel' THEN RETURN 'travel';
    WHEN 'travel_idea' THEN RETURN 'travel';
    -- Health
    WHEN 'health' THEN RETURN 'health';
    -- Work
    WHEN 'work' THEN RETURN 'work';
    -- Finance
    WHEN 'finance' THEN RETURN 'finance';
    WHEN 'stocks' THEN RETURN 'finance';
    -- Entertainment
    WHEN 'entertainment' THEN RETURN 'entertainment';
    WHEN 'movies_tv' THEN RETURN 'entertainment';
    WHEN 'sports' THEN RETURN 'entertainment';
    -- Books
    WHEN 'books' THEN RETURN 'books';
    -- Personal
    WHEN 'personal' THEN RETURN 'personal';
    WHEN 'general' THEN RETURN 'personal';
    -- Gift Ideas
    WHEN 'gift_ideas' THEN RETURN 'gift_ideas';
    -- Pet Care
    WHEN 'pet_care' THEN RETURN 'pet_care';
    WHEN 'pets' THEN RETURN 'pet_care';
    WHEN 'pet_adoption' THEN RETURN 'pet_care';
    -- Reminder
    WHEN 'reminder' THEN RETURN 'reminder';
    -- Recipes / Meal Planning
    WHEN 'recipe' THEN RETURN 'recipes';
    WHEN 'recipes' THEN RETURN 'recipes';
    WHEN 'meal_planning' THEN RETURN 'recipes';
    -- Wines
    WHEN 'wines' THEN RETURN 'wines';
    -- Automotive
    WHEN 'automotive' THEN RETURN 'automotive';
    -- App Feedback / Olive
    WHEN 'app_feedback' THEN RETURN 'app_feedback';
    WHEN 'app_features' THEN RETURN 'app_feedback';
    WHEN 'app_development' THEN RETURN 'app_feedback';
    WHEN 'olive_improvements' THEN RETURN 'app_feedback';
    WHEN 'olive_feature_requests' THEN RETURN 'app_feedback';
    WHEN 'olive_feature_request' THEN RETURN 'app_feedback';
    -- Technology
    WHEN 'technology' THEN RETURN 'technology';
    -- Business
    WHEN 'business_ideas' THEN RETURN 'business';
    -- Parenting
    WHEN 'parenting' THEN RETURN 'parenting';
    -- Home Hunting
    WHEN 'home_hunting' THEN RETURN 'home_hunting';
    ELSE RETURN lower(trim(raw_category));
  END CASE;
END;
$function$;

-- Apply normalization to existing data
UPDATE clerk_notes
SET category = normalize_category(category)
WHERE category IS NOT NULL
  AND category != normalize_category(category);

-- Create trigger to auto-normalize on insert/update
CREATE OR REPLACE FUNCTION public.trigger_normalize_category()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.category IS NOT NULL THEN
    NEW.category := normalize_category(NEW.category);
  END IF;
  RETURN NEW;
END;
$function$;

-- Only create if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'normalize_note_category'
  ) THEN
    CREATE TRIGGER normalize_note_category
      BEFORE INSERT OR UPDATE OF category ON clerk_notes
      FOR EACH ROW
      EXECUTE FUNCTION trigger_normalize_category();
  END IF;
END $$;

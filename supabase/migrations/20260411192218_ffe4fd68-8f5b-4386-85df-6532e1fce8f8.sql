CREATE OR REPLACE FUNCTION public.normalize_category(raw_category text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  cleaned text;
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
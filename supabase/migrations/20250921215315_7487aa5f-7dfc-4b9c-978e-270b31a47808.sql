-- Remove duplicate records from clerk_couple_members table
-- Keep only the first record for each couple_id, user_id combination

DELETE FROM public.clerk_couple_members 
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY couple_id, user_id ORDER BY created_at) as rn
    FROM public.clerk_couple_members
  ) t
  WHERE t.rn > 1
);

-- Now add the unique constraint
ALTER TABLE public.clerk_couple_members 
ADD CONSTRAINT clerk_couple_members_couple_user_unique 
UNIQUE (couple_id, user_id);
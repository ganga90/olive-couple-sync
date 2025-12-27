-- First, merge duplicate lists by updating notes to point to the oldest list per name (for each author/couple combo)
-- For personal lists (couple_id IS NULL), group by author_id and name
-- For couple lists, group by couple_id and name

-- Create temp table with the "winning" list for each unique name per scope
CREATE TEMP TABLE winning_lists AS
WITH ranked_lists AS (
  SELECT 
    id,
    name,
    author_id,
    couple_id,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY 
        LOWER(TRIM(name)),
        COALESCE(couple_id::text, author_id)
      ORDER BY created_at ASC
    ) as rn
  FROM clerk_lists
)
SELECT id as winner_id, name, author_id, couple_id
FROM ranked_lists
WHERE rn = 1;

-- Create mapping from duplicate lists to winners
CREATE TEMP TABLE list_mapping AS
SELECT 
  cl.id as old_id,
  wl.winner_id as new_id
FROM clerk_lists cl
JOIN winning_lists wl ON 
  LOWER(TRIM(cl.name)) = LOWER(TRIM(wl.name))
  AND COALESCE(cl.couple_id::text, cl.author_id) = COALESCE(wl.couple_id::text, wl.author_id)
WHERE cl.id != wl.winner_id;

-- Update notes to point to the winning list
UPDATE clerk_notes
SET list_id = lm.new_id
FROM list_mapping lm
WHERE clerk_notes.list_id = lm.old_id;

-- Delete duplicate lists (keep only winners)
DELETE FROM clerk_lists
WHERE id IN (SELECT old_id FROM list_mapping);

-- Drop temp tables
DROP TABLE list_mapping;
DROP TABLE winning_lists;

-- Now add unique constraint on normalized list name per author/couple scope
-- We use a unique index with expression for case-insensitive matching
CREATE UNIQUE INDEX idx_clerk_lists_unique_name_personal 
ON clerk_lists (author_id, LOWER(TRIM(name))) 
WHERE couple_id IS NULL;

CREATE UNIQUE INDEX idx_clerk_lists_unique_name_couple 
ON clerk_lists (couple_id, LOWER(TRIM(name))) 
WHERE couple_id IS NOT NULL;
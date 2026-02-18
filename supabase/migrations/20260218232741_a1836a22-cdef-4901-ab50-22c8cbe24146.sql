
-- Step 1: Migrate 214 notes from old couple to new active couple
UPDATE clerk_notes 
SET couple_id = '9f06707c-65e4-42fc-9502-e9a97c99d581', updated_at = now()
WHERE couple_id = '3cd8e3a9-24dc-4918-a898-322b94bd21bd';

-- Step 2: Migrate 14 lists from old couple to new active couple
UPDATE clerk_lists 
SET couple_id = '9f06707c-65e4-42fc-9502-e9a97c99d581', updated_at = now()
WHERE couple_id = '3cd8e3a9-24dc-4918-a898-322b94bd21bd';

-- Step 3: Delete stale invites from old couples
DELETE FROM clerk_invites 
WHERE couple_id IN (
  '3cd8e3a9-24dc-4918-a898-322b94bd21bd',
  '3ac18f81-a42f-44ee-8029-fb4017078f83',
  '2d4122ab-2443-4ff8-8423-eb1d9cb9a8eb'
);

-- Step 4: Delete stale couple members from old couples (including Magi Tech)
DELETE FROM clerk_couple_members 
WHERE couple_id IN (
  '3cd8e3a9-24dc-4918-a898-322b94bd21bd',
  '3ac18f81-a42f-44ee-8029-fb4017078f83',
  '2d4122ab-2443-4ff8-8423-eb1d9cb9a8eb'
);

-- Step 5: Delete old stale couples
DELETE FROM clerk_couples 
WHERE id IN (
  '3cd8e3a9-24dc-4918-a898-322b94bd21bd',
  '3ac18f81-a42f-44ee-8029-fb4017078f83',
  '2d4122ab-2443-4ff8-8423-eb1d9cb9a8eb'
);

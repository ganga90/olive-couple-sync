-- Migrate all data from old dev account to new production account
-- Old account: user_317GIt3LFfOBBLyR0E9G6ewfCmN
-- New account: user_35qkEgvbMI0SzIpvEsDW35drgLu (gventuri90@gmail.com)

-- Step 1: Migrate all notes to new account
UPDATE public.clerk_notes 
SET author_id = 'user_35qkEgvbMI0SzIpvEsDW35drgLu',
    updated_at = now()
WHERE author_id = 'user_317GIt3LFfOBBLyR0E9G6ewfCmN';

-- Step 2: Migrate all lists to new account
UPDATE public.clerk_lists 
SET author_id = 'user_35qkEgvbMI0SzIpvEsDW35drgLu',
    updated_at = now()
WHERE author_id = 'user_317GIt3LFfOBBLyR0E9G6ewfCmN';

-- Step 3: Migrate couple ownership to new account
UPDATE public.clerk_couples 
SET created_by = 'user_35qkEgvbMI0SzIpvEsDW35drgLu',
    updated_at = now()
WHERE created_by = 'user_317GIt3LFfOBBLyR0E9G6ewfCmN';

-- Step 4: Add new account as owner to those couples if not already a member
INSERT INTO public.clerk_couple_members (couple_id, user_id, role)
SELECT id, 'user_35qkEgvbMI0SzIpvEsDW35drgLu', 'owner'::member_role
FROM public.clerk_couples
WHERE created_by = 'user_35qkEgvbMI0SzIpvEsDW35drgLu'
ON CONFLICT (couple_id, user_id) DO NOTHING;
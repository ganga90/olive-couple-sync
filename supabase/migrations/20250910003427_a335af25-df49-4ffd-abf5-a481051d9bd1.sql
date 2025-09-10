-- Fix duplicate create_invite function overloading issue
-- Drop the duplicate function and keep only the one that matches frontend usage

-- Drop the function with email parameter that's causing overloading conflict
DROP FUNCTION IF EXISTS public.create_invite(p_couple_id uuid);

-- Keep only the main create_invite function that takes couple_id and optional email
-- This function already exists and is the correct one to use
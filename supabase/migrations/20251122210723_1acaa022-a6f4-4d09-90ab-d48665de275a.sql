-- Clean up duplicate phone numbers and old data for fresh start after Clerk migration

-- Step 1: Remove phone number from old dev account (keeping newer production account)
UPDATE public.clerk_profiles 
SET phone_number = NULL 
WHERE id = 'user_317GIt3LFfOBBLyR0E9G6ewfCmN';

-- Step 2: Clear all expired and used linking tokens for fresh start
DELETE FROM public.linking_tokens 
WHERE expires_at < NOW() OR used_at IS NOT NULL;

-- Step 3: Add unique constraint to prevent future duplicate phone numbers
CREATE UNIQUE INDEX clerk_profiles_phone_number_unique 
ON public.clerk_profiles (phone_number) 
WHERE phone_number IS NOT NULL;
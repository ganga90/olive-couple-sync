-- Add default_privacy preference to clerk_profiles
-- Values: 'private' or 'shared' (default: 'shared' for backward compatibility)
ALTER TABLE public.clerk_profiles
ADD COLUMN IF NOT EXISTS default_privacy text NOT NULL DEFAULT 'shared';

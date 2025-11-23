-- Add timezone field to clerk_profiles table to store user's timezone
ALTER TABLE public.clerk_profiles 
ADD COLUMN timezone TEXT DEFAULT 'UTC';

-- Add a comment to explain the field
COMMENT ON COLUMN public.clerk_profiles.timezone IS 'User timezone in IANA format (e.g., America/New_York, Europe/London)';

-- Create index for faster queries
CREATE INDEX idx_clerk_profiles_timezone ON public.clerk_profiles(timezone);
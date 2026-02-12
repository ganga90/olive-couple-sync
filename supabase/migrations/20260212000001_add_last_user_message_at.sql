-- Add last_user_message_at to clerk_profiles for tracking 24h WhatsApp messaging window
-- Meta WhatsApp Business requires templates for messages outside the 24h window
ALTER TABLE public.clerk_profiles
  ADD COLUMN IF NOT EXISTS last_user_message_at timestamptz;

-- Index for efficient window checks during outbound messaging
CREATE INDEX IF NOT EXISTS idx_clerk_profiles_last_user_message
  ON public.clerk_profiles (last_user_message_at)
  WHERE last_user_message_at IS NOT NULL;

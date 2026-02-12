ALTER TABLE public.clerk_profiles 
  ADD COLUMN IF NOT EXISTS last_user_message_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_clerk_profiles_last_user_message 
  ON public.clerk_profiles (last_user_message_at) 
  WHERE last_user_message_at IS NOT NULL;
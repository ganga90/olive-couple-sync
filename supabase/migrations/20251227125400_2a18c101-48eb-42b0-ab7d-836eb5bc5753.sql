-- Add language preference column to clerk_profiles
ALTER TABLE public.clerk_profiles 
ADD COLUMN IF NOT EXISTS language_preference TEXT DEFAULT 'en' 
CHECK (language_preference IN ('en', 'es-ES', 'it-IT'));

-- Add comment for documentation
COMMENT ON COLUMN public.clerk_profiles.language_preference IS 'User preferred language: en (English), es-ES (Spanish Spain), it-IT (Italian)';
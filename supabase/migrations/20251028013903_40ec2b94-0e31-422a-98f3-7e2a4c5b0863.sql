-- Add phone_number column to clerk_profiles table
ALTER TABLE public.clerk_profiles
ADD COLUMN phone_number text;

-- Create an index for faster lookups by phone number (useful for WhatsApp integration)
CREATE INDEX idx_clerk_profiles_phone_number ON public.clerk_profiles(phone_number) WHERE phone_number IS NOT NULL;

-- Add a comment to document the column
COMMENT ON COLUMN public.clerk_profiles.phone_number IS 'User phone number for WhatsApp integration (WaId from Twilio)';
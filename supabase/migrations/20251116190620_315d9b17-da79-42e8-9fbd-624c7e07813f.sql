-- Add location and media support to clerk_notes table
ALTER TABLE public.clerk_notes 
ADD COLUMN IF NOT EXISTS location JSONB,
ADD COLUMN IF NOT EXISTS media_urls TEXT[];

-- Add index for location queries (useful for future location-based features)
CREATE INDEX IF NOT EXISTS idx_clerk_notes_location 
ON public.clerk_notes USING GIN(location) 
WHERE location IS NOT NULL;

-- Add comment to explain location structure
COMMENT ON COLUMN public.clerk_notes.location IS 'Stores location data as JSON with latitude and longitude, e.g. {"latitude": "37.7749", "longitude": "-122.4194"}';

COMMENT ON COLUMN public.clerk_notes.media_urls IS 'Array of media URLs attached to the task (images, audio, documents from WhatsApp)';
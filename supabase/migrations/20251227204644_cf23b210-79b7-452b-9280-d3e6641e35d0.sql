-- Add olive_tips column to store cached agent tips
ALTER TABLE public.clerk_notes 
ADD COLUMN IF NOT EXISTS olive_tips JSONB DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.clerk_notes.olive_tips IS 'Stores cached AI-generated tips with structure: { status: "generated" | "error", type: "book" | "place" | "action" | "general", data: {...}, generated_at: timestamp }';
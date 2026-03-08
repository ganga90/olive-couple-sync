
ALTER TABLE public.clerk_notes 
ADD COLUMN IF NOT EXISTS is_sensitive boolean NOT NULL DEFAULT false;

ALTER TABLE public.clerk_notes
ADD COLUMN IF NOT EXISTS encrypted_original_text text;

ALTER TABLE public.clerk_notes
ADD COLUMN IF NOT EXISTS encrypted_summary text;

CREATE INDEX IF NOT EXISTS idx_clerk_notes_is_sensitive ON public.clerk_notes(is_sensitive) WHERE is_sensitive = true;

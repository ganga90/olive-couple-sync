-- Add note_style column to clerk_profiles
ALTER TABLE public.clerk_profiles
ADD COLUMN note_style text DEFAULT 'auto' CHECK (note_style IN ('auto', 'succinct', 'conversational'));
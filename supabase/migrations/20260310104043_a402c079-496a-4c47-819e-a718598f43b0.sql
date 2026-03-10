
-- Add couple_id to user_memories for shared memories support
ALTER TABLE public.user_memories 
ADD COLUMN IF NOT EXISTS couple_id uuid REFERENCES public.clerk_couples(id) ON DELETE SET NULL;

-- Create index for couple-scoped memory queries
CREATE INDEX IF NOT EXISTS idx_user_memories_couple_id ON public.user_memories(couple_id) WHERE couple_id IS NOT NULL;

-- Update RLS: allow couple members to see shared memories
CREATE POLICY "user_memories_select_couple"
ON public.user_memories
FOR SELECT
TO public
USING (
  (couple_id IS NOT NULL AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text)))
);

-- Allow couple members to insert shared memories
CREATE POLICY "user_memories_insert_couple"
ON public.user_memories
FOR INSERT
TO public
WITH CHECK (
  (couple_id IS NOT NULL AND user_id = (auth.jwt() ->> 'sub'::text) AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text)))
);

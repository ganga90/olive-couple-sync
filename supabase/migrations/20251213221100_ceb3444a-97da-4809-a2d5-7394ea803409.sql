-- Create table for persisting Olive Assistant conversation sessions
CREATE TABLE public.olive_conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text NOT NULL,
  note_id uuid NOT NULL REFERENCES public.clerk_notes(id) ON DELETE CASCADE,
  interaction_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, note_id)
);

-- Enable RLS
ALTER TABLE public.olive_conversations ENABLE ROW LEVEL SECURITY;

-- Users can only access their own conversations
CREATE POLICY "Users can view their own conversations"
ON public.olive_conversations
FOR SELECT
USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "Users can insert their own conversations"
ON public.olive_conversations
FOR INSERT
WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "Users can update their own conversations"
ON public.olive_conversations
FOR UPDATE
USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "Users can delete their own conversations"
ON public.olive_conversations
FOR DELETE
USING (user_id = (auth.jwt() ->> 'sub'));

-- Index for fast lookups
CREATE INDEX idx_olive_conversations_user_note ON public.olive_conversations(user_id, note_id);

-- Trigger for updated_at
CREATE TRIGGER update_olive_conversations_updated_at
BEFORE UPDATE ON public.olive_conversations
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();
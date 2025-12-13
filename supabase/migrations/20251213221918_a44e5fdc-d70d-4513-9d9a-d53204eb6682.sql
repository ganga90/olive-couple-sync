-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Create user_memories table for storing explicit user facts
CREATE TABLE public.user_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'personal',
  importance INTEGER CHECK (importance BETWEEN 1 AND 5) DEFAULT 3,
  embedding extensions.vector(768),
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_user_memories_user ON public.user_memories(user_id);
CREATE INDEX idx_user_memories_active ON public.user_memories(user_id, is_active);
CREATE INDEX idx_user_memories_category ON public.user_memories(user_id, category);

-- Enable RLS
ALTER TABLE public.user_memories ENABLE ROW LEVEL SECURITY;

-- RLS policies for Clerk auth (using JWT sub claim)
CREATE POLICY "user_memories_select" ON public.user_memories
  FOR SELECT USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "user_memories_insert" ON public.user_memories
  FOR INSERT WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "user_memories_update" ON public.user_memories
  FOR UPDATE USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "user_memories_delete" ON public.user_memories
  FOR DELETE USING (user_id = (auth.jwt() ->> 'sub'));

-- Trigger for updated_at
CREATE TRIGGER update_user_memories_updated_at
  BEFORE UPDATE ON public.user_memories
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Create vector similarity search function
CREATE OR REPLACE FUNCTION public.search_user_memories(
  p_user_id TEXT,
  p_query_embedding extensions.vector(768),
  p_match_threshold FLOAT DEFAULT 0.5,
  p_match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  content TEXT,
  category TEXT,
  importance INT,
  similarity FLOAT
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.id,
    m.title,
    m.content,
    m.category,
    m.importance,
    (1 - (m.embedding <=> p_query_embedding))::FLOAT AS similarity
  FROM public.user_memories m
  WHERE m.user_id = p_user_id 
    AND m.is_active = true
    AND m.embedding IS NOT NULL
    AND (1 - (m.embedding <=> p_query_embedding)) > p_match_threshold
  ORDER BY m.embedding <=> p_query_embedding ASC
  LIMIT p_match_count;
END;
$$;
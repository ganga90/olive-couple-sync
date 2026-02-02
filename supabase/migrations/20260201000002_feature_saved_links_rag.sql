-- ============================================================================
-- FEATURE 2: Recall & Reframe Agent - Database Schema
-- ============================================================================
-- Tables for saved links with vector embeddings for semantic RAG retrieval
-- Combines "Hard Facts" (saved links/docs) with "Soft Context" (memories)
-- ============================================================================

-- Enable pgvector extension (should already exist from memory system)
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- SAVED_LINKS TABLE
-- Stores URLs, articles, documents with AI-generated summaries and embeddings
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.saved_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  couple_id UUID REFERENCES public.clerk_couples(id) ON DELETE SET NULL,

  -- Core link data
  url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  content_summary TEXT,  -- AI-generated summary of page content
  domain TEXT,  -- Extracted hostname (e.g., "amazon.com")

  -- Categorization
  tags TEXT[] DEFAULT '{}',
  source_type TEXT DEFAULT 'link' CHECK (source_type IN (
    'link', 'document', 'article', 'recipe', 'product', 'restaurant', 'place', 'video', 'social'
  )),

  -- Vector embedding for semantic search
  embedding VECTOR(1536),

  -- Extended metadata
  metadata JSONB DEFAULT '{}',  -- Stores: price, rating, author, publish_date, etc.
  image_url TEXT,  -- Preview/thumbnail image
  fetched_at TIMESTAMPTZ,  -- When we last fetched/updated content

  -- Source tracking
  source_note_id UUID REFERENCES public.clerk_notes(id) ON DELETE SET NULL,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Standard indexes
CREATE INDEX IF NOT EXISTS idx_saved_links_user_id ON public.saved_links(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_links_couple_id ON public.saved_links(couple_id);
CREATE INDEX IF NOT EXISTS idx_saved_links_domain ON public.saved_links(domain);
CREATE INDEX IF NOT EXISTS idx_saved_links_source_type ON public.saved_links(source_type);
CREATE INDEX IF NOT EXISTS idx_saved_links_created_at ON public.saved_links(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_links_url ON public.saved_links(url);

-- Vector index for semantic search (IVFFlat for faster approximate NN)
CREATE INDEX IF NOT EXISTS idx_saved_links_embedding ON public.saved_links
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- GIN index for tag searches
CREATE INDEX IF NOT EXISTS idx_saved_links_tags ON public.saved_links USING GIN (tags);

-- ============================================================================
-- ROW LEVEL SECURITY - SAVED_LINKS
-- ============================================================================
ALTER TABLE public.saved_links ENABLE ROW LEVEL SECURITY;

-- Users can view their own links or couple links
CREATE POLICY "saved_links.select" ON public.saved_links
  FOR SELECT TO authenticated
  USING (
    user_id = auth.jwt()->>'sub'
    OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id))
  );

-- Users can insert their own links
CREATE POLICY "saved_links.insert" ON public.saved_links
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.jwt()->>'sub');

-- Users can update their own links or couple links
CREATE POLICY "saved_links.update" ON public.saved_links
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.jwt()->>'sub'
    OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id))
  )
  WITH CHECK (
    user_id = auth.jwt()->>'sub'
    OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id))
  );

-- Users can delete their own links
CREATE POLICY "saved_links.delete" ON public.saved_links
  FOR DELETE TO authenticated
  USING (user_id = auth.jwt()->>'sub');

-- ============================================================================
-- MATCH_DOCUMENTS FUNCTION - Dual-Source RAG Retrieval
-- ============================================================================
-- This function performs semantic search across BOTH:
-- 1. saved_links (Hard Facts - objective information)
-- 2. olive_memory_chunks (Soft Context - subjective memories/opinions)
-- Returns results tagged by source type for LLM to prioritize appropriately
-- ============================================================================
CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding VECTOR(1536),
  match_user_id TEXT,
  match_couple_id UUID DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.65,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  source_type TEXT,
  source_label TEXT,
  similarity FLOAT,
  created_at TIMESTAMPTZ,
  metadata JSONB
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY

  -- ========================================
  -- FACTS from saved_links (objective data)
  -- ========================================
  SELECT
    sl.id,
    COALESCE(sl.content_summary, sl.description, sl.title) as content,
    'fact'::TEXT as source_type,
    ('Link: ' || COALESCE(sl.domain, 'unknown'))::TEXT as source_label,
    (1 - (sl.embedding <=> query_embedding))::FLOAT as similarity,
    sl.created_at,
    jsonb_build_object(
      'url', sl.url,
      'title', sl.title,
      'domain', sl.domain,
      'link_type', sl.source_type,
      'tags', sl.tags
    ) as metadata
  FROM public.saved_links sl
  WHERE (sl.user_id = match_user_id OR sl.couple_id = match_couple_id)
    AND sl.embedding IS NOT NULL
    AND (1 - (sl.embedding <=> query_embedding)) > match_threshold

  UNION ALL

  -- ========================================
  -- MEMORIES from olive_memory_chunks (subjective experiences)
  -- ========================================
  SELECT
    mc.id,
    mc.content,
    'memory'::TEXT as source_type,
    ('Memory: ' || COALESCE(mc.chunk_type, 'general') || ' from ' || COALESCE(mc.source_context, 'conversation'))::TEXT as source_label,
    (1 - (mc.embedding <=> query_embedding))::FLOAT as similarity,
    mc.created_at,
    jsonb_build_object(
      'chunk_type', mc.chunk_type,
      'importance', mc.importance,
      'source_context', mc.source_context,
      'source_type', 'memory'
    ) as metadata
  FROM public.olive_memory_chunks mc
  WHERE mc.user_id = match_user_id
    AND mc.embedding IS NOT NULL
    AND (1 - (mc.embedding <=> query_embedding)) > match_threshold

  -- Order by similarity and limit
  ORDER BY similarity DESC
  LIMIT match_count * 2;  -- Get extra to ensure mix of facts and memories
END;
$$;

-- ============================================================================
-- SEARCH_SAVED_LINKS FUNCTION - Links-only semantic search
-- ============================================================================
CREATE OR REPLACE FUNCTION public.search_saved_links(
  query_embedding VECTOR(1536),
  match_user_id TEXT,
  match_couple_id UUID DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.65,
  match_count INT DEFAULT 10,
  filter_source_type TEXT DEFAULT NULL,
  filter_domain TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  url TEXT,
  title TEXT,
  description TEXT,
  content_summary TEXT,
  domain TEXT,
  source_type TEXT,
  tags TEXT[],
  similarity FLOAT,
  metadata JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sl.id,
    sl.url,
    sl.title,
    sl.description,
    sl.content_summary,
    sl.domain,
    sl.source_type,
    sl.tags,
    (1 - (sl.embedding <=> query_embedding))::FLOAT as similarity,
    sl.metadata,
    sl.created_at
  FROM public.saved_links sl
  WHERE (sl.user_id = match_user_id OR sl.couple_id = match_couple_id)
    AND sl.embedding IS NOT NULL
    AND (1 - (sl.embedding <=> query_embedding)) > match_threshold
    AND (filter_source_type IS NULL OR sl.source_type = filter_source_type)
    AND (filter_domain IS NULL OR sl.domain ILIKE '%' || filter_domain || '%')
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- ============================================================================
-- TRIGGER FOR UPDATED_AT
-- ============================================================================
DROP TRIGGER IF EXISTS trigger_saved_links_updated_at ON public.saved_links;
CREATE TRIGGER trigger_saved_links_updated_at
  BEFORE UPDATE ON public.saved_links
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE public.saved_links IS 'Stores saved URLs/links with AI summaries and vector embeddings for RAG';
COMMENT ON FUNCTION public.match_documents IS 'Dual-source semantic search across saved_links (facts) and memory_chunks (memories)';
COMMENT ON FUNCTION public.search_saved_links IS 'Semantic search within saved_links only with optional filters';
COMMENT ON COLUMN public.saved_links.embedding IS 'OpenAI text-embedding-3-small vector (1536 dimensions) for semantic search';
COMMENT ON COLUMN public.saved_links.source_type IS 'Type classification: link, document, article, recipe, product, restaurant, place, video, social';

-- Phase 1.1: Knowledge Graph tables
-- Stores entities extracted from notes and their relationships
-- Inspired by Graphify's two-pass extraction with confidence scoring

-- ============================================================================
-- ENTITIES: People, places, products, organizations, dates, amounts
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.olive_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  couple_id uuid REFERENCES public.clerk_couples(id) ON DELETE SET NULL,

  -- Identity
  name text NOT NULL,
  canonical_name text NOT NULL, -- normalized: "Mom" → "maria venturi"
  entity_type text NOT NULL,    -- person, place, product, organization, date_event, amount, concept

  -- Metadata (flexible per entity type)
  metadata jsonb DEFAULT '{}'::jsonb,
  -- e.g. person: {birthday, phone, relationship, aliases: ["Mom","mom","Maria"]}
  -- e.g. place:  {address, type: "restaurant", rating}
  -- e.g. product:{brand, price, url}

  -- Tracking
  mention_count integer DEFAULT 1,
  first_seen timestamptz DEFAULT now(),
  last_seen timestamptz DEFAULT now(),

  -- Embedding for semantic matching during entity resolution
  embedding vector(768),

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_olive_entities_user ON public.olive_entities(user_id);
CREATE INDEX IF NOT EXISTS idx_olive_entities_canonical ON public.olive_entities(user_id, canonical_name);
CREATE INDEX IF NOT EXISTS idx_olive_entities_type ON public.olive_entities(user_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_olive_entities_mentions ON public.olive_entities(user_id, mention_count DESC);

-- RLS
ALTER TABLE public.olive_entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "olive_entities_user_policy" ON public.olive_entities
  FOR ALL TO public
  USING (
    user_id = (auth.jwt() ->> 'sub'::text)
    OR couple_id IN (
      SELECT couple_id FROM public.clerk_couple_members
      WHERE user_id = (auth.jwt() ->> 'sub'::text)
    )
  );

-- ============================================================================
-- RELATIONSHIPS: Typed, confidence-scored edges between entities
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.olive_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,

  -- Edge endpoints
  source_entity_id uuid NOT NULL REFERENCES public.olive_entities(id) ON DELETE CASCADE,
  target_entity_id uuid NOT NULL REFERENCES public.olive_entities(id) ON DELETE CASCADE,

  -- Relationship metadata
  relationship_type text NOT NULL,
  -- Types: knows, lives_at, works_at, prefers, owns, scheduled_for,
  --        costs, related_to, assigned_to, part_of, visited, wants

  -- Confidence (Graphify-inspired)
  confidence text NOT NULL DEFAULT 'INFERRED',
  -- EXTRACTED (1.0): directly stated in text
  -- INFERRED  (0.5-0.8): derived from context
  -- AMBIGUOUS (≤0.4): needs user confirmation
  confidence_score float DEFAULT 0.7,

  -- Provenance
  rationale text,           -- why this relationship was inferred
  source_note_id uuid,      -- which note created this relationship

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_olive_relationships_user ON public.olive_relationships(user_id);
CREATE INDEX IF NOT EXISTS idx_olive_relationships_source ON public.olive_relationships(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_olive_relationships_target ON public.olive_relationships(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_olive_relationships_type ON public.olive_relationships(user_id, relationship_type);

-- RLS
ALTER TABLE public.olive_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "olive_relationships_user_policy" ON public.olive_relationships
  FOR ALL TO public
  USING (user_id = (auth.jwt() ->> 'sub'::text));

-- ============================================================================
-- ENTITY COMMUNITIES: Clusters of related entities (detected periodically)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.olive_entity_communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  label text NOT NULL,           -- auto-generated: "Health & Wellness", "Home Projects"
  entity_ids uuid[] NOT NULL,    -- array of entity IDs in this community
  cohesion float DEFAULT 0,      -- intra-community edge density (0-1)
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_olive_entity_communities_user ON public.olive_entity_communities(user_id);

ALTER TABLE public.olive_entity_communities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "olive_entity_communities_user_policy" ON public.olive_entity_communities
  FOR ALL TO public
  USING (user_id = (auth.jwt() ->> 'sub'::text));

-- ============================================================================
-- HELPER: Search entities by embedding similarity
-- ============================================================================
CREATE OR REPLACE FUNCTION public.search_entities(
  p_user_id text,
  p_query_embedding vector,
  p_match_threshold double precision DEFAULT 0.7,
  p_match_count integer DEFAULT 10
)
RETURNS TABLE(
  id uuid,
  name text,
  canonical_name text,
  entity_type text,
  metadata jsonb,
  mention_count integer,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.name,
    e.canonical_name,
    e.entity_type,
    e.metadata,
    e.mention_count,
    (1 - (e.embedding <=> p_query_embedding))::double precision AS similarity
  FROM public.olive_entities e
  WHERE e.user_id = p_user_id
    AND e.embedding IS NOT NULL
    AND (1 - (e.embedding <=> p_query_embedding)) > p_match_threshold
  ORDER BY e.embedding <=> p_query_embedding ASC
  LIMIT p_match_count;
END;
$function$;

-- ============================================================================
-- TRIGGER: auto-update updated_at
-- ============================================================================
CREATE TRIGGER set_updated_at_olive_entities
  BEFORE UPDATE ON public.olive_entities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_olive_relationships
  BEFORE UPDATE ON public.olive_relationships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_olive_entity_communities
  BEFORE UPDATE ON public.olive_entity_communities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Fix find_similar_notes: add extensions to search_path so the <=> operator resolves
CREATE OR REPLACE FUNCTION public.find_similar_notes(
  p_user_id text, 
  p_couple_id uuid, 
  p_query_embedding extensions.vector, 
  p_threshold double precision DEFAULT 0.85, 
  p_limit integer DEFAULT 5
)
RETURNS TABLE(id uuid, summary text, similarity double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    n.id,
    n.summary,
    (1 - (n.embedding <=> p_query_embedding))::float AS similarity
  FROM public.clerk_notes n
  WHERE n.embedding IS NOT NULL
    AND n.completed = false
    AND (
      (n.author_id = p_user_id AND n.couple_id IS NULL)
      OR (n.couple_id = p_couple_id AND p_couple_id IS NOT NULL)
    )
    AND (1 - (n.embedding <=> p_query_embedding)) > p_threshold
  ORDER BY n.embedding <=> p_query_embedding ASC
  LIMIT p_limit;
END;
$function$;

-- Also fix find_similar_chunks which may have the same issue
CREATE OR REPLACE FUNCTION public.find_similar_chunks(
  p_user_id text, 
  p_embedding extensions.vector, 
  p_threshold double precision DEFAULT 0.92, 
  p_limit integer DEFAULT 10
)
RETURNS TABLE(id uuid, content text, chunk_type text, importance integer, source text, similarity double precision, created_at timestamp with time zone)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    c.id,
    c.content,
    c.chunk_type,
    c.importance,
    c.source,
    1 - (c.embedding <=> p_embedding) AS similarity,
    c.created_at
  FROM olive_memory_chunks c
  WHERE c.user_id = p_user_id
    AND c.is_active = true
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> p_embedding) >= p_threshold
  ORDER BY c.embedding <=> p_embedding
  LIMIT p_limit;
$function$;

-- Fix search_user_memories
CREATE OR REPLACE FUNCTION public.search_user_memories(
  p_user_id text, 
  p_query_embedding extensions.vector, 
  p_match_threshold double precision DEFAULT 0.5, 
  p_match_count integer DEFAULT 10
)
RETURNS TABLE(id uuid, title text, content text, category text, importance integer, similarity double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
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
$function$;

-- Fix search_entities
CREATE OR REPLACE FUNCTION public.search_entities(
  p_user_id text, 
  p_query_embedding extensions.vector, 
  p_match_threshold double precision DEFAULT 0.7, 
  p_match_count integer DEFAULT 10
)
RETURNS TABLE(id uuid, name text, canonical_name text, entity_type text, metadata jsonb, mention_count integer, similarity double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
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
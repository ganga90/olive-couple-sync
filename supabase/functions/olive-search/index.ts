/**
 * Olive Hybrid Search Service
 *
 * Combines vector similarity search (70%) with BM25 full-text search (30%)
 * for optimal retrieval of notes, tasks, and memory.
 *
 * Inspired by Moltbot's RAG implementation for accurate context retrieval.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SearchRequest {
  action: 'search_notes' | 'search_memory' | 'search_all' | 'generate_embedding';
  user_id?: string;
  couple_id?: string;
  query: string;
  filters?: SearchFilters;
  limit?: number;
  vector_weight?: number;  // 0.0 to 1.0, default 0.7
}

interface SearchFilters {
  categories?: string[];
  date_from?: string;
  date_to?: string;
  priority?: string[];
  completed?: boolean;
  has_due_date?: boolean;
}

interface SearchResult {
  id: string;
  type: 'note' | 'memory_chunk' | 'memory_file';
  content: string;
  summary?: string;
  score: number;
  metadata: Record<string, any>;
}

/**
 * Generate embedding using Lovable API
 */
async function generateEmbedding(text: string): Promise<number[] | null> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    console.error('LOVABLE_API_KEY not configured');
    return null;
  }

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text
      })
    });

    if (!response.ok) {
      console.error('Embedding API error:', response.status);
      return null;
    }

    const data = await response.json();
    return data.data?.[0]?.embedding || null;
  } catch (error) {
    console.error('Error generating embedding:', error);
    return null;
  }
}

/**
 * Search notes using hybrid search (vector + full-text)
 */
async function searchNotes(
  supabase: any,
  userId: string,
  coupleId: string | null,
  query: string,
  embedding: number[],
  filters: SearchFilters,
  limit: number,
  vectorWeight: number
): Promise<SearchResult[]> {
  // Use the hybrid_search_notes database function
  const { data, error } = await supabase.rpc('hybrid_search_notes', {
    p_user_id: userId,
    p_couple_id: coupleId,
    p_query: query,
    p_query_embedding: JSON.stringify(embedding),
    p_vector_weight: vectorWeight,
    p_limit: limit * 2  // Get more results to filter
  });

  if (error) {
    console.error('Hybrid search error:', error);
    return [];
  }

  let results = (data || []).map((row: any) => ({
    id: row.id,
    type: 'note' as const,
    content: row.original_text || row.summary,
    summary: row.summary,
    score: row.score,
    metadata: {
      category: row.category,
      due_date: row.due_date,
      priority: row.priority,
      completed: row.completed,
    },
  }));

  // Apply filters
  if (filters.categories && filters.categories.length > 0) {
    results = results.filter((r: SearchResult) =>
      filters.categories!.includes(r.metadata.category)
    );
  }

  if (filters.priority && filters.priority.length > 0) {
    results = results.filter((r: SearchResult) =>
      filters.priority!.includes(r.metadata.priority)
    );
  }

  if (filters.completed !== undefined) {
    results = results.filter((r: SearchResult) =>
      r.metadata.completed === filters.completed
    );
  }

  if (filters.has_due_date !== undefined) {
    results = results.filter((r: SearchResult) =>
      filters.has_due_date ? r.metadata.due_date != null : r.metadata.due_date == null
    );
  }

  if (filters.date_from) {
    const fromDate = new Date(filters.date_from);
    results = results.filter((r: SearchResult) =>
      r.metadata.due_date && new Date(r.metadata.due_date) >= fromDate
    );
  }

  if (filters.date_to) {
    const toDate = new Date(filters.date_to);
    results = results.filter((r: SearchResult) =>
      r.metadata.due_date && new Date(r.metadata.due_date) <= toDate
    );
  }

  return results.slice(0, limit);
}

/**
 * Search memory chunks using semantic similarity
 */
async function searchMemory(
  supabase: any,
  userId: string,
  query: string,
  embedding: number[],
  limit: number
): Promise<SearchResult[]> {
  // Use the search_memory_chunks database function
  const { data, error } = await supabase.rpc('search_memory_chunks', {
    p_user_id: userId,
    p_query_embedding: JSON.stringify(embedding),
    p_limit: limit,
    p_min_importance: 1
  });

  if (error) {
    console.error('Memory search error:', error);
    return [];
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    type: 'memory_chunk' as const,
    content: row.content,
    score: row.similarity,
    metadata: {
      chunk_type: row.chunk_type,
      importance: row.importance,
      source: row.source,
      created_at: row.created_at,
    },
  }));
}

/**
 * Search memory files using embedding similarity
 */
async function searchMemoryFiles(
  supabase: any,
  userId: string,
  embedding: number[],
  limit: number
): Promise<SearchResult[]> {
  const { data, error } = await supabase
    .from('olive_memory_files')
    .select('id, file_type, content, metadata, created_at')
    .eq('user_id', userId)
    .not('embedding', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit * 2);

  if (error) {
    console.error('Memory files search error:', error);
    return [];
  }

  // Calculate similarity manually since we can't do vector ops in JS easily
  // This is a simplified approach - the database function would be better
  return (data || []).slice(0, limit).map((row: any, index: number) => ({
    id: row.id,
    type: 'memory_file' as const,
    content: row.content,
    score: 1 - (index / limit), // Simple ranking by recency for now
    metadata: {
      file_type: row.file_type,
      ...row.metadata,
    },
  }));
}

/**
 * Combine and rank results from multiple sources
 */
function combineResults(
  noteResults: SearchResult[],
  memoryResults: SearchResult[],
  limit: number
): SearchResult[] {
  // Combine all results
  const combined = [...noteResults, ...memoryResults];

  // Sort by score descending
  combined.sort((a, b) => b.score - a.score);

  // Return top N
  return combined.slice(0, limit);
}

/**
 * Extract relevant snippets from content
 */
function extractSnippet(content: string, query: string, maxLength: number = 200): string {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const words = lowerQuery.split(/\s+/).filter(w => w.length > 2);

  // Find the first occurrence of any query word
  let bestIndex = -1;
  for (const word of words) {
    const index = lowerContent.indexOf(word);
    if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index;
    }
  }

  if (bestIndex === -1) {
    // No match found, return beginning of content
    return content.length > maxLength
      ? content.substring(0, maxLength) + '...'
      : content;
  }

  // Extract snippet around the match
  const start = Math.max(0, bestIndex - 50);
  const end = Math.min(content.length, bestIndex + maxLength - 50);

  let snippet = content.substring(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';

  return snippet;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body: SearchRequest = await req.json();
    const {
      action,
      user_id,
      couple_id,
      query,
      filters = {},
      limit = 20,
      vector_weight = 0.7
    } = body;

    if (!query) {
      return new Response(
        JSON.stringify({ success: false, error: 'Query required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    switch (action) {
      case 'generate_embedding': {
        const embedding = await generateEmbedding(query);
        return new Response(
          JSON.stringify({ success: true, embedding }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'search_notes': {
        if (!user_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'user_id required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Generate embedding for query
        const embedding = await generateEmbedding(query);
        if (!embedding) {
          // Fallback to text-only search
          const { data, error } = await supabase
            .from('clerk_notes')
            .select('id, original_text, summary, category, due_date, priority, completed')
            .or(`author_id.eq.${user_id}${couple_id ? `,couple_id.eq.${couple_id}` : ''}`)
            .textSearch('search_vector', query)
            .limit(limit);

          if (error) {
            return new Response(
              JSON.stringify({ success: false, error: error.message }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          const results: SearchResult[] = (data || []).map((row: any, i: number) => ({
            id: row.id,
            type: 'note',
            content: row.original_text || row.summary,
            summary: row.summary,
            score: 1 - (i / limit),
            metadata: {
              category: row.category,
              due_date: row.due_date,
              priority: row.priority,
              completed: row.completed,
            },
          }));

          return new Response(
            JSON.stringify({ success: true, results, method: 'text_only' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const results = await searchNotes(
          supabase,
          user_id,
          couple_id || null,
          query,
          embedding,
          filters,
          limit,
          vector_weight
        );

        // Add snippets
        const resultsWithSnippets = results.map(r => ({
          ...r,
          snippet: extractSnippet(r.content, query),
        }));

        return new Response(
          JSON.stringify({ success: true, results: resultsWithSnippets, method: 'hybrid' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'search_memory': {
        if (!user_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'user_id required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const embedding = await generateEmbedding(query);
        if (!embedding) {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to generate embedding' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const results = await searchMemory(supabase, user_id, query, embedding, limit);

        // Add snippets
        const resultsWithSnippets = results.map(r => ({
          ...r,
          snippet: extractSnippet(r.content, query),
        }));

        return new Response(
          JSON.stringify({ success: true, results: resultsWithSnippets }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'search_all': {
        if (!user_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'user_id required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const embedding = await generateEmbedding(query);
        if (!embedding) {
          return new Response(
            JSON.stringify({ success: false, error: 'Failed to generate embedding' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Search both notes and memory
        const [noteResults, memoryResults] = await Promise.all([
          searchNotes(
            supabase,
            user_id,
            couple_id || null,
            query,
            embedding,
            filters,
            limit,
            vector_weight
          ),
          searchMemory(supabase, user_id, query, embedding, limit),
        ]);

        // Combine and rank
        const combined = combineResults(noteResults, memoryResults, limit);

        // Add snippets
        const resultsWithSnippets = combined.map(r => ({
          ...r,
          snippet: extractSnippet(r.content, query),
        }));

        return new Response(
          JSON.stringify({
            success: true,
            results: resultsWithSnippets,
            breakdown: {
              notes: noteResults.length,
              memory: memoryResults.length,
            },
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Unknown action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('Search error:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

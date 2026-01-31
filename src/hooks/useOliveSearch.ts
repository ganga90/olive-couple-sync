/**
 * Olive Search Hook
 *
 * React hook for hybrid search across notes and memory.
 * Combines vector similarity (70%) with BM25 full-text search (30%).
 */

import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/providers/AuthProvider';

export interface SearchResult {
  id: string;
  type: 'note' | 'memory_chunk' | 'memory_file';
  content: string;
  summary?: string;
  snippet?: string;
  score: number;
  metadata: Record<string, any>;
}

export interface SearchFilters {
  categories?: string[];
  date_from?: string;
  date_to?: string;
  priority?: string[];
  completed?: boolean;
  has_due_date?: boolean;
}

export interface SearchOptions {
  filters?: SearchFilters;
  limit?: number;
  vectorWeight?: number;  // 0.0 to 1.0, default 0.7
  includeMemory?: boolean;
}

interface UseOliveSearchReturn {
  isSearching: boolean;
  error: Error | null;
  results: SearchResult[];
  breakdown: { notes: number; memory: number } | null;
  searchMethod: 'hybrid' | 'text_only' | null;

  // Search methods
  search: (query: string, options?: SearchOptions) => Promise<SearchResult[]>;
  searchNotes: (query: string, options?: SearchOptions) => Promise<SearchResult[]>;
  searchMemory: (query: string, limit?: number) => Promise<SearchResult[]>;
  searchAll: (query: string, options?: SearchOptions) => Promise<SearchResult[]>;

  // Helpers
  clearResults: () => void;
  generateEmbedding: (text: string) => Promise<number[] | null>;
}

/**
 * Call the olive-search edge function
 */
async function callSearchService(action: string, params: Record<string, any> = {}): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();

  const response = await supabase.functions.invoke('olive-search', {
    body: { action, ...params },
    headers: session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : undefined,
  });

  if (response.error) {
    throw new Error(response.error.message);
  }

  return response.data;
}

/**
 * Hook for Olive Hybrid Search
 */
export function useOliveSearch(): UseOliveSearchReturn {
  const { user } = useAuth();
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [breakdown, setBreakdown] = useState<{ notes: number; memory: number } | null>(null);
  const [searchMethod, setSearchMethod] = useState<'hybrid' | 'text_only' | null>(null);

  // Get couple_id for the user
  const getCoupleId = useCallback(async (): Promise<string | null> => {
    if (!user?.id) return null;

    const { data } = await supabase
      .from('clerk_couple_members')
      .select('couple_id')
      .eq('user_id', user.id)
      .single();

    return data?.couple_id || null;
  }, [user?.id]);

  /**
   * Search notes using hybrid search
   */
  const searchNotes = useCallback(
    async (query: string, options?: SearchOptions): Promise<SearchResult[]> => {
      if (!user?.id || !query.trim()) {
        return [];
      }

      setIsSearching(true);
      setError(null);

      try {
        const coupleId = await getCoupleId();

        const result = await callSearchService('search_notes', {
          user_id: user.id,
          couple_id: coupleId,
          query: query.trim(),
          filters: options?.filters || {},
          limit: options?.limit || 20,
          vector_weight: options?.vectorWeight || 0.7,
        });

        if (!result.success) {
          throw new Error(result.error || 'Search failed');
        }

        setResults(result.results || []);
        setSearchMethod(result.method || 'hybrid');

        return result.results || [];
      } catch (err) {
        setError(err as Error);
        return [];
      } finally {
        setIsSearching(false);
      }
    },
    [user?.id, getCoupleId]
  );

  /**
   * Search memory chunks
   */
  const searchMemory = useCallback(
    async (query: string, limit: number = 20): Promise<SearchResult[]> => {
      if (!user?.id || !query.trim()) {
        return [];
      }

      setIsSearching(true);
      setError(null);

      try {
        const result = await callSearchService('search_memory', {
          user_id: user.id,
          query: query.trim(),
          limit,
        });

        if (!result.success) {
          throw new Error(result.error || 'Memory search failed');
        }

        setResults(result.results || []);

        return result.results || [];
      } catch (err) {
        setError(err as Error);
        return [];
      } finally {
        setIsSearching(false);
      }
    },
    [user?.id]
  );

  /**
   * Search all sources (notes + memory)
   */
  const searchAll = useCallback(
    async (query: string, options?: SearchOptions): Promise<SearchResult[]> => {
      if (!user?.id || !query.trim()) {
        return [];
      }

      setIsSearching(true);
      setError(null);

      try {
        const coupleId = await getCoupleId();

        const result = await callSearchService('search_all', {
          user_id: user.id,
          couple_id: coupleId,
          query: query.trim(),
          filters: options?.filters || {},
          limit: options?.limit || 20,
          vector_weight: options?.vectorWeight || 0.7,
        });

        if (!result.success) {
          throw new Error(result.error || 'Search failed');
        }

        setResults(result.results || []);
        setBreakdown(result.breakdown || null);
        setSearchMethod('hybrid');

        return result.results || [];
      } catch (err) {
        setError(err as Error);
        return [];
      } finally {
        setIsSearching(false);
      }
    },
    [user?.id, getCoupleId]
  );

  /**
   * Default search method - smart routing based on options
   */
  const search = useCallback(
    async (query: string, options?: SearchOptions): Promise<SearchResult[]> => {
      if (options?.includeMemory) {
        return searchAll(query, options);
      }
      return searchNotes(query, options);
    },
    [searchNotes, searchAll]
  );

  /**
   * Generate embedding for a text
   */
  const generateEmbedding = useCallback(
    async (text: string): Promise<number[] | null> => {
      try {
        const result = await callSearchService('generate_embedding', {
          query: text,
        });

        return result.success ? result.embedding : null;
      } catch (err) {
        console.error('Embedding generation failed:', err);
        return null;
      }
    },
    []
  );

  /**
   * Clear search results
   */
  const clearResults = useCallback(() => {
    setResults([]);
    setBreakdown(null);
    setSearchMethod(null);
    setError(null);
  }, []);

  return {
    isSearching,
    error,
    results,
    breakdown,
    searchMethod,
    search,
    searchNotes,
    searchMemory,
    searchAll,
    clearResults,
    generateEmbedding,
  };
}

export default useOliveSearch;

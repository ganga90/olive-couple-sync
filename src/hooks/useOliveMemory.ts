/**
 * Olive Memory Hook
 *
 * React hook for interacting with the persistent memory system.
 * Provides easy access to memory files, chunks, patterns, and context.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/providers/AuthProvider';
import type {
  MemoryFileType,
  ChunkType,
  PatternType,
  MemoryFile,
  MemoryChunk,
  Pattern,
  MemoryContext,
  UserPreferences,
} from '@/types/memory';

// Re-export types for convenience
export type {
  MemoryFileType,
  ChunkType,
  PatternType,
  MemoryFile,
  MemoryChunk,
  Pattern,
  MemoryContext,
  UserPreferences,
} from '@/types/memory';

interface UseOliveMemoryReturn {
  // State
  isLoading: boolean;
  error: Error | null;
  context: MemoryContext | null;
  preferences: UserPreferences | null;

  // Memory file operations
  getFile: (fileType: MemoryFileType, fileDate?: string) => Promise<MemoryFile | null>;
  writeFile: (fileType: MemoryFileType, content: string, fileDate?: string, metadata?: Record<string, any>) => Promise<MemoryFile>;
  appendToDaily: (content: string, source?: string) => Promise<MemoryFile>;
  getRecentLogs: (days?: number) => Promise<MemoryFile[]>;

  // Memory chunk operations
  addChunk: (params: {
    fileType: MemoryFileType;
    content: string;
    chunkType?: ChunkType;
    importance?: number;
    source?: string;
    fileDate?: string;
  }) => Promise<MemoryChunk>;
  searchChunks: (query: string, limit?: number, minImportance?: number) => Promise<MemoryChunk[]>;

  // Context operations
  getContext: (coupleId?: string, includeDaily?: boolean) => Promise<MemoryContext>;
  flushContext: (conversation: string, source?: string) => Promise<{ extracted: number; facts: any[] }>;
  refreshContext: () => Promise<void>;

  // Pattern operations
  updatePattern: (patternType: PatternType, observation: Record<string, any>) => Promise<Pattern>;
  getPatterns: (minConfidence?: number) => Promise<Pattern[]>;

  // Preferences
  getPreferences: () => Promise<UserPreferences>;
  updatePreferences: (preferences: Partial<UserPreferences>) => Promise<UserPreferences>;

  // Initialization
  initializeMemory: () => Promise<void>;
}

/**
 * Call the olive-memory edge function
 */
async function callMemoryService(action: string, params: Record<string, any> = {}): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();

  const response = await supabase.functions.invoke('olive-memory', {
    body: { action, ...params },
    headers: session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : undefined,
  });

  if (response.error) {
    throw new Error(response.error.message);
  }

  if (!response.data.success) {
    throw new Error(response.data.error || 'Unknown error');
  }

  return response.data;
}

/**
 * Hook for Olive Memory System
 */
export function useOliveMemory(): UseOliveMemoryReturn {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [context, setContext] = useState<MemoryContext | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);

  // Ref to track if initialized
  const initializedRef = useRef(false);

  // Initialize memory on mount
  useEffect(() => {
    if (user?.id && !initializedRef.current) {
      initializedRef.current = true;
      initializeMemory().catch(console.error);
    }
  }, [user?.id]);

  /**
   * Get a memory file
   */
  const getFile = useCallback(async (
    fileType: MemoryFileType,
    fileDate?: string
  ): Promise<MemoryFile | null> => {
    try {
      const result = await callMemoryService('read_file', {
        file_type: fileType,
        file_date: fileDate,
      });
      return result.file;
    } catch (err) {
      console.error('Failed to get memory file:', err);
      return null;
    }
  }, []);

  /**
   * Write/update a memory file
   */
  const writeFile = useCallback(async (
    fileType: MemoryFileType,
    content: string,
    fileDate?: string,
    metadata?: Record<string, any>
  ): Promise<MemoryFile> => {
    setIsLoading(true);
    try {
      const result = await callMemoryService('write_file', {
        file_type: fileType,
        content,
        file_date: fileDate,
        metadata,
      });
      return result.file;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Append to today's daily log
   */
  const appendToDaily = useCallback(async (
    content: string,
    source: string = 'app'
  ): Promise<MemoryFile> => {
    const result = await callMemoryService('append_daily', {
      content,
      source,
    });
    return result.file;
  }, []);

  /**
   * Get recent daily logs
   */
  const getRecentLogs = useCallback(async (days: number = 7): Promise<MemoryFile[]> => {
    const result = await callMemoryService('get_recent_logs', { days });
    return result.logs || [];
  }, []);

  /**
   * Add a memory chunk
   */
  const addChunk = useCallback(async (params: {
    fileType: MemoryFileType;
    content: string;
    chunkType?: ChunkType;
    importance?: number;
    source?: string;
    fileDate?: string;
  }): Promise<MemoryChunk> => {
    const result = await callMemoryService('add_chunk', {
      file_type: params.fileType,
      content: params.content,
      chunk_type: params.chunkType || 'fact',
      importance: params.importance || 3,
      source: params.source || 'app',
      file_date: params.fileDate,
    });
    return result.chunk;
  }, []);

  /**
   * Search memory chunks semantically
   */
  const searchChunks = useCallback(async (
    query: string,
    limit: number = 10,
    minImportance: number = 1
  ): Promise<MemoryChunk[]> => {
    const result = await callMemoryService('search_chunks', {
      query,
      limit,
      min_importance: minImportance,
    });
    return result.chunks || [];
  }, []);

  /**
   * Get full memory context for AI
   */
  const getContext = useCallback(async (
    coupleId?: string,
    includeDaily: boolean = true
  ): Promise<MemoryContext> => {
    const result = await callMemoryService('get_context', {
      couple_id: coupleId,
      include_daily: includeDaily,
    });
    return result.context;
  }, []);

  /**
   * Flush conversation context to memory
   */
  const flushContext = useCallback(async (
    conversation: string,
    source: string = 'conversation'
  ): Promise<{ extracted: number; facts: any[] }> => {
    const result = await callMemoryService('flush_context', {
      conversation,
      source,
    });
    return { extracted: result.extracted, facts: result.facts };
  }, []);

  /**
   * Refresh the cached context
   */
  const refreshContext = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const newContext = await getContext();
      setContext(newContext);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [getContext]);

  /**
   * Update a behavioral pattern
   */
  const updatePattern = useCallback(async (
    patternType: PatternType,
    observation: Record<string, any>
  ): Promise<Pattern> => {
    const result = await callMemoryService('update_pattern', {
      pattern_type: patternType,
      observation,
    });
    return result.pattern;
  }, []);

  /**
   * Get active patterns
   */
  const getPatterns = useCallback(async (minConfidence: number = 0.5): Promise<Pattern[]> => {
    const result = await callMemoryService('get_patterns', {
      min_confidence: minConfidence,
    });
    return result.patterns || [];
  }, []);

  /**
   * Get user preferences
   */
  const getPreferences = useCallback(async (): Promise<UserPreferences> => {
    const result = await callMemoryService('get_preferences', {});
    return result.preferences;
  }, []);

  /**
   * Update user preferences
   */
  const updatePreferences = useCallback(async (
    newPrefs: Partial<UserPreferences>
  ): Promise<UserPreferences> => {
    setIsLoading(true);
    try {
      const result = await callMemoryService('update_preferences', {
        preferences: newPrefs,
      });
      setPreferences(result.preferences);
      return result.preferences;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Initialize memory for user
   */
  const initializeMemory = useCallback(async (): Promise<void> => {
    if (!user?.id) return;

    setIsLoading(true);
    setError(null);

    try {
      // Initialize memory files
      await callMemoryService('initialize_user', {});

      // Load context and preferences
      const [newContext, newPrefs] = await Promise.all([
        getContext(),
        getPreferences(),
      ]);

      setContext(newContext);
      setPreferences(newPrefs);
    } catch (err) {
      console.error('Failed to initialize memory:', err);
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, getContext, getPreferences]);

  return {
    // State
    isLoading,
    error,
    context,
    preferences,

    // Memory file operations
    getFile,
    writeFile,
    appendToDaily,
    getRecentLogs,

    // Memory chunk operations
    addChunk,
    searchChunks,

    // Context operations
    getContext,
    flushContext,
    refreshContext,

    // Pattern operations
    updatePattern,
    getPatterns,

    // Preferences
    getPreferences,
    updatePreferences,

    // Initialization
    initializeMemory,
  };
}

/**
 * Hook for automatic memory context in AI conversations
 * Provides context injection and automatic flushing
 */
export function useMemoryContext() {
  const memory = useOliveMemory();
  const conversationRef = useRef<string[]>([]);
  const tokenCountRef = useRef(0);

  const FLUSH_THRESHOLD = 0.75; // 75% of context window
  const MAX_TOKENS = 8000; // Approximate context window

  /**
   * Add a message to the conversation tracker
   */
  const trackMessage = useCallback((message: string, role: 'user' | 'assistant') => {
    const formattedMessage = `${role}: ${message}`;
    conversationRef.current.push(formattedMessage);

    // Estimate tokens (rough: 4 chars per token)
    tokenCountRef.current += Math.ceil(message.length / 4);
  }, []);

  /**
   * Check if we should flush context
   */
  const shouldFlush = useCallback(() => {
    return tokenCountRef.current / MAX_TOKENS > FLUSH_THRESHOLD;
  }, []);

  /**
   * Flush conversation to memory and reset
   */
  const flush = useCallback(async () => {
    if (conversationRef.current.length === 0) return;

    const conversation = conversationRef.current.join('\n');
    await memory.flushContext(conversation);

    // Keep last 5 messages for continuity
    conversationRef.current = conversationRef.current.slice(-5);
    tokenCountRef.current = conversationRef.current.reduce(
      (sum, msg) => sum + Math.ceil(msg.length / 4),
      0
    );
  }, [memory]);

  /**
   * Build context for AI prompt
   */
  const buildContext = useCallback(async (): Promise<string> => {
    const ctx = memory.context || await memory.getContext();

    let contextStr = '';

    // Add profile if exists
    if (ctx.profile) {
      contextStr += `## User Profile\n${ctx.profile}\n\n`;
    }

    // Add today's log if exists
    if (ctx.today_log) {
      contextStr += `## Today's Activity\n${ctx.today_log}\n\n`;
    }

    // Add patterns
    if (ctx.patterns && ctx.patterns.length > 0) {
      contextStr += `## Observed Patterns\n`;
      for (const pattern of ctx.patterns) {
        contextStr += `- ${pattern.type}: ${JSON.stringify(pattern.data)} (confidence: ${pattern.confidence})\n`;
      }
      contextStr += '\n';
    }

    return contextStr;
  }, [memory]);

  /**
   * Auto-flush if needed after each message
   */
  const autoFlushIfNeeded = useCallback(async () => {
    if (shouldFlush()) {
      await flush();
    }
  }, [shouldFlush, flush]);

  return {
    trackMessage,
    shouldFlush,
    flush,
    buildContext,
    autoFlushIfNeeded,
    context: memory.context,
    isLoading: memory.isLoading,
  };
}

export default useOliveMemory;

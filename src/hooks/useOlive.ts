/**
 * Unified Olive Hook
 *
 * Master hook that combines all Moltbot-inspired features:
 * - Persistent Memory System
 * - WhatsApp Gateway
 * - Proactive Intelligence (Heartbeat)
 * - Skills System
 * - Hybrid Search
 * - Context Management
 *
 * Provides a single interface for AI-powered couple assistance.
 */

import { useCallback, useMemo } from 'react';
import { useOliveMemory, MemoryContext } from './useOliveMemory';
import { useWhatsAppGateway } from './useWhatsAppGateway';
import { useOliveHeartbeat, ProactivePreferences } from './useOliveHeartbeat';
import { useOliveSkills, SkillMatchResult, SkillExecutionResult } from './useOliveSkills';
import { useOliveSearch, SearchResult, SearchFilters, SearchOptions } from './useOliveSearch';
import {
  createOptimizedContext,
  estimateTokens,
  getWindowStats,
} from '@/lib/context-manager';
import { askOlive, processBrainDump, AskOliveRequest, BrainDumpInput, ProcessedBrainDump } from '@/lib/ai/gemini-service';
import { useAuth } from '@/providers/AuthProvider';

export interface OliveResponse {
  answer: string;
  suggestions?: string[];
  skillUsed?: string;
  memoryUpdated?: boolean;
  shouldFlushContext?: boolean;
  contextStats?: {
    tokensUsed: number;
    percentUsed: number;
    wasCompacted: boolean;
  };
}

export interface OliveConversation {
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }>;
  contextTokens: number;
}

interface UseOliveReturn {
  // Loading states
  isLoading: boolean;
  isMemoryLoading: boolean;
  isSearching: boolean;

  // Memory
  memoryContext: MemoryContext | null;
  refreshMemory: () => Promise<void>;
  updateProfile: (content: string) => Promise<void>;
  appendToDaily: (content: string, source?: string) => Promise<void>;

  // AI Interaction
  ask: (question: string, conversationHistory?: string[]) => Promise<OliveResponse>;
  processBrainDump: (input: Omit<BrainDumpInput, 'userId' | 'coupleId' | 'memoryContext'>) => Promise<ProcessedBrainDump>;

  // Search
  search: (query: string, options?: SearchOptions) => Promise<SearchResult[]>;
  searchWithMemory: (query: string) => Promise<SearchResult[]>;

  // Skills
  matchSkill: (message: string, category?: string) => Promise<SkillMatchResult>;
  executeSkill: (skillId: string, message: string) => Promise<SkillExecutionResult>;
  installedSkills: ReturnType<typeof useOliveSkills>['installedSkills'];

  // Proactive
  preferences: ProactivePreferences | null;
  updatePreferences: (prefs: Partial<ProactivePreferences>) => Promise<void>;
  requestBriefing: () => Promise<string>;

  // WhatsApp
  sendWhatsAppMessage: ReturnType<typeof useWhatsAppGateway>['sendMessage'];

  // Utilities
  estimateTokens: (text: string) => number;
  flushConversationToMemory: (conversation: string[]) => Promise<void>;
}

/**
 * Master hook for all Olive features
 */
export function useOlive(): UseOliveReturn {
  const { user } = useAuth();

  // Individual feature hooks
  const memory = useOliveMemory();
  const gateway = useWhatsAppGateway();
  const heartbeat = useOliveHeartbeat();
  const skills = useOliveSkills();
  const search = useOliveSearch();

  // Combined loading state
  const isLoading = memory.isLoading || gateway.isLoading || heartbeat.isLoading || skills.isLoading;

  /**
   * Ask Olive a question with full context
   */
  const ask = useCallback(
    async (question: string, conversationHistory: string[] = []): Promise<OliveResponse> => {
      if (!user?.id) {
        return { answer: 'Please sign in to use Olive.' };
      }

      // Get memory context
      const memoryContext = memory.context || await memory.getContext();

      // Check if any skill matches
      const skillMatch = await skills.matchSkill(question);

      let answer: string;
      let skillUsed: string | undefined;

      if (skillMatch.matched && skillMatch.skill) {
        // Execute the matched skill
        const skillResult = await skills.executeSkill(
          skillMatch.skill.skill_id,
          question,
          {
            memory_context: memoryContext?.profile || '',
            patterns: memoryContext?.patterns
              ?.map((p) => `${p.type}: ${JSON.stringify(p.data)}`)
              .join('\n'),
          }
        );

        if (skillResult.success && skillResult.output) {
          answer = skillResult.output;
          skillUsed = skillMatch.skill.name;
        } else {
          // Fall back to regular ask
          const response = await askOlive({
            question,
            userId: user.id,
            conversationHistory: conversationHistory.map((msg, i) => ({
              role: i % 2 === 0 ? 'user' : 'assistant',
              content: msg,
              timestamp: new Date(),
            })),
            memoryContext,
          } as AskOliveRequest);
          answer = response.answer;
        }
      } else {
        // Regular ask with memory context
        const response = await askOlive({
          question,
          userId: user.id,
          conversationHistory: conversationHistory.map((msg, i) => ({
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: msg,
            timestamp: new Date(),
          })),
          memoryContext,
        } as AskOliveRequest);
        answer = response.answer;
      }

      // Create optimized context for stats
      const { stats, wasCompacted, shouldFlush } = createOptimizedContext(
        memoryContext,
        conversationHistory,
        question
      );

      // Auto-flush if needed
      if (shouldFlush && conversationHistory.length > 5) {
        await memory.flushContext(conversationHistory.join('\n'));
      }

      return {
        answer,
        skillUsed,
        shouldFlushContext: shouldFlush,
        contextStats: {
          tokensUsed: stats.totalTokens,
          percentUsed: stats.usagePercent,
          wasCompacted,
        },
      };
    },
    [user?.id, memory, skills]
  );

  /**
   * Process brain dump with memory context
   */
  const processBrainDumpWithContext = useCallback(
    async (input: Omit<BrainDumpInput, 'userId' | 'coupleId' | 'memoryContext'>): Promise<ProcessedBrainDump> => {
      if (!user?.id) {
        return {
          type: 'note',
          content: input.text,
          category: 'general',
        };
      }

      const memoryContext = memory.context || await memory.getContext();

      return processBrainDump({
        ...input,
        userId: user.id,
        memoryContext,
      } as BrainDumpInput);
    },
    [user?.id, memory]
  );

  /**
   * Search with memory included
   */
  const searchWithMemory = useCallback(
    async (query: string): Promise<SearchResult[]> => {
      return search.searchAll(query, { includeMemory: true });
    },
    [search]
  );

  /**
   * Update user profile in memory
   */
  const updateProfile = useCallback(
    async (content: string): Promise<void> => {
      await memory.writeFile('profile', content);
    },
    [memory]
  );

  /**
   * Flush conversation to memory
   */
  const flushConversationToMemory = useCallback(
    async (conversation: string[]): Promise<void> => {
      if (conversation.length === 0) return;
      await memory.flushContext(conversation.join('\n'));
    },
    [memory]
  );

  return {
    // Loading states
    isLoading,
    isMemoryLoading: memory.isLoading,
    isSearching: search.isSearching,

    // Memory
    memoryContext: memory.context,
    refreshMemory: memory.refreshContext,
    updateProfile,
    appendToDaily: async (content: string, source?: string) => { await memory.appendToDaily(content, source); },

    // AI Interaction
    ask,
    processBrainDump: processBrainDumpWithContext,

    // Search
    search: search.search,
    searchWithMemory,

    // Skills
    matchSkill: skills.matchSkill,
    executeSkill: skills.executeSkill,
    installedSkills: skills.installedSkills,

    // Proactive
    preferences: heartbeat.preferences,
    updatePreferences: heartbeat.updatePreferences,
    requestBriefing: heartbeat.requestBriefing,

    // WhatsApp
    sendWhatsAppMessage: gateway.sendMessage,

    // Utilities
    estimateTokens,
    flushConversationToMemory,
  };
}

export default useOlive;

// Re-export types and sub-hooks for convenience
export { useOliveMemory } from './useOliveMemory';
export { useWhatsAppGateway } from './useWhatsAppGateway';
export { useOliveHeartbeat } from './useOliveHeartbeat';
export { useOliveSkills } from './useOliveSkills';
export { useOliveSearch } from './useOliveSearch';

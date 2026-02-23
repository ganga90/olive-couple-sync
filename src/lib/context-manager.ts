/**
 * Olive Context Manager
 *
 * Manages AI context windows with intelligent optimization:
 * - Token counting and monitoring
 * - Context compaction when approaching limits
 * - Memory flush triggers
 * - Priority-based content selection
 *
 * Inspired by Moltbot's context management approach.
 */

import { MemoryContext } from '@/types/memory';

// Token estimation constants
const CHARS_PER_TOKEN = 4;  // Rough approximation
const MAX_CONTEXT_TOKENS = 8000;  // Gemini context limit estimate
const FLUSH_THRESHOLD = 0.75;  // Flush at 75% capacity
const COMPACT_THRESHOLD = 0.85;  // Compact at 85% capacity

interface ContextSection {
  name: string;
  content: string;
  priority: number;  // 1-10, higher = keep longer
  compressible: boolean;
  minLength?: number;  // Minimum length after compression
}

interface ContextWindow {
  sections: ContextSection[];
  totalTokens: number;
  maxTokens: number;
}

interface CompactionResult {
  compacted: boolean;
  removedSections: string[];
  compressedSections: string[];
  tokensSaved: number;
}

/**
 * Estimate token count for a string
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Create a context window from memory context
 */
export function createContextWindow(
  memoryContext: MemoryContext | null,
  conversationHistory: string[] = [],
  additionalContext?: string
): ContextWindow {
  const sections: ContextSection[] = [];

  // System prompt section (highest priority, non-compressible)
  sections.push({
    name: 'system_prompt',
    content: getSystemPrompt(),
    priority: 10,
    compressible: false,
  });

  // User profile (high priority)
  if (memoryContext?.profile) {
    sections.push({
      name: 'profile',
      content: `## User Profile\n${memoryContext.profile}`,
      priority: 8,
      compressible: true,
      minLength: 200,
    });
  }

  // Today's activity (medium-high priority)
  if (memoryContext?.today_log) {
    sections.push({
      name: 'today_log',
      content: `## Today's Activity\n${memoryContext.today_log}`,
      priority: 7,
      compressible: true,
      minLength: 100,
    });
  }

  // Yesterday's activity (medium priority, most compressible)
  if (memoryContext?.yesterday_log) {
    sections.push({
      name: 'yesterday_log',
      content: `## Yesterday's Activity\n${memoryContext.yesterday_log}`,
      priority: 5,
      compressible: true,
      minLength: 50,
    });
  }

  // Patterns (medium-high priority)
  if (memoryContext?.patterns && memoryContext.patterns.length > 0) {
    const patternContent = memoryContext.patterns
      .filter((p) => p.confidence > 0.5)
      .map((p) => `- ${p.type}: ${JSON.stringify(p.data)} (confidence: ${p.confidence})`)
      .join('\n');

    if (patternContent) {
      sections.push({
        name: 'patterns',
        content: `## Observed Patterns\n${patternContent}`,
        priority: 6,
        compressible: true,
        minLength: 50,
      });
    }
  }

  // Conversation history (high priority for recent, lower for older)
  if (conversationHistory.length > 0) {
    // Split history into recent (high priority) and older (lower priority)
    const recentHistory = conversationHistory.slice(-5);
    const olderHistory = conversationHistory.slice(0, -5);

    if (recentHistory.length > 0) {
      sections.push({
        name: 'recent_conversation',
        content: `## Recent Conversation\n${recentHistory.join('\n')}`,
        priority: 9,
        compressible: false,
      });
    }

    if (olderHistory.length > 0) {
      sections.push({
        name: 'older_conversation',
        content: `## Earlier Context\n${olderHistory.join('\n')}`,
        priority: 4,
        compressible: true,
        minLength: 100,
      });
    }
  }

  // Additional context (varies)
  if (additionalContext) {
    sections.push({
      name: 'additional',
      content: additionalContext,
      priority: 6,
      compressible: true,
      minLength: 50,
    });
  }

  // Calculate total tokens
  const totalTokens = sections.reduce(
    (sum, section) => sum + estimateTokens(section.content),
    0
  );

  return {
    sections,
    totalTokens,
    maxTokens: MAX_CONTEXT_TOKENS,
  };
}

/**
 * Get the base system prompt
 */
function getSystemPrompt(): string {
  return `You are Olive, a helpful AI assistant for couples. You help partners stay organized, connected, and on top of their daily lives together.

## Your Capabilities
- Task and note management
- Calendar and scheduling help
- Shopping list organization
- Reminder management
- Thoughtful relationship advice
- Pattern recognition and proactive suggestions

## Response Guidelines
- Be warm, supportive, and practical
- Keep responses concise but helpful
- Reference user's patterns and preferences when relevant
- Suggest actions when appropriate
- Use emojis sparingly for warmth`;
}

/**
 * Check if context needs compaction
 */
export function needsCompaction(window: ContextWindow): boolean {
  return window.totalTokens / window.maxTokens >= COMPACT_THRESHOLD;
}

/**
 * Check if context should trigger a memory flush
 */
export function shouldFlushMemory(window: ContextWindow): boolean {
  return window.totalTokens / window.maxTokens >= FLUSH_THRESHOLD;
}

/**
 * Compact context window by removing/compressing low-priority sections
 */
export function compactContext(window: ContextWindow): {
  window: ContextWindow;
  result: CompactionResult;
} {
  const result: CompactionResult = {
    compacted: false,
    removedSections: [],
    compressedSections: [],
    tokensSaved: 0,
  };

  if (!needsCompaction(window)) {
    return { window, result };
  }

  // Sort sections by priority (lowest first for removal/compression)
  const sortedSections = [...window.sections].sort((a, b) => a.priority - b.priority);

  let currentTokens = window.totalTokens;
  const targetTokens = window.maxTokens * 0.7; // Aim for 70% capacity after compaction

  const newSections: ContextSection[] = [];

  for (const section of sortedSections) {
    if (currentTokens <= targetTokens) {
      // We're under target, keep remaining sections as-is
      newSections.push(section);
      continue;
    }

    const sectionTokens = estimateTokens(section.content);

    // Try compression first
    if (section.compressible && section.minLength) {
      const compressed = compressSection(section);
      const compressedTokens = estimateTokens(compressed.content);
      const saved = sectionTokens - compressedTokens;

      if (saved > 0) {
        newSections.push(compressed);
        currentTokens -= saved;
        result.compressedSections.push(section.name);
        result.tokensSaved += saved;
        result.compacted = true;
        continue;
      }
    }

    // Remove section if compression wasn't enough
    if (section.priority < 6) {
      // Don't remove high-priority sections
      result.removedSections.push(section.name);
      result.tokensSaved += sectionTokens;
      currentTokens -= sectionTokens;
      result.compacted = true;
    } else {
      newSections.push(section);
    }
  }

  // Re-sort by priority (highest first for proper ordering)
  newSections.sort((a, b) => b.priority - a.priority);

  return {
    window: {
      sections: newSections,
      totalTokens: currentTokens,
      maxTokens: window.maxTokens,
    },
    result,
  };
}

/**
 * Compress a section to its minimum length
 */
function compressSection(section: ContextSection): ContextSection {
  if (!section.compressible || !section.minLength) {
    return section;
  }

  const content = section.content;
  const targetLength = section.minLength * CHARS_PER_TOKEN;

  if (content.length <= targetLength) {
    return section;
  }

  // Extract key information based on section type
  let compressed: string;

  switch (section.name) {
    case 'yesterday_log':
      // Keep only first few lines
      compressed = content.split('\n').slice(0, 3).join('\n') + '\n...';
      break;

    case 'older_conversation':
      // Summarize older conversation
      const messages = content.split('\n').filter((l) => l.trim());
      compressed = `[${messages.length} earlier messages summarized]`;
      break;

    case 'patterns':
      // Keep only high-confidence patterns
      const lines = content.split('\n');
      const header = lines[0];
      const patterns = lines.slice(1).filter((l) => l.includes('confidence: 0.'));
      const highConfidence = patterns.filter((l) => {
        const match = l.match(/confidence: (0\.\d+)/);
        return match && parseFloat(match[1]) > 0.6;
      });
      compressed = [header, ...highConfidence.slice(0, 3)].join('\n');
      break;

    default:
      // Generic compression: keep first N characters
      compressed = content.substring(0, targetLength) + '...';
  }

  return {
    ...section,
    content: compressed,
  };
}

/**
 * Build final prompt from context window
 */
export function buildPromptFromWindow(
  window: ContextWindow,
  userMessage: string
): string {
  // Sort sections by a logical order
  const orderedSections = [...window.sections].sort((a, b) => {
    // Define section order
    const order: Record<string, number> = {
      system_prompt: 1,
      profile: 2,
      patterns: 3,
      yesterday_log: 4,
      today_log: 5,
      older_conversation: 6,
      recent_conversation: 7,
      additional: 8,
    };
    return (order[a.name] || 99) - (order[b.name] || 99);
  });

  const contextParts = orderedSections.map((s) => s.content);
  contextParts.push(`\n## User Message\n${userMessage}`);

  return contextParts.join('\n\n');
}

/**
 * Get context window statistics
 */
export function getWindowStats(window: ContextWindow): {
  totalTokens: number;
  maxTokens: number;
  usagePercent: number;
  needsCompaction: boolean;
  shouldFlush: boolean;
  sectionBreakdown: Array<{ name: string; tokens: number; percent: number }>;
} {
  const usagePercent = (window.totalTokens / window.maxTokens) * 100;

  const sectionBreakdown = window.sections.map((s) => {
    const tokens = estimateTokens(s.content);
    return {
      name: s.name,
      tokens,
      percent: (tokens / window.totalTokens) * 100,
    };
  });

  return {
    totalTokens: window.totalTokens,
    maxTokens: window.maxTokens,
    usagePercent,
    needsCompaction: needsCompaction(window),
    shouldFlush: shouldFlushMemory(window),
    sectionBreakdown,
  };
}

/**
 * Create an optimized context for AI calls
 */
export function createOptimizedContext(
  memoryContext: MemoryContext | null,
  conversationHistory: string[] = [],
  userMessage: string,
  additionalContext?: string
): {
  prompt: string;
  stats: ReturnType<typeof getWindowStats>;
  wasCompacted: boolean;
  shouldFlush: boolean;
} {
  // Create initial window
  let window = createContextWindow(
    memoryContext,
    conversationHistory,
    additionalContext
  );

  let wasCompacted = false;

  // Compact if needed
  if (needsCompaction(window)) {
    const { window: compactedWindow, result } = compactContext(window);
    window = compactedWindow;
    wasCompacted = result.compacted;

    if (wasCompacted) {
      console.log('[ContextManager] Compacted:', {
        removed: result.removedSections,
        compressed: result.compressedSections,
        tokensSaved: result.tokensSaved,
      });
    }
  }

  // Build final prompt
  const prompt = buildPromptFromWindow(window, userMessage);

  // Get stats
  const stats = getWindowStats(window);

  return {
    prompt,
    stats,
    wasCompacted,
    shouldFlush: stats.shouldFlush,
  };
}

export default {
  estimateTokens,
  createContextWindow,
  needsCompaction,
  shouldFlushMemory,
  compactContext,
  buildPromptFromWindow,
  getWindowStats,
  createOptimizedContext,
};

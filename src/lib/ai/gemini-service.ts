/**
 * Gemini AI Service for Olive
 * Handles brain dump processing and Ask Olive assistant
 * Integrates with Olive Memory System for persistent context
 * 
 * Note: All AI operations are routed through Supabase edge functions
 * using the Lovable AI Gateway. No direct API calls are made from the client.
 */

import { supabase } from '@/lib/supabaseClient';
import type { MemoryContext, PatternType, ExtractedFact, DetectedPattern } from '@/types/memory';

export interface BrainDumpInput {
  text: string;
  source: 'voice' | 'text' | 'whatsapp';
  userId: string;
  coupleId?: string;
  context?: string;
  memoryContext?: MemoryContext;
}

export interface ProcessedBrainDump {
  type: 'note' | 'task' | 'event' | 'reminder' | 'question';
  title?: string;
  content: string;
  category?: string;
  priority?: 'low' | 'medium' | 'high';
  dueDate?: Date;
  isPrivate?: boolean;
  extractedData?: {
    date?: string;
    time?: string;
    location?: string;
    people?: string[];
    amount?: number;
  };
  suggestedAction?: string;
}

export interface AskOliveRequest {
  question: string;
  userId: string;
  coupleId?: string;
  conversationHistory?: ConversationMessage[];
  memoryContext?: MemoryContext;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface AskOliveResponse {
  answer: string;
  suggestions?: string[];
  relatedData?: any[];
}

/**
 * GeminiAIService - Wrapper for AI operations
 * 
 * This class provides a consistent interface for AI operations.
 * All AI calls go through edge functions using the Lovable AI Gateway.
 */
export class GeminiAIService {
  private initialized = false;

  constructor() {
    this.initialized = true;
    console.log('[GeminiAIService] Initialized (operations routed to edge functions)');
  }

  /**
   * Process brain dump input via edge function
   * Determines what type of item it is and extracts relevant data
   */
  async processBrainDump(input: BrainDumpInput): Promise<ProcessedBrainDump> {
    console.log('[Gemini] Processing brain dump via edge function:', input.text);

    try {
      const { data, error } = await supabase.functions.invoke('process-note', {
        body: {
          text: input.text,
          source: input.source,
          userId: input.userId,
          coupleId: input.coupleId,
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      // Map edge function response to ProcessedBrainDump format
      if (data && data.notes && data.notes.length > 0) {
        const note = data.notes[0];
        return {
          type: 'task',
          title: note.summary,
          content: note.summary,
          category: note.category,
          priority: note.priority,
          dueDate: note.due_date ? new Date(note.due_date) : undefined,
        };
      }

      return {
        type: 'note',
        content: input.text,
        category: 'general',
      };
    } catch (error) {
      console.error('[Gemini] Brain dump processing failed:', error);

      // Fallback: treat as simple note
      return {
        type: 'note',
        content: input.text,
        category: 'general',
      };
    }
  }

  /**
   * Ask Olive - conversational AI assistant via edge function
   */
  async askOlive(request: AskOliveRequest): Promise<AskOliveResponse> {
    console.log('[Gemini] Ask Olive via edge function:', request.question);

    try {
      const { data, error } = await supabase.functions.invoke('ask-olive', {
        body: {
          userMessage: request.question,
          noteContent: request.conversationHistory?.map(m => m.content).join('\n') || '',
          noteCategory: 'general',
          user_id: request.userId,
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      return {
        answer: data.reply || 'I couldn\'t process your request.',
        suggestions: this.extractSuggestions(data.reply || ''),
      };
    } catch (error) {
      console.error('[Gemini] Ask Olive failed:', error);
      return {
        answer: 'I\'m having trouble processing your request right now. Please try again.',
        suggestions: [],
      };
    }
  }

  /**
   * Build memory context section for prompts (utility method)
   */
  buildMemorySection(memoryContext?: MemoryContext): string {
    if (!memoryContext) {
      return '';
    }

    let section = '## User Memory Context\n';

    // Add profile information
    if (memoryContext.profile) {
      section += `### Profile\n${memoryContext.profile}\n\n`;
    }

    // Add today's activity
    if (memoryContext.today_log) {
      section += `### Today's Activity\n${memoryContext.today_log}\n\n`;
    }

    // Add yesterday's context for continuity
    if (memoryContext.yesterday_log) {
      section += `### Yesterday's Activity\n${memoryContext.yesterday_log}\n\n`;
    }

    // Add behavioral patterns
    if (memoryContext.patterns && memoryContext.patterns.length > 0) {
      section += `### Observed Patterns\n`;
      for (const pattern of memoryContext.patterns) {
        const patternDescription = this.describePattern(pattern.type, pattern.data, pattern.confidence);
        if (patternDescription) {
          section += `- ${patternDescription}\n`;
        }
      }
      section += '\n';
    }

    return section;
  }

  /**
   * Convert pattern data to human-readable description
   */
  describePattern(
    type: PatternType,
    data: Record<string, any>,
    confidence: number
  ): string | null {
    const confidenceStr = confidence > 0.8 ? '(strong)' : confidence > 0.5 ? '(moderate)' : '(weak)';

    switch (type) {
      case 'grocery_day':
        return `Typically shops for groceries on ${data.preferredDay || 'weekends'} ${confidenceStr}`;
      case 'reminder_preference':
        return `Prefers reminders ${data.timing || 'in advance'} ${confidenceStr}`;
      case 'task_assignment':
        return `Usually handles ${data.categories?.join(', ') || 'various'} tasks ${confidenceStr}`;
      case 'communication_style':
        return `Communication style: ${data.style || 'direct'} ${confidenceStr}`;
      case 'schedule_preference':
        return `Most productive during ${data.preferredTime || 'morning'} ${confidenceStr}`;
      case 'completion_time':
        return `Typically completes tasks in ${data.averageTime || 'variable'} time ${confidenceStr}`;
      case 'shopping_frequency':
        return `Shopping frequency: ${data.frequency || 'weekly'} ${confidenceStr}`;
      default:
        return null;
    }
  }

  /**
   * Extract actionable suggestions from response
   */
  private extractSuggestions(response: string): string[] {
    const suggestions: string[] = [];

    // Look for bullet points or numbered lists
    const bulletPattern = /^[•\-\*]\s+(.+)$/gm;
    const matches = response.matchAll(bulletPattern);

    for (const match of matches) {
      suggestions.push(match[1].trim());
    }

    return suggestions.slice(0, 3); // Max 3 suggestions
  }

  /**
   * Analyze note and suggest organization via edge function
   */
  async suggestOrganization(noteContent: string, userId: string): Promise<{
    suggestedList?: string;
    suggestedTags?: string[];
    suggestedDueDate?: Date;
    reasoning?: string;
  }> {
    try {
      const { data, error } = await supabase.functions.invoke('analyze-organization', {
        body: {
          scope: 'all',
          text: noteContent,
        },
      });

      if (error) {
        console.error('[Gemini] Organization suggestion failed:', error);
        return {};
      }

      return {
        suggestedList: data?.target_list,
        suggestedTags: data?.suggested_tags || [],
        reasoning: data?.reasoning,
      };
    } catch (error) {
      console.error('[Gemini] Organization suggestion failed:', error);
      return {};
    }
  }

  /**
   * Check for conflicts in calendar (local implementation)
   */
  async checkEventConflicts(
    newEvent: { date: Date; title: string },
    existingEvents: Array<{ date: Date; title: string }>
  ): Promise<{
    hasConflict: boolean;
    conflictingEvents?: Array<{ date: Date; title: string }>;
    suggestion?: string;
  }> {
    // Simple local conflict check - no AI needed
    const newEventDate = newEvent.date.toDateString();
    const conflicting = existingEvents.filter(
      e => e.date.toDateString() === newEventDate
    );

    return {
      hasConflict: conflicting.length > 0,
      conflictingEvents: conflicting.length > 0 ? conflicting : undefined,
      suggestion: conflicting.length > 0
        ? `There are ${conflicting.length} events on the same day. Consider a different time.`
        : undefined,
    };
  }

  /**
   * Extract facts from a conversation for memory storage
   * Uses olive-memory edge function
   */
  async extractFactsFromConversation(conversation: string): Promise<ExtractedFact[]> {
    try {
      const { data, error } = await supabase.functions.invoke('olive-memory', {
        body: {
          action: 'flush_context',
          conversation,
          source: 'conversation',
        },
      });

      if (error) {
        console.error('[Gemini] Fact extraction failed:', error);
        return [];
      }

      return data.facts || [];
    } catch (error) {
      console.error('[Gemini] Fact extraction failed:', error);
      return [];
    }
  }

  /**
   * Generate a summary of recent activity for daily log
   */
  async summarizeActivity(activities: string[]): Promise<string> {
    if (activities.length === 0) {
      return '';
    }

    // Simple local summary
    return activities.slice(0, 5).join('; ');
  }

  /**
   * Detect patterns from historical data
   * Uses olive-memory edge function
   */
  async detectPatterns(data: {
    activities: string[];
    tasks: Array<{ title: string; completedAt?: Date; category?: string }>;
    interactions: Array<{ type: string; timestamp: Date }>;
  }): Promise<DetectedPattern[]> {
    try {
      const { data: result, error } = await supabase.functions.invoke('olive-memory', {
        body: {
          action: 'get_patterns',
          min_confidence: 0.3,
        },
      });

      if (error) {
        console.error('[Gemini] Pattern detection failed:', error);
        return [];
      }

      return result.patterns || [];
    } catch (error) {
      console.error('[Gemini] Pattern detection failed:', error);
      return [];
    }
  }
}

// Re-export types for convenience
export type { ExtractedFact, DetectedPattern, MemoryContext } from '@/types/memory';

// Export singleton instance
export const geminiService = new GeminiAIService();

// Convenience functions
export const processBrainDump = (input: BrainDumpInput) => geminiService.processBrainDump(input);
export const askOlive = (request: AskOliveRequest) => geminiService.askOlive(request);
export const suggestOrganization = (content: string, userId: string) =>
  geminiService.suggestOrganization(content, userId);
export const checkEventConflicts = (
  newEvent: { date: Date; title: string },
  existingEvents: Array<{ date: Date; title: string }>
) => geminiService.checkEventConflicts(newEvent, existingEvents);
export const extractFacts = (conversation: string) =>
  geminiService.extractFactsFromConversation(conversation);
export const summarizeActivity = (activities: string[]) =>
  geminiService.summarizeActivity(activities);
export const detectPatterns = (data: Parameters<typeof geminiService.detectPatterns>[0]) =>
  geminiService.detectPatterns(data);

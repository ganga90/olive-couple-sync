/**
 * Gemini AI Service for Olive
 * Handles brain dump processing and Ask Olive assistant
 * Integrates with Olive Memory System for persistent context
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
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

export class GeminiAIService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('[Gemini] API key not found - AI features will not work');
    }

    this.genAI = new GoogleGenerativeAI(apiKey || '');
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });
  }

  /**
   * Process brain dump input with Gemini
   * Determines what type of item it is and extracts relevant data
   */
  async processBrainDump(input: BrainDumpInput): Promise<ProcessedBrainDump> {
    console.log('[Gemini] Processing brain dump:', input.text);

    const prompt = this.buildBrainDumpPrompt(input);

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Parse the JSON response from Gemini
      const parsed = this.parseBrainDumpResponse(text);

      console.log('[Gemini] Brain dump processed:', parsed.type);

      return parsed;
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
   * Build prompt for brain dump processing
   * Uses memory context for better categorization and personalization
   */
  private buildBrainDumpPrompt(input: BrainDumpInput): string {
    // Build memory context for smarter categorization
    const memorySection = this.buildMemorySection(input.memoryContext);

    return `You are Olive, an AI assistant for couples. Analyze the following input and determine what it is.

${memorySection}
## Input to Process
Text: "${input.text}"
Source: ${input.source}
${input.context ? `Additional context: ${input.context}` : ''}

## Classification Rules
Classify this input as one of:
- note: A thought, memory, or piece of information to remember
- task: Something that needs to be done
- event: A calendar event or appointment
- reminder: A one-time or recurring reminder
- question: A question for the AI assistant

## Extraction Guidelines
Extract relevant information:
- If it's a task: extract due date, priority, category
- If it's an event: extract date, time, location, attendees
- If it's a reminder: extract when to remind
- If it contains money: extract amount
- If it mentions people: extract names
- Determine if it's private or should be shared with partner
- Use the user's patterns (if available) to inform categorization and priority

Respond ONLY with valid JSON in this format:
{
  "type": "note|task|event|reminder|question",
  "title": "short title (optional)",
  "content": "cleaned up content",
  "category": "general|shopping|health|work|home|etc",
  "priority": "low|medium|high (for tasks)",
  "dueDate": "ISO date string (if applicable)",
  "isPrivate": boolean (true if personal/sensitive),
  "extractedData": {
    "date": "extracted date",
    "time": "extracted time",
    "location": "extracted location",
    "people": ["person1", "person2"],
    "amount": number
  },
  "suggestedAction": "what the user should do next"
}`;
  }

  /**
   * Parse Gemini response for brain dump
   */
  private parseBrainDumpResponse(responseText: string): ProcessedBrainDump {
    try {
      // Extract JSON from response (Gemini sometimes wraps it in markdown)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        type: parsed.type || 'note',
        title: parsed.title,
        content: parsed.content,
        category: parsed.category,
        priority: parsed.priority,
        dueDate: parsed.dueDate ? new Date(parsed.dueDate) : undefined,
        isPrivate: parsed.isPrivate ?? false,
        extractedData: parsed.extractedData,
        suggestedAction: parsed.suggestedAction,
      };
    } catch (error) {
      console.error('[Gemini] Failed to parse response:', error);
      throw error;
    }
  }

  /**
   * Ask Olive - conversational AI assistant
   */
  async askOlive(request: AskOliveRequest): Promise<AskOliveResponse> {
    console.log('[Gemini] Ask Olive:', request.question);

    const prompt = this.buildAskOlivePrompt(request);

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      console.log('[Gemini] Ask Olive response generated');

      return {
        answer: text,
        suggestions: this.extractSuggestions(text),
      };
    } catch (error) {
      console.error('[Gemini] Ask Olive failed:', error);
      throw error;
    }
  }

  /**
   * Build prompt for Ask Olive
   * Includes memory context for personalized responses
   */
  private buildAskOlivePrompt(request: AskOliveRequest): string {
    const historyContext = request.conversationHistory
      ?.map((msg) => `${msg.role === 'user' ? 'User' : 'Olive'}: ${msg.content}`)
      .join('\n');

    // Build memory context section
    const memorySection = this.buildMemorySection(request.memoryContext);

    return `You are Olive, a helpful AI assistant for couples. You help partners stay organized and connected.

${memorySection}
${historyContext ? `## Recent Conversation\n${historyContext}\n\n` : ''}
## Current Request
User question: ${request.question}

## Response Guidelines
Provide a helpful, concise answer. If the question relates to:
- Tasks: Suggest how to organize or prioritize
- Calendar: Help schedule or find conflicts
- Notes: Suggest categories or organization
- Relationship: Give thoughtful, supportive advice
- General: Answer directly and helpfully

Be warm, supportive, and practical. Keep responses under 150 words unless more detail is needed.
Use your knowledge of the user from the memory context to personalize your response.
Reference specific patterns or past interactions when relevant.`;
  }

  /**
   * Build memory context section for prompts
   */
  private buildMemorySection(memoryContext?: MemoryContext): string {
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
  private describePattern(
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
   * Analyze note and suggest organization
   */
  async suggestOrganization(noteContent: string, userId: string): Promise<{
    suggestedList?: string;
    suggestedTags?: string[];
    suggestedDueDate?: Date;
    reasoning?: string;
  }> {
    const prompt = `Analyze this note and suggest how to organize it:

"${noteContent}"

Suggest:
1. Which list it should go in (Shopping, Work, Home, Health, etc.)
2. Relevant tags
3. Due date if applicable
4. Brief reasoning

Respond in JSON format:
{
  "suggestedList": "list name",
  "suggestedTags": ["tag1", "tag2"],
  "suggestedDueDate": "ISO date string or null",
  "reasoning": "why these suggestions"
}`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          suggestedList: parsed.suggestedList,
          suggestedTags: parsed.suggestedTags,
          suggestedDueDate: parsed.suggestedDueDate ? new Date(parsed.suggestedDueDate) : undefined,
          reasoning: parsed.reasoning,
        };
      }
    } catch (error) {
      console.error('[Gemini] Organization suggestion failed:', error);
    }

    return {};
  }

  /**
   * Check for conflicts in calendar
   */
  async checkEventConflicts(
    newEvent: { date: Date; title: string },
    existingEvents: Array<{ date: Date; title: string }>
  ): Promise<{
    hasConflict: boolean;
    conflictingEvents?: Array<{ date: Date; title: string }>;
    suggestion?: string;
  }> {
    const prompt = `Check for conflicts:

New event: ${newEvent.title} on ${newEvent.date.toISOString()}

Existing events:
${existingEvents.map((e) => `- ${e.title} on ${e.date.toISOString()}`).join('\n')}

Are there any conflicts? Suggest alternative times if needed.

Respond in JSON:
{
  "hasConflict": boolean,
  "conflictingEvents": [indexes of conflicting events],
  "suggestion": "alternative times or resolution"
}`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          hasConflict: parsed.hasConflict,
          conflictingEvents: parsed.conflictingEvents?.map((i: number) => existingEvents[i]),
          suggestion: parsed.suggestion,
        };
      }
    } catch (error) {
      console.error('[Gemini] Conflict check failed:', error);
    }

    return { hasConflict: false };
  }

  /**
   * Extract facts from a conversation for memory storage
   * Used during context flush operations
   */
  async extractFactsFromConversation(conversation: string): Promise<ExtractedFact[]> {
    const prompt = `Analyze this conversation and extract important facts about the user(s) that should be remembered for future interactions.

## Conversation
${conversation}

## Extraction Guidelines
Extract facts that are:
- Personal preferences (food, activities, schedules)
- Important dates (birthdays, anniversaries, appointments)
- Relationships and people mentioned
- Work-related information
- Health information
- Household information
- Recurring patterns or habits
- Decisions made

Do NOT extract:
- Trivial conversation filler
- Temporary states ("I'm hungry right now")
- Information already known from context

Respond ONLY with valid JSON in this format:
{
  "facts": [
    {
      "content": "the fact to remember",
      "type": "preference|date|relationship|work|health|household|pattern|decision",
      "importance": 1-5 (5 being most important),
      "entities": ["person", "place", or other entities mentioned"]
    }
  ]
}`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.facts || [];
      }
    } catch (error) {
      console.error('[Gemini] Fact extraction failed:', error);
    }

    return [];
  }

  /**
   * Generate a summary of recent activity for daily log
   */
  async summarizeActivity(activities: string[]): Promise<string> {
    if (activities.length === 0) {
      return '';
    }

    const prompt = `Summarize these activities into a concise daily log entry:

Activities:
${activities.map((a, i) => `${i + 1}. ${a}`).join('\n')}

Create a brief, natural summary (2-4 sentences) that captures the key activities and any patterns observed. Focus on what was accomplished and any notable items.`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('[Gemini] Activity summary failed:', error);
      return activities.join('; ');
    }
  }

  /**
   * Detect patterns from historical data
   */
  async detectPatterns(data: {
    activities: string[];
    tasks: Array<{ title: string; completedAt?: Date; category?: string }>;
    interactions: Array<{ type: string; timestamp: Date }>;
  }): Promise<DetectedPattern[]> {
    const prompt = `Analyze this user data and identify behavioral patterns:

## Recent Activities
${data.activities.slice(0, 20).join('\n')}

## Task History
${data.tasks.slice(0, 30).map(t => `- ${t.title} (${t.category || 'general'})${t.completedAt ? ' ✓' : ''}`).join('\n')}

## Interaction Types
${data.interactions.slice(0, 50).map(i => `- ${i.type} at ${i.timestamp}`).join('\n')}

## Pattern Detection Guidelines
Look for:
- Time-of-day preferences
- Day-of-week patterns
- Category preferences
- Completion patterns
- Communication patterns

Respond ONLY with valid JSON:
{
  "patterns": [
    {
      "type": "grocery_day|reminder_preference|task_assignment|communication_style|schedule_preference|completion_time|shopping_frequency",
      "data": { "key observation data" },
      "confidence": 0.0-1.0,
      "evidence": "brief explanation"
    }
  ]
}`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.patterns || [];
      }
    } catch (error) {
      console.error('[Gemini] Pattern detection failed:', error);
    }

    return [];
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

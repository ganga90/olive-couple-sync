/**
 * Olive Memory System Types
 *
 * Centralized type definitions for the memory system to avoid circular dependencies.
 */

// Memory file types
export type MemoryFileType = 'profile' | 'daily' | 'patterns' | 'relationship' | 'household';

// Memory chunk types
export type ChunkType = 'fact' | 'event' | 'decision' | 'pattern' | 'interaction';

// Pattern types that the system can detect and track
export type PatternType =
  | 'grocery_day'
  | 'reminder_preference'
  | 'task_assignment'
  | 'communication_style'
  | 'schedule_preference'
  | 'category_usage'
  | 'completion_time'
  | 'response_pattern'
  | 'partner_coordination'
  | 'shopping_frequency';

// Memory file structure
export interface MemoryFile {
  id: string;
  user_id: string;
  couple_id?: string;
  file_type: MemoryFileType;
  file_date?: string;
  content: string;
  token_count: number;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

// Memory chunk with embedding support
export interface MemoryChunk {
  id: string;
  memory_file_id: string;
  user_id: string;
  chunk_index: number;
  content: string;
  chunk_type: ChunkType;
  importance: number;
  source: string;
  metadata: Record<string, any>;
  created_at: string;
}

// Behavioral pattern
export interface Pattern {
  id: string;
  user_id: string;
  couple_id?: string;
  pattern_type: PatternType;
  pattern_data: Record<string, any>;
  confidence: number;
  sample_count: number;
  is_active: boolean;
  last_triggered?: string;
  created_at: string;
  updated_at: string;
}

// Memory context provided to AI
export interface MemoryContext {
  profile: string;
  today_log: string;
  yesterday_log: string;
  patterns: Array<{
    type: PatternType;
    data: Record<string, any>;
    confidence: number;
  }>;
}

// User preferences for memory and proactive features
export interface UserPreferences {
  user_id: string;
  proactive_enabled: boolean;
  max_daily_messages: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
  morning_briefing_enabled: boolean;
  morning_briefing_time: string;
  evening_review_enabled: boolean;
  evening_review_time: string;
  weekly_summary_enabled: boolean;
  weekly_summary_day: number;
  weekly_summary_time: string;
  memory_auto_extract: boolean;
  memory_retention_days: number;
  daily_log_enabled: boolean;
  partner_sync_enabled: boolean;
  reminder_advance_minutes: number;
  overdue_nudge_enabled: boolean;
  pattern_suggestions_enabled: boolean;
}

// Extracted fact from conversation
export interface ExtractedFact {
  content: string;
  type: 'preference' | 'date' | 'relationship' | 'work' | 'health' | 'household' | 'pattern' | 'decision';
  importance: number;
  entities: string[];
}

// Detected behavioral pattern
export interface DetectedPattern {
  type: PatternType;
  data: Record<string, any>;
  confidence: number;
  evidence: string;
}

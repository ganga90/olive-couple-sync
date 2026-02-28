/**
 * Shared Types for Omni-Channel Orchestration
 * =============================================
 * Universal input/output types that all message sources normalize into.
 */

/**
 * Standardized inbound message from any channel.
 * WhatsApp webhook, in-app chat, and future channels (SMS, Slack)
 * all normalize their input into this format.
 */
export interface IInboundMessage {
  userId: string;
  source: "whatsapp" | "in_app_chat" | "api";
  messageType: "text" | "audio" | "image" | "video" | "document";
  rawText?: string;
  mediaUrl?: string;
  metadata?: Record<string, any>;
  coupleId?: string;
  partnerName?: string;
  userLang?: string;
}

/**
 * Context assembled from all data sources before LLM call.
 * This is the "state" that feeds into the AI brain.
 */
export interface SystemContext {
  // Core user data
  memories: Array<{ title: string; content: string; category: string; importance?: number }>;
  skills: Array<{ skill_id: string; name: string; content: string; category: string }>;
  patterns: Array<{ pattern_type: string; pattern_data: any; confidence: number }>;

  // Agent insights (last 48h of background agent results)
  agentInsights: string;

  // Conversation continuity
  recentConversation: Array<{ role: string; content: string }>;
  recentOutbound: Array<{ type: string; content: string; sent_at: string }>;

  // Task state
  taskAnalytics: {
    total_active: number;
    urgent: number;
    overdue: number;
    due_today: number;
    due_tomorrow: number;
    completion_rate: number;
    top_categories: string[];
    top_lists: string[];
  };
  urgentTaskNames: string[];
  overdueTaskNames: string[];
  todayTaskNames: string[];

  // Optional enrichment
  partnerContext?: string;
  ouraContext?: string;
  calendarContext?: string;
}

/**
 * Classification result from the intent router.
 */
export interface IntentClassification {
  intent: string;
  confidence: number;
  reasoning?: string;
  parameters?: Record<string, any>;
}

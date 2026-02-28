/**
 * Router Logger — Telemetry for Semantic Router
 * ==============================================
 * Logs every intent classification + model routing decision
 * to the `olive_router_log` table for analytics.
 *
 * All logging is non-blocking (fire-and-forget).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface RouterLogEntry {
  userId: string;
  source: "whatsapp" | "in_app_chat";
  rawText: string;
  classifiedIntent: string;
  confidence: number;
  chatType?: string;
  classificationModel: string;
  responseModel?: string;
  routeReason: string;
  classificationLatencyMs: number;
  totalLatencyMs: number;
}

/**
 * Log a router decision to olive_router_log (non-blocking).
 * Errors are silently caught — telemetry should never break user flows.
 */
export async function logRouterDecision(
  supabase: ReturnType<typeof createClient<any>>,
  entry: RouterLogEntry
): Promise<void> {
  try {
    await supabase.from("olive_router_log").insert({
      user_id: entry.userId,
      source: entry.source,
      raw_text: entry.rawText.substring(0, 200),
      classified_intent: entry.classifiedIntent,
      confidence: entry.confidence,
      chat_type: entry.chatType || null,
      classification_model: entry.classificationModel,
      response_model: entry.responseModel || null,
      route_reason: entry.routeReason,
      classification_latency_ms: entry.classificationLatencyMs,
      total_latency_ms: entry.totalLatencyMs,
    });
  } catch (err) {
    console.warn("[RouterLogger] Non-blocking log error:", err);
  }
}

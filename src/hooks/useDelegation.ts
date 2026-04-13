/**
 * useDelegation — Frontend hook for the Olive delegation system.
 *
 * Wraps the olive-delegate and olive-briefing edge functions
 * with typed interfaces and convenience methods.
 */

import { useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";

// ─── Types ────────────────────────────────────────────────────

export interface Delegation {
  id: string;
  space_id: string;
  note_id: string | null;
  title: string;
  description: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  delegated_by: string;
  delegated_to: string;
  suggested_by: string;
  status: "pending" | "accepted" | "snoozed" | "reassigned" | "declined" | "completed" | "cancelled";
  snoozed_until: string | null;
  reassigned_to: string | null;
  reassign_reason: string | null;
  response_note: string | null;
  responded_at: string | null;
  completed_at: string | null;
  reasoning: string | null;
  notified_via: string[];
  created_at: string;
  updated_at: string;
  // Enriched fields
  delegated_by_name?: string;
  delegated_to_name?: string;
  reassigned_to_name?: string;
}

export interface SmartRouteSuggestion {
  user_id: string;
  name: string;
  role: string;
  active_delegations: number;
  recent_completions: number;
  score: number;
}

export interface SmartRouteResult {
  suggestions: SmartRouteSuggestion[];
  top_suggestion: SmartRouteSuggestion | null;
  reasoning: string;
}

export interface NotifyTarget {
  user_id: string;
  name: string;
  reason: string;
  channel: string;
}

export interface BriefingSection {
  heading: string;
  items: Array<{ text: string; note_id?: string; priority?: string }>;
}

export interface Briefing {
  id: string;
  user_id: string;
  space_id: string | null;
  briefing_type: "daily" | "weekly" | "on_demand" | "delegation_summary";
  title: string;
  summary: string;
  sections: BriefingSection[];
  covers_from: string | null;
  covers_to: string | null;
  task_count: number;
  delegation_count: number;
  delivered_via: string[];
  read_at: string | null;
  created_at: string;
}

// ─── Hook ─────────────────────────────────────────────────────

export function useDelegation() {
  // ── Delegate edge function calls ──

  const invokeDelegate = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("olive-delegate", { body });
    if (error) {
      console.error("olive-delegate error:", error);
      return { error: error.message };
    }
    return data;
  }, []);

  const invokeBriefing = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("olive-briefing", { body });
    if (error) {
      console.error("olive-briefing error:", error);
      return { error: error.message };
    }
    return data;
  }, []);

  // ── Delegation CRUD ──

  const createDelegation = useCallback(
    async (params: {
      space_id: string;
      delegated_to: string;
      title: string;
      description?: string;
      priority?: string;
      note_id?: string;
      notify_whatsapp?: boolean;
    }) => {
      return invokeDelegate({ action: "create", ...params });
    },
    [invokeDelegate]
  );

  const acceptDelegation = useCallback(
    async (id: string, response_note?: string) => {
      return invokeDelegate({ action: "accept", id, response_note });
    },
    [invokeDelegate]
  );

  const snoozeDelegation = useCallback(
    async (id: string, snoozed_until?: string, response_note?: string) => {
      return invokeDelegate({ action: "snooze", id, snoozed_until, response_note });
    },
    [invokeDelegate]
  );

  const reassignDelegation = useCallback(
    async (id: string, reassign_to: string, reason?: string) => {
      return invokeDelegate({ action: "reassign", id, reassign_to, reason });
    },
    [invokeDelegate]
  );

  const declineDelegation = useCallback(
    async (id: string, response_note?: string) => {
      return invokeDelegate({ action: "decline", id, response_note });
    },
    [invokeDelegate]
  );

  const completeDelegation = useCallback(
    async (id: string, response_note?: string) => {
      return invokeDelegate({ action: "complete", id, response_note });
    },
    [invokeDelegate]
  );

  const cancelDelegation = useCallback(
    async (id: string) => {
      return invokeDelegate({ action: "cancel", id });
    },
    [invokeDelegate]
  );

  // ── Queries ──

  const listIncoming = useCallback(
    async (params?: { status?: string; space_id?: string; limit?: number }): Promise<Delegation[]> => {
      const result = await invokeDelegate({ action: "list_incoming", ...params });
      return result?.delegations || [];
    },
    [invokeDelegate]
  );

  const listOutgoing = useCallback(
    async (params?: { status?: string; space_id?: string; limit?: number }): Promise<Delegation[]> => {
      const result = await invokeDelegate({ action: "list_outgoing", ...params });
      return result?.delegations || [];
    },
    [invokeDelegate]
  );

  // ── Smart Routing ──

  const smartRoute = useCallback(
    async (params: {
      space_id: string;
      task_title: string;
      task_description?: string;
      category?: string;
    }): Promise<SmartRouteResult | null> => {
      const result = await invokeDelegate({ action: "smart_route", ...params });
      if (result?.error) return null;
      return result as SmartRouteResult;
    },
    [invokeDelegate]
  );

  const whoNeedsToKnow = useCallback(
    async (params: {
      space_id: string;
      event_type: string;
      entity_id?: string;
      entity_title?: string;
    }): Promise<NotifyTarget[]> => {
      const result = await invokeDelegate({ action: "who_needs_to_know", ...params });
      return result?.notify || [];
    },
    [invokeDelegate]
  );

  // ── Briefings ──

  const generateBriefing = useCallback(
    async (params?: { space_id?: string; briefing_type?: string }): Promise<Briefing | null> => {
      const result = await invokeBriefing({ action: "generate", ...params });
      return result?.briefing || null;
    },
    [invokeBriefing]
  );

  const getLatestBriefing = useCallback(
    async (params?: { space_id?: string; briefing_type?: string }): Promise<Briefing | null> => {
      const result = await invokeBriefing({ action: "get_latest", ...params });
      return result?.briefing || null;
    },
    [invokeBriefing]
  );

  const listBriefings = useCallback(
    async (params?: { limit?: number; briefing_type?: string }): Promise<Briefing[]> => {
      const result = await invokeBriefing({ action: "list", ...params });
      return result?.briefings || [];
    },
    [invokeBriefing]
  );

  const markBriefingRead = useCallback(
    async (id: string): Promise<boolean> => {
      const result = await invokeBriefing({ action: "mark_read", id });
      return !!result?.success;
    },
    [invokeBriefing]
  );

  return {
    // Delegation CRUD
    createDelegation,
    acceptDelegation,
    snoozeDelegation,
    reassignDelegation,
    declineDelegation,
    completeDelegation,
    cancelDelegation,
    // Queries
    listIncoming,
    listOutgoing,
    // Intelligence
    smartRoute,
    whoNeedsToKnow,
    // Briefings
    generateBriefing,
    getLatestBriefing,
    listBriefings,
    markBriefingRead,
  };
}

export default useDelegation;

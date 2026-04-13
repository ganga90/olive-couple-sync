/**
 * useSubscription — Frontend hook for billing, subscriptions, usage, polls & conflicts.
 *
 * Wraps olive-billing, olive-polls, and olive-conflicts edge functions.
 */

import { useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";

// ─── Types ────────────────────────────────────────────────────

export interface PricingPlan {
  id: string;
  plan_id: string;
  name: string;
  description: string | null;
  max_spaces: number;
  max_members_per_space: number;
  max_notes_per_month: number;
  max_ai_requests_per_day: number;
  max_whatsapp_messages_per_day: number;
  max_file_storage_mb: number;
  features: Record<string, boolean>;
  price_monthly_cents: number;
  price_yearly_cents: number;
  currency: string;
  sort_order: number;
  is_popular: boolean;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  billing_cycle: string;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  canceled_at: string | null;
  plan: PricingPlan;
}

export interface UsageData {
  today: { ai_requests: number; whatsapp_messages_sent: number; notes_created: number };
  month: { notes_created: number; ai_requests: number; whatsapp_messages_sent: number; file_uploads: number };
  limits: { max_notes_per_month: number; max_ai_requests_per_day: number; max_whatsapp_messages_per_day: number } | null;
}

export interface Poll {
  id: string;
  space_id: string;
  created_by: string;
  question: string;
  description: string | null;
  poll_type: "single" | "multiple" | "ranked";
  options: Array<{ id: string; text: string; color?: string }>;
  allow_add_options: boolean;
  anonymous: boolean;
  closes_at: string | null;
  status: "open" | "closed" | "canceled";
  vote_count?: number;
  created_at: string;
}

export interface PollResult {
  id: string;
  text: string;
  votes: number;
  percentage: string;
}

export interface Conflict {
  id: string;
  space_id: string;
  user_id: string;
  conflict_type: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string | null;
  entity_a_type: string;
  entity_a_id: string;
  entity_b_type: string;
  entity_b_id: string;
  status: string;
  resolution: string | null;
  detected_at: string;
}

export interface CrossSpaceInsight {
  insight_type: string;
  title: string;
  description: string;
  suggestion: string | null;
  confidence: number;
}

// ─── Hook ─────────────────────────────────────────────────────

export function useSubscription() {
  const invokeBilling = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("olive-billing", { body });
    if (error) { console.error("olive-billing error:", error); return { error: error.message }; }
    return data;
  }, []);

  const invokePolls = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("olive-polls", { body });
    if (error) { console.error("olive-polls error:", error); return { error: error.message }; }
    return data;
  }, []);

  const invokeConflicts = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("olive-conflicts", { body });
    if (error) { console.error("olive-conflicts error:", error); return { error: error.message }; }
    return data;
  }, []);

  // ── Billing ──

  const getPlans = useCallback(async (): Promise<PricingPlan[]> => {
    const result = await invokeBilling({ action: "get_plans" });
    return result?.plans || [];
  }, [invokeBilling]);

  const getSubscription = useCallback(async (): Promise<{ subscription: Subscription | null; plan: PricingPlan | null }> => {
    const result = await invokeBilling({ action: "get_subscription" });
    return { subscription: result?.subscription || null, plan: result?.plan || null };
  }, [invokeBilling]);

  const createCheckout = useCallback(async (planId: string, billingCycle?: string) => {
    return invokeBilling({ action: "create_checkout", plan_id: planId, billing_cycle: billingCycle });
  }, [invokeBilling]);

  const getUsage = useCallback(async (): Promise<UsageData | null> => {
    const result = await invokeBilling({ action: "get_usage" });
    if (result?.error) return null;
    return result as UsageData;
  }, [invokeBilling]);

  const checkQuota = useCallback(async (meter: string) => {
    return invokeBilling({ action: "check_quota", meter });
  }, [invokeBilling]);

  const cancelSubscription = useCallback(async () => {
    return invokeBilling({ action: "cancel" });
  }, [invokeBilling]);

  const getPortalUrl = useCallback(async () => {
    return invokeBilling({ action: "portal" });
  }, [invokeBilling]);

  // ── Polls ──

  const createPoll = useCallback(async (data: {
    space_id: string; question: string; options: Array<string | { text: string }>;
    poll_type?: string; anonymous?: boolean; closes_at?: string;
  }) => {
    return invokePolls({ action: "create", ...data });
  }, [invokePolls]);

  const votePoll = useCallback(async (pollId: string, optionIds: string[]) => {
    return invokePolls({ action: "vote", poll_id: pollId, option_ids: optionIds });
  }, [invokePolls]);

  const getPollResults = useCallback(async (pollId: string) => {
    return invokePolls({ action: "results", poll_id: pollId });
  }, [invokePolls]);

  const listPolls = useCallback(async (spaceId: string, status?: string): Promise<Poll[]> => {
    const result = await invokePolls({ action: "list", space_id: spaceId, status });
    return result?.polls || [];
  }, [invokePolls]);

  const closePoll = useCallback(async (pollId: string) => {
    return invokePolls({ action: "close", poll_id: pollId });
  }, [invokePolls]);

  // ── Conflicts ──

  const detectConflicts = useCallback(async (spaceId: string) => {
    return invokeConflicts({ action: "detect", space_id: spaceId });
  }, [invokeConflicts]);

  const listConflicts = useCallback(async (spaceId: string, status?: string): Promise<Conflict[]> => {
    const result = await invokeConflicts({ action: "list", space_id: spaceId, status });
    return result?.conflicts || [];
  }, [invokeConflicts]);

  const resolveConflict = useCallback(async (conflictId: string, resolution?: string) => {
    return invokeConflicts({ action: "resolve", conflict_id: conflictId, resolution });
  }, [invokeConflicts]);

  const dismissConflict = useCallback(async (conflictId: string) => {
    return invokeConflicts({ action: "dismiss", conflict_id: conflictId });
  }, [invokeConflicts]);

  const detectCrossSpace = useCallback(async (): Promise<CrossSpaceInsight[]> => {
    const result = await invokeConflicts({ action: "cross_space" });
    return result?.insights || [];
  }, [invokeConflicts]);

  return {
    // Billing
    getPlans, getSubscription, createCheckout, getUsage, checkQuota, cancelSubscription, getPortalUrl,
    // Polls
    createPoll, votePoll, getPollResults, listPolls, closePoll,
    // Conflicts
    detectConflicts, listConflicts, resolveConflict, dismissConflict, detectCrossSpace,
  };
}

export default useSubscription;

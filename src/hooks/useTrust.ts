/**
 * useTrust — Hook for trust system, reflections, and engagement.
 *
 * Provides access to trust matrix, pending actions, reflection history,
 * engagement score, and notifications.
 */
import { useCallback, useEffect, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { getSupabase } from "@/lib/supabaseClient";

// ─── Types ──────────────────────────────────────────────────────

export type TrustLevel = 0 | 1 | 2 | 3;

export const TRUST_LEVEL_NAMES: Record<TrustLevel, string> = {
  0: "Inform Only",
  1: "Suggest",
  2: "Act & Report",
  3: "Autonomous",
};

export const TRUST_LEVEL_DESCRIPTIONS: Record<TrustLevel, string> = {
  0: "Olive tells you what she found, but waits for you to decide.",
  1: "Olive suggests an action and asks before proceeding.",
  2: "Olive acts and tells you what she did.",
  3: "Olive handles this silently. You see it in the activity log.",
};

export type TrustMatrixEntry = {
  action_type: string;
  trust_level: number;
  trust_level_name: string;
  is_high_risk: boolean;
  max_level: number;
  label: string;
};

export type PendingAction = {
  id: string;
  user_id: string;
  space_id: string | null;
  action_type: string;
  action_payload: Record<string, any>;
  action_description: string;
  trust_level: number;
  status: string;
  created_at: string;
  expires_at: string;
};

export type Reflection = {
  id: string;
  user_id: string;
  action_type: string;
  action_detail: Record<string, any>;
  outcome: "accepted" | "modified" | "rejected" | "ignored";
  user_modification: string | null;
  lesson: string | null;
  confidence: number;
  created_at: string;
};

export type LearningInsight = {
  action_type: string;
  label: string;
  total_interactions: number;
  acceptance_rate: number;
  trend: string;
  stats: { accepted: number; rejected: number; modified: number; ignored: number };
  recent_lessons: string[];
};

export type TrustNotification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  metadata: Record<string, any>;
  trust_action_id: string | null;
  read_at: string | null;
  acted_on_at: string | null;
  dismissed_at: string | null;
  created_at: string;
};

export type EngagementData = {
  score: number;
  proactivity_level: string;
  proactivity_description: string;
  metrics: any;
};

// ─── Hook ───────────────────────────────────────────────────────

export const useTrust = () => {
  const { user } = useUser();

  const invokeTrustGate = useCallback(
    async (action: string, params: Record<string, any> = {}) => {
      const supabase = getSupabase();
      const { data, error } = await supabase.functions.invoke("olive-trust-gate", {
        body: { action, ...params },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    []
  );

  const invokeReflect = useCallback(
    async (action: string, params: Record<string, any> = {}) => {
      const supabase = getSupabase();
      const { data, error } = await supabase.functions.invoke("olive-reflect", {
        body: { action, ...params },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    []
  );

  // ─── Trust Matrix ───────────────────────────────────────────

  const getTrustMatrix = useCallback(async (): Promise<TrustMatrixEntry[]> => {
    try {
      const result = await invokeTrustGate("get_trust_matrix");
      return result.matrix || [];
    } catch (err) {
      console.error("[useTrust] getTrustMatrix error:", err);
      return [];
    }
  }, [invokeTrustGate]);

  const adjustTrust = useCallback(
    async (actionType: string, newLevel: TrustLevel): Promise<boolean> => {
      try {
        const result = await invokeTrustGate("adjust_trust", {
          action_type: actionType,
          new_level: newLevel,
        });
        return result.success || false;
      } catch (err) {
        console.error("[useTrust] adjustTrust error:", err);
        return false;
      }
    },
    [invokeTrustGate]
  );

  // ─── Pending Actions ────────────────────────────────────────

  const listPending = useCallback(async (): Promise<PendingAction[]> => {
    try {
      const result = await invokeTrustGate("list_pending", {});
      return result.actions || [];
    } catch (err) {
      console.error("[useTrust] listPending error:", err);
      return [];
    }
  }, [invokeTrustGate]);

  const approveAction = useCallback(
    async (actionId: string, userResponse?: string): Promise<boolean> => {
      try {
        const result = await invokeTrustGate("approve", {
          action_id: actionId,
          user_response: userResponse,
        });
        return result.success || false;
      } catch (err) {
        console.error("[useTrust] approveAction error:", err);
        return false;
      }
    },
    [invokeTrustGate]
  );

  const rejectAction = useCallback(
    async (actionId: string, reason?: string): Promise<boolean> => {
      try {
        const result = await invokeTrustGate("reject", {
          action_id: actionId,
          reason,
        });
        return result.success || false;
      } catch (err) {
        console.error("[useTrust] rejectAction error:", err);
        return false;
      }
    },
    [invokeTrustGate]
  );

  // ─── Engagement ─────────────────────────────────────────────

  const getEngagement = useCallback(async (): Promise<EngagementData | null> => {
    try {
      return await invokeTrustGate("get_engagement");
    } catch (err) {
      console.error("[useTrust] getEngagement error:", err);
      return null;
    }
  }, [invokeTrustGate]);

  // ─── Reflections ────────────────────────────────────────────

  const getReflections = useCallback(
    async (limit = 30, actionType?: string): Promise<Reflection[]> => {
      try {
        const result = await invokeReflect("get_reflections", {
          limit,
          action_type: actionType,
        });
        return result.reflections || [];
      } catch (err) {
        console.error("[useTrust] getReflections error:", err);
        return [];
      }
    },
    [invokeReflect]
  );

  const getLearning = useCallback(async () => {
    try {
      return await invokeReflect("get_learning");
    } catch (err) {
      console.error("[useTrust] getLearning error:", err);
      return null;
    }
  }, [invokeReflect]);

  const recordReflection = useCallback(
    async (params: {
      action_type: string;
      outcome: "accepted" | "modified" | "rejected" | "ignored";
      action_detail?: Record<string, any>;
      user_modification?: string;
      lesson?: string;
    }): Promise<boolean> => {
      try {
        await invokeReflect("record", params);
        return true;
      } catch (err) {
        console.error("[useTrust] recordReflection error:", err);
        return false;
      }
    },
    [invokeReflect]
  );

  // ─── Notifications ──────────────────────────────────────────

  const getNotifications = useCallback(
    async (unreadOnly = true): Promise<TrustNotification[]> => {
      try {
        const result = await invokeReflect("get_notifications", {
          unread_only: unreadOnly,
        });
        return result.notifications || [];
      } catch (err) {
        console.error("[useTrust] getNotifications error:", err);
        return [];
      }
    },
    [invokeReflect]
  );

  const dismissNotification = useCallback(
    async (notificationId: string): Promise<boolean> => {
      try {
        await invokeReflect("dismiss_notification", {
          notification_id: notificationId,
        });
        return true;
      } catch (err) {
        console.error("[useTrust] dismissNotification error:", err);
        return false;
      }
    },
    [invokeReflect]
  );

  return {
    // Trust matrix
    getTrustMatrix,
    adjustTrust,
    // Pending actions
    listPending,
    approveAction,
    rejectAction,
    // Engagement
    getEngagement,
    // Reflections
    getReflections,
    getLearning,
    recordReflection,
    // Notifications
    getNotifications,
    dismissNotification,
  };
};

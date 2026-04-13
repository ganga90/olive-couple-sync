/**
 * useConsolidation — Frontend hook for memory consolidation & soul safety.
 *
 * Wraps the olive-consolidate and olive-soul-safety edge functions.
 */

import { useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";

// ─── Types ────────────────────────────────────────────────────

export interface ConsolidationRun {
  id: string;
  run_type: string;
  status: string;
  memories_scanned: number;
  memories_merged: number;
  memories_archived: number;
  memories_deduplicated: number;
  chunks_compacted: number;
  daily_logs_compacted: number;
  token_savings: number;
  started_at: string;
  completed_at: string | null;
}

export interface MemoryHealthStatus {
  total_memories: number;
  archived_memories: number;
  at_risk_memories: number;
  daily_logs: number;
  total_chunks: number;
  last_consolidation: {
    completed_at: string;
    memories_merged: number;
    memories_archived: number;
    memories_deduplicated: number;
    token_savings: number;
  } | null;
  health: {
    score: number;
    label: string;
    color: string;
  };
}

export interface DriftResult {
  drift_score: number;
  fields_changed: string[];
  token_delta: number;
  token_delta_percent: number;
  is_safe: boolean;
  blocked_reasons: string[];
  details: Record<string, any>;
}

export interface EvolutionLogEntry {
  id: string;
  user_id: string;
  layer_type: string;
  proposals_count: number;
  proposals_applied: number;
  proposals_deferred: number;
  proposals_blocked: number;
  drift_score: number;
  drift_details: Record<string, any>;
  was_rate_limited: boolean;
  was_rollback: boolean;
  rollback_reason: string | null;
  rollback_to_version: number | null;
  trigger: string;
  changes_summary: string[];
  pre_snapshot_version: number | null;
  post_snapshot_version: number | null;
  created_at: string;
}

export interface RollbackEntry {
  id: string;
  layer_type: string;
  from_version: number;
  to_version: number;
  reason: string;
  requested_by: string;
  status: string;
  applied_at: string | null;
  created_at: string;
}

export interface RateLimitStatus {
  evolutions_today: number;
  max_per_day: number;
  is_rate_limited: boolean;
  next_available: string;
}

// ─── Hook ─────────────────────────────────────────────────────

export function useConsolidation() {
  const invokeConsolidate = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("olive-consolidate", { body });
    if (error) {
      console.error("olive-consolidate error:", error);
      return { error: error.message };
    }
    return data;
  }, []);

  const invokeSafety = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("olive-soul-safety", { body });
    if (error) {
      console.error("olive-soul-safety error:", error);
      return { error: error.message };
    }
    return data;
  }, []);

  // ── Consolidation ──

  const runConsolidation = useCallback(
    async (runType?: string) => {
      return invokeConsolidate({ action: "run", run_type: runType || "manual" });
    },
    [invokeConsolidate]
  );

  const getHealthStatus = useCallback(async (): Promise<MemoryHealthStatus | null> => {
    const result = await invokeConsolidate({ action: "status" });
    if (result?.error) return null;
    return result as MemoryHealthStatus;
  }, [invokeConsolidate]);

  const restoreMemory = useCallback(
    async (memoryId: string) => {
      return invokeConsolidate({ action: "restore", memory_id: memoryId });
    },
    [invokeConsolidate]
  );

  const getConsolidationHistory = useCallback(
    async (limit?: number): Promise<ConsolidationRun[]> => {
      const result = await invokeConsolidate({ action: "history", limit });
      return result?.runs || [];
    },
    [invokeConsolidate]
  );

  // ── Soul Safety ──

  const checkDrift = useCallback(
    async (layerType?: string): Promise<DriftResult | null> => {
      const result = await invokeSafety({ action: "check_drift", layer_type: layerType });
      if (result?.error) return null;
      return result as DriftResult;
    },
    [invokeSafety]
  );

  const rollbackSoul = useCallback(
    async (layerType?: string, toVersion?: number, reason?: string) => {
      return invokeSafety({
        action: "rollback",
        layer_type: layerType || "user",
        to_version: toVersion,
        reason: reason || "user_request",
      });
    },
    [invokeSafety]
  );

  const getEvolutionHistory = useCallback(
    async (limit?: number, layerType?: string): Promise<EvolutionLogEntry[]> => {
      const result = await invokeSafety({
        action: "get_evolution_history",
        limit,
        layer_type: layerType,
      });
      return result?.history || [];
    },
    [invokeSafety]
  );

  const getRollbackHistory = useCallback(
    async (limit?: number): Promise<RollbackEntry[]> => {
      const result = await invokeSafety({ action: "get_rollback_history", limit });
      return result?.rollbacks || [];
    },
    [invokeSafety]
  );

  const checkRateLimit = useCallback(async (): Promise<RateLimitStatus | null> => {
    const result = await invokeSafety({ action: "check_rate_limit" });
    if (result?.error) return null;
    return result as RateLimitStatus;
  }, [invokeSafety]);

  const lockLayer = useCallback(
    async (layerType: string) => {
      return invokeSafety({ action: "lock_layer", layer_type: layerType });
    },
    [invokeSafety]
  );

  const unlockLayer = useCallback(
    async (layerType: string) => {
      return invokeSafety({ action: "unlock_layer", layer_type: layerType });
    },
    [invokeSafety]
  );

  return {
    // Consolidation
    runConsolidation,
    getHealthStatus,
    restoreMemory,
    getConsolidationHistory,
    // Soul Safety
    checkDrift,
    rollbackSoul,
    getEvolutionHistory,
    getRollbackHistory,
    checkRateLimit,
    lockLayer,
    unlockLayer,
  };
}

export default useConsolidation;

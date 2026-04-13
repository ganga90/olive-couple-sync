/**
 * SoulEvolutionSafetyCard — Shows soul evolution history, drift alerts,
 * and rollback controls.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Shield,
  RotateCcw,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useConsolidation,
  DriftResult,
  EvolutionLogEntry,
  RateLimitStatus,
} from "@/hooks/useConsolidation";
import { formatDistanceToNow } from "date-fns";

export const SoulEvolutionSafetyCard: React.FC = () => {
  const {
    checkDrift,
    rollbackSoul,
    getEvolutionHistory,
    checkRateLimit,
    lockLayer,
    unlockLayer,
  } = useConsolidation();

  const [drift, setDrift] = useState<DriftResult | null>(null);
  const [history, setHistory] = useState<EvolutionLogEntry[]>([]);
  const [rateLimit, setRateLimit] = useState<RateLimitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [rolling, setRolling] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [driftData, historyData, rateLimitData] = await Promise.all([
      checkDrift("user"),
      getEvolutionHistory(5),
      checkRateLimit(),
    ]);
    setDrift(driftData);
    setHistory(historyData);
    setRateLimit(rateLimitData);
    setLoading(false);
  }, [checkDrift, getEvolutionHistory, checkRateLimit]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRollback = async () => {
    setRolling(true);
    const result = await rollbackSoul("user", undefined, "user_request");
    if (result?.success) {
      toast.success(`Rolled back from v${result.from_version} to v${result.to_version}.`);
      await fetchData();
    } else {
      toast.error(result?.error || "Rollback failed.");
    }
    setRolling(false);
  };

  const handleLockToggle = async (layerType: string, currentlyLocked: boolean) => {
    if (currentlyLocked) {
      const result = await unlockLayer(layerType);
      if (result?.success) {
        toast.success(`${layerType} layer unlocked. Evolution can modify it.`);
      }
    } else {
      const result = await lockLayer(layerType);
      if (result?.success) {
        toast.success(`${layerType} layer locked. Evolution cannot modify it.`);
      }
    }
  };

  if (loading) return null;

  const driftScore = drift?.drift_score ?? 0;
  const driftColor = driftScore <= 0.2 ? "emerald" : driftScore <= 0.4 ? "amber" : "red";

  return (
    <div className="space-y-4">
      {/* Drift Score */}
      {drift && (
        <div className="flex items-center gap-4">
          <div className={cn(
            "w-12 h-12 rounded-2xl flex items-center justify-center",
            driftColor === "emerald" && "bg-emerald-50 text-emerald-600",
            driftColor === "amber" && "bg-amber-50 text-amber-600",
            driftColor === "red" && "bg-red-50 text-red-600",
          )}>
            {driftColor === "emerald" ? (
              <CheckCircle className="h-6 w-6" />
            ) : driftColor === "amber" ? (
              <TrendingUp className="h-6 w-6" />
            ) : (
              <AlertTriangle className="h-6 w-6" />
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Soul Drift</span>
              <span className={cn(
                "text-xs font-medium px-1.5 py-0.5 rounded-full",
                driftColor === "emerald" && "bg-emerald-50 text-emerald-600",
                driftColor === "amber" && "bg-amber-50 text-amber-600",
                driftColor === "red" && "bg-red-50 text-red-600",
              )}>
                {(driftScore * 100).toFixed(0)}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {driftScore <= 0.2
                ? "Olive's personality is stable"
                : driftScore <= 0.4
                ? "Some recent changes — review if unexpected"
                : "Significant changes detected — consider rolling back"}
            </p>
            {drift.fields_changed.length > 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Changed: {drift.fields_changed.join(", ")}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Drift bar */}
      {drift && (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Stable</span>
            <span>Drifting</span>
          </div>
          <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                driftColor === "emerald" && "bg-emerald-500",
                driftColor === "amber" && "bg-amber-500",
                driftColor === "red" && "bg-red-500",
              )}
              style={{ width: `${Math.max(5, driftScore * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Rate limit info */}
      {rateLimit && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/20 rounded-lg p-2.5">
          <Clock className="h-3.5 w-3.5" />
          <span>
            {rateLimit.evolutions_today}/{rateLimit.max_per_day} evolutions today
          </span>
          {rateLimit.is_rate_limited && (
            <span className="ml-auto text-amber-600 font-medium">Rate limited</span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleRollback}
          disabled={rolling || history.length === 0}
          className="flex-1"
        >
          <RotateCcw className={cn("h-3.5 w-3.5 mr-1.5", rolling && "animate-spin")} />
          {rolling ? "Rolling back..." : "Undo Last Evolution"}
        </Button>
      </div>

      {/* Not safe alert */}
      {drift && !drift.is_safe && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-medium text-red-700">Evolution blocked</p>
              {drift.blocked_reasons.map((reason, i) => (
                <p key={i} className="text-[11px] text-red-600 mt-0.5">{reason}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Evolution history */}
      {history.length > 0 && (
        <div>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full justify-center py-1"
          >
            {showHistory ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showHistory ? "Hide evolution log" : `Show ${history.length} recent evolutions`}
          </button>

          {showHistory && (
            <div className="space-y-2 mt-2">
              {history.map((entry) => (
                <div key={entry.id} className="text-xs bg-muted/20 rounded-lg p-2.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {entry.was_rollback ? (
                        <RotateCcw className="h-3 w-3 text-amber-500" />
                      ) : (
                        <TrendingUp className="h-3 w-3 text-primary" />
                      )}
                      <span className="font-medium">
                        {entry.was_rollback ? "Rollback" : `Evolution (${entry.layer_type})`}
                      </span>
                    </div>
                    <span className="text-muted-foreground">
                      {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                    </span>
                  </div>

                  {entry.changes_summary && entry.changes_summary.length > 0 && (
                    <div className="text-muted-foreground">
                      {entry.changes_summary.slice(0, 3).map((change, i) => (
                        <p key={i} className="truncate">• {change}</p>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-3 text-[11px] text-muted-foreground">
                    {!entry.was_rollback && (
                      <>
                        <span>{entry.proposals_applied} applied</span>
                        <span>{entry.proposals_deferred} deferred</span>
                        {entry.proposals_blocked > 0 && (
                          <span className="text-red-500">{entry.proposals_blocked} blocked</span>
                        )}
                      </>
                    )}
                    {entry.drift_score > 0 && (
                      <span className={cn(
                        entry.drift_score > 0.4 ? "text-red-500" : "text-muted-foreground"
                      )}>
                        drift: {(entry.drift_score * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Olive evolves based on your interactions. If changes feel off, roll back to a previous version.
        Lock layers to prevent any automatic changes.
      </p>
    </div>
  );
};

export default SoulEvolutionSafetyCard;

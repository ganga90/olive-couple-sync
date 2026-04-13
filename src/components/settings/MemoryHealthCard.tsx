/**
 * MemoryHealthCard — Displays memory system health, decay status,
 * and consolidation history. Allows manual consolidation trigger.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Database,
  RefreshCw,
  Archive,
  Trash2,
  Layers,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useConsolidation, MemoryHealthStatus, ConsolidationRun } from "@/hooks/useConsolidation";
import { formatDistanceToNow } from "date-fns";

export const MemoryHealthCard: React.FC = () => {
  const { getHealthStatus, runConsolidation, getConsolidationHistory } = useConsolidation();
  const [health, setHealth] = useState<MemoryHealthStatus | null>(null);
  const [history, setHistory] = useState<ConsolidationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [healthData, historyData] = await Promise.all([
      getHealthStatus(),
      getConsolidationHistory(5),
    ]);
    setHealth(healthData);
    setHistory(historyData);
    setLoading(false);
  }, [getHealthStatus, getConsolidationHistory]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRunConsolidation = async () => {
    setRunning(true);
    const result = await runConsolidation("manual");
    if (result?.processed) {
      toast.success(`Consolidation complete. ${result.results?.[0]?.stats?.token_savings || 0} tokens freed.`);
      await fetchData();
    } else {
      toast.error("Consolidation failed. Try again later.");
    }
    setRunning(false);
  };

  if (loading) return null;

  const healthScore = health?.health?.score ?? 100;
  const healthColor =
    healthScore >= 80 ? "emerald" : healthScore >= 50 ? "amber" : "red";

  return (
    <div className="space-y-4">
      {/* Health Score Ring */}
      {health && (
        <div className="flex items-center gap-5">
          <div className="relative w-16 h-16">
            <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
              <circle
                cx="18" cy="18" r="15.5"
                fill="none" stroke="currentColor" strokeWidth="3"
                className="text-muted/20"
              />
              <circle
                cx="18" cy="18" r="15.5"
                fill="none" stroke="currentColor" strokeWidth="3"
                strokeDasharray={`${(healthScore / 100) * 97.4} 97.4`}
                strokeLinecap="round"
                className={cn(
                  healthColor === "emerald" && "text-emerald-500",
                  healthColor === "amber" && "text-amber-500",
                  healthColor === "red" && "text-red-500",
                )}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-lg font-bold">{healthScore}</span>
            </div>
          </div>

          <div className="flex-1">
            <div className={cn(
              "font-semibold",
              healthColor === "emerald" && "text-emerald-600",
              healthColor === "amber" && "text-amber-600",
              healthColor === "red" && "text-red-600",
            )}>
              {health.health.label}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {health.total_memories} active memories · {health.archived_memories} archived
            </p>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      {health && (
        <div className="grid grid-cols-3 gap-3">
          <StatPill
            icon={<Database className="h-3.5 w-3.5" />}
            label="Memories"
            value={health.total_memories}
            color="blue"
          />
          <StatPill
            icon={<Archive className="h-3.5 w-3.5" />}
            label="Archived"
            value={health.archived_memories}
            color="stone"
          />
          <StatPill
            icon={<Layers className="h-3.5 w-3.5" />}
            label="At Risk"
            value={health.at_risk_memories}
            color={health.at_risk_memories > 10 ? "red" : "amber"}
          />
        </div>
      )}

      {/* Last consolidation info */}
      {health?.last_consolidation && (
        <div className="text-xs text-muted-foreground bg-muted/20 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles className="h-3 w-3 text-primary" />
            <span className="font-medium">Last consolidation</span>
            <span className="ml-auto">
              {formatDistanceToNow(new Date(health.last_consolidation.completed_at), { addSuffix: true })}
            </span>
          </div>
          <div className="flex gap-3 text-[11px]">
            <span>{health.last_consolidation.memories_merged} merged</span>
            <span>{health.last_consolidation.memories_deduplicated} deduped</span>
            <span>{health.last_consolidation.memories_archived} archived</span>
            <span>{health.last_consolidation.token_savings} tokens freed</span>
          </div>
        </div>
      )}

      {/* Actions */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleRunConsolidation}
        disabled={running}
        className="w-full"
      >
        <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", running && "animate-spin")} />
        {running ? "Consolidating..." : "Run Consolidation Now"}
      </Button>

      {/* History toggle */}
      {history.length > 0 && (
        <div>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full justify-center py-1"
          >
            {showHistory ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showHistory ? "Hide history" : `Show ${history.length} recent runs`}
          </button>

          {showHistory && (
            <div className="space-y-2 mt-2">
              {history.map((run) => (
                <div key={run.id} className="text-xs bg-muted/20 rounded-lg p-2.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize">{run.run_type}</span>
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded-full",
                      run.status === "completed" ? "bg-emerald-50 text-emerald-600" :
                      run.status === "failed" ? "bg-red-50 text-red-600" :
                      "bg-stone-50 text-stone-600"
                    )}>
                      {run.status}
                    </span>
                  </div>
                  <div className="text-muted-foreground flex gap-2">
                    <span>{run.memories_merged}m</span>
                    <span>{run.memories_deduplicated}d</span>
                    <span>{run.memories_archived}a</span>
                    <span>{run.token_savings}t saved</span>
                    <span className="ml-auto">
                      {run.completed_at ? formatDistanceToNow(new Date(run.completed_at), { addSuffix: true }) : "running"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Stat Pill ────────────────────────────────────────────────

const StatPill: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}> = ({ icon, label, value, color }) => (
  <div className={cn(
    "flex flex-col items-center gap-1 p-2.5 rounded-xl border",
    color === "blue" && "bg-blue-50/50 border-blue-100 text-blue-600",
    color === "stone" && "bg-stone-50/50 border-stone-100 text-stone-500",
    color === "amber" && "bg-amber-50/50 border-amber-100 text-amber-600",
    color === "red" && "bg-red-50/50 border-red-100 text-red-600",
  )}>
    {icon}
    <span className="text-lg font-bold">{value}</span>
    <span className="text-[10px] text-muted-foreground">{label}</span>
  </div>
);

export default MemoryHealthCard;

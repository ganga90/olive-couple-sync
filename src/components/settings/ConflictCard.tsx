/**
 * ConflictCard — Shows detected conflicts and cross-space insights.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle,
  Clock,
  DollarSign,
  Users,
  Check,
  X,
  Lightbulb,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSubscription, Conflict, CrossSpaceInsight } from "@/hooks/useSubscription";
import { useSpace } from "@/providers/SpaceProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { formatDistanceToNow } from "date-fns";

const SEVERITY_CONFIG: Record<string, { color: string; icon: React.ReactNode }> = {
  critical: { color: "text-red-600 bg-red-50 border-red-200", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  high: { color: "text-orange-600 bg-orange-50 border-orange-200", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  medium: { color: "text-amber-600 bg-amber-50 border-amber-200", icon: <Clock className="h-3.5 w-3.5" /> },
  low: { color: "text-blue-600 bg-blue-50 border-blue-200", icon: <Clock className="h-3.5 w-3.5" /> },
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  schedule_overlap: <Clock className="h-4 w-4" />,
  deadline_conflict: <Clock className="h-4 w-4" />,
  assignment_overload: <Users className="h-4 w-4" />,
  budget_conflict: <DollarSign className="h-4 w-4" />,
};

interface ConflictCardProps {
  className?: string;
}

export const ConflictCard: React.FC<ConflictCardProps> = ({ className }) => {
  const { detectConflicts, listConflicts, resolveConflict, dismissConflict, detectCrossSpace } = useSubscription();
  const { currentSpace } = useSpace();
  const { notifySuccess, impactLight } = useHaptics();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [insights, setInsights] = useState<CrossSpaceInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const fetchData = useCallback(async () => {
    if (!currentSpace) return;
    setLoading(true);
    const [conflictsData, insightsData] = await Promise.all([
      listConflicts(currentSpace.id),
      detectCrossSpace(),
    ]);
    setConflicts(conflictsData);
    setInsights(insightsData);
    setLoading(false);
  }, [listConflicts, detectCrossSpace, currentSpace]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleScan = async () => {
    if (!currentSpace) return;
    setScanning(true);
    const result = await detectConflicts(currentSpace.id);
    if (result?.detected !== undefined) {
      toast.success(`Scan complete: ${result.new_conflicts} new conflicts found`);
      await fetchData();
    }
    setScanning(false);
  };

  const handleResolve = async (id: string) => {
    impactLight();
    const result = await resolveConflict(id);
    if (result?.success) {
      notifySuccess();
      toast.success("Conflict resolved");
      setConflicts((prev) => prev.filter((c) => c.id !== id));
    }
  };

  const handleDismiss = async (id: string) => {
    const result = await dismissConflict(id);
    if (result?.success) {
      setConflicts((prev) => prev.filter((c) => c.id !== id));
    }
  };

  if (loading) return null;

  const criticalCount = conflicts.filter((c) => c.severity === "critical" || c.severity === "high").length;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Summary */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{conflicts.length} open conflicts</span>
            {criticalCount > 0 && (
              <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                {criticalCount} critical
              </span>
            )}
          </div>
          {insights.length > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {insights.length} cross-space insight{insights.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleScan}
          disabled={scanning}
        >
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1", scanning && "animate-spin")} />
          {scanning ? "Scanning..." : "Scan"}
        </Button>
      </div>

      {/* Conflicts */}
      {conflicts.map((conflict) => {
        const severity = SEVERITY_CONFIG[conflict.severity] || SEVERITY_CONFIG.medium;
        return (
          <div key={conflict.id} className={cn("rounded-xl border p-3 space-y-1.5", severity.color)}>
            <div className="flex items-start gap-2">
              <div className="mt-0.5">{TYPE_ICONS[conflict.conflict_type] || severity.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{conflict.title}</span>
                  <span className="text-[10px] uppercase font-bold">{conflict.severity}</span>
                </div>
                {conflict.description && (
                  <p className="text-[11px] opacity-80 mt-0.5">{conflict.description}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => handleResolve(conflict.id)}
                className="flex items-center gap-1.5 text-xs px-3 py-2 min-h-[44px] rounded-lg bg-white/50 active:bg-white hover:bg-white transition-colors"
                aria-label={`Resolve conflict: ${conflict.title}`}
              >
                <Check className="h-3.5 w-3.5" /> Resolve
              </button>
              <button
                onClick={() => handleDismiss(conflict.id)}
                className="flex items-center gap-1.5 text-xs px-3 py-2 min-h-[44px] rounded-lg bg-white/50 active:bg-white hover:bg-white transition-colors"
                aria-label={`Dismiss conflict: ${conflict.title}`}
              >
                <X className="h-3.5 w-3.5" /> Dismiss
              </button>
              <span className="text-[11px] opacity-60 ml-auto">
                {formatDistanceToNow(new Date(conflict.detected_at), { addSuffix: true })}
              </span>
            </div>
          </div>
        );
      })}

      {/* Cross-space insights */}
      {insights.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lightbulb className="h-3 w-3" />
            <span className="font-medium">Cross-Space Insights</span>
          </div>
          {insights.map((insight, i) => (
            <div key={i} className="text-xs bg-blue-50/50 border border-blue-100 rounded-lg p-2.5 space-y-1">
              <span className="font-medium text-blue-700">{insight.title}</span>
              <p className="text-blue-600">{insight.description}</p>
              {insight.suggestion && (
                <p className="text-blue-500 italic">{insight.suggestion}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {conflicts.length === 0 && insights.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          No conflicts detected. Scan to check for scheduling overlaps, overloads, and budget issues.
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">
        Olive detects schedule overlaps, assignment overloads, and budget conflicts across your spaces.
      </p>
    </div>
  );
};

export default ConflictCard;

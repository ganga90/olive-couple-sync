/**
 * DecisionLogCard — Team decision log with context and outcome tracking.
 *
 * Shows recent decisions, allows quick logging, and provides status tracking.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Scale,
  Plus,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  Circle,
  MessageSquare,
  ArrowRight,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useBusinessTools, Decision, DecisionStats } from "@/hooks/useBusinessTools";
import { useSpace } from "@/providers/SpaceProvider";
import { formatDistanceToNow } from "date-fns";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  proposed: { label: "Proposed", color: "text-blue-600 bg-blue-50", icon: <Circle className="h-3 w-3" /> },
  discussed: { label: "Discussed", color: "text-violet-600 bg-violet-50", icon: <MessageSquare className="h-3 w-3" /> },
  decided: { label: "Decided", color: "text-amber-600 bg-amber-50", icon: <Scale className="h-3 w-3" /> },
  implemented: { label: "Done", color: "text-emerald-600 bg-emerald-50", icon: <CheckCircle className="h-3 w-3" /> },
  revisited: { label: "Revisited", color: "text-orange-600 bg-orange-50", icon: <ArrowRight className="h-3 w-3" /> },
  reversed: { label: "Reversed", color: "text-red-600 bg-red-50", icon: <ArrowRight className="h-3 w-3 rotate-180" /> },
};

const CATEGORIES = [
  { value: "financial", label: "Financial" },
  { value: "operational", label: "Operational" },
  { value: "strategic", label: "Strategic" },
  { value: "hiring", label: "Hiring" },
  { value: "product", label: "Product" },
  { value: "client", label: "Client" },
  { value: "policy", label: "Policy" },
  { value: "other", label: "Other" },
];

interface DecisionLogCardProps {
  className?: string;
}

export const DecisionLogCard: React.FC<DecisionLogCardProps> = ({ className }) => {
  const { listDecisions, createDecision, updateDecision, getDecisionStats } = useBusinessTools();
  const { currentSpace } = useSpace();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [stats, setStats] = useState<DecisionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState("other");
  const [newContext, setNewContext] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchData = useCallback(async () => {
    if (!currentSpace) return;
    setLoading(true);
    const [decisionData, statsData] = await Promise.all([
      listDecisions(currentSpace.id, { limit: 10 }),
      getDecisionStats(currentSpace.id),
    ]);
    setDecisions(decisionData.decisions);
    setStats(statsData);
    setLoading(false);
  }, [listDecisions, getDecisionStats, currentSpace]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreate = async () => {
    if (!currentSpace || !newTitle.trim()) return;
    setCreating(true);
    const result = await createDecision({
      space_id: currentSpace.id,
      title: newTitle.trim(),
      category: newCategory,
      context: newContext.trim() || undefined,
    });
    if (result?.success) {
      toast.success("Decision logged");
      setNewTitle("");
      setNewContext("");
      setNewCategory("other");
      setShowForm(false);
      await fetchData();
    } else {
      toast.error(result?.error || "Failed to log decision");
    }
    setCreating(false);
  };

  const handleAdvanceStatus = async (decision: Decision) => {
    const nextStatus: Record<string, string> = {
      proposed: "discussed",
      discussed: "decided",
      decided: "implemented",
    };
    const next = nextStatus[decision.status];
    if (!next) return;

    const result = await updateDecision(decision.id, { status: next } as any);
    if (result?.success) {
      toast.success(`Moved to "${STATUS_CONFIG[next]?.label}"`);
      await fetchData();
    }
  };

  if (loading) return null;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Stats summary */}
      {stats && stats.total > 0 && (
        <div className="flex gap-2 flex-wrap">
          {Object.entries(stats.by_status)
            .filter(([, count]) => count > 0)
            .map(([status, count]) => {
              const config = STATUS_CONFIG[status];
              return (
                <span
                  key={status}
                  className={cn("text-[10px] px-2 py-1 rounded-full font-medium flex items-center gap-1", config?.color)}
                >
                  {config?.icon}
                  {count} {config?.label}
                </span>
              );
            })}
        </div>
      )}

      {stats && stats.total > 0 && (
        <div className="text-xs text-muted-foreground bg-muted/20 rounded-lg p-2.5 flex gap-3">
          <span>{stats.total} total decisions</span>
          <span>{stats.recent_30d} this month</span>
          <span className="ml-auto">{stats.implementation_rate} implemented</span>
        </div>
      )}

      {/* Quick add */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowForm(!showForm)}
        className="w-full"
      >
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        {showForm ? "Cancel" : "Log Decision"}
      </Button>

      {showForm && (
        <div className="space-y-2 bg-muted/20 rounded-xl p-3">
          <Input
            placeholder="What was decided?"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="text-base"
          />
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="w-full text-base rounded-lg border border-border bg-background px-3 py-2.5 min-h-[44px]"
          >
            {CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value}>{cat.label}</option>
            ))}
          </select>
          <Input
            placeholder="Context / why this decision? (optional)"
            value={newContext}
            onChange={(e) => setNewContext(e.target.value)}
            className="text-base"
          />
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={creating || !newTitle.trim()}
            className="w-full"
          >
            {creating ? "Logging..." : "Log Decision"}
          </Button>
        </div>
      )}

      {/* Decision list */}
      {decisions.slice(0, showAll ? undefined : 5).map((decision) => {
        const statusConfig = STATUS_CONFIG[decision.status];
        return (
          <div key={decision.id} className="text-xs bg-muted/20 rounded-lg p-2.5 space-y-1">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={cn("px-1.5 py-0.5 rounded-full text-[10px] font-medium flex items-center gap-0.5", statusConfig?.color)}>
                    {statusConfig?.icon}
                    {statusConfig?.label}
                  </span>
                  {decision.category && decision.category !== "other" && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                      <Tag className="h-2.5 w-2.5" />
                      {decision.category}
                    </span>
                  )}
                </div>
                <p className="font-medium mt-1">{decision.title}</p>
                {decision.context && (
                  <p className="text-muted-foreground mt-0.5 truncate">{decision.context}</p>
                )}
              </div>
              {["proposed", "discussed", "decided"].includes(decision.status) && (
                <button
                  onClick={() => handleAdvanceStatus(decision)}
                  className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center active:bg-muted hover:bg-muted rounded-lg text-muted-foreground active:text-foreground hover:text-foreground flex-shrink-0 transition-colors"
                  aria-label={`Advance ${decision.title} status`}
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="text-muted-foreground">
              {formatDistanceToNow(new Date(decision.decision_date), { addSuffix: true })}
              {decision.participants.length > 1 && ` · ${decision.participants.length} participants`}
            </div>
          </div>
        );
      })}

      {decisions.length > 5 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="flex items-center gap-1 text-xs text-muted-foreground active:text-foreground hover:text-foreground transition-colors w-full justify-center py-2.5 min-h-[44px]"
          aria-label={showAll ? "Show fewer decisions" : `Show all ${decisions.length} decisions`}
        >
          {showAll ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {showAll ? "Show less" : `Show all ${decisions.length} decisions`}
        </button>
      )}

      {decisions.length === 0 && !showForm && (
        <p className="text-xs text-muted-foreground text-center py-2">
          No decisions logged yet. Start tracking your team's decisions.
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">
        Log team decisions with context so you can recall why choices were made.
      </p>
    </div>
  );
};

export default DecisionLogCard;

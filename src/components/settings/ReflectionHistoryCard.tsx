/**
 * ReflectionHistoryCard — Shows what Olive has learned from user interactions.
 *
 * Displays aggregated learning insights and recent reflections.
 */
import React, { useState, useEffect, useCallback } from "react";
import { Brain, CheckCircle, XCircle, Pencil, Eye, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTrust, LearningInsight } from "@/hooks/useTrust";
import { formatDistanceToNow } from "date-fns";

const OUTCOME_ICONS: Record<string, React.ReactNode> = {
  accepted: <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />,
  modified: <Pencil className="h-3.5 w-3.5 text-blue-500" />,
  rejected: <XCircle className="h-3.5 w-3.5 text-red-500" />,
  ignored: <Eye className="h-3.5 w-3.5 text-slate-400" />,
};

const TREND_LABELS: Record<string, { label: string; color: string }> = {
  strong_approval: { label: "Olive is on track", color: "text-emerald-600" },
  moderate_approval: { label: "Mostly good", color: "text-blue-600" },
  mixed: { label: "Learning", color: "text-amber-600" },
  low_approval: { label: "Needs adjustment", color: "text-red-600" },
};

export const ReflectionHistoryCard: React.FC = () => {
  const { getLearning, getReflections } = useTrust();
  const [learning, setLearning] = useState<any>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getLearning();
    setLearning(result);
    setLoading(false);
  }, [getLearning]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return null;

  if (!learning || learning.total_reflections === 0) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-lg">What Olive Has Learned</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            As you use Olive, she'll learn from your feedback. Insights will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const insights: LearningInsight[] = learning.insights || [];
  const displayInsights = expanded ? insights : insights.slice(0, 3);

  return (
    <Card className="border-border/50">
      <CardContent className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <Brain className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-lg">What Olive Has Learned</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          {learning.summary}
        </p>

        <div className="space-y-4">
          {displayInsights.map((insight) => (
            <InsightRow key={insight.action_type} insight={insight} />
          ))}
        </div>

        {/* Top lessons */}
        {learning.top_lessons && learning.top_lessons.length > 0 && (
          <div className="mt-6 pt-4 border-t border-border/50">
            <h4 className="text-sm font-medium text-muted-foreground mb-3">
              Recent Lessons
            </h4>
            <div className="space-y-2">
              {learning.top_lessons.slice(0, expanded ? 10 : 3).map((lesson: any, i: number) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-primary mt-0.5">•</span>
                  <span className="text-muted-foreground">{lesson.lesson}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {insights.length > 3 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="w-full mt-4 text-muted-foreground"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-4 w-4 mr-1" /> Show less
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-1" /> Show all {insights.length} insights
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

// ─── Individual Insight Row ─────────────────────────────────────

const InsightRow: React.FC<{ insight: LearningInsight }> = ({ insight }) => {
  const trend = TREND_LABELS[insight.trend] || TREND_LABELS.mixed;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{insight.label}</span>
        <span className={cn("text-xs font-medium", trend.color)}>
          {trend.label}
        </span>
      </div>

      {/* Acceptance rate bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              insight.acceptance_rate >= 70 ? "bg-emerald-500" :
              insight.acceptance_rate >= 40 ? "bg-amber-500" : "bg-red-400"
            )}
            style={{ width: `${insight.acceptance_rate}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground w-10 text-right">
          {insight.acceptance_rate}%
        </span>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          {OUTCOME_ICONS.accepted} {insight.stats.accepted}
        </span>
        <span className="flex items-center gap-1">
          {OUTCOME_ICONS.modified} {insight.stats.modified}
        </span>
        <span className="flex items-center gap-1">
          {OUTCOME_ICONS.rejected} {insight.stats.rejected}
        </span>
        <span className="flex items-center gap-1">
          {OUTCOME_ICONS.ignored} {insight.stats.ignored}
        </span>
        <span className="ml-auto">{insight.total_interactions} total</span>
      </div>
    </div>
  );
};

export default ReflectionHistoryCard;

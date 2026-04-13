/**
 * DailyBriefingView — Displays Olive's personalized daily briefing.
 *
 * Shows a structured briefing with sections for delegations, tasks,
 * activity, and completions. Can generate a new briefing on demand.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Newspaper,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Clock,
  CheckCircle,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDelegation, Briefing, BriefingSection } from "@/hooks/useDelegation";
import { useSpace } from "@/providers/SpaceProvider";
import { formatDistanceToNow } from "date-fns";

interface DailyBriefingViewProps {
  className?: string;
  compact?: boolean;
}

export const DailyBriefingView: React.FC<DailyBriefingViewProps> = ({
  className,
  compact = false,
}) => {
  const { getLatestBriefing, generateBriefing, markBriefingRead } = useDelegation();
  const { currentSpace } = useSpace();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState(!compact);

  const fetchBriefing = useCallback(async () => {
    setLoading(true);
    const data = await getLatestBriefing({
      space_id: currentSpace?.id,
      briefing_type: "daily",
    });
    setBriefing(data);
    setLoading(false);

    // Mark as read if it exists and hasn't been read
    if (data && !data.read_at) {
      await markBriefingRead(data.id);
    }
  }, [getLatestBriefing, currentSpace?.id, markBriefingRead]);

  useEffect(() => {
    fetchBriefing();
  }, [fetchBriefing]);

  const handleGenerate = async () => {
    setGenerating(true);
    const newBriefing = await generateBriefing({
      space_id: currentSpace?.id,
    });
    if (newBriefing) {
      setBriefing(newBriefing);
    }
    setGenerating(false);
  };

  if (loading) return null;

  // If no briefing exists, show a generate button
  if (!briefing) {
    return (
      <div className={cn("card-glass p-5", className)}>
        <div className="flex items-center gap-3 mb-3">
          <div className="icon-squircle w-10 h-10 bg-amber-500/10">
            <Newspaper className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-serif font-semibold text-[#2A3C24] text-base">Daily Briefing</h3>
            <p className="text-xs text-stone-500">No briefing yet for today</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleGenerate}
          disabled={generating}
          className="w-full"
        >
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", generating && "animate-spin")} />
          {generating ? "Generating..." : "Generate Briefing"}
        </Button>
      </div>
    );
  }

  // Check if briefing is stale (older than 12 hours)
  const briefingAge = Date.now() - new Date(briefing.created_at).getTime();
  const isStale = briefingAge > 12 * 60 * 60 * 1000;
  const timeAgo = formatDistanceToNow(new Date(briefing.created_at), { addSuffix: true });

  const sections: BriefingSection[] = briefing.sections || [];
  const displaySections = compact && !expanded ? sections.slice(0, 2) : sections;

  return (
    <div className={cn("card-glass overflow-hidden", className)}>
      {/* Header */}
      <div className="p-5 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="icon-squircle w-10 h-10 bg-amber-500/10">
              <Newspaper className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h3 className="font-serif font-semibold text-[#2A3C24] text-base">Daily Briefing</h3>
              <div className="flex items-center gap-1.5">
                <Clock className="h-3 w-3 text-stone-400" />
                <span className="text-[11px] text-stone-400">{timeAgo}</span>
                {isStale && (
                  <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full ml-1">
                    stale
                  </span>
                )}
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleGenerate}
            disabled={generating}
            className="h-8 px-2"
            title="Refresh briefing"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", generating && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="px-5 pb-3">
        <p className="text-sm text-stone-600">{briefing.summary}</p>
      </div>

      {/* Stats bar */}
      {(briefing.task_count > 0 || briefing.delegation_count > 0) && (
        <div className="px-5 pb-3 flex gap-3">
          {briefing.task_count > 0 && (
            <span className="text-xs text-stone-500 flex items-center gap-1">
              <CheckCircle className="h-3 w-3 text-primary" />
              {briefing.task_count} task{briefing.task_count !== 1 ? "s" : ""}
            </span>
          )}
          {briefing.delegation_count > 0 && (
            <span className="text-xs text-stone-500 flex items-center gap-1">
              <ExternalLink className="h-3 w-3 text-blue-500" />
              {briefing.delegation_count} delegation{briefing.delegation_count !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* Sections */}
      {displaySections.length > 0 && (
        <div className="px-5 pb-4 space-y-4">
          {displaySections.map((section, i) => (
            <BriefingSectionView key={i} section={section} />
          ))}
        </div>
      )}

      {/* Expand/collapse */}
      {compact && sections.length > 2 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full py-2.5 text-xs text-stone-500 hover:text-stone-700 hover:bg-stone-50 transition-colors flex items-center justify-center gap-1 border-t border-border/30"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" /> Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" /> Show all {sections.length} sections
            </>
          )}
        </button>
      )}
    </div>
  );
};

// ─── Briefing Section ─────────────────────────────────────────

const BriefingSectionView: React.FC<{ section: BriefingSection }> = ({ section }) => {
  return (
    <div>
      <h4 className="text-xs font-medium text-stone-500 mb-1.5">{section.heading}</h4>
      <div className="space-y-1">
        {section.items.map((item, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <span
              className={cn(
                "mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0",
                item.priority === "high" || item.priority === "urgent"
                  ? "bg-red-400"
                  : "bg-primary/40"
              )}
            />
            <span className="text-stone-600 text-[13px] leading-relaxed">{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DailyBriefingView;

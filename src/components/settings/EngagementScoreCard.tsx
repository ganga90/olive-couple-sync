/**
 * EngagementScoreCard — Displays the user's engagement score
 * and current proactivity level.
 *
 * The engagement score (0-100) governs how proactive Olive is.
 * Higher scores = more proactive behavior.
 */
import React, { useState, useEffect, useCallback } from "react";
import { Activity, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useTrust, EngagementData } from "@/hooks/useTrust";

const LEVEL_CONFIG: Record<
  string,
  { color: string; bg: string; icon: React.ReactNode }
> = {
  full: {
    color: "text-emerald-600",
    bg: "bg-emerald-500",
    icon: <TrendingUp className="h-4 w-4" />,
  },
  normal: {
    color: "text-blue-600",
    bg: "bg-blue-500",
    icon: <TrendingUp className="h-4 w-4" />,
  },
  conservative: {
    color: "text-amber-600",
    bg: "bg-amber-500",
    icon: <Minus className="h-4 w-4" />,
  },
  minimal: {
    color: "text-orange-600",
    bg: "bg-orange-500",
    icon: <TrendingDown className="h-4 w-4" />,
  },
  silent: {
    color: "text-slate-500",
    bg: "bg-slate-400",
    icon: <TrendingDown className="h-4 w-4" />,
  },
};

export const EngagementScoreCard: React.FC = () => {
  const { getEngagement } = useTrust();
  const [data, setData] = useState<EngagementData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchEngagement = useCallback(async () => {
    setLoading(true);
    const result = await getEngagement();
    setData(result);
    setLoading(false);
  }, [getEngagement]);

  useEffect(() => {
    fetchEngagement();
  }, [fetchEngagement]);

  if (loading || !data) return null;

  const config = LEVEL_CONFIG[data.proactivity_level] || LEVEL_CONFIG.normal;
  const score = data.score;

  return (
    <Card className="border-border/50">
      <CardContent className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-lg">Proactivity Level</h3>
        </div>

        {/* Score ring */}
        <div className="flex items-center gap-6 mb-4">
          <div className="relative w-20 h-20">
            <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className="text-muted/20"
              />
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeDasharray={`${(score / 100) * 97.4} 97.4`}
                strokeLinecap="round"
                className={config.color}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xl font-bold">{score}</span>
            </div>
          </div>

          <div className="flex-1">
            <div className={cn("flex items-center gap-1.5 font-semibold", config.color)}>
              {config.icon}
              <span className="capitalize">{data.proactivity_level}</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {data.proactivity_description}
            </p>
          </div>
        </div>

        {/* Score bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Silent</span>
            <span>Full</span>
          </div>
          <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", config.bg)}
              style={{ width: `${score}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground/50">
            <span>0</span>
            <span>20</span>
            <span>40</span>
            <span>60</span>
            <span>80</span>
            <span>100</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          This score updates based on how you interact with Olive's suggestions.
          Accept more, and Olive becomes more proactive.
        </p>
      </CardContent>
    </Card>
  );
};

export default EngagementScoreCard;

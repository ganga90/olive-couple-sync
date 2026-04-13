/**
 * TrustSettingsCard — View and adjust Olive's trust levels per action.
 *
 * Displays the trust matrix as a list of action types with sliders.
 * Users can adjust how much autonomy Olive has for each type.
 */
import React, { useState, useEffect, useCallback } from "react";
import { Shield, ChevronDown, ChevronUp, Info, Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useTrust,
  TrustMatrixEntry,
  TrustLevel,
  TRUST_LEVEL_NAMES,
  TRUST_LEVEL_DESCRIPTIONS,
} from "@/hooks/useTrust";

const TRUST_COLORS: Record<TrustLevel, string> = {
  0: "bg-slate-300",
  1: "bg-amber-400",
  2: "bg-blue-500",
  3: "bg-emerald-500",
};

export const TrustSettingsCard: React.FC = () => {
  const { getTrustMatrix, adjustTrust } = useTrust();
  const [matrix, setMatrix] = useState<TrustMatrixEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [adjusting, setAdjusting] = useState<string | null>(null);

  const fetchMatrix = useCallback(async () => {
    setLoading(true);
    const data = await getTrustMatrix();
    setMatrix(data);
    setLoading(false);
  }, [getTrustMatrix]);

  useEffect(() => {
    fetchMatrix();
  }, [fetchMatrix]);

  const handleAdjust = async (actionType: string, newLevel: TrustLevel) => {
    setAdjusting(actionType);
    const success = await adjustTrust(actionType, newLevel);
    if (success) {
      setMatrix((prev) =>
        prev.map((entry) =>
          entry.action_type === actionType
            ? {
                ...entry,
                trust_level: newLevel,
                trust_level_name: TRUST_LEVEL_NAMES[newLevel],
              }
            : entry
        )
      );
      toast.success(`Updated "${entry(actionType)}" to ${TRUST_LEVEL_NAMES[newLevel]}`);
    } else {
      toast.error("Failed to update trust level");
    }
    setAdjusting(null);
  };

  function entry(actionType: string) {
    return actionType.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  }

  const displayMatrix = expanded ? matrix : matrix.slice(0, 5);

  return (
    <Card className="border-border/50">
      <CardContent className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-lg">Trust & Autonomy</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Control how much Olive can do on her own. Higher trust means more
          autonomy. You can always change these.
        </p>

        {loading ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            Loading trust settings...
          </div>
        ) : matrix.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No trust settings yet. They'll appear as you use Olive.
          </div>
        ) : (
          <TooltipProvider>
            <div className="space-y-4">
              {displayMatrix.map((entry) => (
                <TrustRow
                  key={entry.action_type}
                  entry={entry}
                  adjusting={adjusting === entry.action_type}
                  onAdjust={(level) =>
                    handleAdjust(entry.action_type, level as TrustLevel)
                  }
                />
              ))}
            </div>

            {matrix.length > 5 && (
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
                    <ChevronDown className="h-4 w-4 mr-1" /> Show all{" "}
                    {matrix.length} actions
                  </>
                )}
              </Button>
            )}
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
};

// ─── Individual Trust Row ───────────────────────────────────────

const TrustRow: React.FC<{
  entry: TrustMatrixEntry;
  adjusting: boolean;
  onAdjust: (level: number) => void;
}> = ({ entry, adjusting, onAdjust }) => {
  const levels: TrustLevel[] = [0, 1, 2, 3];
  const currentLevel = entry.trust_level as TrustLevel;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{entry.label}</span>
          {entry.is_high_risk && (
            <Tooltip>
              <TooltipTrigger>
                <Lock className="h-3.5 w-3.5 text-amber-500" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">
                  Sensitive action. Max level: {TRUST_LEVEL_NAMES[entry.max_level as TrustLevel]}
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <Tooltip>
          <TooltipTrigger>
            <span
              className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-full",
                currentLevel === 0 && "bg-slate-100 text-slate-600",
                currentLevel === 1 && "bg-amber-100 text-amber-700",
                currentLevel === 2 && "bg-blue-100 text-blue-700",
                currentLevel === 3 && "bg-emerald-100 text-emerald-700"
              )}
            >
              {TRUST_LEVEL_NAMES[currentLevel]}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs max-w-[200px]">
              {TRUST_LEVEL_DESCRIPTIONS[currentLevel]}
            </p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Trust level selector */}
      <div className="flex gap-1">
        {levels.map((level) => {
          const disabled = level > entry.max_level || adjusting;
          const active = level <= currentLevel;

          return (
            <button
              key={level}
              disabled={disabled}
              onClick={() => {
                if (level !== currentLevel) onAdjust(level);
              }}
              className={cn(
                "flex-1 h-2 rounded-full transition-all",
                active ? TRUST_COLORS[level] : "bg-muted",
                disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer hover:opacity-80"
              )}
              title={TRUST_LEVEL_NAMES[level]}
            />
          );
        })}
      </div>
    </div>
  );
};

export default TrustSettingsCard;

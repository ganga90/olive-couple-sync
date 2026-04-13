/**
 * DelegationCard — Shows incoming delegations with accept/snooze/reassign actions.
 *
 * Displays pending delegations assigned to the current user with quick-action buttons.
 * Auto-hides when there are no pending delegations.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  CheckCircle,
  Clock,
  XCircle,
  ArrowRight,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useDelegation, Delegation } from "@/hooks/useDelegation";
import { useSpace } from "@/providers/SpaceProvider";
import { formatDistanceToNow } from "date-fns";

const PRIORITY_CONFIG: Record<string, { color: string; label: string; icon?: React.ReactNode }> = {
  urgent: { color: "text-red-600 bg-red-50 border-red-200", label: "Urgent", icon: <AlertTriangle className="h-3 w-3" /> },
  high: { color: "text-orange-600 bg-orange-50 border-orange-200", label: "High" },
  normal: { color: "text-blue-600 bg-blue-50 border-blue-200", label: "Normal" },
  low: { color: "text-stone-500 bg-stone-50 border-stone-200", label: "Low" },
};

interface DelegationCardProps {
  className?: string;
  compact?: boolean;
}

export const DelegationCard: React.FC<DelegationCardProps> = ({ className, compact = false }) => {
  const { listIncoming, acceptDelegation, snoozeDelegation, declineDelegation } = useDelegation();
  const { currentSpace } = useSpace();
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const fetchDelegations = useCallback(async () => {
    setLoading(true);
    const data = await listIncoming({
      space_id: currentSpace?.id,
    });
    setDelegations(data);
    setLoading(false);
  }, [listIncoming, currentSpace?.id]);

  useEffect(() => {
    fetchDelegations();
  }, [fetchDelegations]);

  if (loading && delegations.length === 0) return null;
  if (delegations.length === 0) return null;

  const displayDelegations = compact
    ? delegations.slice(0, expanded ? delegations.length : 2)
    : delegations;

  return (
    <div className={cn("card-glass overflow-hidden", className)}>
      <div className="p-5 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="icon-squircle w-10 h-10 bg-primary/10">
              <Send className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-serif font-semibold text-[#2A3C24] text-base">
                Delegated to You
              </h3>
              <p className="text-xs text-stone-500">
                {delegations.length} task{delegations.length !== 1 ? "s" : ""} need your response
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchDelegations}
            className="h-8 px-2"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="px-5 pb-4 space-y-3">
        {displayDelegations.map((delegation) => (
          <DelegationItem
            key={delegation.id}
            delegation={delegation}
            onAccept={async () => {
              const result = await acceptDelegation(delegation.id);
              if (result?.success) {
                setDelegations((prev) => prev.filter((d) => d.id !== delegation.id));
                toast.success("Accepted! Task is now yours.");
              }
            }}
            onSnooze={async (until) => {
              const result = await snoozeDelegation(delegation.id, until);
              if (result?.success) {
                setDelegations((prev) =>
                  prev.map((d) =>
                    d.id === delegation.id ? { ...d, status: "snoozed" as const, snoozed_until: result.snoozed_until } : d
                  )
                );
                toast.success("Snoozed. We'll remind you later.");
              }
            }}
            onDecline={async (reason) => {
              const result = await declineDelegation(delegation.id, reason);
              if (result?.success) {
                setDelegations((prev) => prev.filter((d) => d.id !== delegation.id));
                toast.success("Declined.");
              }
            }}
          />
        ))}
      </div>

      {compact && delegations.length > 2 && (
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
              <ChevronDown className="h-3.5 w-3.5" /> {delegations.length - 2} more
            </>
          )}
        </button>
      )}
    </div>
  );
};

// ─── Individual Delegation Item ───────────────────────────────

interface DelegationItemProps {
  delegation: Delegation;
  onAccept: () => Promise<void>;
  onSnooze: (until?: string) => Promise<void>;
  onDecline: (reason?: string) => Promise<void>;
}

const DelegationItem: React.FC<DelegationItemProps> = ({
  delegation,
  onAccept,
  onSnooze,
  onDecline,
}) => {
  const [showDeclineInput, setShowDeclineInput] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [processing, setProcessing] = useState(false);

  const priorityConfig = PRIORITY_CONFIG[delegation.priority] || PRIORITY_CONFIG.normal;
  const timeAgo = formatDistanceToNow(new Date(delegation.created_at), { addSuffix: true });
  const isSnoozed = delegation.status === "snoozed";

  const handleAccept = async () => {
    setProcessing(true);
    await onAccept();
    setProcessing(false);
  };

  const handleSnooze = async () => {
    setProcessing(true);
    // Default snooze: 4 hours
    const until = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    await onSnooze(until);
    setProcessing(false);
  };

  const handleDecline = async () => {
    setProcessing(true);
    await onDecline(declineReason || undefined);
    setProcessing(false);
  };

  return (
    <div className="bg-background rounded-xl p-4 border border-border/50 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {delegation.priority !== "normal" && (
              <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border", priorityConfig.color)}>
                {priorityConfig.icon}
                {priorityConfig.label}
              </span>
            )}
            {delegation.suggested_by === "olive" && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--magic-accent))] bg-[hsl(var(--magic-accent))]/10 px-1.5 py-0.5 rounded-full">
                <Sparkles className="h-2.5 w-2.5" /> Olive suggested
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-[#2A3C24]">{delegation.title}</p>
          {delegation.description && (
            <p className="text-xs text-stone-500 mt-0.5 line-clamp-2">{delegation.description}</p>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[11px] text-stone-400">
              from {delegation.delegated_by_name || "someone"} · {timeAgo}
            </span>
            {isSnoozed && delegation.snoozed_until && (
              <span className="text-[11px] text-amber-600 flex items-center gap-0.5">
                <Clock className="h-3 w-3" />
                snoozed until {new Date(delegation.snoozed_until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
          {delegation.reasoning && (
            <p className="text-[11px] text-[hsl(var(--magic-accent))] mt-1 italic">
              "{delegation.reasoning}"
            </p>
          )}
        </div>
      </div>

      {/* Decline reason input */}
      {showDeclineInput && (
        <Input
          value={declineReason}
          onChange={(e) => setDeclineReason(e.target.value)}
          placeholder="Why not? (optional)"
          className="text-sm h-9"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleDecline();
          }}
        />
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={handleAccept}
          disabled={processing}
          className="flex-1"
        >
          <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
          Accept
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSnooze}
          disabled={processing}
          className="flex-1"
        >
          <Clock className="h-3.5 w-3.5 mr-1.5" />
          Snooze
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (showDeclineInput) {
              handleDecline();
            } else {
              setShowDeclineInput(true);
            }
          }}
          disabled={processing}
          className="flex-1"
        >
          <XCircle className="h-3.5 w-3.5 mr-1.5" />
          {showDeclineInput ? "Submit" : "Decline"}
        </Button>
      </div>
    </div>
  );
};

export default DelegationCard;

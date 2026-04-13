/**
 * TrustApprovalCard — Shows pending actions that need user approval.
 *
 * When Olive's trust level isn't high enough for auto-execution,
 * actions queue here for the user to approve or reject.
 */
import React, { useState, useEffect, useCallback } from "react";
import { CheckCircle, XCircle, Clock, Sparkles, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTrust, PendingAction, TRUST_LEVEL_NAMES, TrustLevel } from "@/hooks/useTrust";
import { formatDistanceToNow } from "date-fns";

export const TrustApprovalCard: React.FC = () => {
  const { listPending, approveAction, rejectAction } = useTrust();
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    const data = await listPending();
    setActions(data);
    setLoading(false);
  }, [listPending]);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  if (loading && actions.length === 0) return null;
  if (actions.length === 0) return null;

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-lg">Olive Needs Your Input</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchPending}
            className="h-8 px-2"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>

        <div className="space-y-3">
          {actions.map((action) => (
            <PendingActionItem
              key={action.id}
              action={action}
              onApprove={async (id, response) => {
                const success = await approveAction(id, response);
                if (success) {
                  setActions((prev) => prev.filter((a) => a.id !== id));
                  toast.success("Approved! Olive will proceed.");
                }
              }}
              onReject={async (id, reason) => {
                const success = await rejectAction(id, reason);
                if (success) {
                  setActions((prev) => prev.filter((a) => a.id !== id));
                  toast.success("Noted. Olive will learn from this.");
                }
              }}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

// ─── Individual Pending Action ──────────────────────────────────

const PendingActionItem: React.FC<{
  action: PendingAction;
  onApprove: (id: string, response?: string) => Promise<void>;
  onReject: (id: string, reason?: string) => Promise<void>;
}> = ({ action, onApprove, onReject }) => {
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");
  const [processing, setProcessing] = useState(false);

  const handleApprove = async () => {
    setProcessing(true);
    await onApprove(action.id);
    setProcessing(false);
  };

  const handleReject = async () => {
    setProcessing(true);
    await onReject(action.id, reason || undefined);
    setProcessing(false);
  };

  const timeAgo = formatDistanceToNow(new Date(action.created_at), {
    addSuffix: true,
  });

  const trustName = TRUST_LEVEL_NAMES[action.trust_level as TrustLevel] || "Unknown";

  return (
    <div className="bg-background rounded-xl p-4 border border-border/50 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{action.action_description}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground">{timeAgo}</span>
            <span className="text-xs text-muted-foreground">
              Trust: {trustName}
            </span>
          </div>
        </div>
        <Clock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      </div>

      {showReason && (
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why not? (optional)"
          className="text-sm h-9"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleReject();
          }}
        />
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={handleApprove}
          disabled={processing}
          className="flex-1"
        >
          <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
          {action.trust_level === 0 ? "Yes, do it" : "Approve"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (showReason) {
              handleReject();
            } else {
              setShowReason(true);
            }
          }}
          disabled={processing}
          className="flex-1"
        >
          <XCircle className="h-3.5 w-3.5 mr-1.5" />
          {showReason ? "Submit" : "Not now"}
        </Button>
      </div>
    </div>
  );
};

export default TrustApprovalCard;

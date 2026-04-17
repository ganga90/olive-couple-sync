/**
 * ExpenseSplitCard — Create and manage expense splits between space members.
 *
 * Supports equal, percentage, and exact splits with settlement tracking.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Receipt,
  Check,
  Plus,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseClient";
import { useSpace } from "@/providers/SpaceProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { formatDistanceToNow } from "date-fns";

interface ExpenseSplit {
  id: string;
  description: string;
  total_amount: number;
  currency: string;
  split_type: string;
  is_settled: boolean;
  created_at: string;
  shares: Array<{
    id: string;
    user_id: string;
    amount: number;
    is_paid: boolean;
  }>;
}

interface ExpenseSplitCardProps {
  className?: string;
}

export const ExpenseSplitCard: React.FC<ExpenseSplitCardProps> = ({ className }) => {
  const { currentSpace } = useSpace();
  const { notifySuccess, impactLight } = useHaptics();
  const [splits, setSplits] = useState<ExpenseSplit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchSplits = useCallback(async () => {
    if (!currentSpace) return;
    setLoading(true);

    const { data, error } = await supabase
      .from("olive_expense_splits")
      .select(`
        *,
        shares:olive_expense_split_shares(*)
      `)
      .eq("space_id", currentSpace.id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (!error && data) {
      setSplits(data as unknown as ExpenseSplit[]);
    }
    setLoading(false);
  }, [currentSpace]);

  useEffect(() => {
    fetchSplits();
  }, [fetchSplits]);

  const handleCreateSplit = async () => {
    if (!currentSpace || !description.trim() || !amount) return;
    setCreating(true);

    const totalAmount = parseFloat(amount);
    if (isNaN(totalAmount) || totalAmount <= 0) {
      toast.error("Please enter a valid amount");
      setCreating(false);
      return;
    }

    // Get space members for equal split
    const { data: members } = await supabase
      .from("olive_space_members")
      .select("user_id")
      .eq("space_id", currentSpace.id);

    if (!members || members.length < 2) {
      toast.error("Need at least 2 space members to split expenses");
      setCreating(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id;
    if (!userId) {
      setCreating(false);
      return;
    }

    // Create split
    const { data: split, error: splitErr } = await supabase
      .from("olive_expense_splits")
      .insert({
        space_id: currentSpace.id,
        created_by: userId,
        description: description.trim(),
        total_amount: totalAmount,
        split_type: "equal",
      })
      .select()
      .single();

    if (splitErr || !split) {
      toast.error("Failed to create split");
      setCreating(false);
      return;
    }

    // Create equal shares
    const shareAmount = Math.round((totalAmount / members.length) * 100) / 100;
    const shares = members.map((m: any) => ({
      split_id: split.id,
      user_id: m.user_id,
      amount: shareAmount,
      is_paid: m.user_id === userId, // Creator auto-paid
    }));

    await supabase.from("olive_expense_split_shares").insert(shares);

    // Log engagement
    try {
      await supabase.from("olive_engagement_events").insert({
        user_id: userId,
        event_type: "expense_split_created",
        metadata: { split_id: split.id, amount: totalAmount, members: members.length },
      });
    } catch { /* non-blocking */ }

    notifySuccess();
    toast.success(`Split $${totalAmount.toFixed(2)} between ${members.length} members`);
    setDescription("");
    setAmount("");
    setShowForm(false);
    await fetchSplits();
    setCreating(false);
  };

  const handleMarkPaid = async (shareId: string) => {
    impactLight();
    const { error } = await supabase
      .from("olive_expense_split_shares")
      .update({ is_paid: true, paid_at: new Date().toISOString() })
      .eq("id", shareId);

    if (!error) {
      toast.success("Marked as paid");
      await fetchSplits();
    }
  };

  const handleSettleSplit = async (splitId: string) => {
    const { error } = await supabase
      .from("olive_expense_splits")
      .update({ is_settled: true, settled_at: new Date().toISOString() })
      .eq("id", splitId);

    if (!error) {
      const { data: { user } } = await supabase.auth.getUser();
      try {
        await supabase.from("olive_engagement_events").insert({
          user_id: user?.id,
          event_type: "expense_split_settled",
          metadata: { split_id: splitId },
        });
      } catch { /* non-blocking */ }

      toast.success("Expense settled!");
      await fetchSplits();
    }
  };

  if (loading) return null;

  const unsettled = splits.filter((s) => !s.is_settled);
  const settled = splits.filter((s) => s.is_settled);
  const totalOwed = unsettled.reduce((sum, s) => {
    const unpaid = (s.shares || []).filter((sh) => !sh.is_paid).reduce((a, sh) => a + sh.amount, 0);
    return sum + unpaid;
  }, 0);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Summary */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{unsettled.length} open splits</span>
            {totalOwed > 0 && (
              <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
                ${totalOwed.toFixed(2)} outstanding
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {settled.length} settled
          </p>
        </div>
      </div>

      {/* Quick add */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowForm(!showForm)}
        className="w-full"
      >
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        {showForm ? "Cancel" : "New Expense Split"}
      </Button>

      {showForm && (
        <div className="space-y-2 bg-muted/20 rounded-xl p-3">
          <Input
            placeholder="What's the expense for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="text-base"
          />
          <Input
            placeholder="Amount ($)"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="text-base"
          />
          <Button
            size="sm"
            onClick={handleCreateSplit}
            disabled={creating || !description.trim() || !amount}
            className="w-full"
          >
            {creating ? "Creating..." : "Split Equally"}
          </Button>
        </div>
      )}

      {/* Unsettled splits */}
      {unsettled.slice(0, showAll ? undefined : 3).map((split) => {
        const allPaid = (split.shares || []).every((sh) => sh.is_paid);
        return (
          <div key={split.id} className="text-xs bg-muted/20 rounded-lg p-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium">{split.description}</span>
              <span className="font-bold">${split.total_amount.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Users className="h-3 w-3" />
              <span>{split.shares?.length || 0} people</span>
              <span className="ml-auto">
                {formatDistanceToNow(new Date(split.created_at), { addSuffix: true })}
              </span>
            </div>
            {/* Share status */}
            <div className="flex gap-1.5 flex-wrap">
              {(split.shares || []).map((share) => (
                <button
                  key={share.id}
                  type="button"
                  className={cn(
                    "text-xs px-2.5 py-1.5 min-h-[36px] rounded-full transition-colors",
                    share.is_paid
                      ? "bg-emerald-50 text-emerald-600"
                      : "bg-amber-50 text-amber-600 active:bg-amber-100"
                  )}
                  onClick={() => !share.is_paid && handleMarkPaid(share.id)}
                  disabled={share.is_paid}
                  aria-label={share.is_paid ? `$${share.amount.toFixed(2)} paid` : `Mark $${share.amount.toFixed(2)} as paid`}
                >
                  ${share.amount.toFixed(2)} {share.is_paid ? "✓" : "⏳"}
                </button>
              ))}
            </div>
            {allPaid && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSettleSplit(split.id)}
                className="w-full text-xs min-h-[44px]"
              >
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Settle
              </Button>
            )}
          </div>
        );
      })}

      {unsettled.length > 3 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="flex items-center gap-1 text-xs text-muted-foreground active:text-foreground hover:text-foreground transition-colors w-full justify-center py-2.5 min-h-[44px]"
          aria-label={showAll ? "Show fewer splits" : `Show all ${unsettled.length} splits`}
        >
          {showAll ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {showAll ? "Show less" : `Show all ${unsettled.length} splits`}
        </button>
      )}

      <p className="text-[11px] text-muted-foreground">
        Split expenses equally with your team. Tap amounts to mark as paid.
      </p>
    </div>
  );
};

export default ExpenseSplitCard;

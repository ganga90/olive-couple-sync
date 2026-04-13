/**
 * SubscriptionCard — Shows current plan, usage meters, and upgrade options.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Crown,
  Zap,
  MessageSquare,
  FileText,
  ArrowUpRight,
  Loader2,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSubscription, PricingPlan, UsageData } from "@/hooks/useSubscription";

interface SubscriptionCardProps {
  className?: string;
}

export const SubscriptionCard: React.FC<SubscriptionCardProps> = ({ className }) => {
  const { getPlans, getSubscription, getUsage, createCheckout, cancelSubscription } = useSubscription();
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [currentPlan, setCurrentPlan] = useState<PricingPlan | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [showPlans, setShowPlans] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [plansData, subData, usageData] = await Promise.all([
      getPlans(),
      getSubscription(),
      getUsage(),
    ]);
    setPlans(plansData);
    setCurrentPlan(subData.plan);
    setUsage(usageData);
    setLoading(false);
  }, [getPlans, getSubscription, getUsage]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleUpgrade = async (planId: string) => {
    setUpgrading(planId);
    const result = await createCheckout(planId, "monthly");
    if (result?.checkout_url) {
      window.location.href = result.checkout_url;
    } else if (result?.success && result?.mode === "beta") {
      toast.success(`Upgraded to ${planId} plan (beta)`);
      await fetchData();
    } else {
      toast.error(result?.error || "Checkout failed");
    }
    setUpgrading(null);
  };

  if (loading) return null;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Current Plan */}
      {currentPlan && (
        <div className="flex items-center gap-4">
          <div className={cn(
            "w-12 h-12 rounded-2xl flex items-center justify-center",
            currentPlan.plan_id === "free" ? "bg-stone-100 text-stone-500" : "bg-primary/10 text-primary"
          )}>
            <Crown className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{currentPlan.name}</span>
              {currentPlan.plan_id !== "free" && (
                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
                  Active
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{currentPlan.description}</p>
          </div>
        </div>
      )}

      {/* Usage Meters */}
      {usage && usage.limits && (
        <div className="space-y-2">
          <UsageMeter
            icon={<Zap className="h-3 w-3" />}
            label="AI Requests (today)"
            current={usage.today.ai_requests}
            max={usage.limits.max_ai_requests_per_day}
          />
          <UsageMeter
            icon={<MessageSquare className="h-3 w-3" />}
            label="WhatsApp (today)"
            current={usage.today.whatsapp_messages_sent}
            max={usage.limits.max_whatsapp_messages_per_day}
          />
          <UsageMeter
            icon={<FileText className="h-3 w-3" />}
            label="Notes (this month)"
            current={usage.month.notes_created}
            max={usage.limits.max_notes_per_month}
          />
        </div>
      )}

      {/* Upgrade Button */}
      {currentPlan?.plan_id === "free" && (
        <Button
          size="sm"
          onClick={() => setShowPlans(!showPlans)}
          className="w-full"
        >
          <ArrowUpRight className="h-3.5 w-3.5 mr-1.5" />
          {showPlans ? "Hide Plans" : "Upgrade Plan"}
        </Button>
      )}

      {/* Plan Comparison */}
      {showPlans && (
        <div className="space-y-2">
          {plans.filter((p) => p.plan_id !== "free").map((plan) => (
            <div
              key={plan.plan_id}
              className={cn(
                "rounded-xl border p-3 transition-all",
                plan.is_popular ? "border-primary bg-primary/5" : "border-border"
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{plan.name}</span>
                  {plan.is_popular && (
                    <span className="text-[10px] bg-primary text-white px-1.5 py-0.5 rounded-full">
                      Popular
                    </span>
                  )}
                </div>
                <span className="text-sm font-bold">${(plan.price_monthly_cents / 100).toFixed(2)}/mo</span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">{plan.description}</p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {Object.entries(plan.features).filter(([, v]) => v).map(([feature]) => (
                  <span key={feature} className="text-xs bg-muted/30 text-muted-foreground px-2 py-1 rounded-full flex items-center gap-1">
                    <Check className="h-3 w-3" />
                    {feature.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
              <Button
                size="sm"
                variant={plan.is_popular ? "default" : "outline"}
                onClick={() => handleUpgrade(plan.plan_id)}
                disabled={upgrading === plan.plan_id || currentPlan?.plan_id === plan.plan_id}
                className="w-full text-xs"
              >
                {upgrading === plan.plan_id ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : currentPlan?.plan_id === plan.plan_id ? (
                  "Current Plan"
                ) : (
                  "Upgrade"
                )}
              </Button>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Free during beta. Plans activate when beta ends.
      </p>
    </div>
  );
};

const UsageMeter: React.FC<{
  icon: React.ReactNode;
  label: string;
  current: number;
  max: number;
}> = ({ icon, label, current, max }) => {
  const pct = max > 0 ? Math.min((current / max) * 100, 100) : 0;
  const color = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">
          {icon} {label}
        </span>
        <span className="font-medium">{current}/{max}</span>
      </div>
      <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    </div>
  );
};

export default SubscriptionCard;

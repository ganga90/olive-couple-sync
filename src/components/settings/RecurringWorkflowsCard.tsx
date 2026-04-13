/**
 * RecurringWorkflowsCard — Manage recurring automated workflows.
 *
 * Shows available workflow templates (weekly review, monthly budget, client follow-up)
 * with activate/deactivate, schedule selection, and manual run capabilities.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  CalendarCheck,
  TrendingUp,
  UserCheck,
  Play,
  Pause,
  Loader2,
  Check,
  Clock,
  ChevronDown,
  ChevronUp,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useBusinessTools,
  WorkflowTemplate,
  WorkflowInstance,
} from "@/hooks/useBusinessTools";
import { useSpace } from "@/providers/SpaceProvider";
import { formatDistanceToNow } from "date-fns";

const WORKFLOW_ICONS: Record<string, React.ReactNode> = {
  "weekly-review": <CalendarCheck className="h-5 w-5" />,
  "monthly-budget-review": <TrendingUp className="h-5 w-5" />,
  "client-follow-up": <UserCheck className="h-5 w-5" />,
};

const WORKFLOW_COLORS: Record<string, string> = {
  productivity: "bg-blue-50 text-blue-600",
  finance: "bg-emerald-50 text-emerald-600",
  client: "bg-violet-50 text-violet-600",
  team: "bg-orange-50 text-orange-600",
};

interface RecurringWorkflowsCardProps {
  className?: string;
}

export const RecurringWorkflowsCard: React.FC<RecurringWorkflowsCardProps> = ({ className }) => {
  const {
    listWorkflowTemplates,
    activateWorkflow,
    deactivateWorkflow,
    getWorkflowInstances,
    runWorkflow,
  } = useBusinessTools();
  const { currentSpace } = useSpace();

  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!currentSpace) return;
    setLoading(true);
    const [tpls, insts] = await Promise.all([
      listWorkflowTemplates(currentSpace.type),
      getWorkflowInstances(currentSpace.id),
    ]);
    setTemplates(tpls);
    setInstances(insts);
    setLoading(false);
  }, [listWorkflowTemplates, getWorkflowInstances, currentSpace]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const instanceMap = new Map(instances.map((i) => [i.workflow_id, i]));

  const handleToggle = async (template: WorkflowTemplate) => {
    if (!currentSpace) return;
    const instance = instanceMap.get(template.workflow_id);
    setActivating(template.workflow_id);

    if (instance?.is_enabled) {
      const result = await deactivateWorkflow(template.workflow_id, currentSpace.id);
      if (result?.success) {
        toast.success(`${template.name} deactivated`);
        await fetchData();
      }
    } else {
      const result = await activateWorkflow(template.workflow_id, currentSpace.id);
      if (result?.success) {
        toast.success(`${template.name} activated!`);
        await fetchData();
      } else {
        toast.error(result?.error || "Failed to activate workflow");
      }
    }
    setActivating(null);
  };

  const handleRun = async (instance: WorkflowInstance) => {
    setRunning(instance.id);
    const result = await runWorkflow(instance.id);
    if (result?.success) {
      toast.success(`${instance.template?.name || "Workflow"} completed (${result.steps_completed} steps)`);
      await fetchData();
    } else {
      toast.error(result?.error || "Workflow failed");
    }
    setRunning(null);
  };

  if (loading) return null;

  return (
    <div className={cn("space-y-3", className)}>
      {templates.map((template) => {
        const instance = instanceMap.get(template.workflow_id);
        const isActive = instance?.is_enabled ?? false;
        const isExpanded = expandedId === template.workflow_id;
        const colorClass = WORKFLOW_COLORS[template.category] || "bg-stone-50 text-stone-600";

        return (
          <div
            key={template.workflow_id}
            className={cn(
              "rounded-xl border p-3 transition-all",
              isActive ? "border-primary/30 bg-primary/5" : "border-border"
            )}
          >
            <div className="flex items-center gap-3">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", colorClass)}>
                {WORKFLOW_ICONS[template.workflow_id] || <Zap className="h-5 w-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{template.name}</span>
                  {isActive && (
                    <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{template.description}</p>
              </div>
              <button
                onClick={() => setExpandedId(isExpanded ? null : template.workflow_id)}
                className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground active:text-foreground hover:text-foreground rounded-lg transition-colors"
                aria-label={isExpanded ? `Collapse ${template.name}` : `Expand ${template.name}`}
              >
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </div>

            {isExpanded && (
              <div className="mt-3 pt-3 border-t space-y-2">
                {/* Schedule info */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>
                    Schedule: {
                      (template.schedule_options || []).find(
                        (o) => o.value === (instance?.schedule_override || template.default_schedule)
                      )?.label || template.default_schedule
                    }
                  </span>
                </div>

                {/* Steps */}
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{template.steps.length} steps: </span>
                  {template.steps.map((s) => s.name).join(" → ")}
                </div>

                {/* Last run info */}
                {instance?.last_run_at && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Check className="h-3 w-3" />
                    <span>
                      Last run: {formatDistanceToNow(new Date(instance.last_run_at), { addSuffix: true })}
                      {instance.last_run_status && ` (${instance.last_run_status})`}
                    </span>
                    <span className="ml-auto">{instance.run_count} total runs</span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <Button
                    variant={isActive ? "outline" : "default"}
                    size="sm"
                    onClick={() => handleToggle(template)}
                    disabled={activating === template.workflow_id}
                    className="flex-1 text-xs"
                  >
                    {activating === template.workflow_id ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : isActive ? (
                      <Pause className="h-3 w-3 mr-1" />
                    ) : (
                      <Play className="h-3 w-3 mr-1" />
                    )}
                    {isActive ? "Deactivate" : "Activate"}
                  </Button>
                  {instance?.is_enabled && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRun(instance)}
                      disabled={running === instance.id}
                      className="flex-1 text-xs"
                    >
                      {running === instance.id ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3 mr-1" />
                      )}
                      Run Now
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {templates.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">
          No workflows available for this space type.
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">
        Recurring workflows run automatically on their schedule. You can also trigger them manually.
      </p>
    </div>
  );
};

export default RecurringWorkflowsCard;

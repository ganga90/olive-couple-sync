/**
 * IndustryTemplateSelector — Browse and apply industry-specific starter kits.
 *
 * Shows available templates with preview of what they include,
 * and allows applying/removing templates from the current space.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Home,
  Hammer,
  Laptop,
  Users,
  Check,
  Loader2,
  ChevronDown,
  ChevronUp,
  List,
  Zap,
  DollarSign,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useBusinessTools, IndustryTemplate, AppliedTemplate } from "@/hooks/useBusinessTools";
import { useSpace } from "@/providers/SpaceProvider";

const INDUSTRY_ICONS: Record<string, React.ReactNode> = {
  realtor: <Home className="h-5 w-5" />,
  contractor: <Hammer className="h-5 w-5" />,
  freelancer: <Laptop className="h-5 w-5" />,
  small_team: <Users className="h-5 w-5" />,
};

const INDUSTRY_COLORS: Record<string, string> = {
  realtor: "bg-blue-50 text-blue-600 border-blue-200",
  contractor: "bg-orange-50 text-orange-600 border-orange-200",
  freelancer: "bg-violet-50 text-violet-600 border-violet-200",
  small_team: "bg-emerald-50 text-emerald-600 border-emerald-200",
};

interface IndustryTemplateSelectorProps {
  className?: string;
}

export const IndustryTemplateSelector: React.FC<IndustryTemplateSelectorProps> = ({ className }) => {
  const { listTemplates, applyTemplate, getAppliedTemplates, removeTemplate } = useBusinessTools();
  const { currentSpace } = useSpace();
  const [templates, setTemplates] = useState<IndustryTemplate[]>([]);
  const [applied, setApplied] = useState<AppliedTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!currentSpace) return;
    setLoading(true);
    const [tpls, appliedTpls] = await Promise.all([
      listTemplates(),
      getAppliedTemplates(currentSpace.id),
    ]);
    setTemplates(tpls);
    setApplied(appliedTpls);
    setLoading(false);
  }, [listTemplates, getAppliedTemplates, currentSpace]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleApply = async (templateId: string) => {
    if (!currentSpace) return;
    setApplying(templateId);
    const result = await applyTemplate(currentSpace.id, templateId);
    if (result?.success) {
      toast.success(`${result.template} template applied! ${result.lists_created} lists, ${result.skills_enabled} skills, ${result.budgets_created} budgets created.`);
      await fetchData();
    } else {
      toast.error(result?.error || "Failed to apply template");
    }
    setApplying(null);
  };

  const handleRemove = async (templateId: string) => {
    if (!currentSpace) return;
    const result = await removeTemplate(currentSpace.id, templateId);
    if (result?.success) {
      toast.success("Template removed");
      await fetchData();
    }
  };

  if (loading) return null;

  const appliedIds = new Set(applied.map((a) => a.template_id));

  return (
    <div className={cn("space-y-3", className)}>
      {templates.map((tpl) => {
        const isApplied = appliedIds.has(tpl.id);
        const isExpanded = expandedId === tpl.id;
        const colorClass = INDUSTRY_COLORS[tpl.industry] || "bg-stone-50 text-stone-600 border-stone-200";

        return (
          <div
            key={tpl.id}
            className={cn(
              "rounded-xl border p-3 transition-all",
              isApplied ? "border-emerald-200 bg-emerald-50/30" : "border-border"
            )}
          >
            <div className="flex items-center gap-3">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", colorClass)}>
                {INDUSTRY_ICONS[tpl.industry] || <Sparkles className="h-5 w-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{tpl.name}</span>
                  {isApplied && (
                    <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">
                      Applied
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{tpl.description}</p>
              </div>
              <button
                onClick={() => setExpandedId(isExpanded ? null : tpl.id)}
                className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground active:text-foreground hover:text-foreground rounded-lg transition-colors"
                aria-label={isExpanded ? `Collapse ${tpl.name}` : `Expand ${tpl.name}`}
              >
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </div>

            {isExpanded && (
              <div className="mt-3 pt-3 border-t space-y-2">
                {/* What's included */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <List className="h-3 w-3" />
                    <span>{tpl.lists.length} lists</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Zap className="h-3 w-3" />
                    <span>{tpl.skills.length} skills</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <DollarSign className="h-3 w-3" />
                    <span>{tpl.budget_categories.length} budgets</span>
                  </div>
                </div>

                {/* Lists preview */}
                {tpl.lists.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Lists: </span>
                    {tpl.lists.map((l) => l.name).join(", ")}
                  </div>
                )}

                {/* Budget categories preview */}
                {tpl.budget_categories.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Budgets: </span>
                    {tpl.budget_categories.map((b) => `${b.category} ($${b.suggested_limit})`).join(", ")}
                  </div>
                )}

                {/* Proactive rules */}
                {tpl.proactive_rules.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Smart rules: </span>
                    {tpl.proactive_rules.map((r) => r.description).join(" · ")}
                  </div>
                )}

                {/* Apply / Remove button */}
                <div className="pt-1">
                  {isApplied ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRemove(tpl.id)}
                      className="w-full text-xs"
                    >
                      Remove Template
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => handleApply(tpl.id)}
                      disabled={applying === tpl.id}
                      className="w-full text-xs"
                    >
                      {applying === tpl.id ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                          Applying...
                        </>
                      ) : (
                        <>
                          <Check className="h-3 w-3 mr-1.5" />
                          Apply Template
                        </>
                      )}
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
          No templates available yet.
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">
        Templates set up lists, budgets, and skills for your industry. You can customize everything after applying.
      </p>
    </div>
  );
};

export default IndustryTemplateSelector;

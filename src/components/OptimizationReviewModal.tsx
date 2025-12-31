import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { 
  Sparkles, 
  ArrowRight, 
  X, 
  FolderPlus, 
  MoveRight, 
  Loader2,
  CheckCircle2,
  ListPlus
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OrganizationPlan, Move } from "@/types/organization";

interface OptimizationReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: OrganizationPlan | null;
  onApply: (plan: OrganizationPlan) => Promise<void>;
  isApplying: boolean;
}

export const OptimizationReviewModal = ({
  open,
  onOpenChange,
  plan,
  onApply,
  isApplying,
}: OptimizationReviewModalProps) => {
  const { t } = useTranslation(['organize', 'common']);
  const [excludedMoves, setExcludedMoves] = useState<Set<string>>(new Set());
  const [excludedNewLists, setExcludedNewLists] = useState<Set<string>>(new Set());

  // Reset state when modal opens with new plan
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setExcludedMoves(new Set());
      setExcludedNewLists(new Set());
    }
    onOpenChange(open);
  };

  // Group moves by destination list
  const groupedMoves = useMemo(() => {
    if (!plan?.moves) return new Map<string, Move[]>();
    
    const groups = new Map<string, Move[]>();
    plan.moves.forEach(move => {
      const key = move.to_list;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(move);
    });
    return groups;
  }, [plan?.moves]);

  const toggleMove = (taskId: string) => {
    setExcludedMoves(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const toggleNewList = (listName: string) => {
    setExcludedNewLists(prev => {
      const next = new Set(prev);
      if (next.has(listName)) {
        next.delete(listName);
      } else {
        next.add(listName);
        // Also exclude all moves to this new list
        plan?.moves.forEach(move => {
          if (move.to_list === listName && move.is_new_list) {
            setExcludedMoves(p => new Set([...p, move.task_id]));
          }
        });
      }
      return next;
    });
  };

  const handleApply = async () => {
    if (!plan) return;

    // Filter out excluded items
    const filteredPlan: OrganizationPlan = {
      new_lists_to_create: plan.new_lists_to_create.filter(l => !excludedNewLists.has(l)),
      moves: plan.moves.filter(m => !excludedMoves.has(m.task_id)),
      summary: plan.summary,
    };

    await onApply(filteredPlan);
  };

  const activeMovesCount = plan ? plan.moves.filter(m => !excludedMoves.has(m.task_id)).length : 0;
  const activeNewListsCount = plan ? plan.new_lists_to_create.filter(l => !excludedNewLists.has(l)).length : 0;
  const totalMovesCount = plan?.moves.length || 0;
  const allSelected = activeMovesCount === totalMovesCount && totalMovesCount > 0;

  const toggleSelectAll = () => {
    if (allSelected) {
      // Deselect all
      setExcludedMoves(new Set(plan?.moves.map(m => m.task_id) || []));
    } else {
      // Select all
      setExcludedMoves(new Set());
    }
  };

  if (!plan) return null;

  const hasNoChanges = plan.moves.length === 0 && plan.new_lists_to_create.length === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-accent/10 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-accent" />
            </div>
            {t('modal.title')}
          </DialogTitle>
        <DialogDescription className="flex items-center justify-between">
          <span>
            {hasNoChanges 
              ? t('modal.noChanges')
              : t('modal.description', { count: plan.moves.length })}
          </span>
          {!hasNoChanges && totalMovesCount > 0 && (
            <span className="text-xs font-medium text-primary">
              {activeMovesCount}/{totalMovesCount} selected
            </span>
          )}
        </DialogDescription>
      </DialogHeader>

      {hasNoChanges ? (
        <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
          <div className="h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
          </div>
          <p className="text-muted-foreground">{t('modal.alreadyOrganized')}</p>
        </div>
      ) : (
        <>
          {/* Select All Toggle */}
          {totalMovesCount > 1 && (
            <div className="flex items-center justify-end -mt-2 mb-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleSelectAll}
                className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
              >
                <Checkbox 
                  checked={allSelected} 
                  className="mr-1.5 h-3.5 w-3.5"
                  onCheckedChange={toggleSelectAll}
                />
                {allSelected ? 'Deselect All' : 'Select All'}
              </Button>
            </div>
          )}
          <ScrollArea className="flex-1 -mx-6 px-6 max-h-[50vh] overflow-y-auto">
            <div className="space-y-4 pb-4">
              {/* New Lists Section */}
              {plan.new_lists_to_create.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <FolderPlus className="h-4 w-4 text-accent" />
                    {t('modal.newLists')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {plan.new_lists_to_create.map(listName => (
                      <Badge
                        key={listName}
                        variant={excludedNewLists.has(listName) ? "outline" : "secondary"}
                        className={cn(
                          "cursor-pointer transition-all gap-1.5 py-1.5 px-3",
                          excludedNewLists.has(listName) 
                            ? "opacity-50 line-through" 
                            : "bg-accent/10 text-accent hover:bg-accent/20"
                        )}
                        onClick={() => toggleNewList(listName)}
                      >
                        <ListPlus className="h-3 w-3" />
                        {listName}
                        {!excludedNewLists.has(listName) && (
                          <X className="h-3 w-3 ml-1 opacity-60 hover:opacity-100" />
                        )}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {plan.new_lists_to_create.length > 0 && plan.moves.length > 0 && (
                <Separator />
              )}

              {/* Moves Section */}
              {plan.moves.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <MoveRight className="h-4 w-4 text-primary" />
                    {t('modal.suggestedMoves')}
                  </div>

                  {Array.from(groupedMoves.entries()).map(([listName, moves]) => {
                    const isNewList = plan.new_lists_to_create.includes(listName);
                    const isListExcluded = isNewList && excludedNewLists.has(listName);

                    return (
                      <div key={listName} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {t('modal.moveTo')} {listName}
                          </span>
                          {isNewList && (
                            <Badge variant="outline" className="text-[10px] py-0 h-4 text-accent border-accent/30">
                              {t('modal.new')}
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            ({moves.filter(m => !excludedMoves.has(m.task_id)).length} {t('modal.tasks')})
                          </span>
                        </div>

                        <div className="space-y-1.5 pl-2">
                          {moves.map(move => {
                            const isExcluded = excludedMoves.has(move.task_id) || isListExcluded;
                            
                            return (
                              <div
                                key={move.task_id}
                                className={cn(
                                  "flex items-start gap-3 p-2 rounded-lg transition-all",
                                  isExcluded 
                                    ? "opacity-40" 
                                    : "bg-muted/30 hover:bg-muted/50"
                                )}
                              >
                                <Checkbox
                                  checked={!isExcluded}
                                  onCheckedChange={() => toggleMove(move.task_id)}
                                  disabled={isListExcluded}
                                  className="mt-0.5"
                                />
                                <div className="flex-1 min-w-0">
                                  <p className={cn(
                                    "text-sm font-medium truncate",
                                    isExcluded && "line-through text-muted-foreground"
                                  )}>
                                    {move.task_title}
                                  </p>
                                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                                    <span className="truncate max-w-[100px]">
                                      {move.from_list || t('modal.noList')}
                                    </span>
                                    <ArrowRight className="h-3 w-3 flex-shrink-0" />
                                    <span className="truncate max-w-[100px] text-primary">
                                      {move.to_list}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-muted-foreground/70 mt-1 italic">
                                    {move.reason}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </ScrollArea>
        </>
      )}

        <DialogFooter className="flex-shrink-0 gap-2 sm:gap-0">
          <Button 
            variant="outline" 
            onClick={() => handleOpenChange(false)}
            disabled={isApplying}
          >
            {t('buttons.cancel', { ns: 'common' })}
          </Button>
          {!hasNoChanges && (
            <Button 
              onClick={handleApply}
              disabled={isApplying || (activeMovesCount === 0 && activeNewListsCount === 0)}
              className="gap-2"
            >
              {isApplying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('modal.applying')}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  {t('modal.apply', { count: activeMovesCount })}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getSupabase } from "@/lib/supabaseClient";
import { useSupabaseLists } from "@/hooks/useSupabaseLists";
import { OrganizationPlan } from "@/types/organization";

interface UseOrganizeAgentOptions {
  coupleId?: string | null;
  onComplete?: () => void;
}

export const useOrganizeAgent = ({ coupleId, onComplete }: UseOrganizeAgentOptions = {}) => {
  const { t } = useTranslation(['organize', 'common']);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [plan, setPlan] = useState<OrganizationPlan | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { createList, refetch: refetchLists } = useSupabaseLists(coupleId);

  const analyze = useCallback(async (scope: "all" | "list" = "all", listId?: string) => {
    setIsAnalyzing(true);
    setPlan(null);

    try {
      const supabase = getSupabase();
      
      const { data, error } = await supabase.functions.invoke("analyze-organization", {
        body: { scope, list_id: listId },
      });

      if (error) {
        console.error("[OrganizeAgent] Analysis error:", error);
        throw new Error(error.message || "Failed to analyze organization");
      }

      if (data.error) {
        throw new Error(data.error);
      }

      console.log("[OrganizeAgent] Analysis complete:", data);
      setPlan(data);
      setIsModalOpen(true);
    } catch (error) {
      console.error("[OrganizeAgent] Error:", error);
      toast.error(t('errors.analysisFailed'));
    } finally {
      setIsAnalyzing(false);
    }
  }, [t]);

  const applyPlan = useCallback(async (planToApply: OrganizationPlan) => {
    setIsApplying(true);

    try {
      const supabase = getSupabase();
      
      // Step 1: Create new lists
      const newListIds = new Map<string, string>();
      
      for (const listName of planToApply.new_lists_to_create) {
        console.log("[OrganizeAgent] Creating list:", listName);
        const newList = await createList({
          name: listName,
          description: `Created by Olive Organizer`,
          is_manual: false,
        });
        
        if (newList) {
          newListIds.set(listName, newList.id);
        }
      }

      // Step 2: Execute moves
      let successCount = 0;
      
      for (const move of planToApply.moves) {
        const targetListId = move.to_list_id || newListIds.get(move.to_list);
        
        if (!targetListId) {
          console.warn("[OrganizeAgent] No list ID for move:", move);
          continue;
        }

        console.log("[OrganizeAgent] Moving task:", move.task_id, "to list:", targetListId);
        
        const { error } = await supabase
          .from("clerk_notes")
          .update({ list_id: targetListId })
          .eq("id", move.task_id);

        if (error) {
          console.error("[OrganizeAgent] Move error:", error);
        } else {
          successCount++;
        }
      }

      // Refresh lists
      await refetchLists();
      
      toast.success(t('success.organized', { count: successCount }));
      setIsModalOpen(false);
      setPlan(null);
      onComplete?.();
    } catch (error) {
      console.error("[OrganizeAgent] Apply error:", error);
      toast.error(t('errors.applyFailed'));
    } finally {
      setIsApplying(false);
    }
  }, [createList, refetchLists, onComplete, t]);

  return {
    isAnalyzing,
    isApplying,
    plan,
    isModalOpen,
    setIsModalOpen,
    analyze,
    applyPlan,
  };
};

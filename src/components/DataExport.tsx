import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useUser } from "@clerk/clerk-react";
import { Download, FileText, Brain, Loader2, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useSupabaseCouples } from "@/hooks/useSupabaseCouples";
import { useSupabaseLists } from "@/hooks/useSupabaseLists";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import {
  notesToCSV,
  memoriesToCSV,
  downloadCSV,
  generateExportFilename,
} from "@/utils/csvExport";

export const DataExport = () => {
  const { t } = useTranslation(["profile", "common"]);
  const { user } = useUser();
  const { notes } = useSupabaseNotesContext();
  const { currentCouple } = useSupabaseCouples();
  const { lists } = useSupabaseLists(currentCouple?.id);
  const userId = user?.id;

  const [exportingNotes, setExportingNotes] = useState(false);
  const [exportingMemories, setExportingMemories] = useState(false);
  const [notesExported, setNotesExported] = useState(false);
  const [memoriesExported, setMemoriesExported] = useState(false);

  const handleExportNotes = async () => {
    if (!notes.length) {
      toast.error(t("profile:export.noNotes"));
      return;
    }

    setExportingNotes(true);
    setNotesExported(false);

    try {
      // Map lists to simple format
      const listInfo = lists.map((l) => ({ id: l.id, name: l.name }));

      // Generate CSV
      const csvContent = notesToCSV(notes, listInfo);
      const filename = generateExportFilename("notes");

      // Download
      downloadCSV(csvContent, filename);

      setNotesExported(true);
      toast.success(t("profile:export.notesSuccess", { count: notes.length }));

      // Reset success state after 3 seconds
      setTimeout(() => setNotesExported(false), 3000);
    } catch (error) {
      console.error("Error exporting notes:", error);
      toast.error(t("profile:export.error"));
    } finally {
      setExportingNotes(false);
    }
  };

  const handleExportMemories = async () => {
    if (!userId) {
      toast.error(t("profile:export.notAuthenticated"));
      return;
    }

    setExportingMemories(true);
    setMemoriesExported(false);

    try {
      // Fetch memories from Supabase
      const { data: memories, error } = await supabase
        .from("user_memories")
        .select("id, title, content, category, importance, created_at, updated_at")
        .eq("user_id", userId)
        .eq("is_active", true);

      if (error) throw error;

      if (!memories || memories.length === 0) {
        toast.error(t("profile:export.noMemories"));
        setExportingMemories(false);
        return;
      }

      // Generate CSV
      const csvContent = memoriesToCSV(memories);
      const filename = generateExportFilename("memories");

      // Download
      downloadCSV(csvContent, filename);

      setMemoriesExported(true);
      toast.success(
        t("profile:export.memoriesSuccess", { count: memories.length })
      );

      // Reset success state after 3 seconds
      setTimeout(() => setMemoriesExported(false), 3000);
    } catch (error) {
      console.error("Error exporting memories:", error);
      toast.error(t("profile:export.error"));
    } finally {
      setExportingMemories(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-500 mb-4">
        {t("profile:export.description")}
      </p>

      <div className="grid gap-3">
        {/* Export Notes Button */}
        <Button
          variant="outline"
          className="w-full justify-start h-auto py-3 px-4 rounded-xl border-stone-200 hover:bg-stone-50 transition-all duration-300"
          onClick={handleExportNotes}
          disabled={exportingNotes}
        >
          <div className="flex items-center gap-3 w-full">
            <div className="icon-squircle w-10 h-10 bg-primary/10 flex-shrink-0">
              {exportingNotes ? (
                <Loader2 className="h-5 w-5 text-primary animate-spin" />
              ) : notesExported ? (
                <CheckCircle className="h-5 w-5 text-[hsl(var(--success))]" />
              ) : (
                <FileText className="h-5 w-5 text-primary" />
              )}
            </div>
            <div className="flex-1 text-left">
              <p className="font-medium text-[#2A3C24]">
                {t("profile:export.exportNotes")}
              </p>
              <p className="text-xs text-stone-500">
                {notes.length} {t("profile:export.notesCount")}
              </p>
            </div>
            <Download className="h-4 w-4 text-stone-400" />
          </div>
        </Button>

        {/* Export Memories Button */}
        <Button
          variant="outline"
          className="w-full justify-start h-auto py-3 px-4 rounded-xl border-stone-200 hover:bg-stone-50 transition-all duration-300"
          onClick={handleExportMemories}
          disabled={exportingMemories}
        >
          <div className="flex items-center gap-3 w-full">
            <div className="icon-squircle w-10 h-10 bg-[hsl(var(--magic-accent))]/10 flex-shrink-0">
              {exportingMemories ? (
                <Loader2 className="h-5 w-5 text-[hsl(var(--magic-accent))] animate-spin" />
              ) : memoriesExported ? (
                <CheckCircle className="h-5 w-5 text-[hsl(var(--success))]" />
              ) : (
                <Brain className="h-5 w-5 text-[hsl(var(--magic-accent))]" />
              )}
            </div>
            <div className="flex-1 text-left">
              <p className="font-medium text-[#2A3C24]">
                {t("profile:export.exportMemories")}
              </p>
              <p className="text-xs text-stone-500">
                {t("profile:export.memoriesSubtitle")}
              </p>
            </div>
            <Download className="h-4 w-4 text-stone-400" />
          </div>
        </Button>
      </div>

      <p className="text-xs text-stone-400 mt-3">
        {t("profile:export.csvFormat")}
      </p>
    </div>
  );
};

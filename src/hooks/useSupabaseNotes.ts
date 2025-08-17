import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/providers/AuthProvider";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { toast } from "sonner";

export type SupabaseNote = Tables<"notes">;
export type SupabaseNoteInsert = TablesInsert<"notes">;
export type SupabaseNoteUpdate = TablesUpdate<"notes">;

export const useSupabaseNotes = (coupleId?: string) => {
  const { user } = useAuth();
  const [notes, setNotes] = useState<SupabaseNote[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotes = useCallback(async () => {
    if (!coupleId) {
      setNotes([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("notes")
        .select("*")
        .eq("couple_id", coupleId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setNotes(data || []);
    } catch (error) {
      console.error("[Notes] Error fetching notes:", error);
      toast.error("Failed to load notes");
    } finally {
      setLoading(false);
    }
  }, [coupleId]);

  useEffect(() => {
    if (!user || !coupleId) {
      setLoading(false);
      return;
    }

    fetchNotes();

    // Set up realtime subscription
    const channel = supabase
      .channel("notes_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notes",
          filter: `couple_id=eq.${coupleId}`,
        },
        (payload) => {
          console.log("[Notes] Realtime update:", payload);
          fetchNotes(); // Refetch all notes for simplicity
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, coupleId, fetchNotes]);

  const addNote = useCallback(async (noteData: Omit<SupabaseNoteInsert, "couple_id" | "author_id">) => {
    if (!user || !coupleId) {
      toast.error("You must be signed in to add notes");
      return null;
    }

    try {
      const { data, error } = await supabase
        .from("notes")
        .insert([{
          ...noteData,
          couple_id: coupleId,
          author_id: user.id,
        }])
        .select()
        .single();

      if (error) throw error;
      toast.success("Note added successfully");
      return data;
    } catch (error) {
      console.error("[Notes] Error adding note:", error);
      toast.error("Failed to add note");
      return null;
    }
  }, [user, coupleId]);

  const updateNote = useCallback(async (id: string, updates: SupabaseNoteUpdate) => {
    if (!user) {
      toast.error("You must be signed in to update notes");
      return null;
    }

    try {
      const { data, error } = await supabase
        .from("notes")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      toast.success("Note updated successfully");
      return data;
    } catch (error) {
      console.error("[Notes] Error updating note:", error);
      toast.error("Failed to update note");
      return null;
    }
  }, [user]);

  const deleteNote = useCallback(async (id: string) => {
    if (!user) {
      toast.error("You must be signed in to delete notes");
      return false;
    }

    try {
      const { error } = await supabase
        .from("notes")
        .delete()
        .eq("id", id);

      if (error) throw error;
      toast.success("Note deleted successfully");
      return true;
    } catch (error) {
      console.error("[Notes] Error deleting note:", error);
      toast.error("Failed to delete note");
      return false;
    }
  }, [user]);

  const getNotesByCategory = useCallback((category: string) => {
    return notes.filter(note => note.category === category);
  }, [notes]);

  return {
    notes,
    loading,
    addNote,
    updateNote,
    deleteNote,
    getNotesByCategory,
    refetch: fetchNotes,
  };
};
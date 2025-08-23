import { useCallback, useEffect, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { useClerkSupabaseClient } from "@/integrations/supabase/clerk-adapter";
import { toast } from "sonner";

export type SupabaseNote = {
  id: string;
  couple_id: string | null; // Now optional
  author_id?: string;
  original_text: string;
  summary: string;
  category: string;
  items?: string[];
  tags?: string[];
  due_date?: string;
  completed: boolean;
  priority?: 'low' | 'medium' | 'high';
  created_at: string;
  updated_at: string;
  list_id?: string | null;
  task_owner?: string | null;
};

export const useSupabaseNotes = (coupleId?: string | null) => {
  const { user } = useUser();
  const [notes, setNotes] = useState<SupabaseNote[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = useClerkSupabaseClient();

  const fetchNotes = useCallback(async () => {
    console.log('[useSupabaseNotes] fetchNotes called with user:', !!user, 'coupleId:', coupleId);
    
    if (!user) {
      console.log('[useSupabaseNotes] No user, clearing notes');
      setNotes([]);
      setLoading(false);
      return;
    }

    try {
      let query = supabase
        .from("clerk_notes")
        .select("*")
        .order("created_at", { ascending: false });
      
      if (coupleId) {
        // If couple ID is provided, fetch couple notes
        console.log('[useSupabaseNotes] Fetching couple notes for couple:', coupleId);
        query = query.eq("couple_id", coupleId);
      } else {
        // If no couple ID, fetch personal notes (where couple_id is null)
        console.log('[useSupabaseNotes] Fetching personal notes (couple_id is null)');
        query = query.is("couple_id", null);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[useSupabaseNotes] Error fetching notes:', error);
        throw error;
      }
      
      console.log('[useSupabaseNotes] Successfully fetched notes:', data?.length || 0, 'notes');
      setNotes(data || []);
    } catch (error) {
      console.error("[Notes] Error fetching notes:", error);
      toast.error("Failed to load notes");
    } finally {
      setLoading(false);
    }
  }, [coupleId, user, supabase]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    console.log('[useSupabaseNotes] useEffect triggered - fetching notes for user:', user.id, 'coupleId:', coupleId);
    fetchNotes();

    // Set up realtime subscription
    const channel = supabase
      .channel("clerk_notes_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "clerk_notes",
        },
        (payload) => {
          console.log("[Notes] Realtime update received:", payload);
          fetchNotes(); // Refetch all notes for simplicity
        }
      )
      .subscribe();

    console.log('[useSupabaseNotes] Realtime subscription set up for user:', user.id);

    return () => {
      console.log('[useSupabaseNotes] Cleaning up realtime subscription');
      supabase.removeChannel(channel);
    };
  }, [user, fetchNotes]);

  const addNote = useCallback(async (noteData: Omit<SupabaseNote, "id" | "created_at" | "updated_at" | "author_id">, providedCoupleId?: string | null) => {
    console.log('[useSupabaseNotes] addNote called with:', { noteData, userId: user?.id, coupleId, providedCoupleId });
    
    if (!user) {
      console.error('[useSupabaseNotes] No user found');
      toast.error("You must be signed in to add notes");
      return null;
    }

    try {
      console.log('[useSupabaseNotes] Inserting note to clerk_notes table');
      
      const insertData = {
        ...noteData,
        couple_id: providedCoupleId || coupleId || null, // Allow null for personal notes
        author_id: user.id,
      };
      
      console.log('[useSupabaseNotes] Final insert data:', insertData);
      
      const { data, error } = await supabase
        .from("clerk_notes")
        .insert([insertData])
        .select()
        .single();

      if (error) {
        console.error('[useSupabaseNotes] Supabase insert error:', error);
        
        // If RLS policy violation, provide more helpful error
        if (error.message?.includes('row-level security policy')) {
          console.error('[useSupabaseNotes] RLS Policy violation - user may not have access to this couple');
          throw new Error('Authentication error - please try signing out and back in');
        }
        
        throw error;
      }
      
      console.log('[useSupabaseNotes] Successfully inserted note:', data);
      toast.success("Note added successfully");
      return data;
    } catch (error: any) {
      console.error("[useSupabaseNotes] Error adding note:", error);
      toast.error(`Failed to add note: ${error.message}`);
      return null;
    }
  }, [user, coupleId, supabase]);

  const updateNote = useCallback(async (id: string, updates: Partial<SupabaseNote>) => {
    if (!user) {
      toast.error("You must be signed in to update notes");
      return null;
    }

    try {
      const { data, error } = await supabase
        .from("clerk_notes")
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
  }, [user, supabase]);

  const deleteNote = useCallback(async (id: string) => {
    if (!user) {
      toast.error("You must be signed in to delete notes");
      return false;
    }

    try {
      const { error } = await supabase
        .from("clerk_notes")
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
  }, [user, supabase]);

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
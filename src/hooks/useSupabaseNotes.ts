import { useCallback, useEffect, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { useSupabase } from "@/lib/supabaseClient";
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
  task_owner?: string | null;
  created_at: string;
  updated_at: string;
};

export const useSupabaseNotes = (coupleId?: string | null) => {
  const { user } = useUser();
  const [notes, setNotes] = useState<SupabaseNote[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = useSupabase();

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
      console.log("[useSupabaseNotes] Updating note:", id, "with updates:", updates);
      console.log("[useSupabaseNotes] Current user:", user?.id);
      console.log("[useSupabaseNotes] Raw updates payload:", JSON.stringify(updates, null, 2));
      
      // Validate payload - ensure we only send valid fields
      const validUpdates: any = {};
      const allowedFields = ['summary', 'category', 'priority', 'tags', 'items', 'due_date', 'completed', 'task_owner'];
      
      Object.keys(updates).forEach(key => {
        if (allowedFields.includes(key) && updates[key as keyof SupabaseNote] !== undefined) {
          validUpdates[key] = updates[key as keyof SupabaseNote];
        }
      });
      
      console.log("[useSupabaseNotes] Validated updates payload:", JSON.stringify(validUpdates, null, 2));
      
      if (Object.keys(validUpdates).length === 0) {
        console.error("[useSupabaseNotes] No valid fields to update");
        throw new Error('No valid fields provided for update');
      }
      
      const { data, error } = await supabase
        .from("clerk_notes")
        .update(validUpdates)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        console.error("[useSupabaseNotes] Update error details:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          status: (error as any).status,
          statusCode: (error as any).statusCode,
          statusText: (error as any).statusText
        });
        
        // Enhanced error handling for different error types
        if (error.message?.includes('row-level security policy')) {
          console.error("[useSupabaseNotes] RLS Policy violation during update");
          throw new Error('Permission denied - you may not have access to update this note');
        }
        
        if (error.code === 'PGRST116' || (error as any).status === 406) {
          console.error("[useSupabaseNotes] 406 Not Acceptable - likely schema/format issue");
          throw new Error('Data format not acceptable - check field types and values');
        }
        
        throw error;
      }
      
      console.log("[useSupabaseNotes] Successfully updated note:", data);
      toast.success("Note updated successfully");
      
      // Trigger refetch to ensure UI is updated
      await fetchNotes();
      
      return data;
    } catch (error: any) {
      console.error("[useSupabaseNotes] Error updating note:", {
        error,
        message: error?.message,
        stack: error?.stack,
        updates,
        noteId: id,
        userId: user?.id
      });
      toast.error(`Failed to update note: ${error?.message || error}`);
      return null;
    }
  }, [user, supabase, fetchNotes]);

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
import { useCallback, useEffect, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import type { Note } from "@/types/note";

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
  reminder_time?: string | null;
  recurrence_frequency?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  recurrence_interval?: number | null;
  last_reminded_at?: string | null;
  completed: boolean;
  priority?: 'low' | 'medium' | 'high';
  task_owner?: string | null;
  list_id?: string | null;
  media_urls?: string[] | null;
  location?: any | null;
  created_at: string;
  updated_at: string;
};

export const useSupabaseNotes = (coupleId?: string | null) => {
  const { user } = useUser();
  const [notes, setNotes] = useState<SupabaseNote[]>([]);
  const [loading, setLoading] = useState(true);
  

  const fetchNotes = useCallback(async () => {
    console.log('[useSupabaseNotes] fetchNotes called with user:', !!user, 'coupleId:', coupleId);
    
    if (!user) {
      console.log('[useSupabaseNotes] No user, clearing notes');
      setNotes([]);
      setLoading(false);
      return;
    }

    try {
      if (coupleId) {
        // If couple ID is provided, fetch BOTH personal notes AND couple notes
        console.log('[useSupabaseNotes] Fetching both personal and couple notes for couple:', coupleId);
        
        const [personalNotesResult, coupleNotesResult] = await Promise.all([
          supabase
            .from("clerk_notes")
            .select("*")
            .is("couple_id", null)
            .order("created_at", { ascending: false }),
          supabase
            .from("clerk_notes")
            .select("*")
            .eq("couple_id", coupleId)
            .order("created_at", { ascending: false })
        ]);

        if (personalNotesResult.error) throw personalNotesResult.error;
        if (coupleNotesResult.error) throw coupleNotesResult.error;

        // Combine both personal and couple notes
        const combinedNotes = [
          ...(personalNotesResult.data || []),
          ...(coupleNotesResult.data || [])
        ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        console.log('[useSupabaseNotes] Combined notes:', {
          personal: personalNotesResult.data?.length || 0,
          couple: coupleNotesResult.data?.length || 0,
          total: combinedNotes.length
        });
        
        setNotes(combinedNotes);
      } else {
        // If no couple ID, fetch only personal notes
        console.log('[useSupabaseNotes] Fetching personal notes only (couple_id is null)');
        const { data, error } = await supabase
          .from("clerk_notes")
          .select("*")
          .is("couple_id", null)
          .order("created_at", { ascending: false });

        if (error) throw error;
        
        console.log('[useSupabaseNotes] Successfully fetched personal notes:', data?.length || 0);
        setNotes(data || []);
      }
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

  const updateNote = useCallback(async (id: string, updates: Partial<Note>) => {
    if (!user) {
      toast.error("You must be signed in to update notes");
      return null;
    }

    try {
      console.log("[useSupabaseNotes] Updating note:", id, "with updates:", updates);
      console.log("[useSupabaseNotes] Current user:", user?.id);
      console.log("[useSupabaseNotes] Raw updates payload:", JSON.stringify(updates, null, 2));
      
      // Convert camelCase Note fields to snake_case Supabase fields
      const supabaseUpdates: any = {};
      
      Object.keys(updates).forEach(key => {
        const value = updates[key as keyof Note];
        if (value !== undefined) {
          // Map camelCase to snake_case for Supabase
          switch (key) {
            case 'originalText':
              supabaseUpdates.original_text = value;
              break;
            case 'dueDate':
            case 'due_date': // Handle both camelCase and snake_case
              supabaseUpdates.due_date = value;
              break;
            case 'reminderTime':
            case 'reminder_time': // Handle both camelCase and snake_case
              supabaseUpdates.reminder_time = value;
              break;
            case 'coupleId':
            case 'couple_id': // Handle both camelCase and snake_case
              supabaseUpdates.couple_id = value;
              break;
            case 'task_owner':
              supabaseUpdates.task_owner = value;
              break;
            case 'list_id':
              supabaseUpdates.list_id = value;
              break;
            case 'category':
              // Apply category transformation for AI format
              supabaseUpdates.category = typeof value === 'string' ? value.toLowerCase().replace(/\s+/g, '_') : value;
              break;
            // Direct mappings for fields that match
            case 'summary':
            case 'priority':
            case 'tags':
            case 'items':
            case 'completed':
              supabaseUpdates[key] = value;
              break;
            case 'isShared':
              // Ignore isShared - privacy is controlled by couple_id
              break;
            default:
              console.warn("[useSupabaseNotes] Ignoring unknown field:", key);
              break;
          }
        }
      });
      
      console.log("[useSupabaseNotes] Converted updates payload:", JSON.stringify(supabaseUpdates, null, 2));
      
      if (Object.keys(supabaseUpdates).length === 0) {
        console.error("[useSupabaseNotes] No valid fields to update");
        throw new Error('No valid fields provided for update');
      }
      
      const { data, error } = await supabase
        .from("clerk_notes")
        .update(supabaseUpdates)
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
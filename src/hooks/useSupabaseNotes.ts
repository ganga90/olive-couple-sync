import { useCallback, useEffect, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { useClerkSupabaseClient } from "@/integrations/supabase/clerk-adapter";
import { toast } from "sonner";

export type SupabaseNote = {
  id: string;
  couple_id: string;
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
};

export const useSupabaseNotes = (coupleId?: string) => {
  const { user } = useUser();
  const [notes, setNotes] = useState<SupabaseNote[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = useClerkSupabaseClient();

  const fetchNotes = useCallback(async () => {
    if (!coupleId) {
      setNotes([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("clerk_notes")
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
  }, [coupleId, supabase]);

  useEffect(() => {
    if (!user || !coupleId) {
      setLoading(false);
      return;
    }

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

  const addNote = useCallback(async (noteData: Omit<SupabaseNote, "id" | "created_at" | "updated_at" | "couple_id" | "author_id">) => {
    console.log('[useSupabaseNotes] addNote called with:', { noteData, userId: user?.id, coupleId });
    
    if (!user || !coupleId) {
      const errorMsg = `Missing requirements - user: ${!!user}, coupleId: ${!!coupleId}`;
      console.error('[useSupabaseNotes]', errorMsg);
      toast.error("You must be signed in to add notes");
      return null;
    }

    try {
      console.log('[useSupabaseNotes] Inserting note to clerk_notes table');
      
      // Comprehensive session and auth debugging
      const session = await supabase.auth.getSession();
      console.log('[useSupabaseNotes] Session debugging:', {
        hasSession: !!session.data.session,
        sessionUser: session.data.session?.user?.id,
        sessionValid: !!session.data.session?.access_token,
        sessionError: session.error
      });
      
      // Test if we can access any data first  
      const { data: testProfiles, error: profileError } = await supabase
        .from("clerk_profiles")
        .select("*")
        .limit(1);
      
      console.log('[useSupabaseNotes] Profile access test:', { testProfiles, profileError });
      
      // Test couple access
      const { data: testCouples, error: coupleError } = await supabase
        .from("clerk_couples")
        .select("*")
        .limit(1);
      
      console.log('[useSupabaseNotes] Couple access test:', { testCouples, coupleError });
      
      const insertData = {
        ...noteData,
        couple_id: coupleId,
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
          console.error('[useSupabaseNotes] RLS Policy violation - checking user context');
          
          // Test direct auth.uid() access
          try {
            const { data: currentUser } = await supabase.auth.getUser();
            console.log('[useSupabaseNotes] Current authenticated user:', currentUser);
          } catch (authErr) {
            console.error('[useSupabaseNotes] Auth check failed:', authErr);
          }
          
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
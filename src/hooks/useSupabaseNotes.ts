import { useCallback, useEffect, useState } from "react";
import { useSafeUser as useUser } from "@/hooks/useSafeClerk";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import type { Note } from "@/types/note";

export type SupabaseNote = {
  id: string;
  couple_id: string | null;
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
  // Encryption fields
  is_sensitive?: boolean;
  encrypted_original_text?: string | null;
  encrypted_summary?: string | null;
};

// Decrypt sensitive notes by calling the decrypt-note edge function
async function decryptSensitiveNotes(notes: SupabaseNote[], userId: string): Promise<SupabaseNote[]> {
  const sensitiveNotes = notes.filter(n => n.is_sensitive && n.encrypted_original_text);
  
  if (sensitiveNotes.length === 0) return notes;
  
  // Decrypt in parallel (batched to avoid overwhelming the function)
  const decryptResults = await Promise.allSettled(
    sensitiveNotes.map(async (note) => {
      try {
        const { data, error } = await supabase.functions.invoke('decrypt-note', {
          body: { note_id: note.id }
        });
        if (error || !data) return null;
        return { noteId: note.id, original_text: data.original_text, summary: data.summary };
      } catch {
        return null;
      }
    })
  );
  
  // Build a map of decrypted content
  const decryptedMap = new Map<string, { original_text: string; summary: string }>();
  for (const result of decryptResults) {
    if (result.status === 'fulfilled' && result.value) {
      decryptedMap.set(result.value.noteId, result.value);
    }
  }
  
  // Replace encrypted placeholders with decrypted content
  return notes.map(note => {
    const decrypted = decryptedMap.get(note.id);
    if (decrypted) {
      return { ...note, original_text: decrypted.original_text, summary: decrypted.summary };
    }
    return note;
  });
}

export const useSupabaseNotes = (coupleId?: string | null) => {
  const { user } = useUser();
  const [notes, setNotes] = useState<SupabaseNote[]>([]);
  const [loading, setLoading] = useState(true);
  

  const fetchNotes = useCallback(async () => {
    
    if (!user) {
      setNotes([]);
      setLoading(false);
      return;
    }

    try {
      let allNotes: SupabaseNote[] = [];
      
      if (coupleId) {
        // If couple ID is provided, fetch BOTH personal notes AND couple notes
        
        const [personalNotesResult, coupleNotesResult] = await Promise.all([
          supabase
            .from("clerk_notes")
            .select("*, is_sensitive, encrypted_original_text, encrypted_summary")
            .is("couple_id", null)
            .order("created_at", { ascending: false }),
          supabase
            .from("clerk_notes")
            .select("*, is_sensitive, encrypted_original_text, encrypted_summary")
            .eq("couple_id", coupleId)
            .order("created_at", { ascending: false })
        ]);

        if (personalNotesResult.error) throw personalNotesResult.error;
        if (coupleNotesResult.error) throw coupleNotesResult.error;

        // Combine both personal and couple notes
        allNotes = [
          ...(personalNotesResult.data || []),
          ...(coupleNotesResult.data || [])
        ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      } else {
        // If no couple ID, fetch only personal notes
        const { data, error } = await supabase
          .from("clerk_notes")
          .select("*, is_sensitive, encrypted_original_text, encrypted_summary")
          .is("couple_id", null)
          .order("created_at", { ascending: false });

        if (error) throw error;
        allNotes = data || [];
      }

      // Filter out notes that are linked to expenses (to avoid showing them in lists)
      const { data: expenseLinkedNotes, error: expenseError } = await supabase
        .from("expenses")
        .select("note_id")
        .not("note_id", "is", null);

      if (expenseError) {
        console.warn("[Notes] Error fetching expense-linked notes:", expenseError);
      }

      const expenseNoteIds = new Set(
        (expenseLinkedNotes || []).map(expense => expense.note_id).filter(Boolean)
      );

      // Filter out notes that are linked to expenses
      const filteredNotes = allNotes.filter(note => !expenseNoteIds.has(note.id));

      // Decrypt sensitive notes client-side via edge function
      const decryptedNotes = await decryptSensitiveNotes(filteredNotes, user.id);

      setNotes(decryptedNotes);
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
          fetchNotes(); // Refetch all notes for simplicity
        }
      )
      .subscribe();


    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchNotes]);

  const addNote = useCallback(async (noteData: Omit<SupabaseNote, "id" | "created_at" | "updated_at" | "author_id">, providedCoupleId?: string | null) => {
    
    if (!user) {
      console.error('[useSupabaseNotes] No user found');
      toast.error("You must be signed in to add notes");
      return null;
    }

    try {
      
      // Convert camelCase input to snake_case for database insert
      // IMPORTANT: Use the couple_id from noteData directly — the provider has already
      // resolved the correct value based on the user's privacy preference.
      // Do NOT fallback to the hook-level coupleId, as that would override private notes.
      const resolvedCoupleId = noteData.couple_id !== undefined ? noteData.couple_id : (providedCoupleId !== undefined ? providedCoupleId : coupleId);
      const insertData: any = {
        original_text: noteData.original_text,
        summary: noteData.summary,
        category: noteData.category,
        completed: noteData.completed ?? false,
        couple_id: resolvedCoupleId ?? null,
        author_id: user.id,
      };
      
      // Handle optional fields with proper snake_case conversion
      // Support both camelCase (from frontend) and snake_case (from types)
      if ((noteData as any).listId || noteData.list_id) {
        insertData.list_id = (noteData as any).listId || noteData.list_id;
      }
      if ((noteData as any).taskOwner || noteData.task_owner) {
        insertData.task_owner = (noteData as any).taskOwner || noteData.task_owner;
      }
      if ((noteData as any).dueDate || noteData.due_date) {
        insertData.due_date = (noteData as any).dueDate || noteData.due_date;
      }
      if ((noteData as any).reminderTime || noteData.reminder_time) {
        insertData.reminder_time = (noteData as any).reminderTime || noteData.reminder_time;
      }
      if ((noteData as any).mediaUrls || noteData.media_urls) {
        insertData.media_urls = (noteData as any).mediaUrls || noteData.media_urls;
      }
      if (noteData.priority) {
        insertData.priority = noteData.priority;
      }
      if (noteData.tags) {
        insertData.tags = noteData.tags;
      }
      if (noteData.items) {
        insertData.items = noteData.items;
      }
      if (noteData.recurrence_frequency) {
        insertData.recurrence_frequency = noteData.recurrence_frequency;
      }
      if (noteData.recurrence_interval) {
        insertData.recurrence_interval = noteData.recurrence_interval;
      }
      // Encryption fields
      if ((noteData as any).is_sensitive) {
        insertData.is_sensitive = true;
      }
      if ((noteData as any).encrypted_original_text) {
        insertData.encrypted_original_text = (noteData as any).encrypted_original_text;
        insertData.original_text = '[ENCRYPTED]';
      }
      if ((noteData as any).encrypted_summary) {
        insertData.encrypted_summary = (noteData as any).encrypted_summary;
        insertData.summary = '[ENCRYPTED]';
      }
      
      
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
      
      toast.success("Note added successfully");

      // Link any auto-detected expenses that were created by process-note
      // (they have null note_id since the note didn't exist yet)
      // Skip for encrypted notes since original_text is '[ENCRYPTED]'
      if (data?.id && data?.original_text && data.original_text !== '[ENCRYPTED]') {
        supabase
          .from('expenses')
          .update({ note_id: data.id })
          .eq('user_id', user.id)
          .is('note_id', null)
          .eq('original_text', data.original_text.substring(0, 500))
          .gte('created_at', new Date(Date.now() - 60000).toISOString())
          .then(({ error: linkErr }) => {
            if (linkErr) console.warn('[useSupabaseNotes] expense linking error:', linkErr);
            else console.log('[useSupabaseNotes] linked expense to note:', data.id);
          });
      }

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
            case 'summary':
              supabaseUpdates.summary = value;
              break;
            case 'category':
              supabaseUpdates.category = value;
              break;
            case 'completed':
              supabaseUpdates.completed = value;
              break;
            case 'priority':
              supabaseUpdates.priority = value;
              break;
            case 'tags':
              supabaseUpdates.tags = value;
              break;
            case 'items':
              supabaseUpdates.items = value;
              break;
            case 'dueDate':
            case 'due_date':
              supabaseUpdates.due_date = value;
              break;
            case 'reminderTime':
            case 'reminder_time':
              supabaseUpdates.reminder_time = value;
              break;
            case 'coupleId':
            case 'couple_id':
              supabaseUpdates.couple_id = value;
              break;
            case 'taskOwner':
            case 'task_owner':
              supabaseUpdates.task_owner = value;
              break;
            case 'listId':
            case 'list_id':
              supabaseUpdates.list_id = value;
              break;
            case 'recurrenceFrequency':
            case 'recurrence_frequency':
              supabaseUpdates.recurrence_frequency = value;
              break;
            case 'recurrenceInterval':
            case 'recurrence_interval':
              supabaseUpdates.recurrence_interval = value;
              break;
            case 'lastRemindedAt':
            case 'last_reminded_at':
              supabaseUpdates.last_reminded_at = value;
              break;
            case 'mediaUrls':
            case 'media_urls':
              supabaseUpdates.media_urls = value;
              break;
            case 'is_sensitive':
              supabaseUpdates.is_sensitive = value;
              break;
            // Skip frontend-only / computed fields
            case 'id':
            case 'createdAt':
            case 'updatedAt':
            case 'addedBy':
            case 'authorId':
            case 'author_id':
            case 'olive_tips':
            case 'location':
            case 'isShared':
              break;
            default:
              console.warn("[useSupabaseNotes] Ignoring unknown field:", key);
              break;
          }
        }
      });
      
      
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
import { useCallback, useEffect, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { getSupabase } from "@/lib/supabaseClient";
import { toast } from "sonner";

export type SupabaseList = {
  id: string;
  name: string;
  description?: string | null;
  is_manual: boolean;
  author_id?: string | null;
  couple_id?: string | null;
  created_at: string;
  updated_at: string;
};

export const useSupabaseLists = (coupleId?: string | null) => {
  const { user } = useUser();
  const [lists, setLists] = useState<SupabaseList[]>([]);
  const [loading, setLoading] = useState(true);


  const fetchLists = useCallback(async () => {
    if (!user?.id) {
      setLists([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    
    try {
      
      const supabase = getSupabase();
      
      // Query for personal lists (couple_id is null) and couple lists if in a couple
      let query = supabase
        .from("clerk_lists")
        .select("*")
        .eq("author_id", user.id);

      if (coupleId) {
        // If in a couple, also get couple lists
        query = supabase
          .from("clerk_lists")
          .select("*")
          .or(`and(author_id.eq.${user.id},couple_id.is.null),couple_id.eq.${coupleId}`);
      } else {
        // Personal lists only
        query = query.is("couple_id", null);
      }

      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) {
        console.error("[Lists] Database error:", error);
        throw error;
      }

      setLists(data || []);
    } catch (error) {
      console.error("[Lists] Error fetching lists:", error);
      toast.error("Failed to load lists");
      setLists([]); // Set empty array on error to prevent infinite loading
    } finally {
      setLoading(false);
    }
  }, [user?.id, coupleId]);

  useEffect(() => {
    fetchLists();

    if (!user) return;

    const supabase = getSupabase();
    
    // Set up realtime subscription for lists
    const channel = supabase
      .channel("clerk_lists_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "clerk_lists",
        },
        (payload) => {
          fetchLists();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchLists]);

  const createList = useCallback(async (listData: { name: string; description?: string; is_manual?: boolean }) => {
    if (!user?.id) {
      toast.error("You must be signed in to create lists");
      return null;
    }

    try {
      
      const supabase = getSupabase();
      const normalizedName = listData.name.trim();
      
      // Check if list already exists (case-insensitive)
      const existingList = lists.find(list => 
        list.name.toLowerCase().trim() === normalizedName.toLowerCase()
      );
      
      if (existingList) {
        toast.info("List already exists");
        return existingList;
      }
      
      const insertData = {
        name: normalizedName,
        description: listData.description || null,
        is_manual: listData.is_manual !== false,
        author_id: user.id,
        couple_id: coupleId || null,
      };
      
      const { data, error } = await supabase
        .from("clerk_lists")
        .insert([insertData])
        .select()
        .single();

      if (error) {
        // Handle unique constraint violation gracefully
        if (error.code === '23505') {
          await fetchLists(); // Refresh to get the existing list
          const existing = lists.find(l => l.name.toLowerCase().trim() === normalizedName.toLowerCase());
          if (existing) return existing;
        }
        throw error;
      }
      
      toast.success("List created successfully");
      return data;
    } catch (error: any) {
      console.error("[Lists] Error creating list:", error);
      toast.error(`Failed to create list: ${error.message}`);
      return null;
    }
  }, [user?.id, coupleId, lists, fetchLists]);

  const updateList = useCallback(async (id: string, updates: { name?: string; description?: string; couple_id?: string | null }) => {
    if (!user?.id) {
      toast.error("You must be signed in to update lists");
      return null;
    }

    try {
      
      const supabase = getSupabase();
      
      const { data, error } = await supabase
        .from("clerk_lists")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      
      // If couple_id was updated (privacy change), cascade to all notes in this list
      if ('couple_id' in updates) {
        const { error: notesError } = await supabase
          .from("clerk_notes")
          .update({ couple_id: updates.couple_id })
          .eq("list_id", id);
        
        if (notesError) {
          console.error("[Lists] Error cascading privacy to notes:", notesError);
          // Don't throw - the list update succeeded
        } else {
        }
      }
      
      toast.success("List updated successfully");
      return data;
    } catch (error) {
      console.error("[Lists] Error updating list:", error);
      toast.error(`Failed to update list: ${error.message}`);
      return null;
    }
  }, [user?.id]);

  const deleteList = useCallback(async (id: string) => {
    if (!user?.id) {
      toast.error("You must be signed in to delete lists");
      return false;
    }

    try {
      
      const supabase = getSupabase();
      
      // First, unlink all notes from this list by setting their list_id to NULL
      const { error: unlinkError } = await supabase
        .from("clerk_notes")
        .update({ list_id: null })
        .eq("list_id", id);

      if (unlinkError) {
        console.error("[Lists] Error unlinking notes:", unlinkError);
        throw unlinkError;
      }


      // Now delete the list
      // RLS policies already enforce authorization (author or couple member)
      const { error } = await supabase
        .from("clerk_lists")
        .delete()
        .eq("id", id);

      if (error) throw error;
      
      toast.success("List deleted successfully");
      return true;
    } catch (error) {
      console.error("[Lists] Error deleting list:", error);
      toast.error(`Failed to delete list: ${error.message}`);
      return false;
    }
  }, [user?.id]);

  const getListByName = useCallback((name: string) => {
    return lists.find(list => list.name.toLowerCase() === name.toLowerCase());
  }, [lists]);

  const findOrCreateListByCategory = useCallback(async (category: string) => {
    const normalizedCategory = category.toLowerCase().replace(/[_\s]+/g, ' ').trim();
    
    // First check if a list already exists for this category (case-insensitive)
    const existingList = lists.find(list => 
      list.name.toLowerCase().replace(/[_\s]+/g, ' ').trim() === normalizedCategory
    );
    
    if (existingList) {
      return existingList;
    }
    
    // Create a new list for this category
    const listName = category.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim();
    
    
    const newList = await createList({
      name: listName,
      description: `Auto-generated list for ${listName.toLowerCase()} items`,
      is_manual: false
    });
    
    return newList;
  }, [lists, createList]);

  return {
    lists,
    loading,
    createList,
    updateList,
    deleteList,
    getListByName,
    findOrCreateListByCategory,
    refetch: fetchLists,
  };
};
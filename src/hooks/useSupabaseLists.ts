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

  console.log('[useSupabaseLists] Hook initialized with coupleId:', coupleId);

  const fetchLists = useCallback(async () => {
    if (!user) {
      console.log("[Lists] No user, clearing state");
      setLists([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      console.log("[Lists] Fetching lists for user:", user.id, "coupleId:", coupleId);
      
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

      if (error) throw error;

      console.log("[Lists] Successfully fetched lists:", data?.length || 0);
      setLists(data || []);
    } catch (error) {
      console.error("[Lists] Error fetching lists:", error);
      toast.error("Failed to load lists");
    } finally {
      setLoading(false);
    }
  }, [user, coupleId]);

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
          console.log("[Lists] Realtime update:", payload);
          fetchLists();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchLists]);

  const createList = useCallback(async (listData: { name: string; description?: string; is_manual?: boolean }) => {
    if (!user) {
      toast.error("You must be signed in to create lists");
      return null;
    }

    try {
      console.log("[Lists] Creating list:", listData);
      
      const supabase = getSupabase();
      
      const insertData = {
        name: listData.name,
        description: listData.description || null,
        is_manual: listData.is_manual !== false, // Default to true for manual creation
        author_id: user.id,
        couple_id: coupleId || null,
      };
      
      const { data, error } = await supabase
        .from("clerk_lists")
        .insert([insertData])
        .select()
        .single();

      if (error) throw error;
      
      console.log("[Lists] Successfully created list:", data);
      toast.success("List created successfully");
      return data;
    } catch (error) {
      console.error("[Lists] Error creating list:", error);
      toast.error(`Failed to create list: ${error.message}`);
      return null;
    }
  }, [user, coupleId]);

  const updateList = useCallback(async (id: string, updates: { name?: string; description?: string }) => {
    if (!user) {
      toast.error("You must be signed in to update lists");
      return null;
    }

    try {
      console.log("[Lists] Updating list:", id, "with updates:", updates);
      
      const supabase = getSupabase();
      
      const { data, error } = await supabase
        .from("clerk_lists")
        .update(updates)
        .eq("id", id)
        .eq("author_id", user.id) // Ensure user can only update their own lists
        .select()
        .single();

      if (error) throw error;
      
      console.log("[Lists] Successfully updated list:", data);
      toast.success("List updated successfully");
      return data;
    } catch (error) {
      console.error("[Lists] Error updating list:", error);
      toast.error(`Failed to update list: ${error.message}`);
      return null;
    }
  }, [user]);

  const deleteList = useCallback(async (id: string) => {
    if (!user) {
      toast.error("You must be signed in to delete lists");
      return false;
    }

    try {
      console.log("[Lists] Deleting list:", id);
      
      const supabase = getSupabase();
      
      const { error } = await supabase
        .from("clerk_lists")
        .delete()
        .eq("id", id)
        .eq("author_id", user.id); // Ensure user can only delete their own lists

      if (error) throw error;
      
      console.log("[Lists] Successfully deleted list");
      toast.success("List deleted successfully");
      return true;
    } catch (error) {
      console.error("[Lists] Error deleting list:", error);
      toast.error(`Failed to delete list: ${error.message}`);
      return false;
    }
  }, [user]);

  const getListByName = useCallback((name: string) => {
    return lists.find(list => list.name.toLowerCase() === name.toLowerCase());
  }, [lists]);

  const findOrCreateListByCategory = useCallback(async (category: string) => {
    // First check if a list already exists for this category
    const existingList = lists.find(list => 
      list.name.toLowerCase() === category.toLowerCase() ||
      list.name.toLowerCase().replace(/[_\s]+/g, ' ') === category.toLowerCase().replace(/[_\s]+/g, ' ')
    );
    
    if (existingList) {
      console.log("[Lists] Found existing list for category:", category, existingList);
      return existingList;
    }
    
    // Create a new list for this category
    const listName = category.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim();
    
    console.log("[Lists] Creating new list for category:", category, "->", listName);
    
    const newList = await createList({
      name: listName,
      description: `Auto-generated list for ${listName.toLowerCase()} items`,
      is_manual: false // Mark as auto-generated
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
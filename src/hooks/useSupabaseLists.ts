import { useCallback, useEffect, useState } from "react";
import { useSafeUser as useUser } from "@/hooks/useSafeClerk";
import { getSupabase } from "@/lib/supabaseClient";
import { toast } from "sonner";

export type SupabaseList = {
  id: string;
  name: string;
  description?: string | null;
  is_manual: boolean;
  author_id?: string | null;
  couple_id?: string | null;
  /** Phase 1A: space_id is the canonical scope. Mirrors couple_id for
   *  couple-type spaces via a DB trigger. For non-couple spaces
   *  (family/business/custom) only space_id is populated. */
  space_id?: string | null;
  created_at: string;
  updated_at: string;
};

export const useSupabaseLists = (coupleId?: string | null, spaceId?: string | null) => {
  const { user } = useUser();
  const [lists, setLists] = useState<SupabaseList[]>([]);
  const [loading, setLoading] = useState(true);

  // Phase 1A: prefer space_id when present (covers non-couple spaces too).
  const scopeSpaceId = spaceId ?? coupleId ?? null;

  const fetchLists = useCallback(async () => {
    if (!user?.id) {
      setLists([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {

      const supabase = getSupabase();

      let query = supabase
        .from("clerk_lists")
        .select("*")
        .eq("author_id", user.id);

      if (scopeSpaceId) {
        // Personal lists (space_id AND couple_id null + authored by me)
        // OR any list scoped to this space (via space_id, covers both
        // couple-type and non-couple spaces — RLS permits either path).
        query = supabase
          .from("clerk_lists")
          .select("*")
          .or(`and(author_id.eq.${user.id},couple_id.is.null,space_id.is.null),space_id.eq.${scopeSpaceId}`);
      } else {
        // No space context → personal only
        query = query.is("couple_id", null).is("space_id", null);
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
  }, [user?.id, scopeSpaceId]);

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

  const createList = useCallback(async (listData: { name: string; description?: string; is_manual?: boolean; isShared?: boolean }) => {
    if (!user?.id) {
      toast.error("You must be signed in to create lists");
      return null;
    }

    try {

      const supabase = getSupabase();
      const normalizedName = listData.name.trim();

      // Phase 1A: resolve scope to a space_id. Setting space_id is
      // enough — the dual-write trigger mirrors couple_id for couple-
      // type spaces, and leaves it NULL for non-couple spaces.
      const resolvedSpaceId = listData.isShared === false ? null : (scopeSpaceId || null);

      // A list "shape" is uniquely identified by (name, scope). Users
      // can have a private "Work" AND a shared "Work" as separate lists.
      const existingList = lists.find(list => {
        const nameMatch = list.name.toLowerCase().trim() === normalizedName.toLowerCase();
        if (!nameMatch) return false;
        const listIsShared = (list.space_id ?? list.couple_id) !== null && (list.space_id ?? list.couple_id) !== undefined;
        const newIsShared = resolvedSpaceId !== null;
        return listIsShared === newIsShared;
      });

      if (existingList) {
        toast.info("List already exists");
        return existingList;
      }

      const insertData: Record<string, unknown> = {
        name: normalizedName,
        description: listData.description || null,
        is_manual: listData.is_manual !== false,
        author_id: user.id,
      };
      if (resolvedSpaceId) {
        insertData.space_id = resolvedSpaceId;
      }
      
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
  }, [user?.id, scopeSpaceId, lists, fetchLists]);

  const updateList = useCallback(async (id: string, updates: { name?: string; description?: string; couple_id?: string | null; space_id?: string | null }) => {
    if (!user?.id) {
      toast.error("You must be signed in to update lists");
      return null;
    }

    try {

      const supabase = getSupabase();

      // Normalize to a single canonical scope change. If caller supplied
      // either couple_id or space_id, treat it as a privacy change and
      // write via space_id (trigger mirrors couple_id for couple-type).
      const privacyChanged = 'couple_id' in updates || 'space_id' in updates;
      const nextScope = privacyChanged
        ? ((updates.space_id !== undefined) ? updates.space_id : (updates.couple_id ?? null))
        : undefined;

      const dbUpdates: Record<string, unknown> = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.description !== undefined) dbUpdates.description = updates.description;
      if (privacyChanged) {
        // Write only space_id. The BEFORE UPDATE trigger on clerk_lists
        // mirrors space_id → couple_id for couple-type spaces (trigger
        // checks olive_spaces.couple_id = space_id) and leaves couple_id
        // NULL for non-couple spaces — which is what the FK requires.
        dbUpdates.space_id = nextScope;
      }

      const { data, error } = await supabase
        .from("clerk_lists")
        .update(dbUpdates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      // Privacy change → cascade to every note in this list.
      // Write only space_id (same reasoning as above — trigger mirrors).
      if (privacyChanged) {
        const { error: notesError } = await supabase
          .from("clerk_notes")
          .update({ space_id: nextScope })
          .eq("list_id", id);

        if (notesError) {
          console.error("[Lists] Error cascading privacy to notes:", notesError);
          // Don't throw - the list update succeeded
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
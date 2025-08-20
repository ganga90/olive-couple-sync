import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/providers/AuthProvider";

export type SupabaseList = {
  id: string;
  name: string;
  description: string | null;
  couple_id: string | null;
  author_id: string;
  is_manual: boolean;
  created_at: string;
  updated_at: string;
};

export type ListInsert = {
  name: string;
  description?: string;
  couple_id?: string | null;
  is_manual?: boolean;
};

export const useSupabaseLists = (coupleId?: string | null) => {
  const [lists, setLists] = useState<SupabaseList[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  console.log('[useSupabaseLists] Hook initialized with user:', !!user, 'coupleId:', coupleId);

  const fetchLists = useCallback(async () => {
    if (!user?.id) {
      console.log('[useSupabaseLists] No user, skipping fetch');
      setLists([]);
      setLoading(false);
      return;
    }

    console.log('[useSupabaseLists] fetchLists called with user:', !!user, 'coupleId:', coupleId);
    setLoading(true);

    try {
      let query = supabase
        .from('clerk_lists')
        .select('*')
        .order('created_at', { ascending: false });

      // Filter by couple or personal lists
      if (coupleId) {
        query = query.eq('couple_id', coupleId);
        console.log('[useSupabaseLists] Fetching couple lists for:', coupleId);
      } else {
        query = query.is('couple_id', null);
        console.log('[useSupabaseLists] Fetching personal lists (couple_id is null)');
      }

      const { data, error } = await query;

      if (error) {
        console.error('[useSupabaseLists] Error fetching lists:', error);
        setLists([]);
      } else {
        console.log('[useSupabaseLists] Successfully fetched lists:', data?.length || 0, 'lists');
        setLists(data || []);
      }
    } catch (error) {
      console.error('[useSupabaseLists] Unexpected error:', error);
      setLists([]);
    } finally {
      setLoading(false);
    }
  }, [user, coupleId]);

  // Set up real-time subscription
  useEffect(() => {
    if (!user?.id) return;

    console.log('[useSupabaseLists] Setting up realtime subscription for user:', user.id);

    const channel = supabase
      .channel('clerk_lists_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'clerk_lists',
        },
        (payload) => {
          console.log('[useSupabaseLists] Realtime update received:', payload.eventType);
          fetchLists();
        }
      )
      .subscribe();

    return () => {
      console.log('[useSupabaseLists] Cleaning up realtime subscription');
      supabase.removeChannel(channel);
    };
  }, [user?.id, fetchLists]);

  // Initial fetch
  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  const addList = useCallback(async (listData: ListInsert): Promise<SupabaseList | null> => {
    if (!user?.id) {
      console.error('[useSupabaseLists] Cannot add list: no authenticated user');
      return null;
    }

    console.log('[useSupabaseLists] addList called with:', { listData, userId: user.id, coupleId });

    try {
      const insertData = {
        ...listData,
        author_id: user.id,
        couple_id: coupleId || null,
      };

      console.log('[useSupabaseLists] Inserting list to clerk_lists table');
      console.log('[useSupabaseLists] Final insert data:', insertData);

      const { data, error } = await supabase
        .from('clerk_lists')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error('[useSupabaseLists] Error inserting list:', error);
        return null;
      }

      console.log('[useSupabaseLists] Successfully inserted list:', data);
      return data;
    } catch (error) {
      console.error('[useSupabaseLists] Unexpected error adding list:', error);
      return null;
    }
  }, [user, coupleId]);

  const updateList = useCallback(async (id: string, updates: Partial<ListInsert>): Promise<SupabaseList | null> => {
    if (!user?.id) {
      console.error('[useSupabaseLists] Cannot update list: no authenticated user');
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('clerk_lists')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('[useSupabaseLists] Error updating list:', error);
        return null;
      }

      console.log('[useSupabaseLists] Successfully updated list:', data);
      return data;
    } catch (error) {
      console.error('[useSupabaseLists] Unexpected error updating list:', error);
      return null;
    }
  }, [user]);

  const deleteList = useCallback(async (id: string): Promise<boolean> => {
    if (!user?.id) {
      console.error('[useSupabaseLists] Cannot delete list: no authenticated user');
      return false;
    }

    try {
      const { error } = await supabase
        .from('clerk_lists')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('[useSupabaseLists] Error deleting list:', error);
        return false;
      }

      console.log('[useSupabaseLists] Successfully deleted list:', id);
      return true;
    } catch (error) {
      console.error('[useSupabaseLists] Unexpected error deleting list:', error);
      return false;
    }
  }, [user]);

  const findListByName = useCallback((name: string): SupabaseList | null => {
    return lists.find(list => list.name.toLowerCase() === name.toLowerCase()) || null;
  }, [lists]);

  const refetch = useCallback(async () => {
    await fetchLists();
  }, [fetchLists]);

  return {
    lists,
    loading,
    addList,
    updateList,
    deleteList,
    findListByName,
    refetch,
  };
};
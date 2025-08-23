import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { useClerkSupabaseClient } from '@/integrations/supabase/clerk-adapter';

export interface SupabaseList {
  id: string;
  name: string;
  description: string | null;
  is_manual: boolean;
  author_id: string;
  couple_id: string | null;
  created_at: string;
  updated_at: string;
}

export const useSupabaseLists = (coupleId: string | null) => {
  const [lists, setLists] = useState<SupabaseList[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const supabaseClient = useClerkSupabaseClient();

  console.log('[useSupabaseLists] Hook initialized with user:', !!user, 'coupleId:', coupleId);

  const fetchLists = useCallback(async () => {
    if (!user) {
      console.log('[useSupabaseLists] No user, skipping fetch');
      setLists([]);
      setLoading(false);
      return;
    }

    console.log('[useSupabaseLists] fetchLists called with user:', !!user, 'coupleId:', coupleId);

    try {
      setLoading(true);
      
      let query = supabaseClient
        .from('clerk_lists' as any)
        .select('*')
        .order('created_at', { ascending: false });

      if (coupleId) {
        console.log('[useSupabaseLists] Fetching couple lists for coupleId:', coupleId);
        query = query.eq('couple_id', coupleId);
      } else {
        console.log('[useSupabaseLists] Fetching personal lists (couple_id is null)');
        query = query.is('couple_id', null);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[useSupabaseLists] Error fetching lists:', error);
        throw error;
      }

      console.log('[useSupabaseLists] Successfully fetched lists:', data?.length || 0, 'lists');
      setLists((data || []) as any);
    } catch (error) {
      console.error('[useSupabaseLists] Error in fetchLists:', error);
      setLists([]);
    } finally {
      setLoading(false);
    }
  }, [user, coupleId, supabaseClient]);

  const addList = useCallback(async (listData: {
    name: string;
    description?: string;
    is_manual: boolean;
  }): Promise<SupabaseList | null> => {
    if (!user) {
      console.error('[useSupabaseLists] Cannot add list: no user');
      return null;
    }

    console.log('[useSupabaseLists] addList called with:', { listData, userId: user.id, coupleId });

    try {
      console.log('[useSupabaseLists] Inserting list to clerk_lists table');
      
      const insertData = {
        name: listData.name,
        description: listData.description || null,
        is_manual: listData.is_manual,
        author_id: user.id,
        couple_id: coupleId,
      };

      console.log('[useSupabaseLists] Final insert data:', insertData);

      const { data, error } = await supabaseClient
        .from('clerk_lists' as any)
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error('[useSupabaseLists] Error inserting list:', error);
        throw error;
      }

      console.log('[useSupabaseLists] Successfully inserted list:', data);
      
      // Refresh the lists
      await fetchLists();
      
      return data as any;
    } catch (error) {
      console.error('[useSupabaseLists] Error in addList:', error);
      throw error;
    }
  }, [user, coupleId, fetchLists, supabaseClient]);

  const findOrCreateList = useCallback(async (
    categoryName: string, 
    isFromAI = true
  ): Promise<SupabaseList | null> => {
    if (!user) return null;

    // First, try to find existing list with similar name
    const normalizedName = categoryName.toLowerCase();
    const existingList = lists.find(list => 
      list.name.toLowerCase() === normalizedName ||
      list.name.toLowerCase().includes(normalizedName) ||
      normalizedName.includes(list.name.toLowerCase())
    );

    if (existingList) {
      console.log('[useSupabaseLists] Found existing list:', existingList.name);
      return existingList;
    }

    // Create new list
    console.log('[useSupabaseLists] Creating new list for category:', categoryName);
    return await addList({
      name: categoryName,
      description: isFromAI ? `Auto-generated from AI processing` : undefined,
      is_manual: !isFromAI,
    });
  }, [user, lists, addList]);

  useEffect(() => {
    console.log('[useSupabaseLists] useEffect triggered - fetching lists for user:', user?.id, 'coupleId:', coupleId);
    fetchLists();
  }, [fetchLists]);

  return {
    lists,
    loading,
    addList,
    findOrCreateList,
    refetch: fetchLists,
  };
};
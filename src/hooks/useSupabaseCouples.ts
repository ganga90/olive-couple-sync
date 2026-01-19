import { useCallback, useEffect, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { getSupabase } from "@/lib/supabaseClient";
import { toast } from "sonner";

export type SupabaseCouple = {
  id: string;
  title?: string;
  you_name?: string;
  partner_name?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  // Dynamic names based on current user (computed, not stored)
  resolvedYouName?: string;
  resolvedPartnerName?: string;
};

export type SupabaseCoupleMember = {
  id: string;
  couple_id: string;
  user_id: string;
  role: 'owner' | 'partner';
  created_at: string;
};

export const useSupabaseCouples = () => {
  const { user } = useUser();
  const [couples, setCouples] = useState<SupabaseCouple[]>([]);
  const [currentCouple, setCurrentCouple] = useState<SupabaseCouple | null>(() => {
    // Load persisted couple session
    const stored = localStorage.getItem('olive_current_couple');
    return stored ? JSON.parse(stored) : null;
  });
  const [loading, setLoading] = useState(true);
  

  console.log('[useSupabaseCouples] Hook initialized with user:', !!user, 'loading:', loading);

  const fetchCouples = useCallback(async () => {
    if (!user) {
      console.log("[Couples] No user, clearing state");
      setCouples([]);
      setCurrentCouple(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      console.log("[Couples] Fetching couples for user:", user.id);
      
      const supabase = getSupabase();
      
      // First ensure user profile exists
      await supabase
        .from('clerk_profiles')
        .upsert({
          id: user.id,
          display_name: user.fullName || user.emailAddresses[0]?.emailAddress.split('@')[0] || 'User',
        }, {
          onConflict: 'id'
        });

      const { data, error } = await supabase
        .from("clerk_couple_members")
        .select(`
          couple_id,
          role,
          clerk_couples!inner (
            id,
            title,
            you_name,
            partner_name,
            created_by,
            created_at,
            updated_at
          )
        `)
        .eq("user_id", user.id);

      if (error) throw error;

      // Transform couples with resolved names based on current user
      const userCouples = (data?.map(member => {
        const couple = member?.clerk_couples as unknown as SupabaseCouple;
        if (!couple) return null;
        
        // Determine if current user is the creator or the partner
        const isCreator = couple.created_by === user.id;
        
        // Swap names based on who is logged in:
        // - If current user is the creator: you_name is correct, partner_name is correct
        // - If current user is NOT the creator: swap them (partner sees you_name as their partner)
        const resolvedYouName = isCreator ? couple.you_name : couple.partner_name;
        const resolvedPartnerName = isCreator ? couple.partner_name : couple.you_name;
        
        console.log("[Couples] Resolving names for user:", user.id, {
          isCreator,
          original: { you_name: couple.you_name, partner_name: couple.partner_name },
          resolved: { resolvedYouName, resolvedPartnerName }
        });
        
        return {
          ...couple,
          resolvedYouName,
          resolvedPartnerName,
        };
      }).filter(Boolean) || []) as SupabaseCouple[];
      
      console.log("[Couples] Found couples:", userCouples);
      setCouples(userCouples);
      
      // Set the first couple as current if none selected, or clear if no couples
      if (userCouples.length > 0 && !currentCouple) {
        console.log("[Couples] Setting current couple to:", userCouples[0]);
        setCurrentCouple(userCouples[0]);
      } else if (userCouples.length === 0) {
        console.log("[Couples] No couples found, clearing current couple");
        setCurrentCouple(null);
        // Also clear from localStorage
        localStorage.removeItem('olive_current_couple');
      }
    } catch (error) {
      console.error("[Couples] Error fetching couples:", error);
      toast.error("Failed to load couples");
    } finally {
      console.log("[Couples] Fetch completed, setting loading to false");
      setLoading(false);
    }
  }, [user]); // Remove currentCouple dependency to avoid infinite loop

  useEffect(() => {
    fetchCouples();

    if (!user) return;

    const supabase = getSupabase();
    
    // Set up realtime subscription
    const channel = supabase
      .channel("clerk_couples_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "clerk_couples",
        },
        (payload) => {
          console.log("[Couples] Realtime update:", payload);
          fetchCouples();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "clerk_couple_members",
        },
        (payload) => {
          console.log("[Couples] Member realtime update:", payload);
          fetchCouples();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchCouples]);

  const createCouple = useCallback(async (coupleData: { title?: string; you_name?: string; partner_name?: string }) => {
    console.log("[Couples] Starting createCouple with:", { coupleData, user: user?.id });
    
    if (!user) {
      console.error("[Couples] No user found when creating couple");
      toast.error("You must be signed in to create a couple");
      return null;
    }

    try {
      const supabase = getSupabase();
      
      // Use the new RPC function to create couple + owner membership
      const rpcArgs = {
        p_title: coupleData.title || `${coupleData.you_name} & ${coupleData.partner_name}`,
        p_you_name: coupleData.you_name || '',
        p_partner_name: coupleData.partner_name || ''
      };
      console.log('[RPC:create_couple] body', rpcArgs);
      const { data, error } = await supabase.rpc('create_couple', rpcArgs);

      if (error) {
        console.error('[Couples] Failed to create couple via RPC:', error);
        toast.error(`Failed to create couple: ${error.message}`);
        return null;
      }

      console.log('[Couples] RPC response:', data);
      
      // The RPC now returns just the couple_id UUID
      if (!data) {
        console.error('[Couples] Invalid RPC response - missing couple_id');
        toast.error('Failed to create couple - invalid response');
        return null;
      }

      const coupleId = data;
      
      // Fetch the created couple details
      const { data: newCouple, error: fetchError } = await supabase
        .from('clerk_couples')
        .select('*')
        .eq('id', coupleId)
        .single();

      if (fetchError) {
        console.error('[Couples] Error fetching created couple:', fetchError);
        throw fetchError;
      }

      console.log("[Couples] Couple created successfully:", newCouple);
      
      // Refresh couples list and set current
      await fetchCouples();
      setCurrentCouple(newCouple);
      toast.success("Your workspace is ready!");
      
      return newCouple;
    } catch (error) {
      console.error("[Couples] Exception in createCouple:", error);
      toast.error(`Failed to create couple workspace: ${error.message || error}`);
      return null;
    }
  }, [user, fetchCouples]);

  const updateCouple = useCallback(async (id: string, updates: { title?: string; you_name?: string; partner_name?: string }) => {
    if (!user) {
      toast.error("You must be signed in to update couple");
      return null;
    }

    try {
      const supabase = getSupabase();
      
      const { data, error } = await supabase
        .from("clerk_couples")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      toast.success("Couple workspace updated successfully");
      
      // Update current couple if it's the one being updated
      if (currentCouple?.id === id) {
        setCurrentCouple(data);
      }
      
      return data;
    } catch (error) {
      console.error("[Couples] Error updating couple:", error);
      toast.error("Failed to update couple workspace");
      return null;
    }
  }, [user, currentCouple]);

  const switchCouple = useCallback((couple: SupabaseCouple) => {
    setCurrentCouple(couple);
    localStorage.setItem('olive_current_couple', JSON.stringify(couple));
  }, []);

  // Persist current couple to localStorage whenever it changes
  useEffect(() => {
    if (currentCouple) {
      localStorage.setItem('olive_current_couple', JSON.stringify(currentCouple));
    } else {
      localStorage.removeItem('olive_current_couple');
    }
  }, [currentCouple]);

  return {
    couples,
    currentCouple,
    loading,
    createCouple,
    updateCouple,
    switchCouple,
    refetch: fetchCouples,
  };
};
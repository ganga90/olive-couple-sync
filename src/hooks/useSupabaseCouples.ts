import { useCallback, useEffect, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";

export type SupabaseCouple = {
  id: string;
  title?: string;
  you_name?: string;
  partner_name?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
};

export type SupabaseCoupleMember = {
  id: string;
  couple_id: string;
  user_id: string;
  role: 'owner' | 'member';
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

      const userCouples = (data?.map(member => member.clerk_couples).filter(Boolean) || []) as unknown as SupabaseCouple[];
      console.log("[Couples] Found couples:", userCouples);
      setCouples(userCouples);
      
      // Set the first couple as current if none selected
      if (userCouples.length > 0 && !currentCouple) {
        console.log("[Couples] Setting current couple to:", userCouples[0]);
        setCurrentCouple(userCouples[0]);
      }
    } catch (error) {
      console.error("[Couples] Error fetching couples:", error);
      toast.error("Failed to load couples");
    } finally {
      console.log("[Couples] Fetch completed, setting loading to false");
      setLoading(false);
    }
  }, [user, supabase]); // Remove currentCouple dependency to avoid infinite loop

  useEffect(() => {
    fetchCouples();

    if (!user) return;

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
      // Debug JWT claims first
      console.log('[Couples] Debugging JWT claims before insert...');
      const { data: claims, error: claimsError } = await supabase.rpc('debug_claims');
      console.log('[Couples] debug_claims result:', { data: claims, error: claimsError });
      
      const claimsObj = claims as any;
      if (!claimsObj?.sub) {
        console.error('[Couples] No JWT sub found! Token not being passed to Supabase client.');
        toast.error("Authentication error - please refresh and try again");
        return null;
      }

      console.log('[Couples] JWT sub from claims:', claimsObj.sub);
      console.log('[Couples] User ID from Clerk:', user.id);
      console.log('[Couples] Auth role:', claimsObj.role);
      
      // Ensure user.id matches JWT sub
      if (user.id !== claimsObj.sub) {
        console.error('[Couples] Mismatch between user.id and JWT sub!', { userId: user.id, jwtSub: claimsObj.sub });
        toast.error("Authentication mismatch - please refresh and try again");
        return null;
      }

      // Use the new atomic RPC function for couple creation
      console.log('[Couples] Using create_couple RPC with params:', {
        p_title: coupleData.title,
        p_you_name: coupleData.you_name,
        p_partner_name: coupleData.partner_name
      });
      
      const { data, error } = await supabase.rpc('create_couple', {
        p_title: coupleData.title,
        p_you_name: coupleData.you_name,
        p_partner_name: coupleData.partner_name
      });

      console.log('[Couples] RPC result:', { data, error });

      if (error) {
        console.error('[Couples] Failed to create couple via RPC:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          fullError: JSON.stringify(error, null, 2)
        });
        toast.error(`Failed to create couple: ${error.message}`);
        return null;
      }

      if (data?.couple) {
        console.log("[Couples] Couple created successfully via RPC:", data.couple);
        
        // Refresh couples list and set current
        await fetchCouples();
        setCurrentCouple(data.couple);
        toast.success("Your workspace is ready!");
        
        return data.couple;
      }

      return null;
    } catch (error) {
      console.error("[Couples] Exception in createCouple:", error);
      toast.error(`Failed to create couple workspace: ${error.message || error}`);
      return null;
    }
  }, [user, supabase, fetchCouples]);

  const updateCouple = useCallback(async (id: string, updates: { title?: string; you_name?: string; partner_name?: string }) => {
    if (!user) {
      toast.error("You must be signed in to update couple");
      return null;
    }

    try {
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
  }, [user, currentCouple, supabase]);

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
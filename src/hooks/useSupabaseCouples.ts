import { useCallback, useEffect, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { useClerkSupabaseClient } from "@/integrations/supabase/clerk-adapter";
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
  const supabase = useClerkSupabaseClient();

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

      const userCouples = data?.map(member => member.clerk_couples).filter(Boolean) as SupabaseCouple[] || [];
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

    console.log("[Couples] Creating couple with data:", coupleData, "user:", user.id);

    try {
      // First, try to save to database to get the real ID
      console.log('[useSupabaseCouples] Attempting to save couple to database');
      console.log('[useSupabaseCouples] User ID:', user.id);
      console.log('[useSupabaseCouples] Couple data to insert:', {
        title: coupleData.title || `${coupleData.you_name || 'You'} & ${coupleData.partner_name || 'Partner'}`,
        you_name: coupleData.you_name,
        partner_name: coupleData.partner_name,
        created_by: user.id,
      });
      
      const { data, error } = await supabase
        .from("clerk_couples")
        .insert([{
          title: coupleData.title || `${coupleData.you_name || 'You'} & ${coupleData.partner_name || 'Partner'}`,
          you_name: coupleData.you_name,
          partner_name: coupleData.partner_name,
          created_by: user.id,
        }])
        .select()
        .single();

      if (error) {
        console.error('[useSupabaseCouples] Database save error details:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
          fullError: error
        });
        
        // Also log what we're trying to insert
        console.error('[useSupabaseCouples] Failed insert payload:', {
          title: coupleData.title || `${coupleData.you_name || 'You'} & ${coupleData.partner_name || 'Partner'}`,
          you_name: coupleData.you_name,
          partner_name: coupleData.partner_name,
          created_by: user.id,
        });
        
        // Create a fallback local couple if database fails
        const localCouple: SupabaseCouple = {
          id: crypto.randomUUID(),
          title: coupleData.title || `${coupleData.you_name || 'You'} & ${coupleData.partner_name || 'Partner'}`,
          you_name: coupleData.you_name,
          partner_name: coupleData.partner_name,
          created_by: user.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        
        setCurrentCouple(localCouple);
        setCouples(prev => [...prev, localCouple]);
        console.log("[Couples] Created local couple due to DB error:", localCouple);
        toast.error("Database error: Your workspace is in offline mode. Please check your connection.");
        
        return localCouple;
      }

      if (data) {
        console.log("[Couples] Couple saved to database successfully:", data);
        
        // Use the database couple (with real ID)
        setCurrentCouple(data);
        setCouples(prev => [...prev, data]);
        toast.success("Your workspace is ready!");
        
        return data;
      }

      return null;
    } catch (error) {
      console.error("[Couples] Error creating couple:", error);
      toast.error(`Failed to create couple workspace: ${error.message || error}`);
      return null;
    }
  }, [user, supabase]);

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
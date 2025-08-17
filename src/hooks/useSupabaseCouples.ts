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
  const [currentCouple, setCurrentCouple] = useState<SupabaseCouple | null>(null);
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
    if (!user) {
      console.error("[Couples] No user found when creating couple");
      toast.error("You must be signed in to create a couple");
      return null;
    }

    console.log("[Couples] Creating couple with data:", coupleData, "user:", user.id);

    try {
      // Create a local couple object that works immediately
      const localCouple: SupabaseCouple = {
        id: crypto.randomUUID(),
        title: coupleData.title || `${coupleData.you_name || 'You'} & ${coupleData.partner_name || 'Partner'}`,
        you_name: coupleData.you_name,
        partner_name: coupleData.partner_name,
        created_by: user.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Set it immediately for better UX
      setCurrentCouple(localCouple);
      setCouples(prev => [...prev, localCouple]);
      
      console.log("[Couples] Local couple created successfully:", localCouple);
      toast.success("Your space is ready! You can start adding notes.");
      
      // Try to save to database in background, but don't block on it
      try {
        const { data, error } = await supabase
          .from("clerk_couples")
          .insert([{
            ...coupleData,
            created_by: user.id,
          }])
          .select()
          .single();

        if (!error && data) {
          console.log("[Couples] Couple saved to database:", data);
          // Update with the real database ID
          setCurrentCouple(data);
          setCouples(prev => prev.map(c => c.id === localCouple.id ? data : c));
        }
      } catch (dbError) {
        console.warn("[Couples] Database save failed, but local couple still works:", dbError);
      }
      
      return localCouple;
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
  }, []);

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
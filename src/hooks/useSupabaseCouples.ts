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

  const fetchCouples = useCallback(async () => {
    if (!user) {
      setCouples([]);
      setCurrentCouple(null);
      setLoading(false);
      return;
    }

    try {
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
      setCouples(userCouples);
      
      // Set the first couple as current if none selected
      if (userCouples.length > 0 && !currentCouple) {
        setCurrentCouple(userCouples[0]);
      }
    } catch (error) {
      console.error("[Couples] Error fetching couples:", error);
      toast.error("Failed to load couples");
    } finally {
      setLoading(false);
    }
  }, [user, currentCouple, supabase]);

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
      toast.error("You must be signed in to create a couple");
      return null;
    }

    try {
      const { data, error } = await supabase
        .from("clerk_couples")
        .insert([{
          ...coupleData,
          created_by: user.id,
        }])
        .select()
        .single();

      if (error) throw error;
      toast.success("Couple workspace created successfully");
      setCurrentCouple(data);
      return data;
    } catch (error) {
      console.error("[Couples] Error creating couple:", error);
      toast.error("Failed to create couple workspace");
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
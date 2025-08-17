import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/providers/AuthProvider";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { toast } from "sonner";

export type SupabaseCouple = Tables<"couples">;
export type SupabaseCoupleInsert = TablesInsert<"couples">;
export type SupabaseCoupleUpdate = TablesUpdate<"couples">;

export type SupabaseCoupleMember = Tables<"couple_members">;

export const useSupabaseCouples = () => {
  const { user } = useAuth();
  const [couples, setCouples] = useState<SupabaseCouple[]>([]);
  const [currentCouple, setCurrentCouple] = useState<SupabaseCouple | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCouples = useCallback(async () => {
    if (!user) {
      setCouples([]);
      setCurrentCouple(null);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("couple_members")
        .select(`
          couple_id,
          role,
          couples!inner (
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

      const userCouples = data?.map(member => member.couples).filter(Boolean) as SupabaseCouple[] || [];
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
  }, [user, currentCouple]);

  useEffect(() => {
    fetchCouples();

    if (!user) return;

    // Set up realtime subscription
    const channel = supabase
      .channel("couples_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "couples",
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
          table: "couple_members",
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

  const createCouple = useCallback(async (coupleData: Omit<SupabaseCoupleInsert, "created_by">) => {
    if (!user) {
      toast.error("You must be signed in to create a couple");
      return null;
    }

    try {
      const { data, error } = await supabase
        .from("couples")
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
  }, [user]);

  const updateCouple = useCallback(async (id: string, updates: SupabaseCoupleUpdate) => {
    if (!user) {
      toast.error("You must be signed in to update couple");
      return null;
    }

    try {
      const { data, error } = await supabase
        .from("couples")
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
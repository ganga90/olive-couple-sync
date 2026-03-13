import { useCallback, useEffect, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { getSupabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import type { SpaceMember } from "@/types/space";

export type SupabaseCouple = {
  id: string;
  title?: string;
  you_name?: string;
  partner_name?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  max_members?: number;
  // Legacy compat fields (computed)
  resolvedYouName?: string;
  resolvedPartnerName?: string;
};

export type SupabaseCoupleMember = {
  id: string;
  couple_id: string;
  user_id: string;
  role: 'owner' | 'member';
  display_name?: string;
  created_at: string;
};

export const useSupabaseCouples = () => {
  const { user } = useUser();
  const [couples, setCouples] = useState<SupabaseCouple[]>([]);
  const [currentCouple, setCurrentCouple] = useState<SupabaseCouple | null>(() => {
    const stored = localStorage.getItem('olive_current_couple');
    return stored ? JSON.parse(stored) : null;
  });
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch members for a specific couple via RPC
  const fetchMembers = useCallback(async (coupleId: string) => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc('get_space_members', { p_couple_id: coupleId });
      if (error) {
        console.error("[Couples] Error fetching members:", error);
        return [];
      }
      return (data || []) as SpaceMember[];
    } catch (e) {
      console.error("[Couples] Exception fetching members:", e);
      return [];
    }
  }, []);

  const fetchCouples = useCallback(async () => {
    if (!user) {
      setCouples([]);
      setCurrentCouple(null);
      setMembers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabase();

      // Ensure user profile exists
      await supabase
        .from('clerk_profiles')
        .upsert({
          id: user.id,
          display_name: user.fullName || user.emailAddresses[0]?.emailAddress.split('@')[0] || 'User',
        }, { onConflict: 'id' });

      const { data, error } = await supabase
        .from("clerk_couple_members")
        .select(`
          couple_id,
          role,
          clerk_couples!inner (
            id, title, you_name, partner_name, created_by, created_at, updated_at, max_members
          )
        `)
        .eq("user_id", user.id);

      if (error) throw error;

      const userCouples = (data?.map(member => {
        const couple = member?.clerk_couples as unknown as SupabaseCouple;
        if (!couple) return null;

        // Legacy compat: resolve names from members (will be overwritten below for current couple)
        const isCreator = couple.created_by === user.id;
        return {
          ...couple,
          resolvedYouName: isCreator ? couple.you_name : couple.partner_name,
          resolvedPartnerName: isCreator ? couple.partner_name : couple.you_name,
        };
      }).filter(Boolean) || []) as SupabaseCouple[];

      setCouples(userCouples);

      // Determine current couple - read from localStorage to avoid stale closure
      const storedCouple = localStorage.getItem('olive_current_couple');
      const storedCoupleId = storedCouple ? JSON.parse(storedCouple)?.id : null;
      let activeCoupleId = storedCoupleId;
      let activeCouple = userCouples.find(c => c.id === activeCoupleId) || userCouples[0] || null;

      if (activeCouple) {
        // Fetch members for the active couple
        const spaceMembers = await fetchMembers(activeCouple.id);
        setMembers(spaceMembers);

        // Update resolved names from members array
        const currentMember = spaceMembers.find(m => m.user_id === user.id);
        const otherMembers = spaceMembers.filter(m => m.user_id !== user.id);

        activeCouple = {
          ...activeCouple,
          resolvedYouName: currentMember?.display_name || activeCouple.you_name || '',
          resolvedPartnerName: otherMembers.map(m => m.display_name).join(', ') || activeCouple.partner_name || '',
        };

        setCurrentCouple(activeCouple);
      } else {
        setCurrentCouple(null);
        setMembers([]);
        localStorage.removeItem('olive_current_couple');
      }
    } catch (error) {
      console.error("[Couples] Error fetching couples:", error);
      toast.error("Failed to load couples");
    } finally {
      setLoading(false);
    }
  }, [user, fetchMembers]);

  useEffect(() => {
    fetchCouples();

    if (!user) return;

    const supabase = getSupabase();
    const channel = supabase
      .channel("clerk_couples_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "clerk_couples" }, () => fetchCouples())
      .on("postgres_changes", { event: "*", schema: "public", table: "clerk_couple_members" }, () => fetchCouples())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, fetchCouples]);

  const createCouple = useCallback(async (coupleData: { title?: string; you_name?: string; partner_name?: string }) => {
    if (!user) {
      toast.error("You must be signed in to create a couple");
      return null;
    }

    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc('create_couple', {
        p_title: coupleData.title || `${coupleData.you_name} & ${coupleData.partner_name}`,
        p_you_name: coupleData.you_name || '',
        p_partner_name: coupleData.partner_name || ''
      });

      if (error) {
        toast.error(`Failed to create couple: ${error.message}`);
        return null;
      }

      if (!data) {
        toast.error('Failed to create couple - invalid response');
        return null;
      }

      const { data: newCouple, error: fetchError } = await supabase
        .from('clerk_couples')
        .select('*')
        .eq('id', data)
        .single();

      if (fetchError) throw fetchError;

      await fetchCouples();
      setCurrentCouple(newCouple);
      toast.success("Your workspace is ready!");
      return newCouple;
    } catch (error: any) {
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

  const switchCouple = useCallback(async (couple: SupabaseCouple) => {
    setCurrentCouple(couple);
    localStorage.setItem('olive_current_couple', JSON.stringify(couple));
    // Refresh members for new couple
    const spaceMembers = await fetchMembers(couple.id);
    setMembers(spaceMembers);
  }, [fetchMembers]);

  // Persist current couple to localStorage
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
    members,
    loading,
    createCouple,
    updateCouple,
    switchCouple,
    refetch: fetchCouples,
  };
};

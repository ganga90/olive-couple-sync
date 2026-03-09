import React, { createContext, useCallback, useContext, useMemo } from "react";
import { useAuth } from "./AuthProvider";
import { useSupabaseCouples, SupabaseCouple } from "@/hooks/useSupabaseCouples";
import type { SpaceMember } from "@/types/space";

type SupabaseCoupleContextValue = {
  currentCouple: SupabaseCouple | null;
  couples: SupabaseCouple[] | [];
  members: SpaceMember[];
  loading: boolean;
  isOnboarded: boolean;
  you: string;
  partner: string;
  createCouple: (coupleData: { title?: string; you_name?: string; partner_name?: string }) => Promise<SupabaseCouple | null>;
  updateCouple: (id: string, updates: { title?: string; you_name?: string; partner_name?: string }) => Promise<SupabaseCouple | null>;
  switchCouple: (couple: SupabaseCouple) => void;
  setNames: (you: string, partner: string) => Promise<void>;
  refetch: () => Promise<void>;
  getMemberName: (userId: string) => string;
};

const SupabaseCoupleContext = createContext<SupabaseCoupleContextValue | undefined>(undefined);

export const SupabaseCoupleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { couples, currentCouple, members, loading, createCouple, updateCouple, switchCouple, refetch } = useSupabaseCouples();

  const setNames = async (you: string, partner: string) => {
    if (!currentCouple) {
      await createCouple({
        title: `${you} & ${partner}`,
        you_name: you,
        partner_name: partner,
      });
    } else {
      await updateCouple(currentCouple.id, {
        you_name: you,
        partner_name: partner,
        title: `${you} & ${partner}`,
      });
    }
  };

  const getMemberName = useCallback((userId: string): string => {
    if (!userId) return "Unknown";
    if (userId === user?.id) return "You";
    const member = members.find(m => m.user_id === userId);
    if (member) return member.display_name;
    // Fallback to legacy partner name
    if (currentCouple?.resolvedPartnerName) return currentCouple.resolvedPartnerName;
    return "Unknown";
  }, [members, user?.id, currentCouple]);

  const value = useMemo(() => {
    const isOnboardedValue = Boolean(currentCouple);
    const currentMember = members.find(m => m.user_id === user?.id);
    const otherMembers = members.filter(m => m.user_id !== user?.id);

    return {
      currentCouple,
      couples,
      members,
      loading,
      isOnboarded: isOnboardedValue,
      you: currentMember?.display_name || currentCouple?.resolvedYouName || currentCouple?.you_name || "",
      partner: otherMembers.map(m => m.display_name).join(', ') || currentCouple?.resolvedPartnerName || currentCouple?.partner_name || "",
      createCouple,
      updateCouple,
      switchCouple,
      setNames,
      refetch,
      getMemberName,
    };
  }, [currentCouple, couples, members, loading, createCouple, updateCouple, switchCouple, refetch, user?.id, getMemberName]);

  return (
    <SupabaseCoupleContext.Provider value={value}>
      {children}
    </SupabaseCoupleContext.Provider>
  );
};

export const useSupabaseCouple = () => {
  const ctx = useContext(SupabaseCoupleContext);
  if (!ctx) throw new Error("useSupabaseCouple must be used within SupabaseCoupleProvider");
  return ctx;
};

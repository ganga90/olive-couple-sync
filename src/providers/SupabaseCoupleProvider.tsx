import React, { createContext, useContext, useEffect, useMemo } from "react";
import { useAuth } from "./AuthProvider";
import { useSupabaseCouples, SupabaseCouple } from "@/hooks/useSupabaseCouples";

type SupabaseCoupleContextValue = {
  currentCouple: SupabaseCouple | null;
  couples: SupabaseCouple[] | [];
  loading: boolean;
  isOnboarded: boolean;
  you: string;
  partner: string;
  createCouple: (coupleData: { title?: string; you_name?: string; partner_name?: string }) => Promise<SupabaseCouple | null>;
  updateCouple: (id: string, updates: { title?: string; you_name?: string; partner_name?: string }) => Promise<SupabaseCouple | null>;
  switchCouple: (couple: SupabaseCouple) => void;
  setNames: (you: string, partner: string) => Promise<void>;
  refetch: () => Promise<void>;
};

const SupabaseCoupleContext = createContext<SupabaseCoupleContextValue | undefined>(undefined);

export const SupabaseCoupleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { couples, currentCouple, loading, createCouple, updateCouple, switchCouple, refetch } = useSupabaseCouples();

  const setNames = async (you: string, partner: string) => {
    if (!currentCouple) {
      // Create new couple if none exists
      await createCouple({
        title: `${you} & ${partner}`,
        you_name: you,
        partner_name: partner,
      });
    } else {
      // Update existing couple
      await updateCouple(currentCouple.id, {
        you_name: you,
        partner_name: partner,
        title: `${you} & ${partner}`,
      });
    }
  };

  const value = useMemo(() => {
    // User is onboarded if they have a couple (regardless of partner_name being set)
    // This allows "Set up My space Only" to work properly
    const isOnboardedValue = Boolean(currentCouple);
    return {
      currentCouple,
      couples,
      loading,
      isOnboarded: isOnboardedValue,
      // Use resolved names that are dynamically swapped based on logged-in user
      you: currentCouple?.resolvedYouName || currentCouple?.you_name || "",
      partner: currentCouple?.resolvedPartnerName || currentCouple?.partner_name || "",
      createCouple,
      updateCouple,
      switchCouple,
      setNames,
      refetch,
    };
  }, [currentCouple, couples, loading, createCouple, updateCouple, switchCouple, refetch]);

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
import React, { createContext, useContext, useMemo } from "react";
import { useSupabaseCouple } from "./SupabaseCoupleProvider";
import { useSupabaseLists, SupabaseList, ListInsert } from "@/hooks/useSupabaseLists";
import { useAuth } from "./AuthProvider";

type SupabaseListsContextValue = {
  lists: SupabaseList[];
  loading: boolean;
  addList: (listData: ListInsert) => Promise<SupabaseList | null>;
  updateList: (id: string, updates: Partial<ListInsert>) => Promise<SupabaseList | null>;
  deleteList: (id: string) => Promise<boolean>;
  findListByName: (name: string) => SupabaseList | null;
  refetch: () => Promise<void>;
};

const SupabaseListsContext = createContext<SupabaseListsContextValue | undefined>(undefined);

export const SupabaseListsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentCouple } = useSupabaseCouple();
  const { user } = useAuth();
  
  console.log('[SupabaseListsProvider] Rendering with currentCouple:', !!currentCouple, currentCouple?.id);
  
  const { 
    lists, 
    loading, 
    addList, 
    updateList, 
    deleteList,
    findListByName,
    refetch 
  } = useSupabaseLists(currentCouple?.id || null);

  const value = useMemo(() => ({
    lists,
    loading,
    addList,
    updateList,
    deleteList,
    findListByName,
    refetch,
  }), [lists, loading, addList, updateList, deleteList, findListByName, refetch]);

  return (
    <SupabaseListsContext.Provider value={value}>
      {children}
    </SupabaseListsContext.Provider>
  );
};

export const useSupabaseListsContext = () => {
  const ctx = useContext(SupabaseListsContext);
  if (!ctx) throw new Error("useSupabaseListsContext must be used within SupabaseListsProvider");
  return ctx;
};
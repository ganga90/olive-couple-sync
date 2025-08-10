import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const COUPLE_KEY = "olive:couple";

export type CoupleState = {
  you: string;
  partner: string;
};

type CoupleContextValue = {
  you: string;
  partner: string;
  isOnboarded: boolean;
  setNames: (you: string, partner: string) => void;
  reset: () => void;
};

const CoupleContext = createContext<CoupleContextValue | undefined>(undefined);

export const CoupleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [you, setYou] = useState("");
  const [partner, setPartner] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COUPLE_KEY);
      if (raw) {
        const parsed: CoupleState = JSON.parse(raw);
        setYou(parsed.you || "");
        setPartner(parsed.partner || "");
      }
    } catch (e) {
      console.error("[CoupleProvider] Failed to load couple state", e);
    }
  }, []);

  const persist = useCallback((state: CoupleState) => {
    try {
      localStorage.setItem(COUPLE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("[CoupleProvider] Failed to persist couple state", e);
    }
  }, []);

  const setNames = useCallback((newYou: string, newPartner: string) => {
    setYou(newYou);
    setPartner(newPartner);
    persist({ you: newYou, partner: newPartner });
  }, [persist]);

  const reset = useCallback(() => {
    setYou("");
    setPartner("");
    try {
      localStorage.removeItem(COUPLE_KEY);
    } catch {}
  }, []);

  const value = useMemo(() => ({
    you,
    partner,
    isOnboarded: Boolean(you && partner),
    setNames,
    reset,
  }), [you, partner, setNames, reset]);

  return <CoupleContext.Provider value={value}>{children}</CoupleContext.Provider>;
};

export const useCouple = () => {
  const ctx = useContext(CoupleContext);
  if (!ctx) throw new Error("useCouple must be used within CoupleProvider");
  return ctx;
};

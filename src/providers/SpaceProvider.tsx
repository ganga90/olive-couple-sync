/**
 * SpaceProvider — Context provider for the Olive Spaces system.
 *
 * Wraps useSpaces and exposes space state to the entire app.
 * This is ADDITIVE — it sits alongside SupabaseCoupleProvider
 * and does NOT replace it.
 *
 * Provider hierarchy (in App.tsx):
 *   SupabaseCoupleProvider → SpaceProvider → ...
 *
 * The provider also bridges the couple→space relationship:
 * when a user has a currentCouple, the matching space (same UUID)
 * is auto-selected as currentSpace for seamless backward compat.
 */
import React, { createContext, useContext, useEffect, useMemo } from "react";
import {
  useSpaces,
  Space,
  SpaceMember,
  SpaceInvite,
  SpaceType,
  SpaceRole,
} from "@/hooks/useSpaces";
import { useSupabaseCouple } from "./SupabaseCoupleProvider";

type SpaceContextValue = {
  // State
  spaces: Space[];
  currentSpace: Space | null;
  loading: boolean;
  hasSpaces: boolean;

  // Convenience: current space info
  spaceName: string;
  spaceType: SpaceType;
  spaceRole: SpaceRole | undefined;
  isSpaceOwner: boolean;
  memberCount: number;

  // Convenience: is this a couple-linked space?
  isCoupleSpace: boolean;

  // Actions
  createSpace: (data: {
    name: string;
    type?: SpaceType;
    icon?: string;
    settings?: Record<string, any>;
  }) => Promise<Space | null>;
  updateSpace: (
    spaceId: string,
    updates: { name?: string; icon?: string; settings?: Record<string, any> }
  ) => Promise<Space | null>;
  switchSpace: (space: Space) => void;
  createInvite: (
    spaceId: string,
    options?: { email?: string; role?: SpaceRole }
  ) => Promise<SpaceInvite | null>;
  acceptInvite: (token: string) => Promise<boolean>;
  getMembers: (spaceId: string) => Promise<SpaceMember[]>;
  leaveSpace: (spaceId: string) => Promise<boolean>;
  deleteSpace: (spaceId: string) => Promise<boolean>;
  refetch: () => Promise<void>;
};

const SpaceContext = createContext<SpaceContextValue | undefined>(undefined);

export const SpaceProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const {
    spaces,
    currentSpace,
    loading,
    createSpace,
    updateSpace,
    switchSpace,
    createInvite,
    acceptInvite,
    getMembers,
    leaveSpace,
    deleteSpace,
    refetch,
  } = useSpaces();

  // Bridge: auto-sync from couple selection → space selection
  // This ensures existing couple users automatically get the right space
  const { currentCouple } = useSupabaseCouple();

  useEffect(() => {
    if (!currentCouple || !spaces.length || loading) return;

    // If the current couple matches a space (same UUID), auto-select it
    // Only auto-switch if no space is selected or if the space doesn't match the couple
    if (!currentSpace || currentSpace.couple_id !== currentCouple.id) {
      const matchingSpace = spaces.find((s) => s.couple_id === currentCouple.id);
      if (matchingSpace) {
        switchSpace(matchingSpace);
      }
    }
  }, [currentCouple, spaces, currentSpace, loading, switchSpace]);

  const value = useMemo<SpaceContextValue>(() => {
    const cs = currentSpace;
    return {
      spaces,
      currentSpace: cs,
      loading,
      hasSpaces: spaces.length > 0,

      spaceName: cs?.name || "",
      spaceType: cs?.type || "couple",
      spaceRole: cs?.user_role,
      isSpaceOwner: cs?.user_role === "owner",
      memberCount: cs?.member_count || 0,
      isCoupleSpace: Boolean(cs?.couple_id),

      createSpace,
      updateSpace,
      switchSpace,
      createInvite,
      acceptInvite,
      getMembers,
      leaveSpace,
      deleteSpace,
      refetch,
    };
  }, [
    spaces,
    currentSpace,
    loading,
    createSpace,
    updateSpace,
    switchSpace,
    createInvite,
    acceptInvite,
    getMembers,
    leaveSpace,
    deleteSpace,
    refetch,
  ]);

  return (
    <SpaceContext.Provider value={value}>{children}</SpaceContext.Provider>
  );
};

export const useSpace = () => {
  const ctx = useContext(SpaceContext);
  if (!ctx)
    throw new Error("useSpace must be used within SpaceProvider");
  return ctx;
};

// Re-export types for convenience
export type { Space, SpaceMember, SpaceInvite, SpaceType, SpaceRole };

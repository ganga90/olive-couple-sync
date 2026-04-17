/**
 * useSpaces — Spaces hook mirroring useSupabaseCouples pattern.
 *
 * Fetches user's spaces via olive_space_members → olive_spaces join,
 * manages currentSpace selection, localStorage persistence, and
 * realtime subscriptions.
 *
 * This is ADDITIVE — it does not touch or replace useSupabaseCouples.
 */
import { useCallback, useEffect, useState } from "react";
import { useSafeUser as useUser } from "@/hooks/useSafeClerk";
import { getSupabase } from "@/lib/supabaseClient";
import { toast } from "sonner";

export type SpaceType = "couple" | "family" | "household" | "business" | "custom";
export type SpaceRole = "owner" | "admin" | "member";

export type Space = {
  id: string;
  name: string;
  type: SpaceType;
  icon: string | null;
  max_members: number;
  settings: Record<string, any>;
  couple_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  // Computed from join
  user_role?: SpaceRole;
  member_count?: number;
};

export type SpaceMember = {
  id: string;
  space_id: string;
  user_id: string;
  role: SpaceRole;
  nickname: string | null;
  joined_at: string;
  // Enriched
  display_name?: string;
};

export type SpaceInvite = {
  id: string;
  token: string;
  space_id: string;
  role: SpaceRole;
  invited_email: string | null;
  invited_by: string;
  created_at: string;
  expires_at: string;
  status: "pending" | "accepted" | "expired" | "revoked";
};

const STORAGE_KEY = "olive_current_space";

export const useSpaces = () => {
  const { user } = useUser();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [currentSpace, setCurrentSpace] = useState<Space | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  // ─── Fetch all spaces for the current user ────────────────────
  const fetchSpaces = useCallback(async () => {
    if (!user) {
      setSpaces([]);
      setCurrentSpace(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabase();

      // Use the RPC function which returns enriched data
      const { data, error } = await supabase.rpc("get_user_spaces");

      if (error) throw error;

      const userSpaces: Space[] = (data || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        type: row.type as SpaceType,
        icon: row.icon,
        max_members: row.max_members,
        settings: row.settings || {},
        couple_id: row.couple_id,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        user_role: row.user_role as SpaceRole,
        member_count: Number(row.member_count || 0),
      }));

      setSpaces(userSpaces);

      // Auto-select first space if none selected, or validate current selection
      if (userSpaces.length > 0) {
        if (!currentSpace) {
          setCurrentSpace(userSpaces[0]);
        } else {
          // Ensure currentSpace still exists in the list (could have been deleted)
          const stillExists = userSpaces.find((s) => s.id === currentSpace.id);
          if (!stillExists) {
            setCurrentSpace(userSpaces[0]);
          } else {
            // Refresh with latest data
            setCurrentSpace(stillExists);
          }
        }
      } else {
        setCurrentSpace(null);
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (error) {
      console.error("[Spaces] Error fetching spaces:", error);
      // Don't toast on initial load failure — spaces may not exist yet for legacy users
    } finally {
      setLoading(false);
    }
  }, [user]);

  // ─── Realtime subscription ────────────────────────────────────
  useEffect(() => {
    fetchSpaces();

    if (!user) return;

    const supabase = getSupabase();
    const channel = supabase
      .channel("olive_spaces_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "olive_spaces",
        },
        () => fetchSpaces()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "olive_space_members",
        },
        () => fetchSpaces()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchSpaces]);

  // ─── Persist currentSpace to localStorage ─────────────────────
  useEffect(() => {
    if (currentSpace) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSpace));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [currentSpace]);

  // ─── Create a new space ───────────────────────────────────────
  const createSpace = useCallback(
    async (data: {
      name: string;
      type?: SpaceType;
      icon?: string;
      settings?: Record<string, any>;
    }): Promise<Space | null> => {
      if (!user) {
        toast.error("You must be signed in to create a space");
        return null;
      }

      try {
        const supabase = getSupabase();

        // Call the edge function for full space creation (includes soul generation)
        const { data: result, error } = await supabase.functions.invoke(
          "olive-space-manage",
          {
            body: {
              action: "create",
              name: data.name,
              type: data.type || "custom",
              icon: data.icon,
              settings: data.settings || {},
            },
          }
        );

        if (error) throw error;
        if (result?.error) throw new Error(result.error);

        const newSpace = result.space as Space;
        toast.success(`"${newSpace.name}" space created!`);

        await fetchSpaces();
        setCurrentSpace(newSpace);

        return newSpace;
      } catch (error: any) {
        console.error("[Spaces] Error creating space:", error);
        toast.error(`Failed to create space: ${error.message || error}`);
        return null;
      }
    },
    [user, fetchSpaces]
  );

  // ─── Update a space ───────────────────────────────────────────
  const updateSpace = useCallback(
    async (
      spaceId: string,
      updates: { name?: string; icon?: string; settings?: Record<string, any> }
    ): Promise<Space | null> => {
      if (!user) {
        toast.error("You must be signed in");
        return null;
      }

      try {
        const supabase = getSupabase();

        const { data: result, error } = await supabase.functions.invoke(
          "olive-space-manage",
          {
            body: {
              action: "update",
              space_id: spaceId,
              ...updates,
            },
          }
        );

        if (error) throw error;
        if (result?.error) throw new Error(result.error);

        const updated = result.space as Space;
        toast.success("Space updated");

        if (currentSpace?.id === spaceId) {
          setCurrentSpace(updated);
        }

        await fetchSpaces();
        return updated;
      } catch (error: any) {
        console.error("[Spaces] Error updating space:", error);
        toast.error(`Failed to update space: ${error.message || error}`);
        return null;
      }
    },
    [user, currentSpace, fetchSpaces]
  );

  // ─── Switch the active space ──────────────────────────────────
  const switchSpace = useCallback((space: Space) => {
    setCurrentSpace(space);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(space));
  }, []);

  // ─── Create invite link ──────────────────────────────────────
  const createInvite = useCallback(
    async (
      spaceId: string,
      options?: { email?: string; role?: SpaceRole }
    ): Promise<SpaceInvite | null> => {
      if (!user) return null;

      try {
        const supabase = getSupabase();

        const { data: result, error } = await supabase.functions.invoke(
          "olive-space-manage",
          {
            body: {
              action: "invite",
              space_id: spaceId,
              invited_email: options?.email,
              role: options?.role || "member",
            },
          }
        );

        if (error) throw error;
        if (result?.error) throw new Error(result.error);

        return result.invite as SpaceInvite;
      } catch (error: any) {
        console.error("[Spaces] Error creating invite:", error);
        toast.error(`Failed to create invite: ${error.message || error}`);
        return null;
      }
    },
    [user]
  );

  // ─── Accept invite by token ──────────────────────────────────
  const acceptInvite = useCallback(
    async (token: string): Promise<boolean> => {
      if (!user) {
        toast.error("You must be signed in to accept an invite");
        return false;
      }

      try {
        const supabase = getSupabase();

        const { data: result, error } = await supabase.functions.invoke(
          "olive-space-manage",
          {
            body: {
              action: "accept_invite",
              token,
            },
          }
        );

        if (error) throw error;
        if (result?.error) throw new Error(result.error);

        toast.success("You've joined the space!");
        await fetchSpaces();

        // Switch to the newly joined space
        if (result.member?.space_id) {
          const joined = spaces.find((s) => s.id === result.member.space_id);
          if (joined) switchSpace(joined);
        }

        return true;
      } catch (error: any) {
        console.error("[Spaces] Error accepting invite:", error);
        toast.error(`Failed to join space: ${error.message || error}`);
        return false;
      }
    },
    [user, fetchSpaces, spaces, switchSpace]
  );

  // ─── Get members of a space ──────────────────────────────────
  const getMembers = useCallback(
    async (spaceId: string): Promise<SpaceMember[]> => {
      try {
        const supabase = getSupabase();

        const { data: result, error } = await supabase.functions.invoke(
          "olive-space-manage",
          {
            body: {
              action: "get_members",
              space_id: spaceId,
            },
          }
        );

        if (error) throw error;
        if (result?.error) throw new Error(result.error);

        return (result.members || []) as SpaceMember[];
      } catch (error: any) {
        console.error("[Spaces] Error fetching members:", error);
        return [];
      }
    },
    []
  );

  // ─── Leave a space ───────────────────────────────────────────
  const leaveSpace = useCallback(
    async (spaceId: string): Promise<boolean> => {
      if (!user) return false;

      try {
        const supabase = getSupabase();

        const { data: result, error } = await supabase.functions.invoke(
          "olive-space-manage",
          {
            body: {
              action: "leave",
              space_id: spaceId,
            },
          }
        );

        if (error) throw error;
        if (result?.error) throw new Error(result.error);

        toast.success("You've left the space");

        // If leaving current space, switch to another
        if (currentSpace?.id === spaceId) {
          const remaining = spaces.filter((s) => s.id !== spaceId);
          setCurrentSpace(remaining[0] || null);
        }

        await fetchSpaces();
        return true;
      } catch (error: any) {
        console.error("[Spaces] Error leaving space:", error);
        toast.error(`Failed to leave space: ${error.message || error}`);
        return false;
      }
    },
    [user, currentSpace, spaces, fetchSpaces]
  );

  // ─── Delete a space ──────────────────────────────────────────
  const deleteSpace = useCallback(
    async (spaceId: string): Promise<boolean> => {
      if (!user) return false;

      try {
        const supabase = getSupabase();

        const { data: result, error } = await supabase.functions.invoke(
          "olive-space-manage",
          {
            body: {
              action: "delete",
              space_id: spaceId,
            },
          }
        );

        if (error) throw error;
        if (result?.error) throw new Error(result.error);

        toast.success("Space deleted");

        if (currentSpace?.id === spaceId) {
          const remaining = spaces.filter((s) => s.id !== spaceId);
          setCurrentSpace(remaining[0] || null);
        }

        await fetchSpaces();
        return true;
      } catch (error: any) {
        console.error("[Spaces] Error deleting space:", error);
        toast.error(`Failed to delete space: ${error.message || error}`);
        return false;
      }
    },
    [user, currentSpace, spaces, fetchSpaces]
  );

  return {
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
    refetch: fetchSpaces,
  };
};

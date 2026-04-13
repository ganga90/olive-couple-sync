/**
 * useCollaboration — Hook for collaboration primitives.
 *
 * Provides thread, reaction, mention, and activity feed operations
 * via the olive-collaboration edge function.
 */
import { useCallback } from "react";
import { useUser } from "@clerk/clerk-react";
import { getSupabase } from "@/lib/supabaseClient";

// ─── Types ──────────────────────────────────────────────────────

export type NoteThread = {
  id: string;
  note_id: string;
  author_id: string;
  body: string;
  parent_id: string | null;
  space_id: string | null;
  created_at: string;
  updated_at: string;
  author_display_name?: string;
};

export type ReactionSummary = Record<
  string,
  {
    count: number;
    users: string[];
    user_ids: string[];
    reacted_by_me: boolean;
  }
>;

export type NoteMention = {
  id: string;
  note_id: string | null;
  thread_id: string | null;
  mentioned_user_id: string;
  mentioned_by: string;
  mentioned_by_name?: string;
  space_id: string | null;
  read_at: string | null;
  created_at: string;
  clerk_notes?: { summary: string; category: string };
};

export type ActivityEvent = {
  id: string;
  space_id: string;
  actor_id: string;
  actor_display_name?: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, any>;
  created_at: string;
};

// ─── Hook ───────────────────────────────────────────────────────

export const useCollaboration = () => {
  const { user } = useUser();

  const invoke = useCallback(
    async (action: string, params: Record<string, any> = {}) => {
      const supabase = getSupabase();
      const { data, error } = await supabase.functions.invoke(
        "olive-collaboration",
        { body: { action, ...params } }
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    []
  );

  // ─── Threads ────────────────────────────────────────────────

  const addThread = useCallback(
    async (noteId: string, body: string, parentId?: string): Promise<NoteThread | null> => {
      try {
        const result = await invoke("add_thread", {
          note_id: noteId,
          body,
          parent_id: parentId,
        });
        return result.thread || null;
      } catch (err) {
        console.error("[useCollaboration] addThread error:", err);
        return null;
      }
    },
    [invoke]
  );

  const listThreads = useCallback(
    async (noteId: string, limit = 50): Promise<NoteThread[]> => {
      try {
        const result = await invoke("list_threads", {
          note_id: noteId,
          limit,
        });
        return result.threads || [];
      } catch (err) {
        console.error("[useCollaboration] listThreads error:", err);
        return [];
      }
    },
    [invoke]
  );

  const updateThread = useCallback(
    async (threadId: string, body: string): Promise<NoteThread | null> => {
      try {
        const result = await invoke("update_thread", {
          thread_id: threadId,
          body,
        });
        return result.thread || null;
      } catch (err) {
        console.error("[useCollaboration] updateThread error:", err);
        return null;
      }
    },
    [invoke]
  );

  const deleteThread = useCallback(
    async (threadId: string): Promise<boolean> => {
      try {
        await invoke("delete_thread", { thread_id: threadId });
        return true;
      } catch (err) {
        console.error("[useCollaboration] deleteThread error:", err);
        return false;
      }
    },
    [invoke]
  );

  // ─── Reactions ──────────────────────────────────────────────

  const toggleReaction = useCallback(
    async (noteId: string, emoji: string): Promise<"added" | "removed" | null> => {
      try {
        const result = await invoke("toggle_reaction", {
          note_id: noteId,
          emoji,
        });
        return result.action || null;
      } catch (err) {
        console.error("[useCollaboration] toggleReaction error:", err);
        return null;
      }
    },
    [invoke]
  );

  const getReactions = useCallback(
    async (noteId: string): Promise<ReactionSummary> => {
      try {
        const result = await invoke("get_reactions", { note_id: noteId });
        return result.reactions || {};
      } catch (err) {
        console.error("[useCollaboration] getReactions error:", err);
        return {};
      }
    },
    [invoke]
  );

  // ─── Mentions ───────────────────────────────────────────────

  const getMentions = useCallback(
    async (unreadOnly = true, limit = 20): Promise<NoteMention[]> => {
      try {
        const result = await invoke("get_mentions", {
          unread_only: unreadOnly,
          limit,
        });
        return result.mentions || [];
      } catch (err) {
        console.error("[useCollaboration] getMentions error:", err);
        return [];
      }
    },
    [invoke]
  );

  const markMentionRead = useCallback(
    async (mentionId?: string, markAll?: boolean): Promise<boolean> => {
      try {
        await invoke("mark_mention_read", {
          mention_id: mentionId,
          mark_all: markAll,
        });
        return true;
      } catch (err) {
        console.error("[useCollaboration] markMentionRead error:", err);
        return false;
      }
    },
    [invoke]
  );

  // ─── Activity Feed ──────────────────────────────────────────

  const getActivityFeed = useCallback(
    async (
      spaceId: string,
      options?: { limit?: number; offset?: number; entityType?: string }
    ): Promise<ActivityEvent[]> => {
      try {
        const result = await invoke("get_activity_feed", {
          space_id: spaceId,
          limit: options?.limit || 30,
          offset: options?.offset || 0,
          entity_type: options?.entityType,
        });
        return result.activities || [];
      } catch (err) {
        console.error("[useCollaboration] getActivityFeed error:", err);
        return [];
      }
    },
    [invoke]
  );

  return {
    // Threads
    addThread,
    listThreads,
    updateThread,
    deleteThread,
    // Reactions
    toggleReaction,
    getReactions,
    // Mentions
    getMentions,
    markMentionRead,
    // Activity
    getActivityFeed,
  };
};

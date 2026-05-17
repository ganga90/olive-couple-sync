import React, { createContext, useContext, useMemo, useCallback, useRef } from "react";
import { useSupabaseCouple } from "./SupabaseCoupleProvider";
import { useSpace } from "./SpaceProvider";
import { useSupabaseNotes, SupabaseNote } from "@/hooks/useSupabaseNotes";
import { useAuth } from "./AuthProvider";
import { useDefaultPrivacy } from "@/hooks/useDefaultPrivacy";
import { supabase } from "@/lib/supabaseClient";
import type { Note } from "@/types/note";
import type { SpaceMember } from "@/types/space";

type SupabaseNotesContextValue = {
  notes: Note[];
  loading: boolean;
  addNote: (noteData: Omit<Note, "id" | "createdAt" | "updatedAt" | "addedBy">) => Promise<Note | null>;
  updateNote: (id: string, updates: Partial<Note>) => Promise<Note | null>;
  deleteNote: (id: string) => Promise<boolean>;
  getNotesByCategory: (category: string) => Note[];
  refetch: () => Promise<void>;
};

const SupabaseNotesContext = createContext<SupabaseNotesContextValue | undefined>(undefined);

// Well-known AI category → display name mappings
const KNOWN_CATEGORY_MAP: Record<string, string> = {
  'groceries': 'Groceries', 'task': 'Task', 'home_improvement': 'Home Improvement',
  'travel_idea': 'Travel Idea', 'travel': 'Travel', 'date_idea': 'Date Idea',
  'date_ideas': 'Date Ideas', 'shopping': 'Shopping', 'health': 'Health',
  'finance': 'Finance', 'work': 'Work', 'personal': 'Personal',
  'gift_ideas': 'Gift Ideas', 'recipes': 'Recipes', 'movies_tv': 'Movies & TV',
  'movies_to_watch': 'Movies to Watch', 'books_to_read': 'Books to Read',
  'books': 'Books', 'restaurants': 'Restaurants', 'entertainment': 'Entertainment',
  'general': 'Task', 'stocks': 'Investments',
};

const mapAICategory = (aiCategory: string): string => {
  if (!aiCategory) return 'Task';
  const lower = aiCategory.toLowerCase().trim();
  if (KNOWN_CATEGORY_MAP[lower]) return KNOWN_CATEGORY_MAP[lower];
  return lower.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

// Build a member lookup map for O(1) resolution
const buildMemberMap = (members: SpaceMember[]): Map<string, string> => {
  const map = new Map<string, string>();
  members.forEach(m => map.set(m.user_id, m.display_name));
  return map;
};

const convertSupabaseNoteToNote = (
  supabaseNote: SupabaseNote,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TASK-10X-1C-FOLLOWUP: replace any with proper types
  currentUser: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TASK-10X-1C-FOLLOWUP: replace any with proper types
  currentCouple: any,
  memberMap: Map<string, string>
): Note => {
  const getAuthorName = (authorId: string): string => {
    if (!authorId) return "Unknown";
    if (authorId === currentUser?.id) {
      return memberMap.get(authorId) || currentUser?.firstName || currentUser?.fullName || "You";
    }
    // Look up from members
    const name = memberMap.get(authorId);
    if (name) return name;
    // Legacy fallback
    if (currentCouple?.resolvedPartnerName) return currentCouple.resolvedPartnerName;
    return "Unknown";
  };

  // ─── Canonical task_owner resolution ─────────────────────────────
  // Post-migration (20260513032720_canonicalize_task_owner) the DB
  // column always stores NULL or a user_id (clerk_profiles.id, format
  // `user_xxx`). We're defensive against legacy strings that might
  // slip through (e.g. a stale write from an old client before this
  // PR rolls out), but we DO NOT pass display-name strings through as
  // task_owner anymore — that's a separate field, `task_owner_name`.
  //
  // Returns the canonical user_id (or null) for `task_owner`, plus
  // the resolved display name for rendering.
  const resolveTaskOwner = (
    raw: string | null
  ): { id: string | null; name: string | undefined } => {
    if (!raw) return { id: null, name: undefined };

    // Canonical: user_id (clerk format `user_xxx`).
    if (raw.startsWith('user_')) {
      const name = memberMap.get(raw)
        ?? (raw === currentUser?.id ? (currentUser?.firstName || currentUser?.fullName) : undefined);
      return { id: raw, name };
    }

    // Defensive: legacy tokens ('you' / 'partner' / 'shared') that
    // somehow survived migration. Map them best-effort; they should
    // NOT exist post-migration so we log once to surface drift.
    if (raw === 'shared') return { id: null, name: undefined };
    if (raw === 'you' && supabaseNote.author_id) {
      const name = memberMap.get(supabaseNote.author_id)
        ?? (supabaseNote.author_id === currentUser?.id ? (currentUser?.firstName || currentUser?.fullName) : undefined);
      return { id: supabaseNote.author_id, name };
    }
    if (raw === 'partner') {
      // Best-effort: pick any non-author member as the partner.
      const partnerId = Array.from(memberMap.keys()).find(id => id !== supabaseNote.author_id);
      return partnerId
        ? { id: partnerId, name: memberMap.get(partnerId) }
        : { id: null, name: undefined };
    }

    // Defensive: legacy display-name string. Try to reverse-lookup
    // via memberMap (O(n)); if found, return the user_id. Otherwise
    // treat as unassigned — the display will fall back to author.
    for (const [userId, displayName] of memberMap.entries()) {
      if (displayName === raw) return { id: userId, name: displayName };
    }
    // Unresolvable. Don't render the raw string as a name (it could
    // be 'partner' or other tokens). Treat as unassigned.
    return { id: null, name: undefined };
  };

  const taskOwnerResolved = resolveTaskOwner(supabaseNote.task_owner ?? null);

  return {
    id: supabaseNote.id,
    originalText: supabaseNote.original_text,
    summary: supabaseNote.summary,
    category: mapAICategory(supabaseNote.category),
    dueDate: supabaseNote.due_date,
    reminder_time: supabaseNote.reminder_time,
    recurrence_frequency: supabaseNote.recurrence_frequency || undefined,
    recurrence_interval: supabaseNote.recurrence_interval || undefined,
    last_reminded_at: supabaseNote.last_reminded_at || undefined,
    addedBy: getAuthorName(supabaseNote.author_id || ""),
    authorId: supabaseNote.author_id,
    createdAt: supabaseNote.created_at,
    updatedAt: supabaseNote.updated_at,
    completed: supabaseNote.completed,
    priority: supabaseNote.priority || undefined,
    tags: supabaseNote.tags || undefined,
    items: supabaseNote.items || undefined,
    // Canonical user_id (or null). Use this for filtering, writes, equality.
    task_owner: taskOwnerResolved.id,
    // Resolved display name. Use this for UI chips/labels.
    task_owner_name: taskOwnerResolved.name,
    list_id: supabaseNote.list_id || undefined,
    media_urls: supabaseNote.media_urls || undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TASK-10X-1C-FOLLOWUP: replace any with proper types
    location: supabaseNote.location as any || undefined,
    // A note is "shared" if it belongs to any space (couple-type, via
    // couple_id, or non-couple type, via space_id only).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TASK-10X-1C-FOLLOWUP: replace any with proper types
    isShared: supabaseNote.couple_id !== null || (supabaseNote as any).space_id != null,
    coupleId: supabaseNote.couple_id || undefined,
    is_sensitive: supabaseNote.is_sensitive || false,
  };
};

const convertNoteToSupabaseInsert = (note: Omit<Note, "id" | "createdAt" | "updatedAt" | "addedBy">) => ({
  original_text: note.originalText,
  summary: note.summary,
  category: note.category.toLowerCase().replace(/\s+/g, '_'),
  due_date: note.dueDate,
  completed: note.completed,
  priority: note.priority || null,
  tags: note.tags || null,
  items: note.items || null,
  task_owner: note.task_owner || null,
  list_id: note.list_id || null,
  media_urls: note.media_urls || null,
});

export const SupabaseNotesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentCouple, members } = useSupabaseCouple();
  const { currentSpace } = useSpace();
  const { user } = useAuth();
  const { defaultPrivacy } = useDefaultPrivacy();

  // Phase 1A: pass BOTH couple_id (legacy) and space_id (canonical) to
  // the hook. The hook prefers space_id. For couple-type spaces the two
  // are equal (1:1 bridge). For non-couple spaces (family / business /
  // custom) only space_id is populated, so passing currentSpace.id is
  // what unlocks the data plane for those space types.
  const noteCountRef = useRef(0);
  const {
    notes: supabaseNotes, loading,
    addNote: addSupabaseNote, updateNote: updateSupabaseNote,
    deleteNote: deleteSupabaseNote, getNotesByCategory: getSupabaseNotesByCategory,
    refetch
  } = useSupabaseNotes(currentCouple?.id || null, currentSpace?.id || null);

  const memberMap = useMemo(() => buildMemberMap(members), [members]);

  const notes = useMemo(
    () => supabaseNotes.map(note => convertSupabaseNoteToNote(note, user, currentCouple, memberMap)),
    [supabaseNotes, user, currentCouple, memberMap]
  );

  const addNote = useCallback(async (noteData: Omit<Note, "id" | "createdAt" | "updatedAt" | "addedBy">) => {
    // Phase 1A: resolve the note's scope to a space_id (or null = private).
    //
    // Order of precedence:
    //  1. If the note has a list_id, inherit from the list's space_id
    //     (shared list → shared note; private list → private note).
    //  2. Caller-supplied isShared boolean (true → current space, false → private).
    //  3. Caller-supplied coupleId/space_id on noteData.
    //  4. User's defaultPrivacy setting.
    //
    // We prefer space_id over couple_id because non-couple spaces don't
    // have a couple row. For couple-type spaces they're equivalent (DB
    // trigger mirrors them); passing space_id works for both cases.
    let resolvedSpaceId: string | null;

    const sharedSpaceId = currentSpace?.id || currentCouple?.id || null;

    if (noteData.list_id) {
      try {
        const listResult = await supabase
          .from("clerk_lists")
          .select("couple_id, space_id")
          .eq("id", noteData.list_id)
          .single();

        if (listResult.data) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TASK-10X-1C-FOLLOWUP: replace any with proper types
          resolvedSpaceId = (listResult.data as any).space_id ?? listResult.data.couple_id ?? null;
        } else {
          resolvedSpaceId = defaultPrivacy === "private" ? null : sharedSpaceId;
        }
      } catch {
        resolvedSpaceId = defaultPrivacy === "private" ? null : sharedSpaceId;
      }
    } else if (noteData.isShared === true) {
      resolvedSpaceId = sharedSpaceId;
    } else if (noteData.isShared === false) {
      resolvedSpaceId = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TASK-10X-1C-FOLLOWUP: replace any with proper types
    } else if ((noteData as any).spaceId !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TASK-10X-1C-FOLLOWUP: replace any with proper types
      resolvedSpaceId = (noteData as any).spaceId || null;
    } else if (noteData.coupleId !== undefined) {
      resolvedSpaceId = noteData.coupleId || null;
    } else {
      resolvedSpaceId = defaultPrivacy === "private" ? null : sharedSpaceId;
    }

    const supabaseNoteData = {
      ...convertNoteToSupabaseInsert(noteData),
      // Only set space_id — the DB trigger mirrors to couple_id for
      // couple-type spaces, and leaves it NULL for non-couple spaces.
      space_id: resolvedSpaceId,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TASK-10X-1C-FOLLOWUP: replace any with proper types
    const result = await addSupabaseNote(supabaseNoteData as any);
    if (result && user?.id) {
      // Auto-trigger insight analysis every 10 notes (fire-and-forget)
      noteCountRef.current += 1;
      if (noteCountRef.current % 10 === 0) {
        supabase.functions.invoke('analyze-notes', {
          body: { user_id: user.id }
        }).catch(err => console.warn('[auto-analyze] Background analysis failed:', err));
      }
    }
    return result ? convertSupabaseNoteToNote(result, user, currentCouple, memberMap) : null;
  }, [defaultPrivacy, currentCouple, currentSpace, addSupabaseNote, user, memberMap]);

  const updateNote = useCallback(async (id: string, updates: Partial<Note>) => {
    // The hook's updateNote handles field mapping internally,
    // so we pass the updates directly.
    const result = await updateSupabaseNote(id, updates);
    return result ? convertSupabaseNoteToNote(result, user, currentCouple, memberMap) : null;
  }, [updateSupabaseNote, user, currentCouple, memberMap]);

  const deleteNote = useCallback(async (id: string) => await deleteSupabaseNote(id), [deleteSupabaseNote]);

  const getNotesByCategory = useCallback((category: string) => {
    return getSupabaseNotesByCategory(category.toLowerCase().replace(/\s+/g, '_'))
      .map(note => convertSupabaseNoteToNote(note, user, currentCouple, memberMap));
  }, [getSupabaseNotesByCategory, user, currentCouple, memberMap]);

  const value = useMemo(() => ({
    notes, loading, addNote, updateNote, deleteNote, getNotesByCategory, refetch,
  }), [notes, loading, addNote, updateNote, deleteNote, getNotesByCategory, refetch]);

  return (
    <SupabaseNotesContext.Provider value={value}>
      {children}
    </SupabaseNotesContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components -- TASK-10X-1C-FOLLOWUP: move hook to its own file
export const useSupabaseNotesContext = () => {
  const ctx = useContext(SupabaseNotesContext);
  if (!ctx) throw new Error("useSupabaseNotesContext must be used within SupabaseNotesProvider");
  return ctx;
};

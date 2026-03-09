import React, { createContext, useContext, useMemo, useCallback } from "react";
import { useSupabaseCouple } from "./SupabaseCoupleProvider";
import { useSupabaseNotes, SupabaseNote } from "@/hooks/useSupabaseNotes";
import { useAuth } from "./AuthProvider";
import { useDefaultPrivacy } from "@/hooks/useDefaultPrivacy";
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
  currentUser: any,
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

  const getTaskOwnerName = (taskOwner: string | null): string | undefined => {
    if (!taskOwner) {
      if (!supabaseNote.couple_id && supabaseNote.author_id) {
        if (supabaseNote.author_id === currentUser?.id) {
          return memberMap.get(supabaseNote.author_id) || currentUser?.firstName || "You";
        }
      }
      return undefined;
    }
    if (taskOwner.startsWith('user_')) {
      const name = memberMap.get(taskOwner);
      if (name) return name;
      if (taskOwner === currentUser?.id) return currentUser?.firstName || "You";
      return "Unknown";
    }
    return taskOwner;
  };

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
    task_owner: getTaskOwnerName(supabaseNote.task_owner),
    list_id: supabaseNote.list_id || undefined,
    media_urls: supabaseNote.media_urls || undefined,
    location: supabaseNote.location as any || undefined,
    isShared: supabaseNote.couple_id !== null,
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
  const { user } = useAuth();
  const { defaultPrivacy } = useDefaultPrivacy();

  const {
    notes: supabaseNotes, loading,
    addNote: addSupabaseNote, updateNote: updateSupabaseNote,
    deleteNote: deleteSupabaseNote, getNotesByCategory: getSupabaseNotesByCategory,
    refetch
  } = useSupabaseNotes(currentCouple?.id || null);

  const memberMap = useMemo(() => buildMemberMap(members), [members]);

  const notes = useMemo(
    () => supabaseNotes.map(note => convertSupabaseNoteToNote(note, user, currentCouple, memberMap)),
    [supabaseNotes, user, currentCouple, memberMap]
  );

  const addNote = useCallback(async (noteData: Omit<Note, "id" | "createdAt" | "updatedAt" | "addedBy">) => {
    let resolvedCoupleId: string | null;
    if (noteData.isShared === true) {
      resolvedCoupleId = currentCouple?.id || null;
    } else if (noteData.isShared === false) {
      resolvedCoupleId = null;
    } else if (noteData.coupleId !== undefined) {
      resolvedCoupleId = noteData.coupleId || null;
    } else {
      resolvedCoupleId = defaultPrivacy === "private" ? null : (currentCouple?.id || null);
    }

    const supabaseNoteData = {
      ...convertNoteToSupabaseInsert(noteData),
      couple_id: resolvedCoupleId,
    };
    const result = await addSupabaseNote(supabaseNoteData);
    return result ? convertSupabaseNoteToNote(result, user, currentCouple, memberMap) : null;
  }, [defaultPrivacy, currentCouple, addSupabaseNote, user, memberMap]);

  const updateNote = useCallback(async (id: string, updates: Partial<Note>) => {
    const supabaseUpdates: any = {};
    if (updates.originalText !== undefined) supabaseUpdates.original_text = updates.originalText;
    if (updates.summary !== undefined) supabaseUpdates.summary = updates.summary;
    if (updates.category !== undefined) supabaseUpdates.category = updates.category.toLowerCase().replace(/\s+/g, '_');
    if (updates.dueDate !== undefined) supabaseUpdates.due_date = updates.dueDate;
    if (updates.completed !== undefined) supabaseUpdates.completed = updates.completed;
    if (updates.priority !== undefined) supabaseUpdates.priority = updates.priority;
    if (updates.tags !== undefined) supabaseUpdates.tags = updates.tags;
    if (updates.items !== undefined) supabaseUpdates.items = updates.items;
    if (updates.task_owner !== undefined) supabaseUpdates.task_owner = updates.task_owner;
    if (updates.list_id !== undefined) supabaseUpdates.list_id = updates.list_id;
    if (updates.reminder_time !== undefined) supabaseUpdates.reminder_time = updates.reminder_time;
    if (updates.recurrence_frequency !== undefined) supabaseUpdates.recurrence_frequency = updates.recurrence_frequency;
    if (updates.recurrence_interval !== undefined) supabaseUpdates.recurrence_interval = updates.recurrence_interval;
    if (updates.last_reminded_at !== undefined) supabaseUpdates.last_reminded_at = updates.last_reminded_at;

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

export const useSupabaseNotesContext = () => {
  const ctx = useContext(SupabaseNotesContext);
  if (!ctx) throw new Error("useSupabaseNotesContext must be used within SupabaseNotesProvider");
  return ctx;
};

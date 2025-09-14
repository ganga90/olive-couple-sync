import React, { createContext, useContext, useMemo } from "react";
import { useSupabaseCouple } from "./SupabaseCoupleProvider";
import { useSupabaseNotes, SupabaseNote } from "@/hooks/useSupabaseNotes";
import { useAuth } from "./AuthProvider";
import type { Note } from "@/types/note";
import { categories } from "@/constants/categories";

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

// Map AI categories (lowercase with underscores) to display categories
const mapAICategory = (aiCategory: string): string => {
  const categoryMap: Record<string, string> = {
    'groceries': 'Groceries',
    'task': 'Task',
    'home_improvement': 'Home Improvement',
    'travel_idea': 'Travel Idea',
    'date_idea': 'Date Idea',
    'shopping': 'Shopping',
    'health': 'Health',
    'finance': 'Finance',
    'work': 'Work',
    'personal': 'Personal',
    'gift_ideas': 'Gift Ideas',
    'recipes': 'Recipes',
    'movies_to_watch': 'Movies to Watch',
    'books_to_read': 'Books to Read',
    'restaurants': 'Restaurants',
    'general': 'Task',
  };
  
  return categoryMap[aiCategory.toLowerCase()] || categories.find(cat => 
    cat.toLowerCase().replace(/\s+/g, '_') === aiCategory.toLowerCase()
  ) || 'Task';
};

// Convert Supabase note to app Note type
const convertSupabaseNoteToNote = (supabaseNote: SupabaseNote, currentUser?: any, currentCouple?: any): Note => ({
  id: supabaseNote.id,
  originalText: supabaseNote.original_text,
  summary: supabaseNote.summary,
  category: mapAICategory(supabaseNote.category),
  dueDate: supabaseNote.due_date,
  addedBy: supabaseNote.author_id === currentUser?.id ? 
    (currentUser?.firstName || currentUser?.fullName || "You") : 
    supabaseNote.author_id || "Unknown",
  createdAt: supabaseNote.created_at,
  updatedAt: supabaseNote.updated_at,
  completed: supabaseNote.completed,
  priority: supabaseNote.priority || undefined,
  tags: supabaseNote.tags || undefined,
  items: supabaseNote.items || undefined,
  task_owner: supabaseNote.task_owner && supabaseNote.task_owner.startsWith('user_') ? 
    (supabaseNote.task_owner === currentUser?.id ? 
      (currentCouple?.you_name || currentUser?.firstName || currentUser?.fullName || "You") : 
      (currentCouple?.partner_name || "Partner")) : 
    supabaseNote.task_owner || undefined,
  list_id: supabaseNote.list_id || undefined,
  // Add metadata to distinguish note types
  isShared: supabaseNote.couple_id !== null,
  coupleId: supabaseNote.couple_id || undefined,
});

// Convert app Note to Supabase note insert type
const convertNoteToSupabaseInsert = (note: Omit<Note, "id" | "createdAt" | "updatedAt" | "addedBy">) => ({
  original_text: note.originalText,
  summary: note.summary,
  category: note.category.toLowerCase().replace(/\s+/g, '_'), // Convert back to AI format
  due_date: note.dueDate,
  completed: note.completed,
  priority: note.priority || null,
  tags: note.tags || null,
  items: note.items || null,
  task_owner: note.task_owner || null,
  list_id: note.list_id || null,
});

export const SupabaseNotesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentCouple } = useSupabaseCouple();
  const { user } = useAuth();
  
  console.log('[SupabaseNotesProvider] Rendering with currentCouple:', !!currentCouple, currentCouple?.id);
  
  const { 
    notes: supabaseNotes, 
    loading, 
    addNote: addSupabaseNote, 
    updateNote: updateSupabaseNote, 
    deleteNote: deleteSupabaseNote,
    getNotesByCategory: getSupabaseNotesByCategory,
    refetch 
  } = useSupabaseNotes(currentCouple?.id || null); // Pass null for personal notes when no couple

  const notes = useMemo(() => {
    const convertedNotes = supabaseNotes.map(note => convertSupabaseNoteToNote(note, user, currentCouple));
    console.log('[SupabaseNotesProvider] Converting notes:', supabaseNotes.length, 'supabase notes to', convertedNotes.length, 'app notes');
    return convertedNotes;
  }, 
    [supabaseNotes, user, currentCouple]
  );

  const addNote = async (noteData: Omit<Note, "id" | "createdAt" | "updatedAt" | "addedBy">) => {
    const supabaseNoteData = {
      ...convertNoteToSupabaseInsert(noteData),
      couple_id: currentCouple?.id || null, // Allow null for personal notes
    };
    const result = await addSupabaseNote(supabaseNoteData);
    return result ? convertSupabaseNoteToNote(result, user, currentCouple) : null;
  };

  const updateNote = async (id: string, updates: Partial<Note>) => {
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
    
    // Handle privacy changes - map coupleId to couple_id in database
    if (updates.coupleId !== undefined) supabaseUpdates.couple_id = updates.coupleId;

    const result = await updateSupabaseNote(id, supabaseUpdates);
    return result ? convertSupabaseNoteToNote(result, user, currentCouple) : null;
  };

  const deleteNote = async (id: string) => {
    return await deleteSupabaseNote(id);
  };

  const getNotesByCategory = (category: string) => {
    const categoryNotes = getSupabaseNotesByCategory(category.toLowerCase().replace(/\s+/g, '_'));
    return categoryNotes.map(note => convertSupabaseNoteToNote(note, user, currentCouple));
  };

  const value = useMemo(() => ({
    notes,
    loading,
    addNote,
    updateNote,
    deleteNote,
    getNotesByCategory,
    refetch,
  }), [notes, loading, refetch]);

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
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { Note } from "@/types/note";

const NOTES_KEY = "olive:notes";

type NotesContextValue = {
  notes: Note[];
  isLoading: boolean;
  addNote: (note: Note) => void;
  updateNote: (id: string, updates: Partial<Note>) => void;
  deleteNote: (id: string) => void;
  getNotesByCategory: (category: string) => Note[];
};

const NotesContext = createContext<NotesContextValue | undefined>(undefined);

export const NotesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const data = localStorage.getItem(NOTES_KEY);
      if (data) setNotes(JSON.parse(data));
    } catch (e) {
      console.error("Error loading notes", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const persist = useCallback((updated: Note[]) => {
    setNotes(updated);
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error("Error saving notes", e);
    }
  }, []);

  const addNote = useCallback((note: Note) => {
    persist([note, ...notes]);
  }, [notes, persist]);

  const updateNote = useCallback((id: string, updates: Partial<Note>) => {
    const updated = notes.map(n => n.id === id ? { ...n, ...updates, updatedAt: new Date().toISOString() } : n);
    persist(updated);
  }, [notes, persist]);

  const deleteNote = useCallback((id: string) => {
    persist(notes.filter(n => n.id !== id));
  }, [notes, persist]);

  const getNotesByCategory = useCallback((category: string) => notes.filter(n => n.category.toLowerCase() === category.toLowerCase()), [notes]);

  const value = useMemo(() => ({ notes, isLoading, addNote, updateNote, deleteNote, getNotesByCategory }), [notes, isLoading, addNote, updateNote, deleteNote, getNotesByCategory]);

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
};

export const useNotes = () => {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error("useNotes must be used within NotesProvider");
  return ctx;
};

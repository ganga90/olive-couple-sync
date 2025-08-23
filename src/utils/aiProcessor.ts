import { categories } from "@/constants/categories";
import { Note, ProcessedNote } from "@/types/note";

const parseDueDate = (text: string): string | null => {
  const lower = text.toLowerCase();
  const now = new Date();
  if (lower.includes("tomorrow")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  if (lower.includes("today")) return now.toISOString();
  return null;
};

const inferCategory = (text: string): string => {
  const t = text.toLowerCase();
  if (/buy|grocery|grocer|supermarket|milk|eggs|bread/.test(t)) return "Groceries";
  if (/trip|travel|flight|hotel|itinerary/.test(t)) return "Travel Idea";
  if (/date/.test(t)) return "Date Idea";
  if (/paint|fix|repair|renovat|home/.test(t)) return "Home Improvement";
  return "Task";
};

export async function processNoteWithAI(text: string, addedBy: string): Promise<Note> {
  // Placeholder mirroring your prototype’s shape. Replace with Supabase Edge call later.
  const processed: ProcessedNote = {
    summary: text.length > 120 ? text.slice(0, 117) + "..." : text,
    category: inferCategory(text),
    dueDate: parseDueDate(text),
    taskOwner: addedBy, // Default to the person who added it
    tags: [],
    priority: "low",
    items: /,| and /i.test(text) ? text.split(/,| and /i).map(s => s.trim()).filter(Boolean) : undefined,
  };

  const now = new Date().toISOString();
  const note: Note = {
    id: crypto.randomUUID(),
    originalText: text,
    summary: processed.summary,
    category: processed.category,
    dueDate: processed.dueDate ?? null,
    addedBy,
    taskOwner: processed.taskOwner,
    createdAt: now,
    updatedAt: now,
    completed: false,
    priority: processed.priority,
    tags: processed.tags,
    items: processed.items,
  };
  return note;
}

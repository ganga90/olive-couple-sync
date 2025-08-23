export interface Note {
  id: string;
  originalText: string;
  summary: string;
  category: string;
  dueDate?: string | null;
  addedBy: string;
  taskOwner?: string;
  createdAt: string;
  updatedAt: string;
  completed: boolean;
  priority?: "low" | "medium" | "high";
  tags?: string[];
  items?: string[];
  listId?: string | null;
}

export interface ProcessedNote {
  summary: string;
  category: string;
  dueDate?: string | null;
  taskOwner?: string;
  tags?: string[];
  priority?: "low" | "medium" | "high";
  items?: string[];
}

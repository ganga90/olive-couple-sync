export interface Note {
  id: string;
  originalText: string;
  summary: string;
  category: string;
  dueDate?: string | null;
  addedBy: string;
  createdAt: string;
  updatedAt: string;
  completed: boolean;
  priority?: "low" | "medium" | "high";
  tags?: string[];
  items?: string[];
}

export interface ProcessedNote {
  summary: string;
  category: string;
  dueDate?: string | null;
  tags?: string[];
  priority?: "low" | "medium" | "high";
  items?: string[];
}

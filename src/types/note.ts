export interface OliveTip {
  status: 'generated' | 'error';
  type: 'book' | 'place' | 'action' | 'general';
  generated_at: string;
  title: string;
  summary: string;
  actions: Array<{
    label: string;
    url: string;
    type: 'primary' | 'secondary';
    icon?: string;
  }>;
  metadata?: {
    image?: string;
    rating?: number;
    phone?: string;
    address?: string;
    price?: string;
    author?: string;
    source?: string;
  };
}

export interface Note {
  id: string;
  originalText: string;
  summary: string;
  category: string;
  dueDate?: string | null;
  addedBy: string; // Display name
  authorId?: string; // Raw author_id for filtering
  createdAt: string;
  updatedAt: string;
  completed: boolean;
  priority?: "low" | "medium" | "high";
  tags?: string[];
  items?: string[];
  /**
   * Canonical owner reference — either NULL (unassigned/shared) or a
   * `clerk_profiles.id` (e.g. `user_abc123`). Never a display name,
   * never a token like 'you' / 'partner' / 'shared'. After migration
   * 20260513032720_canonicalize_task_owner, all DB rows conform.
   * New writes (NoteDetails, QuickEditBottomSheet, process-note) MUST
   * write a user_id or null.
   *
   * For UI display, use `task_owner_name` (resolved by the provider).
   */
  task_owner?: string | null;
  /**
   * Resolved display name for `task_owner`, computed by the provider
   * via member lookup. Use this for rendering chips/labels, never for
   * writes. `undefined` if unassigned or unresolvable.
   */
  task_owner_name?: string;
  list_id?: string | null;
  reminder_time?: string | null;
  recurrence_frequency?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  recurrence_interval?: number;
  last_reminded_at?: string | null;
  media_urls?: string[] | null;
  location?: { latitude: string; longitude: string } | null;
  olive_tips?: OliveTip | null;
  // New fields to distinguish note types
  isShared?: boolean;
  coupleId?: string;
  // Encryption
  is_sensitive?: boolean;
}

export interface ProcessedNote {
  summary: string;
  category: string;
  dueDate?: string | null;
  tags?: string[];
  priority?: "low" | "medium" | "high";
  items?: string[];
}

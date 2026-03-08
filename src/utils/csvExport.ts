import { Note } from "@/types/note";

interface Memory {
  id: string;
  title: string;
  content: string;
  category: string | null;
  importance: number | null;
  created_at: string | null;
  updated_at: string | null;
}

interface ListInfo {
  id: string;
  name: string;
}

interface ExpenseRow {
  id: string;
  name: string;
  amount: number;
  currency: string;
  category: string;
  split_type: string;
  expense_date: string;
  is_settled: boolean;
  is_shared: boolean;
  is_recurring: boolean;
  recurrence_frequency?: string | null;
  receipt_url?: string | null;
  original_text?: string | null;
  created_at: string;
}

// Escape CSV field values properly
function escapeCSVField(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  // If contains comma, newline, or quote, wrap in quotes and escape quotes
  if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

// Convert notes array to CSV string
export function notesToCSV(notes: Note[], lists: ListInfo[]): string {
  const headers = [
    'ID',
    'Summary',
    'Original Text',
    'Category',
    'List Name',
    'Priority',
    'Due Date',
    'Reminder Time',
    'Completed',
    'Added By',
    'Tags',
    'Items',
    'Created At',
    'Updated At',
    'Recurrence',
    'Is Shared'
  ];

  // Create a map of list IDs to names for quick lookup
  const listMap = new Map(lists.map(l => [l.id, l.name]));

  const rows = notes.map(note => {
    const listName = note.list_id ? listMap.get(note.list_id) || '' : '';
    const recurrence = note.recurrence_frequency && note.recurrence_frequency !== 'none' 
      ? `${note.recurrence_frequency} (every ${note.recurrence_interval || 1})` 
      : '';

    return [
      escapeCSVField(note.id),
      escapeCSVField(note.summary),
      escapeCSVField(note.originalText),
      escapeCSVField(note.category),
      escapeCSVField(listName),
      escapeCSVField(note.priority || ''),
      escapeCSVField(note.dueDate || ''),
      escapeCSVField(note.reminder_time || ''),
      note.completed ? 'Yes' : 'No',
      escapeCSVField(note.addedBy),
      escapeCSVField(note.tags?.join('; ') || ''),
      escapeCSVField(note.items?.join('; ') || ''),
      escapeCSVField(note.createdAt),
      escapeCSVField(note.updatedAt),
      escapeCSVField(recurrence),
      note.isShared ? 'Yes' : 'No'
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

// Convert memories array to CSV string
export function memoriesToCSV(memories: Memory[]): string {
  const headers = [
    'ID',
    'Title',
    'Content',
    'Category',
    'Importance',
    'Created At',
    'Updated At'
  ];

  const rows = memories.map(memory => [
    escapeCSVField(memory.id),
    escapeCSVField(memory.title),
    escapeCSVField(memory.content),
    escapeCSVField(memory.category || ''),
    memory.importance?.toString() || '',
    escapeCSVField(memory.created_at || ''),
    escapeCSVField(memory.updated_at || '')
  ].join(','));

  return [headers.join(','), ...rows].join('\n');
}

// Download CSV file
export function downloadCSV(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}

// Convert expenses array to CSV string
export function expensesToCSV(expenses: ExpenseRow[]): string {
  const headers = [
    'ID', 'Name', 'Amount', 'Currency', 'Category', 'Split Type',
    'Date', 'Settled', 'Shared', 'Recurring', 'Recurrence',
    'Receipt', 'Original Note', 'Created At'
  ];

  const rows = expenses.map(e => [
    escapeCSVField(e.id),
    escapeCSVField(e.name),
    e.amount.toFixed(2),
    escapeCSVField(e.currency),
    escapeCSVField(e.category),
    escapeCSVField(e.split_type),
    escapeCSVField(e.expense_date),
    e.is_settled ? 'Yes' : 'No',
    e.is_shared ? 'Yes' : 'No',
    e.is_recurring ? 'Yes' : 'No',
    escapeCSVField(e.recurrence_frequency || ''),
    escapeCSVField(e.receipt_url || ''),
    escapeCSVField(e.original_text || ''),
    escapeCSVField(e.created_at),
  ].join(','));

  return [headers.join(','), ...rows].join('\n');
}

// Generate filename with timestamp
export function generateExportFilename(type: 'notes' | 'memories' | 'expenses'): string {
  const date = new Date().toISOString().split('T')[0];
  return `olive-${type}-export-${date}.csv`;
}

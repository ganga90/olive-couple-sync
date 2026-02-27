import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ListTodo, Loader2, Check, ExternalLink } from 'lucide-react';
import { useGoogleTasks } from '@/hooks/useGoogleTasks';
import { toast } from 'sonner';
import type { Note } from '@/types/note';

interface AddToGoogleTasksDialogProps {
  note: Note;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddToGoogleTasksDialog({ note, open, onOpenChange }: AddToGoogleTasksDialogProps) {
  const { t } = useTranslation('notes');
  const { taskLists, loading: listsLoading, fetchTaskLists, createTask } = useGoogleTasks();
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState(false);

  // Form state
  const [title, setTitle] = useState(note.summary);
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [selectedList, setSelectedList] = useState('@default');

  useEffect(() => {
    if (open) {
      setTitle(note.summary);
      setCreated(false);
      
      // Build notes from items
      const itemsText = note.items?.join('\n') || '';
      setNotes(itemsText || note.originalText || '');

      if (note.dueDate) {
        setDueDate(note.dueDate.split('T')[0]);
      } else {
        setDueDate('');
      }

      setSelectedList('@default');
      fetchTaskLists();
    }
  }, [open, note]);

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }

    setAdding(true);
    try {
      await createTask({
        tasklist_id: selectedList,
        task_title: title,
        task_notes: notes || undefined,
        task_due: dueDate ? `${dueDate}T00:00:00.000Z` : undefined,
      });

      setCreated(true);
      toast.success('Task added to Google Tasks!');
    } catch (error: any) {
      toast.error(error.message || 'Failed to create task');
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListTodo className="h-5 w-5 text-blue-600" />
            Add to Google Tasks
          </DialogTitle>
        </DialogHeader>

        {created ? (
          <div className="text-center py-6 space-y-4">
            <div className="w-12 h-12 rounded-full bg-[hsl(var(--success))]/10 flex items-center justify-center mx-auto">
              <Check className="h-6 w-6 text-[hsl(var(--success))]" />
            </div>
            <p className="font-medium">Task created in Google Tasks!</p>
            <Button variant="outline" asChild>
              <a href="https://tasks.google.com" target="_blank" rel="noopener noreferrer">
                Open Google Tasks <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Task List</Label>
              {listsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading lists...
                </div>
              ) : (
                <Select value={selectedList} onValueChange={setSelectedList}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a task list" />
                  </SelectTrigger>
                  <SelectContent>
                    {taskLists.map((list) => (
                      <SelectItem key={list.id} value={list.id}>
                        {list.title}
                      </SelectItem>
                    ))}
                    {taskLists.length === 0 && (
                      <SelectItem value="@default">My Tasks</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label>Due Date (optional)</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Additional details..." />
            </div>
          </div>
        )}

        {!created && (
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={adding}>
              {adding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ListTodo className="h-4 w-4 mr-2" />}
              Create Task
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

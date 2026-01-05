import React, { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import type { Note } from '@/types/note';
import { cn } from '@/lib/utils';
import { useLocalizedNavigate } from '@/hooks/useLocalizedNavigate';

interface QuickEditBottomSheetProps {
  note: Note | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (noteId: string, updates: Partial<Note>) => Promise<void>;
  partnerName?: string;
  yourName?: string;
}

export const QuickEditBottomSheet: React.FC<QuickEditBottomSheetProps> = ({
  note,
  isOpen,
  onClose,
  onSave,
  partnerName,
  yourName
}) => {
  const navigate = useLocalizedNavigate();
  const [title, setTitle] = useState(note?.summary || '');
  const [dueDate, setDueDate] = useState<Date | undefined>(
    note?.dueDate ? new Date(note.dueDate) : undefined
  );
  const [owner, setOwner] = useState(note?.task_owner || 'shared');
  const [isSaving, setIsSaving] = useState(false);

  React.useEffect(() => {
    if (note) {
      setTitle(note.summary);
      setDueDate(note.dueDate ? new Date(note.dueDate) : undefined);
      setOwner(note.task_owner || 'shared');
    }
  }, [note]);

  const handleSave = async () => {
    if (!note) return;
    
    setIsSaving(true);
    try {
      await onSave(note.id, {
        summary: title,
        dueDate: dueDate?.toISOString() || null,
        task_owner: owner
      });
      onClose();
    } catch (error) {
      console.error('Failed to save changes:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleViewFullDetails = () => {
    if (note) {
      navigate(`/notes/${note.id}`);
      onClose();
    }
  };

  if (!note) return null;

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="bottom" className="rounded-t-[var(--radius-lg)] max-h-[85vh]">
        <SheetHeader>
          <SheetTitle className="text-left">Quick Edit</SheetTitle>
        </SheetHeader>
        
        <div className="space-y-4 mt-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Task Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title..."
              className="text-base"
            />
          </div>

          {/* Due Date */}
          <div className="space-y-2">
            <Label>Due Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !dueDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dueDate ? format(dueDate, "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dueDate}
                  onSelect={setDueDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Owner */}
          <div className="space-y-2">
            <Label>Assigned To</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={owner === 'you' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setOwner('you')}
              >
                {yourName || 'You'}
              </Button>
              <Button
                type="button"
                variant={owner === 'partner' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setOwner('partner')}
                disabled={!partnerName}
              >
                {partnerName || 'Partner'}
              </Button>
              <Button
                type="button"
                variant={owner === 'shared' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setOwner('shared')}
              >
                Both
              </Button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-2">
            <Button 
              onClick={handleSave} 
              disabled={isSaving}
              className="w-full"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
            
            <Button 
              variant="ghost" 
              onClick={handleViewFullDetails}
              className="w-full"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              View Full Details
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

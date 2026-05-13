import React, { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { formatDateForStorage } from '@/utils/dateUtils';
import type { Note } from '@/types/note';
import { cn } from '@/lib/utils';
import { useLocalizedNavigate } from '@/hooks/useLocalizedNavigate';

interface QuickEditBottomSheetProps {
  note: Note | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (noteId: string, updates: Partial<Note>) => Promise<void>;
  /** Current user's user_id (clerk_profiles.id, e.g. user_xxx) */
  currentUserId?: string;
  /** Partner's user_id, or null if no partner in this space */
  partnerUserId?: string | null;
  /** Optional display name for the current user — for the button label */
  yourName?: string;
  /** Optional display name for the partner — for the button label */
  partnerName?: string;
}

// task_owner is canonical (NULL or user_id). We render three buttons
// (You / Partner / Both) but the value WRITTEN to the DB is always
// either currentUserId / partnerUserId / null — never the literal
// strings 'you' / 'partner' / 'shared'. See migration
// 20260513032720_canonicalize_task_owner for the rationale.
const OWNER_BOTH: null = null;

export const QuickEditBottomSheet: React.FC<QuickEditBottomSheetProps> = ({
  note,
  isOpen,
  onClose,
  onSave,
  currentUserId,
  partnerUserId,
  partnerName,
  yourName,
}) => {
  const navigate = useLocalizedNavigate();
  const [title, setTitle] = useState(note?.summary || '');
  const [dueDate, setDueDate] = useState<Date | undefined>(
    note?.dueDate ? new Date(note.dueDate) : undefined
  );
  // `owner` holds the canonical user_id (or null = Both/unassigned).
  // The buttons set this directly to the real id, not to a token.
  const [owner, setOwner] = useState<string | null>(note?.task_owner ?? null);
  const [isSaving, setIsSaving] = useState(false);

  React.useEffect(() => {
    if (note) {
      setTitle(note.summary);
      setDueDate(note.dueDate ? new Date(note.dueDate) : undefined);
      setOwner(note.task_owner ?? null);
    }
  }, [note]);

  const handleSave = async () => {
    if (!note) return;

    setIsSaving(true);
    try {
      await onSave(note.id, {
        summary: title,
        dueDate: dueDate ? formatDateForStorage(dueDate) : null,
        task_owner: owner,
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

          {/* Owner — buttons map to canonical user_ids (or null) */}
          <div className="space-y-2">
            <Label>Assigned To</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={owner === currentUserId ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => currentUserId && setOwner(currentUserId)}
                disabled={!currentUserId}
              >
                {yourName || 'You'}
              </Button>
              <Button
                type="button"
                variant={owner === partnerUserId ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => partnerUserId && setOwner(partnerUserId)}
                disabled={!partnerUserId}
              >
                {partnerName || 'Partner'}
              </Button>
              <Button
                type="button"
                variant={owner === OWNER_BOTH ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setOwner(OWNER_BOTH)}
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

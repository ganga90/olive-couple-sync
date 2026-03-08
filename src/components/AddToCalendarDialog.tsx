import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Calendar, Loader2, Check, ExternalLink } from 'lucide-react';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { toast } from 'sonner';
import type { Note } from '@/types/note';

interface AddToCalendarDialogProps {
  note: Note;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Adds 1 hour to a time string "HH:MM", clamping at 23:59.
 */
function addOneHour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const newH = Math.min(h + 1, 23);
  return `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Returns true if end <= start (meaning end is invalid).
 */
function isEndBeforeOrEqualStart(start: string, end: string): boolean {
  return end <= start;
}

export function AddToCalendarDialog({ note, open, onOpenChange }: AddToCalendarDialogProps) {
  const { t } = useTranslation('notes');
  const { connection, addToCalendar } = useCalendarEvents();
  const [adding, setAdding] = useState(false);
  const [eventLink, setEventLink] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState(note.summary);
  const [description, setDescription] = useState(note.originalText || '');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState('');

  // Pre-fill from note
  useEffect(() => {
    if (!open) return;

    setTitle(note.summary);
    setDescription(note.originalText || '');
    setEventLink(null);

    // Date: use note's dueDate or today
    if (note.dueDate) {
      setStartDate(note.dueDate.split('T')[0]);
    } else {
      setStartDate(new Date().toISOString().split('T')[0]);
    }

    // Time: use note's reminder_time if available, otherwise default 09:00
    if (note.reminder_time) {
      try {
        const rd = new Date(note.reminder_time);
        if (!isNaN(rd.getTime())) {
          const h = String(rd.getHours()).padStart(2, '0');
          const m = String(rd.getMinutes()).padStart(2, '0');
          const noteStart = `${h}:${m}`;
          setStartTime(noteStart);
          setEndTime(addOneHour(noteStart));
        } else {
          setStartTime('09:00');
          setEndTime('10:00');
        }
      } catch {
        setStartTime('09:00');
        setEndTime('10:00');
      }
    } else {
      setStartTime('09:00');
      setEndTime('10:00');
    }

    // Location
    if (note.location && typeof note.location === 'object' && 'name' in note.location) {
      setLocation(String((note.location as { name: string }).name));
    } else {
      setLocation('');
    }
  }, [open, note]);

  // Auto-adjust end time whenever start time changes so end > start
  const handleStartTimeChange = (newStart: string) => {
    setStartTime(newStart);
    // If current end is now <= new start, push end to start + 1h
    if (isEndBeforeOrEqualStart(newStart, endTime)) {
      setEndTime(addOneHour(newStart));
    }
  };

  // Validate end time on change — warn but allow manual override
  const handleEndTimeChange = (newEnd: string) => {
    if (isEndBeforeOrEqualStart(startTime, newEnd)) {
      toast.error('End time must be after start time');
      // Auto-correct to start + 1h
      setEndTime(addOneHour(startTime));
    } else {
      setEndTime(newEnd);
    }
  };

  const handleSubmit = async () => {
    if (!title.trim() || !startDate) {
      toast.error('Title and date are required');
      return;
    }

    if (!allDay && isEndBeforeOrEqualStart(startTime, endTime)) {
      toast.error('End time must be after start time');
      return;
    }

    setAdding(true);
    try {
      let start_time: string;
      let end_time: string | undefined;

      if (allDay) {
        start_time = `${startDate}T12:00:00.000Z`;
      } else {
        start_time = `${startDate}T${startTime}:00.000Z`;
        end_time = `${startDate}T${endTime}:00.000Z`;
      }

      const result = await addToCalendar({
        id: note.id,
        title,
        description,
        start_time,
        end_time,
        all_day: allDay,
        location: location || undefined,
      });

      if (result) {
        setEventLink(result.html_link);
        toast.success('Added to Google Calendar!');
      } else {
        toast.error('Failed to add to calendar');
      }
    } catch {
      toast.error('Failed to add to calendar');
    } finally {
      setAdding(false);
    }
  };

  if (!connection?.connected) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Add to Google Calendar
          </DialogTitle>
        </DialogHeader>

        {eventLink ? (
          <div className="text-center py-6 space-y-4">
            <div className="w-12 h-12 rounded-full bg-[hsl(var(--success))]/10 flex items-center justify-center mx-auto">
              <Check className="h-6 w-6 text-[hsl(var(--success))]" />
            </div>
            <p className="font-medium">Event created!</p>
            <Button variant="outline" asChild>
              <a href={eventLink} target="_blank" rel="noopener noreferrer">
                View in Calendar <ExternalLink className="h-3 w-3 ml-1" />
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
              <Label>Date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>

            <div className="flex items-center justify-between">
              <Label>All day</Label>
              <Switch checked={allDay} onCheckedChange={setAllDay} />
            </div>

            {!allDay && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Start time</Label>
                  <Input type="time" value={startTime} onChange={(e) => handleStartTimeChange(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>End time</Label>
                  <Input type="time" value={endTime} onChange={(e) => handleEndTimeChange(e.target.value)} />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Location (optional)</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Add a location" />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
          </div>
        )}

        {!eventLink && (
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={adding}>
              {adding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Calendar className="h-4 w-4 mr-2" />}
              Create Event
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

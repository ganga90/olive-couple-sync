import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
    if (open) {
      setTitle(note.summary);
      setDescription(note.originalText || '');
      setEventLink(null);
      
      if (note.dueDate) {
        const d = note.dueDate.split('T')[0];
        setStartDate(d);
      } else {
        const today = new Date().toISOString().split('T')[0];
        setStartDate(today);
      }

      if (note.location && typeof note.location === 'object' && 'name' in note.location) {
        setLocation(String((note.location as { name: string }).name));
      }
    }
  }, [open, note]);

  const handleSubmit = async () => {
    if (!title.trim() || !startDate) {
      toast.error('Title and date are required');
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
                  <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>End time</Label>
                  <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
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

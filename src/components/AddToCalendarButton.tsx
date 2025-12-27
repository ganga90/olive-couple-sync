import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar, Loader2, Check, ExternalLink } from 'lucide-react';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { toast } from 'sonner';
import type { Note } from '@/types/note';

interface AddToCalendarButtonProps {
  note: Note;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

export function AddToCalendarButton({ note, variant = 'outline', size = 'sm', className }: AddToCalendarButtonProps) {
  const { connection, addToCalendar } = useCalendarEvents();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [eventLink, setEventLink] = useState<string | null>(null);

  const handleAddToCalendar = async () => {
    if (!note.dueDate && !note.reminder_time) {
      toast.error('This note needs a due date or reminder time to add to calendar');
      return;
    }

    setAdding(true);
    try {
      const startTime = note.dueDate || note.reminder_time;
      if (!startTime) {
        toast.error('This note needs a due date or reminder time');
        setAdding(false);
        return;
      }
      const result = await addToCalendar({
        id: note.id,
        title: note.summary,
        description: note.originalText,
        start_time: startTime,
        end_time: undefined,
        all_day: false,
        location: note.location ? 
          (typeof note.location === 'object' && 'name' in note.location ? String((note.location as { name: string }).name) : undefined) 
          : undefined,
      });

      if (result) {
        setAdded(true);
        setEventLink(result.html_link);
        toast.success('Added to Google Calendar!');
      } else {
        toast.error('Failed to add to calendar');
      }
    } catch (error) {
      console.error('Error adding to calendar:', error);
      toast.error('Failed to add to calendar');
    } finally {
      setAdding(false);
    }
  };

  if (!connection?.connected) {
    return null;
  }

  if (added && eventLink) {
    return (
      <Button
        variant="outline"
        size={size}
        className={className}
        asChild
      >
        <a href={eventLink} target="_blank" rel="noopener noreferrer">
          <Check className="h-4 w-4 mr-2 text-success" />
          View in Calendar
          <ExternalLink className="h-3 w-3 ml-1" />
        </a>
      </Button>
    );
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleAddToCalendar}
      disabled={adding || (!note.dueDate && !note.reminder_time)}
      className={className}
    >
      {adding ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Calendar className="h-4 w-4 mr-2" />
      )}
      Add to Calendar
    </Button>
  );
}

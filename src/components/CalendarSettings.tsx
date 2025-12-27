import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { toast } from 'sonner';
import { Eye, CalendarPlus } from 'lucide-react';

export function CalendarSettings() {
  const { connection, updateSettings } = useCalendarEvents();

  if (!connection?.connected) {
    return null;
  }

  const handleShowEventsChange = async (checked: boolean) => {
    const success = await updateSettings({ show_google_events: checked });
    if (success) {
      toast.success(checked ? 'Google Calendar events will be shown' : 'Google Calendar events hidden');
    } else {
      toast.error('Failed to update setting');
    }
  };

  const handleAutoAddChange = async (checked: boolean) => {
    const success = await updateSettings({ auto_add_to_calendar: checked });
    if (success) {
      toast.success(checked ? 'Notes will be auto-added to calendar' : 'Auto-add disabled');
    } else {
      toast.error('Failed to update setting');
    }
  };

  return (
    <div className="space-y-4 pt-4 border-t border-border/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <Label htmlFor="show-events" className="text-sm font-medium">
            Show Google Calendar events
          </Label>
        </div>
        <Switch
          id="show-events"
          checked={connection.show_google_events}
          onCheckedChange={handleShowEventsChange}
        />
      </div>
      <p className="text-xs text-muted-foreground ml-6">
        Display events from Google Calendar in the Olive calendar view
      </p>

      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <CalendarPlus className="h-4 w-4 text-muted-foreground" />
          <Label htmlFor="auto-add" className="text-sm font-medium">
            Auto-add notes to calendar
          </Label>
        </div>
        <Switch
          id="auto-add"
          checked={connection.auto_add_to_calendar}
          onCheckedChange={handleAutoAddChange}
        />
      </div>
      <p className="text-xs text-muted-foreground ml-6">
        Automatically create calendar events for notes with due dates
      </p>
    </div>
  );
}

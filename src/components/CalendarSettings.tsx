import React from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { toast } from 'sonner';
import { Eye, CalendarPlus } from 'lucide-react';

export function CalendarSettings() {
  const { t } = useTranslation('profile');
  const { connection, updateSettings } = useCalendarEvents();

  if (!connection?.connected) {
    return null;
  }

  const handleShowEventsChange = async (checked: boolean) => {
    const success = await updateSettings({ show_google_events: checked });
    if (success) {
      toast.success(checked ? t('calendarSettings.showEventsEnabled') : t('calendarSettings.showEventsDisabled'));
    } else {
      toast.error(t('calendarSettings.updateError'));
    }
  };

  const handleAutoAddChange = async (checked: boolean) => {
    const success = await updateSettings({ auto_add_to_calendar: checked });
    if (success) {
      toast.success(checked ? t('calendarSettings.autoAddEnabled') : t('calendarSettings.autoAddDisabled'));
    } else {
      toast.error(t('calendarSettings.updateError'));
    }
  };

  return (
    <div className="space-y-4 pt-4 border-t border-border/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <Label htmlFor="show-events" className="text-sm font-medium">
            {t('calendarSettings.showEvents')}
          </Label>
        </div>
        <Switch
          id="show-events"
          checked={connection.show_google_events}
          onCheckedChange={handleShowEventsChange}
        />
      </div>
      <p className="text-xs text-muted-foreground ml-6">
        {t('calendarSettings.showEventsDescription')}
      </p>

      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <CalendarPlus className="h-4 w-4 text-muted-foreground" />
          <Label htmlFor="auto-add" className="text-sm font-medium">
            {t('calendarSettings.autoAdd')}
          </Label>
        </div>
        <Switch
          id="auto-add"
          checked={connection.auto_add_to_calendar}
          onCheckedChange={handleAutoAddChange}
        />
      </div>
      <p className="text-xs text-muted-foreground ml-6">
        {t('calendarSettings.autoAddDescription')}
      </p>
    </div>
  );
}

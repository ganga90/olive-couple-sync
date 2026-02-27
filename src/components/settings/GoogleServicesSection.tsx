import { useTranslation } from 'react-i18next';
import { Calendar, Mail, ListTodo, Check, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { GoogleCalendarConnect } from '@/components/GoogleCalendarConnect';
import { EmailConnect } from '@/components/settings/EmailConnect';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';

function GoogleTasksStatus() {
  const { connection } = useCalendarEvents();
  const { t } = useTranslation('profile');

  if (!connection?.connected) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('googleTasks.connectCalendarFirst', 'Connect your Google account via Calendar first to enable Google Tasks.')}
      </p>
    );
  }

  if (connection.tasks_enabled) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
          <Check className="h-3 w-3 mr-1" />
          {t('googleTasks.enabled', 'Enabled')}
        </Badge>
        <span className="text-xs text-muted-foreground">{connection.email}</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {t('googleTasks.notEnabled', 'Google Tasks permission not granted. Reconnect your Google account to enable it.')}
      </p>
      <p className="text-xs text-muted-foreground">
        {t('googleTasks.reconnectHint', 'Go to Calendar above, disconnect and reconnect to grant Tasks access.')}
      </p>
    </div>
  );
}

export function GoogleServicesSection() {
  const { t } = useTranslation('profile');

  return (
    <div className="space-y-6">
      {/* Calendar */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">{t('googleCalendar.title', 'Google Calendar')}</span>
        </div>
        <GoogleCalendarConnect />
      </div>

      <div className="border-t border-border/50" />

      {/* Tasks */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ListTodo className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-semibold text-foreground">{t('googleTasks.title', 'Google Tasks')}</span>
        </div>
        <GoogleTasksStatus />
      </div>

      <div className="border-t border-border/50" />

      {/* Gmail */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-red-600" />
          <span className="text-sm font-semibold text-foreground">{t('email.title', 'Gmail')}</span>
        </div>
        <EmailConnect />
      </div>
    </div>
  );
}

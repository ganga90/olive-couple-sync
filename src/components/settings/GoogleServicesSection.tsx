import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Mail, ListTodo, Check, Loader2, Clock, Settings2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { GoogleCalendarConnect } from '@/components/GoogleCalendarConnect';
import { EmailConnect } from '@/components/settings/EmailConnect';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';

function EmailTriagePreferences() {
  const { t } = useTranslation('profile');
  const { user } = useAuth();
  const userId = user?.id;
  const [loading, setLoading] = useState(true);
  const [frequency, setFrequency] = useState('12h');
  const [lookbackDays, setLookbackDays] = useState(3);
  const [autoSave, setAutoSave] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const [statusRes, prefRes] = await Promise.all([
          supabase.functions.invoke('olive-email-mcp', { body: { action: 'status', user_id: userId } }),
          supabase.functions.invoke('olive-email-mcp', { body: { action: 'get_preferences', user_id: userId } }),
        ]);
        if (statusRes.data?.success && statusRes.data?.connected) setConnected(true);
        if (prefRes.data?.success && prefRes.data?.preferences) {
          const p = prefRes.data.preferences;
          setFrequency(p.triage_frequency || '12h');
          setLookbackDays(p.triage_lookback_days || 3);
          setAutoSave(p.auto_save_tasks || false);
        }
      } catch (err) {
        console.error('[EmailTriagePreferences] Failed to load:', err);
        setError('Failed to load preferences');
      }
      setLoading(false);
    })();
  }, [userId]);

  const updatePref = async (updates: Record<string, unknown>) => {
    if (!userId) return;
    try {
      const res = await supabase.functions.invoke('olive-email-mcp', {
        body: { action: 'update_preferences', user_id: userId, ...updates },
      });
      if (res.data?.success) {
        toast.success(t('email.preferencesUpdated', 'Preferences updated'));
      } else {
        toast.error(t('email.preferencesError', 'Failed to update preferences'));
      }
    } catch {
      toast.error(t('email.preferencesError', 'Failed to update preferences'));
    }
  };

  if (loading || !connected) return null;

  return (
    <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('email.triagePreferences', 'Email Triage Preferences')}
        </span>
      </div>

      {/* Frequency */}
      <div className="flex items-center justify-between">
        <Label className="text-sm text-foreground">
          {t('email.checkFrequency', 'Auto-check frequency')}
        </Label>
        <Select
          value={frequency}
          onValueChange={(v) => {
            setFrequency(v);
            updatePref({ triage_frequency: v });
          }}
        >
          <SelectTrigger className="w-32 h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">{t('email.frequencyManual', 'Manual')}</SelectItem>
            <SelectItem value="1h">{t('email.frequency1h', 'Every hour')}</SelectItem>
            <SelectItem value="6h">{t('email.frequency6h', 'Every 6 hrs')}</SelectItem>
            <SelectItem value="12h">{t('email.frequency12h', 'Every 12 hrs')}</SelectItem>
            <SelectItem value="24h">{t('email.frequency24h', 'Every 24 hrs')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Lookback days */}
      <div className="flex items-center justify-between">
        <Label className="text-sm text-foreground">
          {t('email.lookbackDays', 'Scan emails from last')}
        </Label>
        <Select
          value={String(lookbackDays)}
          onValueChange={(v) => {
            const days = parseInt(v);
            setLookbackDays(days);
            updatePref({ triage_lookback_days: days });
          }}
        >
          <SelectTrigger className="w-32 h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">{t('email.lookback1', '1 day')}</SelectItem>
            <SelectItem value="3">{t('email.lookback3', '3 days')}</SelectItem>
            <SelectItem value="5">{t('email.lookback5', '5 days')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Auto-save toggle */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm text-foreground">
            {t('email.autoSave', 'Auto-save tasks')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t('email.autoSaveHint', 'Skip review and create tasks automatically')}
          </p>
        </div>
        <Switch
          checked={autoSave}
          onCheckedChange={(v) => {
            setAutoSave(v);
            updatePref({ auto_save_tasks: v });
          }}
        />
      </div>
    </div>
  );
}

export function GoogleServicesSection() {
  const { t } = useTranslation('profile');

  const { connection } = useCalendarEvents();

  return (
    <div className="space-y-6">
      {/* Calendar & Tasks (unified) */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            {t('googleCalendar.title', 'Google Calendar')} & {t('googleTasks.title', 'Google Tasks')}
          </span>
        </div>
        {connection?.connected && connection?.tasks_enabled && (
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
              <ListTodo className="h-3 w-3 mr-1" />
              {t('googleTasks.tasksIncluded', 'Tasks included')}
            </Badge>
          </div>
        )}
        <GoogleCalendarConnect />
        {connection?.connected && !connection?.tasks_enabled && (
          <p className="text-xs text-muted-foreground">
            {t('googleTasks.reconnectHint', 'Disconnect and reconnect to also grant Google Tasks access.')}
          </p>
        )}
      </div>

      <div className="border-t border-border/50" />

      {/* Gmail */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-red-600" />
          <span className="text-sm font-semibold text-foreground">{t('email.title', 'Gmail')}</span>
        </div>
        <EmailConnect />
        <EmailTriagePreferences />
      </div>
    </div>
  );
}

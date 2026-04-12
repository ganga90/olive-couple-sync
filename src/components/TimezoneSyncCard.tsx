import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapPin, Loader2, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/providers/AuthProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';

function getDeviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function TimezoneSyncCard() {
  const { t } = useTranslation('home');
  const { user } = useAuth();
  const navigate = useNavigate();
  const { getLocalizedPath } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedTimezone, setSavedTimezone] = useState<string | null>(null);
  const [deviceTimezone, setDeviceTimezone] = useState<string>('UTC');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user?.id) return;

    const loadTimezoneState = async () => {
      setLoading(true);
      const detectedTimezone = getDeviceTimezone();
      setDeviceTimezone(detectedTimezone);

      try {
        const { data, error } = await supabase
          .from('clerk_profiles')
          .select('timezone')
          .eq('id', user.id)
          .maybeSingle();

        if (error) throw error;
        setSavedTimezone(data?.timezone ?? null);
      } catch (error) {
        console.error('[TimezoneSyncCard] Failed to load timezone:', error);
      } finally {
        setLoading(false);
      }
    };

    loadTimezoneState();
  }, [user?.id]);

  const promptMode = useMemo(() => {
    if (!savedTimezone) return 'missing';
    if (savedTimezone !== deviceTimezone) return 'mismatch';
    return null;
  }, [deviceTimezone, savedTimezone]);

  const dismissKey = useMemo(() => {
    if (!user?.id || !savedTimezone || !deviceTimezone) return null;
    return `olive-timezone-dismissed:${user.id}:${savedTimezone}:${deviceTimezone}`;
  }, [deviceTimezone, savedTimezone, user?.id]);

  useEffect(() => {
    if (promptMode !== 'mismatch' || !dismissKey) {
      setDismissed(false);
      return;
    }

    setDismissed(localStorage.getItem(dismissKey) === '1');
  }, [dismissKey, promptMode]);

  const handleApplyDeviceTimezone = async () => {
    if (!user?.id) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('clerk_profiles')
        .update({ timezone: deviceTimezone })
        .eq('id', user.id);

      if (error) throw error;

      if (dismissKey) localStorage.removeItem(dismissKey);
      setSavedTimezone(deviceTimezone);
      setDismissed(false);
      toast.success(t('timezonePrompt.updated'), {
        description: t('timezonePrompt.updatedDescription'),
      });
    } catch (error) {
      console.error('[TimezoneSyncCard] Failed to save timezone:', error);
      toast.error(t('toast.failedToUpdate'));
    } finally {
      setSaving(false);
    }
  };

  const handleKeepCurrent = () => {
    if (dismissKey) localStorage.setItem(dismissKey, '1');
    setDismissed(true);
  };

  if (!user || loading || !promptMode || dismissed) {
    return null;
  }

  const title = promptMode === 'missing'
    ? t('timezonePrompt.missingTitle')
    : t('timezonePrompt.mismatchTitle');

  const description = promptMode === 'missing'
    ? t('timezonePrompt.missingDescription', { timezone: deviceTimezone })
    : t('timezonePrompt.mismatchDescription', {
        currentTimezone: deviceTimezone,
        savedTimezone: savedTimezone || 'UTC',
      });

  return (
    <section className="rounded-3xl border border-border bg-card/95 p-5 shadow-sm animate-fade-up stagger-1">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <MapPin className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock3 className="h-4 w-4" />
              <span>{deviceTimezone}</span>
            </div>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={handleApplyDeviceTimezone} disabled={saving} size="sm">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {promptMode === 'missing'
                ? t('timezonePrompt.useDevice', { timezone: deviceTimezone })
                : t('timezonePrompt.updateToDevice', { timezone: deviceTimezone })}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(getLocalizedPath('/profile'))}
            >
              {t('timezonePrompt.reviewSettings')}
            </Button>

            {promptMode === 'mismatch' && (
              <Button variant="ghost" size="sm" onClick={handleKeepCurrent}>
                {t('timezonePrompt.keepCurrent', { timezone: savedTimezone || 'UTC' })}
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default TimezoneSyncCard;
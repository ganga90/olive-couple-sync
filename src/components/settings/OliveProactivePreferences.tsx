import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/integrations/supabase/client';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Loader2, Sun, Moon, Bell, Sparkles, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface OlivePreferences {
  proactive_enabled: boolean;
  morning_briefing_enabled: boolean;
  evening_review_enabled: boolean;
  overdue_nudge_enabled: boolean;
  pattern_suggestions_enabled: boolean;
  weekly_summary_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  max_daily_messages: number;
  timezone: string;
}

const DEFAULT_PREFERENCES: OlivePreferences = {
  proactive_enabled: true,
  morning_briefing_enabled: false,
  evening_review_enabled: false,
  overdue_nudge_enabled: true,
  pattern_suggestions_enabled: true,
  weekly_summary_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  max_daily_messages: 5,
  timezone: 'UTC',
};

export const OliveProactivePreferences: React.FC = () => {
  const { t } = useTranslation('profile');
  const { user, isAuthenticated } = useAuth();
  const [preferences, setPreferences] = useState<OlivePreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalPrefs, setOriginalPrefs] = useState<OlivePreferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      fetchPreferences();
    }
  }, [isAuthenticated, user?.id]);

  const fetchPreferences = async () => {
    if (!user?.id) return;
    
    try {
      const { data, error } = await supabase
        .from('olive_user_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        const prefs: OlivePreferences = {
          proactive_enabled: data.proactive_enabled ?? true,
          morning_briefing_enabled: data.morning_briefing_enabled ?? false,
          evening_review_enabled: data.evening_review_enabled ?? false,
          overdue_nudge_enabled: data.overdue_nudge_enabled ?? true,
          pattern_suggestions_enabled: data.pattern_suggestions_enabled ?? true,
          weekly_summary_enabled: data.weekly_summary_enabled ?? false,
          quiet_hours_start: data.quiet_hours_start ?? '22:00',
          quiet_hours_end: data.quiet_hours_end ?? '07:00',
          max_daily_messages: data.max_daily_messages ?? 5,
          timezone: data.timezone ?? 'UTC',
        };
        setPreferences(prefs);
        setOriginalPrefs(prefs);
      }
    } catch (error) {
      console.error('Error fetching preferences:', error);
    } finally {
      setLoading(false);
    }
  };

  const updatePreference = <K extends keyof OlivePreferences>(key: K, value: OlivePreferences[K]) => {
    setPreferences(prev => {
      const updated = { ...prev, [key]: value };
      setHasChanges(JSON.stringify(updated) !== JSON.stringify(originalPrefs));
      return updated;
    });
  };

  const savePreferences = async () => {
    if (!user?.id) return;
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from('olive_user_preferences')
        .upsert({
          user_id: user.id,
          ...preferences,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id'
        });

      if (error) throw error;

      setOriginalPrefs(preferences);
      setHasChanges(false);
      toast.success(t('olivePreferences.saved', 'Preferences saved'));
    } catch (error) {
      console.error('Error saving preferences:', error);
      toast.error(t('olivePreferences.error', 'Failed to save preferences'));
    } finally {
      setSaving(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <p className="text-sm text-stone-500">
        {t('olivePreferences.signInRequired', 'Sign in to configure Olive preferences')}
      </p>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Master Toggle */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-primary/5 border border-primary/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <Label className="text-sm font-medium">{t('olivePreferences.proactiveEnabled', 'Proactive Olive')}</Label>
            <p className="text-xs text-stone-500">{t('olivePreferences.proactiveEnabledDesc', 'Let Olive reach out with helpful suggestions')}</p>
          </div>
        </div>
        <Switch 
          checked={preferences.proactive_enabled} 
          onCheckedChange={(v) => updatePreference('proactive_enabled', v)} 
        />
      </div>

      {/* Proactive Features (disabled when master is off) */}
      <div className={cn(
        "space-y-4 transition-opacity duration-200",
        !preferences.proactive_enabled && "opacity-50 pointer-events-none"
      )}>
        {/* Morning Briefing */}
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <Sun className="h-5 w-5 text-amber-500" />
            <div>
              <Label className="text-sm font-medium">{t('olivePreferences.morningBriefing', 'Morning Briefing')}</Label>
              <p className="text-xs text-stone-500">{t('olivePreferences.morningBriefingDesc', 'Daily summary of your tasks at 8 AM')}</p>
            </div>
          </div>
          <Switch 
            checked={preferences.morning_briefing_enabled} 
            onCheckedChange={(v) => updatePreference('morning_briefing_enabled', v)} 
          />
        </div>

        {/* Evening Review */}
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <Moon className="h-5 w-5 text-indigo-500" />
            <div>
              <Label className="text-sm font-medium">{t('olivePreferences.eveningReview', 'Evening Review')}</Label>
              <p className="text-xs text-stone-500">{t('olivePreferences.eveningReviewDesc', 'Recap what you accomplished today at 8 PM')}</p>
            </div>
          </div>
          <Switch 
            checked={preferences.evening_review_enabled} 
            onCheckedChange={(v) => updatePreference('evening_review_enabled', v)} 
          />
        </div>

        {/* Overdue Nudges */}
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <Bell className="h-5 w-5 text-[hsl(var(--priority-high))]" />
            <div>
              <Label className="text-sm font-medium">{t('olivePreferences.overdueNudge', 'Overdue Task Nudges')}</Label>
              <p className="text-xs text-stone-500">{t('olivePreferences.overdueNudgeDesc', 'Gentle reminders for overdue tasks')}</p>
            </div>
          </div>
          <Switch 
            checked={preferences.overdue_nudge_enabled} 
            onCheckedChange={(v) => updatePreference('overdue_nudge_enabled', v)} 
          />
        </div>

        {/* Pattern Suggestions */}
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-[hsl(var(--magic-accent))]" />
            <div>
              <Label className="text-sm font-medium">{t('olivePreferences.patternSuggestions', 'Pattern Suggestions')}</Label>
              <p className="text-xs text-stone-500">{t('olivePreferences.patternSuggestionsDesc', 'Smart suggestions based on your habits')}</p>
            </div>
          </div>
          <Switch 
            checked={preferences.pattern_suggestions_enabled} 
            onCheckedChange={(v) => updatePreference('pattern_suggestions_enabled', v)} 
          />
        </div>

        {/* Weekly Summary */}
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-blue-500" />
            <div>
              <Label className="text-sm font-medium">{t('olivePreferences.weeklySummary', 'Weekly Summary')}</Label>
              <p className="text-xs text-stone-500">{t('olivePreferences.weeklySummaryDesc', 'Get a weekly productivity report on Sundays')}</p>
            </div>
          </div>
          <Switch 
            checked={preferences.weekly_summary_enabled} 
            onCheckedChange={(v) => updatePreference('weekly_summary_enabled', v)} 
          />
        </div>
      </div>

      {/* Quiet Hours */}
      <div className="pt-4 border-t border-stone-100">
        <div className="flex items-center gap-3 mb-4">
          <Moon className="h-5 w-5 text-stone-400" />
          <div>
            <Label className="text-sm font-medium">{t('olivePreferences.quietHours', 'Quiet Hours')}</Label>
            <p className="text-xs text-stone-500">{t('olivePreferences.quietHoursDesc', 'No proactive messages during these hours')}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 pl-8">
          <div className="flex-1">
            <Label className="text-xs text-stone-500 mb-1 block">{t('olivePreferences.from', 'From')}</Label>
            <input
              type="time"
              value={preferences.quiet_hours_start}
              onChange={(e) => updatePreference('quiet_hours_start', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex-1">
            <Label className="text-xs text-stone-500 mb-1 block">{t('olivePreferences.to', 'To')}</Label>
            <input
              type="time"
              value={preferences.quiet_hours_end}
              onChange={(e) => updatePreference('quiet_hours_end', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>
      </div>

      {/* Max Daily Messages */}
      <div className="pt-4 border-t border-stone-100">
        <div className="flex items-center justify-between mb-4">
          <div>
            <Label className="text-sm font-medium">{t('olivePreferences.maxMessages', 'Max Daily Messages')}</Label>
            <p className="text-xs text-stone-500">{t('olivePreferences.maxMessagesDesc', 'Limit how many proactive messages Olive sends per day')}</p>
          </div>
          <span className="text-lg font-semibold text-primary">{preferences.max_daily_messages}</span>
        </div>
        <Slider
          value={[preferences.max_daily_messages]}
          onValueChange={([v]) => updatePreference('max_daily_messages', v)}
          min={1}
          max={15}
          step={1}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-stone-400 mt-1">
          <span>1</span>
          <span>15</span>
        </div>
      </div>

      {/* Save Button */}
      {hasChanges && (
        <div className="pt-4">
          <Button 
            onClick={savePreferences} 
            disabled={saving}
            className="w-full rounded-xl"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('common:buttons.saving', 'Saving...')}
              </>
            ) : (
              t('olivePreferences.savePreferences', 'Save Preferences')
            )}
          </Button>
        </div>
      )}
    </div>
  );
};

export default OliveProactivePreferences;

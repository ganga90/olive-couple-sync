import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/providers/AuthProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Globe, Clock, MapPin } from 'lucide-react';
import { LANGUAGES } from '@/lib/i18n/languages';

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
  { value: 'Europe/Rome', label: 'Rome (CET/CEST)' },
  { value: 'Europe/Madrid', label: 'Madrid (CET/CEST)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEDT/AEST)' },
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
];

export const RegionalFormatCard: React.FC = () => {
  const { t } = useTranslation(['profile', 'common']);
  const { user } = useAuth();
  const { toast } = useToast();
  const { currentLanguage, changeLanguage, isLoading: languageLoading } = useLanguage();
  
  const [timezone, setTimezone] = useState<string>('America/New_York');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasTimezoneChanged, setHasTimezoneChanged] = useState(false);

  useEffect(() => {
    const fetchTimezone = async () => {
      if (!user?.id) return;

      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('clerk_profiles')
          .select('timezone')
          .eq('id', user.id)
          .single();

        if (error) throw error;

        if (data?.timezone) {
          setTimezone(data.timezone);
        } else {
          const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          if (detectedTimezone && TIMEZONES.some(tz => tz.value === detectedTimezone)) {
            setTimezone(detectedTimezone);
            setHasTimezoneChanged(true);
          }
        }
      } catch (error) {
        console.error('Error fetching timezone:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTimezone();
  }, [user?.id]);

  const handleAutoDetect = useCallback(() => {
    const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detectedTimezone) {
      // Check if it's in our list
      const isKnownTimezone = TIMEZONES.some(tz => tz.value === detectedTimezone);
      if (isKnownTimezone) {
        setTimezone(detectedTimezone);
        setHasTimezoneChanged(true);
        toast({
          title: t('profile:timezoneField.detected'),
          description: t('profile:timezoneField.detectedDescription', { timezone: detectedTimezone }),
        });
      } else {
        // Use the detected timezone anyway but warn user
        setTimezone(detectedTimezone);
        setHasTimezoneChanged(true);
        toast({
          title: t('profile:timezoneField.detected'),
          description: t('profile:timezoneField.detectedUnknown', { timezone: detectedTimezone }),
        });
      }
    } else {
      toast({
        title: t('common:errors.somethingWentWrong'),
        description: t('profile:timezoneField.detectError'),
        variant: "destructive",
      });
    }
  }, [t, toast]);

  const handleSaveTimezone = async () => {
    if (!user?.id) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('clerk_profiles')
        .update({ timezone })
        .eq('id', user.id);

      if (error) throw error;

      setHasTimezoneChanged(false);
      toast({
        title: t('profile:timezoneField.updated'),
        description: t('profile:timezoneField.updatedDescription'),
      });
    } catch (error) {
      console.error('Error updating timezone:', error);
      toast({
        title: t('common:errors.somethingWentWrong'),
        description: t('profile:timezoneField.error'),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleLanguageChange = async (value: string) => {
    await changeLanguage(value);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {t('profile:regional.description', 'Set your language and timezone to personalize how dates and content are displayed.')}
      </p>

      {/* Language Row */}
      <div className="space-y-2">
        <Label className="text-sm font-medium flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          {t('common:language.title')}
        </Label>
        <Select 
          value={currentLanguage} 
          onValueChange={handleLanguageChange} 
          disabled={languageLoading}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              <span className="flex items-center gap-2">
                <span className="text-lg">{LANGUAGES[currentLanguage]?.flag}</span>
                <span>{LANGUAGES[currentLanguage]?.nativeName}</span>
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(LANGUAGES).map(([code, lang]) => (
              <SelectItem key={code} value={code}>
                <span className="flex items-center gap-2">
                  <span className="text-lg">{lang.flag}</span>
                  <span>{lang.nativeName}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Timezone Row */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-600" />
            {t('profile:timezoneField.title')}
          </Label>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleAutoDetect}
            className="h-7 text-xs text-primary hover:text-primary/80"
          >
            <MapPin className="h-3 w-3 mr-1" />
            {t('profile:timezoneField.autoDetect')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">
          {t('profile:timezoneField.description')}
        </p>
        <Select
          value={timezone}
          onValueChange={(value) => {
            setTimezone(value);
            setHasTimezoneChanged(true);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t('profile:timezoneField.placeholder')} />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((tz) => (
              <SelectItem key={tz.value} value={tz.value}>
                {tz.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasTimezoneChanged && (
          <Button
            onClick={handleSaveTimezone}
            disabled={saving}
            className="w-full mt-2"
            size="sm"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('profile:timezoneField.saving')}
              </>
            ) : (
              t('profile:timezoneField.save')
            )}
          </Button>
        )}
      </div>
    </div>
  );
};

export default RegionalFormatCard;

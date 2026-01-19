import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Shield, Settings, Check } from 'lucide-react';
import { getCookiePreferences, setCookieConsent, CookiePreferences } from './CookieConsentBanner';
import { toast } from 'sonner';

export const CookieSettings: React.FC = () => {
  const { t } = useTranslation(['profile', 'common']);
  const [preferences, setPreferences] = useState<CookiePreferences>(getCookiePreferences());
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setPreferences(getCookiePreferences());
  }, []);

  const updatePreference = (key: keyof CookiePreferences, value: boolean) => {
    if (key === 'necessary') return;
    setPreferences(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    setCookieConsent(preferences);
    setHasChanges(false);
    toast.success(t('profile:cookieSettings.saved'));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-500 mb-4">
        {t('profile:cookieSettings.description')}
      </p>

      {/* Necessary Cookies - Always enabled */}
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Shield className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <Label className="text-sm font-medium">{t('common:cookies.necessary')}</Label>
            <p className="text-xs text-stone-500">{t('common:cookies.necessaryDesc')}</p>
          </div>
        </div>
        <Switch checked={true} disabled className="opacity-50 flex-shrink-0" />
      </div>

      {/* Functional Cookies */}
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
            <Settings className="h-4 w-4 text-blue-500" />
          </div>
          <div className="min-w-0">
            <Label className="text-sm font-medium">{t('common:cookies.functional')}</Label>
            <p className="text-xs text-stone-500">{t('common:cookies.functionalDesc')}</p>
          </div>
        </div>
        <Switch 
          checked={preferences.functional} 
          onCheckedChange={(v) => updatePreference('functional', v)}
          className="flex-shrink-0"
        />
      </div>

      {/* Analytics Cookies */}
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
            <svg className="h-4 w-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div className="min-w-0">
            <Label className="text-sm font-medium">{t('common:cookies.analytics')}</Label>
            <p className="text-xs text-stone-500">{t('common:cookies.analyticsDesc')}</p>
          </div>
        </div>
        <Switch 
          checked={preferences.analytics} 
          onCheckedChange={(v) => updatePreference('analytics', v)}
          className="flex-shrink-0"
        />
      </div>

      {/* Marketing Cookies */}
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-[hsl(var(--accent))]/10 flex items-center justify-center flex-shrink-0">
            <svg className="h-4 w-4 text-[hsl(var(--accent))]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
            </svg>
          </div>
          <div className="min-w-0">
            <Label className="text-sm font-medium">{t('common:cookies.marketing')}</Label>
            <p className="text-xs text-stone-500">{t('common:cookies.marketingDesc')}</p>
          </div>
        </div>
        <Switch 
          checked={preferences.marketing} 
          onCheckedChange={(v) => updatePreference('marketing', v)}
          className="flex-shrink-0"
        />
      </div>

      {/* Save Button */}
      {hasChanges && (
        <Button onClick={handleSave} size="sm" className="w-full mt-4">
          <Check className="h-4 w-4 mr-2" />
          {t('profile:cookieSettings.saveButton')}
        </Button>
      )}
    </div>
  );
};

export default CookieSettings;

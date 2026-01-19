import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Cookie, Settings, Shield, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

// Cookie consent types
export interface CookiePreferences {
  necessary: boolean; // Always true, cannot be disabled
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
}

const COOKIE_CONSENT_KEY = 'olive_cookie_consent';
const COOKIE_PREFERENCES_KEY = 'olive_cookie_preferences';

const defaultPreferences: CookiePreferences = {
  necessary: true,
  functional: true,
  analytics: false,
  marketing: false,
};

export const getCookieConsent = (): boolean => {
  return localStorage.getItem(COOKIE_CONSENT_KEY) === 'true';
};

export const getCookiePreferences = (): CookiePreferences => {
  const stored = localStorage.getItem(COOKIE_PREFERENCES_KEY);
  if (stored) {
    try {
      return { ...defaultPreferences, ...JSON.parse(stored), necessary: true };
    } catch {
      return defaultPreferences;
    }
  }
  return defaultPreferences;
};

export const setCookieConsent = (preferences: CookiePreferences) => {
  localStorage.setItem(COOKIE_CONSENT_KEY, 'true');
  localStorage.setItem(COOKIE_PREFERENCES_KEY, JSON.stringify({ ...preferences, necessary: true }));
};

interface CookieConsentBannerProps {
  className?: string;
}

export const CookieConsentBanner: React.FC<CookieConsentBannerProps> = ({ className }) => {
  const { t } = useTranslation('common');
  const [isVisible, setIsVisible] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [preferences, setPreferences] = useState<CookiePreferences>(defaultPreferences);

  useEffect(() => {
    // Check if user has already consented
    const hasConsented = getCookieConsent();
    if (!hasConsented) {
      // Small delay to avoid layout shift on initial load
      const timer = setTimeout(() => setIsVisible(true), 500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAcceptAll = () => {
    const allAccepted: CookiePreferences = {
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    };
    setCookieConsent(allAccepted);
    setIsVisible(false);
  };

  const handleAcceptNecessary = () => {
    const necessaryOnly: CookiePreferences = {
      necessary: true,
      functional: false,
      analytics: false,
      marketing: false,
    };
    setCookieConsent(necessaryOnly);
    setIsVisible(false);
  };

  const handleSavePreferences = () => {
    setCookieConsent(preferences);
    setIsVisible(false);
  };

  const updatePreference = (key: keyof CookiePreferences, value: boolean) => {
    if (key === 'necessary') return; // Cannot disable necessary cookies
    setPreferences(prev => ({ ...prev, [key]: value }));
  };

  if (!isVisible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 100 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={cn(
          'fixed bottom-0 left-0 right-0 z-[100] p-4 md:p-6',
          'pb-[calc(env(safe-area-inset-bottom)+1rem)]',
          className
        )}
      >
        <Card className="mx-auto max-w-2xl border-border bg-card/95 backdrop-blur-xl shadow-elevated overflow-hidden">
          <div className="p-4 md:p-6">
            {/* Header */}
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary flex-shrink-0">
                <Cookie className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-foreground">
                  {t('cookies.title', 'We value your privacy')}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('cookies.description', 'We use cookies to enhance your browsing experience, provide personalized content, and analyze our traffic. By clicking "Accept All", you consent to our use of cookies.')}
                </p>
              </div>
            </div>

            {/* Preferences Panel */}
            <AnimatePresence>
              {showPreferences && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="py-4 space-y-4 border-t border-b border-border my-4">
                    {/* Necessary Cookies - Always enabled */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Shield className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <Label className="text-sm font-medium">{t('cookies.necessary', 'Necessary')}</Label>
                          <p className="text-xs text-muted-foreground">{t('cookies.necessaryDesc', 'Essential for the website to function')}</p>
                        </div>
                      </div>
                      <Switch checked={true} disabled className="opacity-50" />
                    </div>

                    {/* Functional Cookies */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-info/10 flex items-center justify-center">
                          <Settings className="h-4 w-4 text-info" />
                        </div>
                        <div>
                          <Label className="text-sm font-medium">{t('cookies.functional', 'Functional')}</Label>
                          <p className="text-xs text-muted-foreground">{t('cookies.functionalDesc', 'Remember your preferences and settings')}</p>
                        </div>
                      </div>
                      <Switch 
                        checked={preferences.functional} 
                        onCheckedChange={(v) => updatePreference('functional', v)} 
                      />
                    </div>

                    {/* Analytics Cookies */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-warning/10 flex items-center justify-center">
                          <svg className="h-4 w-4 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                        </div>
                        <div>
                          <Label className="text-sm font-medium">{t('cookies.analytics', 'Analytics')}</Label>
                          <p className="text-xs text-muted-foreground">{t('cookies.analyticsDesc', 'Help us understand how you use our app')}</p>
                        </div>
                      </div>
                      <Switch 
                        checked={preferences.analytics} 
                        onCheckedChange={(v) => updatePreference('analytics', v)} 
                      />
                    </div>

                    {/* Marketing Cookies */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-accent/10 flex items-center justify-center">
                          <svg className="h-4 w-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                          </svg>
                        </div>
                        <div>
                          <Label className="text-sm font-medium">{t('cookies.marketing', 'Marketing')}</Label>
                          <p className="text-xs text-muted-foreground">{t('cookies.marketingDesc', 'Personalized advertisements and content')}</p>
                        </div>
                      </div>
                      <Switch 
                        checked={preferences.marketing} 
                        onCheckedChange={(v) => updatePreference('marketing', v)} 
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Actions */}
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 mt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPreferences(!showPreferences)}
                className="text-muted-foreground hover:text-foreground"
              >
                <Settings className="h-4 w-4 mr-2" />
                {showPreferences ? t('cookies.hidePreferences', 'Hide preferences') : t('cookies.managePreferences', 'Manage preferences')}
              </Button>
              
              <div className="flex gap-2 sm:ml-auto">
                {showPreferences ? (
                  <Button onClick={handleSavePreferences} className="flex-1 sm:flex-initial">
                    <Check className="h-4 w-4 mr-2" />
                    {t('cookies.savePreferences', 'Save preferences')}
                  </Button>
                ) : (
                  <>
                    <Button 
                      variant="outline" 
                      onClick={handleAcceptNecessary}
                      className="flex-1 sm:flex-initial"
                    >
                      {t('cookies.necessaryOnly', 'Necessary only')}
                    </Button>
                    <Button onClick={handleAcceptAll} className="flex-1 sm:flex-initial">
                      <Check className="h-4 w-4 mr-2" />
                      {t('cookies.acceptAll', 'Accept all')}
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Privacy Policy Link */}
            <p className="text-xs text-muted-foreground mt-4 text-center sm:text-left">
              {t('cookies.learnMore', 'Learn more in our')}{' '}
              <a href="/legal/privacy" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                {t('cookies.privacyPolicy', 'Privacy Policy')}
              </a>
            </p>
          </div>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
};

export default CookieConsentBanner;

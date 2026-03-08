import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Shield, Cookie, HelpCircle, ChevronRight, LayoutDashboard } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CookieSettings } from '@/components/CookieSettings';
import { cn } from '@/lib/utils';

interface PreferenceRowProps {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle: string;
  onClick?: () => void;
}

const PreferenceRow = ({ icon, iconBg, title, subtitle, onClick }: PreferenceRowProps) => (
  <button 
    onClick={onClick}
    className="flex items-center gap-4 w-full p-4 rounded-xl hover:bg-stone-50 transition-all duration-300 text-left group"
  >
    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", iconBg)}>
      {icon}
    </div>
    <div className="flex-1 min-w-0">
      <p className="font-medium text-[#2A3C24]">{title}</p>
      <p className="text-xs text-stone-500">{subtitle}</p>
    </div>
    <ChevronRight className="h-5 w-5 text-stone-300 group-hover:text-stone-500 group-hover:translate-x-0.5 transition-all duration-200 flex-shrink-0" />
  </button>
);

// Notifications Settings Content
const NotificationsContent: React.FC = () => {
  const { t } = useTranslation('profile');
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [partnerEnabled, setPartnerEnabled] = useState(true);

  return (
    <div className="space-y-6 pt-4">
      <div className="flex items-center justify-between py-2">
        <div>
          <Label className="text-sm font-medium">{t('notifications.push', 'Push Notifications')}</Label>
          <p className="text-xs text-stone-500">{t('notifications.pushDesc', 'Get notified on your device')}</p>
        </div>
        <Switch checked={pushEnabled} onCheckedChange={setPushEnabled} />
      </div>
      
      <div className="flex items-center justify-between py-2">
        <div>
          <Label className="text-sm font-medium">{t('notifications.email', 'Email Notifications')}</Label>
          <p className="text-xs text-stone-500">{t('notifications.emailDesc', 'Receive updates via email')}</p>
        </div>
        <Switch checked={emailEnabled} onCheckedChange={setEmailEnabled} />
      </div>
      
      <div className="flex items-center justify-between py-2">
        <div>
          <Label className="text-sm font-medium">{t('notifications.reminders', 'Task Reminders')}</Label>
          <p className="text-xs text-stone-500">{t('notifications.remindersDesc', 'Get reminded about upcoming tasks')}</p>
        </div>
        <Switch checked={reminderEnabled} onCheckedChange={setReminderEnabled} />
      </div>
      
      <div className="flex items-center justify-between py-2">
        <div>
          <Label className="text-sm font-medium">{t('notifications.partner', 'Partner Activity')}</Label>
          <p className="text-xs text-stone-500">{t('notifications.partnerDesc', 'Know when your partner adds or completes tasks')}</p>
        </div>
        <Switch checked={partnerEnabled} onCheckedChange={setPartnerEnabled} />
      </div>
    </div>
  );
};

// Privacy Settings Content
const PrivacyContent: React.FC = () => {
  const { t } = useTranslation('profile');
  const [shareAnalytics, setShareAnalytics] = useState(false);
  const [showActivity, setShowActivity] = useState(true);

  return (
    <div className="space-y-6 pt-4">
      <div className="flex items-center justify-between py-2">
        <div>
          <Label className="text-sm font-medium">{t('privacy.analytics', 'Share Usage Analytics')}</Label>
          <p className="text-xs text-stone-500">{t('privacy.analyticsDesc', 'Help us improve Olive with anonymous data')}</p>
        </div>
        <Switch checked={shareAnalytics} onCheckedChange={setShareAnalytics} />
      </div>
      
      <div className="flex items-center justify-between py-2">
        <div>
          <Label className="text-sm font-medium">{t('privacy.activity', 'Show Activity Status')}</Label>
          <p className="text-xs text-stone-500">{t('privacy.activityDesc', 'Let your partner see when you are active')}</p>
        </div>
        <Switch checked={showActivity} onCheckedChange={setShowActivity} />
      </div>

      <div className="pt-4 border-t border-stone-100">
        <p className="text-xs text-stone-500">
          {t('privacy.dataNote', 'Your data is encrypted and stored securely. We never sell your personal information.')}
        </p>
      </div>
    </div>
  );
};

// Help Content
const HelpContent: React.FC = () => {
  const { t } = useTranslation('profile');

  return (
    <div className="space-y-4 pt-4">
      <div className="p-4 rounded-xl bg-stone-50">
        <h4 className="font-medium text-sm mb-2">{t('help.faq', 'Frequently Asked Questions')}</h4>
        <p className="text-xs text-stone-500">{t('help.faqDesc', 'Find answers to common questions about Olive.')}</p>
      </div>
      
      <div className="p-4 rounded-xl bg-stone-50">
        <h4 className="font-medium text-sm mb-2">{t('help.contact', 'Contact Support')}</h4>
        <p className="text-xs text-stone-500">{t('help.contactDesc', 'Need help? Reach out to our support team.')}</p>
        <a 
          href="mailto:support@olive.app" 
          className="text-xs text-primary font-medium mt-2 inline-block hover:underline"
        >
          support@olive.app
        </a>
      </div>
      
      <div className="p-4 rounded-xl bg-stone-50">
        <h4 className="font-medium text-sm mb-2">{t('help.feedback', 'Send Feedback')}</h4>
        <p className="text-xs text-stone-500">{t('help.feedbackDesc', 'We love hearing from you! Share your ideas.')}</p>
      </div>
    </div>
  );
};

// Default Home View Content
const DefaultHomeViewContent: React.FC = () => {
  const { t } = useTranslation('profile');
  const [defaultTab, setDefaultTab] = useState(
    () => localStorage.getItem('olive_default_home_tab') || 'weekly'
  );

  const handleChange = (value: string) => {
    setDefaultTab(value);
    localStorage.setItem('olive_default_home_tab', value);
  };

  const tabs = [
    { value: 'priority', label: t('defaultHomeView.priority', '🔥 Priority') },
    { value: 'weekly', label: t('defaultHomeView.weekly', '📆 Weekly') },
    { value: 'reminders', label: t('defaultHomeView.reminders', '⏰ Reminders') },
    { value: 'recent', label: t('defaultHomeView.recent', '🕐 Recent') },
  ];

  return (
    <div className="space-y-4 pt-4">
      <p className="text-sm text-muted-foreground">
        {t('defaultHomeView.description', 'Choose which tab opens by default when you visit your Home.')}
      </p>
      <div className="space-y-2">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => handleChange(tab.value)}
            className={cn(
              "w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all",
              defaultTab === tab.value
                ? "bg-primary/10 border border-primary/30"
                : "bg-stone-50 hover:bg-stone-100 border border-transparent"
            )}
          >
            <div className={cn(
              "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0",
              defaultTab === tab.value ? "border-primary" : "border-stone-300"
            )}>
              {defaultTab === tab.value && (
                <div className="w-2.5 h-2.5 rounded-full bg-primary" />
              )}
            </div>
            <span className="text-sm font-medium">{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

type ModalType = 'notifications' | 'privacy' | 'cookies' | 'help' | 'defaultView' | null;

export const AppPreferencesModals: React.FC = () => {
  const { t } = useTranslation('profile');
  const [activeModal, setActiveModal] = useState<ModalType>(null);

  const getModalContent = () => {
    switch (activeModal) {
      case 'notifications':
        return {
          title: t('settings.notifications.title'),
          description: t('settings.notifications.subtitle'),
          content: <NotificationsContent />,
        };
      case 'privacy':
        return {
          title: t('settings.privacy.title'),
          description: t('settings.privacy.subtitle'),
          content: <PrivacyContent />,
        };
      case 'cookies':
        return {
          title: t('cookieSettings.title'),
          description: t('cookieSettings.subtitle'),
          content: <CookieSettings />,
        };
      case 'help':
        return {
          title: t('settings.help.title'),
          description: t('settings.help.subtitle'),
          content: <HelpContent />,
        };
      case 'defaultView':
        return {
          title: t('defaultHomeView.title', 'Default Home View'),
          description: t('defaultHomeView.subtitle', 'Choose your default tab'),
          content: <DefaultHomeViewContent />,
        };
      default:
        return null;
    }
  };

  const modalContent = getModalContent();

  return (
    <>
      <div className="-mx-5 -mb-5">
        <PreferenceRow
          icon={<Bell className="h-5 w-5 text-stone-500" />}
          iconBg="bg-stone-100"
          title={t('settings.notifications.title')}
          subtitle={t('settings.notifications.subtitle')}
          onClick={() => setActiveModal('notifications')}
        />
        <PreferenceRow
          icon={<Shield className="h-5 w-5 text-stone-500" />}
          iconBg="bg-stone-100"
          title={t('settings.privacy.title')}
          subtitle={t('settings.privacy.subtitle')}
          onClick={() => setActiveModal('privacy')}
        />
        <PreferenceRow
          icon={<Cookie className="h-5 w-5 text-amber-600" />}
          iconBg="bg-amber-500/10"
          title={t('cookieSettings.title')}
          subtitle={t('cookieSettings.subtitle')}
          onClick={() => setActiveModal('cookies')}
        />
        <PreferenceRow
          icon={<HelpCircle className="h-5 w-5 text-stone-500" />}
          iconBg="bg-stone-100"
          title={t('settings.help.title')}
          subtitle={t('settings.help.subtitle')}
          onClick={() => setActiveModal('help')}
        />
      </div>

      <Sheet open={activeModal !== null} onOpenChange={(open) => !open && setActiveModal(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[85vh] overflow-y-auto pb-safe">
          <SheetHeader className="text-left pb-2">
            <SheetTitle className="font-serif text-xl">{modalContent?.title}</SheetTitle>
            <SheetDescription>{modalContent?.description}</SheetDescription>
          </SheetHeader>
          {modalContent?.content}
        </SheetContent>
      </Sheet>
    </>
  );
};

export default AppPreferencesModals;

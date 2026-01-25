import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Bell, Shield, Cookie, HelpCircle } from 'lucide-react';
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

interface AppPreferencesCardProps {
  onNotificationsClick?: () => void;
  onPrivacyClick?: () => void;
  onCookiesClick?: () => void;
  onHelpClick?: () => void;
}

export const AppPreferencesCard: React.FC<AppPreferencesCardProps> = ({
  onNotificationsClick,
  onPrivacyClick,
  onCookiesClick,
  onHelpClick,
}) => {
  const { t } = useTranslation('profile');

  return (
    <div className="-mx-5 -mb-5">
      <PreferenceRow
        icon={<Bell className="h-5 w-5 text-stone-500" />}
        iconBg="bg-stone-100"
        title={t('settings.notifications.title')}
        subtitle={t('settings.notifications.subtitle')}
        onClick={onNotificationsClick}
      />
      <PreferenceRow
        icon={<Shield className="h-5 w-5 text-stone-500" />}
        iconBg="bg-stone-100"
        title={t('settings.privacy.title')}
        subtitle={t('settings.privacy.subtitle')}
        onClick={onPrivacyClick}
      />
      <PreferenceRow
        icon={<Cookie className="h-5 w-5 text-amber-600" />}
        iconBg="bg-amber-500/10"
        title={t('cookieSettings.title')}
        subtitle={t('cookieSettings.subtitle')}
        onClick={onCookiesClick}
      />
      <PreferenceRow
        icon={<HelpCircle className="h-5 w-5 text-stone-500" />}
        iconBg="bg-stone-100"
        title={t('settings.help.title')}
        subtitle={t('settings.help.subtitle')}
        onClick={onHelpClick}
      />
    </div>
  );
};

export default AppPreferencesCard;

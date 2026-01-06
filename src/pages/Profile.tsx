import { useSEO } from "@/hooks/useSEO";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { PartnerInfo } from "@/components/PartnerInfo";
import { PhoneNumberField } from "@/components/PhoneNumberField";
import { TimezoneField } from "@/components/TimezoneField";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { NoteStyleField } from "@/components/NoteStyleField";
import { MemoryPersonalization } from "@/components/MemoryPersonalization";
import { GoogleCalendarConnect } from "@/components/GoogleCalendarConnect";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { DataExport } from "@/components/DataExport";
import { User, LogOut, Bell, Shield, HelpCircle, Brain, Sparkles, Calendar, ChevronRight, Globe, MessageSquare, Clock, Users, Download } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { useClerk } from "@clerk/clerk-react";
import { useLanguage } from "@/providers/LanguageProvider";
import { cn } from "@/lib/utils";

interface SettingsCardProps {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  delay?: number;
}

const SettingsCard = ({ icon, iconBg, title, subtitle, children, delay = 0 }: SettingsCardProps) => (
  <div 
    className="card-glass p-5 animate-fade-up"
    style={{ animationDelay: `${delay}ms` }}
  >
    <div className="flex items-start gap-4 mb-4">
      <div className={cn("icon-squircle w-12 h-12 flex-shrink-0", iconBg)}>
        {icon}
      </div>
      <div className="flex-1 min-w-0 pt-1">
        <h3 className="font-serif font-semibold text-[#2A3C24] text-lg">{title}</h3>
        {subtitle && <p className="text-xs text-stone-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
    <div className="pl-16">
      {children}
    </div>
  </div>
);

interface SettingsRowProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick?: () => void;
}

const SettingsRow = ({ icon, title, subtitle, onClick }: SettingsRowProps) => (
  <button 
    onClick={onClick}
    className="flex items-center gap-4 w-full p-4 rounded-2xl hover:bg-stone-50 transition-all duration-300 text-left group"
  >
    <div className="icon-squircle w-11 h-11 bg-stone-100/80">
      {icon}
    </div>
    <div className="flex-1 min-w-0">
      <p className="font-medium text-[#2A3C24]">{title}</p>
      <p className="text-xs text-stone-500">{subtitle}</p>
    </div>
    <ChevronRight className="h-5 w-5 text-stone-300 group-hover:text-stone-500 group-hover:translate-x-0.5 transition-all duration-200" />
  </button>
);

const Profile = () => {
  const { t } = useTranslation(['profile', 'common']);
  const { getLocalizedPath } = useLanguage();
  useSEO({ title: `${t('profile:title')} — Olive`, description: t('profile:subtitle') });
  
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const { signOut } = useClerk();

  const handleSignOut = async () => {
    await signOut();
    navigate(getLocalizedPath('/landing'));
  };

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center atmosphere-bg">
        <div className="icon-squircle w-24 h-24 mb-6">
          <User className="h-12 w-12 text-primary" />
        </div>
        <h2 className="text-3xl font-serif font-bold text-[#2A3C24] mb-3">{t('profile:title')}</h2>
        <p className="text-stone-500 mb-8 max-w-xs">{t('profile:signInToManage')}</p>
        <Button 
          onClick={() => navigate(getLocalizedPath('/sign-in'))} 
          size="lg"
          className="rounded-full px-8"
        >
          {t('common:buttons.signIn')}
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background atmosphere-bg">
      <div className="px-4 py-8 space-y-5 max-w-2xl mx-auto relative z-10 pb-32">
        {/* Profile Header - Glassmorphic */}
        <div className="card-elevated p-8 text-center animate-fade-up">
          <div className="relative inline-block mb-4">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary/20 via-[hsl(var(--magic-accent))]/20 to-primary/10 flex items-center justify-center shadow-lg">
              <User className="h-12 w-12 text-primary" />
            </div>
            {/* Status indicator */}
            <div className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-[hsl(var(--success))] border-2 border-white shadow-md" />
          </div>
          <h1 className="text-2xl font-serif font-bold text-[#2A3C24] mb-1">
            {user?.firstName || user?.fullName || 'Profile'}
          </h1>
          <p className="text-sm text-stone-500">
            {user?.primaryEmailAddress?.emailAddress}
          </p>
        </div>

        {/* Partner Connection */}
        <SettingsCard
          icon={<Users className="h-5 w-5 text-primary" />}
          iconBg="bg-primary/10"
          title={t('profile:partnerConnection')}
          delay={50}
        >
          <PartnerInfo />
        </SettingsCard>

        {/* Language */}
        <SettingsCard
          icon={<Globe className="h-5 w-5 text-blue-500" />}
          iconBg="bg-blue-500/10"
          title={t('common:language.title')}
          delay={75}
        >
          <LanguageSwitcher />
        </SettingsCard>

        {/* Timezone */}
        <SettingsCard
          icon={<Clock className="h-5 w-5 text-amber-600" />}
          iconBg="bg-amber-500/10"
          title={t('profile:timezone')}
          delay={100}
        >
          <TimezoneField />
        </SettingsCard>

        {/* Phone Number */}
        <SettingsCard
          icon={<span className="text-lg">📱</span>}
          iconBg="bg-[hsl(var(--success))]/10"
          title={t('profile:whatsappNotifications')}
          delay={150}
        >
          <PhoneNumberField />
        </SettingsCard>

        {/* WhatsApp AI Link */}
        <SettingsCard
          icon={<MessageSquare className="h-5 w-5 text-[hsl(var(--success))]" />}
          iconBg="bg-[hsl(var(--success))]/10"
          title={t('profile:whatsappAssistant')}
          delay={200}
        >
          <WhatsAppLink />
        </SettingsCard>

        {/* Google Calendar */}
        <SettingsCard
          icon={<Calendar className="h-5 w-5 text-[hsl(var(--accent))]" />}
          iconBg="bg-[hsl(var(--accent))]/10"
          title={t('profile:googleCalendar.title')}
          subtitle={t('profile:googleCalendar.subtitle')}
          delay={250}
        >
          <GoogleCalendarConnect />
        </SettingsCard>

        {/* Note Processing Style */}
        <SettingsCard
          icon={<Brain className="h-5 w-5 text-primary" />}
          iconBg="bg-primary/10"
          title={t('profile:noteProcessingStyle')}
          delay={300}
        >
          <NoteStyleField />
        </SettingsCard>

        {/* Memory & Personalization */}
        <SettingsCard
          icon={<Sparkles className="h-5 w-5 text-[hsl(var(--magic-accent))]" />}
          iconBg="bg-[hsl(var(--magic-accent))]/10"
          title={t('profile:memoryPersonalization.title')}
          subtitle={t('profile:memoryPersonalization.subtitle')}
          delay={350}
        >
          <MemoryPersonalization />
        </SettingsCard>

        {/* Data Export */}
        <SettingsCard
          icon={<Download className="h-5 w-5 text-blue-600" />}
          iconBg="bg-blue-500/10"
          title={t('profile:export.title')}
          subtitle={t('profile:export.subtitle')}
          delay={375}
        >
          <DataExport />
        </SettingsCard>

        {/* Settings Menu */}
        <div className="card-glass overflow-hidden animate-fade-up" style={{ animationDelay: '400ms' }}>
          <div className="px-5 pt-5 pb-2">
            <h3 className="font-serif font-semibold text-[#2A3C24] text-lg">{t('profile:settings.title')}</h3>
          </div>
          <div className="px-2 pb-2">
            <SettingsRow
              icon={<Bell className="h-5 w-5 text-stone-500" />}
              title={t('profile:settings.notifications.title')}
              subtitle={t('profile:settings.notifications.subtitle')}
            />
            <SettingsRow
              icon={<Shield className="h-5 w-5 text-stone-500" />}
              title={t('profile:settings.privacy.title')}
              subtitle={t('profile:settings.privacy.subtitle')}
            />
            <SettingsRow
              icon={<HelpCircle className="h-5 w-5 text-stone-500" />}
              title={t('profile:settings.help.title')}
              subtitle={t('profile:settings.help.subtitle')}
            />
          </div>
        </div>

        {/* Sign Out Button */}
        <div className="animate-fade-up" style={{ animationDelay: '450ms' }}>
          <Button
            variant="outline"
            className="w-full rounded-2xl h-14 border-[hsl(var(--priority-high))]/20 text-[hsl(var(--priority-high))] hover:bg-[hsl(var(--priority-high))]/5 hover:border-[hsl(var(--priority-high))]/40 transition-all duration-300"
            size="lg"
            onClick={handleSignOut}
          >
            <LogOut className="mr-2 h-5 w-5" />
            {t('common:buttons.signOut')}
          </Button>
        </div>

        {/* Version Info */}
        <div className="text-center pb-4">
          <p className="text-xs text-stone-400">{t('profile:version')}</p>
        </div>
      </div>
    </div>
  );
};

export default Profile;
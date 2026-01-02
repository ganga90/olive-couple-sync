import { useSEO } from "@/hooks/useSEO";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PartnerInfo } from "@/components/PartnerInfo";
import { PhoneNumberField } from "@/components/PhoneNumberField";
import { TimezoneField } from "@/components/TimezoneField";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { NoteStyleField } from "@/components/NoteStyleField";
import { MemoryPersonalization } from "@/components/MemoryPersonalization";
import { GoogleCalendarConnect } from "@/components/GoogleCalendarConnect";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { User, LogOut, Bell, Shield, HelpCircle, Brain, Sparkles, Calendar, ChevronRight, Globe } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { useClerk } from "@clerk/clerk-react";
import { useLanguage } from "@/providers/LanguageProvider";

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
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center animate-fade-up">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <User className="h-10 w-10 text-primary" />
        </div>
        <h2 className="text-2xl font-semibold mb-2">{t('profile:title')}</h2>
        <p className="text-muted-foreground mb-6">{t('profile:signInToManage')}</p>
        <Button onClick={() => navigate(getLocalizedPath('/sign-in'))} size="lg">{t('common:buttons.signIn')}</Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-4 py-6 space-y-5 max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center animate-fade-up">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mx-auto mb-4 shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
            <User className="h-12 w-12 text-primary" />
          </div>
          <h1 className="text-2xl font-serif font-bold text-foreground mb-1">
            {user?.firstName || user?.fullName || 'Profile'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {user?.primaryEmailAddress?.emailAddress}
          </p>
        </div>

        {/* Partner Information */}
        <Card className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-0 animate-fade-up transition-all duration-300" style={{ animationDelay: '50ms' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-serif flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                <User className="h-5 w-5 text-primary" />
              </div>
              {t('profile:partnerConnection')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PartnerInfo />
          </CardContent>
        </Card>

        {/* Language */}
        <Card className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-0 animate-fade-up transition-all duration-300" style={{ animationDelay: '75ms' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-serif flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-info/10 to-info/5 flex items-center justify-center">
                <Globe className="h-5 w-5 text-info" />
              </div>
              {t('common:language.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LanguageSwitcher />
          </CardContent>
        </Card>

        {/* Timezone */}
        <Card className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-0 animate-fade-up transition-all duration-300" style={{ animationDelay: '100ms' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-serif flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-secondary/30 to-secondary/10 flex items-center justify-center">
                🌍
              </div>
              {t('profile:timezone')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TimezoneField />
          </CardContent>
        </Card>

        {/* Phone Number */}
        <Card className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-0 animate-fade-up transition-all duration-300" style={{ animationDelay: '150ms' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-serif flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-success/10 to-success/5 flex items-center justify-center">
                📱
              </div>
              {t('profile:whatsappNotifications')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PhoneNumberField />
          </CardContent>
        </Card>

        {/* WhatsApp AI Link */}
        <Card className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-0 animate-fade-up transition-all duration-300" style={{ animationDelay: '200ms' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-serif flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-success/10 to-success/5 flex items-center justify-center">
                💬
              </div>
              {t('profile:whatsappAssistant')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <WhatsAppLink />
          </CardContent>
        </Card>

        {/* Google Calendar */}
        <Card className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-0 animate-fade-up transition-all duration-300" style={{ animationDelay: '250ms' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-serif flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-accent/10 to-accent/5 flex items-center justify-center">
                <Calendar className="h-5 w-5 text-accent" />
              </div>
              {t('profile:googleCalendar.title')}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1 ml-13">
              {t('profile:googleCalendar.subtitle')}
            </p>
          </CardHeader>
          <CardContent>
            <GoogleCalendarConnect />
          </CardContent>
        </Card>

        {/* Note Processing Style */}
        <Card className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-0 animate-fade-up transition-all duration-300" style={{ animationDelay: '300ms' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-serif flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                <Brain className="h-5 w-5 text-primary" />
              </div>
              {t('profile:noteProcessingStyle')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <NoteStyleField />
          </CardContent>
        </Card>

        {/* Memory & Personalization */}
        <Card className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-0 animate-fade-up transition-all duration-300" style={{ animationDelay: '350ms' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-serif flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-accent/10 to-accent/5 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-accent" />
              </div>
              {t('profile:memoryPersonalization.title')}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1 ml-13">
              {t('profile:memoryPersonalization.subtitle')}
            </p>
          </CardHeader>
          <CardContent>
            <MemoryPersonalization />
          </CardContent>
        </Card>

        {/* Settings Menu */}
        <Card className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-0 animate-fade-up transition-all duration-300" style={{ animationDelay: '400ms' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-serif">{t('profile:settings.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-3">
            <button className="flex items-center gap-3 w-full p-3 rounded-2xl hover:bg-muted/50 transition-all duration-300 text-left group">
              <div className="w-10 h-10 rounded-2xl bg-muted/80 flex items-center justify-center">
                <Bell className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">{t('profile:settings.notifications.title')}</p>
                <p className="text-xs text-muted-foreground">{t('profile:settings.notifications.subtitle')}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground/50 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all duration-300" />
            </button>

            <button className="flex items-center gap-3 w-full p-3 rounded-2xl hover:bg-muted/50 transition-all duration-300 text-left group">
              <div className="w-10 h-10 rounded-2xl bg-muted/80 flex items-center justify-center">
                <Shield className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">{t('profile:settings.privacy.title')}</p>
                <p className="text-xs text-muted-foreground">{t('profile:settings.privacy.subtitle')}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground/50 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all duration-300" />
            </button>

            <button className="flex items-center gap-3 w-full p-3 rounded-2xl hover:bg-muted/50 transition-all duration-300 text-left group">
              <div className="w-10 h-10 rounded-2xl bg-muted/80 flex items-center justify-center">
                <HelpCircle className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">{t('profile:settings.help.title')}</p>
                <p className="text-xs text-muted-foreground">{t('profile:settings.help.subtitle')}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground/50 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all duration-300" />
            </button>
          </CardContent>
        </Card>

        {/* Account Actions */}
        <div className="animate-fade-up" style={{ animationDelay: '450ms' }}>
          <Button
            variant="destructive"
            className="w-full rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-300 hover:shadow-lg"
            size="lg"
            onClick={handleSignOut}
          >
            <LogOut className="mr-2 h-4 w-4" />
            {t('common:buttons.signOut')}
          </Button>
        </div>

        {/* Version Info */}
        <div className="text-center pb-8">
          <p className="text-xs text-muted-foreground">{t('profile:version')}</p>
        </div>
      </div>
    </div>
  );
};

export default Profile;
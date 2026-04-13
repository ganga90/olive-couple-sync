import { useSEO } from "@/hooks/useSEO";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SpaceMembersCard as PartnerInfo } from "@/components/SpaceMembersCard";
import { NoteStyleField } from "@/components/NoteStyleField";
import { MemoryPersonalization } from "@/components/MemoryPersonalization";
import { GoogleServicesSection } from "@/components/settings/GoogleServicesSection";
import { OuraConnect } from "@/components/OuraConnect";
import { DataExport } from "@/components/DataExport";
import { RegionalFormatCard } from "@/components/settings/RegionalFormatCard";
import { WhatsAppUnifiedCard } from "@/components/settings/WhatsAppUnifiedCard";
import { AppPreferencesModals } from "@/components/settings/AppPreferencesModals";
import { OliveProactivePreferences } from "@/components/settings/OliveProactivePreferences";
import { OliveAutomationHub } from "@/components/settings/OliveAutomationHub";
import { OliveSkillsManager } from "@/components/settings/OliveSkillsManager";
import { BackgroundAgentsManager } from "@/components/settings/BackgroundAgentsManager";
import { DelegationCard } from "@/components/DelegationCard";
import { DailyBriefingView } from "@/components/DailyBriefingView";
import { TrustSettingsCard } from "@/components/settings/TrustSettingsCard";
import { TrustApprovalCard } from "@/components/settings/TrustApprovalCard";
import { EngagementScoreCard } from "@/components/settings/EngagementScoreCard";
import { ReflectionHistoryCard } from "@/components/settings/ReflectionHistoryCard";
import { DefaultPrivacyCard } from "@/components/settings/DefaultPrivacyCard";
import { ExpensePreferencesCard } from "@/components/settings/ExpensePreferencesCard";
import { MemoryHealthCard } from "@/components/settings/MemoryHealthCard";
import { SoulEvolutionSafetyCard } from "@/components/settings/SoulEvolutionSafetyCard";
import { IndustryTemplateSelector } from "@/components/settings/IndustryTemplateSelector";
import { ClientPipelineCard } from "@/components/settings/ClientPipelineCard";
import { ExpenseSplitCard } from "@/components/settings/ExpenseSplitCard";
import { DecisionLogCard } from "@/components/settings/DecisionLogCard";
import { RecurringWorkflowsCard } from "@/components/settings/RecurringWorkflowsCard";
import { SubscriptionCard } from "@/components/settings/SubscriptionCard";
import { PollCard } from "@/components/settings/PollCard";
import { ConflictCard } from "@/components/settings/ConflictCard";
import { CollapsibleSection } from "@/components/settings/CollapsibleSection";
import { User, LogOut, Brain, Sparkles, Calendar, ChevronRight, MessageSquare, Users, Download, FileText, Shield, Scale, Settings, Zap, Link2, BellRing, Puzzle, Activity, Lock, Bot, Mail, Fingerprint, Wallet, HelpCircle, Send, Newspaper, Database, ShieldCheck, Briefcase, Home, Receipt, BookOpen, BarChart3, Crown } from "lucide-react";
import { HelpFAQSection } from "@/components/settings/HelpFAQSection";
import { PasskeySettingsCard } from "@/components/settings/PasskeySettingsCard";
import { useAuth } from "@/providers/AuthProvider";
import { useClerk } from "@clerk/clerk-react";
import { useLanguage } from "@/providers/LanguageProvider";
import { useSpace } from "@/providers/SpaceProvider";
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
        <h3 className="font-serif font-semibold text-foreground text-lg">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
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
    className="flex items-center gap-4 w-full p-4 rounded-2xl hover:bg-accent/50 transition-all duration-300 text-left group"
  >
    <div className="icon-squircle w-11 h-11 bg-muted/80">
      {icon}
    </div>
    <div className="flex-1 min-w-0">
      <p className="font-medium text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
    </div>
    <ChevronRight className="h-5 w-5 text-muted-foreground/50 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all duration-200" />
  </button>
);

const Profile = () => {
  const { t } = useTranslation(['profile', 'common']);
  const { getLocalizedPath } = useLanguage();
  useSEO({ title: `${t('profile:title')} — Olive`, description: t('profile:subtitle') });
  
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const { signOut } = useClerk();
  const { currentSpace } = useSpace();

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
        <h2 className="text-3xl font-serif font-bold text-foreground mb-3">{t('profile:title')}</h2>
        <p className="text-muted-foreground mb-8 max-w-xs">{t('profile:signInToManage')}</p>
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
      <div className="px-4 py-8 max-w-2xl mx-auto relative z-10 pb-32">
        {/* Profile Header */}
        <div className="card-elevated p-8 text-center animate-fade-up mb-10">
          <div className="relative inline-block mb-4">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary/20 via-[hsl(var(--magic-accent))]/20 to-primary/10 flex items-center justify-center shadow-lg">
              <User className="h-12 w-12 text-primary" />
            </div>
            <div className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-[hsl(var(--success))] border-2 border-white shadow-md" />
          </div>
          <h1 className="text-2xl font-serif font-bold text-foreground mb-1">
            {user?.firstName || user?.fullName || 'Profile'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {user?.primaryEmailAddress?.emailAddress}
          </p>
        </div>

        {/* SECTION 1: Identity & Family */}
        <CollapsibleSection 
          title={t('profile:sections.identity', 'My Profile & Household')}
          icon={<Users className="h-3.5 w-3.5 text-muted-foreground" />}
          delay={50}
          sectionId="identity"
        >
          <SettingsCard
            icon={<Users className="h-5 w-5 text-primary" />}
            iconBg="bg-primary/10"
            title={t('profile:partnerConnection')}
          >
            <PartnerInfo />
          </SettingsCard>

          <SettingsCard
            icon={<Lock className="h-5 w-5 text-muted-foreground" />}
            iconBg="bg-muted"
            title={t('profile:defaultPrivacy.title', 'Default Privacy')}
            subtitle={t('profile:defaultPrivacy.subtitle', 'For new tasks & lists')}
          >
            <DefaultPrivacyCard />
          </SettingsCard>

          <SettingsCard
            icon={<Wallet className="h-5 w-5 text-primary" />}
            iconBg="bg-primary/10"
            title={t('expenses:preferences.title', 'Expense Tracking')}
            subtitle={t('expenses:preferences.description', 'Configure how expenses are tracked and split')}
          >
            <ExpensePreferencesCard />
          </SettingsCard>
        </CollapsibleSection>

        {/* SECTION 2: Brain & Intelligence */}
        <CollapsibleSection 
          title={t('profile:sections.intelligence', "Olive's Intelligence")}
          icon={<Zap className="h-3.5 w-3.5 text-muted-foreground" />}
          delay={100}
          sectionId="intelligence"
        >
          <SettingsCard
            icon={<Sparkles className="h-5 w-5 text-[hsl(var(--magic-accent))]" />}
            iconBg="bg-[hsl(var(--magic-accent))]/10"
            title={t('profile:memoryPersonalization.title')}
            subtitle={t('profile:memoryPersonalization.subtitle')}
          >
            <MemoryPersonalization />
          </SettingsCard>

          <SettingsCard
            icon={<Brain className="h-5 w-5 text-primary" />}
            iconBg="bg-primary/10"
            title={t('profile:noteProcessingStyle')}
          >
            <NoteStyleField />
          </SettingsCard>

          <SettingsCard
            icon={<BellRing className="h-5 w-5 text-[hsl(var(--magic-accent))]" />}
            iconBg="bg-[hsl(var(--magic-accent))]/10"
            title={t('profile:olivePreferences.title', 'Olive Proactive Settings')}
            subtitle={t('profile:olivePreferences.subtitle', 'Configure when and how Olive reaches out')}
          >
            <OliveProactivePreferences />
          </SettingsCard>

          {/* Trust & Autonomy Settings */}
          <TrustApprovalCard />

          <SettingsCard
            icon={<Shield className="h-5 w-5 text-primary" />}
            iconBg="bg-primary/10"
            title="Trust & Autonomy"
            subtitle="Control what Olive can do on her own"
          >
            <TrustSettingsCard />
          </SettingsCard>

          <SettingsCard
            icon={<Activity className="h-5 w-5 text-emerald-500" />}
            iconBg="bg-emerald-500/10"
            title="Proactivity Level"
            subtitle="How actively Olive reaches out based on your engagement"
          >
            <EngagementScoreCard />
          </SettingsCard>

          <SettingsCard
            icon={<Brain className="h-5 w-5 text-violet-500" />}
            iconBg="bg-violet-500/10"
            title="What Olive Has Learned"
            subtitle="Insights from your interactions"
          >
            <ReflectionHistoryCard />
          </SettingsCard>

          <SettingsCard
            icon={<Database className="h-5 w-5 text-cyan-500" />}
            iconBg="bg-cyan-500/10"
            title={t('profile:memoryHealth.title', 'Memory Health')}
            subtitle={t('profile:memoryHealth.subtitle', 'Storage, decay & consolidation status')}
          >
            <MemoryHealthCard />
          </SettingsCard>

          <SettingsCard
            icon={<ShieldCheck className="h-5 w-5 text-violet-600" />}
            iconBg="bg-violet-600/10"
            title={t('profile:soulSafety.title', 'Soul Evolution Safety')}
            subtitle={t('profile:soulSafety.subtitle', 'Drift detection, rollback & controls')}
          >
            <SoulEvolutionSafetyCard />
          </SettingsCard>

          <SettingsCard
            icon={<Zap className="h-5 w-5 text-primary" />}
            iconBg="bg-primary/10"
            title={t('profile:automation.title', 'Automation')}
            subtitle={t('profile:automation.subtitle', 'Skills & background agents')}
          >
            <OliveAutomationHub />
          </SettingsCard>

          <SettingsCard
            icon={<Brain className="h-5 w-5 text-[hsl(var(--magic-accent))]" />}
            iconBg="bg-[hsl(var(--magic-accent))]/10"
            title="Knowledge Graph"
            subtitle="Entities & connections extracted from your notes"
          >
            <button
              onClick={() => navigate(getLocalizedPath('/knowledge'))}
              className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-accent/50 transition-all text-left group"
            >
              <div className="flex-1">
                <p className="text-sm font-medium">View your Knowledge Graph</p>
                <p className="text-xs text-muted-foreground">People, places, and concepts extracted from your notes</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:translate-x-0.5 transition-all" />
            </button>
          </SettingsCard>

          <SettingsCard
            icon={<Send className="h-5 w-5 text-teal-500" />}
            iconBg="bg-teal-500/10"
            title={t('profile:delegation.title', 'Task Delegation')}
            subtitle={t('profile:delegation.subtitle', 'Tasks delegated to you by your team')}
          >
            <DelegationCard />
          </SettingsCard>

          <SettingsCard
            icon={<Newspaper className="h-5 w-5 text-amber-500" />}
            iconBg="bg-amber-500/10"
            title={t('profile:briefing.title', 'Daily Briefing')}
            subtitle={t('profile:briefing.subtitle', 'Your personalized daily overview')}
          >
            <DailyBriefingView />
          </SettingsCard>
        </CollapsibleSection>

        {/* ============================================ */}
        {/* SECTION 3: Business Tools (shown for business/team spaces) */}
        {/* ============================================ */}
        {currentSpace && (currentSpace.type === 'business' || (currentSpace.member_count ?? 0) > 1) && (
          <CollapsibleSection
            title={t('profile:sections.business', 'Business Tools')}
            icon={<Briefcase className="h-3.5 w-3.5 text-stone-500" />}
            delay={125}
          >
            <SettingsCard
              icon={<Home className="h-5 w-5 text-blue-500" />}
              iconBg="bg-blue-500/10"
              title={t('profile:templates.title', 'Industry Templates')}
              subtitle={t('profile:templates.subtitle', 'Pre-configured starter kits for your industry')}
            >
              <IndustryTemplateSelector />
            </SettingsCard>

            <SettingsCard
              icon={<Users className="h-5 w-5 text-emerald-500" />}
              iconBg="bg-emerald-500/10"
              title={t('profile:pipeline.title', 'Client Pipeline')}
              subtitle={t('profile:pipeline.subtitle', 'Track clients from lead to completion')}
            >
              <ClientPipelineCard />
            </SettingsCard>

            <SettingsCard
              icon={<Receipt className="h-5 w-5 text-orange-500" />}
              iconBg="bg-orange-500/10"
              title={t('profile:expenses.title', 'Expense Splitting')}
              subtitle={t('profile:expenses.subtitle', 'Split costs between team members')}
            >
              <ExpenseSplitCard />
            </SettingsCard>

            <SettingsCard
              icon={<BookOpen className="h-5 w-5 text-indigo-500" />}
              iconBg="bg-indigo-500/10"
              title={t('profile:decisions.title', 'Decision Log')}
              subtitle={t('profile:decisions.subtitle', 'Track team decisions with context')}
            >
              <DecisionLogCard />
            </SettingsCard>

            <SettingsCard
              icon={<Zap className="h-5 w-5 text-amber-500" />}
              iconBg="bg-amber-500/10"
              title={t('profile:workflows.title', 'Recurring Workflows')}
              subtitle={t('profile:workflows.subtitle', 'Automated weekly reviews, budget reports & follow-ups')}
            >
              <RecurringWorkflowsCard />
            </SettingsCard>

            <SettingsCard
              icon={<Scale className="h-5 w-5 text-red-500" />}
              iconBg="bg-red-500/10"
              title={t('profile:conflicts.title', 'Conflict Detection')}
              subtitle={t('profile:conflicts.subtitle', 'Schedule overlaps, overloads & budget issues')}
            >
              <ConflictCard />
            </SettingsCard>

            <SettingsCard
              icon={<BarChart3 className="h-5 w-5 text-violet-500" />}
              iconBg="bg-violet-500/10"
              title={t('profile:polls.title', 'Team Polls')}
              subtitle={t('profile:polls.subtitle', 'Quick decisions with your team')}
            >
              <PollCard />
            </SettingsCard>
          </CollapsibleSection>
        )}

        {/* SECTION: Integrations */}
        <CollapsibleSection 
          title={t('profile:sections.integrations', 'Connected Apps')}
          icon={<Link2 className="h-3.5 w-3.5 text-muted-foreground" />}
          delay={150}
          sectionId="integrations"
        >
          <SettingsCard
            icon={<MessageSquare className="h-5 w-5 text-[hsl(var(--success))]" />}
            iconBg="bg-[hsl(var(--success))]/10"
            title={t('profile:whatsapp.title', 'WhatsApp Connection')}
            subtitle={t('profile:whatsapp.subtitle', 'Notifications & AI chat')}
          >
            <WhatsAppUnifiedCard />
          </SettingsCard>

          <SettingsCard
            icon={<span className="text-lg">🔗</span>}
            iconBg="bg-blue-500/10"
            title={t('profile:googleServices.title', 'Google Services')}
            subtitle={t('profile:googleServices.subtitle', 'Calendar, Tasks & Gmail')}
          >
            <GoogleServicesSection />
          </SettingsCard>

          <div data-integration="oura">
            <SettingsCard
              icon={<Activity className="h-5 w-5 text-primary" />}
              iconBg="bg-primary/10"
              title={t('profile:oura.title', 'Oura Ring')}
              subtitle={t('profile:oura.subtitle', 'Sleep, readiness & activity data')}
            >
              <OuraConnect />
            </SettingsCard>
          </div>

          <SettingsCard
            icon={<Download className="h-5 w-5 text-blue-600" />}
            iconBg="bg-blue-500/10"
            title={t('profile:export.title')}
            subtitle={t('profile:export.subtitle')}
          >
            <DataExport />
          </SettingsCard>
        </CollapsibleSection>

        {/* SECTION: Help & FAQ */}
        <CollapsibleSection 
          title={t('profile:sections.help', 'Help & FAQ')}
          icon={<HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />}
          delay={175}
          sectionId="help"
        >
          <SettingsCard
            icon={<HelpCircle className="h-5 w-5 text-primary" />}
            iconBg="bg-primary/10"
            title={t('profile:help.faq', 'Frequently Asked Questions')}
            subtitle={t('profile:help.faqDesc', 'Find answers to common questions about Olive.')}
          >
            <HelpFAQSection />
          </SettingsCard>
        </CollapsibleSection>

        {/* SECTION: System & Legal */}
        <CollapsibleSection
          title={t('profile:sections.system', 'System')}
          icon={<Settings className="h-3.5 w-3.5 text-muted-foreground" />}
          delay={200}
          sectionId="system"
        >
          <SettingsCard
            icon={<Crown className="h-5 w-5 text-amber-500" />}
            iconBg="bg-amber-500/10"
            title={t('profile:subscription.title', 'Subscription & Usage')}
            subtitle={t('profile:subscription.subtitle', 'Your plan, limits & billing')}
          >
            <SubscriptionCard />
          </SettingsCard>

          <SettingsCard
            icon={<span className="text-lg">🌍</span>}
            iconBg="bg-blue-500/10"
            title={t('profile:regional.title', 'Regional Format')}
            subtitle={t('profile:regional.subtitle', 'Language & timezone settings')}
          >
            <RegionalFormatCard />
          </SettingsCard>

          <SettingsCard
            icon={<Fingerprint className="h-5 w-5 text-primary" />}
            iconBg="bg-primary/10"
            title={t('auth:passkey.settingsTitle', 'Passkey')}
            subtitle={t('auth:passkey.settingsSubtitle', 'Sign in faster with biometrics')}
          >
            <PasskeySettingsCard />
          </SettingsCard>

          <SettingsCard
            icon={<Settings className="h-5 w-5 text-muted-foreground" />}
            iconBg="bg-muted"
            title={t('profile:appPreferences.title', 'App Preferences')}
            subtitle={t('profile:appPreferences.subtitle', 'Notifications, privacy & more')}
          >
            <AppPreferencesModals />
          </SettingsCard>

          <div className="card-glass overflow-hidden">
            <div className="px-5 pt-5 pb-2">
              <h3 className="font-serif font-semibold text-foreground text-lg">{t('profile:legal.title', 'Legal & Support')}</h3>
            </div>
            <div className="px-2 pb-2">
              <SettingsRow
                icon={<FileText className="h-5 w-5 text-muted-foreground" />}
                title={t('profile:legal.terms', 'Terms of Service')}
                subtitle={t('profile:legal.termsSubtitle', 'Read our terms and conditions')}
                onClick={() => navigate(getLocalizedPath('/legal/terms'))}
              />
              <SettingsRow
                icon={<Shield className="h-5 w-5 text-muted-foreground" />}
                title={t('profile:legal.privacy', 'Privacy Policy')}
                subtitle={t('profile:legal.privacySubtitle', 'How we handle your data')}
                onClick={() => navigate(getLocalizedPath('/legal/privacy'))}
              />
              <SettingsRow
                icon={<Scale className="h-5 w-5 text-muted-foreground" />}
                title={t('profile:legal.licenses', 'Third-Party Licenses')}
                subtitle={t('profile:legal.licensesSubtitle', 'Open source attributions')}
              />
            </div>
          </div>

          <div className="pt-4">
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
        </CollapsibleSection>

        {/* Version Info */}
        <div className="text-center pb-4">
          <p className="text-xs text-muted-foreground/60">{t('profile:version')}</p>
        </div>
      </div>
    </div>
  );
};

export default Profile;

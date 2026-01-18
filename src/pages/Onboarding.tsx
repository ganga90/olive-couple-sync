import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useSEO } from "@/hooks/useSEO";
import { OliveLogo } from "@/components/OliveLogo";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useAuth } from "@/providers/AuthProvider";
import { supabase } from "@/lib/supabaseClient";
import { 
  Users, 
  ArrowRight, 
  ArrowLeft,
  MessageCircle,
  Calendar,
  Sparkles,
  Brain,
  MessageSquare,
  Bell,
  Send,
  Loader2,
  Share2,
  Check,
  ExternalLink
} from "lucide-react";
import { cn } from "@/lib/utils";

// Onboarding step types
type OnboardingStep = 
  | "couple" 
  | "whatsapp" 
  | "calendar" 
  | "style" 
  | "notifications" 
  | "demo";

type NoteStyle = 'auto' | 'succinct' | 'conversational';

// Local storage key for onboarding state
const ONBOARDING_STATE_KEY = 'olive_onboarding_state';

interface OnboardingState {
  currentStep: OnboardingStep;
  coupleSetup: 'invite' | 'solo' | null;
  partnerName: string;
  userName: string;
  noteStyle: NoteStyle;
  completedSteps: OnboardingStep[];
}

const defaultState: OnboardingState = {
  currentStep: 'couple',
  coupleSetup: null,
  partnerName: '',
  userName: '',
  noteStyle: 'auto',
  completedSteps: [],
};

const STEPS_ORDER: OnboardingStep[] = ['couple', 'whatsapp', 'calendar', 'style', 'notifications', 'demo'];

const Onboarding = () => {
  const { t } = useTranslation('onboarding');
  const getLocalizedPath = useLocalizedHref();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { createCouple, currentCouple } = useSupabaseCouple();
  
  // State
  const [state, setState] = useState<OnboardingState>(() => {
    try {
      const saved = localStorage.getItem(ONBOARDING_STATE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...defaultState, ...parsed };
      }
    } catch {}
    return defaultState;
  });
  
  const [isAnimating, setIsAnimating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');
  const [demoText, setDemoText] = useState('');
  const [isProcessingDemo, setIsProcessingDemo] = useState(false);
  
  useSEO({ 
    title: "Get Started — Olive", 
    description: t('personalizeExperience')
  });

  // Persist state
  useEffect(() => {
    localStorage.setItem(ONBOARDING_STATE_KEY, JSON.stringify(state));
  }, [state]);

  // Step navigation helpers
  const currentStepIndex = STEPS_ORDER.indexOf(state.currentStep);
  const progress = ((currentStepIndex + 1) / STEPS_ORDER.length) * 100;

  const goToStep = (step: OnboardingStep) => {
    setIsAnimating(true);
    setTimeout(() => {
      setState(prev => ({ ...prev, currentStep: step }));
      setIsAnimating(false);
    }, 150);
  };

  const goToNextStep = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEPS_ORDER.length) {
      setState(prev => ({
        ...prev,
        completedSteps: [...new Set([...prev.completedSteps, state.currentStep])],
      }));
      goToStep(STEPS_ORDER[nextIndex]);
    }
  };

  const goToPrevStep = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      goToStep(STEPS_ORDER[prevIndex]);
    }
  };

  // Step handlers
  const handleInvitePartner = async () => {
    if (!state.partnerName.trim()) {
      toast.error("Please enter your partner's name");
      return;
    }
    
    setLoading(true);
    try {
      // Create couple
      const couple = await createCouple({
        title: `${state.userName} & ${state.partnerName}`,
        you_name: state.userName,
        partner_name: state.partnerName,
      });

      if (couple) {
        // Create invite
        const { data: inviteData, error } = await supabase.rpc('create_invite', {
          p_couple_id: couple.id,
        });

        if (!error && inviteData?.token) {
          const link = `${window.location.origin}/accept-invite?token=${inviteData.token}`;
          setInviteUrl(link);
          
          // Try native share
          if (navigator.share) {
            try {
              await navigator.share({
                title: 'Join me on Olive',
                text: `${state.userName} invited you to share an Olive space together! 🫒`,
                url: link,
              });
            } catch {
              // User cancelled or share failed, show link
            }
          }
          
          setState(prev => ({ ...prev, coupleSetup: 'invite' }));
        }
      }
      
      goToNextStep();
    } catch (error) {
      console.error('Failed to create invite:', error);
      toast.error("Couldn't create invite. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSetupSolo = async () => {
    setLoading(true);
    try {
      await createCouple({
        title: `${state.userName || 'My'} Space`,
        you_name: state.userName,
        partner_name: '',
      });
      setState(prev => ({ ...prev, coupleSetup: 'solo' }));
      goToNextStep();
    } catch (error) {
      console.error('Failed to create space:', error);
      goToNextStep(); // Continue anyway
    } finally {
      setLoading(false);
    }
  };

  const handleConnectWhatsApp = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('generate-whatsapp-link', {
        body: {}
      });

      if (!error && data?.whatsappLink) {
        window.open(data.whatsappLink, '_blank');
      }
    } catch (error) {
      console.error('Failed to generate WhatsApp link:', error);
    }
    goToNextStep();
  };

  const handleConnectCalendar = async () => {
    if (!user?.id) {
      goToNextStep();
      return;
    }
    
    setLoading(true);
    try {
      const origin = window.location.origin;
      const { data, error } = await supabase.functions.invoke('calendar-auth-url', {
        body: { user_id: user.id, redirect_origin: origin }
      });

      if (!error && data?.auth_url) {
        // Save state before redirect
        localStorage.setItem(ONBOARDING_STATE_KEY, JSON.stringify({
          ...state,
          currentStep: 'style',
          completedSteps: [...new Set([...state.completedSteps, 'calendar'])],
        }));
        window.location.href = data.auth_url;
        return;
      }
    } catch (error) {
      console.error('Failed to start calendar connection:', error);
    }
    setLoading(false);
    goToNextStep();
  };

  const handleStyleSelect = async (style: NoteStyle) => {
    setState(prev => ({ ...prev, noteStyle: style }));
    
    if (user?.id) {
      try {
        await supabase
          .from('clerk_profiles')
          .update({ note_style: style, updated_at: new Date().toISOString() })
          .eq('id', user.id);
      } catch (error) {
        console.error('Failed to save style:', error);
      }
    }
    
    goToNextStep();
  };

  const handleRequestNotifications = async () => {
    if ('Notification' in window) {
      try {
        await Notification.requestPermission();
      } catch (error) {
        console.error('Notification permission error:', error);
      }
    }
    goToNextStep();
  };

  const handleDemoSubmit = async () => {
    if (!demoText.trim()) return;
    
    setIsProcessingDemo(true);
    try {
      // Use the process-note edge function to process the demo text
      const { data, error } = await supabase.functions.invoke('process-note', {
        body: {
          text: demoText.trim(),
          couple_id: currentCouple?.id || null,
        }
      });

      if (error) {
        console.error('Failed to process note:', error);
        throw error;
      }

      toast.success("Your first task is ready! 🎉");
      
      // Clear onboarding state
      localStorage.removeItem(ONBOARDING_STATE_KEY);
      
      // Navigate to home
      navigate(getLocalizedPath("/home"));
    } catch (error) {
      console.error('Failed to add note:', error);
      toast.error("Something went wrong. Let's try again.");
    } finally {
      setIsProcessingDemo(false);
    }
  };

  const handleDemoChip = (text: string) => {
    setDemoText(text);
  };

  const handleComplete = () => {
    localStorage.removeItem(ONBOARDING_STATE_KEY);
    navigate(getLocalizedPath("/home"));
  };

  // Suggestion chips for demo
  const demoChips = [
    t('demo.chip1', { defaultValue: "Remind me to call Mom tomorrow at 5pm" }),
    t('demo.chip2', { defaultValue: "Add milk, eggs, and bread to grocery list" }),
    t('demo.chip3', { defaultValue: "Dinner with Sarah next Friday at 7pm" }),
  ];

  return (
    <main className="min-h-screen bg-gradient-hero flex flex-col">
      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between">
        {currentStepIndex > 0 ? (
          <Button variant="ghost" size="icon" onClick={goToPrevStep} disabled={isAnimating}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
        ) : (
          <div className="w-10" />
        )}
        
        {/* Progress bar */}
        <div className="flex-1 max-w-[240px] mx-4">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-center mt-1">
            {currentStepIndex + 1} / {STEPS_ORDER.length}
          </p>
        </div>
        
        <div className="w-10" />
      </header>

      {/* Content */}
      <section className={cn(
        "flex-1 flex flex-col items-center justify-center px-6 py-8 transition-all duration-300",
        isAnimating ? "opacity-0 translate-x-8" : "opacity-100 translate-x-0"
      )}>
        {/* Step 1: Couple Space Setup */}
        {state.currentStep === 'couple' && (
          <div className="w-full max-w-md animate-fade-up space-y-6">
            {/* Logo */}
            <div className="flex justify-center mb-2">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 shadow-card border border-primary/20">
                <OliveLogo size={32} />
              </div>
            </div>
            
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground">
                {t('couple.header', { defaultValue: "Two is better than one." })}
              </h1>
              <p className="text-muted-foreground">
                {t('couple.subtext', { defaultValue: "Olive works best when you manage your household together. Invite your partner to share lists, calendars, and tasks." })}
              </p>
            </div>

            {/* Visual: Two avatars connecting */}
            <div className="flex justify-center py-6">
              <div className="relative flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center border-2 border-primary/30">
                  <Users className="w-8 h-8 text-primary" />
                </div>
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-primary/40 animate-pulse" />
                  <div className="w-2 h-2 rounded-full bg-primary/60 animate-pulse delay-100" />
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse delay-200" />
                </div>
                <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center border-2 border-accent/30">
                  <Users className="w-8 h-8 text-accent" />
                </div>
              </div>
            </div>

            {/* Name inputs */}
            <Card className="p-5 bg-card/80 border-border/50 shadow-card space-y-4">
              <div className="space-y-2">
                <Label htmlFor="your-name" className="text-foreground font-medium">
                  {t('yourName', { defaultValue: "Your name" })}
                </Label>
                <Input
                  id="your-name"
                  value={state.userName}
                  onChange={(e) => setState(prev => ({ ...prev, userName: e.target.value }))}
                  placeholder={t('namePlaceholder', { defaultValue: "e.g., Alex" })}
                  className="h-12 text-base"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="partner-name" className="text-foreground font-medium">
                  {t('partnerName', { defaultValue: "Partner's name" })}
                </Label>
                <Input
                  id="partner-name"
                  value={state.partnerName}
                  onChange={(e) => setState(prev => ({ ...prev, partnerName: e.target.value }))}
                  placeholder={t('partnerPlaceholder', { defaultValue: "e.g., Sam" })}
                  className="h-12 text-base"
                />
              </div>
            </Card>

            {/* Actions */}
            <div className="space-y-3">
              <Button 
                onClick={handleInvitePartner}
                className="w-full h-12 text-base group"
                disabled={loading || !state.userName.trim()}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Share2 className="w-4 h-4 mr-2" />
                )}
                {t('couple.inviteButton', { defaultValue: "Invite Partner" })}
                <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
              </Button>
              
              <button 
                onClick={handleSetupSolo}
                disabled={loading}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('couple.skipText', { defaultValue: "I'll do this later" })}
              </button>
            </div>

            {/* Show invite URL if generated */}
            {inviteUrl && (
              <div className="p-3 bg-primary/5 rounded-lg border border-primary/20 space-y-2">
                <p className="text-sm text-foreground font-medium flex items-center gap-2">
                  <Check className="w-4 h-4 text-primary" />
                  Invite link created!
                </p>
                <div className="flex gap-2">
                  <input
                    value={inviteUrl}
                    readOnly
                    className="flex-1 text-xs bg-background p-2 rounded border truncate"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(inviteUrl);
                      toast.success("Copied!");
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: WhatsApp Bridge */}
        {state.currentStep === 'whatsapp' && (
          <div className="w-full max-w-md animate-fade-up space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground">
                {t('whatsapp.header', { defaultValue: "Your personal assistant, right in WhatsApp." })}
              </h1>
              <p className="text-muted-foreground">
                {t('whatsapp.subtext', { defaultValue: "Don't open the app every time. Just text Olive to add groceries, reminders, or events." })}
              </p>
            </div>

            {/* Visual: Olive + WhatsApp */}
            <div className="flex justify-center py-8">
              <div className="relative flex items-center gap-6">
                <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
                  <OliveLogo size={40} />
                </div>
                <div className="flex items-center">
                  <div className="w-12 h-0.5 bg-gradient-to-r from-primary to-green-500" />
                  <ArrowRight className="w-5 h-5 text-green-500" />
                </div>
                <div className="w-20 h-20 rounded-2xl bg-green-500/10 flex items-center justify-center border border-green-500/20">
                  <MessageCircle className="w-10 h-10 text-green-500" />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <Button 
                onClick={handleConnectWhatsApp}
                className="w-full h-12 text-base bg-green-600 hover:bg-green-700 group"
              >
                <MessageCircle className="w-4 h-4 mr-2" />
                {t('whatsapp.connectButton', { defaultValue: "Connect WhatsApp" })}
                <ExternalLink className="w-4 h-4 ml-2" />
              </Button>
              
              <button 
                onClick={goToNextStep}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('skip', { defaultValue: "Skip for now" })}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Calendar Sync */}
        {state.currentStep === 'calendar' && (
          <div className="w-full max-w-md animate-fade-up space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground">
                {t('calendar.header', { defaultValue: "See your whole week at a glance." })}
              </h1>
              <p className="text-muted-foreground">
                {t('calendar.subtext', { defaultValue: "Sync your Google Calendar to let Olive organize your schedule alongside your tasks." })}
              </p>
            </div>

            {/* Visual: Calendar graphic */}
            <div className="flex justify-center py-6">
              <div className="w-48 h-48 rounded-2xl bg-card border border-border shadow-card overflow-hidden">
                <div className="h-8 bg-primary flex items-center justify-center">
                  <span className="text-sm font-medium text-primary-foreground">January 2026</span>
                </div>
                <div className="p-3 grid grid-cols-7 gap-1 text-xs text-center">
                  {['S','M','T','W','T','F','S'].map((d, i) => (
                    <span key={i} className="text-muted-foreground font-medium">{d}</span>
                  ))}
                  {Array.from({ length: 31 }, (_, i) => (
                    <span 
                      key={i} 
                      className={cn(
                        "w-5 h-5 flex items-center justify-center rounded-full text-foreground/70",
                        i === 17 && "bg-primary text-primary-foreground font-medium",
                        [5, 12, 19, 26].includes(i) && "bg-accent/20 text-accent"
                      )}
                    >
                      {i + 1}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <Button 
                onClick={handleConnectCalendar}
                className="w-full h-12 text-base group"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Calendar className="w-4 h-4 mr-2" />
                )}
                {t('calendar.connectButton', { defaultValue: "Connect Google Calendar" })}
                <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
              </Button>
              
              <button 
                onClick={goToNextStep}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('skip', { defaultValue: "Skip" })}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: AI Personalization (Note Style) */}
        {state.currentStep === 'style' && (
          <div className="w-full max-w-md animate-fade-up space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground">
                {t('style.header', { defaultValue: "How do you take notes?" })}
              </h1>
              <p className="text-muted-foreground">
                {t('style.subtext', { defaultValue: "Olive adapts to your writing style." })}
              </p>
            </div>

            {/* Style selection cards */}
            <RadioGroup
              value={state.noteStyle}
              onValueChange={(value) => setState(prev => ({ ...prev, noteStyle: value as NoteStyle }))}
              className="space-y-3"
            >
              {/* Auto-detect */}
              <Card 
                className={cn(
                  "p-4 cursor-pointer transition-all border-2",
                  state.noteStyle === 'auto' ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                )}
                onClick={() => setState(prev => ({ ...prev, noteStyle: 'auto' }))}
              >
                <div className="flex items-start gap-3">
                  <RadioGroupItem value="auto" id="style-auto" className="mt-1" />
                  <Label htmlFor="style-auto" className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Sparkles className="w-4 h-4 text-primary" />
                      </div>
                      <span className="font-semibold text-foreground">
                        {t('style.auto.title', { defaultValue: "Auto-detect" })}
                      </span>
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                        {t('style.auto.recommended', { defaultValue: "Recommended" })}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t('style.auto.description', { defaultValue: "Olive automatically detects if you're using quick brain-dumps or conversational messages." })}
                    </p>
                  </Label>
                </div>
              </Card>

              {/* Brain-dump */}
              <Card 
                className={cn(
                  "p-4 cursor-pointer transition-all border-2",
                  state.noteStyle === 'succinct' ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                )}
                onClick={() => setState(prev => ({ ...prev, noteStyle: 'succinct' }))}
              >
                <div className="flex items-start gap-3">
                  <RadioGroupItem value="succinct" id="style-succinct" className="mt-1" />
                  <Label htmlFor="style-succinct" className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Brain className="w-4 h-4 text-primary" />
                      </div>
                      <span className="font-semibold text-foreground">
                        {t('style.succinct.title', { defaultValue: "Brain-dump style" })}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t('style.succinct.description', { defaultValue: "Quick, keyword-focused notes." })}
                    </p>
                  </Label>
                </div>
              </Card>

              {/* Conversational */}
              <Card 
                className={cn(
                  "p-4 cursor-pointer transition-all border-2",
                  state.noteStyle === 'conversational' ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                )}
                onClick={() => setState(prev => ({ ...prev, noteStyle: 'conversational' }))}
              >
                <div className="flex items-start gap-3">
                  <RadioGroupItem value="conversational" id="style-conversational" className="mt-1" />
                  <Label htmlFor="style-conversational" className="flex-1 cursor-pointer">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <MessageSquare className="w-4 h-4 text-primary" />
                      </div>
                      <span className="font-semibold text-foreground">
                        {t('style.conversational.title', { defaultValue: "Conversational style" })}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t('style.conversational.description', { defaultValue: "Natural messages like you're texting a friend." })}
                    </p>
                  </Label>
                </div>
              </Card>
            </RadioGroup>

            {/* Action */}
            <Button 
              onClick={() => handleStyleSelect(state.noteStyle)}
              className="w-full h-12 text-base group"
            >
              {t('buttons.continue', { ns: 'common', defaultValue: "Continue" })}
              <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>
        )}

        {/* Step 5: Notification Permissions */}
        {state.currentStep === 'notifications' && (
          <div className="w-full max-w-md animate-fade-up space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground">
                {t('notifications.header', { defaultValue: "Never miss a moment." })}
              </h1>
              <p className="text-muted-foreground">
                {t('notifications.subtext', { defaultValue: "Olive needs permission to send you reminders for the tasks and events you add." })}
              </p>
            </div>

            {/* Visual: Notification mockup */}
            <div className="flex justify-center py-6">
              <div className="w-72 bg-card border border-border rounded-2xl shadow-elevated overflow-hidden">
                <div className="p-4 border-b border-border flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Bell className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">Olive Reminder</p>
                    <p className="text-xs text-muted-foreground">just now</p>
                  </div>
                </div>
                <div className="p-4">
                  <p className="text-sm text-foreground">
                    {t('notifications.mockup', { defaultValue: "📅 Confirm Thai Massage tomorrow at 2 PM" })}
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <Button 
                onClick={handleRequestNotifications}
                className="w-full h-12 text-base group"
              >
                <Bell className="w-4 h-4 mr-2" />
                {t('notifications.enableButton', { defaultValue: "Enable Notifications" })}
                <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
              </Button>
              
              <button 
                onClick={goToNextStep}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('maybeLater', { defaultValue: "Maybe later" })}
              </button>
            </div>
          </div>
        )}

        {/* Step 6: Demo - First Action */}
        {state.currentStep === 'demo' && (
          <div className="w-full max-w-md animate-fade-up space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground">
                {t('demo.header', { defaultValue: "Let's try it out." })}
              </h1>
              <p className="text-muted-foreground">
                {t('demo.subtext', { defaultValue: "Drop a raw thought below, and watch Olive organize it for you." })}
              </p>
            </div>

            {/* Suggestion chips */}
            <div className="flex flex-wrap gap-2 justify-center">
              {demoChips.map((chip, index) => (
                <button
                  key={index}
                  onClick={() => handleDemoChip(chip)}
                  className={cn(
                    "px-3 py-1.5 text-xs rounded-full border transition-all",
                    demoText === chip 
                      ? "bg-primary/10 border-primary text-primary" 
                      : "bg-card border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  )}
                >
                  {chip}
                </button>
              ))}
            </div>

            {/* Input area */}
            <Card className="p-4 bg-card/80 border-border/50 shadow-card">
              <Textarea
                value={demoText}
                onChange={(e) => setDemoText(e.target.value)}
                placeholder={t('demo.placeholder', { defaultValue: "What's on your mind?" })}
                className="min-h-[120px] border-0 focus-visible:ring-0 resize-none text-base p-0 shadow-none"
                disabled={isProcessingDemo}
              />
              
              <div className="flex justify-end mt-3">
                <Button
                  onClick={handleDemoSubmit}
                  disabled={!demoText.trim() || isProcessingDemo}
                  className="group"
                >
                  {isProcessingDemo ? (
                    <>
                      <Sparkles className="w-4 h-4 mr-2 animate-spin" />
                      {t('demo.processing', { defaultValue: "Organizing..." })}
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      {t('demo.submit', { defaultValue: "Send to Olive" })}
                    </>
                  )}
                </Button>
              </div>
            </Card>

            {/* Skip to home */}
            <button 
              onClick={handleComplete}
              className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('demo.skipToHome', { defaultValue: "Skip and go to Home" })}
            </button>
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="px-6 py-4 text-center">
        <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
          <Sparkles className="w-3 h-3" />
          {t('dataSecure', { defaultValue: "Your data is encrypted and secure" })}
        </p>
      </footer>
    </main>
  );
};

export default Onboarding;

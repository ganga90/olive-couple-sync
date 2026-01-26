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
  ExternalLink,
  Home,
  Briefcase,
  GraduationCap,
  Heart,
  Dog,
  Cat,
  Baby,
  Leaf,
  User,
  Users2,
  House,
  Globe,
  Languages,
  MapPin
} from "lucide-react";
import { LANGUAGES } from "@/lib/i18n/languages";
import { cn } from "@/lib/utils";

// Onboarding step types - quiz is now the first step
type OnboardingStep = 
  | "quiz"
  | "regional"
  | "couple" 
  | "whatsapp" 
  | "calendar" 
  | "style" 
  | "notifications" 
  | "demo";

type NoteStyle = 'auto' | 'succinct' | 'conversational';

// Quiz state types
interface QuizAnswers {
  scope: string | null;
  mentalLoad: string[];
  household: string[];
  diet: string | null;
}

// Local storage key for onboarding state
const ONBOARDING_STATE_KEY = 'olive_onboarding_state';

interface OnboardingState {
  currentStep: OnboardingStep;
  coupleSetup: 'invite' | 'solo' | null;
  partnerName: string;
  userName: string;
  noteStyle: NoteStyle;
  completedSteps: OnboardingStep[];
  quizStep: number;
  quizAnswers: QuizAnswers;
}

const defaultQuizAnswers: QuizAnswers = {
  scope: null,
  mentalLoad: [],
  household: [],
  diet: null,
};

const defaultState: OnboardingState = {
  currentStep: 'quiz',
  coupleSetup: null,
  partnerName: '',
  userName: '',
  noteStyle: 'auto',
  completedSteps: [],
  quizStep: 0,
  quizAnswers: defaultQuizAnswers,
};

const STEPS_ORDER: OnboardingStep[] = ['quiz', 'regional', 'couple', 'whatsapp', 'calendar', 'style', 'notifications', 'demo'];

// Common timezones for selection
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
const QUIZ_TOTAL_STEPS = 4;

const Onboarding = () => {
  const { t, i18n } = useTranslation('onboarding');
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
        return { ...defaultState, ...parsed, quizAnswers: { ...defaultQuizAnswers, ...parsed.quizAnswers } };
      }
    } catch {}
    return defaultState;
  });
  
  const [isAnimating, setIsAnimating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');
  const [demoText, setDemoText] = useState('');
  const [isProcessingDemo, setIsProcessingDemo] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  
  // Regional settings state - auto-detect on mount
  const [detectedTimezone, setDetectedTimezone] = useState<string>('');
  const [detectedLanguage, setDetectedLanguage] = useState<string>('');
  const [selectedTimezone, setSelectedTimezone] = useState<string>('');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('');
  const [hasAutoDetected, setHasAutoDetected] = useState(false);
  
  // Auto-detect timezone and language on mount
  useEffect(() => {
    if (hasAutoDetected) return;
    
    // Detect timezone
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const matchedTimezone = TIMEZONES.find(tz => tz.value === browserTimezone);
    const tzToUse = matchedTimezone ? browserTimezone : 'America/New_York';
    setDetectedTimezone(tzToUse);
    setSelectedTimezone(tzToUse);
    
    // Detect language from browser
    const browserLang = navigator.language || 'en';
    let detectedLang = 'en';
    
    if (browserLang.startsWith('es')) {
      detectedLang = 'es-ES';
    } else if (browserLang.startsWith('it')) {
      detectedLang = 'it-IT';
    } else {
      detectedLang = 'en';
    }
    
    setDetectedLanguage(detectedLang);
    setSelectedLanguage(detectedLang);
    setHasAutoDetected(true);
  }, [hasAutoDetected]);
  
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
  const totalSteps = STEPS_ORDER.length;
  
  // For the quiz, progress is based on quiz substeps; for other steps, use main step index
  const progress = state.currentStep === 'quiz' 
    ? ((state.quizStep + 1) / (QUIZ_TOTAL_STEPS + totalSteps - 1)) * 100
    : ((QUIZ_TOTAL_STEPS + currentStepIndex) / (QUIZ_TOTAL_STEPS + totalSteps - 1)) * 100;

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
    // If in quiz and not on first quiz step, go back in quiz
    if (state.currentStep === 'quiz' && state.quizStep > 0) {
      setState(prev => ({ ...prev, quizStep: prev.quizStep - 1 }));
      return;
    }
    
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      goToStep(STEPS_ORDER[prevIndex]);
    }
  };

  // Quiz navigation
  const goToNextQuizStep = () => {
    if (state.quizStep < QUIZ_TOTAL_STEPS - 1) {
      setIsAnimating(true);
      setTimeout(() => {
        setState(prev => ({ ...prev, quizStep: prev.quizStep + 1 }));
        setIsAnimating(false);
      }, 150);
    } else {
      // Finish quiz - synthesize and save memory
      handleQuizComplete();
    }
  };

  const goToPrevQuizStep = () => {
    if (state.quizStep > 0) {
      setIsAnimating(true);
      setTimeout(() => {
        setState(prev => ({ ...prev, quizStep: prev.quizStep - 1 }));
        setIsAnimating(false);
      }, 150);
    }
  };

  // Quiz answer handlers
  const setQuizAnswer = (key: keyof QuizAnswers, value: string | string[] | null) => {
    setState(prev => ({
      ...prev,
      quizAnswers: { ...prev.quizAnswers, [key]: value }
    }));
  };

  const toggleMultiSelect = (key: 'mentalLoad' | 'household', value: string) => {
    setState(prev => {
      const current = prev.quizAnswers[key];
      const updated = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      return {
        ...prev,
        quizAnswers: { ...prev.quizAnswers, [key]: updated }
      };
    });
  };

  // Memory synthesis function
  const synthesizeProfileMemory = (answers: QuizAnswers): string => {
    const parts: string[] = [];

    // Scope
    if (answers.scope) {
      parts.push(`The user is organizing for ${answers.scope}.`);
    }

    // Mental load
    if (answers.mentalLoad.length > 0) {
      parts.push(`Their primary focus areas are ${answers.mentalLoad.join(', ')}.`);
    }

    // Household entities
    if (answers.household.length > 0) {
      parts.push(`The household includes ${answers.household.join(', ')}.`);
    }

    // Diet
    if (answers.diet && answers.diet !== 'Anything goes') {
      parts.push(`The user follows a ${answers.diet} diet.`);
    }

    return parts.join(' ');
  };

  // Handle quiz completion
  const handleQuizComplete = async () => {
    if (!user?.id) {
      goToNextStep();
      return;
    }

    setIsSavingProfile(true);
    
    try {
      const synthesizedText = synthesizeProfileMemory(state.quizAnswers);
      
      if (synthesizedText.trim()) {
        // Save to user_memories table with category 'core_profile'
        const { error } = await supabase
          .from('user_memories')
          .insert({
            user_id: user.id,
            title: 'Core Profile',
            content: synthesizedText,
            category: 'core_profile',
            is_active: true,
            importance: 5, // High importance for core profile
          });

        if (error) {
          console.error('Failed to save profile memory:', error);
          // Continue anyway - don't block onboarding
        }
      }

      // Wait for the feedback animation
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      goToNextStep();
    } catch (error) {
      console.error('Failed to synthesize profile:', error);
      goToNextStep();
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSkipQuiz = () => {
    goToNextStep();
  };

  // Check if current quiz step can proceed
  const canProceedQuiz = () => {
    switch (state.quizStep) {
      case 0: return !!state.quizAnswers.scope;
      case 1: return true; // Multi-select, allow skip
      case 2: return true; // Multi-select, allow skip
      case 3: return !!state.quizAnswers.diet;
      default: return true;
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

  const handleRegionalConfirm = async () => {
    setLoading(true);
    try {
      // Update i18n language
      if (selectedLanguage !== i18n.language) {
        await i18n.changeLanguage(selectedLanguage);
        localStorage.setItem('i18nextLng', selectedLanguage);
      }
      
      // Save timezone to profile if user is logged in
      if (user?.id) {
        await supabase
          .from('clerk_profiles')
          .upsert({
            id: user.id,
            timezone: selectedTimezone,
            language_preference: selectedLanguage,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'id' });
      }
      
      toast.success(t('regional.saved', { defaultValue: 'Settings saved!' }));
      goToNextStep();
    } catch (error) {
      console.error('Failed to save regional settings:', error);
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

  // Quiz option configurations
  const scopeOptions = [
    { 
      value: 'Just Me', 
      label: t('quiz.scope.justMe', { defaultValue: 'Just Me' }),
      desc: t('quiz.scope.justMeDesc', { defaultValue: 'Personal focus' }),
      icon: User 
    },
    { 
      value: 'Me & My Partner', 
      label: t('quiz.scope.partner', { defaultValue: 'Me & My Partner' }),
      desc: t('quiz.scope.partnerDesc', { defaultValue: 'Couple focus' }),
      icon: Users2 
    },
    { 
      value: 'My Family', 
      label: t('quiz.scope.family', { defaultValue: 'My Family' }),
      desc: t('quiz.scope.familyDesc', { defaultValue: 'Household focus' }),
      icon: House 
    },
  ];

  const mentalLoadOptions = [
    { 
      value: 'Home & Errands', 
      label: t('quiz.mentalLoad.home', { defaultValue: 'Home & Errands' }),
      desc: t('quiz.mentalLoad.homeDesc', { defaultValue: 'Groceries, maintenance' }),
      icon: Home 
    },
    { 
      value: 'Work & Career', 
      label: t('quiz.mentalLoad.work', { defaultValue: 'Work & Career' }),
      desc: t('quiz.mentalLoad.workDesc', { defaultValue: 'Meetings, tasks' }),
      icon: Briefcase 
    },
    { 
      value: 'Studies', 
      label: t('quiz.mentalLoad.studies', { defaultValue: 'Studies' }),
      desc: t('quiz.mentalLoad.studiesDesc', { defaultValue: 'Exams, assignments' }),
      icon: GraduationCap 
    },
    { 
      value: 'Health & Fitness', 
      label: t('quiz.mentalLoad.health', { defaultValue: 'Health & Fitness' }),
      desc: t('quiz.mentalLoad.healthDesc', { defaultValue: 'Meal prep, workouts' }),
      icon: Heart 
    },
  ];

  const householdOptions = [
    { value: 'Dogs', label: t('quiz.household.dogs', { defaultValue: 'Dogs 🐶' }), icon: Dog },
    { value: 'Cats', label: t('quiz.household.cats', { defaultValue: 'Cats 🐱' }), icon: Cat },
    { value: 'Kids', label: t('quiz.household.kids', { defaultValue: 'Kids 👶' }), icon: Baby },
    { value: 'Plants', label: t('quiz.household.plants', { defaultValue: 'Plants 🌿' }), icon: Leaf },
  ];

  const dietOptions = [
    { value: 'Anything goes', label: t('quiz.diet.anything', { defaultValue: 'Anything goes' }) },
    { value: 'Vegetarian', label: t('quiz.diet.vegetarian', { defaultValue: 'Vegetarian' }) },
    { value: 'Vegan', label: t('quiz.diet.vegan', { defaultValue: 'Vegan' }) },
    { value: 'Keto / Low Carb', label: t('quiz.diet.keto', { defaultValue: 'Keto / Low Carb' }) },
    { value: 'Gluten-Free', label: t('quiz.diet.glutenFree', { defaultValue: 'Gluten-Free' }) },
  ];

  // Render quiz step content
  const renderQuizStep = () => {
    if (isSavingProfile) {
      return (
        <div className="w-full max-w-md animate-fade-up space-y-8 text-center">
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
              <Sparkles className="w-10 h-10 text-primary animate-spin" />
            </div>
          </div>
          <p className="text-lg text-foreground font-medium">
            {t('quiz.personalizing', { defaultValue: "Personalizing Olive based on your profile..." })}
          </p>
        </div>
      );
    }

    switch (state.quizStep) {
      case 0:
        return (
          <div className="w-full max-w-md animate-fade-up space-y-6">
            {/* Logo */}
            <div className="flex justify-center mb-2">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 shadow-card border border-primary/20">
                <OliveLogo size={32} />
              </div>
            </div>
            
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground font-serif">
                {t('quiz.scope.question', { defaultValue: "Who are you organizing for?" })}
              </h1>
            </div>

            <div className="space-y-3">
              {scopeOptions.map((option) => {
                const Icon = option.icon;
                const isSelected = state.quizAnswers.scope === option.value;
                return (
                  <Card
                    key={option.value}
                    className={cn(
                      "p-4 cursor-pointer transition-all border-2",
                      isSelected 
                        ? "border-primary bg-primary/5" 
                        : "border-border hover:border-primary/50"
                    )}
                    onClick={() => setQuizAnswer('scope', option.value)}
                  >
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                        isSelected ? "bg-primary/20" : "bg-muted"
                      )}>
                        <Icon className={cn(
                          "w-6 h-6",
                          isSelected ? "text-primary" : "text-muted-foreground"
                        )} />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-foreground">{option.label}</p>
                        <p className="text-sm text-muted-foreground">{option.desc}</p>
                      </div>
                      {isSelected && (
                        <Check className="w-5 h-5 text-primary" />
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                onClick={goToNextQuizStep}
                className="flex-1 h-12 text-base group"
                disabled={!canProceedQuiz()}
              >
                {t('quiz.next', { defaultValue: "Next" })}
                <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
              </Button>
            </div>

            <button 
              onClick={handleSkipQuiz}
              className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('quiz.skipQuiz', { defaultValue: "Skip personalization" })}
            </button>
          </div>
        );

      case 1:
        return (
          <div className="w-full max-w-md animate-fade-up space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground font-serif">
                {t('quiz.mentalLoad.question', { defaultValue: "What takes up most of your mental load?" })}
              </h1>
              <p className="text-muted-foreground text-sm">
                {t('quiz.selectMultiple', { defaultValue: "Select all that apply" })}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {mentalLoadOptions.map((option) => {
                const Icon = option.icon;
                const isSelected = state.quizAnswers.mentalLoad.includes(option.value);
                return (
                  <Card
                    key={option.value}
                    className={cn(
                      "p-4 cursor-pointer transition-all border-2 text-center",
                      isSelected 
                        ? "border-primary bg-primary/5" 
                        : "border-border hover:border-primary/50"
                    )}
                    onClick={() => toggleMultiSelect('mentalLoad', option.value)}
                  >
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 transition-colors",
                      isSelected ? "bg-primary/20" : "bg-muted"
                    )}>
                      <Icon className={cn(
                        "w-5 h-5",
                        isSelected ? "text-primary" : "text-muted-foreground"
                      )} />
                    </div>
                    <p className="font-medium text-foreground text-sm">{option.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{option.desc}</p>
                  </Card>
                );
              })}
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                variant="ghost"
                onClick={goToPrevQuizStep}
                className="h-12"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                {t('quiz.back', { defaultValue: "Back" })}
              </Button>
              <Button
                onClick={goToNextQuizStep}
                className="flex-1 h-12 text-base group"
              >
                {t('quiz.next', { defaultValue: "Next" })}
                <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
              </Button>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="w-full max-w-md animate-fade-up space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground font-serif">
                {t('quiz.household.question', { defaultValue: "Who else lives in your home?" })}
              </h1>
              <p className="text-muted-foreground text-sm">
                {t('quiz.household.subtitle', { defaultValue: "This helps Olive understand your tasks better" })}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {householdOptions.map((option) => {
                const isSelected = state.quizAnswers.household.includes(option.value);
                return (
                  <Card
                    key={option.value}
                    className={cn(
                      "p-5 cursor-pointer transition-all border-2 text-center",
                      isSelected 
                        ? "border-primary bg-primary/5" 
                        : "border-border hover:border-primary/50"
                    )}
                    onClick={() => toggleMultiSelect('household', option.value)}
                  >
                    <p className="text-2xl mb-2">{option.label.split(' ')[1]}</p>
                    <p className="font-medium text-foreground text-sm">{option.label.split(' ')[0]}</p>
                  </Card>
                );
              })}
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                variant="ghost"
                onClick={goToPrevQuizStep}
                className="h-12"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                {t('quiz.back', { defaultValue: "Back" })}
              </Button>
              <Button
                onClick={goToNextQuizStep}
                className="flex-1 h-12 text-base group"
              >
                {t('quiz.next', { defaultValue: "Next" })}
                <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
              </Button>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="w-full max-w-md animate-fade-up space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground font-serif">
                {t('quiz.diet.question', { defaultValue: "Any dietary preferences?" })}
              </h1>
              <p className="text-muted-foreground text-sm">
                {t('quiz.diet.subtitle', { defaultValue: "Helps with grocery categorization" })}
              </p>
            </div>

            <div className="space-y-2">
              {dietOptions.map((option) => {
                const isSelected = state.quizAnswers.diet === option.value;
                return (
                  <Card
                    key={option.value}
                    className={cn(
                      "p-4 cursor-pointer transition-all border-2",
                      isSelected 
                        ? "border-primary bg-primary/5" 
                        : "border-border hover:border-primary/50"
                    )}
                    onClick={() => setQuizAnswer('diet', option.value)}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-foreground">{option.label}</p>
                      {isSelected && (
                        <Check className="w-5 h-5 text-primary" />
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                variant="ghost"
                onClick={goToPrevQuizStep}
                className="h-12"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                {t('quiz.back', { defaultValue: "Back" })}
              </Button>
              <Button
                onClick={goToNextQuizStep}
                className="flex-1 h-12 text-base group"
                disabled={!canProceedQuiz()}
              >
                {t('quiz.finish', { defaultValue: "Finish" })}
                <Sparkles className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <main className="min-h-screen bg-gradient-hero flex flex-col">
      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between">
        {(currentStepIndex > 0 || (state.currentStep === 'quiz' && state.quizStep > 0)) ? (
          <Button variant="ghost" size="icon" onClick={goToPrevStep} disabled={isAnimating || isSavingProfile}>
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
            {state.currentStep === 'quiz' 
              ? t('quiz.step', { current: state.quizStep + 1, total: QUIZ_TOTAL_STEPS, defaultValue: `Step ${state.quizStep + 1} of ${QUIZ_TOTAL_STEPS}` })
              : `${currentStepIndex + QUIZ_TOTAL_STEPS} / ${totalSteps + QUIZ_TOTAL_STEPS - 1}`
            }
          </p>
        </div>
        
        <div className="w-10" />
      </header>

      {/* Content */}
      <section className={cn(
        "flex-1 flex flex-col items-center justify-center px-6 py-8 transition-all duration-300",
        isAnimating ? "opacity-0 translate-x-8" : "opacity-100 translate-x-0"
      )}>
        {/* Quiz Steps */}
        {state.currentStep === 'quiz' && renderQuizStep()}

        {/* Regional Settings Step */}
        {state.currentStep === 'regional' && (
          <div className="w-full max-w-md animate-fade-up space-y-6">
            {/* Header */}
            <div className="flex justify-center mb-2">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 shadow-card border border-primary/20">
                <Globe className="w-8 h-8 text-primary" />
              </div>
            </div>
            
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground font-serif">
                {t('regional.header', { defaultValue: "We detected your settings" })}
              </h1>
              <p className="text-muted-foreground">
                {t('regional.subtext', { defaultValue: "Confirm your timezone and language so Olive can remind you at the right time." })}
              </p>
            </div>

            {/* Auto-detected indicator */}
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <MapPin className="w-4 h-4" />
              <span>{t('regional.autoDetected', { defaultValue: "Auto-detected from your device" })}</span>
            </div>

            {/* Settings Card */}
            <Card className="p-5 bg-card/80 border-border/50 shadow-card space-y-5">
              {/* Timezone Selection */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-muted-foreground" />
                  <Label className="text-foreground font-medium">
                    {t('regional.timezone', { defaultValue: "Timezone" })}
                  </Label>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {TIMEZONES.filter(tz => 
                    tz.value === selectedTimezone || 
                    tz.value === detectedTimezone ||
                    ['America/New_York', 'Europe/London', 'Europe/Rome', 'Europe/Madrid', 'Asia/Tokyo'].includes(tz.value)
                  ).map((tz) => (
                    <div
                      key={tz.value}
                      className={cn(
                        "p-3 rounded-lg border-2 cursor-pointer transition-all",
                        selectedTimezone === tz.value 
                          ? "border-primary bg-primary/5" 
                          : "border-border hover:border-primary/50"
                      )}
                      onClick={() => setSelectedTimezone(tz.value)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">{tz.label}</span>
                        {selectedTimezone === tz.value && (
                          <Check className="w-4 h-4 text-primary" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Language Selection */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Languages className="w-4 h-4 text-muted-foreground" />
                  <Label className="text-foreground font-medium">
                    {t('regional.language', { defaultValue: "Language" })}
                  </Label>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {Object.values(LANGUAGES).map((lang) => (
                    <div
                      key={lang.code}
                      className={cn(
                        "p-3 rounded-lg border-2 cursor-pointer transition-all",
                        selectedLanguage === lang.code 
                          ? "border-primary bg-primary/5" 
                          : "border-border hover:border-primary/50"
                      )}
                      onClick={() => setSelectedLanguage(lang.code)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{lang.flag}</span>
                          <span className="text-sm font-medium text-foreground">{lang.nativeName}</span>
                        </div>
                        {selectedLanguage === lang.code && (
                          <Check className="w-4 h-4 text-primary" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            {/* Actions */}
            <div className="space-y-3">
              <Button 
                onClick={handleRegionalConfirm}
                className="w-full h-12 text-base group"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Check className="w-4 h-4 mr-2" />
                )}
                {t('regional.confirm', { defaultValue: "Looks good!" })}
                <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
              </Button>
            </div>
          </div>
        )}

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

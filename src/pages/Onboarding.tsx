import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useSEO } from "@/hooks/useSEO";
import { OliveLogo } from "@/components/OliveLogo";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSpace, type SpaceType } from "@/providers/SpaceProvider";
import { useAuth } from "@/providers/AuthProvider";
import { supabase } from "@/lib/supabaseClient";
import { seedOnboardingSoul } from "@/lib/onboarding-soul";
import {
  SpaceNameStep,
  type OnboardingScope,
} from "@/components/onboarding/SpaceNameStep";
import {
  ArrowRight,
  ArrowLeft,
  MessageCircle,
  Calendar,
  Sparkles,
  Brain,
  Send,
  Loader2,
  Check,
  ExternalLink,
  Home,
  Briefcase,
  GraduationCap,
  Heart,
  User,
  Users2,
  House,
  Globe,
  Languages,
  MapPin,
} from "lucide-react";
import { LANGUAGES } from "@/lib/i18n/languages";
import { cn } from "@/lib/utils";
import { OnboardingDemo } from "@/components/OnboardingDemo";
import { QRCodeSVG } from "qrcode.react";

type OnboardingStep =
  | "demoPreview"
  | "quiz"
  | "spaceCreate"
  | "regional"
  | "whatsapp"
  | "calendar"
  | "demo";

interface QuizAnswers {
  scope: string | null;
  mentalLoad: string[];
}

interface SpaceAnswers {
  spaceName: string;
  partnerName: string;
  spaceId: string | null; // populated once the space is created
}

const ONBOARDING_STATE_KEY = "olive_onboarding_state";

interface OnboardingState {
  currentStep: OnboardingStep;
  quizStep: number;
  quizAnswers: QuizAnswers;
  spaceAnswers: SpaceAnswers;
  completedSteps: OnboardingStep[];
}

const defaultQuizAnswers: QuizAnswers = {
  scope: null,
  mentalLoad: [],
};

const defaultSpaceAnswers: SpaceAnswers = {
  spaceName: "",
  partnerName: "",
  spaceId: null,
};

const defaultState: OnboardingState = {
  currentStep: "demoPreview",
  quizStep: 0,
  quizAnswers: defaultQuizAnswers,
  spaceAnswers: defaultSpaceAnswers,
  completedSteps: [],
};

// `spaceCreate` sits right after the quiz so we have the scope answer in
// hand to pick a space type + smart default name. Putting it before
// regional/whatsapp/calendar means every downstream beat (and the demo
// brain-dump) writes scoped to the right space_id from the start.
const STEPS_ORDER: OnboardingStep[] = [
  "demoPreview",
  "quiz",
  "spaceCreate",
  "regional",
  "whatsapp",
  "calendar",
  "demo",
];

// Maps the quiz scope answer to the canonical space_type used by
// olive_spaces / olive-space-manage. Keep in sync with SCOPE_TO_USER_CONTEXT
// in supabase/functions/onboarding-finalize/index.ts.
const SCOPE_TO_SPACE_TYPE: Record<string, SpaceType> = {
  "Just Me": "custom",
  "Me & My Partner": "couple",
  "My Family": "family",
  "My Business": "business",
};

const QUIZ_TOTAL_STEPS = 2;

// Common timezones
const TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Paris", label: "Paris (CET/CEST)" },
  { value: "Europe/Berlin", label: "Berlin (CET/CEST)" },
  { value: "Europe/Rome", label: "Rome (CET/CEST)" },
  { value: "Europe/Madrid", label: "Madrid (CET/CEST)" },
  { value: "Asia/Dubai", label: "Dubai (GST)" },
  { value: "Asia/Kolkata", label: "India (IST)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Australia/Sydney", label: "Sydney (AEDT/AEST)" },
  { value: "UTC", label: "UTC" },
];

const Onboarding = () => {
  const { t, i18n } = useTranslation("onboarding");
  const getLocalizedPath = useLocalizedHref();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { createCouple, currentCouple } = useSupabaseCouple();
  const { createSpace, switchSpace, spaces } = useSpace();

  const [state, setState] = useState<OnboardingState>(() => {
    try {
      const saved = localStorage.getItem(ONBOARDING_STATE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...defaultState,
          ...parsed,
          quizAnswers: { ...defaultQuizAnswers, ...parsed.quizAnswers },
          spaceAnswers: { ...defaultSpaceAnswers, ...parsed.spaceAnswers },
        };
      }
    } catch {}
    return defaultState;
  });

  const [isAnimating, setIsAnimating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [demoText, setDemoText] = useState("");
  const [isProcessingDemo, setIsProcessingDemo] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isCreatingSpace, setIsCreatingSpace] = useState(false);
  const [whatsappLink, setWhatsappLink] = useState("");
  const [isDesktop, setIsDesktop] = useState(false);

  // Regional settings
  const [selectedTimezone, setSelectedTimezone] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("");
  const [hasAutoDetected, setHasAutoDetected] = useState(false);

  // Auto-detect timezone and language
  useEffect(() => {
    if (hasAutoDetected) return;
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const matched = TIMEZONES.find((tz) => tz.value === browserTimezone);
    setSelectedTimezone(matched ? browserTimezone : "America/New_York");

    const browserLang = navigator.language || "en";
    if (browserLang.startsWith("es")) setSelectedLanguage("es-ES");
    else if (browserLang.startsWith("it")) setSelectedLanguage("it-IT");
    else setSelectedLanguage("en");

    setHasAutoDetected(true);
  }, [hasAutoDetected]);

  useEffect(() => {
    setIsDesktop(!/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
  }, []);

  useSEO({
    title: "Get Started — Olive",
    description: t("personalizeExperience"),
  });

  // Persist state
  useEffect(() => {
    localStorage.setItem(ONBOARDING_STATE_KEY, JSON.stringify(state));
  }, [state]);

  const currentStepIndex = STEPS_ORDER.indexOf(state.currentStep);
  const totalVisualSteps = STEPS_ORDER.length;

  // Progress: quiz substeps count within the quiz step
  const getProgress = () => {
    if (state.currentStep === "quiz") {
      const quizFraction = (state.quizStep + 1) / QUIZ_TOTAL_STEPS;
      return ((currentStepIndex + quizFraction) / totalVisualSteps) * 100;
    }
    return ((currentStepIndex + 1) / totalVisualSteps) * 100;
  };

  const goToStep = (step: OnboardingStep) => {
    setIsAnimating(true);
    setTimeout(() => {
      setState((prev) => ({ ...prev, currentStep: step }));
      setIsAnimating(false);
    }, 150);
  };

  const goToNextStep = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEPS_ORDER.length) {
      setState((prev) => ({
        ...prev,
        completedSteps: [...new Set([...prev.completedSteps, state.currentStep])],
      }));
      goToStep(STEPS_ORDER[nextIndex]);
    }
  };

  const goToPrevStep = () => {
    if (state.currentStep === "quiz" && state.quizStep > 0) {
      setState((prev) => ({ ...prev, quizStep: prev.quizStep - 1 }));
      return;
    }
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) goToStep(STEPS_ORDER[prevIndex]);
  };

  // Quiz helpers
  const goToNextQuizStep = () => {
    if (state.quizStep < QUIZ_TOTAL_STEPS - 1) {
      setIsAnimating(true);
      setTimeout(() => {
        setState((prev) => ({ ...prev, quizStep: prev.quizStep + 1 }));
        setIsAnimating(false);
      }, 150);
    } else {
      handleQuizComplete();
    }
  };

  const setQuizAnswer = (key: keyof QuizAnswers, value: string | string[] | null) => {
    setState((prev) => ({
      ...prev,
      quizAnswers: { ...prev.quizAnswers, [key]: value },
    }));
  };

  const toggleMultiSelect = (key: "mentalLoad", value: string) => {
    setState((prev) => {
      const current = prev.quizAnswers[key];
      const updated = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, quizAnswers: { ...prev.quizAnswers, [key]: updated } };
    });
  };

  const synthesizeProfileMemory = (answers: QuizAnswers): string => {
    const parts: string[] = [];
    if (answers.scope) parts.push(`The user is organizing for ${answers.scope}.`);
    if (answers.mentalLoad.length > 0)
      parts.push(`Their primary focus areas are ${answers.mentalLoad.join(", ")}.`);
    return parts.join(" ");
  };

  const handleQuizComplete = async () => {
    if (!user?.id) {
      goToNextStep();
      return;
    }
    setIsSavingProfile(true);
    try {
      const synthesized = synthesizeProfileMemory(state.quizAnswers);
      if (synthesized.trim()) {
        await supabase.from("user_memories").insert({
          user_id: user.id,
          title: "Core Profile",
          content: synthesized,
          category: "core_profile",
          is_active: true,
          importance: 5,
        });
      }
      await new Promise((r) => setTimeout(r, 1000));
      goToNextStep();
    } catch {
      goToNextStep();
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Create the user's first Space and seed Olive's User Soul + augment the
  // Space Soul that olive-space-manage auto-generated. This is the moment
  // when the quiz answers stop being inert text and become Olive's
  // operating context for every downstream message.
  const handleSpaceCreate = async (values: {
    spaceName: string;
    partnerName: string;
  }) => {
    if (!user?.id) {
      goToNextStep();
      return;
    }

    setIsCreatingSpace(true);
    try {
      const scope = state.quizAnswers.scope;
      const spaceType: SpaceType = scope
        ? SCOPE_TO_SPACE_TYPE[scope] || "custom"
        : "custom";

      let spaceId: string | null = null;

      if (spaceType === "couple") {
        // Couple type: keep using create_couple RPC. The
        // sync_couple_to_space trigger creates the matching olive_spaces
        // row with the same UUID, so legacy couple-scoped flows keep
        // working unchanged. Note: the trigger does NOT call
        // generateSpaceSoul — onboarding-finalize compensates by writing
        // the user soul AND augmenting the space soul once it exists.
        const couple = await createCouple({
          title: values.spaceName,
          you_name: user?.firstName || "",
          partner_name: values.partnerName,
        });
        spaceId = couple?.id || null;

        // The sync trigger fires INSERT on olive_spaces but
        // generateSpaceSoul is only invoked by olive-space-manage. For
        // couple paths we rely on onboarding-finalize.augmentSpaceSoul
        // (which upserts) to create the soul row if missing — see the
        // edge function.
      } else {
        // Non-couple types (solo / family / business / household / custom):
        // route through olive-space-manage so the Space Soul template
        // for the chosen type is generated automatically.
        const newSpace = await createSpace({
          name: values.spaceName,
          type: spaceType,
          settings: { onboarding_source: "quiz", scope },
        });
        spaceId = newSpace?.id || null;
        if (newSpace) switchSpace(newSpace);
      }

      // Persist the chosen names + spaceId so a refresh resumes correctly.
      setState((prev) => ({
        ...prev,
        spaceAnswers: {
          spaceName: values.spaceName,
          partnerName: values.partnerName,
          spaceId,
        },
      }));

      // Best-effort: seed the User Soul + augment the Space Soul. This is
      // the bridge from quiz answers → Olive's operating context. Failures
      // are logged but never block onboarding completion.
      seedOnboardingSoul({
        userId: user.id,
        spaceId,
        scope,
        mentalLoad: state.quizAnswers.mentalLoad,
        displayName: user?.firstName || undefined,
        timezone: selectedTimezone || undefined,
        language: selectedLanguage || undefined,
        partnerName: values.partnerName || undefined,
      }).catch(() => {
        /* already logged inside seedOnboardingSoul */
      });

      goToNextStep();
    } catch (err) {
      // Don't trap the user — let them continue. They can rename / recreate
      // the space later from the Space switcher.
      console.error("[Onboarding] Space creation failed:", err);
      toast.error(
        t("space.errorFallback", {
          defaultValue: "We hit a snag creating your Space. You can fix this later in Settings.",
        })
      );
      goToNextStep();
    } finally {
      setIsCreatingSpace(false);
    }
  };

  const handleRegionalConfirm = async () => {
    setLoading(true);
    try {
      if (selectedLanguage !== i18n.language) {
        await i18n.changeLanguage(selectedLanguage);
        localStorage.setItem("i18nextLng", selectedLanguage);
      }
      if (user?.id) {
        await supabase.from("clerk_profiles").upsert(
          {
            id: user.id,
            timezone: selectedTimezone,
            language_preference: selectedLanguage,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        );
      }
      goToNextStep();
    } catch {
      goToNextStep();
    } finally {
      setLoading(false);
    }
  };

  const handleConnectWhatsApp = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("generate-whatsapp-link", { body: {} });
      if (!error && data?.whatsappLink) {
        setWhatsappLink(data.whatsappLink);
        if (!isDesktop) window.open(data.whatsappLink, "_blank");
      } else {
        toast.error(t("whatsapp.errorFallback", { defaultValue: "You can connect later in Settings." }));
        goToNextStep();
      }
    } catch {
      toast.error(t("whatsapp.errorFallback", { defaultValue: "You can connect later in Settings." }));
      goToNextStep();
    }
  };

  const handleConnectCalendar = async () => {
    if (!user?.id) { goToNextStep(); return; }
    setLoading(true);
    try {
      const isNative = Capacitor.isNativePlatform();
      const origin = isNative ? 'https://witholive.app' : window.location.origin;
      const { data, error } = await supabase.functions.invoke("calendar-auth-url", {
        body: { user_id: user.id, redirect_origin: origin },
      });
      if (!error && data?.auth_url) {
        localStorage.setItem(ONBOARDING_STATE_KEY, JSON.stringify({
          ...state,
          currentStep: "demo",
          completedSteps: [...new Set([...state.completedSteps, "calendar"])],
        }));
        window.location.href = data.auth_url;
        return;
      }
    } catch {}
    setLoading(false);
    goToNextStep();
  };

  const markOnboardingCompleted = async () => {
    localStorage.setItem("olive_onboarding_completed", "true");
    localStorage.removeItem(ONBOARDING_STATE_KEY);
    if (user?.id) {
      try {
        await supabase.from("olive_memory_chunks").insert({
          user_id: user.id,
          content: "User completed onboarding flow",
          chunk_type: "preference",
          importance: 2,
          source: "onboarding",
          metadata: { type: "onboarding_completed", completed_at: new Date().toISOString() },
        });
      } catch {}
    }
  };

  // Fallback: if the user reached the demo step without a Space (skipped
  // spaceCreate, or it failed silently), create a minimal solo space so
  // process-note has a scope to attach to. Returns the couple_id (legacy
  // foreign key on clerk_notes) when one exists.
  const ensureSpaceExists = async (): Promise<string | null> => {
    if (state.spaceAnswers.spaceId) return currentCouple?.id || null;
    if (currentCouple) return currentCouple.id;
    try {
      // Default fallback is a couple-typed "My Space" so legacy code paths
      // (clerk_notes.couple_id FK, partner-name lookups) keep working.
      // Users who actually wanted a non-couple Space picked one in the
      // spaceCreate step — reaching here means they skipped or errored.
      const couple = await createCouple({
        title: "My Space",
        you_name: user?.firstName || "",
        partner_name: "",
      });
      return couple?.id || null;
    } catch {
      return null;
    }
  };

  const handleDemoSubmit = async () => {
    if (!demoText.trim()) return;
    setIsProcessingDemo(true);
    try {
      const coupleId = await ensureSpaceExists();

      const { error } = await supabase.functions.invoke("process-note", {
        body: { text: demoText.trim(), user_id: user?.id, couple_id: coupleId },
      });
      if (error) throw error;
      toast.success(t("demo.success", { defaultValue: "Your first task is ready! 🎉" }));
      await markOnboardingCompleted();
      navigate(getLocalizedPath("/home"));
    } catch {
      toast.error(t("demo.error", { defaultValue: "Something went wrong. Let's try again." }));
    } finally {
      setIsProcessingDemo(false);
    }
  };

  const handleComplete = async () => {
    await ensureSpaceExists();
    await markOnboardingCompleted();
    navigate(getLocalizedPath("/home"));
  };

  // Quiz options
  const scopeOptions = [
    { value: "Just Me", label: t("quiz.scope.justMe"), desc: t("quiz.scope.justMeDesc"), icon: User },
    { value: "Me & My Partner", label: t("quiz.scope.partner"), desc: t("quiz.scope.partnerDesc"), icon: Users2 },
    { value: "My Family", label: t("quiz.scope.family"), desc: t("quiz.scope.familyDesc"), icon: House },
    { value: "My Business", label: t("quiz.scope.business"), desc: t("quiz.scope.businessDesc"), icon: Briefcase },
  ];

  const mentalLoadOptions = [
    { value: "Home & Errands", label: t("quiz.mentalLoad.home"), desc: t("quiz.mentalLoad.homeDesc"), icon: Home },
    { value: "Work & Career", label: t("quiz.mentalLoad.work"), desc: t("quiz.mentalLoad.workDesc"), icon: Briefcase },
    { value: "Studies", label: t("quiz.mentalLoad.studies"), desc: t("quiz.mentalLoad.studiesDesc"), icon: GraduationCap },
    { value: "Health & Fitness", label: t("quiz.mentalLoad.health"), desc: t("quiz.mentalLoad.healthDesc"), icon: Heart },
  ];

  const demoChips = [
    t("demo.chip1", { defaultValue: "Remind me to call Mom tomorrow at 5pm" }),
    t("demo.chip2", { defaultValue: "Add milk, eggs, and bread to grocery list" }),
    t("demo.chip3", { defaultValue: "Dinner with Sarah next Friday at 7pm" }),
  ];

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
            {t("quiz.personalizing", { defaultValue: "Personalizing Olive for you..." })}
          </p>
        </div>
      );
    }

    switch (state.quizStep) {
      case 0:
        return (
          <div className="w-full max-w-md animate-fade-up space-y-6">
            <div className="flex justify-center mb-2">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 shadow-card border border-primary/20">
                <OliveLogo size={32} />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground font-serif">
                {t("quiz.scope.question")}
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
                      isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                    )}
                    onClick={() => setQuizAnswer("scope", option.value)}
                  >
                    <div className="flex items-center gap-4">
                      <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center transition-colors", isSelected ? "bg-primary/20" : "bg-muted")}>
                        <Icon className={cn("w-6 h-6", isSelected ? "text-primary" : "text-muted-foreground")} />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-foreground">{option.label}</p>
                        <p className="text-sm text-muted-foreground">{option.desc}</p>
                      </div>
                      {isSelected && <Check className="w-5 h-5 text-primary" />}
                    </div>
                  </Card>
                );
              })}
            </div>
            <Button
              onClick={goToNextQuizStep}
              className="w-full h-12 text-base group"
              disabled={!state.quizAnswers.scope}
            >
              {t("quiz.next", { defaultValue: "Next" })}
              <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
            </Button>
            <button onClick={goToNextStep} className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t("quiz.skipQuiz", { defaultValue: "Skip personalization" })}
            </button>
          </div>
        );

      case 1:
        return (
          <div className="w-full max-w-md animate-fade-up space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground font-serif">
                {t("quiz.mentalLoad.question")}
              </h1>
              <p className="text-muted-foreground text-sm">
                {t("quiz.selectMultiple", { defaultValue: "Select all that apply" })}
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
                      isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                    )}
                    onClick={() => toggleMultiSelect("mentalLoad", option.value)}
                  >
                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 transition-colors", isSelected ? "bg-primary/20" : "bg-muted")}>
                      <Icon className={cn("w-5 h-5", isSelected ? "text-primary" : "text-muted-foreground")} />
                    </div>
                    <p className="font-medium text-foreground text-sm">{option.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{option.desc}</p>
                  </Card>
                );
              })}
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="ghost" onClick={() => setState((p) => ({ ...p, quizStep: 0 }))} className="h-12">
                <ArrowLeft className="w-4 h-4 mr-2" />
                {t("quiz.back", { defaultValue: "Back" })}
              </Button>
              <Button onClick={goToNextQuizStep} className="flex-1 h-12 text-base group">
                {t("quiz.finish", { defaultValue: "Continue" })}
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
      {/* Header with progress */}
      <header className="px-6 py-4 flex items-center justify-between">
        {currentStepIndex > 0 || (state.currentStep === "quiz" && state.quizStep > 0) ? (
          <Button variant="ghost" size="icon" onClick={goToPrevStep} disabled={isAnimating || isSavingProfile}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
        ) : (
          <div className="w-10" />
        )}

        <div className="flex-1 max-w-[240px] mx-4">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
              style={{ width: `${getProgress()}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-center mt-1">
            {state.currentStep === "quiz"
              ? t("quiz.step", { current: state.quizStep + 1, total: QUIZ_TOTAL_STEPS })
              : `${currentStepIndex + 1} / ${totalVisualSteps}`}
          </p>
        </div>

        <div className="w-10" />
      </header>

      {/* Content */}
      <section
        className={cn(
          "flex-1 flex flex-col items-center justify-center px-6 py-8 transition-all duration-300",
          isAnimating ? "opacity-0 translate-x-8" : "opacity-100 translate-x-0"
        )}
      >
        {/* Step 1: Demo Preview — show value first */}
        {state.currentStep === "demoPreview" && <OnboardingDemo onContinue={goToNextStep} />}

        {/* Step 2: Quiz (scope + mental load) */}
        {state.currentStep === "quiz" && renderQuizStep()}

        {/* Step 3: Space creation — first time the quiz answers shape Olive */}
        {state.currentStep === "spaceCreate" && (
          <SpaceNameStep
            scope={(state.quizAnswers.scope as OnboardingScope | null) || null}
            firstName={user?.firstName || ""}
            lastName={user?.lastName || ""}
            initialValues={{
              spaceName: state.spaceAnswers.spaceName,
              partnerName: state.spaceAnswers.partnerName,
            }}
            loading={isCreatingSpace}
            onBack={goToPrevStep}
            onSubmit={handleSpaceCreate}
          />
        )}

        {/* Step 4: Regional Settings (simplified) */}
        {state.currentStep === "regional" && (
          <div className="w-full max-w-md animate-fade-up space-y-6">
            <div className="flex justify-center mb-2">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 shadow-card border border-primary/20">
                <Globe className="w-8 h-8 text-primary" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground font-serif">
                {t("regional.header")}
              </h1>
              <p className="text-muted-foreground">{t("regional.subtext")}</p>
            </div>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <MapPin className="w-4 h-4" />
              <span>{t("regional.autoDetected")}</span>
            </div>

            <Card className="p-5 bg-card/80 border-border/50 shadow-card space-y-5">
              {/* Timezone */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-muted-foreground" />
                  <Label className="text-foreground font-medium">{t("regional.timezone")}</Label>
                </div>
                <div className="grid grid-cols-1 gap-2 max-h-[200px] overflow-y-auto">
                  {TIMEZONES.map((tz) => (
                    <div
                      key={tz.value}
                      className={cn(
                        "p-3 rounded-lg border-2 cursor-pointer transition-all",
                        selectedTimezone === tz.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                      )}
                      onClick={() => setSelectedTimezone(tz.value)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">{tz.label}</span>
                        {selectedTimezone === tz.value && <Check className="w-4 h-4 text-primary" />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Language */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Languages className="w-4 h-4 text-muted-foreground" />
                  <Label className="text-foreground font-medium">{t("regional.language")}</Label>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {Object.values(LANGUAGES).map((lang) => (
                    <div
                      key={lang.code}
                      className={cn(
                        "p-3 rounded-lg border-2 cursor-pointer transition-all",
                        selectedLanguage === lang.code ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                      )}
                      onClick={() => setSelectedLanguage(lang.code)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{lang.flag}</span>
                          <span className="text-sm font-medium text-foreground">{lang.nativeName}</span>
                        </div>
                        {selectedLanguage === lang.code && <Check className="w-4 h-4 text-primary" />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <Button onClick={handleRegionalConfirm} className="w-full h-12 text-base group" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
              {t("regional.confirm")}
              <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>
        )}

        {/* Step 4: WhatsApp */}
        {state.currentStep === "whatsapp" && (
          <div className="w-full max-w-md animate-fade-up space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground font-serif">{t("whatsapp.header")}</h1>
              <p className="text-muted-foreground">{t("whatsapp.subtext")}</p>
            </div>

            {isDesktop && whatsappLink ? (
              <div className="space-y-4">
                <div className="flex justify-center py-4">
                  <div className="bg-white p-4 rounded-2xl shadow-lg border border-stone-200">
                    <QRCodeSVG value={whatsappLink} size={180} level="M" includeMargin />
                  </div>
                </div>
                <p className="text-center text-sm text-muted-foreground">{t("whatsapp.scanQr")}</p>
                <Button onClick={goToNextStep} className="w-full h-12 text-base group">
                  {t("whatsapp.done")}
                  <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
                </Button>
              </div>
            ) : whatsappLink ? (
              <div className="space-y-4">
                <div className="flex justify-center py-4">
                  <div className="w-20 h-20 rounded-full bg-green-500/10 flex items-center justify-center border border-green-500/20">
                    <Check className="w-10 h-10 text-green-500" />
                  </div>
                </div>
                <Button onClick={() => window.open(whatsappLink, "_blank")} variant="outline" className="w-full h-12 text-base">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  {t("whatsapp.connectButton")}
                </Button>
                <Button onClick={goToNextStep} className="w-full h-12 text-base group">
                  {t("whatsapp.done")}
                  <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
                </Button>
              </div>
            ) : (
              <>
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
                <Button onClick={handleConnectWhatsApp} className="w-full h-12 text-base bg-green-600 hover:bg-green-700 group">
                  <MessageCircle className="w-4 h-4 mr-2" />
                  {t("whatsapp.connectButton")}
                  <ExternalLink className="w-4 h-4 ml-2" />
                </Button>
              </>
            )}

            <button onClick={goToNextStep} className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t("skip", { defaultValue: "Skip for now" })}
            </button>
          </div>
        )}

        {/* Step 5: Calendar */}
        {state.currentStep === "calendar" && (
          <div className="w-full max-w-md animate-fade-up space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground font-serif">{t("calendar.header")}</h1>
              <p className="text-muted-foreground">{t("calendar.subtext")}</p>
            </div>
            <div className="flex justify-center py-6">
              <div className="w-48 h-48 rounded-2xl bg-card border border-border shadow-card overflow-hidden">
                <div className="h-8 bg-primary flex items-center justify-center">
                  <span className="text-sm font-medium text-primary-foreground">March 2026</span>
                </div>
                <div className="p-3 grid grid-cols-7 gap-1 text-xs text-center">
                  {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                    <span key={i} className="text-muted-foreground font-medium">{d}</span>
                  ))}
                  {Array.from({ length: 31 }, (_, i) => (
                    <span
                      key={i}
                      className={cn(
                        "w-5 h-5 flex items-center justify-center rounded-full text-foreground/70",
                        i === 7 && "bg-primary text-primary-foreground font-medium",
                        [3, 10, 17, 24].includes(i) && "bg-accent/20 text-accent"
                      )}
                    >
                      {i + 1}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <Button onClick={handleConnectCalendar} className="w-full h-12 text-base group" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Calendar className="w-4 h-4 mr-2" />}
              {t("calendar.connectButton")}
              <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
            </Button>
            <button onClick={goToNextStep} className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t("skip", { defaultValue: "Skip" })}
            </button>
          </div>
        )}

        {/* Step 6: Live Demo — first brain dump */}
        {state.currentStep === "demo" && (
          <div className="w-full max-w-md animate-fade-up space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground font-serif">{t("demo.header")}</h1>
              <p className="text-muted-foreground">{t("demo.subtext")}</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              {demoChips.map((chip, i) => (
                <button
                  key={i}
                  onClick={() => setDemoText(chip)}
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
            <Card className="p-4 bg-card/80 border-border/50 shadow-card">
              <Textarea
                value={demoText}
                onChange={(e) => setDemoText(e.target.value)}
                placeholder={t("demo.placeholder")}
                className="min-h-[120px] border-0 focus-visible:ring-0 resize-none text-base p-0 shadow-none"
                disabled={isProcessingDemo}
              />
              <div className="flex justify-end mt-3">
                <Button onClick={handleDemoSubmit} disabled={!demoText.trim() || isProcessingDemo} className="group">
                  {isProcessingDemo ? (
                    <>
                      <Sparkles className="w-4 h-4 mr-2 animate-spin" />
                      {t("demo.processing")}
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      {t("demo.submit")}
                    </>
                  )}
                </Button>
              </div>
            </Card>
            <button onClick={handleComplete} className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t("demo.skipToHome")}
            </button>
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="px-6 py-4 text-center">
        <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
          <Sparkles className="w-3 h-3" />
          {t("dataSecure")}
        </p>
      </footer>
    </main>
  );
};

export default Onboarding;

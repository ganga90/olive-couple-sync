import { useState, useEffect, useRef, useMemo } from "react";
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
import { useOnboardingEvent } from "@/hooks/useOnboardingEvent";
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
import {
  CapturePreview,
  type ProcessNoteResult,
} from "@/components/onboarding/CapturePreview";
import { InviteSpaceStep } from "@/components/onboarding/InviteSpaceStep";
import { ReceiptStep } from "@/components/onboarding/ReceiptStep";
import {
  getStepsForVersion,
  getQuizStepsForVersion,
  isStepActive,
  type OnboardingStep,
} from "@/lib/onboarding-flow";
import { useOnboardingVersion } from "@/hooks/useOnboardingVersion";

interface QuizAnswers {
  scope: string | null;
  mentalLoad: string[];
}

interface SpaceAnswers {
  spaceName: string;
  partnerName: string;
  spaceId: string | null;       // populated once the space is created
  spaceType: SpaceType | null;  // mirrored client-side so shareSpace knows audience
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
  spaceType: null,
};

const defaultState: OnboardingState = {
  currentStep: "demoPreview",
  quizStep: 0,
  quizAnswers: defaultQuizAnswers,
  spaceAnswers: defaultSpaceAnswers,
  completedSteps: [],
};

// The full ordered flow lives in src/lib/onboarding-flow.ts so the
// v1 vs v2 step-list logic is testable in isolation. We compute the
// effective list per-render via getStepsForVersion(version). v1 = full
// 8-beat flow; v2 drops `regional` and `calendar` (handled silently /
// JIT respectively).
//
// `spaceCreate` sits right after the quiz so we have the scope answer in
// hand to pick a space type + smart default name. `shareSpace` follows
// immediately so invite intent is captured at peak motivation — but is
// auto-skipped for solo (`custom`) spaces (see useEffect below).

// Maps the quiz scope answer to the canonical space_type used by
// olive_spaces / olive-space-manage. Keep in sync with SCOPE_TO_USER_CONTEXT
// in supabase/functions/onboarding-finalize/index.ts.
const SCOPE_TO_SPACE_TYPE: Record<string, SpaceType> = {
  "Just Me": "custom",
  "Me & My Partner": "couple",
  "My Family": "family",
  "My Business": "business",
};

// Step counts now derive per-version via getStepsForVersion +
// getQuizStepsForVersion in src/lib/onboarding-flow.ts. The constants
// above are documented in onboarding-flow's source. The const below is
// retained as the FALLBACK quiz total used while the version is loading
// — matches v1 to keep "Step 1 of N" labels stable on first paint.
const QUIZ_TOTAL_STEPS_FALLBACK = 2;

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
  const fireEvent = useOnboardingEvent();

  // Version flag drives which beats render. While the lookup is
  // in-flight we render the v1 shape so first paint never collapses
  // (a flash of fewer steps would feel like a refresh bug).
  const { version: onboardingVersion, justAssigned: versionJustAssigned } =
    useOnboardingVersion();
  const effectiveVersion = onboardingVersion || "v1";
  const stepsOrder = useMemo(
    () => getStepsForVersion(effectiveVersion),
    [effectiveVersion],
  );
  const quizTotalSteps = getQuizStepsForVersion(effectiveVersion);

  // Captured at first render so duration metrics (time-to-first-capture,
  // total flow time) can be computed client-side as a sanity check
  // against server-side timestamps.
  const flowStartRef = useRef<number>(Date.now());

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

  // Demo-step capture preview state. When `process-note` returns, we
  // store the structured result here and switch the demo card from
  // "input" mode to "preview" mode. The user explicitly taps "Take me
  // home" to leave — auto-navigation would steal the aha.
  const [demoResult, setDemoResult] =
    useState<ProcessNoteResult | null>(null);
  const [previewAnimComplete, setPreviewAnimComplete] = useState(false);

  // Regional settings
  const [selectedTimezone, setSelectedTimezone] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("");
  const [hasAutoDetected, setHasAutoDetected] = useState(false);

  // Telemetry — fire flow_started exactly once per session, then
  // beat_started on every step transition. The hook itself dedups
  // flow_started across StrictMode double-invocations + refresh-resumes
  // via sessionStorage, so we can call it unconditionally on mount.
  useEffect(() => {
    fireEvent("flow_started", { beat: state.currentStep });
    // Intentionally not depending on `state.currentStep` — flow_started
    // is a one-shot session-level event. beat_started for subsequent
    // beats is fired by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fireEvent("beat_started", { beat: state.currentStep });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentStep]);

  // Fire version_assigned exactly once per user, the moment the hook
  // assigns a non-default cohort. This is what slices the funnel — every
  // metric in v_onboarding_funnel becomes A/B-comparable downstream.
  useEffect(() => {
    if (!onboardingVersion) return; // still loading
    if (!versionJustAssigned) return; // pre-existing assignment, no event
    fireEvent("version_assigned", { version: onboardingVersion });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingVersion, versionJustAssigned]);

  // v2 corrective: if a refresh / resume restores a stale state.currentStep
  // pointing at a beat that v2 has dropped (regional or calendar), advance
  // to the next active beat in the v2 list. Without this, a user mid-flow
  // when their version flag flipped could be stuck on a screen that no
  // longer renders. Defensive — the assignment is sticky, so this only
  // fires for users whose state was persisted before they were assigned.
  useEffect(() => {
    if (!onboardingVersion) return;
    if (isStepActive(state.currentStep, onboardingVersion)) return;
    // Find the next active beat in canonical order. Falls back to the
    // last beat (demo) so the user always lands on something renderable.
    const idx = stepsOrder.indexOf(state.currentStep);
    const next =
      idx >= 0 && idx + 1 < stepsOrder.length
        ? stepsOrder[idx + 1]
        : stepsOrder[stepsOrder.length - 1];
    fireEvent("beat_auto_skipped", {
      beat: state.currentStep,
      reason: "dropped_in_v2",
    });
    setState((prev) => ({ ...prev, currentStep: next }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingVersion, state.currentStep, stepsOrder]);

  // v2 silent regional persistence: with the regional confirm step
  // dropped, v2 users still need their auto-detected timezone +
  // language saved to clerk_profiles so reminders fire at the right
  // local time. We do that here as a side-effect once both the
  // detection has run AND the user is known.
  useEffect(() => {
    if (onboardingVersion !== "v2") return;
    if (!hasAutoDetected) return;
    if (!user?.id) return;
    (async () => {
      try {
        await supabase.from("clerk_profiles").upsert(
          {
            id: user.id,
            timezone: selectedTimezone,
            language_preference: selectedLanguage,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" },
        );
        // Mirror the language change so any v2-step that renders next
        // is already localized. Skipped if user is already on the right
        // locale to avoid an unnecessary remount.
        if (selectedLanguage && selectedLanguage !== i18n.language) {
          await i18n.changeLanguage(selectedLanguage);
          localStorage.setItem("i18nextLng", selectedLanguage);
        }
      } catch (err) {
        // Non-blocking. Falling back to UTC + English is acceptable.
        console.warn("[onboarding] v2 silent regional save failed:", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingVersion, hasAutoDetected, user?.id]);

  // Auto-skip the shareSpace beat for solo Spaces. The step is
  // structurally meaningless when there's nobody to invite, but keeping
  // it in STEPS_ORDER avoids special-casing the linear flow logic.
  // We fire a distinct event so the funnel can distinguish "auto-skipped
  // because solo" from "user tapped skip on a couple/family space".
  useEffect(() => {
    if (state.currentStep !== "shareSpace") return;
    if (
      state.spaceAnswers.spaceType &&
      state.spaceAnswers.spaceType !== "custom"
    ) {
      return; // shared space — let the user see the invite UI
    }
    fireEvent("beat_auto_skipped", {
      beat: "shareSpace",
      reason: "solo_space",
    });
    // Defer the advance by a tick so the beat_started event for
    // shareSpace lands first — keeps the funnel's per-beat order
    // consistent (start → auto_skip → start of next beat).
    const t = window.setTimeout(() => {
      setState((prev) => ({
        ...prev,
        // Cast: Set widens 'shareSpace' literal to string. The runtime
        // value is always one of OnboardingStep — STEPS_ORDER guarantees it.
        completedSteps: [
          ...new Set<OnboardingStep>([...prev.completedSteps, "shareSpace"]),
        ],
        currentStep:
          stepsOrder[stepsOrder.indexOf("shareSpace") + 1] || prev.currentStep,
      }));
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentStep, state.spaceAnswers.spaceType]);

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

  const currentStepIndex = stepsOrder.indexOf(state.currentStep);
  const totalVisualSteps = stepsOrder.length;

  // Progress: quiz substeps count within the quiz step
  const getProgress = () => {
    if (state.currentStep === "quiz") {
      const quizFraction = (state.quizStep + 1) / quizTotalSteps;
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
    if (nextIndex < stepsOrder.length) {
      // Mark the leaving step as completed in telemetry. The hook
      // separately fires beat_started for the new step via the effect
      // tied to state.currentStep.
      fireEvent("beat_completed", { beat: state.currentStep });
      setState((prev) => ({
        ...prev,
        completedSteps: [...new Set([...prev.completedSteps, state.currentStep])],
      }));
      goToStep(stepsOrder[nextIndex]);
    }
  };

  // Skip-button helper — emits a beat_skipped event before advancing so
  // the funnel can distinguish "completed via primary CTA" from "tapped
  // skip link". Visually skipping is still useful signal (the user got
  // through the beat), so we also fire beat_completed via goToNextStep.
  const skipBeat = () => {
    fireEvent("beat_skipped", { beat: state.currentStep });
    goToNextStep();
  };

  const goToPrevStep = () => {
    if (state.currentStep === "quiz" && state.quizStep > 0) {
      setState((prev) => ({ ...prev, quizStep: prev.quizStep - 1 }));
      return;
    }
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) goToStep(stepsOrder[prevIndex]);
  };

  // Quiz helpers
  const goToNextQuizStep = () => {
    if (state.quizStep < quizTotalSteps - 1) {
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

      // Persist the chosen names + spaceId + spaceType so a refresh
      // resumes correctly AND the downstream shareSpace step knows which
      // audience copy to render without re-deriving from scope.
      setState((prev) => ({
        ...prev,
        spaceAnswers: {
          spaceName: values.spaceName,
          partnerName: values.partnerName,
          spaceId,
          spaceType,
        },
      }));

      // Telemetry: space_created fires once we have a confirmed spaceId,
      // regardless of whether it came via createCouple or createSpace.
      // The space_type label keeps the funnel sliceable by scope.
      fireEvent("space_created", {
        beat: "spaceCreate",
        space_type: spaceType,
        scope,
        ok: Boolean(spaceId),
      });

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
      }).then((res) => {
        // Capture the soul-seeding outcome separately so a successful
        // space_created with a failed soul_seeded is visible in the funnel.
        fireEvent("soul_seeded", { ok: res.ok });
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
        // The user clicked "Connect" and got a working link. We log
        // wa_connected at this point — not on inbound message receipt —
        // because the inbound webhook isn't observable from the client.
        // The funnel can later be cross-referenced with whatsapp-webhook
        // logs to compute the link → first-message conversion separately.
        fireEvent("wa_connected", { beat: "whatsapp" });
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
        // Fired pre-redirect: the user CHOSE to connect. Whether OAuth
        // actually completes is observable via the calendar-callback
        // edge function logs and the calendar_connections table — the
        // funnel here measures intent, not outcome.
        fireEvent("calendar_connected", { beat: "calendar", stage: "redirected" });
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

    // Telemetry: emit flow_completed with both the wall-clock duration
    // and the path the user took. duration_seconds rounds to whole
    // seconds — the JSONB payload preserves higher precision via ms.
    const ms = Date.now() - flowStartRef.current;
    fireEvent("flow_completed", {
      duration_seconds: Math.round(ms / 1000),
      duration_ms: ms,
      completed_steps: state.completedSteps,
      space_type: state.quizAnswers.scope
        ? SCOPE_TO_SPACE_TYPE[state.quizAnswers.scope] || "custom"
        : "custom",
    });

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
    const startedAt = Date.now();
    try {
      const coupleId = await ensureSpaceExists();

      const { data, error } = await supabase.functions.invoke("process-note", {
        body: { text: demoText.trim(), user_id: user?.id, couple_id: coupleId },
      });
      if (error) throw error;
      // capture_sent measures the moment Olive successfully ingests the
      // user's first brain-dump. latency_ms is process-note's round-trip
      // — useful for spotting Gemini slowdowns that hurt the aha moment.
      fireEvent("capture_sent", {
        beat: "demo",
        latency_ms: Date.now() - startedAt,
        chars: demoText.trim().length,
      });
      // Switch the demo card from input mode to preview mode. We do NOT
      // navigate yet — let the user see Olive understand them, then tap
      // through. CapturePreview's onAnimationComplete fires
      // capture_previewed and reveals the "Take me home" CTA.
      setDemoResult((data as ProcessNoteResult) || { summary: "Captured", category: "note" });
    } catch (err: any) {
      fireEvent("error", {
        beat: "demo",
        error: err?.message || "process_note_failed",
      });
      toast.error(t("demo.error", { defaultValue: "Something went wrong. Let's try again." }));
    } finally {
      setIsProcessingDemo(false);
    }
  };

  const handleComplete = async () => {
    // The user reached the demo step but tapped "Skip and go to Home"
    // instead of submitting a brain-dump. Record the skip distinctly so
    // we can measure whether moving the demo earlier in the flow would
    // convert these dropouts into capture_sent events.
    fireEvent("beat_skipped", { beat: "demo", path: "skip_to_home" });
    await ensureSpaceExists();
    // Both skip and capture paths funnel through the receipt beat now —
    // the receipt is the only place we mark onboarding complete + navigate
    // away. Keeps the "what does Olive know" transparency moment universal.
    goToNextStep(); // → receipt
  };

  // Called after the user has SEEN their first capture organized in the
  // preview pane and explicitly chose to advance. Distinguished from
  // handleComplete (which is for skip-without-capture) so the funnel can
  // measure how many users reach the aha moment.
  const handleFinishFromPreview = () => {
    setIsProcessingDemo(false);
    goToNextStep(); // → receipt
  };

  // Final beat handler — called from ReceiptStep's "Open my day" CTA.
  // This is the ONLY place we mark onboarding completed + navigate to
  // the home screen, so flow_completed telemetry is canonical regardless
  // of whether the user captured something or skipped through demo.
  const handleReceiptDone = async () => {
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

  // The "Gate code" chip mirrors the landing-page demo and proves the
  // "save random strings" use case (a high-frequency real-world capture
  // for couples / families that no other note app handles cleanly).
  const demoChips = [
    t("demo.chip1", { defaultValue: "Remind me to call Mom tomorrow at 5pm" }),
    t("demo.chip2", { defaultValue: "Add milk, eggs, and bread to grocery list" }),
    t("demo.chip3", { defaultValue: "Dinner with Sarah next Friday at 7pm" }),
    t("demo.chip4", { defaultValue: "Gate code 4821#" }),
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
            <button onClick={skipBeat} className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors">
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
              ? t("quiz.step", { current: state.quizStep + 1, total: quizTotalSteps })
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

        {/* Step 3.5: Share Space — invite link for non-solo spaces.
            Solo spaces auto-skip via the effect on state.currentStep. */}
        {state.currentStep === "shareSpace" &&
          state.spaceAnswers.spaceType &&
          state.spaceAnswers.spaceType !== "custom" && (
            <InviteSpaceStep
              spaceId={state.spaceAnswers.spaceId}
              spaceType={state.spaceAnswers.spaceType}
              spaceName={state.spaceAnswers.spaceName || "your Space"}
              onInviteGenerated={(token) => {
                fireEvent("invite_generated", {
                  beat: "shareSpace",
                  space_type: state.spaceAnswers.spaceType,
                  // Token recorded so we can correlate accept-rate
                  // post-onboarding without re-querying olive_space_invites.
                  token_prefix: token.slice(0, 8),
                });
              }}
              onContinue={() => {
                fireEvent("invite_shared", {
                  beat: "shareSpace",
                  space_type: state.spaceAnswers.spaceType,
                });
                goToNextStep();
              }}
              onSkip={skipBeat}
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

            <button onClick={skipBeat} className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors">
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
            <button onClick={skipBeat} className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t("skip", { defaultValue: "Skip" })}
            </button>
          </div>
        )}

        {/* Step 6: Live Demo — first brain dump */}
        {state.currentStep === "demo" && (
          <div className="w-full max-w-md animate-fade-up space-y-6">
            {/* Two modes:
                  (1) input  — chips + textarea + Send (default)
                  (2) preview — CapturePreview animated rows + Take me home
                The flip happens when demoResult populates after a
                successful process-note response. We never go back from
                preview to input — the user has captured something. */}
            {!demoResult ? (
              <>
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
              </>
            ) : (
              <>
                <div className="text-center space-y-2">
                  <h1 className="text-2xl font-bold text-foreground font-serif">
                    {t("demo.previewHeader", { defaultValue: "Done. That just happened." })}
                  </h1>
                  <p className="text-muted-foreground">
                    {t("demo.previewSubtext", {
                      defaultValue:
                        "This is what Olive does — every brain-dump becomes structure.",
                    })}
                  </p>
                </div>
                <Card className="p-4 bg-card/80 border-border/50 shadow-card">
                  <CapturePreview
                    result={demoResult}
                    onAnimationComplete={() => {
                      if (previewAnimComplete) return;
                      setPreviewAnimComplete(true);
                      // Funnel: capture_previewed marks "user actually
                      // saw the parse result", separating eyeball-time
                      // from raw capture_sent. Drop-off between these
                      // two is a useful signal for animation tuning.
                      fireEvent("capture_previewed", { beat: "demo" });
                    }}
                  />
                </Card>
                <Button
                  onClick={handleFinishFromPreview}
                  disabled={!previewAnimComplete}
                  className="w-full h-12 text-base group"
                >
                  {t("demo.takeMeHome", { defaultValue: "Take me home" })}
                  <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
                </Button>
              </>
            )}
          </div>
        )}

        {/* Step 7: Receipt — Olive's transparency moment.
            Renders four bullets pulled from the live data we wrote during
            onboarding. The CTA is the canonical "mark complete + navigate
            home" path; both demo-capture and demo-skip paths funnel here. */}
        {state.currentStep === "receipt" && (
          <ReceiptStep
            firstName={user?.firstName || ""}
            spaceName={state.spaceAnswers.spaceName}
            spaceType={state.spaceAnswers.spaceType}
            demoResult={demoResult}
            mentalLoad={state.quizAnswers.mentalLoad}
            userId={user?.id}
            onContinue={handleReceiptDone}
          />
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

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  MessageCircle,
  Mic,
  Image,
  Link2,
  Send,
  Sparkles,
  Search,
  Star,
  CheckCircle2,
} from "lucide-react";
import oliveLogoImage from "@/assets/olive-logo.jpg";

/**
 * NativeWelcome - iOS-native onboarding screen for Olive
 *
 * Mirrors the web landing page (witholive.app) structure:
 * - "She remembers, so you don't have to."
 * - Three modes: Personal, Partner, Business
 * - How it works: Drop → Organize → Find
 * - WhatsApp-first messaging
 * - Beta testimonials
 *
 * Design principles:
 * - Full-screen immersive scrollable experience
 * - Warm, organic color palette (Olive brand)
 * - Large touch targets (44pt minimum)
 * - iOS safe area respect for notch/Dynamic Island
 */

type ModeType = "personal" | "partner" | "business";

const NativeWelcome = () => {
  const { t } = useTranslation("auth");
  const navigate = useLocalizedNavigate();
  const [selectedMode, setSelectedMode] = useState<ModeType>("partner");

  const modes = [
    {
      key: "personal" as ModeType,
      emoji: "🧘",
      label: t("nativeWelcome.modePersonal", "Personal"),
      tagline: t("nativeWelcome.modePersonalTag", "For You."),
      pain: t(
        "nativeWelcome.modePersonalPain",
        "You text yourself reminders, links, and ideas. They disappear into the void. Olive catches them all."
      ),
      features: [
        t("nativeWelcome.personalFeat1", "Auto-sorts notes by category"),
        t("nativeWelcome.personalFeat2", "Smart reminders from your messages"),
        t("nativeWelcome.personalFeat3", "Voice note transcription"),
      ],
      bg: "bg-violet-50",
      border: "border-violet-400",
      chipBg: "bg-violet-100",
      chipText: "text-violet-700",
    },
    {
      key: "partner" as ModeType,
      emoji: "❤️",
      label: t("nativeWelcome.modePartner", "Partner"),
      tagline: t("nativeWelcome.modePartnerTag", "For You & Your Partner."),
      pain: t(
        "nativeWelcome.modePartnerPain",
        "One of you remembers everything. The other forgets. Olive keeps you both on the same page."
      ),
      features: [
        t("nativeWelcome.partnerFeat1", "Shared lists and budgets"),
        t("nativeWelcome.partnerFeat2", "Partner nudges & reminders"),
        t("nativeWelcome.partnerFeat3", "Shared memory vault"),
      ],
      bg: "bg-rose-50",
      border: "border-rose-400",
      chipBg: "bg-rose-100",
      chipText: "text-rose-700",
    },
    {
      key: "business" as ModeType,
      emoji: "💼",
      label: t("nativeWelcome.modeBusiness", "Business"),
      tagline: t("nativeWelcome.modeBusinessTag", "For Your Business."),
      pain: t(
        "nativeWelcome.modeBusinessPain",
        "Log decisions, scan receipts, and track expenses — all from your phone. No spreadsheets needed."
      ),
      features: [
        t("nativeWelcome.businessFeat1", "Receipt scanning & expenses"),
        t("nativeWelcome.businessFeat2", "Decision logging"),
        t("nativeWelcome.businessFeat3", "Export to CSV & integrations"),
      ],
      bg: "bg-blue-50",
      border: "border-blue-400",
      chipBg: "bg-blue-100",
      chipText: "text-blue-700",
    },
  ];

  const howItWorks = [
    {
      icon: Send,
      title: t("nativeWelcome.step1Title", "Drop It"),
      desc: t(
        "nativeWelcome.step1Desc",
        "Text, voice note, photo, link — just send it to Olive on WhatsApp. Don't organize it. Just dump it."
      ),
      gradient: "from-violet-500 to-purple-500",
    },
    {
      icon: Sparkles,
      title: t("nativeWelcome.step2Title", "She Organizes"),
      desc: t(
        "nativeWelcome.step2Desc",
        "Olive reads the chaos and files it. Groceries to grocery list. Dates to calendar. Ideas get saved. Automatically."
      ),
      gradient: "from-amber-500 to-orange-500",
    },
    {
      icon: Search,
      title: t("nativeWelcome.step3Title", "You Find It"),
      desc: t(
        "nativeWelcome.step3Desc",
        "Everything is clean, searchable, and shareable. Ask Olive anything — she remembers it all."
      ),
      gradient: "from-emerald-500 to-teal-500",
    },
  ];

  const testimonials = [
    {
      avatar: "👩‍💼",
      quote: t(
        "nativeWelcome.testimonial1",
        "I used to text myself 10 things a day. Now I text Olive and everything just... appears organized."
      ),
      name: "Sarah K.",
      role: t("nativeWelcome.testimonial1Role", "Busy Mom & Freelancer"),
    },
    {
      avatar: "❤️",
      quote: t(
        "nativeWelcome.testimonial2",
        "We stopped fighting about who forgot what. Olive is the neutral third party every couple needs."
      ),
      name: "Marcus & Jen",
      role: t("nativeWelcome.testimonial2Role", "Couple, NYC"),
    },
  ];

  const inputTypes = [
    { icon: Mic, label: t("nativeWelcome.inputVoice", "Voice notes") },
    { icon: Image, label: t("nativeWelcome.inputPhotos", "Photos") },
    { icon: Link2, label: t("nativeWelcome.inputLinks", "Links") },
    {
      icon: MessageCircle,
      label: t("nativeWelcome.inputTexts", "Text messages"),
    },
  ];

  const active = modes.find((m) => m.key === selectedMode)!;

  return (
    <main
      className="min-h-screen flex flex-col bg-gradient-to-b from-[#FDFDF8] via-[#F8F6F0] to-[#EAE8E0]"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {/* ── Hero ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex flex-col items-center px-6 pt-10 pb-6">
        {/* Badge */}
        <div className="flex items-center gap-2 mb-4 animate-fade-up">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-sm font-medium text-primary">
            {t("nativeWelcome.badge", "Meet your personal assistant")}
          </span>
        </div>

        {/* Logo */}
        <div
          className="relative mb-5 animate-fade-up"
          style={{ animationDelay: "0.1s" }}
        >
          <div className="absolute inset-0 blur-3xl bg-primary/20 rounded-full scale-150" />
          <div
            className={cn(
              "relative w-20 h-20 rounded-2xl flex items-center justify-center",
              "bg-white shadow-[0_8px_32px_rgba(58,90,64,0.15)]",
              "border border-primary/10"
            )}
          >
            <img
              src={oliveLogoImage}
              alt="Olive"
              className="w-14 h-14 object-contain rounded-xl"
            />
          </div>
        </div>

        {/* Headline */}
        <h1
          className="text-3xl font-bold text-foreground tracking-tight text-center mb-3 animate-fade-up leading-tight"
          style={{ animationDelay: "0.15s" }}
        >
          {t(
            "nativeWelcome.headline",
            "She remembers, so you don't have to."
          )}
        </h1>

        {/* Subheadline */}
        <p
          className="text-base text-muted-foreground text-center animate-fade-up leading-relaxed px-2"
          style={{ animationDelay: "0.2s" }}
        >
          {t(
            "nativeWelcome.subheadline",
            "Gate codes, grocery lists, brilliant ideas — drop anything to Olive. She organizes it all and gives it back, clean and sorted."
          )}
        </p>

        {/* Social Proof */}
        <div
          className="flex items-center gap-2 mt-4 animate-fade-up"
          style={{ animationDelay: "0.25s" }}
        >
          <div className="flex -space-x-1 text-sm">
            <span>😊</span>
            <span>🙌</span>
            <span>💪</span>
            <span>✨</span>
          </div>
          <span className="text-sm text-muted-foreground">
            {t(
              "nativeWelcome.socialProof",
              "Loved by 500+ people who stopped losing things"
            )}
          </span>
        </div>
      </div>

      {/* ── Choose Your Mode ─────────────────────────────── */}
      <div
        className="px-6 pb-4 animate-fade-up"
        style={{ animationDelay: "0.3s" }}
      >
        <p className="text-lg font-bold text-center mb-1">
          {t("nativeWelcome.modeHeadline", "Olive fits your life.")}
        </p>
        <p className="text-xs text-muted-foreground text-center mb-4">
          {t(
            "nativeWelcome.modeSubheadline",
            "Whether you're keeping your own life together, syncing with a partner, or running a business — Olive adapts."
          )}
        </p>

        {/* Mode Toggle */}
        <div className="flex gap-2 mb-4">
          {modes.map((mode) => (
            <button
              key={mode.key}
              onClick={() => setSelectedMode(mode.key)}
              className={cn(
                "flex-1 py-2.5 px-2 rounded-xl border-2 transition-all duration-200",
                "active:scale-[0.97]",
                selectedMode === mode.key
                  ? `${mode.border} ${mode.bg}`
                  : "border-transparent bg-white/60"
              )}
            >
              <span className="text-lg block text-center">{mode.emoji}</span>
              <p className="font-semibold text-xs text-center mt-0.5">
                {mode.label}
              </p>
            </button>
          ))}
        </div>

        {/* Active Mode Detail */}
        <div
          className={cn(
            "rounded-2xl p-4 border transition-all duration-200",
            active.bg,
            active.border
          )}
        >
          <p className="font-bold text-sm mb-1">{active.tagline}</p>
          <p className="text-xs text-muted-foreground mb-3">{active.pain}</p>
          <div className="flex flex-wrap gap-2">
            {active.features.map((feat, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium",
                  active.chipBg,
                  active.chipText
                )}
              >
                <CheckCircle2 className="w-3 h-3" />
                {feat}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── How It Works ─────────────────────────────────── */}
      <div
        className="px-6 pb-4 animate-fade-up"
        style={{ animationDelay: "0.4s" }}
      >
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center mb-3">
          {t("nativeWelcome.howLabel", "✨ How It Works")}
        </p>
        <div className="flex gap-2">
          {howItWorks.map((step, index) => (
            <div
              key={index}
              className="flex-1 p-3 rounded-xl bg-white/70 backdrop-blur-sm border border-white/80 shadow-sm"
            >
              <div
                className={cn(
                  "w-9 h-9 rounded-lg flex items-center justify-center mb-2",
                  "bg-gradient-to-br",
                  step.gradient
                )}
              >
                <step.icon className="w-4 h-4 text-white" />
              </div>
              <p className="font-semibold text-xs text-foreground leading-tight">
                {step.title}
              </p>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                {step.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── WhatsApp First ────────────────────────────────── */}
      <div
        className="px-6 pb-4 animate-fade-up"
        style={{ animationDelay: "0.5s" }}
      >
        <div className="bg-white/50 backdrop-blur-sm rounded-2xl p-4 border border-white/80">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-[#25D366]/10 flex items-center justify-center">
              <MessageCircle className="w-4 h-4 text-[#25D366]" />
            </div>
            <p className="font-semibold text-sm">
              {t(
                "nativeWelcome.worksWhere",
                "Works where you already live."
              )}
            </p>
          </div>
          <p className="text-xs text-muted-foreground text-center mb-3">
            {t(
              "nativeWelcome.worksWhereDesc",
              "No new apps to learn. Just forward a voice note, a photo, or a link to Olive on WhatsApp. She handles the rest."
            )}
          </p>
          <div className="flex justify-center gap-4">
            {inputTypes.map((input, index) => (
              <div key={index} className="flex flex-col items-center gap-1">
                <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center">
                  <input.icon className="w-4 h-4 text-muted-foreground" />
                </div>
                <span className="text-[9px] text-muted-foreground">
                  {input.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Testimonials ──────────────────────────────────── */}
      <div
        className="px-6 pb-4 animate-fade-up"
        style={{ animationDelay: "0.55s" }}
      >
        <div className="space-y-2">
          {testimonials.map((item, i) => (
            <div
              key={i}
              className="bg-white/70 backdrop-blur-sm rounded-xl p-3 border border-white/80 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">{item.avatar}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground italic leading-snug">
                    &ldquo;{item.quote}&rdquo;
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-xs font-semibold text-foreground">
                      {item.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {item.role}
                    </span>
                    <div className="flex ml-auto">
                      {[...Array(5)].map((_, s) => (
                        <Star
                          key={s}
                          className="w-3 h-3 text-amber-400 fill-amber-400"
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── CTA Section ───────────────────────────────────── */}
      <div
        className="px-6 pb-8 pt-2 space-y-3 mt-auto animate-fade-up"
        style={{ animationDelay: "0.6s" }}
      >
        <Button
          onClick={() => navigate("/request-access")}
          size="lg"
          className={cn(
            "w-full h-14 rounded-2xl text-lg font-semibold",
            "bg-primary hover:bg-primary/90 text-primary-foreground",
            "shadow-lg shadow-primary/25",
            "active:scale-[0.98] transition-all duration-200"
          )}
        >
          {t("nativeWelcome.ctaPrimary", "Request Beta Access")}
          <ChevronRight className="w-5 h-5 ml-1" />
        </Button>

        <Button
          onClick={() => navigate("/sign-in")}
          variant="ghost"
          size="lg"
          className={cn(
            "w-full h-12 rounded-2xl text-base font-medium",
            "text-primary hover:bg-primary/5",
            "active:scale-[0.98] transition-all duration-200"
          )}
        >
          {t("nativeWelcome.signIn", "I already have an account")}
        </Button>

        <p className="text-xs text-muted-foreground text-center">
          {t(
            "nativeWelcome.freeNote",
            "Free during Beta. No credit card required."
          )}
        </p>
      </div>
    </main>
  );
};

export default NativeWelcome;

/**
 * NativeWelcome — first-launch screen for the iOS app (Capacitor).
 *
 * Routed from src/pages/Root.tsx when Capacitor.isNativePlatform() is true
 * AND the user is not authenticated. This is the iOS sibling of the web
 * Landing page (witholive.app). They share brand DNA (color tokens,
 * typography, voice) but flex on density and tone per
 * OLIVE_BRAND_BIBLE.md §13.4:
 *
 *   - iOS: generous, intimate, headline-led, one decision at a time
 *   - Web: sectioned, marketing-dense, conversion-led
 *
 * Design rules enforced here (cross-reference brand bible):
 *   §6  Color: Hunter Green dominant, Coral for primary conversion CTA
 *       only, Magic Gold reserved for AI moments (not used on this page).
 *       NO violet/rose/blue/teal — those were the prior implementation's
 *       biggest brand drift.
 *   §7  Typography: Fraunces serif for the brand promise, Plus Jakarta
 *       Sans for everything else.
 *   §8  Surfaces: .card-glass language (frosted glass on warm sand),
 *       squircle icons, pill buttons, generous radii.
 *   §4  Voice: warm but not saccharine; no decorative emoji; the leaf
 *       (🌿) is reserved for Olive-authored lines, which this page does
 *       not have.
 *   §13.1 iOS: pt-safe / pb-safe respected, 48px minimum touch targets,
 *       earned animations (no stagger-for-stagger's-sake).
 *
 * Information architecture:
 *   1. Hero — headline + subhead + primary + secondary CTA. The 1.5-second
 *      test must pass here; everything else is proof that scrolls below.
 *   2. How it works — three-step Drop / Organize / Find squircle row.
 *   3. Modes — single tab strip (Solo / Couple / Family / Business) with
 *      one card revealed at a time. Mirrors web's ChooseYourMode but
 *      one-card-deep instead of three-cards-wide.
 *   4. Channels — "Lives where you already text" with WhatsApp + voice
 *      + photo + link affordances.
 *   5. Repeat CTA — same buttons as the hero, so a user who scrolled the
 *      proof never has to scroll back up to convert.
 */
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";
import { Button } from "@/components/ui/button";
import { BetaBadge } from "@/components/BetaBadge";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  MessageCircle,
  Mic,
  Image as ImageIcon,
  Link2,
  Send,
  Sparkles,
  Search,
  Heart,
  Users,
  Briefcase,
  User,
  Check,
} from "lucide-react";
// Use the full brand-mark asset (3D torus + "Olive" wordmark together).
// The full file already includes the wordmark, so the hero doesn't need
// a separately-typeset "Olive" text node. The legacy `olive-logo.jpg`
// asset is retained for places that still want the small flat icon.
import oliveLogoFullImage from "@/assets/olive-logo-full.png";

type ModeKey = "solo" | "couple" | "family" | "business";

// Lucide icons type their strokeWidth as `number | string`. We widen
// our `icon` prop to match so we can pass any lucide-react icon without
// fighting the type system.
type IconComponent = React.ComponentType<{
  className?: string;
  strokeWidth?: number | string;
}>;

interface ModeContent {
  key: ModeKey;
  icon: IconComponent;
  label: string;
  tagline: string;
  pain: string;
  features: string[];
}

const NativeWelcome = () => {
  const { t } = useTranslation("auth");
  const navigate = useLocalizedNavigate();
  // Default to "couple" — the highest-converting wedge per the brand bible's
  // audience-specific cuts (couples = consumer flagship, the deepest pain).
  const [selectedMode, setSelectedMode] = useState<ModeKey>("couple");

  // ─── Mode content ──────────────────────────────────────────────────
  // Wording adapted from OLIVE_BRAND_BIBLE.md §3 audience cuts. No icons
  // in color other than Hunter Green — selection state is signaled by
  // border + subtle bg tint, NOT by a unique color per mode.
  const modes: ModeContent[] = [
    {
      key: "solo",
      icon: User,
      label: t("nativeWelcome.modeSoloLabel", { defaultValue: "Solo" }),
      tagline: t("nativeWelcome.modeSoloTag", {
        defaultValue: "For your own brain.",
      }),
      pain: t("nativeWelcome.modeSoloPain", {
        defaultValue:
          "You text yourself reminders, links, ideas. They die in a chat with yourself. Olive catches them all.",
      }),
      features: [
        t("nativeWelcome.modeSoloFeat1", {
          defaultValue: "Auto-sorts every brain dump",
        }),
        t("nativeWelcome.modeSoloFeat2", {
          defaultValue: "Reminders pulled from your messages",
        }),
        t("nativeWelcome.modeSoloFeat3", {
          defaultValue: "Voice notes transcribed automatically",
        }),
      ],
    },
    {
      key: "couple",
      icon: Heart,
      label: t("nativeWelcome.modeCoupleLabel", { defaultValue: "Couple" }),
      tagline: t("nativeWelcome.modeCoupleTag", {
        defaultValue: "For you and your partner.",
      }),
      pain: t("nativeWelcome.modeCouplePain", {
        defaultValue:
          "One of you remembers everything. The other forgets. Olive holds both sides — without anyone having to nag.",
      }),
      features: [
        t("nativeWelcome.modeCoupleFeat1", {
          defaultValue: "Shared lists and calendars",
        }),
        t("nativeWelcome.modeCoupleFeat2", {
          defaultValue: "Partner reminders without the nag",
        }),
        t("nativeWelcome.modeCoupleFeat3", {
          defaultValue: "Private memory, scoped per Space",
        }),
      ],
    },
    {
      key: "family",
      icon: Users,
      label: t("nativeWelcome.modeFamilyLabel", { defaultValue: "Family" }),
      tagline: t("nativeWelcome.modeFamilyTag", {
        defaultValue: "For everyone in the house.",
      }),
      pain: t("nativeWelcome.modeFamilyPain", {
        defaultValue:
          "Soccer practice, grandma's recipe, the gate code — everything your family is too busy to write down. Olive remembers it all.",
      }),
      features: [
        t("nativeWelcome.modeFamilyFeat1", {
          defaultValue: "Shared family calendar",
        }),
        t("nativeWelcome.modeFamilyFeat2", {
          defaultValue: "Group reminders for everyone",
        }),
        t("nativeWelcome.modeFamilyFeat3", {
          defaultValue: "Photo-captured recipes & lists",
        }),
      ],
    },
    {
      key: "business",
      icon: Briefcase,
      label: t("nativeWelcome.modeBusinessLabel", {
        defaultValue: "Business",
      }),
      tagline: t("nativeWelcome.modeBusinessTag", {
        defaultValue: "For your team.",
      }),
      pain: t("nativeWelcome.modeBusinessPain", {
        defaultValue:
          "Client decisions, deadlines, expenses — log them once, find them forever. No spreadsheet required.",
      }),
      features: [
        t("nativeWelcome.modeBusinessFeat1", {
          defaultValue: "Receipt scan to expense",
        }),
        t("nativeWelcome.modeBusinessFeat2", {
          defaultValue: "Client briefs, auto-compiled",
        }),
        t("nativeWelcome.modeBusinessFeat3", {
          defaultValue: "Decision log per client",
        }),
      ],
    },
  ];

  const activeMode = modes.find((m) => m.key === selectedMode)!;

  // ─── How-it-works steps ────────────────────────────────────────────
  // Three squircle icons in a row. Hunter Green only — the brand bible
  // explicitly forbids color-per-step gradients. Earned consistency.
  const steps = [
    {
      icon: Send,
      title: t("nativeWelcome.stepDropTitle", { defaultValue: "Drop it" }),
      desc: t("nativeWelcome.stepDropDesc", {
        defaultValue: "Text, voice, photo, or link — just send it.",
      }),
    },
    {
      icon: Sparkles,
      title: t("nativeWelcome.stepOrganizeTitle", {
        defaultValue: "She organizes",
      }),
      desc: t("nativeWelcome.stepOrganizeDesc", {
        defaultValue: "Olive reads it, files it, remembers it.",
      }),
    },
    {
      icon: Search,
      title: t("nativeWelcome.stepFindTitle", {
        defaultValue: "Find it later",
      }),
      desc: t("nativeWelcome.stepFindDesc", {
        defaultValue: "Ask Olive anything. She knows where it is.",
      }),
    },
  ];

  // ─── Channel affordances ───────────────────────────────────────────
  // Plain stroke icons in Hunter Green at low weight — these are
  // descriptive, not brand moments. Cross-reference the channels named
  // in OLIVE_SYSTEM_PROMPT input channels list.
  const channels = [
    { icon: MessageCircle, label: t("nativeWelcome.channelWa", { defaultValue: "WhatsApp" }) },
    { icon: Mic, label: t("nativeWelcome.channelVoice", { defaultValue: "Voice" }) },
    { icon: ImageIcon, label: t("nativeWelcome.channelPhotos", { defaultValue: "Photos" }) },
    { icon: Link2, label: t("nativeWelcome.channelLinks", { defaultValue: "Links" }) },
  ];

  // ─── Handlers ──────────────────────────────────────────────────────
  // Primary path is /sign-up (functional account creation). The brand
  // bible's web hero uses the same destination for consistency. The
  // /request-access flow is reserved for the waitlist — accessible via
  // a less prominent link (not on this screen by default; can be added
  // back if waitlist returns).
  const handleGetStarted = () => navigate("/sign-up");
  const handleSignIn = () => navigate("/sign-in");

  return (
    <main
      className="min-h-screen bg-gradient-soft flex flex-col"
      style={{
        // Respect notch + home indicator. The screen is scrollable; safe
        // areas are applied to the OUTER main so all sections inherit.
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {/* ─── Hero (1.5-second test) ─────────────────────────────── */}
      <section className="px-6 pt-8 pb-6 flex flex-col items-center text-center">
        {/* Brand mark — single centered image (icon + wordmark together).
            We don't wrap it in a card or squircle: the asset is the brand
            moment and stands on its own. Beta badge sits below as a small
            accent so the trust signal is co-present without competing. */}
        <img
          src={oliveLogoFullImage}
          alt="Olive"
          // Sized for the square brand-mark asset (icon stacked above
          // wordmark). h-32 mobile / h-36 sm+ gives the 3D mark presence
          // without crowding the headline below. Capped via max-w so a
          // future wider asset doesn't overflow narrow viewports.
          className="h-32 sm:h-36 w-auto max-w-[16rem] object-contain mb-3 select-none"
          draggable={false}
        />
        <BetaBadge size="md" className="mb-6" />

        {/* Eyebrow — category-naming, NOT "personal assistant" framing
            (brand bible anti-positioning §1) */}
        <div className="inline-flex items-center gap-2 mb-5 px-3 py-1.5 rounded-full bg-primary/10">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-medium text-primary">
            {t("nativeWelcome.eyebrow", {
              defaultValue: "Shared memory for the people you care about",
            })}
          </span>
        </div>

        {/* Headline — Fraunces serif per brand bible §7 (this is the
            brand-promise moment that earns serif). Tracking-tight and
            tight leading per the type spec. */}
        <h1
          className="font-serif font-bold text-4xl sm:text-5xl text-foreground tracking-tight leading-[1.1] mb-4 px-2"
          style={{
            // Use the slightly deeper green for headings per brand bible
            // §7 ("All Fraunces headings use a deep variant of brand
            // green, hsl(130 25% 18%)").
            color: "hsl(130 25% 18%)",
          }}
        >
          {t("nativeWelcome.headline", {
            defaultValue: "She remembers, so you don't have to.",
          })}
        </h1>

        {/* Subheadline — concrete proof, never abstract (brand bible §13.2) */}
        <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-md mb-7 px-2">
          {t("nativeWelcome.subheadline", {
            defaultValue:
              "Drop anything — gate codes, grocery lists, dinner plans. Olive organizes it all and gives it back, clean and sorted, the moment you need it.",
          })}
        </p>

        {/* Primary CTA — Coral pill per brand bible §6 ("primary
            conversion CTA color"). 48px min touch target; soft shadow. */}
        <Button
          onClick={handleGetStarted}
          className={cn(
            "w-full max-w-sm h-14 rounded-full text-base font-semibold",
            "bg-accent hover:bg-accent/90 text-accent-foreground",
            "shadow-lg shadow-accent/25",
            "active:scale-[0.98] transition-transform duration-150",
            "group",
          )}
        >
          {t("nativeWelcome.ctaPrimary", { defaultValue: "Get started — free" })}
          <ArrowRight className="w-5 h-5 ml-2 transition-transform group-hover:translate-x-1" />
        </Button>

        {/* Secondary CTA — ghost/text-only, Hunter Green */}
        <Button
          onClick={handleSignIn}
          variant="ghost"
          className={cn(
            "w-full max-w-sm h-12 mt-2 rounded-full text-base font-medium",
            "text-primary hover:bg-primary/5",
            "active:scale-[0.98] transition-transform duration-150",
          )}
        >
          {t("nativeWelcome.ctaSignIn", {
            defaultValue: "I already have an account",
          })}
        </Button>

        {/* Trust signal — Beta-transparent (brand bible §4) */}
        <p className="text-xs text-muted-foreground mt-4 px-4">
          {t("nativeWelcome.trustSignal", {
            defaultValue: "Free during Beta. Your data stays yours.",
          })}
        </p>
      </section>

      {/* ─── How it works — Drop / Organize / Find ─────────────── */}
      <section className="px-6 py-8 border-t border-border/40">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center mb-5">
          {t("nativeWelcome.howLabel", { defaultValue: "How it works" })}
        </p>

        {/* Three squircle icons. Hunter-green-only per §6 — never the
            old multi-color gradient row. */}
        <div className="grid grid-cols-3 gap-3 max-w-md mx-auto">
          {steps.map((step, i) => {
            const StepIcon = step.icon;
            return (
              <div key={i} className="flex flex-col items-center text-center">
                <div
                  className={cn(
                    "w-14 h-14 mb-3 flex items-center justify-center",
                    "rounded-[28%] bg-gradient-to-br from-sage/40 to-white",
                    "border border-primary/15 shadow-sm",
                  )}
                >
                  <StepIcon className="w-6 h-6 text-primary" strokeWidth={2.25} />
                </div>
                <p className="font-semibold text-sm text-foreground leading-tight">
                  {step.title}
                </p>
                <p className="text-xs text-muted-foreground leading-snug mt-1">
                  {step.desc}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── Modes — single-card depth, not three-card width ────── */}
      <section className="px-6 py-8 border-t border-border/40">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center mb-2">
          {t("nativeWelcome.modesLabel", { defaultValue: "Olive fits how you live" })}
        </p>
        <p className="text-sm text-muted-foreground text-center mb-5 max-w-md mx-auto">
          {t("nativeWelcome.modesSubtext", {
            defaultValue:
              "Same Olive. The Space adapts to who's in it — solo brain dump, couple, family, or team.",
          })}
        </p>

        {/* Mode tabs. 64px tall (h-16). Selected state = Hunter Green
            border + subtle primary tint. NO per-mode color — the brand
            stays unified across modes (§6 60-30-10 rule). */}
        <div className="grid grid-cols-4 gap-2 mb-4 max-w-md mx-auto">
          {modes.map((mode) => {
            const Icon = mode.icon;
            const isActive = mode.key === selectedMode;
            return (
              <button
                key={mode.key}
                onClick={() => setSelectedMode(mode.key)}
                className={cn(
                  "h-16 rounded-2xl flex flex-col items-center justify-center gap-1",
                  "transition-all duration-200 active:scale-[0.97]",
                  "border-2",
                  isActive
                    ? "border-primary bg-primary/5"
                    : "border-transparent bg-white/60 hover:bg-white",
                )}
                aria-pressed={isActive}
              >
                <Icon
                  className={cn(
                    "w-5 h-5",
                    isActive ? "text-primary" : "text-muted-foreground",
                  )}
                  strokeWidth={2.25}
                />
                <span
                  className={cn(
                    "text-[11px] font-semibold leading-tight",
                    isActive ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {mode.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Selected mode card — .card-glass language per §8. */}
        <div
          className={cn(
            "max-w-md mx-auto rounded-3xl p-5",
            "bg-white/80 backdrop-blur-xl",
            "border border-primary/15 shadow-card",
          )}
        >
          <p className="font-serif font-bold text-lg text-foreground mb-2">
            {activeMode.tagline}
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            {activeMode.pain}
          </p>
          <ul className="space-y-2">
            {activeMode.features.map((feat, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-primary" />
                <span>{feat}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ─── Channels — "lives where you already text" ───────────── */}
      <section className="px-6 py-8 border-t border-border/40">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center mb-2">
          {t("nativeWelcome.channelsLabel", {
            defaultValue: "Lives where you already text",
          })}
        </p>
        <p className="text-sm text-muted-foreground text-center mb-5 max-w-md mx-auto">
          {t("nativeWelcome.channelsSubtext", {
            defaultValue:
              "No new app to learn. Forward a voice note from WhatsApp, snap a photo, paste a link — it all lands with Olive.",
          })}
        </p>

        <div className="flex justify-center gap-3 max-w-md mx-auto">
          {channels.map((c, i) => {
            const ChannelIcon = c.icon;
            return (
              <div
                key={i}
                className={cn(
                  "flex-1 flex flex-col items-center gap-1.5 py-3 rounded-2xl",
                  "bg-white/60 border border-border/40",
                )}
              >
                <ChannelIcon className="w-5 h-5 text-primary" strokeWidth={2} />
                <span className="text-[11px] font-medium text-muted-foreground">
                  {c.label}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── Repeat CTA — sticky-feeling final invitation ────────── */}
      <section className="px-6 pt-6 pb-10 mt-auto">
        <Button
          onClick={handleGetStarted}
          className={cn(
            "w-full max-w-sm mx-auto h-14 rounded-full text-base font-semibold",
            "bg-accent hover:bg-accent/90 text-accent-foreground",
            "shadow-lg shadow-accent/25",
            "active:scale-[0.98] transition-transform duration-150",
            "group flex",
          )}
        >
          {t("nativeWelcome.ctaPrimary", { defaultValue: "Get started — free" })}
          <ArrowRight className="w-5 h-5 ml-2 transition-transform group-hover:translate-x-1" />
        </Button>

        <button
          onClick={handleSignIn}
          className="w-full text-sm text-primary hover:underline mt-3 py-2 font-medium"
        >
          {t("nativeWelcome.ctaSignIn", {
            defaultValue: "I already have an account",
          })}
        </button>
      </section>
    </main>
  );
};

export default NativeWelcome;

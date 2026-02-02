import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Heart,
  Rocket,
  Receipt,
  Brain,
  Gift,
  ChevronRight,
  MessageCircle,
  Mic,
  Image,
  Link2,
  CheckCircle2,
  Users
} from "lucide-react";
import oliveLogoImage from "@/assets/olive-logo.jpg";

/**
 * NativeWelcome - Premium iOS-native onboarding screen for the Olive app
 *
 * Based on witholive.app landing page structure:
 * - "AI Chief of Staff for Dynamic Duos"
 * - Dual personas: Couples & Co-Founders
 * - Three superpowers: Receipt Hunter, Memory Vault, Wishlist Monitor
 * - WhatsApp-first messaging
 * - Social proof with beta users
 *
 * Design principles:
 * - Full-screen immersive experience
 * - Warm, organic color palette (Olive brand)
 * - Large touch targets (44pt minimum)
 * - iOS-style visual hierarchy
 * - Smooth animations
 * - Safe area respect for notch/Dynamic Island
 */

type PersonaType = 'couples' | 'cofounders';

const NativeWelcome = () => {
  const { t } = useTranslation('auth');
  const navigate = useLocalizedNavigate();
  const [selectedPersona, setSelectedPersona] = useState<PersonaType>('couples');

  // Superpowers - the three main features
  const superpowers = [
    {
      icon: Receipt,
      title: t('nativeWelcome.superpower1Title', 'Receipt Hunter'),
      description: t('nativeWelcome.superpower1Desc', 'Reads, categorizes & alerts if over budget'),
      color: 'text-amber-600',
      bgColor: 'bg-amber-100',
    },
    {
      icon: Brain,
      title: t('nativeWelcome.superpower2Title', 'Memory Vault'),
      description: t('nativeWelcome.superpower2Desc', 'Remembers facts AND feelings'),
      color: 'text-violet-600',
      bgColor: 'bg-violet-100',
    },
    {
      icon: Gift,
      title: t('nativeWelcome.superpower3Title', 'Wishlist Monitor'),
      description: t('nativeWelcome.superpower3Desc', 'Price drop alerts for saved items'),
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-100',
    },
  ];

  // Persona-specific benefits
  const personaBenefits = {
    couples: [
      t('nativeWelcome.couplesBenefit1', 'Budget alerts'),
      t('nativeWelcome.couplesBenefit2', 'Vacation reminders'),
      t('nativeWelcome.couplesBenefit3', 'Gift monitoring'),
    ],
    cofounders: [
      t('nativeWelcome.cofoundersBenefit1', 'Receipt scanning'),
      t('nativeWelcome.cofoundersBenefit2', 'Meeting reminders'),
      t('nativeWelcome.cofoundersBenefit3', 'Decision logging'),
    ],
  };

  // Input types supported
  const inputTypes = [
    { icon: Mic, label: t('nativeWelcome.inputVoice', 'Voice notes') },
    { icon: Image, label: t('nativeWelcome.inputPhotos', 'Photos & receipts') },
    { icon: Link2, label: t('nativeWelcome.inputLinks', 'Links') },
    { icon: MessageCircle, label: t('nativeWelcome.inputTexts', 'Text messages') },
  ];

  return (
    <main
      className="min-h-screen flex flex-col bg-gradient-to-b from-[#FDFDF8] via-[#F8F6F0] to-[#EAE8E0]"
      style={{
        // Respect iOS safe areas
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {/* Hero Section */}
      <div className="flex-shrink-0 flex flex-col items-center px-6 pt-10 pb-6">
        {/* Badge */}
        <div className="flex items-center gap-2 mb-4 animate-fade-up">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-sm font-medium text-primary">
            {t('nativeWelcome.badge', 'AI Intermediary for Partners')}
          </span>
        </div>

        {/* Logo */}
        <div className="relative mb-5 animate-fade-up" style={{ animationDelay: '0.1s' }}>
          <div className="absolute inset-0 blur-3xl bg-primary/20 rounded-full scale-150" />
          <div className={cn(
            "relative w-20 h-20 rounded-2xl flex items-center justify-center",
            "bg-white shadow-[0_8px_32px_rgba(58,90,64,0.15)]",
            "border border-primary/10"
          )}>
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
          style={{ animationDelay: '0.15s' }}
        >
          {t('nativeWelcome.headline', 'The AI Chief of Staff for Dynamic Duos.')}
        </h1>

        {/* Subheadline */}
        <p
          className="text-base text-muted-foreground text-center animate-fade-up leading-relaxed px-2"
          style={{ animationDelay: '0.2s' }}
        >
          {t('nativeWelcome.subheadline', 'Stop nagging. Stop forgetting. Olive listens to your voice notes, receipts, and links, and organizes them instantly.')}
        </p>

        {/* Social Proof */}
        <div
          className="flex items-center gap-2 mt-4 animate-fade-up"
          style={{ animationDelay: '0.25s' }}
        >
          <div className="flex -space-x-2">
            <div className="w-7 h-7 rounded-full bg-rose-200 flex items-center justify-center text-xs border-2 border-white">
              <Users className="w-3.5 h-3.5 text-rose-600" />
            </div>
            <div className="w-7 h-7 rounded-full bg-blue-200 flex items-center justify-center text-xs border-2 border-white">
              <Users className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <div className="w-7 h-7 rounded-full bg-amber-200 flex items-center justify-center text-xs border-2 border-white">
              <Users className="w-3.5 h-3.5 text-amber-600" />
            </div>
          </div>
          <span className="text-sm text-muted-foreground">
            {t('nativeWelcome.socialProof', 'Chosen by 500+ beta partners')}
          </span>
        </div>
      </div>

      {/* Persona Selector */}
      <div className="px-6 pb-4 animate-fade-up" style={{ animationDelay: '0.3s' }}>
        <p className="text-sm text-center text-muted-foreground mb-3">
          {t('nativeWelcome.howPartner', 'How do you partner?')}
        </p>
        <div className="flex gap-3">
          {/* Couples Card */}
          <button
            onClick={() => setSelectedPersona('couples')}
            className={cn(
              "flex-1 p-4 rounded-2xl border-2 transition-all duration-200",
              "active:scale-[0.98]",
              selectedPersona === 'couples'
                ? "border-rose-400 bg-rose-50"
                : "border-transparent bg-white/60"
            )}
          >
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center mb-2 mx-auto",
              selectedPersona === 'couples' ? "bg-rose-200" : "bg-rose-100"
            )}>
              <Heart className="w-5 h-5 text-rose-500" />
            </div>
            <p className="font-semibold text-sm text-center">
              {t('nativeWelcome.personaCouples', 'Couples')}
            </p>
            <p className="text-xs text-muted-foreground text-center mt-1">
              {t('nativeWelcome.personaCouplesDesc', 'End "mental load" imbalance')}
            </p>
          </button>

          {/* Co-Founders Card */}
          <button
            onClick={() => setSelectedPersona('cofounders')}
            className={cn(
              "flex-1 p-4 rounded-2xl border-2 transition-all duration-200",
              "active:scale-[0.98]",
              selectedPersona === 'cofounders'
                ? "border-blue-400 bg-blue-50"
                : "border-transparent bg-white/60"
            )}
          >
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center mb-2 mx-auto",
              selectedPersona === 'cofounders' ? "bg-blue-200" : "bg-blue-100"
            )}>
              <Rocket className="w-5 h-5 text-blue-500" />
            </div>
            <p className="font-semibold text-sm text-center">
              {t('nativeWelcome.personaCofounders', 'Co-Founders')}
            </p>
            <p className="text-xs text-muted-foreground text-center mt-1">
              {t('nativeWelcome.personaCofoundersDesc', 'Shared brain for your startup')}
            </p>
          </button>
        </div>

        {/* Benefits for selected persona */}
        <div className="flex flex-wrap justify-center gap-2 mt-3">
          {personaBenefits[selectedPersona].map((benefit, index) => (
            <div
              key={index}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium",
                selectedPersona === 'couples'
                  ? "bg-rose-100 text-rose-700"
                  : "bg-blue-100 text-blue-700"
              )}
            >
              <CheckCircle2 className="w-3 h-3" />
              {benefit}
            </div>
          ))}
        </div>
      </div>

      {/* Superpowers Section */}
      <div className="px-6 pb-4 animate-fade-up" style={{ animationDelay: '0.4s' }}>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center mb-3">
          {t('nativeWelcome.superpowersLabel', 'Superpowers')}
        </p>
        <div className="flex gap-2">
          {superpowers.map((power, index) => (
            <div
              key={index}
              className={cn(
                "flex-1 p-3 rounded-xl bg-white/70 backdrop-blur-sm",
                "border border-white/80 shadow-sm"
              )}
            >
              <div className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center mb-2",
                power.bgColor
              )}>
                <power.icon className={cn("w-4.5 h-4.5", power.color)} />
              </div>
              <p className="font-semibold text-xs text-foreground leading-tight">
                {power.title}
              </p>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                {power.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Works Where You Live Section */}
      <div className="px-6 pb-4 animate-fade-up" style={{ animationDelay: '0.5s' }}>
        <div className="bg-white/50 backdrop-blur-sm rounded-2xl p-4 border border-white/80">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-[#25D366]/10 flex items-center justify-center">
              <MessageCircle className="w-4 h-4 text-[#25D366]" />
            </div>
            <p className="font-semibold text-sm">
              {t('nativeWelcome.worksWhere', 'Works where you live')}
            </p>
          </div>
          <p className="text-xs text-muted-foreground text-center mb-3">
            {t('nativeWelcome.worksWhereDesc', 'Just forward to Olive on WhatsApp. She handles the filing.')}
          </p>
          <div className="flex justify-center gap-4">
            {inputTypes.map((input, index) => (
              <div key={index} className="flex flex-col items-center gap-1">
                <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center">
                  <input.icon className="w-4 h-4 text-muted-foreground" />
                </div>
                <span className="text-[9px] text-muted-foreground">{input.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div
        className="px-6 pb-8 pt-2 space-y-3 mt-auto animate-fade-up"
        style={{ animationDelay: '0.6s' }}
      >
        {/* Primary CTA */}
        <Button
          onClick={() => navigate('/sign-up')}
          size="lg"
          className={cn(
            "w-full h-14 rounded-2xl text-lg font-semibold",
            "bg-primary hover:bg-primary/90 text-primary-foreground",
            "shadow-lg shadow-primary/25",
            "active:scale-[0.98] transition-all duration-200"
          )}
        >
          {selectedPersona === 'couples'
            ? t('nativeWelcome.ctaCouples', 'Try with Your Partner')
            : t('nativeWelcome.ctaCofounders', 'Try with Your Co-Founder')
          }
          <ChevronRight className="w-5 h-5 ml-1" />
        </Button>

        {/* Secondary CTA */}
        <Button
          onClick={() => navigate('/sign-in')}
          variant="ghost"
          size="lg"
          className={cn(
            "w-full h-12 rounded-2xl text-base font-medium",
            "text-primary hover:bg-primary/5",
            "active:scale-[0.98] transition-all duration-200"
          )}
        >
          {t('nativeWelcome.signIn', 'I already have an account')}
        </Button>

        {/* Free to start note */}
        <p className="text-xs text-muted-foreground text-center">
          {t('nativeWelcome.freeNote', 'Free to start. No credit card required.')}
        </p>
      </div>
    </main>
  );
};

export default NativeWelcome;

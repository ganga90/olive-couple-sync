import React from "react";
import { useTranslation } from "react-i18next";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Heart, Sparkles, ListTodo, MessageCircle, ChevronRight } from "lucide-react";
import oliveLogoImage from "@/assets/olive-logo.jpg";

/**
 * NativeWelcome - A beautiful iOS-native onboarding screen for the Olive app
 *
 * Design principles:
 * - Full-screen immersive experience
 * - Warm, organic color palette (Olive brand)
 * - Large touch targets (44pt minimum)
 * - iOS-style visual hierarchy
 * - Smooth animations
 * - Safe area respect for notch/Dynamic Island
 */
const NativeWelcome = () => {
  const { t } = useTranslation('auth');
  const navigate = useLocalizedNavigate();

  const features = [
    {
      icon: Heart,
      title: t('nativeWelcome.feature1Title', 'Built for Couples'),
      description: t('nativeWelcome.feature1Desc', 'Share lists, tasks, and memories together'),
      color: 'text-rose-500',
      bgColor: 'bg-rose-500/10',
    },
    {
      icon: Sparkles,
      title: t('nativeWelcome.feature2Title', 'AI-Powered'),
      description: t('nativeWelcome.feature2Desc', 'Just speak or type - Olive organizes for you'),
      color: 'text-amber-500',
      bgColor: 'bg-amber-500/10',
    },
    {
      icon: ListTodo,
      title: t('nativeWelcome.feature3Title', 'Smart Lists'),
      description: t('nativeWelcome.feature3Desc', 'Books, restaurants, date ideas & more'),
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
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
      {/* Hero Section - Top half with logo and tagline */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 pt-12 pb-6">
        {/* Animated Logo Container */}
        <div className="relative mb-8 animate-fade-up">
          {/* Soft glow behind logo */}
          <div className="absolute inset-0 blur-3xl bg-primary/20 rounded-full scale-150" />

          {/* Logo circle with premium shadow */}
          <div className={cn(
            "relative w-28 h-28 rounded-[2rem] flex items-center justify-center",
            "bg-white shadow-[0_8px_40px_rgba(58,90,64,0.15)]",
            "border border-primary/10",
            "animate-scale-in"
          )}>
            <img
              src={oliveLogoImage}
              alt="Olive"
              className="w-20 h-20 object-contain rounded-xl"
            />
          </div>

          {/* Floating accent dots */}
          <div className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-accent/80 animate-bounce-subtle"
               style={{ animationDelay: '0.5s' }} />
          <div className="absolute -bottom-1 -left-3 w-3 h-3 rounded-full bg-primary/60 animate-bounce-subtle"
               style={{ animationDelay: '0.8s' }} />
        </div>

        {/* Brand Name */}
        <h1 className="text-5xl font-bold text-primary tracking-tight mb-3 animate-fade-up"
            style={{ animationDelay: '0.1s' }}>
          Olive
        </h1>

        {/* Tagline */}
        <p className="text-xl text-muted-foreground text-center font-light animate-fade-up px-4"
           style={{ animationDelay: '0.2s' }}>
          {t('nativeWelcome.tagline', 'Your second brain for couples')}
        </p>
      </div>

      {/* Features Section - Middle area with value props */}
      <div className="px-6 pb-6 animate-fade-up" style={{ animationDelay: '0.3s' }}>
        <div className="space-y-3">
          {features.map((feature, index) => (
            <div
              key={index}
              className={cn(
                "flex items-center gap-4 p-4 rounded-2xl",
                "bg-white/60 backdrop-blur-sm",
                "border border-white/80",
                "shadow-sm",
                "animate-fade-up"
              )}
              style={{ animationDelay: `${0.4 + index * 0.1}s` }}
            >
              <div className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0",
                feature.bgColor
              )}>
                <feature.icon className={cn("w-6 h-6", feature.color)} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-foreground text-base">
                  {feature.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-snug">
                  {feature.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA Section - Bottom with auth buttons */}
      <div
        className="px-6 pb-8 pt-4 space-y-3 animate-fade-up"
        style={{ animationDelay: '0.7s' }}
      >
        {/* Primary CTA - Get Started / Sign Up */}
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
          {t('nativeWelcome.getStarted', 'Get Started')}
          <ChevronRight className="w-5 h-5 ml-1" />
        </Button>

        {/* Secondary CTA - Sign In */}
        <Button
          onClick={() => navigate('/sign-in')}
          variant="ghost"
          size="lg"
          className={cn(
            "w-full h-14 rounded-2xl text-lg font-medium",
            "text-primary hover:bg-primary/5",
            "active:scale-[0.98] transition-all duration-200"
          )}
        >
          {t('nativeWelcome.signIn', 'I already have an account')}
        </Button>

        {/* Chat with Olive teaser */}
        <div className="flex items-center justify-center gap-2 pt-2 opacity-60">
          <MessageCircle className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {t('nativeWelcome.chatTeaser', 'Chat with Olive to organize your life')}
          </span>
        </div>
      </div>
    </main>
  );
};

export default NativeWelcome;

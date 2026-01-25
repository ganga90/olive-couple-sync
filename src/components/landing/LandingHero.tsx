import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { OliveLogoWithText } from "@/components/OliveLogo";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";
import { motion } from "framer-motion";
import heroMockup from "@/assets/hero-mockup.png";

export const LandingHero = () => {
  const { t } = useTranslation('landing');
  const getLocalizedPath = useLocalizedHref();
  const navigate = useNavigate();

  return (
    <section className="relative min-h-[90vh] flex flex-col items-center justify-center text-center px-4 py-16 md:py-24">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#EAE8E0] via-[#EAE8E0] to-white/50 -z-10" />
      
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="space-y-8 max-w-4xl mx-auto"
      >
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <OliveLogoWithText size="lg" className="justify-center" />
        </div>

        {/* Eyebrow */}
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-primary font-bold uppercase tracking-widest text-xs"
        >
          {t('hero.eyebrow')}
        </motion.p>
        
        {/* Headline */}
        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="text-5xl md:text-6xl lg:text-7xl font-serif text-stone-900 leading-tight"
        >
          {t('hero.headline')}
        </motion.h1>
        
        {/* Subheadline */}
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="text-xl md:text-2xl text-stone-600 max-w-2xl mx-auto leading-relaxed"
        >
          {t('hero.subheadline')}
        </motion.p>

        {/* Primary CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.6 }}
          className="pt-4"
        >
          <Button 
            size="xl" 
            onClick={() => navigate(getLocalizedPath("/sign-up"))}
            className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg text-lg px-10 py-7 rounded-full"
          >
            {t('hero.cta')}
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </motion.div>

        {/* Trust Signal */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7, duration: 0.6 }}
          className="flex items-center justify-center gap-3 pt-6"
        >
          {/* Avatar stack */}
          <div className="flex -space-x-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-200 to-rose-300 border-2 border-white" />
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-200 to-amber-300 border-2 border-white" />
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-200 to-emerald-300 border-2 border-white" />
          </div>
          <p className="text-sm text-stone-500">
            {t('hero.trustSignal')}
          </p>
        </motion.div>
      </motion.div>

      {/* Device Mockup */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8, duration: 0.8 }}
        className="mt-16 w-full max-w-5xl mx-auto"
      >
        <div className="bg-white rounded-3xl shadow-2xl border border-stone-200 p-4 md:p-6 overflow-hidden">
          <img 
            src={heroMockup} 
            alt="Olive Dashboard Preview" 
            className="w-full h-auto rounded-2xl"
          />
        </div>
      </motion.div>
    </section>
  );
};

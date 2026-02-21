import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Play } from "lucide-react";
import { WhatsAppChatAnimation } from "./WhatsAppChatAnimation";

export const NewLandingHero = () => {
  const { t } = useTranslation('landing');
  const getLocalizedPath = useLocalizedHref();

  const scrollToDemo = () => {
    document.getElementById('superpowers')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="pt-24 pb-16 md:pt-32 md:pb-24 px-4 overflow-hidden">
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left Side - Text Content */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            className="space-y-8"
          >
            {/* Eyebrow */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="inline-flex items-center gap-2 bg-olive/10 text-olive px-4 py-2 rounded-full text-sm font-medium"
            >
              <span className="w-2 h-2 bg-olive rounded-full animate-pulse" />
              {t('hero.eyebrow')}
            </motion.div>

            {/* Headline */}
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-stone-900 leading-[1.1] tracking-tight">
              {t('hero.headline')}
            </h1>

            {/* Subheadline */}
            <p className="text-lg md:text-xl text-stone-600 leading-relaxed max-w-xl">
              {t('hero.subheadline')}
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4">
              <Link to={getLocalizedPath("/request-access")}>
                <Button 
                  size="lg"
                  className="w-full sm:w-auto bg-olive hover:bg-olive/90 text-white font-semibold px-8 py-6 rounded-full shadow-xl shadow-olive/25 text-lg"
                >
                  {t('hero.betaCta', 'Request Beta Access')}
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              
              <Button 
                size="lg"
                variant="outline"
                onClick={scrollToDemo}
                className="w-full sm:w-auto border-2 border-stone-300 text-stone-700 hover:bg-stone-100 font-semibold px-8 py-6 rounded-full text-lg"
              >
                <Play className="mr-2 h-5 w-5 fill-stone-400" />
                {t('hero.ctaSecondary')}
              </Button>
            </div>

            {/* Trust Signal */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="flex items-center gap-4 pt-4"
            >
              <div className="flex -space-x-2">
                {['😊', '🙌', '💪', '✨'].map((emoji, i) => (
                  <div 
                    key={i}
                    className="w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center text-sm border-2 border-white"
                  >
                    {emoji}
                  </div>
                ))}
              </div>
              <p className="text-sm text-stone-500">
                {t('hero.trustSignal')}
              </p>
            </motion.div>
          </motion.div>

          {/* Right Side - Phone Animation */}
          <motion.div
            initial={{ opacity: 0, x: 30, rotateY: -10 }}
            animate={{ opacity: 1, x: 0, rotateY: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="relative flex justify-center lg:justify-end"
          >
            <WhatsAppChatAnimation />
            
            {/* Decorative Elements */}
            <div className="absolute -z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-gradient-radial from-olive/10 to-transparent rounded-full blur-3xl" />
          </motion.div>
        </div>
      </div>
    </section>
  );
};

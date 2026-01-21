import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { OliveLogoWithText } from "@/components/OliveLogo";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";
import { motion, AnimatePresence } from "framer-motion";

export const LandingStickyHeader = () => {
  const { t } = useTranslation('landing');
  const getLocalizedPath = useLocalizedHref();
  const navigate = useNavigate();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // Show header after scrolling past ~90vh (hero section height)
      const heroHeight = window.innerHeight * 0.9;
      setIsVisible(window.scrollY > heroHeight);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.header
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -100, opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-stone-200 shadow-sm"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              {/* Logo */}
              <button 
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                className="flex items-center"
              >
                <OliveLogoWithText size="sm" />
              </button>

              {/* Navigation Links - Desktop */}
              <nav className="hidden md:flex items-center gap-8">
                <button
                  onClick={() => scrollToSection("problems")}
                  className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors"
                >
                  {t('problems.headline', { defaultValue: 'Why Olive?' })}
                </button>
                <button
                  onClick={() => scrollToSection("features")}
                  className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors"
                >
                  {t('valueStack.headline', { defaultValue: 'Features' })}
                </button>
                <button
                  onClick={() => scrollToSection("testimonials")}
                  className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors"
                >
                  {t('socialProof.headline', { defaultValue: 'Reviews' })}
                </button>
              </nav>

              {/* CTAs */}
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(getLocalizedPath("/sign-in"))}
                  className="hidden sm:inline-flex text-stone-600 hover:text-stone-900"
                >
                  {t('footer.login')}
                </Button>
                <Button
                  size="sm"
                  onClick={() => navigate(getLocalizedPath("/sign-up"))}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-full px-4"
                >
                  <span className="hidden sm:inline">{t('hero.cta')}</span>
                  <span className="sm:hidden">Get Started</span>
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </motion.header>
      )}
    </AnimatePresence>
  );
};

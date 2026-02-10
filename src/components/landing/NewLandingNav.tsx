import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";
import { motion } from "framer-motion";

export const NewLandingNav = () => {
  const { t } = useTranslation('landing');
  const getLocalizedPath = useLocalizedHref();

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <motion.nav 
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-md border-b border-stone-200/50"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-olive to-olive/80 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">O</span>
            </div>
            <span className="text-xl font-bold text-stone-900">Olive Assistant</span>
          </Link>

          {/* Right Side Navigation */}
          <div className="flex items-center gap-6">
            {/* Desktop Links */}
            <div className="hidden md:flex items-center gap-6">
              <button 
                onClick={() => scrollToSection('pricing')}
                className="text-stone-600 hover:text-stone-900 transition-colors text-sm font-medium"
              >
                {t('nav.pricing')}
              </button>
              <Link 
                to={getLocalizedPath("/sign-in")}
                className="text-stone-600 hover:text-stone-900 transition-colors text-sm font-medium"
              >
                {t('nav.login')}
              </Link>
            </div>

            {/* CTA with micro-copy */}
            <div className="flex items-center gap-3">
              <Link to={getLocalizedPath("/sign-up")}>
                <Button 
                  size="sm"
                  className="bg-olive hover:bg-olive/90 text-white font-semibold px-4 py-2 rounded-full shadow-lg shadow-olive/20"
                >
                  {t('nav.cta')}
                </Button>
              </Link>
              <span className="hidden lg:block text-xs text-stone-500 max-w-[120px] leading-tight">
                {t('nav.microCopy')}
              </span>
            </div>
          </div>
        </div>
      </div>
    </motion.nav>
  );
};

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";
import { Instagram, Twitter } from "lucide-react";

export const NewLandingFooter = () => {
  const { t } = useTranslation('landing');
  const getLocalizedPath = useLocalizedHref();

  const links = [
    { labelKey: "footer.pricing", path: "#pricing", isAnchor: true },
    { labelKey: "footer.login", path: "/sign-in", isAnchor: false },
    { labelKey: "footer.privacy", path: "/legal/privacy", isAnchor: false },
    { labelKey: "footer.terms", path: "/legal/terms", isAnchor: false },
  ];

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <footer className="bg-stone-900 text-white py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-olive to-olive/80 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">O</span>
            </div>
            <span className="text-xl font-bold">Olive Assistant</span>
          </div>

          {/* Links */}
          <nav className="flex flex-wrap items-center justify-center gap-6">
            {links.map((link) => (
              link.isAnchor ? (
                <button
                  key={link.labelKey}
                  onClick={() => scrollToSection(link.path.replace('#', ''))}
                  className="text-stone-400 hover:text-white transition-colors text-sm"
                >
                  {t(link.labelKey)}
                </button>
              ) : (
                <Link
                  key={link.path}
                  to={getLocalizedPath(link.path)}
                  className="text-stone-400 hover:text-white transition-colors text-sm"
                >
                  {t(link.labelKey)}
                </Link>
              )
            ))}
          </nav>

          {/* Social */}
          <div className="flex items-center gap-4">
            <a 
              href="https://instagram.com/heyolive.app" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-stone-400 hover:text-white transition-colors"
            >
              <Instagram className="h-5 w-5" />
            </a>
            <a 
              href="https://twitter.com/heyolive_app" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-stone-400 hover:text-white transition-colors"
            >
              <Twitter className="h-5 w-5" />
            </a>
          </div>
        </div>

        {/* Copyright */}
        <div className="mt-8 pt-8 border-t border-stone-800 text-center">
          <p className="text-stone-500 text-sm">
            {t('footer.copyright')}
          </p>
          <p className="text-stone-600 text-xs mt-2">
            {t('footer.madeWith')}
          </p>
          <p className="text-stone-600 text-xs mt-1">
            {t('footer.tagline')}
          </p>
        </div>
      </div>
    </footer>
  );
};

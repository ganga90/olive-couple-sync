import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";
import { OliveLogoWithText } from "@/components/OliveLogo";
import { Instagram } from "lucide-react";
import { motion } from "framer-motion";

export const LandingFooter = () => {
  const { t } = useTranslation('landing');
  const getLocalizedPath = useLocalizedHref();

  const links = [
    { labelKey: "footer.login", path: "/sign-in" },
    { labelKey: "footer.privacy", path: "/legal/privacy" },
    { labelKey: "footer.terms", path: "/legal/terms" },
  ];

  return (
    <motion.footer 
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="bg-stone-900 text-white py-12 px-4"
    >
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <OliveLogoWithText size="sm" className="[&_span]:text-white" />
          </div>

          {/* Links */}
          <nav className="flex flex-wrap items-center justify-center gap-6">
            {links.map((link) => (
              <Link
                key={link.path}
                to={getLocalizedPath(link.path)}
                className="text-stone-400 hover:text-white transition-colors text-sm"
              >
                {t(link.labelKey)}
              </Link>
            ))}
            <a 
              href="https://instagram.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-stone-400 hover:text-white transition-colors"
            >
              <Instagram className="h-5 w-5" />
            </a>
          </nav>
        </div>

        {/* Copyright */}
        <div className="mt-8 pt-8 border-t border-stone-800 text-center">
          <p className="text-stone-500 text-sm">
            {t('footer.copyright')}
          </p>
          <p className="text-stone-600 text-xs mt-2">
            {t('footer.madeWith')}
          </p>
        </div>
      </div>
    </motion.footer>
  );
};

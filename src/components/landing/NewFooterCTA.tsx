import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";

export const NewFooterCTA = () => {
  const { t } = useTranslation('landing');
  const getLocalizedPath = useLocalizedHref();

  return (
    <section className="py-20 px-4 bg-gradient-to-br from-stone-900 to-stone-800">
      <div className="max-w-4xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="space-y-8"
        >
          {/* Icon */}
          <motion.div
            initial={{ scale: 0 }}
            whileInView={{ scale: 1 }}
            viewport={{ once: true }}
            transition={{ type: "spring", delay: 0.2 }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-olive/20"
          >
            <Sparkles className="w-8 h-8 text-olive" />
          </motion.div>

          {/* Headline */}
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white leading-tight">
            {t('footerCta.headline')}
          </h2>

          {/* Subheadline */}
          <p className="text-lg text-stone-400 max-w-xl mx-auto">
            {t('footerCta.subheadline')}
          </p>

          {/* CTA Button */}
          <Link to={getLocalizedPath("/request-access")}>
            <Button 
              size="lg"
              className="bg-olive hover:bg-olive/90 text-white font-semibold px-10 py-7 rounded-full shadow-2xl shadow-olive/30 text-lg"
            >
              {t('footerCta.betaCta', 'Request Beta Access')}
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>

          {/* Trust Note */}
          <p className="text-stone-500 text-sm">
            {t('footerCta.trustNote')}
          </p>
        </motion.div>
      </div>
    </section>
  );
};

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ArrowRight, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";
import { motion } from "framer-motion";

export const SecondaryCTA = () => {
  const { t } = useTranslation('landing');
  const getLocalizedPath = useLocalizedHref();
  const navigate = useNavigate();

  return (
    <section className="bg-white py-20 md:py-28 px-4">
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
        >
          <div className="bg-gradient-to-br from-[#EAE8E0] to-stone-100 rounded-3xl p-8 md:p-16 text-center shadow-lg border border-stone-200">
            <h2 className="text-3xl md:text-5xl font-serif text-stone-900 mb-6">
              {t('secondaryCta.headline')}
            </h2>
            
            <p className="text-lg text-stone-600 mb-8 max-w-xl mx-auto">
              {t('secondaryCta.description')}
            </p>

            <Button 
              size="xl" 
              onClick={() => navigate(getLocalizedPath("/sign-up"))}
              className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg text-lg px-10 py-7 rounded-full w-full sm:w-auto"
            >
              {t('secondaryCta.cta')}
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>

            {/* Risk Reversal */}
            <div className="mt-8 flex items-center justify-center gap-2 text-stone-500">
              <Shield className="h-4 w-4" />
              <span className="text-sm">
                {t('secondaryCta.riskReversal')}
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

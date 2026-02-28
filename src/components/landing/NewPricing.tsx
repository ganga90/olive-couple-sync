import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Sparkles, Heart, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";

export const NewPricing = () => {
  const { t } = useTranslation('landing');
  const getLocalizedPath = useLocalizedHref();

  return (
    <section className="py-20 px-4 bg-stone-50" id="pricing">
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative rounded-3xl bg-white shadow-xl border border-stone-200 overflow-hidden"
        >
          {/* Beta badge */}
          <div className="absolute top-6 right-6">
            <span className="bg-primary/10 text-primary text-xs font-bold px-3 py-1.5 rounded-full tracking-wide uppercase">
              Beta
            </span>
          </div>

          <div className="p-8 md:p-12 text-center">
            {/* Icon cluster */}
            <div className="flex items-center justify-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Heart className="w-6 h-6 text-primary" />
              </div>
              <div className="w-12 h-12 rounded-2xl bg-accent/20 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-accent" />
              </div>
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Zap className="w-6 h-6 text-primary" />
              </div>
            </div>

            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-3">
              {t('pricing.beta.headline', 'Free during Beta')}
            </h2>
            <p className="text-lg text-muted-foreground max-w-lg mx-auto mb-8">
              {t('pricing.beta.description', "Olive is in early access. Everything is free while we shape the experience together with our first users.")}
            </p>

            {/* What's included */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10 text-left">
              {[
                { emoji: "💬", text: t('pricing.beta.feature1', 'Unlimited WhatsApp capture') },
                { emoji: "🧠", text: t('pricing.beta.feature2', 'Smart organization & memory') },
                { emoji: "👥", text: t('pricing.beta.feature3', 'Shared space with your partner') },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3 p-4 rounded-2xl bg-stone-50">
                  <span className="text-xl">{item.emoji}</span>
                  <span className="text-sm font-medium text-foreground">{item.text}</span>
                </div>
              ))}
            </div>

            <Link to={getLocalizedPath("/request-access")}>
              <Button className="rounded-full px-10 py-6 text-base font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg">
                {t('pricing.beta.cta', 'Request Early Access')}
              </Button>
            </Link>

            <p className="text-xs text-muted-foreground mt-4">
              {t('pricing.beta.note', 'No credit card required. Pricing will be announced before Beta ends.')}
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

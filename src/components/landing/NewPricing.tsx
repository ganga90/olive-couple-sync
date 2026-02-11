import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Check, Sparkles, Building2, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";

export const NewPricing = () => {
  const { t } = useTranslation('landing');
  const getLocalizedPath = useLocalizedHref();

  const plans = [
    {
      id: 'personal',
      name: t('pricing.personal.name'),
      tagline: t('pricing.personal.tagline'),
      price: '$0',
      period: t('pricing.personal.period'),
      icon: Users,
      features: [
        t('pricing.personal.feature1'),
        t('pricing.personal.feature2'),
        t('pricing.personal.feature3'),
      ],
      cta: t('pricing.personal.cta'),
      popular: false,
      gradient: 'from-stone-400 to-stone-500',
    },
    {
      id: 'partner',
      name: t('pricing.partner.name'),
      tagline: t('pricing.partner.tagline'),
      price: '$12',
      period: t('pricing.partner.period'),
      icon: Sparkles,
      features: [
        t('pricing.partner.feature1'),
        t('pricing.partner.feature2'),
        t('pricing.partner.feature3'),
        t('pricing.partner.feature4'),
      ],
      cta: t('pricing.partner.cta'),
      popular: true,
      gradient: 'from-olive to-emerald-500',
    },
    {
      id: 'business',
      name: t('pricing.business.name'),
      tagline: t('pricing.business.tagline'),
      price: '$49',
      period: t('pricing.business.period'),
      icon: Building2,
      features: [
        t('pricing.business.feature1'),
        t('pricing.business.feature2'),
        t('pricing.business.feature3'),
        t('pricing.business.feature4'),
        t('pricing.business.feature5'),
      ],
      cta: t('pricing.business.cta'),
      popular: false,
      gradient: 'from-blue-500 to-indigo-500',
    },
  ];

  return (
    <section className="py-20 px-4 bg-stone-50" id="pricing">
      <div className="max-w-6xl mx-auto">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-stone-900 mb-4">
            {t('pricing.headline')}
          </h2>
          <p className="text-lg text-stone-600 max-w-xl mx-auto">
            {t('pricing.subheadline')}
          </p>
        </motion.div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-8">
          {plans.map((plan, index) => {
            const Icon = plan.icon;
            
            return (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className={`relative rounded-3xl p-8 ${
                  plan.popular 
                    ? 'bg-white shadow-2xl shadow-olive/20 scale-105 border-2 border-olive/20' 
                    : 'bg-white shadow-lg border border-stone-200'
                }`}
              >
                {/* Popular Badge */}
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <div className="bg-gradient-to-r from-olive to-emerald-500 text-white text-xs font-bold px-4 py-1.5 rounded-full shadow-lg">
                      {t('pricing.mostPopular')}
                    </div>
                  </div>
                )}

                {/* Icon */}
                <div className={`w-14 h-14 rounded-2xl bg-gradient-to-r ${plan.gradient} flex items-center justify-center mb-6 shadow-lg`}>
                  <Icon className="w-7 h-7 text-white" />
                </div>

                {/* Plan Name */}
                <h3 className="text-xl font-bold text-stone-900 mb-1">
                  {plan.name}
                </h3>
                <p className="text-stone-500 text-sm mb-4">
                  {plan.tagline}
                </p>

                {/* Price */}
                <div className="mb-6">
                  <span className="text-4xl font-bold text-stone-900">{plan.price}</span>
                  <span className="text-stone-500">/{plan.period}</span>
                </div>

                {/* Features */}
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <div className={`w-5 h-5 rounded-full bg-gradient-to-r ${plan.gradient} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                        <Check className="w-3 h-3 text-white" />
                      </div>
                      <span className="text-stone-600 text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <Link to={getLocalizedPath("/sign-up")} className="block">
                  <Button 
                    className={`w-full rounded-full py-6 font-semibold ${
                      plan.popular 
                        ? 'bg-gradient-to-r from-olive to-emerald-500 hover:from-olive/90 hover:to-emerald-500/90 text-white shadow-lg' 
                        : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
                    }`}
                  >
                    {plan.cta}
                  </Button>
                </Link>
              </motion.div>
            );
          })}
        </div>

        {/* Trust Note */}
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center text-stone-500 text-sm mt-8"
        >
          {t('pricing.trustNote')}
        </motion.p>
      </div>
    </section>
  );
};

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Heart, Rocket, Check, User, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";

export const ChooseYourMode = () => {
  const { t } = useTranslation('landing');
  const [activeMode, setActiveMode] = useState<'personal' | 'partner' | 'business'>('personal');
  const getLocalizedPath = useLocalizedHref();

  const modes = [
    {
      id: 'personal' as const,
      icon: User,
      emoji: '🧘',
      headline: t('chooseMode.personal.headline'),
      painPoint: t('chooseMode.personal.painPoint'),
      features: [
        t('chooseMode.personal.feature1'),
        t('chooseMode.personal.feature2'),
        t('chooseMode.personal.feature3'),
      ],
      gradient: 'from-violet-500 to-purple-500',
      bgGradient: 'from-violet-50 to-purple-50',
      borderColor: 'border-violet-200',
      textColor: 'text-violet-600',
    },
    {
      id: 'partner' as const,
      icon: Heart,
      emoji: '❤️',
      headline: t('chooseMode.partner.headline'),
      painPoint: t('chooseMode.partner.painPoint'),
      features: [
        t('chooseMode.partner.feature1'),
        t('chooseMode.partner.feature2'),
        t('chooseMode.partner.feature3'),
      ],
      gradient: 'from-rose-500 to-pink-500',
      bgGradient: 'from-rose-50 to-pink-50',
      borderColor: 'border-rose-200',
      textColor: 'text-rose-600',
    },
    {
      id: 'business' as const,
      icon: Rocket,
      emoji: '🚀',
      headline: t('chooseMode.business.headline'),
      painPoint: t('chooseMode.business.painPoint'),
      features: [
        t('chooseMode.business.feature1'),
        t('chooseMode.business.feature2'),
        t('chooseMode.business.feature3'),
      ],
      gradient: 'from-blue-500 to-indigo-500',
      bgGradient: 'from-blue-50 to-indigo-50',
      borderColor: 'border-blue-200',
      textColor: 'text-blue-600',
    },
  ];

  return (
    <section className="py-20 px-4 bg-white" id="choose-mode">
      <div className="max-w-6xl mx-auto">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-stone-900 mb-4">
            {t('chooseMode.headline')}
          </h2>
          <p className="text-lg text-stone-600">
            {t('chooseMode.subheadline')}
          </p>
        </motion.div>

        {/* Toggle Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {modes.map((mode, index) => {
            const isActive = activeMode === mode.id;
            const Icon = mode.icon;

            return (
              <motion.div
                key={mode.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                onClick={() => setActiveMode(mode.id)}
                className={`
                  relative cursor-pointer rounded-3xl p-8 transition-all duration-300
                  ${isActive
                    ? `bg-gradient-to-br ${mode.bgGradient} border-2 ${mode.borderColor} shadow-xl scale-[1.02]`
                    : 'bg-stone-50 border-2 border-stone-200 hover:border-stone-300'
                  }
                `}
              >
                {/* Active Indicator */}
                {isActive && (
                  <motion.div
                    layoutId="activeIndicator"
                    className={`absolute top-4 right-4 w-8 h-8 rounded-full bg-gradient-to-r ${mode.gradient} flex items-center justify-center`}
                  >
                    <Check className="w-4 h-4 text-white" />
                  </motion.div>
                )}

                {/* Icon */}
                <div className={`
                  w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-6
                  ${isActive
                    ? `bg-gradient-to-r ${mode.gradient} shadow-lg`
                    : 'bg-stone-200'
                  }
                `}>
                  {isActive ? (
                    <Icon className="w-8 h-8 text-white" />
                  ) : (
                    <span>{mode.emoji}</span>
                  )}
                </div>

                {/* Headline */}
                <h3 className={`text-2xl font-bold mb-3 ${isActive ? mode.textColor : 'text-stone-700'}`}>
                  {mode.headline}
                </h3>

                {/* Pain Point */}
                <p className="text-stone-600 mb-6 leading-relaxed">
                  {mode.painPoint}
                </p>

                {/* Features */}
                <div className="space-y-3">
                  {mode.features.map((feature, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className={`
                        w-5 h-5 rounded-full flex items-center justify-center
                        ${isActive
                          ? `bg-gradient-to-r ${mode.gradient}`
                          : 'bg-stone-300'
                        }
                      `}>
                        <Check className="w-3 h-3 text-white" />
                      </div>
                      <span className={`text-sm ${isActive ? 'text-stone-700 font-medium' : 'text-stone-500'}`}>
                        {feature}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* CTA Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mt-12"
        >
          <Link to={getLocalizedPath("/sign-up")}>
            <Button
              size="lg"
              className="bg-olive hover:bg-olive/90 text-white font-semibold px-8 py-6 rounded-full shadow-xl shadow-olive/25 text-lg"
            >
              {t('chooseMode.waitlistCta')}
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </motion.div>
      </div>
    </section>
  );
};
